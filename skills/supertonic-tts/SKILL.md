---
name: supertonic-tts
description: Local TTS via Supertonic 2 ONNX — high-quality offline speech synthesis. Exposes an OpenAI-compatible HTTP server for native OpenClaw integration.
metadata:
  {
    "openclaw":
      {
        "emoji": "🔊",
        "os": ["darwin", "linux"],
        "requires":
          {
            "env": [],
            "optional_env":
              [
                "SUPERTONIC_ONNX_DIR",
                "SUPERTONIC_VOICE_STYLE_DIR",
                "SUPERTONIC_DEFAULT_VOICE",
                "SUPERTONIC_SERVER_PORT",
              ],
          },
      },
  }
---

# supertonic-tts

Local, offline, high-quality text-to-speech using **Supertonic 2** ONNX models.

Provides:

- A **CLI tool** (`bin/supertonic-tts`) for direct synthesis
- An **OpenAI-compatible HTTP server** (`src/server.js`) for native OpenClaw TTS integration
- **Audit trail logging** to `~/.openclaw/logs/supertonic-tts-audit.jsonl`

---

## Prerequisites

Models must be pre-downloaded. Expected location (default):

```
~/.cache/supertonic2/onnx/
  duration_predictor.onnx
  text_encoder.onnx
  text_encoder.onnx
  vector_estimator.onnx
  vocoder.onnx
  tts.json
  unicode_indexer.json

~/.cache/supertonic2/voice_styles/
  M1.json  M2.json  M3.json  M4.json  M5.json
  F1.json  F2.json  F3.json  F4.json  F5.json
```

Override with env vars `SUPERTONIC_ONNX_DIR` and `SUPERTONIC_VOICE_STYLE_DIR`.

---

## Install

```bash
cd ~/fork-tools/openclaw/skills/supertonic-tts
npm install
# or: bun install
```

---

## CLI Usage

```bash
# Basic synthesis
node bin/supertonic-tts "Hello from Supertonic!" -o hello.wav

# With voice and speed
node bin/supertonic-tts --voice F1 --speed 0.9 "Slow and gentle." -o out.wav

# High-quality (more diffusion steps)
node bin/supertonic-tts --steps 10 "Premium quality speech." -o hq.wav

# Run from anywhere with PATH set
export PATH="$(pwd)/bin:$PATH"
supertonic-tts "Quick test." -o /tmp/test.wav
```

Available options:
| Flag | Default | Description |
|------|---------|-------------|
| `--voice` | `M3` | Voice: M1-M5 (male), F1-F5 (female) |
| `--lang` | `en` | Language: en, ko, es, pt, fr |
| `--speed` | `1.05` | Speed multiplier (0.7=slow, 1.5=fast) |
| `--steps` | `5` | Diffusion steps (5=fast, 10=higher quality) |
| `--onnx-dir` | `~/.cache/supertonic2/onnx` | Override model directory |
| `--voice-dir` | `~/.cache/supertonic2/voice_styles` | Override voice style directory |

---

## OpenClaw Integration (Recommended)

### 1. Start the server

```bash
node ~/fork-tools/openclaw/skills/supertonic-tts/src/server.js
# Server starts on http://127.0.0.1:8779 by default
```

Or to start in the background:

```bash
nohup node ~/fork-tools/openclaw/skills/supertonic-tts/src/server.js \
  >> ~/.openclaw/logs/supertonic-tts-server.log 2>&1 &
echo "PID: $!"
```

### 2. Configure OpenClaw

Add to `~/.openclaw/openclaw.json`:

```json5
{
  messages: {
    tts: {
      enabled: true,
      provider: "openai",
      openai: {
        voice: "M3",
        model: "supertonic-2",
        apiKey: "any-placeholder",
      },
    },
  },
}
```

And set the environment variable (e.g. in your shell profile or via `launchctl`):

```bash
export OPENAI_TTS_BASE_URL=http://127.0.0.1:8779/v1
```

Or add it to the skill's env entry in openclaw.json:

```json5
{
  skills: {
    entries: {
      "supertonic-tts": {
        env: {
          OPENAI_TTS_BASE_URL: "http://127.0.0.1:8779/v1",
          SUPERTONIC_ONNX_DIR: "~/.cache/supertonic2/onnx",
          SUPERTONIC_VOICE_STYLE_DIR: "~/.cache/supertonic2/voice_styles",
        },
      },
    },
  },
}
```

> **Note:** OpenClaw's TTS providers are hardcoded to `"openai" | "elevenlabs" | "edge"`. The `OPENAI_TTS_BASE_URL` env var routes OpenClaw's "openai" provider to any compatible endpoint — in this case, our local Supertonic server. The `apiKey` field can be any non-empty string since the local server doesn't validate it.

### 3. Verify integration

```bash
# Health check
curl http://127.0.0.1:8779/health

# Test synthesis
curl -X POST http://127.0.0.1:8779/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"supertonic-2","input":"Hello OpenClaw!","voice":"M3","response_format":"wav"}' \
  -o /tmp/test.wav && open /tmp/test.wav
```

---

## Voice Options

| Voice | Style                             |
| ----- | --------------------------------- |
| M1-M5 | Male voices (5 distinct styles)   |
| F1-F5 | Female voices (5 distinct styles) |

When using the OpenClaw integration, set `openai.voice` to any of the above names. The local server maps the OpenAI `voice` field directly to the Supertonic voice name.

---

## Server Configuration

| Env Var                      | Default                             | Description              |
| ---------------------------- | ----------------------------------- | ------------------------ |
| `SUPERTONIC_SERVER_PORT`     | `8779`                              | Server listen port       |
| `SUPERTONIC_SERVER_HOST`     | `127.0.0.1`                         | Bind address             |
| `SUPERTONIC_ONNX_DIR`        | `~/.cache/supertonic2/onnx`         | ONNX model directory     |
| `SUPERTONIC_VOICE_STYLE_DIR` | `~/.cache/supertonic2/voice_styles` | Voice style directory    |
| `SUPERTONIC_DEFAULT_VOICE`   | `M3`                                | Default voice            |
| `SUPERTONIC_DEFAULT_SPEED`   | `1.05`                              | Default speed multiplier |
| `SUPERTONIC_DEFAULT_STEPS`   | `5`                                 | Default diffusion steps  |

---

## Audit Log

Every TTS call appends a line to `~/.openclaw/logs/supertonic-tts-audit.jsonl`:

```json
{
  "ts": 1708300000,
  "voice": "M3",
  "chars": 50,
  "durationMs": 1234,
  "outputFile": "/tmp/...",
  "success": true,
  "error": null
}
```

Override path with `SUPERTONIC_AUDIT_LOG` env var.

---

## Running Tests

```bash
cd ~/fork-tools/openclaw/skills/supertonic-tts
bash tests/run-all.sh

# Run individual tests
node tests/test-basic.js
node tests/test-voices.js
node tests/test-long-text.js
node tests/test-speed.js
```

---

## Supported Languages

| Code | Language   |
| ---- | ---------- |
| `en` | English    |
| `ko` | Korean     |
| `es` | Spanish    |
| `pt` | Portuguese |
| `fr` | French     |

---

## MP3 Output

For MP3 output (used by OpenClaw by default), the server attempts to convert WAV → MP3 using `ffmpeg`. If ffmpeg is not available, WAV-format data is returned. Most players handle this gracefully.

Install ffmpeg on macOS:

```bash
brew install ffmpeg
```
