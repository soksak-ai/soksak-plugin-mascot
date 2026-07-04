// soksak-plugin-vtuber 번들 빌드 — esbuild 단일 ESM main.js(loader 가 blob-URL 로 import).
// pixi.js + pixi-live2d-display 를 통째로 번들한다(플러그인은 상대 import 불가 — 전부 인라인).
// Cubism Core 는 번들하지 않는다 — 프로프라이어터리라 repo/번들 미포함, 런타임 동의 후 다운로드.
import { build, context } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(root, "src");

const opts = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  alias: { "@": SRC },
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: "main.js",
  minify: false, // 가독(검토). 발행 시 minify 전환.
  legalComments: "none",
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("[vtuber] watching src → main.js …");
} else {
  await build(opts);
  console.log("[vtuber] built main.js");
}
