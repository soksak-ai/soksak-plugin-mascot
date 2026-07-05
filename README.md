# soksak-plugin-vtuber

Live2D avatar companion for soksak. Chat with a local AI agent; the avatar answers with a natural local voice, amplitude-driven lip sync, expressions, and subtitles. Works as a content panel view and as a click-through screen mascot overlay.

한국어: [README.ko.md](README.ko.md)

## What it does

- Renders a Live2D Cubism 3+ model (`.model3.json`) with WebGL (pixi.js + pixi-live2d-display) in a panel view or a floating mascot overlay.
- Chat backends: a resident `claude -p` process (`claude-bare`, lowest first-token latency) or the agents-acp runtime (Claude / Codex / Gemini). Conversation continuity is kept across turns.
- Speech: a local neural TTS sidecar ([soksak-sidecar-speech-sherpa](https://github.com/soksak-ai/soksak-sidecar-speech-sherpa) — Supertonic / VITS / Kokoro engines) streams PCM chunks into Web Audio; the OS voice (`speechSynthesis`) is the zero-install fallback.
- Lip sync is measured: an AnalyserNode tracks playback amplitude and drives the model's `LipSync` group parameters each frame.
- Emotion tags (`[joy]`, `[sadness]`, …) switch expressions; Supertonic 3 expression tags (`<laugh>`, `<breath>`, `<sigh>`) render as actual vocal expressions and are hidden from subtitles.
- Everything is a command — the UI and the CLI drive the same engine operations.

## Settings

| Key | Meaning |
| --- | --- |
| `modelPath` | Character `.model3.json` (live switch) |
| `agent` / `agentModel` | Chat backend and model id |
| `speechSidecarBin` / `speechModelDir` / `speechEngine` | Local TTS sidecar (binary, model dir, `vits`/`kokoro`/`supertonic`) |
| `speechSpeakerId` / `speechSpeed` | Voice style (0-based) and rate |
| `voiceName` | OS-voice fallback pick |

## Requirements and licensing

- **Live2D Cubism Core is not bundled.** It is proprietary (© Live2D Inc.). On first use the plugin asks for consent and downloads it from the official Live2D CDN, caching it locally. Publishing an app that uses the Cubism SDK may require a Live2D publication license depending on your revenue — see Live2D's terms.
- **No models are bundled** (avatar or speech). Point the plugin at assets you own or are licensed to use. Cubism 2 (`.moc`) models are not supported.
- The pipeline design is informed by the MIT-licensed [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) project; no code was copied.
- `npm run license-gate` asserts that no proprietary artifacts (Cubism Core, `.moc3`, `.model3.json`) are committed or inlined in the bundle.

## Commands

Command names are plugin-relative; the full registry address is `plugin.soksak-plugin-vtuber.<name>` (e.g. `sok plugin.soksak-plugin-vtuber.chat '{"text":"hi"}'`).

| Command | Description |
| --- | --- |
| `ping` | Load/version probe |
| `state` | State (`probe`/`png`/`voices` flags add diagnostics) |
| `chat {text}` | One agent turn, spoken + subtitled (returns timing) |
| `say {text}` | Speak locally without the LLM (honors `[emotion]` and `<laugh>` tags) |
| `stop` | Stop speech, cancel the turn |
| `cubism.install {accept}` | Consent + download Cubism Core |
| `model.load {path}` | Load `.model3.json` |
| `expression.list` / `expression.set {name}` | Expressions |
| `emotion.map {map}` | Emotion→expression mapping |
| `mascot.toggle {on?}` | Screen mascot overlay |
| `tts.toggle {on?}` | Voice output |

## Development

```sh
npm install
npm run build        # esbuild → main.js
npm run typecheck
npm test             # pipeline unit tests
npm run license-gate
```

Install as a dev plugin: check out this repo into `~/.soksak/plugins/soksak-plugin-vtuber` with `.soksak.json` `{"version":"dev"}`, then reload plugins.
