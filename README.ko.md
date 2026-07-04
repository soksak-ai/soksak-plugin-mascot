# soksak-plugin-vtuber

soksak용 Live2D 아바타 컴패니언. 로컬 AI 에이전트와 대화하면 아바타가 표정·자막·음성으로 반응한다. 콘텐츠 패널 뷰와 클릭 통과 화면 마스코트 오버레이 두 형태로 동작한다.

English: [README.md](README.md)

## 하는 일

- Live2D Cubism 3+ 모델(`.model3.json`)을 WebGL(pixi.js + pixi-live2d-display)로 패널 뷰 또는 떠 있는 마스코트 오버레이에 렌더링한다.
- 대화 턴은 로컬 에이전트 런타임(`soksak-plugin-agents-acp`, Claude 프리셋)으로 실행한다. 이 플러그인은 API 키를 다루지 않는다.
- 응답을 문장 단위로 스트리밍: 각 문장을 자막으로 표시하고 OS 음성(`speechSynthesis`)으로 발화하며, 페르소나가 LLM에게 요구한 감정 태그(`[joy]`, `[anger]`, …)를 모델 표정으로 매핑한다.
- 발화 중 입은 결정적 파형의 의사 립싱크로 움직인다(M1). 실측 진폭 립싱크는 음성 사이드카 마일스톤에서 제공된다.
- 모든 기능이 커맨드(`vtuber.*`)로 노출된다 — UI와 CLI가 같은 엔진 오퍼레이션을 부른다.

## 요구사항과 라이선스

- **Live2D Cubism Core는 동봉하지 않는다.** 프로프라이어터리(© Live2D Inc.)이므로 첫 사용 시 동의를 받고 Live2D 공식 CDN에서 내려받아 로컬에 캐시한다. Cubism SDK를 쓰는 앱의 발행은 매출 규모에 따라 Live2D 출판 라이선스가 필요할 수 있다 — Live2D 약관 참조.
- **모델은 동봉하지 않는다.** Live2D 샘플 모델은 캐릭터별 약관이 있다. 보유했거나 사용 허락된 `.model3.json`을 지정하라. Cubism 2(`.moc`) 모델은 지원하지 않는다.
- 파이프라인 설계는 MIT 라이선스인 [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) 프로젝트를 참고했다. 코드 카피는 없다.
- `npm run license-gate`가 프로프라이어터리 산출물(Cubism Core, `.moc3`, `.model3.json`)이 repo나 번들에 없음을 단언한다.

## 음성 안내

`speechSynthesis`의 가용성과 음질은 OS에 따른다(macOS/Windows는 한국어·영어 음성 내장, 일부 Linux는 음성이 없을 수 있다 — 자막은 항상 동작). 음성은 `vtuber.tts.toggle`로 켜고 끈다.

## 커맨드

| 커맨드 | 설명 |
| --- | --- |
| `vtuber.ping` | 적재/버전 확인 |
| `vtuber.state` | 현재 상태(cubism/모델/표정/마스코트/음성/busy) |
| `vtuber.chat {text}` | 에이전트 한 턴 — 발화+자막 |
| `vtuber.say {text}` | LLM 없이 로컬 발화(`[emotion]` 태그 반영) |
| `vtuber.stop` | 발화 중단, 턴 취소 |
| `vtuber.cubism.install {accept}` | 동의 + Cubism Core 다운로드 |
| `vtuber.model.load {path}` | `.model3.json` 로드 |
| `vtuber.expression.list` | 모델 표정 + 감정 매핑 조회 |
| `vtuber.expression.set {name}` | 표정 또는 감정 적용 |
| `vtuber.emotion.map {map}` | 감정→표정 매핑 설정 |
| `vtuber.mascot.toggle {on?}` | 화면 마스코트 켜기/끄기 |
| `vtuber.tts.toggle {on?}` | 음성 출력 켜기/끄기 |

## 개발

```sh
npm install
npm run build        # esbuild → main.js
npm run typecheck
npm test             # 파이프라인 단위 테스트
npm run license-gate
```

dev 플러그인 설치: 이 repo를 `~/.soksak/plugins/soksak-plugin-vtuber`에 체크아웃하고 `.soksak.json`에 `{"version":"dev"}`를 두면 플러그인 리로드 시 적재된다.
