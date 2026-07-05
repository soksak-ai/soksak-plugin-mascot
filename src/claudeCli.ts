// claude -p 직행 백엔드 — ACP 하니스를 우회하는 "즉답" 경로, 프로세스 상주형.
// claude -p --input-format stream-json 으로 한 프로세스를 살려두고 턴마다 user 메시지 줄을
// 흘려넣는다 — 턴별 CLI 부팅(~1.5초)이 사라진다. --setting-sources "" = 훅·플러그인 차단
// (OAuth 유지 — --bare 는 키체인도 스킵해 불가). stdin 은 계속 열어둔다(입력 채널).
// 프로세스가 죽으면 result 의 session_id 로 --resume 재기동(대화 연속성 유지).
// 페르소나는 --system-prompt 로 정체성 자체를 교체한다 — 유저 메시지로 주면 "나는 Claude Code"
// 라며 역할을 거부한다. cwd 도 $HOME 으로 — 프로젝트 cwd 면 코딩 어시스턴트 맥락이 스민다.
import type { Disposable, HostApp } from "@/types";
import type { TurnResult } from "@/acp";

interface TurnSink {
  onDelta(t: string): void;
  finish(r: { text: string; deltas: number; firstDeltaMs: number | null; lastDeltaMs: number | null }): void;
  fail(e: Error): void;
  t0: number;
  deltas: number;
  firstDeltaMs: number | null;
  lastDeltaMs: number | null;
  streamed: string;
  finalText: string;
}

export class ClaudeCliChat {
  private handle: number | null = null;
  private spawnedModel = "";
  private buf = "";
  private subs: Disposable[] = [];
  private sessionId: string | null = null;
  private systemPrompt = "";
  private turn: TurnSink | null = null;

  constructor(
    private app: HostApp,
    private model: () => string, // "" → haiku
  ) {}

  connected(): boolean {
    return this.handle != null;
  }

  busy(): boolean {
    return this.turn != null;
  }

  private effModel(): string {
    return this.model().trim() || "haiku";
  }

  private teardown(): void {
    for (const s of this.subs) s.dispose();
    this.subs = [];
    this.handle = null;
    this.buf = "";
  }

  private async ensureProc(): Promise<void> {
    const proc = this.app.process;
    if (!proc) throw new Error("process permission unavailable");
    // 모델 설정이 바뀌면 재기동(--resume 으로 대화는 잇는다)
    if (this.handle != null && this.spawnedModel !== this.effModel()) {
      const h = this.handle;
      this.teardown();
      void proc.kill(h).catch(() => {});
    }
    if (this.handle != null) return;

    const args = [
      "-p",
      ...(this.systemPrompt ? ["--system-prompt", this.systemPrompt] : []),
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--setting-sources",
      "",
      "--model",
      this.effModel(),
      ...(this.sessionId ? ["--resume", this.sessionId] : []),
    ];
    // GUI 앱은 로그인셸 PATH 미상속 — sh -lc exec 랩(acp-core 선례). CLAUDECODE 제거 = 중첩 세션 가드.
    const handle = await proc.spawn(
      "/bin/sh",
      ["-lc", 'cd "$HOME" 2>/dev/null; exec claude "$@"', "claude", ...args],
      { envRemove: ["CLAUDECODE"] },
    );
    this.handle = handle;
    this.spawnedModel = this.effModel();
    this.subs.push(
      proc.onData(handle, (bytes) => this.feed(bytes)),
      proc.onExit(handle, (code) => {
        const t = this.turn;
        this.turn = null;
        this.teardown();
        t?.fail(new Error(`claude -p exited (${code})`));
      }),
    );
  }

  private feed(bytes: Uint8Array): void {
    this.buf += new TextDecoder().decode(bytes);
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let d: any;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof d.session_id === "string") this.sessionId = d.session_id;
      const t = this.turn;
      if (!t) continue;
      if (d.type === "stream_event" && d.event?.type === "content_block_delta") {
        const txt: string = d.event.delta?.text ?? "";
        if (txt) {
          t.deltas++;
          const ms = Math.round(performance.now() - t.t0);
          if (t.firstDeltaMs == null) t.firstDeltaMs = ms;
          t.lastDeltaMs = ms;
          t.streamed += txt;
          t.onDelta(txt);
        }
      } else if (d.type === "result") {
        if (d.subtype === "success") t.finalText = String(d.result ?? "");
        this.turn = null;
        t.finish({
          text: (t.finalText || t.streamed).trim(),
          deltas: t.deltas,
          firstDeltaMs: t.firstDeltaMs,
          lastDeltaMs: t.lastDeltaMs,
        });
      }
    }
  }

  async ask(text: string, preamble: string, onDelta: (t: string) => void): Promise<TurnResult> {
    if (this.turn) throw new Error("turn already in flight");
    this.systemPrompt = preamble.trim();
    await this.ensureProc();
    const proc = this.app.process!;
    const body = text;

    return new Promise<TurnResult>((resolve, reject) => {
      this.turn = {
        onDelta,
        finish: (r) => {
          resolve({
            text: r.text,
            stopReason: undefined,
            stream: { deltas: r.deltas, firstDeltaMs: r.firstDeltaMs, lastDeltaMs: r.lastDeltaMs },
          });
        },
        fail: reject,
        t0: performance.now(),
        deltas: 0,
        firstDeltaMs: null,
        lastDeltaMs: null,
        streamed: "",
        finalText: "",
      };
      const msg = {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: body }] },
      };
      void proc.write(this.handle!, JSON.stringify(msg) + "\n").catch((e) => {
        const t = this.turn;
        this.turn = null;
        t?.fail(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  /** 진행 중 턴 중단 — 상주 프로세스를 죽인다(다음 턴에 --resume 재기동, 대화 유지). */
  async cancel(): Promise<void> {
    if (this.handle != null) {
      const h = this.handle;
      const t = this.turn;
      this.turn = null;
      this.teardown();
      await this.app.process?.kill(h).catch(() => {});
      t?.fail(new Error("cancelled"));
    }
  }

  dispose(): void {
    void this.cancel();
    this.sessionId = null;
  }
}
