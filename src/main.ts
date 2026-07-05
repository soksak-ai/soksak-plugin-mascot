// soksak 브이튜버 플러그인 엔트리 — loader 가 blob-URL 로 import 하는 단일 ESM.
// 헤드리스 커맨드는 뷰 미오픈에도 동작(sok plugin.soksak-plugin-vtuber.* / MCP / 소켓 E2E).
// 렌더러 캔버스는 엔진이 단일 소유 — content 패널과 화면 마스코트가 번갈아 단다.
import type { PluginCtx } from "@/types";
import { VtuberEngine } from "@/engine";
import { MascotOverlay } from "@/mascot";
import { mountPanel, unmountPanel } from "@/panelView";
import { mountActivity, unmountActivity } from "@/activityView";
import { registerCommands } from "@/commands";

let engine: VtuberEngine | null = null;
let mascot: MascotOverlay | null = null;

export default {
  activate(ctx: PluginCtx) {
    const app = ctx.app;
    engine = new VtuberEngine(app, (ctx as { dir?: string }).dir ?? "");
    mascot = new MascotOverlay(engine);
    ctx.subscriptions.push({
      dispose() {
        mascot?.dispose();
        engine?.dispose();
        mascot = null;
        engine = null;
      },
    });

    ctx.subscriptions.push(
      app.ui.registerView("vtuber", {
        mount(container, viewCtx) {
          if (engine) mountPanel(container, viewCtx, engine);
        },
        unmount(container) {
          unmountPanel(container);
        },
      }),
      app.ui.registerView("activity", {
        mount(container, viewCtx) {
          if (engine) mountActivity(container, viewCtx, engine);
        },
        unmount(container) {
          unmountActivity(container);
        },
      }),
    );

    registerCommands(ctx, engine, mascot);

    // 설정 복원(모델 재로드 등)은 비동기 — 실패해도 활성화는 성립(설정 카드가 안내).
    void engine
      .init()
      .then(() => mascot?.sync())
      .catch((e) => console.error("[vtuber] init 실패:", e));

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
