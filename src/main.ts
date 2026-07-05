// soksak-plugin-mascot 엔트리 — 뷰 없는 표현 엔진(loader 가 blob-URL 로 import 하는 단일 ESM).
// 전 기능이 커맨드(sok plugin.soksak-plugin-mascot.* / MCP / 소켓)와 마스코트 오버레이로만
// 노출된다 — 다른 플러그인(활동로그·대화 UI)이 say/expression/mascot 으로 구동하는 부품.
import type { PluginCtx } from "@/types";
import { MascotEngine } from "@/engine";
import { MascotOverlay } from "@/mascot";
import { registerCommands } from "@/commands";

let engine: MascotEngine | null = null;
let mascot: MascotOverlay | null = null;

export default {
  activate(ctx: PluginCtx) {
    const app = ctx.app;
    engine = new MascotEngine(app, (ctx as { dir?: string }).dir ?? "");
    mascot = new MascotOverlay(engine);
    ctx.subscriptions.push({
      dispose() {
        mascot?.dispose();
        engine?.dispose();
        mascot = null;
        engine = null;
      },
    });


    registerCommands(ctx, engine, mascot);

    // 설정 복원(모델 재로드 등)은 비동기 — 실패해도 활성화는 성립(README 온보딩 참조).
    void engine
      .init()
      .then(() => mascot?.sync())
      .catch((e) => console.error("[mascot] init 실패:", e));

    // 마스코트는 뷰와 독립 — state 변화 때마다 오버레이 존재를 동기화.
    ctx.subscriptions.push(
      engine.on((e) => {
        if (e.kind === "state") mascot?.sync();
      }),
    );
  },
  deactivate() {
    mascot?.dispose();
    engine?.dispose();
    mascot = null;
    engine = null;
  },
};
