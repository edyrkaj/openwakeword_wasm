## Project Brief

OpenWakeWord WASM is a browser-first wake-word detector that runs the entire OpenWakeWord inference pipeline in the client using `onnxruntime-web`. The codebase contains both the reusable engine published as `openwakeword-wasm-browser` and a React demo (`openwakeword_wasm_react_demo`) that showcases the experience from the [Deep Core Labs article “Open Wake Word on the Web”](https://deepcorelabs.com/open-wake-word-on-the-web/).

### Non-technical summary
- Purpose: let any web app listen for phrases such as “hey_jarvis” without native bridges or cloud streaming.
- Selling points: privacy (audio never leaves the browser), fast UX (no round trips), ability to white-label keywords for assistants/IoT, and a polished walkthrough blog post for marketing.
- User flow (demo): pick mic + keyword, press “Start listening”, get live telemetry + detection events (VAD LEDs, score charts, success tone).
- Constraints: Chrome-class browsers with AudioWorklet + SharedArrayBuffer support; user must grant microphone access; hosting must serve the ONNX assets.

### Technical highlights (as emphasized in the article)
1. Audio is processed in 80 ms (1280 sample) chunks at 16 kHz mono PCM.
2. Stage 1 converts audio → melspectrogram (model `melspectrogram.onnx`) and **must** normalize each float via `value / 10 + 2`.
3. Stage 2 waits until 76 spectrogram frames accumulate, then feeds `[1, 76, 32, 1]` tensors into `embedding_model.onnx` and shifts the mel buffer by 8 frames every pass to honor the training window.
4. Stage 3 keeps a rolling window of embeddings (16 for Jarvis/Mycroft/Alexa/Rhasspy, 22 for Weather, 34 for Timer), flattens them to `[1, window, 96]`, and runs the keyword-specific ONNX sessions.
5. ONNX Runtime reuses output buffers → **always copy** `.data` into a new `Float32Array`.
6. VAD (`silero_vad.onnx`) is a confirmation gate, not a trigger. The pipeline must stream continuously and only emit detections when both score > threshold and VAD (with a 12-frame hangover) says speech is active.
7. Backend compatibility: WASM always works; WebGPU/WebGL may accelerate keyword sessions but preprocessing models must stay on WASM due to custom ops.

## Repository layout

```
openwakeword_wasm/
├── src/                    # Library source (ESM) for WakeWordEngine
├── models/                 # ONNX models shipped with the package
├── main.js / style.css     # Vanilla JS demo (article companion)
├── README.md               # Usage + asset layout instructions
├── AGENTS.md               # You are here (project specification)
├── package.json            # Library metadata ("openwakeword-wasm-browser")
└── openwakeword_wasm_react_demo/  # CRA/Vite-style React sandbox
```

The React demo is a standalone app with its own `package.json`, `public/openwakeword` assets, and `src/WakeWordWidget.js` widget that consumes the published engine.

## WakeWordEngine (library)

File: `src/WakeWordEngine.js`

### Responsibilities
- Abstract microphone capture (AudioWorklet) and streaming chunk management.
- Implement the 3-stage ONNX pipeline, buffer management, VAD hangover, cooldown logic, and keyword-specific embedding windows.
- Provide a small event system (`createEmitter`) with handlers (`ready`, `detect`, `speech-start`, `speech-end`, `error`).
- Offer imperative APIs: `load`, `start`, `stop`, `setGain`, `runWav`, `setActiveKeywords`.

### Key components
- **Config defaults**: keywords (`MODEL_FILE_MAP`), `/models` asset path, frame size 1280, sample rate 16 kHz, hangover 12 frames, threshold 0.5, cooldown 2 s, execution providers `['wasm']`, embedding window fallback 16, debug logging toggle.
- **Model loading**: `load()` instantiates ORT sessions for mel, embedding, VAD, and each keyword (mapping to ONNX filenames). `_inferKeywordWindowSize` inspects session metadata to determine whether the keyword expects 16/22/34 embeddings. The max size is stored for WAV padding; each keyword also holds its own zero-initialized history buffer.
- **Audio capture**: `start()` sets up `AudioContext`, `AudioWorklet`, `GainNode`, and microphone stream (optionally constrained by `deviceId`). Received chunks call `_processChunk`.
- **VAD**: `_runVad` feeds `[1, chunkLength]` tensors + sample rate + recurrent state into `silero_vad`. The hangover counter ensures `isSpeechActive` stays true for ≈1 s after VAD falls below 0.5.
- **Inference**:
  - Stage 1: chunk tensor → mel model, transform values, push 5 × 32-frame slices.
  - Stage 2: while `mel_buffer.length >= 76`, flatten 76×32 window, run embedding model, copy resulting 96-length vector.
  - Stage 3: for each keyword, roll the embedding history, flatten to `[1, windowSize, 96]`, run keyword session, store scores, and emit `detect` when `(keyword active) && score > threshold && isSpeechActive && !coolingDown`. Non-active keywords log “Detection suppressed”.
- **Offline mode**: `runWav(buffer)` decodes via `AudioContext`, resamples via `OfflineAudioContext`, pads to `embeddingWindowSize * frameSize` samples, iterates through chunks, and returns the highest observed score (without raising events).
- **Debug logging**: `_debug` centralizes `console.debug` output; when `debug: true`, you see model loads, chunk RMS, VAD confidences, per-keyword scores, suppression reasons, etc.

### Extensibility touchpoints
- `MODEL_FILE_MAP`: add new keywords → supply ONNX file + ensure metadata shape is correct.
- `setActiveKeywords(keywords: string[])`: called by UI to toggle which detections may emit events without reloading models.
- `executionProviders`: pass `['wasm', 'webgpu']` etc when the host environment supports ORT WebGPU (preprocessing still runs on WASM automatically).
- `baseAssetUrl` and `ortWasmPath`: adapt asset hosting paths (e.g., `/openwakeword/models` and `/openwakeword/ort`).
- Events: consume `engine.on('detect', …)` etc to integrate with UI or analytics.

## Assets and models

Folder: `models/`

- `melspectrogram.onnx` – audio chunk → 5 × 32 mel frames.
- `embedding_model.onnx` – 76-frame window → 96-dim embedding.
- `silero_vad.onnx` – voice activity detection with recurrent state.
- Keyword models: `*_v0.1.onnx` (Jarvis, Alexa, Mycroft, Rhasspy expect 16 embeddings; Timer 34; Weather 22).

Deployment expectation:
- Frontend bundlers should copy `models/` (and optionally ORT wasm binaries) into `public/openwakeword/models`.
- `baseAssetUrl` should point to the runtime URL for these models. WakeWordEngine simply concatenates `baseAssetUrl + filename`.

## React demo (`openwakeword_wasm_react_demo`)

Purpose: user-friendly sandbox to test different microphones, gains, and keywords with real-time charts, mirroring the article’s UI.

Key files:
- `src/WakeWordWidget.js` – primary UI component. Uses `useMemo` to create `WakeWordEngine` once, subscribes to events, surfaces status/error/speech state, exposes start/stop + offline sample test, and populates mic dropdown via `navigator.mediaDevices`.
- `src/App.js` – renders the widget.
- `public/openwakeword/` – contains ONNX assets and sample WAV for offline tests.

Workflow:
1. `npm install` in `openwakeword_wasm`.
2. Link the library into the demo (`cd openwakeword_wasm_react_demo && npm install ../openwakeword_wasm` or use `npm link`).
3. Copy `openwakeword_wasm/models` into `openwakeword_wasm_react_demo/public/openwakeword/models`.
4. `npm start` inside the demo to launch the dev server.
5. Browser prompts for microphone; choose keyword from dropdown; adjust gain slider as needed.

The widget calls `engine.setActiveKeywords([activeKeyword])` whenever the dropdown changes so only the selected model may emit detection events, while the engine still streams all models to keep their buffers warm.

## Vanilla demo (`main.js` + `index.php`/`style.css`)

This is the simple HTML/JS experience referenced in the Deep Core Labs blog post. It is useful for debugging outside React:
- `main.js` mirrors the WakeWordEngine logic but inline, rendering mic status, charts (via Chart.js), and success tone playback.
- Start the demo via local web server (PHP file can serve as entry point). Ensure `models/` and `success.mp3` are reachable.
- Useful for verifying raw ONNX/ORT behavior without bundlers.

## Development workflow

### Prerequisites
- Node.js ≥ 18 (ESM + AudioWorklet-friendly build tooling).
- Modern browser (Chrome/Edge) with microphone access, AudioWorklet, and SharedArrayBuffer. Firefox may require additional flags (see article comments).
- For article parsing / docs, Python 3.13 with `.venv` (already present) handles helper scripts.

### Installing + linking
```sh
# 1. Install library dependencies
npm install

# 2. (Optional) Pack or link for external consumers
npm pack        # produces .tgz for npm install
npm link        # or npm install file:../openwakeword_wasm from another project

# 3. Demo app
cd openwakeword_wasm_react_demo
npm install
npm install ../openwakeword_wasm   # ensures the demo uses local source
npm start
```

### Testing
- No formal test suite yet (`npm test` echoes “no tests configured”). Verification relies on manual browser runs.
- `engine.runWav()` is a handy regression harness: call it with `hey_jarvis_11-2.wav` to ensure offline scoring ≈1.0 before attempting live audio.
- For pipeline debugging, run the vanilla demo (`index.php` + `main.js`) to reduce React-specific variables.

### Logging & diagnostics
- Pass `debug: true` to `WakeWordEngine` (default in the demo) to log chunk RMS, VAD confidences, keyword scores, and detection gating decisions.
- Watch for `Detection suppressed (inactive keyword)` logs to confirm `setActiveKeywords` gating is working.
- High gain leading to clipping shows as `peak` values >1.2; drop the gain or use OS-level input controls.

## Known constraints & troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Keyword logs stay at 0 | Ensure audio chunking is exactly 1280 samples, mel transform is applied, and the audio has ≥1.3 s of content (buffers need to fill). |
| VAD logs “confidence: 0” even when speaking | Check mic permissions, confirm sample rate 16 kHz, verify `silero_vad.onnx` path. |
| Timer model throws `Flatten_0` dimension error | Means embedding window < expected; ensure `_inferKeywordWindowSize` picks 34 or pass `embeddingWindowSize: 34` manually. |
| React demo detects wrong keyword | Confirm `setActiveKeywords` is called on dropdown change; debug log should state `Active keywords updated ["selected"]`. |
| WebGL/WebGPU backends crash | Always run mel + VAD on WASM; only allow keyword models on GPU, or stick to `executionProviders: ['wasm']`. |
| Firefox error `AudioContext.createMediaStreamSource` sample-rate mismatch | Use matching sample rates (16 kHz) or fall back to Chrome as per the article’s notes. |

## Future opportunities
- Add automated tests (e.g., offline WAV fixtures) to prevent regressions in buffer sizing or detection thresholds.
- Support custom keyword ONNX uploads (UI for dropping new models into the maps).
- Expand backend selection UI so users can benchmark WASM vs WebGPU at runtime.
- Document hosting setup (S3/CDN) for ONNX models to simplify deployment.

## References
- **Blog**: [“Open Wake Word on the Web”](https://deepcorelabs.com/open-wake-word-on-the-web/) – describes the architecture, debugging story, and “Aha!” lessons. Use it for communications/marketing context.
- **Library README**: `openwakeword_wasm/README.md` – lists installation, API, and asset layout expectations.
- **Vanilla demo**: `main.js` – blueprint for the pipeline if you need to debug outside React.

Keep this document updated when models, APIs, or demo behavior change so future agents can onboard quickly.
