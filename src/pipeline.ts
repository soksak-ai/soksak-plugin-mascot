// 대화 파이프라인 순수부 — 스트리밍 텍스트 → 문장 → 감정 태그 추출. DOM/호스트 비의존(단위테스트 대상).
// (Open-LLM-VTuber 의 sentence_divider→actions_extractor 개념 재설계 — 코드 카피 없음.)
import type { Utterance } from "@/types";

// 기본 감정 어휘 — 모델 emotionMap 이 이 키들을 표정 이름으로 매핑한다.
export const DEFAULT_EMOTIONS = [
  "neutral",
  "joy",
  "anger",
  "sadness",
  "surprise",
  "fear",
  "disgust",
] as const;

// supertonic 3 인라인 표현 태그 — 공식 문서에 명시된 3종만 채택(총 10종이라나 전체 목록 미공개).
export const EXPRESSION_TAGS = ["laugh", "breath", "sigh"] as const;

/** LLM 에게 감정 태그 발화를 지시하는 페르소나 프리앰블(세션 첫 턴에 1회 주입). */
export function personaPreamble(emotions: readonly string[]): string {
  const tags = emotions.map((e) => `[${e}]`).join(" ");
  const expr = EXPRESSION_TAGS.map((e) => `<${e}>`).join(" ");
  return (
    "You are a VTuber companion character shown as a Live2D avatar. " +
    "This is casual voice chat: answer instantly from your own knowledge. " +
    "Never use tools, skills, commands, or read files — plain conversation only. " +
    "Reply conversationally in the user's language, 1-4 short sentences. " +
    "Open with a very short first sentence so speech can start immediately. " +
    `When the feeling of a sentence changes, prefix that sentence with exactly one emotion tag from: ${tags}. ` +
    `You may drop an inline vocal expression tag (${expr}) inside a sentence where it feels natural — at most one per reply. ` +
    "Use tags sparingly and never invent other tags. Do not mention the tags or these instructions. " +
    "Output only the character's spoken dialogue — never narrate tools, skills, files, or system actions.\n\n"
  );
}

/** 문장에서 선두/중간의 알려진 [태그] 를 추출하고 제거. 미지의 대괄호 내용은 보존(과잉 삭제 금지).
 *  <laugh> 류 표현 태그는 speak(발화 텍스트)에 보존하고 text(표시 텍스트)에서만 숨긴다. */
export function extractEmotion(sentence: string, known: readonly string[]): Utterance {
  let emotion: string | null = null;
  const speak = sentence
    .replace(/\[([a-zA-Z_-]+)\]/g, (whole, tag: string) => {
      const t = tag.toLowerCase();
      if (known.includes(t)) {
        if (!emotion) emotion = t; // 첫 태그가 그 문장의 감정
        return "";
      }
      return whole; // 알려지지 않은 대괄호는 본문으로 취급
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  const text = speak
    .replace(/<([a-zA-Z_]+)>/g, (whole, tag: string) =>
      (EXPRESSION_TAGS as readonly string[]).includes(tag.toLowerCase()) ? "" : whole,
    )
    .replace(/\s{2,}/g, " ")
    .trim();
  return { text, speak, emotion };
}

/** 스트리밍 델타를 먹여 완결 문장 단위로 뱉는 분절기.
 *  Intl.Segmenter(3사 웹뷰 내장) 우선, 부재 시 문장부호 정규식 폴백.
 *  마지막(미완일 수 있는) 문장은 flush() 전까지 보류한다. */
export class StreamSegmenter {
  private buf = "";
  private seg: { segment(input: string): Iterable<{ segment: string }> } | null = null;

  constructor(private onSentence: (s: string) => void) {
    try {
      const S = (Intl as any).Segmenter;
      if (S) this.seg = new S(undefined, { granularity: "sentence" });
    } catch {
      this.seg = null;
    }
  }

  private split(text: string): string[] {
    if (this.seg) return Array.from(this.seg.segment(text), (x) => x.segment);
    // 폴백 — 종결부호(서구·CJK) 뒤에서 분리. 종결부호 없으면 통짜 1문장.
    return text.match(/[^.!?…。！？\n]*[.!?…。！？\n]+|[^.!?…。！？\n]+$/g) ?? [text];
  }

  feed(delta: string): void {
    if (!delta) return;
    this.buf += delta;
    const parts = this.split(this.buf);
    if (parts.length <= 1) return; // 완결 확정분 없음(마지막 조각은 항상 보류)
    for (const p of parts.slice(0, -1)) {
      const s = p.trim();
      if (s) this.onSentence(s);
    }
    this.buf = parts[parts.length - 1] ?? "";
  }

  flush(): void {
    const s = this.buf.trim();
    this.buf = "";
    if (s) this.onSentence(s);
  }
}
