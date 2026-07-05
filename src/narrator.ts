// 활동 나레이터 — 창-로컬 코어 이벤트(터미널 명령·AI 턴)를 받아 사이드바 로그로 쌓고,
// 캐릭터가 짧게 읽어준다. 대화 턴(LLM)과 달리 지연 0 — 이벤트를 템플릿 문장으로 즉시 발화.
// 발화 중 새 이벤트는 텍스트로만 쌓는다(나레이션 홍수 방지 — 최신 우선, 밀린 낭독 없음).
import type { Disposable, HostApp } from "@/types";

export interface ActivityEntry {
  ts: number; // epoch ms
  kind: "terminal.start" | "terminal.done" | "turn.ended";
  text: string; // 표시용(로그 리스트)
  /** 낭독 허용 — 생략=true(기본). AI 발화 계열만 명시적 false(자기 발화 되먹임 금지선). */
  tts: boolean;
  speak?: string; // 낭독 문장 — 없으면 읽을 것이 없다(표시 전용)
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
        // speak 없음 = 표시 전용(시작까지 읽으면 소음 2배 — 끝났을 때만 낭독)
        this.push({
          kind: "terminal.start",
          text: ko ? `실행: ${cmd}` : `run: ${cmd}`,
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
        // AI 발화 계열 — 로그엔 남기되 절대 낭독하지 않는다(tts:false).
        // 캐릭터 자신/다른 에이전트의 발화를 캐릭터가 되읽는 되먹임 방지.
        this.push({
          kind: "turn.ended",
          text: ko ? `${agent ?? "AI"} 턴 종료` : `${agent ?? "AI"} turn ended`,
          tts: false,
        });
      }),
    );
  }

  private push(e: Omit<ActivityEntry, "ts" | "tts"> & { tts?: boolean }): void {
    const entry: ActivityEntry = { ...e, ts: Date.now(), tts: e.tts !== false };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    // 낭독 — tts:true 이고, 켜져 있고, 지금 말하는 중이 아닐 때만(밀린 이벤트를 몰아 읽지 않는다)
    if (entry.tts && entry.speak && this.opts.narrate() && !this.opts.speaking()) {
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
