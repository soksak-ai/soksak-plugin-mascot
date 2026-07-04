// content 패널 뷰 — Shadow DOM(코어 chrome 격리). 아바타 스테이지 + 자막 + 채팅 로그 + 입력.
// 캔버스는 렌더러 단일 소유 — 마스코트가 켜져 있으면 스테이지엔 안내문만 보인다.
// status 축: LLM 턴 진행 중 busy 보고(닫기 가드 — 턴 유실 방지), 종료 시 회수(null).
import type { ViewCtx } from "@/types";
import type { VtuberEngine } from "@/engine";
import { GLOBAL_CSS } from "@/styles";
import { CUBISM_LICENSE_URL } from "@/cubism";
import { makeT, type StrKey } from "@/i18n";

interface Mount {
  dispose(): void;
}

const mounts = new WeakMap<HTMLElement, Mount>();

export function mountPanel(container: HTMLElement, viewCtx: ViewCtx, engine: VtuberEngine): void {
  unmountPanel(container);
  container.style.position = "relative";
  const t = makeT(engine.lang);

  const shadow = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  shadow.replaceChildren();
  const style = document.createElement("style");
  style.textContent = GLOBAL_CSS;
  shadow.appendChild(style);

  const root = el("div", "vt-root");
  shadow.appendChild(root);

  // ── 툴바 ──
  const toolbar = el("div", "vt-toolbar");
  const ttsBtn = el("button", "vt-btn") as HTMLButtonElement;
  const mascotBtn = el("button", "vt-btn") as HTMLButtonElement;
  const stopBtn = el("button", "vt-btn") as HTMLButtonElement;
  stopBtn.textContent = "■";
  stopBtn.title = "stop";
  toolbar.append(ttsBtn, mascotBtn, stopBtn);
  root.appendChild(toolbar);

  // ── 스테이지 ──
  const stage = el("div", "vt-stage");
  const stageEmpty = el("div", "vt-stage-empty");
  stage.appendChild(stageEmpty);
  root.appendChild(stage);
  const subtitle = el("div", "vt-subtitle");
  root.appendChild(subtitle);

  // ── 채팅 ──
  const chat = el("div", "vt-chat");
  root.appendChild(chat);
  const inputRow = el("div", "vt-inputrow");
  const input = document.createElement("input");
  input.className = "vt-input";
  input.placeholder = t("chatPlaceholder");
  const sendBtn = el("button", "vt-btn") as HTMLButtonElement;
  sendBtn.textContent = t("send");
  inputRow.append(input, sendBtn);
  root.appendChild(inputRow);

  for (const entry of engine.log()) addMsg(entry.who, entry.text);

  // ── 설정 카드(Cubism 미설치/모델 미로드 시 스테이지 대신 안내) ──
  function renderStage(): void {
    const st = engine.state();
    stageEmpty.replaceChildren();
    if (st.model && !st.mascot) {
      stageEmpty.style.display = "none";
      engine.renderer.attach(stage);
      return;
    }
    engine.renderer.detach(stage);
    stageEmpty.style.display = "flex";
    if (st.mascot && st.model) {
      stageEmpty.textContent = t("mascotHolds");
      return;
    }
    const card = el("div", "vt-card");
    if (!st.cubism) {
      card.append(p(t("cubismNotice")));
      const link = document.createElement("a");
      link.href = CUBISM_LICENSE_URL;
      link.target = "_blank";
      link.textContent = t("cubismLicenseLink");
      card.appendChild(link);
      const btn = el("button", "vt-btn") as HTMLButtonElement;
      btn.textContent = t("cubismAccept");
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await engine.installCubism(true);
        } catch (e) {
          card.appendChild(errP(e));
        } finally {
          btn.disabled = false;
        }
      };
      card.appendChild(btn);
    } else {
      card.append(p(t("modelNone")), p(t("modelPathLabel")));
      const pathInput = document.createElement("input");
      pathInput.className = "vt-input";
      pathInput.placeholder = "/path/to/model/xxx.model3.json";
      const cur = engine.configuredModelPath();
      if (cur) pathInput.value = cur;
      const btn = el("button", "vt-btn") as HTMLButtonElement;
      btn.textContent = t("modelLoad");
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await engine.loadModel(pathInput.value.trim());
        } catch (e) {
          card.appendChild(errP(e));
        } finally {
          btn.disabled = false;
        }
      };
      card.append(pathInput, btn);
    }
    stageEmpty.appendChild(card);
  }

  function renderToolbar(): void {
    const st = engine.state();
    ttsBtn.textContent = st.tts ? t("ttsOn") : t("ttsOff");
    mascotBtn.textContent = st.mascot ? t("mascotOn") : t("mascotOff");
    sendBtn.disabled = st.busy;
    viewCtx.setStatus(st.busy ? { code: "busy", message: "turn in flight" } : null);
  }

  ttsBtn.onclick = () => void engine.setTts(!engine.state().tts);
  mascotBtn.onclick = () => void engine.setMascot(!engine.state().mascot);
  stopBtn.onclick = () => void engine.stop();

  async function send(): Promise<void> {
    const text = input.value.trim();
    if (!text || engine.state().busy) return;
    input.value = "";
    try {
      await engine.chat(text);
    } catch {
      /* 오류는 엔진이 sys 채팅으로 이미 노출 */
    }
  }
  sendBtn.onclick = () => void send();
  input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.isComposing) void send();
  };

  function addMsg(who: "user" | "char" | "sys", text: string): void {
    const m = el("div", `vt-msg ${who}`);
    m.textContent = text;
    chat.appendChild(m);
    chat.scrollTop = chat.scrollHeight;
  }

  const sub = engine.on((e) => {
    if (e.kind === "chat") addMsg(e.entry.who, e.entry.text);
    if (e.kind === "subtitle") subtitle.textContent = e.text;
    if (e.kind === "state") {
      renderToolbar();
      renderStage();
    }
  });

  renderToolbar();
  renderStage();

  mounts.set(container, {
    dispose() {
      sub.dispose();
      engine.renderer.detach(stage);
      viewCtx.setStatus(null);
    },
  });
}

export function unmountPanel(container: HTMLElement): void {
  mounts.get(container)?.dispose();
  mounts.delete(container);
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
function p(text: string): HTMLElement {
  const e = document.createElement("p");
  e.textContent = text;
  return e;
}
function errP(e: unknown): HTMLElement {
  const el = document.createElement("p");
  el.className = "vt-err";
  el.textContent = String(e instanceof Error ? e.message : e);
  return el;
}
