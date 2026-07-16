# OpenWakeWord WASM (browser)

Inspired by [Miro Hristov’s Deep Core Labs write-up](https://deepcorelabs.com/open-wake-word-on-the-web/), this package brings the same browser-only wake-word pipeline into a reusable npm module. A full React sandbox lives in this repo as well: [openwakeword_wasm_react_demo](https://github.com/edyrkaj/openwakeword_wasm/tree/main/openwakeword_wasm_react_demo).

Small browser-first wrapper around the OpenWakeWord models using `onnxruntime-web`. It exposes a `WakeWordEngine` class you can drop into a React app to listen for wake words like `hey_jarvis` directly in Chrome, no native layer required.

Agents should read AGENTS.md to get details and onboarding instructions.

**Package:** `[@edyrkaj/openwakeword-wasm-browser](https://www.npmjs.com/package/@edyrkaj/openwakeword-wasm-browser)` — library code only. ONNX models are **not** published on npm; copy them from this repo’s `models/` folder (or host them yourself) and point `baseAssetUrl` at that location.

## Installation

```bash
npm install @edyrkaj/openwakeword-wasm-browser
```

For local development against this repo:

```bash
npm install file:../openwakeword_wasm
```

Copy the ONNX files from `models/` somewhere the browser can fetch them (for CRA/Vite: `public/openwakeword/models`). If you self-host the ORT wasm files, pass `ortWasmPath` (e.g. `/openwakeword/ort/`).

## Basic React usage

```jsx
import { useEffect, useMemo, useState } from 'react';
import WakeWordEngine from '@edyrkaj/openwakeword-wasm-browser';

export default function WakeWordDemo() {
  const [detected, setDetected] = useState(null);
  const engine = useMemo(() => new WakeWordEngine({
    baseAssetUrl: '/openwakeword/models', // where you host the .onnx files
    keywords: ['hey_jarvis'],             // or any of: alexa, hey_mycroft, hey_rhasspy, timer, weather
    detectionThreshold: 0.5,
    cooldownMs: 2000
  }), []);

  useEffect(() => {
    let unsub;
    engine.load().then(() => {
      unsub = engine.on('detect', ({ keyword, score }) => {
        setDetected(`${keyword} (${score.toFixed(2)})`);
      });
      engine.start(); // prompts for mic
    });
    return () => { unsub?.(); engine.stop(); };
  }, [engine]);

  return (
    <div>
      <p>Listening for hey_jarvis…</p>
      {detected && <p>Detected: {detected}</p>}
    </div>
  );
}
```



### Vanilla example

```js
import WakeWordEngine from '@edyrkaj/openwakeword-wasm-browser';

const engine = new WakeWordEngine({
  baseAssetUrl: '/openwakeword/models',
  ortWasmPath: '/openwakeword/ort/',
  keywords: ['hey_jarvis', 'alexa'],
  detectionThreshold: 0.55,
});

await engine.load();
engine.on('speech-start', () => status.textContent = 'Speech detected');
engine.on('speech-end', () => status.textContent = 'Silence');
engine.on('detect', ({ keyword }) => playTone(keyword));
await engine.start({ deviceId: preferredMicId, gain: 1.3 });

document.querySelector('#stop').addEventListener('click', () => engine.stop());
document.querySelector('#keyword').addEventListener('change', (evt) => {
  engine.setActiveKeywords([evt.target.value]);
});
```



### External weight files (`externalDataFiles`) (new)

`externalDataFiles` — optional map of ONNX filename → string URL **or** `{ path, data }` for ORT Web external weights.

- `path` must match the protobuf external `location`.
- `data` is an absolute URL, or a path relative to `baseAssetUrl`.
- A bare string is treated as both `path` and `data`.
- Used only when a model is split into graph + external weight file; it does **not** replace `baseAssetUrl` for normal `.onnx` hosting.

```js
import WakeWordEngine from '@edyrkaj/openwakeword-wasm-browser';

const engine = new WakeWordEngine({
  baseAssetUrl: '/openwakeword/models',
  externalDataFiles: {
    // only needed for models that ship external weight blobs
    'some_model.onnx': {
      path: 'some_model.onnx.data',      // protobuf external location
      data: 'some_model.onnx.data',      // fetch URL (rel. to baseAssetUrl OK)
    },
    // equivalent shorthand (path and data are the same string):
    // 'other_model.onnx': 'other_model.onnx.data',
  },
});
```



## API reference

- `await engine.load()` downloads ONNX models (mel, embedding, VAD, keyword heads) and infers keyword window sizes.
- `await engine.start({ deviceId?, gain? })` starts microphone streaming and posts 1280-sample chunks through the AudioWorklet.
- `await engine.stop()` tears down the graph, stops tracks, and clears cooldowns.
- `engine.setGain(value)` updates the `GainNode` while running.
- `await engine.runWav(arrayBuffer)` runs the entire pipeline offline and returns the highest score seen.
- `engine.setActiveKeywords(name[])` gates which keywords are allowed to emit `detect`.
- Constructor option `externalDataFiles` — see [External weight files](#external-weight-files-externaldatafiles).



### Events

- `ready` fires once models finish loading.
- `detect` surfaces `{ keyword, score, at }` when score > threshold, VAD hangover is active, and cooldown is clear.
- `speech-start` / `speech-end` mirror the VAD state transitions.
- `error` emits any pipeline failures (getUserMedia, onnxruntime, decoding issues).



### Asset layout

Example with Vite/CRA (copy ONNX from this repo’s `models/` — they are not inside the npm tarball):

```
public/
  openwakeword/
    models/
      melspectrogram.onnx
      embedding_model.onnx
      silero_vad.onnx
      hey_jarvis_v0.1.onnx
      ...
    ort/
      ort-wasm.wasm
      ort-wasm-simd.wasm
```

Then instantiate with `baseAssetUrl: '/openwakeword/models'` and `ortWasmPath: '/openwakeword/ort'` if you host the wasm yourself. If `ortWasmPath` is omitted, `onnxruntime-web` uses its default CDN.

### Notes

- The engine runs at 16 kHz with 80 ms frames, mirroring the reference demo in `main.js`.
- VAD hangover is tuned to 12 frames to keep speech open long enough for the wake word score to peak.
- Cooldown (`cooldownMs`) prevents multiple detections per utterance; lower if you want rapid-fire triggers.



### Publishing / packaging

- The published package includes `src/` and `README.md` only (library-only). Models stay in the git repo for demos and self-hosting.
- Releases: push an annotated tag `vX.Y.Z` matching `package.json` `version`; GitHub Actions runs pack/docs gates and `npm publish --access public`.
- Before a release, run `npm run prepack:check` (or `npm pack`) and confirm the tarball has no `models/`.
- Consider running `engine.runWav()` against `hey_jarvis_11-2.wav` before tagging to verify scoring still peaks near 1.0.

