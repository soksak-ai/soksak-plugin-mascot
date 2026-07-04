// 라이선스 게이트 — 프로프라이어터리 산출물(Cubism Core, Live2D 모델)이 "커밋"이나 "번들"에
// 절대 들어오지 않음을 기계로 단언한다. 로컬 models/(gitignore)는 사용자 로컬 사용 — 커밋만 금지.
// 판정 기준 = git 추적 파일(약속의 실체는 배포물) + main.js 본문. CI/발행 전 실행. 위반=비영 종료.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 금지 파일 패턴 — Cubism Core 배포물, 모델 실물(.moc3/.model3.json), 편집 원본
const BANNED_FILE = /(live2dcubismcore|\.moc3$|\.model3\.json$|\.can3$|\.cmo3$)/i;

const violations = [];

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
for (const f of tracked) {
  if (BANNED_FILE.test(f)) violations.push(f);
}

// 번들(main.js) 안에 Cubism Core 본문이 인라인되지 않았는지. 소비자(pixi-live2d-display)가
// 전역을 "읽는" 것은 정상 — 전역을 "정의"하는 코드(네임스페이스 자기할당 IIFE)와 내장 wasm
// (base64 매직 "AGFzbQ")만이 본문 인라인의 증거다.
try {
  const bundle = readFileSync(path.join(root, "main.js"), "utf8");
  const DEFINES_CORE = /Live2DCubismCore\s*\|\|\s*\(\s*Live2DCubismCore\s*=/.test(bundle);
  const EMBEDS_WASM = bundle.includes("AGFzbQ");
  if (DEFINES_CORE || EMBEDS_WASM) {
    violations.push(
      `main.js: Cubism Core body inlined (definesCore=${DEFINES_CORE}, embedsWasm=${EMBEDS_WASM})`,
    );
  }
} catch {
  /* main.js 미빌드 — 파일 검사만으로 통과 판단 */
}

if (violations.length) {
  console.error("[license-gate] FAIL — proprietary artifacts must not be committed/bundled:");
  for (const v of violations) console.error("  -", v);
  process.exit(1);
}
console.log("[license-gate] OK — no Cubism Core / Live2D model artifacts in repo or bundle");
