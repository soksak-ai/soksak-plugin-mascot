// 라이선스 게이트 — 프로프라이어터리 산출물(Cubism Core, Live2D 모델)이 repo/번들에
// 절대 들어오지 않음을 기계로 단언한다. CI/발행 전 실행. 위반=비영 종료.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKIP_DIRS = new Set(["node_modules", ".git", ".vitest"]);
// 금지 파일 패턴 — Cubism Core 배포물, 모델 실물(.moc3/.model3.json), 샘플 텍스처 아카이브
const BANNED_FILE = /(live2dcubismcore|\.moc3$|\.model3\.json$|\.can3$|\.cmo3$)/i;

const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full);
      continue;
    }
    if (BANNED_FILE.test(name)) violations.push(path.relative(root, full));
  }
}
walk(root);

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
