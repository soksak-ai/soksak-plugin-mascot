// TTS seam — M1=speechSynthesis(API 3사 균일, OS 음성팩만 상이), M2a=사이드카 WAV 로 교체되는 지점.
// 엔진 인터페이스는 문장 1개 발화 계약만 — 큐잉·감정 연동은 SpeechQueue 가 소유.
import type { Utterance } from "@/types";

export interface TtsEngine {
  available(): boolean;
  /** 한 문장 발화 — 끝나면 resolve. cancel() 시 조기 resolve 허용. */
  speak(text: string, lang: string): Promise<void>;
  cancel(): void;
}

/** OS 음성(speechSynthesis). Linux 등 음성팩 부재 시 available()=false → 자막만. */
export class SpeechSynthesisTts implements TtsEngine {
  available(): boolean {
    return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
  }

  private pickVoice(lang: string): SpeechSynthesisVoice | null {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;
    const base = lang.slice(0, 2).toLowerCase();
    return (
      voices.find((v) => v.lang?.toLowerCase().startsWith(lang.toLowerCase())) ??
      voices.find((v) => v.lang?.toLowerCase().startsWith(base)) ??
      null
    );
  }

  speak(text: string, lang: string): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = this.pickVoice(lang);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? lang;
      u.rate = 1.05;
      u.onend = () => resolve();
      u.onerror = () => resolve(); // 발화 실패는 파이프라인을 멈추지 않는다(자막은 이미 표시)
      speechSynthesis.speak(u);
    });
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
    if (!u.text) return;
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
          await this.engine.speak(u.text, this.opts.lang());
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
