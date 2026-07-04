// 공용 타입 — 호스트 app API 는 구조적 타이핑(플러그인은 코어 타입 패키지에 비의존).
export interface Disposable {
  dispose(): void;
}

export interface HostApp {
  locale?: () => string;
  ui: {
    registerView(
      id: string,
      provider: {
        mount(container: HTMLElement, ctx: ViewCtx): void;
        unmount?(container: HTMLElement): void;
      },
    ): Disposable;
  };
  commands: {
    register(name: string, spec: CommandSpec): Disposable;
    execute(name: string, params?: Record<string, unknown>): Promise<any>;
  };
  bus: {
    emit(topic: string, payload: unknown): void;
    on(topic: string, fn: (payload: any) => void): Disposable;
  };
  events?: { on(event: string, fn: (payload: any) => void): Disposable };
  data?: {
    kv: {
      get(key: string): Promise<unknown>;
      set(key: string, value: unknown): Promise<void>;
      delete(key: string): Promise<boolean>;
    };
  };
  fs?: {
    readText(path: string, offset?: number): Promise<{ text: string; truncated: boolean }>;
    url(path: string): Promise<string>;
  };
  network?: {
    http(req: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: string;
    }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  };
  notify?: { show?: (opts: { title: string; body?: string }) => void };
  process?: {
    spawn(
      cmd: string,
      args?: string[],
      opts?: { cwd?: string; env?: Record<string, string>; envRemove?: string[] },
    ): Promise<number>;
    write(handle: number, data: string): Promise<void>;
    closeStdin(handle: number): Promise<void>;
    onData(handle: number, cb: (bytes: Uint8Array) => void): Disposable;
    onStderr(handle: number, cb: (bytes: Uint8Array) => void): Disposable;
    onExit(handle: number, cb: (code: number) => void): Disposable;
    kill(handle: number): Promise<void>;
  };
  settings: {
    get(key: string): unknown;
    all(): Record<string, unknown>;
    onChange(cb: (all: Record<string, unknown>) => void): Disposable;
  };
}

export interface ViewCtx {
  setStatus(status: { code: string; message?: string } | null): void;
  setTitle(title: string): void;
  setBadge(badge: number | "dot" | null): void;
}

export interface CommandSpec {
  description: string;
  triggers?: { ko?: string };
  params?: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "json" | "string[]" | "number[]";
      description: string;
      required?: boolean;
      enum?: readonly string[];
      default?: unknown;
    }
  >;
  returns?: string;
  danger?: "destructive" | "inject";
  examples?: readonly string[];
  handler(params: Record<string, unknown>): Promise<object> | object;
}

export interface PluginCtx {
  app: HostApp;
  subscriptions: Array<Disposable | (() => void)>;
}

// 한 문장 발화 단위 — 파이프라인의 유통 화폐.
export interface Utterance {
  text: string; // 태그 제거된 표시/발화 텍스트
  emotion: string | null; // 추출된 감정 태그(예: "joy") — 없으면 null
}
