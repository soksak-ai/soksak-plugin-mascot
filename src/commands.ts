// 명령 카탈로그 — 전 기능이 커맨드로 노출된다(CLI/MCP/소켓 E2E 자가검증 원칙).
// 뷰와 커맨드는 같은 엔진 오퍼레이션을 부른다(표면≡커맨드 등가). description=영어 base,
// triggers.ko=한국어 트리거어 합성(i18n 두 축).
import type { PluginCtx } from "@/types";
import type { VtuberEngine } from "@/engine";
import type { MascotOverlay } from "@/mascot";
import { DEFAULT_EMOTIONS } from "@/pipeline";

const VERSION = "0.1.0";

export function registerCommands(ctx: PluginCtx, engine: VtuberEngine, mascot: MascotOverlay): void {
  const app = ctx.app;
  if (!app.commands?.register) return;
  const reg = (name: string, spec: Parameters<typeof app.commands.register>[1]) =>
    ctx.subscriptions.push(app.commands.register(name, spec));

  reg("ping", {
    description: "Health check — plugin load/version probe (E2E).",
    triggers: { ko: "브이튜버 플러그인 상태 점검 핑" },
    handler: () => ({ ok: true, plugin: "soksak-plugin-vtuber", version: VERSION }),
  });

  reg("state", {
    description:
      "Read current plugin state: cubism runtime, loaded model, expressions, emotion map, mascot/tts/speaking/busy flags.",
    triggers: { ko: "브이튜버 상태 조회 모델 마스코트 음성" },
    params: {
      probe: {
        type: "boolean",
        description: "true = include framebuffer pixel probe (draw verification, E2E)",
        required: false,
      },
      png: {
        type: "boolean",
        description: "true = include framebuffer PNG as base64 (visual E2E)",
        required: false,
      },
      voices: {
        type: "boolean",
        description: "true = include available OS voices (pick one for the voiceName setting)",
        required: false,
      },
    },
    returns: "state object",
    handler: async (p) => {
      const st = engine.state();
      const probe = p.probe === true ? await engine.renderer.probePixels() : undefined;
      const png = p.png === true ? await engine.renderer.probePng() : undefined;
      const voices = p.voices === true ? engine.listVoices() : undefined;
      return {
        ok: true,
        ...st,
        ...(probe !== undefined ? { probe } : {}),
        ...(png !== undefined ? { png } : {}),
        ...(voices !== undefined ? { voices } : {}),
      };
    },
  });

  reg("chat", {
    description:
      "Send one chat turn to the local agent (claude via acp). Streams sentences to speech/expressions; resolves with the full reply.",
    triggers: { ko: "브이튜버 캐릭터와 대화 채팅 말걸기" },
    params: {
      text: { type: "string", description: "user message", required: true },
    },
    returns: "{ ok, reply, utterances:[{text, emotion}] }",
    examples: ['vtuber.chat {"text":"안녕!"}'],
    handler: async (p) => {
      const text = String(p.text ?? "").trim();
      if (!text) return { ok: false, error: "text required" };
      const r = await engine.chat(text);
      return { ok: true, reply: r.reply, utterances: r.utterances };
    },
  });

  reg("say", {
    description:
      "Speak text locally without the LLM — runs the sentence/emotion/speech pipeline. Emotion tags like [joy] are honored.",
    triggers: { ko: "브이튜버 대사 발화 말하기 자막" },
    params: {
      text: { type: "string", description: "text to speak (may contain [emotion] tags)", required: true },
    },
    returns: "{ ok, utterances:[{text, emotion}] }",
    examples: ['vtuber.say {"text":"[joy] 반가워요!"}'],
    handler: (p) => {
      const text = String(p.text ?? "").trim();
      if (!text) return { ok: false, error: "text required" };
      const utterances = engine.speakText(text);
      return { ok: true, utterances };
    },
  });

  reg("stop", {
    description: "Stop current speech and cancel the in-flight agent turn.",
    triggers: { ko: "브이튜버 발화 중단 정지" },
    handler: async () => {
      await engine.stop();
      return { ok: true };
    },
  });

  reg("cubism.install", {
    description:
      "Download and cache the proprietary Live2D Cubism Core runtime from the official CDN. Requires accept=true (license consent).",
    triggers: { ko: "브이튜버 큐비즘 코어 설치 다운로드 라이선스 동의" },
    params: {
      accept: {
        type: "boolean",
        description: "true = you accept the Live2D Proprietary Software License",
        required: true,
      },
    },
    handler: async (p) => {
      await engine.installCubism(p.accept === true);
      return { ok: true, cubism: true };
    },
  });

  reg("model.load", {
    description: "Load a Live2D Cubism 3+ model from a local .model3.json path (user-owned model).",
    triggers: { ko: "브이튜버 라이브2D 모델 로드 불러오기 교체" },
    params: {
      path: { type: "string", description: "absolute path to .model3.json", required: true },
    },
    returns: "{ ok, path, expressions, motionGroups }",
    examples: ['vtuber.model.load {"path":"/Users/me/models/hiyori/hiyori.model3.json"}'],
    handler: async (p) => {
      const info = await engine.loadModel(String(p.path ?? ""));
      mascot.sync();
      return { ok: true, ...info };
    },
  });

  reg("expression.list", {
    description: "List expressions defined by the loaded model, plus the active emotion→expression map.",
    triggers: { ko: "브이튜버 표정 목록 조회" },
    handler: () => {
      const st = engine.state();
      if (!st.model) return { ok: false, error: "no model loaded" };
      return { ok: true, expressions: st.expressions, emotionMap: st.emotionMap };
    },
  });

  reg("expression.set", {
    description:
      "Apply an expression by model expression name, or an emotion name (mapped via emotion map). 'neutral' resets.",
    triggers: { ko: "브이튜버 표정 적용 변경" },
    params: {
      name: { type: "string", description: "expression name or emotion (e.g. joy)", required: true },
    },
    handler: async (p) => {
      const name = String(p.name ?? "");
      const st = engine.state();
      if (!st.model) return { ok: false, error: "no model loaded" };
      const target = (DEFAULT_EMOTIONS as readonly string[]).includes(name)
        ? name === "neutral"
          ? "neutral"
          : (st.emotionMap[name] ?? "neutral")
        : name;
      const applied = await engine.renderer.setExpression(target);
      return { ok: applied, applied: target };
    },
  });

  reg("emotion.map", {
    description:
      "Set emotion→expression mapping for the loaded model. Keys must be known emotions; values must be model expression names.",
    triggers: { ko: "브이튜버 감정 표정 매핑 설정" },
    params: {
      map: { type: "json", description: 'e.g. {"joy":"F01","anger":"F03"}', required: true },
    },
    handler: async (p) => {
      const map = p.map as Record<string, string>;
      if (!map || typeof map !== "object") return { ok: false, error: "map (json object) required" };
      await engine.setEmotionMap(map);
      return { ok: true, emotionMap: map };
    },
  });

  reg("mascot.toggle", {
    description: "Toggle the screen mascot overlay (avatar floats over the whole app, click-through).",
    triggers: { ko: "브이튜버 마스코트 화면 오버레이 켜기 끄기" },
    params: {
      on: { type: "boolean", description: "explicit state; omit to flip", required: false },
    },
    handler: async (p) => {
      const cur = engine.state().mascot;
      const next = typeof p.on === "boolean" ? p.on : !cur;
      await engine.setMascot(next);
      mascot.sync();
      return { ok: true, mascot: next };
    },
  });

  reg("tts.toggle", {
    description: "Toggle speech output (subtitles always shown).",
    triggers: { ko: "브이튜버 음성 출력 켜기 끄기 토글" },
    params: {
      on: { type: "boolean", description: "explicit state; omit to flip", required: false },
    },
    handler: async (p) => {
      const cur = engine.state().tts;
      const next = typeof p.on === "boolean" ? p.on : !cur;
      await engine.setTts(next);
      return { ok: true, tts: next };
    },
  });
}
