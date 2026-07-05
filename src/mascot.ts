// 화면 마스코트 오버레이 — document.body 직결 fixed 레이어(ui:overlay:screen).
// 전면 pointer-events:none(클릭 통과 — 앱 조작을 절대 막지 않는다, overlay-sakura 선례).
// 켜지면 렌더러 캔버스를 이리로 가져오고, 끄면 패널이 state 이벤트로 도로 가져간다.
import type { VtubeTtsEngine } from "@/engine";
import { MASCOT_CSS } from "@/styles";

const HOST_ID = "soksak-mascot-mascot";

export class MascotOverlay {
  private host: HTMLDivElement | null = null;
  private stage: HTMLDivElement | null = null;
  private subtitle: HTMLDivElement | null = null;
  private sub: { dispose(): void } | null = null;

  constructor(private engine: VtubeTtsEngine) {}

  /** 엔진 상태를 따라 오버레이를 동기화 — 켜짐+모델 있음일 때만 존재. */
  sync(): void {
    const st = this.engine.state();
    if (st.mascot && st.model) this.show();
    else this.hide();
  }

  private show(): void {
    if (this.host) {
      this.engine.renderer.attach(this.stage!);
      return;
    }
    // 이전 적재 잔재 제거(리로드 누적 방지 — sakura 선례)
    document.querySelectorAll(`#${HOST_ID}`).forEach((e) => e.remove());
    document.querySelectorAll(`#${HOST_ID}-style`).forEach((e) => e.remove());

    const style = document.createElement("style");
    style.id = `${HOST_ID}-style`;
    style.textContent = MASCOT_CSS;
    document.head.appendChild(style);

    const host = document.createElement("div");
    host.id = HOST_ID;
    const stage = document.createElement("div");
    stage.className = "vtm-stage";
    const subtitle = document.createElement("div");
    subtitle.className = "vtm-subtitle";
    host.append(stage, subtitle);
    document.body.appendChild(host);

    this.host = host;
    this.stage = stage;
    this.subtitle = subtitle;
    this.engine.renderer.attach(stage);

    this.sub = this.engine.on((e) => {
      if (e.kind === "subtitle" && this.subtitle) this.subtitle.textContent = e.text;
    });
  }

  private hide(): void {
    if (!this.host) return;
    this.sub?.dispose();
    this.sub = null;
    if (this.stage) this.engine.renderer.detach(this.stage);
    this.host.remove();
    document.getElementById(`${HOST_ID}-style`)?.remove();
    this.host = null;
    this.stage = null;
    this.subtitle = null;
  }

  dispose(): void {
    this.hide();
  }
}
