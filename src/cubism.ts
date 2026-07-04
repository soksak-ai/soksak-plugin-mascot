// Cubism Core 런타임 로더 — 프로프라이어터리(© Live2D Inc.)라 repo/번들 미포함이 라이선스 불변식.
// 경로: (1) window 에 이미 있음 → 즉시 (2) app.data.kv 캐시 → Blob <script> 주입
//       (3) 동의(accept) 시 공식 CDN 에서 Rust 측 http(GET, CORS 무관)로 수령 → 캐시 → 주입.
// 동의 없이 다운로드하지 않는다 — cubism.install 커맨드/설정 카드 버튼만이 accept 를 전달한다.
import type { HostApp } from "@/types";

export const CUBISM_CDN_URL =
  "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
export const CUBISM_LICENSE_URL = "https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html";

const CACHE_KEY = "cubism-core-js";

declare global {
  interface Window {
    Live2DCubismCore?: unknown;
  }
}

export function cubismLoaded(): boolean {
  return typeof window.Live2DCubismCore !== "undefined";
}

let injecting: Promise<void> | null = null;

async function injectScript(jsText: string): Promise<void> {
  if (cubismLoaded()) return;
  if (injecting) return injecting;
  injecting = new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([jsText], { type: "text/javascript" }));
    const el = document.createElement("script");
    el.id = "soksak-vtuber-cubism-core";
    el.src = url;
    el.onload = () => {
      URL.revokeObjectURL(url);
      cubismLoaded() ? resolve() : reject(new Error("Cubism Core script loaded but global missing"));
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Cubism Core script failed to evaluate"));
    };
    document.head.appendChild(el);
  }).finally(() => {
    injecting = null;
  });
  return injecting;
}

/** 캐시에서만 로드 시도(다운로드 없음). 성공 여부 반환. */
export async function ensureFromCache(app: HostApp): Promise<boolean> {
  if (cubismLoaded()) return true;
  try {
    const cached = (await app.data?.kv.get(CACHE_KEY)) as string | null;
    if (typeof cached === "string" && cached.length > 0) {
      await injectScript(cached);
      return true;
    }
  } catch (e) {
    console.error("[vtuber] cubism 캐시 로드 실패:", e);
  }
  return false;
}

/** 동의 하에 공식 CDN 다운로드 → 캐시 → 주입. accept=false 면 라이선스 오류를 던진다. */
export async function install(app: HostApp, accept: boolean): Promise<void> {
  if (cubismLoaded()) return;
  if (await ensureFromCache(app)) return;
  if (!accept) {
    throw new Error(
      `Cubism Core is proprietary (© Live2D Inc.) and not bundled. Pass accept=true after agreeing to the Live2D license: ${CUBISM_LICENSE_URL}`,
    );
  }
  if (!app.network?.http) throw new Error("network permission unavailable — cannot download Cubism Core");
  const res = await app.network.http({ method: "GET", url: CUBISM_CDN_URL });
  if (res.status !== 200 || !res.body) {
    throw new Error(`Cubism Core download failed: HTTP ${res.status}`);
  }
  await app.data?.kv.set(CACHE_KEY, res.body);
  await injectScript(res.body);
}
