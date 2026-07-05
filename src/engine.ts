// vtuber 엔진 — 설정·렌더러·TTS 큐·acp 를 한 곳에서 소유. 뷰(패널/마스코트)와 커맨드는 전부
// 이 엔진의 같은 오퍼레이션을 호출한다(표면≡커맨드 등가 — CLI 자가검증 원칙).
// 뷰 갱신은 얇은 로컬 이벤트로 브로드캐스트(교차창 상태 아님 — 창-로컬 UI 반영용).
import type { HostApp, Utterance } from "@/types";
import { SettingsStore } from "@/settings";
import { Live2DRenderer, type LoadedModelInfo } from "@/renderer";
import { SpeechQueue, SpeechSynthesisTts, type TtsEngine } from "@/tts";
import { SidecarTts } from "@/sidecarTts";
import { AcpChat } from "@/acp";
import { ClaudeCliChat } from "@/claudeCli";
import { DEFAULT_EMOTIONS, StreamSegmenter, extractEmotion, personaPreamble } from "@/pipeline";
import * as cubism from "@/cubism";

export interface ChatEntry {
  who: "user" | "char" | "sys";
  text: string;
}

export type EngineEvent =
  | { kind: "chat"; entry: ChatEntry }
  | { kind: "subtitle"; text: string }
  | { kind: "state" }; // 모델/마스코트/음성/busy 등 상태 변화 — 뷰는 state() 재조회

export class VtuberEngine {
  readonly settings: SettingsStore;
  readonly renderer: Live2DRenderer;
  private tts!: SpeechSynthesisTts;
  private sidecar!: SidecarTts;
  private speech: SpeechQueue;
  private acp: AcpChat;
  private claudeCli!: ClaudeCliChat;
  private listeners = new Set<(e: EngineEvent) => void>();
  private chatLog: ChatEntry[] = [];
  private turnBusy = false;
  lang: string;

  constructor(private app: HostApp) {
    this.lang = app.locale?.() ?? navigator.language ?? "en";
    this.settings = new SettingsStore(app);
    this.renderer = new Live2DRenderer(app);
    this.acp = new AcpChat(
      app,
      () => this.agentSetting(),
      () => this.agentModelSetting(),
    );
    // claude-bare 의 모델 — agentModel 이 claude 계열일 때만 통과(다른 에이전트용 id 혼입 방지).
    this.claudeCli = new ClaudeCliChat(app, () => {
      const m = this.agentModelSetting();
      return /haiku|sonnet|opus|fable|^claude/i.test(m) ? m : "";
    });
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
    const self = this;
    const composite: TtsEngine = {
      available: () => self.sidecar.available() || self.tts.available(),
      speak: (text, lang) =>
        self.usingSidecar() ? self.sidecar.speak(text, lang) : self.tts.speak(text, lang),
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

  private agentSetting(): string {
    const v = this.app.settings.get("agent");
    return v === "codex" || v === "gemini" || v === "claude-bare" ? v : "claude";
  }

  /** 대화 백엔드 — claude-bare = claude -p 직행(즉답), 그 외 = acp-core. */
  private chatBackend(): AcpChat | ClaudeCliChat {
    return this.agentSetting() === "claude-bare" ? this.claudeCli : this.acp;
  }

  private agentModelSetting(): string {
    const v = this.app.settings.get("agentModel");
    return typeof v === "string" ? v.trim() : "";
  }

  async init(): Promise<void> {
    await this.settings.load();
    const s = this.settings.get();
    // 캐시된 Cubism Core 는 조용히 복원(동의는 이미 이뤄짐) — 미동의/미캐시면 설정 카드가 안내.
    if (s.cubismAccepted) await cubism.ensureFromCache(this.app);

    // 구버전 kv modelPath → 코어 설정 승격(1회 마이그레이션 — 설정이 비어 있을 때만).
    let path = this.configuredModelPath();
    if (!path && this.settings.legacyModelPath) {
      path = this.settings.legacyModelPath;
      await this.persistModelPath(path);
    }
    if (path && cubism.cubismLoaded()) {
      try {
        await this.loadModel(path);
      } catch (e) {
        this.sys(`model restore failed: ${String(e)}`);
      }
    }

    // 설정 변경 감시 — modelPath 는 캐릭터 라이브 교체, agent/모델은 연결 폐기(다음 턴에 재연결).
    let lastAgent = this.agentSetting() + "|" + this.agentModelSetting();
    this.app.settings.onChange(() => {
      const agent = this.agentSetting() + "|" + this.agentModelSetting();
      if (agent !== lastAgent) {
        lastAgent = agent;
        this.acp.dispose();
        this.claudeCli.dispose();
        this.sys(`agent switched to ${agent.replace(/\|$/, "")}`);
        this.emit({ kind: "state" });
      }
      const next = this.configuredModelPath();
      if (!next || next === this.renderer.info?.path) return;
      void this.loadModel(next).catch((e) => this.sys(`model switch failed: ${String(e)}`));
    });
  }

  private async persistModelPath(path: string): Promise<void> {
    try {
      await this.app.commands.execute("plugin.settings.set", {
        id: "soksak-plugin-vtuber",
        key: "modelPath",
        value: path,
      });
    } catch (e) {
      console.error("[vtuber] modelPath 설정 저장 실패:", e);
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
      emotionMap: this.emotionMap(),
      mascot: s.mascotOn,
      tts: s.ttsEnabled,
      ttsAvailable: this.tts.available() || this.sidecar.available(),
      speechEngine: this.usingSidecar() ? "sidecar" : "os",
      sidecarRunning: this.sidecar.running(),
      sidecarInfo: this.sidecar.info(),
      speaking: this.speech.speaking,
      busy: this.turnBusy,
      agentConnected: this.chatBackend().connected(),
      lang: this.lang,
      renderer: this.renderer.stats(),
    };
  }

  emotions(): readonly string[] {
    return DEFAULT_EMOTIONS;
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
      throw new Error("Cubism Core not installed — run vtuber.cubism.install {accept:true} first");
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

  /** 한 대화 턴 — 에이전트 스트리밍을 문장 단위로 실시간 발화한다. 완료 후 전체 응답+타이밍 반환.
   *  timing.firstSentenceMs ≈ turnMs 이면 에이전트가 델타를 통짜로 보낸 것(파이프라인 지연 아님). */
  async chat(
    text: string,
  ): Promise<{
    reply: string;
    utterances: Utterance[];
    timing: {
      turnMs: number;
      firstSentenceMs: number | null;
      deltas: number;
      firstDeltaMs: number | null;
      lastDeltaMs: number | null;
    };
  }> {
    if (this.turnBusy) throw new Error("turn already in flight");
    this.turnBusy = true;
    this.emit({ kind: "state" });
    this.pushChat({ who: "user", text });
    const t0 = performance.now();
    let firstSentenceMs: number | null = null;
    const utterances: Utterance[] = [];
    const seg = new StreamSegmenter((sentence) => {
      const u = extractEmotion(sentence, DEFAULT_EMOTIONS);
      if (u.speak) {
        if (firstSentenceMs == null) firstSentenceMs = Math.round(performance.now() - t0);
        utterances.push(u);
        this.speech.enqueue(u);
        if (u.text) this.pushChat({ who: "char", text: u.text });
      }
    });
    try {
      const r = await this.chatBackend().ask(text, personaPreamble(DEFAULT_EMOTIONS), (delta) =>
        seg.feed(delta),
      );
      seg.flush();
      // 스트리밍이 전혀 안 왔는데 최종 텍스트만 있는 경우(에이전트별 편차) — 최종본을 발화.
      if (utterances.length === 0 && r.text) {
        for (const u of this.speakText(r.text)) {
          utterances.push(u);
          this.pushChat({ who: "char", text: u.text });
        }
      }
      const reply = utterances.map((u) => u.text).join(" ");
      return {
        reply,
        utterances,
        timing: {
          turnMs: Math.round(performance.now() - t0),
          firstSentenceMs,
          ...r.stream, // deltas/firstDeltaMs/lastDeltaMs — 에이전트 스트리밍 형태 판별
        },
      };
    } catch (e) {
      this.sys(`${String(e)}`);
      throw e;
    } finally {
      this.turnBusy = false;
      this.emit({ kind: "state" });
    }
  }

  async stop(): Promise<void> {
    this.speech.cancel();
    this.renderer.setMouth(false);
    await this.acp.cancel();
    await this.claudeCli.cancel();
    this.emit({ kind: "subtitle", text: "" });
    this.emit({ kind: "state" });
  }

  dispose(): void {
    this.speech.cancel();
    this.sidecar.dispose();
    this.acp.dispose();
    this.claudeCli.dispose();
    this.renderer.dispose();
    this.listeners.clear();
  }
}
