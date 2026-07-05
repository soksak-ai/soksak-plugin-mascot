# soksak-plugin-vtube-tts

Character presentation engine for soksak — a Live2D mascot with a local neural voice. **No views of its own**: everything is a command, so other plugins (an activity-log narrator, chat UIs) drive the character.

한국어: [README.ko.md](README.ko.md)

## What it provides

- Live2D Cubism 3+ rendering in a click-through screen mascot overlay (the engine's only surface)
- Local neural TTS sidecar ([soksak-sidecar-speech-sherpa](https://github.com/soksak-ai/soksak-sidecar-speech-sherpa): Supertonic / VITS / Kokoro) with gapless PCM streaming, OS-voice fallback, and measured amplitude lip-sync
- Emotion tags (`[joy]` …) switch expressions; Supertonic 3 inline tags (`<laugh>` `<breath>` `<sigh>`) render as vocal expressions and are hidden from any text surface
- Motions (`motion.play`), per-model emotion→expression maps, live model/voice switching via settings

## Narration spec (MESSAGE-PROTOCOL tts)

`say`/`stop` declare `tts: false` in their command specs: executions of the narration engine itself are never narrated by activity-log consumers — the single cut that prevents infinite propagation.

## Commands

Full registry address: `plugin.soksak-plugin-vtube-tts.<name>`.

| Command | Description |
| --- | --- |
| `ping` / `state` | Probe / full state (probe/png/voices diagnostics) |
| `say {text}` | Speak (sentence pipeline, `[emotion]`/`<laugh>` honored) — spec tts:false |
| `stop` | Stop speech — spec tts:false |
| `cubism.install {accept}` | Consent + download Cubism Core (proprietary, never bundled) |
| `model.list` / `model.load {path}` | Characters under `modelsDir` (default `<plugin>/models`) |
| `expression.list` / `expression.set {name}` / `emotion.map {map}` | Expressions |
| `motion.play {group?, index?}` | Play a model motion |
| `mascot.toggle {on?}` | Show/hide the screen mascot |
| `tts.toggle {on?}` | Voice on/off |

## Onboarding (no view — commands only)

1. `cubism.install {"accept":true}` after reading the Live2D license
2. Put a Cubism 3+ model folder under `models/` (not bundled — bring your own) and `model.load` it, or set `modelPath`
3. `mascot.toggle {"on":true}` → the character appears; `say` to speak

## Licensing

Cubism Core and models are never bundled or committed (`npm run license-gate` enforces it). Pipeline design informed by MIT-licensed Open-LLM-VTuber; no code copied.
