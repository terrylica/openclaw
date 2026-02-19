# Supertonic TTS — Validation Results

**Date:** 2026-02-19  
**Platform:** macOS (arm64) — Apple M3 Max  
**Node.js:** v25.6.1  
**Runtime:** bun v1.3.9 / node  
**Model:** Supertonic 2 v1.6.0 (opensource-multilingual, ONNX)

---

## Test Results

### test-basic.js ✅ PASS

```
Text: "Hello from Supertonic two. This is a basic synthesis test."
Voice: M3
File size: 355,054 bytes
Audio duration: 4.03s
Inference time: 11.11s (cold start, includes ONNX model loading)
WAV header: valid RIFF format
```

First run includes ONNX model loading (~7-8s). Subsequent calls are much faster (~2-4s for short texts).

---

### test-voices.js ✅ PASS (10/10)

All voices successfully generated audio:

| Voice | Size (bytes) | Audio Duration | Inference Time |
| ----- | ------------ | -------------- | -------------- |
| M1    | 279,766      | 3.17s          | 3.76s          |
| M2    | 266,654      | 3.02s          | 2.61s          |
| M3    | 249,658      | 2.83s          | 2.20s          |
| M4    | 285,230      | 3.23s          | 2.21s          |
| M5    | 307,030      | 3.48s          | 2.21s          |
| F1    | 273,988      | 3.11s          | 1.83s          |
| F2    | 271,514      | 3.08s          | 2.14s          |
| F3    | 286,756      | 3.25s          | 2.25s          |
| F4    | 250,730      | 2.84s          | 2.21s          |
| F5    | 292,200      | 3.31s          | 1.97s          |

---

### test-long-text.js ✅ PASS

```
Text length: 465 chars (exceeds 300-char chunk limit)
File size: 2,534,842 bytes
Audio duration: 28.74s
Inference time: 17.29s (multiple chunks + silence padding)
Chunking: automatically split at sentence boundaries
```

---

### test-speed.js ✅ PASS (3/3)

Speed parameter correctly affects audio duration:

| Speed         | Audio Duration | File Size     | Inference |
| ------------- | -------------- | ------------- | --------- |
| 0.9x (slow)   | 5.23s          | 461,708 bytes | 3.86s     |
| 1.0x (normal) | 4.71s          | 415,542 bytes | 4.21s     |
| 1.5x (fast)   | 3.14s          | 277,042 bytes | 2.75s     |

Speed ordering verified: slower speed → longer audio ✓

---

## Audit Log ✅ Active

Audit log path: `~/.openclaw/logs/supertonic-tts-audit.jsonl`

Sample entries:

```json
{"ts":1771499978,"voice":"M3","chars":58,"durationMs":11112,"outputFile":"/var/folders/.../test-basic.wav","success":true,"error":null}
{"ts":1771499986,"voice":"M3","chars":70,"durationMs":3856,"outputFile":"/var/folders/.../speed-0_9.wav","success":true,"error":null}
```

Total entries logged during testing: **15**

---

## Overall Result: ✅ ALL TESTS PASS

| Test           | Status    | Notes                             |
| -------------- | --------- | --------------------------------- |
| test-basic     | ✅ PASS   | WAV output valid, correct size    |
| test-voices    | ✅ PASS   | All 10 voices (M1-M5, F1-F5) work |
| test-long-text | ✅ PASS   | Chunking works for 465-char input |
| test-speed     | ✅ PASS   | Speed 0.9x/1.0x/1.5x all correct  |
| Audit logging  | ✅ ACTIVE | 15 entries written                |

---

## Performance Notes

- **Cold start:** ~7-10s (ONNX model loading, happens once)
- **Warm inference:** ~2-4s for short phrases (up to ~10 words)
- **Long text:** ~17s for 465 chars (3 chunks)
- **Sample rate:** 44,100 Hz (high fidelity)
- **Format:** WAV PCM 16-bit mono

For production use via the HTTP server, models load once on startup and all subsequent requests are served at warm inference speed.

---

## OpenClaw Integration Status

The OpenAI-compatible server (`src/server.js`) is implemented and tested via curl:

```bash
curl -X POST http://127.0.0.1:8779/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"supertonic-2","input":"Hello OpenClaw!","voice":"M3","response_format":"wav"}' \
  -o /tmp/test.wav
```

OpenClaw config to enable:

```json
{
  "messages": {
    "tts": {
      "enabled": true,
      "provider": "openai",
      "openai": { "voice": "M3", "model": "supertonic-2", "apiKey": "local" }
    }
  }
}
```

With `OPENAI_TTS_BASE_URL=http://127.0.0.1:8779/v1` set in the environment.
