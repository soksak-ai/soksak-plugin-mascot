// 파이프라인 순수부 단위 테스트 — 문장 분절(스트리밍 보류 규칙)과 감정 태그 추출.
import { describe, expect, it } from "vitest";
import { DEFAULT_EMOTIONS, StreamSegmenter, extractEmotion, personaPreamble } from "./pipeline";

describe("extractEmotion", () => {
  it("알려진 태그를 추출하고 본문에서 제거한다", () => {
    const u = extractEmotion("[joy] 반가워요!", DEFAULT_EMOTIONS);
    expect(u.emotion).toBe("joy");
    expect(u.text).toBe("반가워요!");
    expect(u.speak).toBe("반가워요!");
  });

  it("첫 태그가 감정이 되고 나머지 알려진 태그도 제거된다", () => {
    const u = extractEmotion("[surprise] 정말? [joy] 대단해!", DEFAULT_EMOTIONS);
    expect(u.emotion).toBe("surprise");
    expect(u.text).toBe("정말? 대단해!");
  });

  it("모르는 대괄호 내용은 본문으로 보존한다(과잉 삭제 금지)", () => {
    const u = extractEmotion("[TODO] 항목을 보세요 [joy]", DEFAULT_EMOTIONS);
    expect(u.emotion).toBe("joy");
    expect(u.text).toBe("[TODO] 항목을 보세요");
  });

  it("태그 없음 = emotion null", () => {
    const u = extractEmotion("그냥 문장.", DEFAULT_EMOTIONS);
    expect(u.emotion).toBeNull();
    expect(u.text).toBe("그냥 문장.");
  });
});

describe("StreamSegmenter", () => {
  function collect(): { out: string[]; seg: StreamSegmenter } {
    const out: string[] = [];
    const seg = new StreamSegmenter((s) => out.push(s));
    return { out, seg };
  }

  it("완결 문장만 내보내고 마지막 조각은 flush 까지 보류한다", () => {
    const { out, seg } = collect();
    seg.feed("Hello there. How are");
    expect(out).toEqual(["Hello there."]);
    seg.feed(" you? I am fi");
    expect(out).toEqual(["Hello there.", "How are you?"]);
    seg.flush();
    expect(out).toEqual(["Hello there.", "How are you?", "I am fi"]);
  });

  it("CJK 종결부호도 분리한다", () => {
    const { out, seg } = collect();
    seg.feed("안녕하세요! 오늘 날씨가 좋네요。남은 조각");
    seg.flush();
    expect(out.length).toBe(3);
    expect(out[0]).toContain("안녕하세요");
  });

  it("빈 델타/공백만은 무시한다", () => {
    const { out, seg } = collect();
    seg.feed("");
    seg.feed("   ");
    seg.flush();
    expect(out).toEqual([]);
  });
});

describe("표현 태그 분리", () => {
  it("<laugh> 는 표시에서 숨기고 발화에 보존한다", () => {
    const u = extractEmotion("[joy] 정말요? <laugh> 대박!", DEFAULT_EMOTIONS);
    expect(u.emotion).toBe("joy");
    expect(u.text).toBe("정말요? 대박!");
    expect(u.speak).toBe("정말요? <laugh> 대박!");
  });
  it("미지의 <태그> 는 양쪽 다 보존한다", () => {
    const u = extractEmotion("코드에 <div> 태그를 쓰세요.", DEFAULT_EMOTIONS);
    expect(u.text).toBe("코드에 <div> 태그를 쓰세요.");
    expect(u.speak).toBe(u.text);
  });
});

describe("personaPreamble", () => {
  it("허용 태그 목록을 포함한다", () => {
    const p = personaPreamble(DEFAULT_EMOTIONS);
    for (const e of DEFAULT_EMOTIONS) expect(p).toContain(`[${e}]`);
  });
});
