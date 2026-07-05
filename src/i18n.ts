// 사람 표면 문자열 — 해소({en,ko}) 축. LLM 발화/발견(커맨드 triggers)은 커맨드 스펙 쪽 합성 축.
export type Lang = "en" | "ko";

const STRINGS = {
  setupTitle: { en: "Setup", ko: "설정" },
  cubismNotice: {
    en: "Rendering requires the Live2D Cubism Core runtime (proprietary, © Live2D Inc.). It is downloaded from the official Live2D CDN and cached locally — it is not bundled with this plugin. By continuing you accept the Live2D Proprietary Software License Agreement.",
    ko: "렌더링에는 Live2D Cubism Core 런타임(프로프라이어터리, © Live2D Inc.)이 필요합니다. 이 플러그인에 동봉되지 않으며, 동의 시 Live2D 공식 CDN에서 내려받아 로컬에 캐시합니다. 계속하면 Live2D 독점 소프트웨어 라이선스에 동의하는 것입니다."
  },
  cubismAccept: { en: "Accept & download", ko: "동의하고 내려받기" },
  cubismLicenseLink: { en: "License terms", ko: "라이선스 약관" },
  cubismReady: { en: "Cubism Core ready", ko: "Cubism Core 준비됨" },
  modelPathLabel: {
    en: "Live2D model path (.model3.json)",
    ko: "Live2D 모델 경로 (.model3.json)"
  },
  modelLoad: { en: "Load model", ko: "모델 로드" },
  modelNone: {
    en: "No model loaded. Point to a .model3.json you own — sample models are not bundled (per-character license terms).",
    ko: "로드된 모델이 없습니다. 보유한 .model3.json 경로를 지정하세요 — 샘플 모델은 동봉하지 않습니다(캐릭터별 약관)."
  },
  chatPlaceholder: { en: "Talk to the character…", ko: "캐릭터에게 말 걸기…" },
  send: { en: "Send", ko: "전송" },
  thinking: { en: "Thinking…", ko: "생각 중…" },
  sidebarHolds: {
    en: "Avatar is in the activity sidebar — switch its display to text-only to bring it back.",
    ko: "아바타가 활동 사이드바에 있습니다 — 표시를 텍스트 전용으로 바꾸면 여기로 돌아옵니다."
  },
  mascotHolds: {
    en: "Avatar is in mascot mode — toggle mascot off to bring it back here.",
    ko: "아바타가 마스코트 모드에 있습니다 — 마스코트를 끄면 여기로 돌아옵니다."
  },
  ttsOn: { en: "Voice on", ko: "음성 켬" },
  ttsOff: { en: "Voice off", ko: "음성 끔" },
  mascotOn: { en: "Mascot on", ko: "마스코트 켬" },
  mascotOff: { en: "Mascot off", ko: "마스코트 끔" },
  errPrefix: { en: "Error", ko: "오류" },
  ttsUnavailable: {
    en: "Speech synthesis is unavailable on this system — subtitles only.",
    ko: "이 시스템에는 음성 합성이 없습니다 — 자막만 표시합니다."
  }
} as const;

export type StrKey = keyof typeof STRINGS;

export function makeT(lang: string): (key: StrKey) => string {
  const l: Lang = lang.startsWith("ko") ? "ko" : "en";
  return (key) => STRINGS[key][l];
}
