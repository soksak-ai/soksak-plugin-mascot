// TTS seam — 기본은 speechSynthesis(OS 음성, 제로 설치 폴백). 사이드카(SidecarTts)가 설정되면 그쪽이 1차.
// 엔진 인터페이스는 문장 1개 발화 계약만 — 큐잉·감정 연동은 SpeechQueue 가 소유.
import type { Utterance } from "@/types";

export interface TtsEngine {
  available(): boolean;
  /** 한 문장 발화 — 끝나면 resolve. cancel() 시 조기 resolve 허용. */
  speak(text: string, lang: string): Promise<void>;
  cancel(): void;
}

// 로케일별 선호 보이스(캐릭터에 맞는 밝은 음색 우선) — voiceName 설정이 비었을 때의 기본값.
// OS 기본 보이스는 저음 내레이터인 경우가 많아 그대로 두면 캐릭터와 어긋난다.
const PREFERRED_VOICES: Record<string, string[]> = {
  ko: ["yuna", "유나", "sunhi", "heami"],
  en: ["samantha", "jenny", "aria", "zira"],
  ja: ["kyoko", "nanami", "o-ren"],
  zh: ["tingting", "xiaoxiao"],
};

/** OS 음성(speechSynthesis). Linux 등 음성팩 부재 시 available()=false → 자막만. */
export class SpeechSynthesisTts implements TtsEngine {
  constructor(private opts?: { voiceName?: () => string }) {}

  available(): boolean {
    return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
  }

  /** 가용 보이스 목록(설정 voiceName 고르기용). */
  listVoices(): Array<{ name: string; lang: string; default: boolean }> {
    if (!this.available()) return [];
    return speechSynthesis
      .getVoices()
      .map((v) => ({ name: v.name, lang: v.lang, default: v.default }));
  }

  // 같은 이름이 여러 품질로 설치될 수 있다(macOS: compact/enhanced/premium) — 항상 상위 품질 선택.
  private static quality(v: SpeechSynthesisVoice): number {
    const uri = (v.voiceURI ?? "").toLowerCase() + " " + v.name.toLowerCase();
    if (uri.includes("premium")) return 3;
    if (uri.includes("enhanced") || uri.includes("향상")) return 2;
    if (uri.includes("compact")) return 0;
    return 1;
  }
  private static best(cands: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    return cands.length
      ? cands.reduce((a, b) => (SpeechSynthesisTts.quality(b) > SpeechSynthesisTts.quality(a) ? b : a))
      : null;
  }

  private pickVoice(lang: string): SpeechSynthesisVoice | null {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;
    const lc = (s: string) => s.toLowerCase();
    // 1) 사용자 지정 voiceName(부분일치, 대소문자 무시)이 최우선 — 동명이면 상위 품질
    const wanted = lc(this.opts?.voiceName?.() ?? "").trim();
    if (wanted) {
      const hit = SpeechSynthesisTts.best(voices.filter((v) => lc(v.name).includes(wanted)));
      if (hit) return hit;
    }
    const base = lang.slice(0, 2).toLowerCase();
    const inLang = voices.filter(
      (v) => lc(v.lang ?? "").startsWith(lc(lang)) || lc(v.lang ?? "").startsWith(base),
    );
    // 2) 로케일 내 선호 음색 — 동명이면 상위 품질
    for (const pref of PREFERRED_VOICES[base] ?? []) {
      const hit = SpeechSynthesisTts.best(inLang.filter((v) => lc(v.name).includes(pref)));
      if (hit) return hit;
    }
    // 3) 로케일 일치 중 상위 품질
    return SpeechSynthesisTts.best(inLang);
  }

  /** 음성 목록은 비동기 적재(voiceschanged) — 첫 발화가 무음이 되지 않게 최대 1초 대기. */
  private voicesReady(): Promise<void> {
    if (speechSynthesis.getVoices().length > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        speechSynthesis.removeEventListener("voiceschanged", done);
        resolve();
      };
      speechSynthesis.addEventListener("voiceschanged", done);
      setTimeout(done, 1000);
    });
  }

  /** utterance 1회 발화 — 종료/에러/워치독 중 먼저 오는 것으로 resolve(에러 여부 반환). */
  private speakOnce(text: string, lang: string, voice: SpeechSynthesisVoice | null): Promise<boolean> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? lang;
      u.rate = 1.05;
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        resolve(ok);
      };
      // 워치독 — 특정 보이스가 end/error 어느 쪽도 안 내면 큐가 영구 잠긴다(발화 시간 상한으로 방어).
      const watchdog = setTimeout(
        () => {
          try {
            speechSynthesis.cancel();
          } catch {
            /* 무시 */
          }
          settle(false);
        },
        Math.max(5000, text.length * 220),
      );
      u.onend = () => settle(true);
      u.onerror = () => settle(false);
      speechSynthesis.speak(u);
    });
  }

  async speak(text: string, lang: string): Promise<void> {
    await this.voicesReady();
    const voice = this.pickVoice(lang);
    const ok = await this.speakOnce(text, lang, voice);
    if (!ok && voice) {
      // 지정/선호 보이스 실패(잘못된 voiceName 등) — 로케일 기본으로 1회 폴백(무음 근치).
      console.warn(`[mascot] voice "${voice.name}" failed — falling back to locale default`);
      await this.speakOnce(text, lang, null);
    }
  }

  cancel(): void {
    try {
      speechSynthesis.cancel();
    } catch {
      /* 미지원 환경 — 무시 */
    }
  }
}

export interface SpeakEvents {
  /** 문장 발화 시작(자막 표시 + 표정 전환 + 입모양 시작 지점). */
  onStart(u: Utterance): void;
  /** 문장 발화 종료. last=큐의 마지막 문장이었는지. */
  onEnd(u: Utterance, last: boolean): void;
}

/** 문장 발화 큐 — 순서 보장, 감정/자막 이벤트 발행. TTS 꺼짐/불가 시엔 자막 페이싱만 수행. */
export class SpeechQueue {
  private q: Utterance[] = [];
  private running = false;
  private cancelled = false;
  speaking = false;

  constructor(
    private engine: TtsEngine,
    private events: SpeakEvents,
    private opts: { enabled(): boolean; lang(): string },
  ) {}

  enqueue(u: Utterance): void {
    if (!u.speak) return;
    this.q.push(u);
    void this.pump();
  }

  /** 현재 발화 + 대기열 전부 폐기. */
  cancel(): void {
    this.q = [];
    this.cancelled = true;
    this.engine.cancel();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    try {
      while (this.q.length > 0) {
        const u = this.q.shift()!;
        this.speaking = true;
        this.events.onStart(u);
        if (this.opts.enabled() && this.engine.available()) {
          await this.engine.speak(u.speak, this.opts.lang());
        } else {
          // 음성 없음 — 자막 리듬만(읽기 속도 근사: 글자당 55ms, 0.8~4.5s 클램프)
          const ms = Math.min(4500, Math.max(800, u.text.length * 55));
          await new Promise((r) => setTimeout(r, ms));
        }
        this.speaking = false;
        this.events.onEnd(u, this.q.length === 0);
        if (this.cancelled) break;
      }
    } finally {
      this.speaking = false;
      this.running = false;
    }
  }
}
