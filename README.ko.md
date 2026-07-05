# soksak-plugin-vtuber

soksak용 Live2D 아바타 컴패니언. 로컬 AI 에이전트와 대화하면 아바타가 자연스러운 로컬 음성·실측 립싱크·표정·자막으로 답한다. 콘텐츠 패널 뷰와 클릭 통과 화면 마스코트 오버레이 두 형태로 동작한다.

English: [README.md](README.md)

## 하는 일

- Live2D Cubism 3+ 모델(`.model3.json`)을 WebGL(pixi.js + pixi-live2d-display)로 패널 뷰 또는 마스코트 오버레이에 렌더링한다.
- 대화 백엔드: 상주 `claude -p` 프로세스(`claude-bare`, 첫 토큰 최속) 또는 agents-acp 런타임(Claude/Codex/Gemini). 턴 간 대화 연속성 유지.
- 음성: 로컬 신경 TTS 사이드카([soksak-sidecar-speech-sherpa](https://github.com/soksak-ai/soksak-sidecar-speech-sherpa) — Supertonic/VITS/Kokoro 엔진)가 PCM 청크를 Web Audio 로 스트리밍. OS 음성(`speechSynthesis`)은 제로 설치 폴백.
- 립싱크는 실측: AnalyserNode 가 재생 진폭을 추적해 모델의 `LipSync` 그룹 파라미터를 매 프레임 구동한다.
- 감정 태그(`[joy]`, `[sadness]`, …)는 표정을 바꾸고, Supertonic 3 표현 태그(`<laugh>`, `<breath>`, `<sigh>`)는 실제 웃음·숨소리로 발화되며 자막에서는 숨겨진다.
- 모든 기능이 커맨드로 노출된다 — UI와 CLI가 같은 엔진 오퍼레이션을 부른다.

## 설정

| 키 | 의미 |
| --- | --- |
| `modelPath` | 캐릭터 `.model3.json` (라이브 교체) |
| `agent` / `agentModel` | 대화 백엔드·모델 id |
| `speechSidecarBin` / `speechModelDir` / `speechEngine` | 로컬 TTS 사이드카(바이너리·모델 디렉토리·`vits`/`kokoro`/`supertonic`) |
| `speechSpeakerId` / `speechSpeed` | 목소리 스타일(0부터)·속도 |
| `voiceName` | OS 음성 폴백 선택 |

## 요구사항과 라이선스

- **Live2D Cubism Core는 동봉하지 않는다.** 프로프라이어터리(© Live2D Inc.)이므로 첫 사용 시 동의를 받고 Live2D 공식 CDN에서 내려받아 로컬에 캐시한다. Cubism SDK를 쓰는 앱의 발행은 매출 규모에 따라 Live2D 출판 라이선스가 필요할 수 있다.
- **모델(아바타·음성)은 동봉하지 않는다.** 보유했거나 사용 허락된 자산을 지정하라. Cubism 2(`.moc`)는 지원하지 않는다.
- 파이프라인 설계는 MIT 라이선스인 [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)를 참고했다. 코드 카피는 없다.
- `npm run license-gate`가 프로프라이어터리 산출물(Cubism Core, `.moc3`, `.model3.json`)의 커밋/번들 부재를 단언한다.

## 커맨드

커맨드 이름은 플러그인 상대 이름이다. 전체 주소는 `plugin.soksak-plugin-vtuber.<이름>` (예: `sok plugin.soksak-plugin-vtuber.chat '{"text":"안녕"}'`).

| 커맨드 | 설명 |
| --- | --- |
| `ping` | 적재/버전 확인 |
| `state` | 상태(`probe`/`png`/`voices` 플래그로 진단 추가) |
| `chat {text}` | 에이전트 한 턴 — 발화+자막(타이밍 반환) |
| `say {text}` | LLM 없이 로컬 발화(`[emotion]`·`<laugh>` 태그 반영) |
| `stop` | 발화 중단, 턴 취소 |
| `cubism.install {accept}` | 동의 + Cubism Core 다운로드 |
| `model.load {path}` | `.model3.json` 로드 |
| `expression.list` / `expression.set {name}` | 표정 |
| `emotion.map {map}` | 감정→표정 매핑 |
| `mascot.toggle {on?}` | 화면 마스코트 |
| `tts.toggle {on?}` | 음성 출력 |

## 개발

```sh
npm install
npm run build        # esbuild → main.js
npm run typecheck
npm test             # 파이프라인 단위 테스트
npm run license-gate
```

dev 플러그인 설치: 이 repo를 `~/.soksak/plugins/soksak-plugin-vtuber`에 체크아웃하고 `.soksak.json`에 `{"version":"dev"}`를 두면 플러그인 리로드 시 적재된다.
