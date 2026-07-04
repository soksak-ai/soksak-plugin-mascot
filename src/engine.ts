// vtuber 엔진 — 설정·렌더러·TTS 큐·acp 를 한 곳에서 소유. 뷰(패널/마스코트)와 커맨드는 전부
// 이 엔진의 같은 오퍼레이션을 호출한다(표면≡커맨드 등가 — CLI 자가검증 원칙).
// 뷰 갱신은 얇은 로컬 이벤트로 브로드캐스트(교차창 상태 아님 — 창-로컬 UI 반영용).
import type { HostApp, Utterance } from "@/types";
import { SettingsStore } from "@/settings";
import { Live2DRenderer, type LoadedModelInfo } from "@/renderer";
import { SpeechQueue, SpeechSynthesisTts } from "@/tts";
import { AcpChat } from "@/acp";
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
  private speech: SpeechQueue;
  private acp: AcpChat;
  private listeners = new Set<(e: EngineEvent) => void>();
  private chatLog: ChatEntry[] = [];
  private turnBusy = false;
  lang: string;

  constructor(private app: HostApp) {
    this.lang = app.locale?.() ?? navigator.language ?? "en";
    this.settings = new SettingsStore(app);
    this.renderer = new Live2DRenderer(app);
    this.acp = new AcpChat(app, () => "claude");
    this.speech = new SpeechQueue(
      new SpeechSynthesisTts(),
      {
        onStart: (u) => {
          if (u.emotion) void this.renderer.setExpression(this.mapEmotion(u.emotion));
          this.renderer.setMouth(true);
          this.emit({ kind: "subtitle", text: u.text });
        },
        onEnd: (_u, last) => {
          this.renderer.setMouth(false);
          if (last) this.emit({ kind: "subtitle", text: "" });
        },
      },
      {
        enabled: () => this.settings.get().ttsEnabled,
        lang: () => this.lang,
      },
    );
  }

  async init(): Promise<void> {
    await this.settings.load();
    const s = this.settings.get();
    // 캐시된 Cubism Core 는 조용히 복원(동의는 이미 이뤄짐) — 미동의/미캐시면 설정 카드가 안내.
    if (s.cubismAccepted) await cubism.ensureFromCache(this.app);
    if (s.modelPath && cubism.cubismLoaded()) {
      try {
        await this.loadModel(s.modelPath);
      } catch (e) {
        this.sys(`model restore failed: ${String(e)}`);
      }
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
      expressions: this.renderer.info?.expressions ?? [],
      emotionMap: this.emotionMap(),
      mascot: s.mascotOn,
      tts: s.ttsEnabled,
      ttsAvailable: new SpeechSynthesisTts().available(),
      speaking: this.speech.speaking,
      busy: this.turnBusy,
      agentConnected: this.acp.connected(),
      lang: this.lang,
    };
  }

  emotions(): readonly string[] {
    return DEFAULT_EMOTIONS;
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
    await this.settings.patch({ modelPath: path });
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
      if (u.text) {
        utterances.push(u);
        this.speech.enqueue(u);
      }
    });
    seg.feed(text);
    seg.flush();
    return utterances;
  }

  /** 한 대화 턴 — acp(claude) 스트리밍을 문장 단위로 실시간 발화한다. 완료 후 전체 응답 반환. */
  async chat(text: string): Promise<{ reply: string; utterances: Utterance[] }> {
    if (this.turnBusy) throw new Error("turn already in flight");
    this.turnBusy = true;
    this.emit({ kind: "state" });
    this.pushChat({ who: "user", text });
    const utterances: Utterance[] = [];
    const seg = new StreamSegmenter((sentence) => {
      const u = extractEmotion(sentence, DEFAULT_EMOTIONS);
      if (u.text) {
        utterances.push(u);
        this.speech.enqueue(u);
        this.pushChat({ who: "char", text: u.text });
      }
    });
    try {
      const r = await this.acp.ask(text, personaPreamble(DEFAULT_EMOTIONS), (delta) =>
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
      return { reply, utterances };
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
    this.emit({ kind: "subtitle", text: "" });
    this.emit({ kind: "state" });
  }

  dispose(): void {
    this.speech.cancel();
    this.acp.dispose();
    this.renderer.dispose();
    this.listeners.clear();
  }
}
