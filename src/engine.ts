// mascot 엔진 — 설정·렌더러·TTS 큐·acp 를 한 곳에서 소유. 뷰(패널/마스코트)와 커맨드는 전부
// 이 엔진의 같은 오퍼레이션을 호출한다(표면≡커맨드 등가 — CLI 자가검증 원칙).
// 뷰 갱신은 얇은 로컬 이벤트로 브로드캐스트(교차창 상태 아님 — 창-로컬 UI 반영용).
import type { HostApp, Utterance } from "@/types";
import { SettingsStore } from "@/settings";
import { Live2DRenderer, type LoadedModelInfo } from "@/renderer";
import { SpeechQueue, SpeechSynthesisTts, type TtsEngine } from "@/tts";
import { SidecarTts } from "@/sidecarTts";
import { DEFAULT_EMOTIONS, StreamSegmenter, extractEmotion } from "@/pipeline";
import * as cubism from "@/cubism";

export interface ChatEntry {
  who: "user" | "char" | "sys";
  text: string;
}

export type EngineEvent =
  | { kind: "chat"; entry: ChatEntry }
  | { kind: "subtitle"; text: string }
  | { kind: "state" }; // 모델/마스코트/음성/busy 등 상태 변화 — 뷰는 state() 재조회

export class VtubeTtsEngine {
  readonly settings: SettingsStore;
  readonly renderer: Live2DRenderer;
  private tts!: SpeechSynthesisTts;
  private sidecar!: SidecarTts;
  private speech: SpeechQueue;
  private listeners = new Set<(e: EngineEvent) => void>();
  private chatLog: ChatEntry[] = [];
  lang: string;

  constructor(
    private app: HostApp,
    private pluginDir: string = "",
  ) {
    this.lang = app.locale?.() ?? navigator.language ?? "en";
    this.settings = new SettingsStore(app);
    this.renderer = new Live2DRenderer(app);
    this.tts = new SpeechSynthesisTts({
      voiceName: () => {
        const v = this.app.settings.get("voiceName");
        return typeof v === "string" ? v : "";
      },
    });
    const str = (key: string) => {
      const v = this.app.settings.get(key);
      return typeof v === "string" ? v.trim() : "";
    };
    const num = (key: string, dflt: number) => {
      const v = this.app.settings.get(key);
      return typeof v === "number" && Number.isFinite(v) ? v : dflt;
    };
    this.sidecar = new SidecarTts(
      app,
      {
        bin: () => str("speechSidecarBin"),
        modelDir: () => str("speechModelDir"),
        engine: () => str("speechEngine") || "vits",
        speakerId: () => Math.max(0, Math.round(num("speechSpeakerId", 0))),
        speed: () => Math.min(3, Math.max(0.5, num("speechSpeed", 1.0))),
      },
      (v) => this.renderer.setMouthLevel(v > 0 || this.speech.speaking ? v : null),
    );
    // 합성 경로 선택 — 사이드카(로컬 신경 TTS, 실측 립싱크)가 설정돼 있으면 우선, 아니면 OS 음성.
    // 사이드카가 오디오를 못 냈으면(기동 실패 등) 그 문장은 OS 음성으로 폴백 — 무음 금지.
    const self = this;
    let warnedFallback = false;
    const composite: TtsEngine = {
      available: () => self.sidecar.available() || self.tts.available(),
      speak: async (text, lang) => {
        if (self.usingSidecar()) {
          const spoke = await self.sidecar.speakChecked(text, lang);
          if (spoke) return;
          if (!warnedFallback) {
            warnedFallback = true;
            self.sys("speech sidecar unavailable — falling back to OS voice");
          }
        }
        if (self.tts.available()) {
          self.renderer.setMouth(true); // OS 경로는 의사 입모양
          await self.tts.speak(text, lang);
          self.renderer.setMouth(false);
        }
      },
      cancel: () => {
        self.sidecar.cancel();
        self.tts.cancel();
      },
    };
    this.speech = new SpeechQueue(
      composite,
      {
        onStart: (u) => {
          if (u.emotion) void this.renderer.setExpression(this.mapEmotion(u.emotion));
          if (!this.usingSidecar()) this.renderer.setMouth(true); // 사이드카는 실측 레벨이 구동
          this.emit({ kind: "subtitle", text: u.text });
        },
        onEnd: (_u, last) => {
          this.renderer.setMouth(false);
          if (last) {
            this.renderer.setMouthLevel(null);
            this.emit({ kind: "subtitle", text: "" });
          }
        },
      },
      {
        enabled: () => this.settings.get().ttsEnabled,
        lang: () => this.lang,
      },
    );
  }

  usingSidecar(): boolean {
    return this.sidecar.available();
  }

  /** 코어 선언형 설정의 모델 경로 — 단일 진실(설정 모달·plugin.settings.set·model.load 전부 여기로 수렴). */
  configuredModelPath(): string {
    const v = this.app.settings.get("modelPath");
    return typeof v === "string" ? v.trim() : "";
  }

  /** 캐릭터가 지금 어느 표면에 있어야 하는가 — mascot > 패널. */
  characterAt(): "mascot" | "panel" {
    return this.settings.get().mascotOn ? "mascot" : "panel";
  }

  async init(): Promise<void> {
    await this.settings.load();
    const s = this.settings.get();
    // 캐시된 Cubism Core 는 조용히 복원(동의는 이미 이뤄짐) — 미동의/미캐시면 설정 카드가 안내.
    if (s.cubismAccepted) await cubism.ensureFromCache(this.app);

    const path = this.configuredModelPath();
    if (path && cubism.cubismLoaded()) {
      try {
        await this.loadModel(path);
      } catch (e) {
        this.sys(`model restore failed: ${String(e)}`);
      }
    }

    // 설정 변경 감시 — modelPath 변경 = 캐릭터 라이브 교체.
    this.app.settings.onChange(() => {
      const next = this.configuredModelPath();
      if (!next || next === this.renderer.info?.path) return;
      void this.loadModel(next).catch((e) => this.sys(`model switch failed: ${String(e)}`));
    });
  }

  private async persistModelPath(path: string): Promise<void> {
    try {
      await this.app.commands.execute("plugin.settings.set", {
        id: "soksak-plugin-mascot",
        key: "modelPath",
        value: path,
      });
    } catch (e) {
      console.error("[mascot] modelPath 설정 저장 실패:", e);
    }
  }

  // ── 이벤트 ──
  on(fn: (e: EngineEvent) => void): { dispose(): void } {
    this.listeners.add(fn);
    return { dispose: () => this.listeners.delete(fn) };
  }
  private emit(e: EngineEvent): void {
    for (const fn of this.listeners) fn(e);
  }
  private sys(text: string): void {
    this.pushChat({ who: "sys", text });
  }
  private pushChat(entry: ChatEntry): void {
    this.chatLog.push(entry);
    if (this.chatLog.length > 200) this.chatLog.splice(0, this.chatLog.length - 200);
    this.emit({ kind: "chat", entry });
  }

  log(): readonly ChatEntry[] {
    return this.chatLog;
  }

  // ── 상태 ──
  state() {
    const s = this.settings.get();
    return {
      cubism: cubism.cubismLoaded(),
      cubismAccepted: s.cubismAccepted,
      model: this.renderer.info?.path ?? null,
      configuredModelPath: this.configuredModelPath(),
      expressions: this.renderer.info?.expressions ?? [],
      motionGroups: this.renderer.info?.motionGroups ?? [],
      emotionMap: this.emotionMap(),
      mascot: s.mascotOn,
      tts: s.ttsEnabled,
      ttsAvailable: this.tts.available() || this.sidecar.available(),
      characterAt: this.characterAt(),
      speechEngine: this.usingSidecar() ? "sidecar" : "os",
      sidecarRunning: this.sidecar.running(),
      sidecarInfo: this.sidecar.info(),
      speaking: this.speech.speaking,
      lang: this.lang,
      renderer: this.renderer.stats(),
    };
  }

  emotions(): readonly string[] {
    return DEFAULT_EMOTIONS;
  }

  /** 캐릭터 후보 스캔 — modelsDir 설정(비면 <플러그인>/models) 아래 .model3.json 재귀 탐색(깊이 4). */
  async listModels(): Promise<Array<{ name: string; path: string }>> {
    const base = (() => {
      const v = this.app.settings.get("modelsDir");
      const s = typeof v === "string" ? v.trim() : "";
      return s || (this.pluginDir ? `${this.pluginDir}/models` : "");
    })();
    if (!base || !this.app.fs?.list) return [];
    const out: Array<{ name: string; path: string }> = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 4 || out.length >= 100) return;
      let r: { children?: Array<{ name: string; dir?: boolean }> };
      try {
        r = await this.app.fs!.list(dir);
      } catch {
        return; // 폴더 없음/권한 — 조용히 스킵(설정 카드가 안내)
      }
      for (const ch of r?.children ?? []) {
        const full = `${dir}/${ch.name}`;
        if (ch.dir) await walk(full, depth + 1);
        else if (ch.name.endsWith(".model3.json"))
          out.push({ name: ch.name.replace(/\.model3\.json$/, ""), path: full });
      }
    };
    await walk(base, 0);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  listVoices(): Array<{ name: string; lang: string; default: boolean }> {
    return this.tts.listVoices();
  }

  private emotionMap(): Record<string, string> {
    const s = this.settings.get();
    const path = this.renderer.info?.path;
    if (!path) return {};
    return s.emotionMaps[path] ?? this.renderer.autoEmotionMap();
  }

  private mapEmotion(emotion: string): string {
    if (emotion === "neutral") return "neutral";
    return this.emotionMap()[emotion] ?? "neutral";
  }

  // ── 오퍼레이션(뷰·커맨드 공용) ──

  async installCubism(accept: boolean): Promise<void> {
    await cubism.install(this.app, accept);
    if (accept) await this.settings.patch({ cubismAccepted: true });
    this.emit({ kind: "state" });
  }

  async loadModel(path: string): Promise<LoadedModelInfo> {
    if (!cubism.cubismLoaded()) {
      throw new Error("Cubism Core not installed — run cubism.install {accept:true} first");
    }
    const info = await this.renderer.loadModel(path);
    if (this.configuredModelPath() !== path) await this.persistModelPath(path);
    this.emit({ kind: "state" });
    return info;
  }

  async setEmotionMap(map: Record<string, string>): Promise<void> {
    const path = this.renderer.info?.path;
    if (!path) throw new Error("no model loaded");
    const known = new Set(this.renderer.info?.expressions ?? []);
    for (const [emo, expr] of Object.entries(map)) {
      if (!(DEFAULT_EMOTIONS as readonly string[]).includes(emo))
        throw new Error(`unknown emotion "${emo}" (allowed: ${DEFAULT_EMOTIONS.join(", ")})`);
      if (!known.has(expr)) throw new Error(`unknown expression "${expr}"`);
    }
    await this.settings.setEmotionMap(path, map);
    this.emit({ kind: "state" });
  }

  async setMascot(on: boolean): Promise<boolean> {
    await this.settings.patch({ mascotOn: on });
    this.emit({ kind: "state" });
    return on;
  }

  async setTts(on: boolean): Promise<boolean> {
    await this.settings.patch({ ttsEnabled: on });
    if (!on) this.speech.cancel();
    this.emit({ kind: "state" });
    return on;
  }

  /** 텍스트를 파이프라인(문장→감정→발화 큐)에 태운다 — LLM 무관 로컬 경로(say). */
  speakText(text: string): Utterance[] {
    const utterances: Utterance[] = [];
    const seg = new StreamSegmenter((sentence) => {
      const u = extractEmotion(sentence, DEFAULT_EMOTIONS);
      if (u.speak) {
        utterances.push(u);
        this.speech.enqueue(u);
      }
    });
    seg.feed(text);
    seg.flush();
    return utterances;
  }

  async stop(): Promise<void> {
    this.speech.cancel();
    this.renderer.setMouth(false);
    this.emit({ kind: "subtitle", text: "" });
    this.emit({ kind: "state" });
  }

  /** 엔진 자원 반납 — 규칙: 엔진의 생존은 발화 자격과 함께 간다(단일 낭독자). 자격을 잃은
   *  소비자(narrator 상실·mascot 끔)가 호출하면 사이드카(모델 상주 프로세스)를 내린다.
   *  발화 중이면 큐 소화 후 내려가고, 다음 say 가 lazy 재기동한다. */
  releaseTts(): void {
    this.sidecar.release();
    this.emit({ kind: "state" });
  }

  dispose(): void {
    this.speech.cancel();
    this.sidecar.dispose();
    this.renderer.dispose();
    this.listeners.clear();
  }
}
