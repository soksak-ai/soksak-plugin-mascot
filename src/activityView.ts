// 사이드바 활동 뷰 — 설정(activityDisplay)에 따라 [캐릭터 스테이지]+[활동 로그 텍스트] 조합.
// 캐릭터 표면 소유권은 엔진 characterAt() 판정을 따른다(mascot > sidebar > panel).
import type { ViewCtx } from "@/types";
import type { VtuberEngine } from "@/engine";
import { GLOBAL_CSS } from "@/styles";

interface Mount {
  dispose(): void;
}

const mounts = new WeakMap<HTMLElement, Mount>();

export function mountActivity(container: HTMLElement, _viewCtx: ViewCtx, engine: VtuberEngine): void {
  unmountActivity(container);
  container.style.position = "relative";

  const shadow = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  shadow.replaceChildren();
  const style = document.createElement("style");
  style.textContent =
    GLOBAL_CSS +
    `
.va-root { position:absolute; inset:0; display:flex; flex-direction:column; font:12px/1.45 system-ui,sans-serif; color:#d8d8e0; }
.va-stage { position:relative; flex:0 0 46%; min-height:120px; display:none; }
.va-stage.on { display:block; }
.va-log { flex:1; overflow-y:auto; padding:6px 8px; display:flex; flex-direction:column; gap:3px; }
.va-row { display:flex; gap:6px; align-items:baseline; }
.va-time { color:#8a8a96; font-size:10px; flex:none; }
.va-text { white-space:pre-wrap; word-break:break-all; }
.va-row.terminal-done .va-text { color:#bfe3bf; }
.va-row.turn-ended .va-text { color:#ffd9e8; }
.va-empty { color:#8a8a96; padding:12px; text-align:center; }
`;
  shadow.appendChild(style);

  const root = document.createElement("div");
  root.className = "va-root";
  shadow.appendChild(root);
  const stage = document.createElement("div");
  stage.className = "va-stage";
  const log = document.createElement("div");
  log.className = "va-log";
  root.append(stage, log);

  engine.setActivityMounted(true);

  function renderStage(): void {
    const showChar = engine.characterAt() === "sidebar";
    stage.classList.toggle("on", showChar);
    if (showChar) engine.renderer.attach(stage);
    else engine.renderer.detach(stage);
  }

  function renderLog(): void {
    const entries = engine.narrator.list();
    const showText = engine.activityDisplay() !== "character";
    log.style.display = showText ? "flex" : "none";
    if (!showText) return;
    log.replaceChildren();
    if (entries.length === 0) {
      const e = document.createElement("div");
      e.className = "va-empty";
      e.textContent = engine.lang.startsWith("ko") ? "아직 활동이 없어요" : "no activity yet";
      log.appendChild(e);
      return;
    }
    for (const en of entries) {
      const row = document.createElement("div");
      row.className = `va-row ${en.kind.replace(".", "-")}`;
      const t = document.createElement("span");
      t.className = "va-time";
      t.textContent = new Date(en.ts).toTimeString().slice(0, 5);
      const x = document.createElement("span");
      x.className = "va-text";
      x.textContent = en.text;
      row.append(t, x);
      log.appendChild(row);
    }
    log.scrollTop = log.scrollHeight;
  }

  const sub1 = engine.narrator.onChange(renderLog);
  const sub2 = engine.on((e) => {
    if (e.kind === "state") {
      renderStage();
      renderLog();
    }
  });
  renderStage();
  renderLog();

  mounts.set(container, {
    dispose() {
      sub1.dispose();
      sub2.dispose();
      engine.renderer.detach(stage);
      engine.setActivityMounted(false);
    },
  });
}

export function unmountActivity(container: HTMLElement): void {
  mounts.get(container)?.dispose();
  mounts.delete(container);
}
