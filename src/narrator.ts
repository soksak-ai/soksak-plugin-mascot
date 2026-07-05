// 활동 나레이터 — 창-로컬 코어 이벤트(터미널 명령·AI 턴)를 받아 사이드바 로그로 쌓고,
// 캐릭터가 짧게 읽어준다. 대화 턴(LLM)과 달리 지연 0 — 이벤트를 템플릿 문장으로 즉시 발화.
// 발화 중 새 이벤트는 텍스트로만 쌓는다(나레이션 홍수 방지 — 최신 우선, 밀린 낭독 없음).
import type { Disposable, HostApp } from "@/types";

export interface ActivityEntry {
  ts: number; // epoch ms
  kind: "terminal.start" | "terminal.done" | "turn.ended";
  text: string; // 표시용(로그 리스트)
  speak: string | null; // 낭독용(null = 표시만)
}

const MAX_ENTRIES = 80;

function shortCmd(line: string | undefined): string {
  const s = (line ?? "").trim().split("\n")[0];
  return s.length > 48 ? s.slice(0, 45) + "…" : s;
}

export class ActivityNarrator {
  private entries: ActivityEntry[] = [];
  private listeners = new Set<() => void>();
  private subs: Disposable[] = [];

  constructor(
    private app: HostApp,
    private opts: {
      lang(): string;
      narrate(): boolean; // 설정 activityNarrate
      speak(text: string): void; // 엔진 발화(사용 중이면 내부 큐 규칙 적용)
      speaking(): boolean;
    },
  ) {}

  start(): void {
    const on = this.app.events?.on;
    if (!on) return;
    const ko = this.opts.lang().startsWith("ko");
    this.subs.push(
      on("command.started", (p: any) => {
        const cmd = shortCmd(p?.commandLine);
        if (!cmd) return;
        this.push({
          kind: "terminal.start",
          text: ko ? `실행: ${cmd}` : `run: ${cmd}`,
          speak: null, // 시작은 낭독하지 않는다(끝났을 때만 — 소음 절반)
        });
      }),
      on("command.finished", (p: any) => {
        const code = typeof p?.exitCode === "number" ? p.exitCode : null;
        const okKo = code === 0 || code == null ? "터미널 명령이 끝났어요." : `명령이 실패했어요. 코드 ${code}.`;
        const okEn = code === 0 || code == null ? "A terminal command finished." : `A command failed with code ${code}.`;
        this.push({
          kind: "terminal.done",
          text: ko ? `종료(${code ?? "?"})` : `exit(${code ?? "?"})`,
          speak: ko ? okKo : okEn,
        });
      }),
      on("turn.ended", (p: any) => {
        const agent = typeof p?.agentKind === "string" && p.agentKind ? p.agentKind : null;
        this.push({
          kind: "turn.ended",
          text: ko ? `${agent ?? "AI"} 턴 종료` : `${agent ?? "AI"} turn ended`,
          speak: ko ? `${agent ?? "에이전트"} 턴이 끝났어요.` : `The ${agent ?? "agent"} turn finished.`,
        });
      }),
    );
  }

  private push(e: Omit<ActivityEntry, "ts">): void {
    const entry: ActivityEntry = { ts: Date.now(), ...e };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    // 낭독 — 켜져 있고, 지금 말하는 중이 아닐 때만(밀린 이벤트를 몰아 읽지 않는다)
    if (entry.speak && this.opts.narrate() && !this.opts.speaking()) {
      this.opts.speak(entry.speak);
    }
    for (const fn of this.listeners) fn();
  }

  list(): readonly ActivityEntry[] {
    return this.entries;
  }

  onChange(fn: () => void): Disposable {
    this.listeners.add(fn);
    return { dispose: () => this.listeners.delete(fn) };
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.subs = [];
    this.listeners.clear();
  }
}
