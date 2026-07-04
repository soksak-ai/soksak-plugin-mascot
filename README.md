# soksak-plugin-vtuber

Live2D avatar companion for soksak. Chat with a local AI agent; the avatar reacts with expressions, subtitles, and speech. Works as a content panel view and as a click-through screen mascot overlay.

한국어: [README.ko.md](README.ko.md)

## What it does

- Renders a Live2D Cubism 3+ model (`.model3.json`) with WebGL (pixi.js + pixi-live2d-display) in a panel view or a floating mascot overlay.
- Runs chat turns through the local agent runtime (`soksak-plugin-agents-acp`, Claude preset) with a companion persona. No API key handling in this plugin.
- Streams the reply sentence-by-sentence: each sentence is subtitled, spoken via the OS voice (`speechSynthesis`), and mapped to a model expression via emotion tags (`[joy]`, `[anger]`, …) the persona asks the LLM to emit.
- Speaking animates the mouth with a deterministic pseudo lip-sync (M1). Real amplitude-driven lip-sync arrives with the speech sidecar milestone.
- Everything is a command (`vtuber.*`) — the UI and the CLI drive the same engine operations.

## Requirements and licensing

- **Live2D Cubism Core is not bundled.** It is proprietary (© Live2D Inc.). On first use the plugin asks for consent and downloads it from the official Live2D CDN, caching it locally. Publishing an app that uses the Cubism SDK may require a Live2D publication license depending on your revenue — see Live2D's terms.
- **No models are bundled.** Live2D sample models carry per-character terms. Point the plugin at a `.model3.json` you own or are licensed to use. Cubism 2 (`.moc`) models are not supported.
- The pipeline design is informed by the MIT-licensed [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) project; no code was copied.
- `npm run license-gate` asserts that no proprietary artifacts (Cubism Core, `.moc3`, `.model3.json`) are present in the repo or inlined in the bundle.

## Voice notes

`speechSynthesis` availability and voice quality depend on the OS (macOS/Windows ship Korean and English voices; some Linux systems have none — subtitles still work). Voice can be toggled with `vtuber.tts.toggle`.

## Commands

| Command | Description |
| --- | --- |
| `vtuber.ping` | Load/version probe |
| `vtuber.state` | Current state (cubism/model/expressions/mascot/tts/busy) |
| `vtuber.chat {text}` | One agent turn, spoken + subtitled |
| `vtuber.say {text}` | Speak locally without the LLM (honors `[emotion]` tags) |
| `vtuber.stop` | Stop speech, cancel the turn |
| `vtuber.cubism.install {accept}` | Consent + download Cubism Core |
| `vtuber.model.load {path}` | Load `.model3.json` |
| `vtuber.expression.list` | Model expressions + emotion map |
| `vtuber.expression.set {name}` | Apply expression or emotion |
| `vtuber.emotion.map {map}` | Set emotion→expression mapping |
| `vtuber.mascot.toggle {on?}` | Screen mascot overlay on/off |
| `vtuber.tts.toggle {on?}` | Voice output on/off |

## Development

```sh
npm install
npm run build        # esbuild → main.js
npm run typecheck
npm test             # pipeline unit tests
npm run license-gate
```

Install as a dev plugin: check out this repo into `~/.soksak/plugins/soksak-plugin-vtuber` with `.soksak.json` `{"version":"dev"}`, then reload plugins.
