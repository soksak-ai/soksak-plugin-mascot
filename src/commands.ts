// 명령 카탈로그 — 전 기능이 커맨드로 노출된다(CLI/MCP/소켓 E2E 자가검증 원칙).
// 뷰와 커맨드는 같은 엔진 오퍼레이션을 부른다(표면≡커맨드 등가). description=영어 base,
// triggers.ko=한국어 트리거어 합성(i18n 두 축).
import type { PluginCtx } from "@/types";
import type { VtubeTtsEngine } from "@/engine";
import type { MascotOverlay } from "@/mascot";
import { DEFAULT_EMOTIONS } from "@/pipeline";

const VERSION = "1.0.0";

export function registerCommands(ctx: PluginCtx, engine: VtubeTtsEngine, mascot: MascotOverlay): void {
  const app = ctx.app;
  if (!app.commands?.register) return;
  const reg = (name: string, spec: Parameters<typeof app.commands.register>[1]) =>
    ctx.subscriptions.push(app.commands.register(name, spec));

  reg("ping", {
    description: "Health check — plugin load/version probe (E2E).",
    triggers: { ko: "브이튜브 플러그인 상태 점검 핑" },
    handler: () => ({ ok: true, plugin: "soksak-plugin-vtube-tts", version: VERSION }),
  });

  reg("state", {
    description:
      "Read current plugin state: cubism runtime, loaded model, expressions, emotion map, mascot/tts/speaking/busy flags.",
    triggers: { ko: "브이튜브 상태 조회 모델 마스코트 음성" },
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
      const mouth = p.probe === true ? engine.renderer.mouthDiag() : undefined;
      return {
        ok: true,
        ...st,
        ...(probe !== undefined ? { probe } : {}),
        ...(png !== undefined ? { png } : {}),
        ...(voices !== undefined ? { voices } : {}),
        ...(mouth !== undefined ? { mouth } : {}),
      };
    },
  });

  reg("say", {
    // 낭독 수행 명령 — 실행 기록이 다시 낭독되면 무한 전파. 스펙 차원의 유일한 차단점.
    tts: false,
    description:
      "Speak text locally without the LLM — runs the sentence/emotion/speech pipeline. Emotion tags like [joy] are honored.",
    triggers: { ko: "브이튜브 대사 발화 말하기 자막" },
    params: {
      text: { type: "string", description: "text to speak (may contain [emotion] tags)", required: true },
    },
    returns: "{ ok, utterances:[{text, emotion}] }",
    examples: ['sok plugin.soksak-plugin-vtube-tts.say \'{"text":"[joy] 반가워요!"}\''],
    handler: (p) => {
      const text = String(p.text ?? "").trim();
      if (!text) return { ok: false, error: "text required" };
      const utterances = engine.speakText(text);
      return { ok: true, utterances };
    },
  });

  reg("stop", {
    tts: false, // 낭독 제어 계열 — say 와 동일하게 침묵
    description: "Stop current speech.",
    triggers: { ko: "브이튜브 발화 중단 정지" },
    handler: async () => {
      await engine.stop();
      return { ok: true };
    },
  });

  reg("cubism.install", {
    description:
      "Download and cache the proprietary Live2D Cubism Core runtime from the official CDN. Requires accept=true (license consent).",
    triggers: { ko: "브이튜브 큐비즘 코어 설치 다운로드 라이선스 동의" },
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

  reg("model.list", {
    description:
      "List Live2D characters found under the models directory (modelsDir setting; default = <plugin>/models).",
    triggers: { ko: "브이튜브 캐릭터 목록 모델 스캔" },
    returns: "{ ok, models: [{name, path}] }",
    handler: async () => ({ ok: true, models: await engine.listModels() }),
  });

  reg("model.load", {
    description: "Load a Live2D Cubism 3+ model from a local .model3.json path (user-owned model).",
    triggers: { ko: "브이튜브 라이브2D 모델 로드 불러오기 교체" },
    params: {
      path: { type: "string", description: "absolute path to .model3.json", required: true },
    },
    returns: "{ ok, path, expressions, motionGroups }",
    examples: ['sok plugin.soksak-plugin-vtube-tts.model.load \'{"path":"/Users/me/models/hiyori/hiyori.model3.json"}\''],
    handler: async (p) => {
      const info = await engine.loadModel(String(p.path ?? ""));
      mascot.sync();
      return { ok: true, ...info };
    },
  });

  reg("expression.list", {
    description: "List expressions defined by the loaded model, plus the active emotion→expression map.",
    triggers: { ko: "브이튜브 표정 목록 조회" },
    handler: () => {
      const st = engine.state();
      if (!st.model) return { ok: false, error: "no model loaded" };
      return { ok: true, expressions: st.expressions, emotionMap: st.emotionMap };
    },
  });

  reg("expression.set", {
    description:
      "Apply an expression by model expression name, or an emotion name (mapped via emotion map). 'neutral' resets.",
    triggers: { ko: "브이튜브 표정 적용 변경" },
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
    triggers: { ko: "브이튜브 감정 표정 매핑 설정" },
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

  reg("motion.play", {
    description:
      'Play a model motion. group = a Motions group from the model (often "Idle" and "" for tap motions); omit index for a random one in the group.',
    triggers: { ko: "브이튜브 모션 재생 동작 움직임" },
    params: {
      group: { type: "string", description: 'motion group name ("" = default group)', required: false },
      index: { type: "number", description: "motion index within the group (omit = random)", required: false },
    },
    examples: ['sok plugin.soksak-plugin-vtube-tts.motion.play \'{"group":""}\''],
    handler: async (p) => {
      const st = engine.state();
      if (!st.model) return { ok: false, error: "no model loaded" };
      const group = typeof p.group === "string" ? p.group : "";
      const index = typeof p.index === "number" ? p.index : undefined;
      const played = await engine.renderer.playMotion(group, index);
      return { ok: played, group, ...(index !== undefined ? { index } : {}) };
    },
  });

  reg("mascot.toggle", {
    tts: false, // 표시 제어 계열 — 낭독 기계의 자기 조작은 읽지 않는다(say/stop 과 같은 가족)
    description: "Toggle the screen mascot overlay (avatar floats over the whole app, click-through).",
    triggers: { ko: "브이튜브 마스코트 화면 오버레이 켜기 끄기" },
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
    tts: false, // 표시 제어 계열
    description: "Toggle speech output (subtitles always shown).",
    triggers: { ko: "브이튜브 음성 출력 켜기 끄기 토글" },
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
