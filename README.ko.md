# soksak-plugin-mascot

soksak 캐릭터 표현 엔진 — 로컬 신경 음성을 가진 Live2D 마스코트. **자체 뷰 없음**: 전 기능이 커맨드라서 다른 플러그인(활동로그 낭독기, 대화 UI)이 캐릭터를 구동한다.

English: [README.md](README.md)

## 제공 기능

- 클릭 통과 화면 마스코트 오버레이(엔진의 유일한 표면)에 Live2D Cubism 3+ 렌더링
- 로컬 신경 TTS 사이드카([soksak-sidecar-speech-sherpa](https://github.com/soksak-ai/soksak-sidecar-speech-sherpa): Supertonic/VITS/Kokoro) — 갭리스 PCM 스트리밍, OS 음성 폴백, 실측 진폭 립싱크
- 감정 태그(`[joy]` …)로 표정 전환, Supertonic 3 인라인 태그(`<laugh>` `<breath>` `<sigh>`)는 발성으로 렌더(텍스트 표면에선 숨김)
- 모션(`motion.play`), 모델별 감정→표정 매핑, 설정으로 모델/목소리 라이브 교체

## 낭독 스펙 (MESSAGE-PROTOCOL tts)

`say`/`stop` 커맨드 스펙은 `tts: false` — 낭독 엔진 자신의 실행 기록은 활동로그 소비자가 절대 읽지 않는다(무한 전파를 끊는 유일한 차단점).

## 커맨드

전체 주소: `plugin.soksak-plugin-mascot.<이름>`.

| 커맨드 | 설명 |
| --- | --- |
| `ping` / `state` | 확인 / 전체 상태(probe/png/voices 진단) |
| `say {text}` | 발화(문장 파이프라인, `[emotion]`/`<laugh>` 반영) — spec tts:false |
| `stop` | 발화 중단 — spec tts:false |
| `cubism.install {accept}` | 동의 + Cubism Core 다운로드(프로프라이어터리, 미동봉) |
| `model.list` / `model.load {path}` | `modelsDir`(기본 `<플러그인>/models`) 캐릭터 |
| `expression.list` / `expression.set {name}` / `emotion.map {map}` | 표정 |
| `motion.play {group?, index?}` | 모션 재생 |
| `mascot.toggle {on?}` | 마스코트 표시/숨김 |
| `tts.toggle {on?}` | 음성 켬/끔 |

## 온보딩 (뷰 없음 — 커맨드로만)

1. Live2D 라이선스 확인 후 `cubism.install {"accept":true}`
2. Cubism 3+ 모델 폴더를 `models/`에 두고(미동봉 — 직접 조달) `model.load` 또는 `modelPath` 설정
3. `mascot.toggle {"on":true}` → 캐릭터 등장, `say`로 발화

## 라이선스

Cubism Core·모델은 커밋/번들 금지(`npm run license-gate` 강제). 파이프라인 설계는 MIT Open-LLM-VTuber 참고, 코드 카피 없음.
