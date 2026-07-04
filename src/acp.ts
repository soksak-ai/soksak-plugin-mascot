// acp-core 래퍼 — 커맨드(connect/session-new/prompt/cancel/disconnect) + acp.update.<connId> 버스 스트림.
// 연결은 게으르게 1개 유지(대화 세션 연속성), 실패 시 다음 턴에 재연결. permission="deny" —
// 컴패니언 대화는 도구/디스크 권한이 필요 없다(부수효과 0 대화 전용).
import type { Disposable, HostApp } from "@/types";

const CORE = "plugin.soksak-plugin-agents-acp.";

export interface TurnResult {
  text: string;
  stopReason?: string;
}

export class AcpChat {
  private connId: number | null = null;
  private sessionId: string | null = null;
  private preambleSent = false;
  private inFlight = false;

  constructor(
    private app: HostApp,
    private agent: () => string, // preset: claude/codex/gemini
  ) {}

  connected(): boolean {
    return this.connId != null && this.sessionId != null;
  }

  busy(): boolean {
    return this.inFlight;
  }

  private core(name: string, params?: Record<string, unknown>): Promise<any> {
    return this.app.commands.execute(CORE + name, params ?? {});
  }

  private async ensure(): Promise<{ connId: number; sessionId: string }> {
    if (this.connId != null && this.sessionId != null)
      return { connId: this.connId, sessionId: this.sessionId };
    const c = await this.core("connect", { agent: this.agent(), permission: "deny" });
    if (!c?.ok) throw new Error(String(c?.error ?? c?.message ?? "acp connect failed"));
    const s = await this.core("session-new", { connId: c.connId });
    if (!s?.ok) {
      await this.core("disconnect", { connId: c.connId }).catch(() => {});
      throw new Error(String(s?.error ?? s?.message ?? "acp session failed"));
    }
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
      let streamed = "";
      off = this.app.bus.on(`acp.update.${connId}`, (evt: any) => {
        const u = evt?.update;
        if (!u || u.sessionUpdate !== "agent_message_chunk") return;
        const t: string = u.content?.text ?? "";
        if (t !== "" && t === streamed) return; // 최종 완결 재전송 skip(코어 dedup 계약과 동일 규칙)
        streamed += t;
        if (t) onDelta(t);
      });
      const body = this.preambleSent ? text : preamble + text;
      let r: any;
      try {
        r = await this.core("prompt", { connId, sessionId, text: body });
      } catch (e) {
        this.drop(); // 연결 사망 추정 — 다음 턴에 재연결
        throw e;
      }
      if (!r?.ok) {
        this.drop();
        throw new Error(String(r?.error ?? r?.message ?? "acp prompt failed"));
      }
      this.preambleSent = true;
      const final = (r.text ?? "").trim() || streamed.trim();
      return { text: final, stopReason: r.stopReason };
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
