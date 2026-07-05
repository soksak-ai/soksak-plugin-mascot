// 사이드카 TTS — soksak-sidecar-speech-sherpa(stdio JSON-lines, soksak-sidecar-speech-spec@1)를
// app.process 로 상주시키고, stream:true 청크(s16le PCM)를 Web Audio 로 이어붙여 재생한다.
// 립싱크는 AnalyserNode 실측 진폭(재생과 동기) — OS TTS 폴백만 의사 파형을 쓴다.
import type { Disposable, HostApp } from "@/types";
import type { TtsEngine } from "@/tts";

interface Pending {
  onChunk(pcm: Uint8Array, sampleRate: number): void;
  onDone(ok: boolean, message?: string): void;
}

export interface SidecarInfo {
  engine: string;
  model: string;
  sampleRate: number;
  numSpeakers: number;
}

/** 사이드카 프로세스 + 라인 프로토콜 클라이언트(요청 id 라우팅, 설정 변경 시 재기동). */
class SpeechSidecarProc {
  private handle: number | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private subs: Disposable[] = [];
  private starting: Promise<boolean> | null = null;
  private spawnedSig = ""; // 스폰 당시 설정 시그니처 — 달라지면 재기동(모델/엔진 라이브 교체)
  info: SidecarInfo | null = null;

  constructor(
    private app: HostApp,
    private opts: { bin(): string; modelDir(): string; engine(): string },
  ) {}

  private sig(): string {
    return `${this.opts.bin()}|${this.opts.modelDir()}|${this.opts.engine() || "vits"}`;
  }

  configured(): boolean {
    return this.opts.bin().length > 0 && this.opts.modelDir().length > 0;
  }

  running(): boolean {
    return this.handle != null;
  }

  private failAll(message: string): void {
    for (const p of this.pending.values()) p.onDone(false, message);
    this.pending.clear();
  }

  private teardown(): void {
    for (const s of this.subs) s.dispose();
    this.subs = [];
    this.handle = null;
    this.buf = "";
  }

  async ensure(): Promise<boolean> {
    // 설정(바이너리/모델/엔진)이 바뀌었으면 재기동 — 다른 모델 음성으로 라이브 전환.
    if (this.handle != null && this.spawnedSig !== this.sig()) {
      const h = this.handle;
      this.teardown();
      void this.app.process?.kill(h).catch(() => {});
    }
    if (this.handle != null) return true;
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<boolean> {
    const proc = this.app.process;
    if (!proc || !this.configured()) return false;
    try {
      const handle = await proc.spawn(this.opts.bin(), [
        "--model-dir",
        this.opts.modelDir(),
        "--engine",
        this.opts.engine() || "vits",
      ]);
      this.handle = handle;
      this.spawnedSig = this.sig();
      this.subs.push(
        proc.onData(handle, (bytes: Uint8Array) => this.feed(bytes)),
        proc.onExit(handle, (code: number) => {
          console.warn("[vtube-tts] speech sidecar exited:", code);
          this.failAll(`sidecar exited (${code})`);
          this.teardown(); // 다음 speak 에서 재기동
        }),
      );
      // info 1회 — 화자 수(sid 범위)·샘플레이트를 상태에 노출(멀티스피커 모델 안내).
      const id = this.nextId++;
      this.pending.set(id, {
        onChunk: () => {},
        onDone: () => {},
      });
      void proc.write(handle, JSON.stringify({ id, op: "info" }) + "\n").catch(() => {});
      return true;
    } catch (e) {
      console.error("[vtube-tts] speech sidecar spawn 실패:", e);
      this.teardown();
      return false;
    }
  }

  private feed(bytes: Uint8Array): void {
    this.buf += new TextDecoder().decode(bytes);
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // 로그 오염 등 비 JSON 줄 무시(프로토콜 줄만 소비)
      }
      if (typeof msg.spec === "string" && typeof msg.sampleRate === "number") {
        this.info = {
          engine: String(msg.engine ?? ""),
          model: String(msg.model ?? ""),
          sampleRate: msg.sampleRate,
          numSpeakers: Number(msg.numSpeakers ?? 1),
        };
      }
      const p = this.pending.get(msg.id);
      if (!p) continue;
      if (typeof msg.pcmBase64 === "string") {
        const bin = atob(msg.pcmBase64);
        const pcm = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
        p.onChunk(pcm, msg.sampleRate ?? 22050);
      }
      if (msg.done === true || msg.ok === false) {
        this.pending.delete(msg.id);
        p.onDone(msg.ok === true, msg.message);
      }
    }
  }

  /** 스트리밍 tts 요청 — 청크/종결 콜백. 반환=요청 id(취소 식별용). */
  async tts(text: string, lang: string, sid: number, speed: number, p: Pending): Promise<number | null> {
    if (!(await this.ensure()) || this.handle == null) return null;
    const id = this.nextId++;
    this.pending.set(id, p);
    try {
      await this.app.process!.write(
        this.handle,
        JSON.stringify({ id, op: "tts", stream: true, text, lang, sid, speed }) + "\n",
      );
      return id;
    } catch (e) {
      this.pending.delete(id);
      p.onDone(false, String(e));
      return null;
    }
  }

  abandon(id: number): void {
    this.pending.delete(id); // 사이드카는 계속 합성하지만 결과를 버린다(짧은 문장 — 중단 RPC 는 M2b 에서)
  }

  dispose(): void {
    const h = this.handle;
    this.teardown();
    if (h != null) void this.app.process?.kill(h).catch(() => {});
    this.failAll("disposed");
  }
}

/** TtsEngine 구현 — 청크를 Web Audio 로 갭리스 스케줄 + AnalyserNode 진폭을 onLevel 로 보고. */
export class SidecarTts implements TtsEngine {
  private proc: SpeechSidecarProc;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private playing = new Set<AudioBufferSourceNode>();
  private raf = 0;
  private peak = 0.04; // 러닝 피크(감쇠 0.995/frame) — 레벨 정규화 기준
  private curReq: number | null = null;

  constructor(
    app: HostApp,
    private opts: {
      bin(): string;
      modelDir(): string;
      engine(): string;
      speakerId(): number;
      speed(): number;
    },
    private onLevel: (v: number) => void,
  ) {
    this.proc = new SpeechSidecarProc(app, opts);
  }

  available(): boolean {
    return this.proc.configured();
  }

  running(): boolean {
    return this.proc.running();
  }

  info(): SidecarInfo | null {
    return this.proc.info;
  }

  private ensureCtx(): { ctx: AudioContext; analyser: AnalyserNode } {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.ctx.destination);
    }
    return { ctx: this.ctx, analyser: this.analyser! };
  }

  private levelLoop(): void {
    if (this.raf) return;
    const data = new Uint8Array(256);
    const tick = () => {
      if (this.playing.size === 0) {
        this.raf = 0;
        this.onLevel(0);
        return;
      }
      this.analyser!.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const d = (data[i] - 128) / 128;
        sum += d * d;
      }
      // RMS → 러닝 피크 정규화(0..1) — 고정 상수 나눗셈은 조용한 음성에서 값이 죽는다.
      const rms = Math.sqrt(sum / data.length);
      this.peak = Math.max(this.peak * 0.995, rms, 0.04);
      this.onLevel(Math.min(1, rms / this.peak));
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  speak(text: string, lang: string): Promise<void> {
    return this.speakChecked(text, lang).then(() => {});
  }

  /** 발화 시도 — 실제로 오디오가 나갔는지 반환(false = 사이드카 불능, 상위가 폴백 판단). */
  speakChecked(text: string, lang: string): Promise<boolean> {
    return new Promise((resolve) => {
      let gotAudio = false;
      const { ctx, analyser } = this.ensureCtx();
      if (ctx.state === "suspended") void ctx.resume();
      let nextAt = 0; // 갭리스 스케줄 커서
      let done = false;
      let reqId: number | null = null;
      const finish = () => {
        if (this.curReq === reqId) this.curReq = null;
        resolve(gotAudio);
      };
      const maybeFinish = () => {
        // done 수신 후 마지막 소스 종료까지 대기
        if (done && this.playing.size === 0) finish();
      };
      void this.proc
        .tts(text, lang.slice(0, 2).toLowerCase(), this.opts.speakerId(), this.opts.speed(), {
          onChunk: (pcm, sampleRate) => {
            const n = pcm.byteLength >> 1;
            if (n === 0) return;
            gotAudio = true;
            const i16 = new Int16Array(pcm.buffer, pcm.byteOffset, n);
            const buf = ctx.createBuffer(1, n, sampleRate);
            const ch = buf.getChannelData(0);
            for (let i = 0; i < n; i++) ch[i] = i16[i] / 32768;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(analyser);
            const now = ctx.currentTime;
            const at = Math.max(now + 0.02, nextAt);
            nextAt = at + buf.duration;
            this.playing.add(src);
            src.onended = () => {
              this.playing.delete(src);
              maybeFinish();
            };
            src.start(at);
            this.levelLoop();
          },
          onDone: (ok, message) => {
            done = true;
            if (!ok && message) console.warn("[vtube-tts] sidecar tts:", message);
            maybeFinish();
          },
        })
        .then((id) => {
          reqId = id;
          this.curReq = id;
          if (id == null) {
            done = true;
            maybeFinish(); // spawn/전송 실패 — 큐(상위)가 계속 진행하도록 resolve
          }
        });
    });
  }

  cancel(): void {
    if (this.curReq != null) {
      this.proc.abandon(this.curReq);
      this.curReq = null;
    }
    for (const src of this.playing) {
      try {
        src.stop();
      } catch {
        /* 이미 종료 */
      }
    }
    this.playing.clear();
    this.onLevel(0);
  }

  dispose(): void {
    this.cancel();
    this.proc.dispose();
    if (this.raf) cancelAnimationFrame(this.raf);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
