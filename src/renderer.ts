// Live2D 렌더러 — pixi 스테이지 + 모델 1개를 단일 소유하고, 캔버스 홀더를 패널/마스코트 사이로
// 옮겨 단다(모델 인스턴스는 캔버스 2개에 못 산다 — 이동이 정공법).
// 로컬 파일은 app.fs.url(blob URL) 로 치환(settings.replaceFiles) — asset:// 는 숨김 디렉터리를
// 막으므로 코어 표준(read_file_base64→blob)을 따른다. 성능: 어느 표면에도 안 붙으면 티커 완전 정지.
import * as PIXI from "pixi.js";
import type { Live2DModel } from "pixi-live2d-display-lipsyncpatch/cubism4";
import type { HostApp } from "@/types";
import { DEFAULT_EMOTIONS } from "@/pipeline";
import { cubismLoaded } from "@/cubism";

// pixi-live2d-display 는 cubism4 엔트리 "import 시점"에 Cubism Core 전역을 검사한다 —
// 정적 import 면 플러그인 활성화가 코어 미설치에서 통째로 죽는다. 동적 import 로 지연해
// 코어 확보 후에만 평가한다(esbuild 는 인라인 번들에서도 await 시점 lazy 평가를 보장).
type Live2dLib = typeof import("pixi-live2d-display-lipsyncpatch/cubism4");
let live2dLib: Live2dLib | null = null;
async function loadLive2dLib(): Promise<Live2dLib> {
  if (!cubismLoaded()) {
    throw new Error("Cubism Core not installed — run cubism.install {accept:true} first");
  }
  if (!live2dLib) live2dLib = await import("pixi-live2d-display-lipsyncpatch/cubism4");
  return live2dLib;
}

// pixi-live2d-display 는 전역 PIXI(티커·유틸)를 찾는다 — 이 번들의 PIXI 를 노출(번들 스코프라
// 다른 플러그인의 pixi 와 충돌하지 않는다. 코어는 pixi 를 전역에 두지 않음).
(window as unknown as { PIXI: unknown }).PIXI = PIXI;

// 입 파라미터의 단일진실 = model3.json Groups 의 LipSync 선언(모델마다 다르다 — 표준
// ParamMouthOpenY, mao_pro 는 ParamA). 미선언 모델만 표준 id 폴백.
const MOUTH_PARAM_FALLBACK = "ParamMouthOpenY";

export interface LoadedModelInfo {
  path: string;
  expressions: string[]; // 표정 Name 목록(모델 정의 순서)
  motionGroups: string[];
}

export class Live2DRenderer {
  private pixi: PIXI.Application | null = null;
  private model: Live2DModel | null = null;
  private holder: HTMLDivElement;
  private ro: ResizeObserver | null = null;
  private attachedTo: HTMLElement | null = null;
  private mouthOn = false;
  private mouthLevel: number | null = null; // 실측 진폭(사이드카) — null 이면 의사 파형 모드
  private mouthSmooth = 0;
  private lipSyncIds: string[] = [MOUTH_PARAM_FALLBACK]; // 모델 LipSync 그룹에서 로드 시 갱신
  private urlCache = new Map<string, string>();
  info: LoadedModelInfo | null = null;

  constructor(private app: HostApp) {
    this.holder = document.createElement("div");
    this.holder.style.cssText = "position:absolute;inset:0;overflow:hidden";
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = () => {
    this.syncTicker();
  };

  private syncTicker(): void {
    const shouldRun =
      !!this.pixi && !!this.attachedTo && this.attachedTo.isConnected && !document.hidden;
    const t = PIXI.Ticker.shared;
    if (shouldRun && !t.started) t.start();
    if (!shouldRun && t.started) t.stop();
  }

  private ensurePixi(): PIXI.Application {
    if (this.pixi) return this.pixi;
    this.pixi = new PIXI.Application({
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, globalThis.devicePixelRatio || 1),
      sharedTicker: true, // 이 번들 전용 shared ticker — 정지/재개 한 스위치
      // WKWebView 스냅샷(window.snapshot)은 preserve 없는 WebGL 버퍼를 검게 찍는다 —
      // 시각 E2E(기계 눈검증)가 계약이므로 켠다(아바타 1장 스테이지라 비용 미미).
      preserveDrawingBuffer: true,
    });
    const cv = this.pixi.view as HTMLCanvasElement;
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    this.holder.appendChild(cv);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.holder);
    return this.pixi;
  }

  /** 캔버스 홀더를 표면(패널 스테이지/마스코트)에 단다 — 마지막 attach 가 이긴다. */
  attach(target: HTMLElement): void {
    this.ensurePixi();
    target.appendChild(this.holder);
    this.attachedTo = target;
    this.resize();
    this.syncTicker();
  }

  /** 특정 표면에서 분리(그 표면이 아직 소유 중일 때만 — 늦게 온 detach 가 새 주인을 뺏지 않게). */
  detach(target: HTMLElement): void {
    if (this.attachedTo !== target) return;
    this.holder.remove();
    this.attachedTo = null;
    this.syncTicker();
  }

  private resize(): void {
    if (!this.pixi || !this.attachedTo) return;
    const w = this.holder.clientWidth;
    const h = this.holder.clientHeight;
    if (w < 2 || h < 2) return;
    this.pixi.renderer.resize(w, h);
    this.fit();
  }

  private fit(): void {
    if (!this.pixi || !this.model) return;
    const w = this.pixi.renderer.width / this.pixi.renderer.resolution;
    const h = this.pixi.renderer.height / this.pixi.renderer.resolution;
    const m = this.model;
    m.scale.set(1);
    const k = Math.min(w / m.width, h / m.height) * 0.95;
    if (Number.isFinite(k) && k > 0) m.scale.set(k);
    m.anchor.set(0.5, 0.5);
    m.position.set(w / 2, h / 2);
  }

  private async fileUrl(path: string): Promise<string> {
    const hit = this.urlCache.get(path);
    if (hit) return hit;
    if (!this.app.fs?.url) throw new Error("fs:read permission unavailable");
    const u = await this.app.fs.url(path);
    this.urlCache.set(path, u);
    return u;
  }

  /** .model3.json 로드 — 참조 파일 전부를 blob URL 로 선해석 후 replaceFiles 로 치환. */
  async loadModel(modelPath: string): Promise<LoadedModelInfo> {
    const { Live2DModel, Cubism4ModelSettings } = await loadLive2dLib();
    if (!this.app.fs?.readText) throw new Error("fs:read permission unavailable");
    const { text } = await this.app.fs.readText(modelPath);
    const json = JSON.parse(text);
    if (!json?.FileReferences?.Moc || !String(json.FileReferences.Moc).endsWith(".moc3")) {
      throw new Error("not a Cubism 3+ model (.model3.json with FileReferences.Moc required)");
    }
    const dir = modelPath.replace(/\/[^/]*$/, "");
    const groups = (json.Groups ?? []) as Array<{ Name?: string; Ids?: string[] }>;
    const lip = groups.find((g) => g.Name === "LipSync");
    this.lipSyncIds = lip?.Ids?.length ? lip.Ids : [MOUTH_PARAM_FALLBACK];
    const settings = new Cubism4ModelSettings({ ...json, url: modelPath });
    const files = settings.getDefinedFiles();
    const map = new Map<string, string>();
    await Promise.all(
      files.map(async (f) => {
        map.set(f, await this.fileUrl(dir + "/" + f));
      }),
    );
    // resolveURL 인스턴스 오버라이드 — 라이브러리 FileLoader 가 쓰는 공인 패턴.
    // replaceFiles(blob URL 치환)는 내부 utils.url.resolve 가 blob: URL 을 맹글링해 불가
    // ("blob:http//" — 콜론 탈락). 파일명→objectURL 직결이 정공.
    settings.resolveURL = (file: string) => map.get(file) ?? file;

    let model: Live2DModel;
    try {
      model = await Live2DModel.from(settings, { autoInteract: false });
    } catch (e) {
      // 로더 NetworkError 는 url/status 를 품는다 — 어느 파일이 죽었는지 표면화(진단 불변식)
      const url = (e as { url?: string })?.url;
      const status = (e as { status?: number })?.status;
      const which = url ? ` [file: ${[...map.entries()].find(([, v]) => v === url)?.[0] ?? url}${status != null ? `, status ${status}` : ""}]` : "";
      throw new Error(`${e instanceof Error ? e.message : String(e)}${which}`);
    }
    // 교체 로드 — 이전 모델 정리 후 장착
    this.unloadModel();
    this.ensurePixi().stage.addChild(model);
    this.model = model;
    this.hookMouth(model);
    this.fit();
    this.info = {
      path: modelPath,
      expressions: (settings.expressions ?? []).map((e: { Name: string }) => e.Name),
      motionGroups: Object.keys((settings as unknown as { motions?: object }).motions ?? {}),
    };
    return this.info;
  }

  unloadModel(): void {
    if (!this.model) return;
    this.unhookMouth();
    this.model.destroy();
    this.model = null;
    this.info = null;
  }

  /** 입 구동 — 포크 InternalModel 의 beforeModelUpdate 이벤트(이펙트 이후·변형 계산 직전)에서
   *  motionManager.lipSyncIds(모델 LipSync 그룹의 진짜 id 핸들)로 절대값을 쓴다.
   *  이 지점 밖의 쓰기는 프레임워크 save/load 사이클이 매 프레임 복원해 무효였다. */
  private mouthHandler: (() => void) | null = null;
  lastMouthWrite = 0; // 이번 프레임에 실제 쓴 값 — raw 읽기는 loadParameters 복원 때문에 항상 0
  private mouthModel: Live2DModel | null = null;

  private hookMouth(model: Live2DModel): void {
    this.unhookMouth();
    const im = model.internalModel as any;
    const core = im?.coreModel;
    const lipIds: unknown[] = im?.motionManager?.lipSyncIds ?? [];
    if (!core?.setParameterValueById || lipIds.length === 0) {
      console.warn("[vtuber] lipSyncIds unavailable — lip sync disabled");
      return;
    }
    const self = this;
    this.mouthHandler = () => {
      let v: number | null = null;
      if (self.mouthLevel != null) {
        // 실측 진폭(사이드카 재생) — 저역 통과로 떨림 완화
        self.mouthSmooth += (self.mouthLevel - self.mouthSmooth) * 0.35;
        v = Math.max(0, Math.min(1, self.mouthSmooth));
      } else if (self.mouthOn) {
        const t = performance.now() / 1000;
        // 두 사인 합성 + 클램프 — 결정적 파형(부드럽고 재현 가능). OS TTS 폴백용.
        v = Math.max(0, Math.min(1, 0.42 + 0.38 * Math.sin(t * 9.1) + 0.2 * Math.sin(t * 23.7)));
      }
      if (v != null) {
        // 라이브러리 자체 립싱크와 동일한 가시성 매핑(min 0.4 바닥) — 말소리 RMS 절대값은
        // 0.1~0.2 라 그대로 쓰면 입이 거의 안 벌어져 보인다(cubism4.es.js:10883 동일 처방).
        const mapped = v < 0.04 ? 0 : Math.min(1, 0.4 + 0.7 * v);
        self.lastMouthWrite = mapped;
        for (const id of lipIds) core.setParameterValueById(id, mapped);
      }
    };
    im.on("beforeModelUpdate", this.mouthHandler);
    this.mouthModel = model;
  }

  private unhookMouth(): void {
    if (this.mouthHandler && this.mouthModel) {
      (this.mouthModel.internalModel as any)?.off?.("beforeModelUpdate", this.mouthHandler);
    }
    this.mouthHandler = null;
    this.mouthModel = null;
  }

  setMouth(on: boolean): void {
    this.mouthOn = on;
    if (!on && this.mouthLevel == null) this.writeMouthRaw(0);
  }

  /** 실측 진폭 입모양(0..1). null = 실측 모드 해제(의사 파형/무음으로 복귀). */
  setMouthLevel(v: number | null): void {
    this.mouthLevel = v;
    if (v == null) {
      this.mouthSmooth = 0;
      if (!this.mouthOn) this.writeMouthRaw(0);
    }
  }

  private writeMouthRaw(v: number): void {
    const im = this.model?.internalModel as any;
    const core = im?.coreModel;
    for (const id of im?.motionManager?.lipSyncIds ?? []) core?.setParameterValueById?.(id, v);
  }

  /** 표정 적용 — "neutral" 은 표정 리셋. 알려진 표정 Name/인덱스만 적용. */
  async setExpression(name: string): Promise<boolean> {
    if (!this.model) return false;
    if (name === "neutral") {
      const em = (this.model.internalModel as any)?.motionManager?.expressionManager;
      if (em?.resetExpression) {
        em.resetExpression();
        return true;
      }
      return false;
    }
    try {
      return (await this.model.expression(name)) === true;
    } catch (e) {
      console.error("[vtuber] expression 적용 실패:", e);
      return false;
    }
  }

  /** 모션 재생 — group 은 model3.json Motions 의 그룹명("" 포함), index 생략 시 그룹 내 무작위.
   *  priority 3(FORCE) — 대기 모션을 즉시 밀어낸다. 끝나면 자동으로 Idle 로 복귀(라이브러리 기본). */
  async playMotion(group: string, index?: number): Promise<boolean> {
    if (!this.model) return false;
    try {
      return (await this.model.motion(group, index, 3)) === true;
    } catch (e) {
      console.error("[vtuber] motion 재생 실패:", e);
      return false;
    }
  }

  /** 감정→표정 자동 매핑 — 표정 이름에 감정어가 포함되면 채택(대소문자 무시). 못 찾으면 미매핑. */
  autoEmotionMap(): Record<string, string> {
    const out: Record<string, string> = {};
    const names = this.info?.expressions ?? [];
    const alias: Record<string, string[]> = {
      joy: ["joy", "happy", "smile", "fun"],
      anger: ["anger", "angry", "mad"],
      sadness: ["sad", "sorrow", "cry"],
      surprise: ["surprise", "shock"],
      fear: ["fear", "scare"],
      disgust: ["disgust"],
    };
    for (const emo of DEFAULT_EMOTIONS) {
      if (emo === "neutral") continue; // neutral=리셋 — 매핑 불필요
      const keys = alias[emo] ?? [emo];
      const hit = names.find((n) => keys.some((k) => n.toLowerCase().includes(k)));
      if (hit) out[emo] = hit;
    }
    return out;
  }

  /** 프레임버퍼 픽셀 검사 — 모델이 실제로 그려지는지(렌더 vs 캡처 문제 판별). E2E 전용. */
  async probePixels(): Promise<{ total: number; opaque: number; ratio: number } | null> {
    if (!this.pixi) return null;
    const px: Uint8Array | Uint8ClampedArray = await (this.pixi.renderer as any).extract.pixels(
      this.pixi.stage,
    );
    let opaque = 0;
    const total = px.length / 4;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 16) opaque++;
    return { total, opaque, ratio: Number((opaque / Math.max(1, total)).toFixed(4)) };
  }

  /** 프레임버퍼 PNG(base64) — 시각 E2E(창 합성과 무관하게 렌더 산출물 자체를 검증). */
  async probePng(): Promise<string | null> {
    if (!this.pixi) return null;
    return await (this.pixi.renderer as any).extract.base64(this.pixi.stage, "image/png");
  }

  /** 입 진단 — lastWrite(이번 프레임 실제 쓴 값)가 유일한 신뢰 지표(raw 읽기는 매 프레임 복원돼 항상 0). */
  mouthDiag(): { lipSyncIds: string[]; mouthLevel: number | null; smooth: number; lastWrite: number } {
    return {
      lipSyncIds: this.lipSyncIds,
      mouthLevel: this.mouthLevel,
      smooth: Number(this.mouthSmooth.toFixed(3)),
      lastWrite: Number(this.lastMouthWrite.toFixed(3)),
    };
  }

  /** 진단 스냅샷 — E2E/디버그용(state 커맨드에 노출). */
  stats() {
    const r = this.pixi?.renderer;
    const m = this.model;
    return {
      attached: !!this.attachedTo && this.attachedTo.isConnected,
      holder: { w: this.holder.clientWidth, h: this.holder.clientHeight, inDom: this.holder.isConnected },
      renderer: r ? { w: r.width, h: r.height, resolution: r.resolution } : null,
      tickerStarted: PIXI.Ticker.shared.started,
      model: m
        ? { w: Math.round(m.width), h: Math.round(m.height), x: Math.round(m.x), y: Math.round(m.y), scale: Number(m.scale.x.toFixed(4)), visible: m.visible }
        : null,
    };
  }

  dispose(): void {
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.ro?.disconnect();
    this.unloadModel();
    if (this.pixi) {
      this.pixi.destroy(true);
      this.pixi = null;
    }
    this.holder.remove();
    this.attachedTo = null;
  }
}
