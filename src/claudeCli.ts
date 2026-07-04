// claude -p 직행 백엔드 — ACP 하니스를 우회하는 "즉답" 경로.
// claude -p --setting-sources "" (훅·플러그인·설정 차단, OAuth 유지) + --model haiku +
// stream-json 부분 델타로 첫 토큰 지연을 최소화한다(실측: ACP ~6s → ~2.5s).
// 연속성은 result 이벤트의 session_id 를 받아 다음 턴 --resume 으로 잇는다.
// cwd 는 $HOME — 프로젝트 CLAUDE.md 자동 발견으로 페르소나가 오염되지 않게.
import type { Disposable, HostApp } from "@/types";
import type { TurnResult } from "@/acp";

export class ClaudeCliChat {
  private sessionId: string | null = null;
  private preambleSent = false;
  private inFlight = false;
  private curHandle: number | null = null;

  constructor(
    private app: HostApp,
    private model: () => string, // "" → haiku
  ) {}

  connected(): boolean {
    return this.sessionId != null;
  }

  busy(): boolean {
    return this.inFlight;
  }

  async ask(text: string, preamble: string, onDelta: (t: string) => void): Promise<TurnResult> {
    if (this.inFlight) throw new Error("turn already in flight");
    const proc = this.app.process;
    if (!proc) throw new Error("process permission unavailable");
    this.inFlight = true;

    const body = this.preambleSent ? text : preamble + text;
    const model = this.model().trim() || "haiku";
    const args = [
      "-p",
      body,
      "--setting-sources",
      "",
      "--model",
      model,
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      ...(this.sessionId ? ["--resume", this.sessionId] : []),
    ];

    const t0 = performance.now();
    let deltas = 0;
    let firstDeltaMs: number | null = null;
    let lastDeltaMs: number | null = null;
    let streamed = "";
    let finalText = "";
    let buf = "";
    const subs: Disposable[] = [];

    try {
      // GUI 앱은 로그인셸 PATH 미상속 — sh -lc exec 랩(acp-core 선례). CLAUDECODE 제거 = 중첩 세션 가드.
      const handle = await proc.spawn(
        "/bin/sh",
        ["-lc", 'exec claude "$@"', "claude", ...args],
        { cwd: undefined, envRemove: ["CLAUDECODE"] },
      );
      this.curHandle = handle;
      // stdin 즉시 EOF — claude -p 는 파이프 stdin 이 열려 있으면 추가 입력을 기다린다(수 초 손실).
      await proc.closeStdin(handle).catch(() => {});

      const done = new Promise<number>((resolve) => {
        subs.push(
          proc.onData(handle, (bytes) => {
            buf += new TextDecoder().decode(bytes);
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              let d: any;
              try {
                d = JSON.parse(line);
              } catch {
                continue;
              }
              if (d.type === "stream_event" && d.event?.type === "content_block_delta") {
                const t: string = d.event.delta?.text ?? "";
                if (t) {
                  deltas++;
                  const ms = Math.round(performance.now() - t0);
                  if (firstDeltaMs == null) firstDeltaMs = ms;
                  lastDeltaMs = ms;
                  streamed += t;
                  onDelta(t);
                }
              } else if (d.type === "result") {
                if (typeof d.session_id === "string") this.sessionId = d.session_id;
                if (d.subtype === "success") finalText = String(d.result ?? "");
                else finalText = ""; // 오류 result — exit 코드로 판정
              }
            }
          }),
          proc.onExit(handle, (code) => resolve(code)),
        );
      });

      const code = await done;
      if (code !== 0 && !streamed && !finalText) {
        this.sessionId = null; // 재개 실패 가능성 — 다음 턴은 새 세션
        throw new Error(`claude -p exited ${code}`);
      }
      this.preambleSent = true;
      return {
        text: (finalText || streamed).trim(),
        stopReason: undefined,
        stream: { deltas, firstDeltaMs, lastDeltaMs },
      };
    } finally {
      for (const s of subs) s.dispose();
      this.curHandle = null;
      this.inFlight = false;
    }
  }

  async cancel(): Promise<void> {
    if (this.curHandle != null) {
      await this.app.process?.kill(this.curHandle).catch(() => {});
    }
  }

  dispose(): void {
    void this.cancel();
    this.sessionId = null;
    this.preambleSent = false;
  }
}
