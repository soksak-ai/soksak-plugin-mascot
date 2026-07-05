// 설정 단일 진실 — app.data.kv("settings") 한 키에 JSON. 멱등 load/save.
// Cubism Core JS 캐시는 별도 키(cubism-core-js) — 설정과 수명이 다르다(라이선스 산출물).
import type { HostApp } from "@/types";

// 모델 경로는 여기 없다 — 코어 선언형 설정(manifest configuration "modelPath")이 단일 진실.
export interface VtubeTtsSettings {
  ttsEnabled: boolean;
  mascotOn: boolean;
  cubismAccepted: boolean;
  // 모델 경로별 감정→표정 매핑(모델마다 표정 이름이 다르다). 값 = 표정 Name.
  emotionMaps: Record<string, Record<string, string>>;
}

const DEFAULTS: VtubeTtsSettings = {
  ttsEnabled: true,
  mascotOn: false,
  cubismAccepted: false,
  emotionMaps: {},
};

const KEY = "settings";

export class SettingsStore {
  private cur: VtubeTtsSettings = { ...DEFAULTS };

  constructor(private app: HostApp) {}

  get(): VtubeTtsSettings {
    return this.cur;
  }

  async load(): Promise<VtubeTtsSettings> {
    try {
      const raw = (await this.app.data?.kv.get(KEY)) as Partial<VtubeTtsSettings> | null;
      if (raw && typeof raw === "object") this.cur = { ...DEFAULTS, ...raw };
    } catch (e) {
      console.error("[vtube-tts] settings load 실패:", e);
    }
    return this.cur;
  }

  async patch(p: Partial<VtubeTtsSettings>): Promise<VtubeTtsSettings> {
    this.cur = { ...this.cur, ...p };
    try {
      await this.app.data?.kv.set(KEY, this.cur);
    } catch (e) {
      console.error("[vtube-tts] settings save 실패:", e);
    }
    return this.cur;
  }

  async setEmotionMap(modelPath: string, map: Record<string, string>): Promise<void> {
    await this.patch({ emotionMaps: { ...this.cur.emotionMaps, [modelPath]: map } });
  }
}
