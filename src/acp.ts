// acp-core 래퍼 — 커맨드(connect/session-new/prompt/cancel/disconnect) + acp.update.<connId> 버스 스트림.
// 연결은 게으르게 1개 유지(대화 세션 연속성), 실패 시 다음 턴에 재연결. permission="deny" —
// 컴패니언 대화는 도구/디스크 권한이 필요 없다(부수효과 0 대화 전용).
import type { Disposable, HostApp } from "@/types";

const CORE = "plugin.soksak-plugin-agents-acp.";

export interface TurnResult {
  text: string;
  stopReason?: string;
  /** 스트리밍 계측 — 델타 수·첫/마지막 델타 시각(ms, 턴 시작 기준). 통짜 판별용. */
  stream: { deltas: number; firstDeltaMs: number | null; lastDeltaMs: number | null };
}

export class AcpChat {
  private connId: number | null = null;
  private sessionId: string | null = null;
  private preambleSent = false;
  private inFlight = false;

  constructor(
    private app: HostApp,
    private agent: () => string, // preset: claude/codex/gemini
    private model: () => string = () => "", // 세션 모델 id("" = 에이전트 기본)
  ) {}

  connected(): boolean {
    return this.connId != null && this.sessionId != null;
  }

  busy(): boolean {
    return this.inFlight;
  }

  /** 코어 커맨드 실행 + 대칭봉투 {ok,code,message,data} 해제 — 실패는 message 로 throw. */
  private async core(name: string, params?: Record<string, unknown>): Promise<Record<string, any>> {
    const r = await this.app.commands.execute(CORE + name, params ?? {});
    if (!r?.ok) throw new Error(String(r?.message ?? r?.code ?? `acp ${name} failed`));
    return (r.data ?? {}) as Record<string, any>;
  }

  private async ensure(): Promise<{ connId: number; sessionId: string }> {
    if (this.connId != null && this.sessionId != null)
      return { connId: this.connId, sessionId: this.sessionId };
    const c = await this.core("connect", { agent: this.agent(), permission: "deny" });
    if (typeof c.connId !== "number") throw new Error("acp connect: connId missing");
    let s: Record<string, any>;
    try {
      const model = this.model().trim();
      s = await this.core("session-new", { connId: c.connId, ...(model ? { model } : {}) });
    } catch (e) {
      await this.core("disconnect", { connId: c.connId }).catch(() => {});
      throw e;
    }
    if (typeof s.sessionId !== "string") throw new Error("acp session-new: sessionId missing");
    this.connId = c.connId;
    this.sessionId = s.sessionId;
    this.preambleSent = false;
    return { connId: c.connId, sessionId: s.sessionId };
  }

  private drop(): void {
    const id = this.connId;
    this.connId = null;
    this.sessionId = null;
    this.preambleSent = false;
    if (id != null) void this.core("disconnect", { connId: id }).catch(() => {});
  }

  /** 한 턴 — preamble(페르소나)은 세션 첫 턴에만 앞붙인다. onDelta 로 스트리밍 텍스트 증분 전달. */
  async ask(text: string, preamble: string, onDelta: (t: string) => void): Promise<TurnResult> {
    if (this.inFlight) throw new Error("turn already in flight");
    this.inFlight = true;
    let off: Disposable | null = null;
    try {
      const { connId, sessionId } = await this.ensure();
      const t0 = performance.now();
      let streamed = "";
      let deltas = 0;
      let firstDeltaMs: number | null = null;
      let lastDeltaMs: number | null = null;
      off = this.app.bus.on(`acp.update.${connId}`, (evt: any) => {
        const u = evt?.update;
        if (!u || u.sessionUpdate !== "agent_message_chunk") return;
        const t: string = u.content?.text ?? "";
        if (t !== "" && t === streamed) return; // 최종 완결 재전송 skip(코어 dedup 계약과 동일 규칙)
        streamed += t;
        if (t) {
          deltas++;
          const ms = Math.round(performance.now() - t0);
          if (firstDeltaMs == null) firstDeltaMs = ms;
          lastDeltaMs = ms;
          onDelta(t);
        }
      });
      const body = this.preambleSent ? text : preamble + text;
      let r: Record<string, any>;
      try {
        // timeoutMs — 코어 기본(10s)은 고추론 모델 첫 턴에 부족. 대화 턴 상한 3분.
        r = await this.core("prompt", { connId, sessionId, text: body, timeoutMs: 180000 });
      } catch (e) {
        this.drop(); // 연결 유실/실패 — 다음 턴에 재연결
        throw e;
      }
      this.preambleSent = true;
      const final = String(r.text ?? "").trim() || streamed.trim();
      return {
        text: final,
        stopReason: r.stopReason,
        stream: { deltas, firstDeltaMs, lastDeltaMs },
      };
    } finally {
      off?.dispose();
      this.inFlight = false;
    }
  }

  async cancel(): Promise<void> {
    if (this.connId != null && this.sessionId != null) {
      await this.core("cancel", { connId: this.connId, sessionId: this.sessionId }).catch(() => {});
    }
  }

  dispose(): void {
    this.drop();
  }
}
