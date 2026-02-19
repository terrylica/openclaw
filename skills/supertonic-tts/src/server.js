/**
 * supertonic-tts/src/server.js
 *
 * OpenAI-compatible TTS HTTP server backed by Supertonic 2 ONNX inference.
 *
 * Implements a subset of the OpenAI /v1/audio/speech endpoint:
 *   POST /v1/audio/speech
 *   Body: { model, input, voice, response_format }
 *
 * Supported response_format values: wav, mp3 (wav returned if ffmpeg unavailable), pcm, opus
 * Voice field maps directly to Supertonic voice names: M1-M5, F1-F5.
 * If voice not recognized, falls back to SUPERTONIC_DEFAULT_VOICE (default: M3).
 *
 * Environment variables:
 *   SUPERTONIC_SERVER_PORT  — port to listen on (default: 8779)
 *   SUPERTONIC_SERVER_HOST  — bind address (default: 127.0.0.1)
 *   SUPERTONIC_ONNX_DIR     — model directory
 *   SUPERTONIC_VOICE_STYLE_DIR — voice style directory
 *   SUPERTONIC_DEFAULT_VOICE   — default voice
 *
 * Wire into OpenClaw:
 *   Set OPENAI_TTS_BASE_URL=http://127.0.0.1:8779/v1 in your environment
 *   or in openclaw.json skills entry env block.
 *   Then set provider: "openai", openai.voice: "M3" in messages.tts config.
 */

import { execFile } from "child_process";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { promisify } from "util";
import { logAudit } from "../audit.js";
import { getEngine, AVAILABLE_VOICES, DEFAULT_VOICE } from "./engine.js";

const execFileAsync = promisify(execFile);

const PORT = parseInt(process.env.SUPERTONIC_SERVER_PORT || "8779", 10);
const HOST = process.env.SUPERTONIC_SERVER_HOST || "127.0.0.1";

// ─── Format conversion ────────────────────────────────────────────────────────

/** Try to convert WAV buffer to MP3 using ffmpeg. Returns null if unavailable. */
async function wavToMp3(wavBuffer) {
  const tmpWav = path.join(os.tmpdir(), `st2-${Date.now()}.wav`);
  const tmpMp3 = path.join(os.tmpdir(), `st2-${Date.now()}.mp3`);
  try {
    fs.writeFileSync(tmpWav, wavBuffer);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      tmpWav,
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "2",
      tmpMp3,
    ]);
    const mp3 = fs.readFileSync(tmpMp3);
    return mp3;
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(tmpWav);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(tmpMp3);
    } catch {
      /* ignore */
    }
  }
}

/** Try to convert WAV buffer to Opus using ffmpeg. Returns null if unavailable. */
async function wavToOpus(wavBuffer) {
  const tmpWav = path.join(os.tmpdir(), `st2-${Date.now()}.wav`);
  const tmpOpus = path.join(os.tmpdir(), `st2-${Date.now()}.opus`);
  try {
    fs.writeFileSync(tmpWav, wavBuffer);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      tmpWav,
      "-codec:a",
      "libopus",
      "-b:a",
      "64k",
      tmpOpus,
    ]);
    const opus = fs.readFileSync(tmpOpus);
    return opus;
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(tmpWav);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(tmpOpus);
    } catch {
      /* ignore */
    }
  }
}

/** Extract raw PCM int16 from WAV buffer (skip 44-byte header). */
function wavToPcm(wavBuffer) {
  return wavBuffer.slice(44); // raw 16-bit PCM samples
}

// ─── Request handling ─────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(data);
}

function sendError(res, status, message, code = "invalid_request_error") {
  sendJson(res, status, {
    error: { message, type: code, param: null, code },
  });
}

// ─── Main request handler ─────────────────────────────────────────────────────

const engine = getEngine();

async function handleSpeech(req, res) {
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    return sendError(res, 400, "Invalid JSON body");
  }

  const text = body.input;
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return sendError(res, 400, "input must be a non-empty string");
  }

  // Resolve voice: accept Supertonic names (M1-M5, F1-F5) directly
  let voice = (body.voice || DEFAULT_VOICE).toString().trim();
  // Map upper or lower case
  const voiceUpper = voice.toUpperCase();
  // Check if it matches M1..M5 or F1..F5 (case-insensitive)
  const matchedVoice = AVAILABLE_VOICES.find((v) => v === voiceUpper);
  if (!matchedVoice) {
    console.warn(`[supertonic-tts] Unknown voice "${voice}", falling back to ${DEFAULT_VOICE}`);
    voice = DEFAULT_VOICE;
  } else {
    voice = matchedVoice;
  }

  const responseFormat = (body.response_format || "wav").toLowerCase();
  const speed = typeof body.speed === "number" ? body.speed : undefined;
  const lang = body.language || "en";

  const startMs = Date.now();
  let audioBuffer = null;
  let success = false;
  let error = null;
  let contentType = "audio/wav";
  let outputFile = null;

  try {
    const result = await engine.synthesize(text, { voice, lang, speed });
    let buf = result.wavBuffer;

    // Format conversion
    if (responseFormat === "mp3") {
      const mp3 = await wavToMp3(buf);
      if (mp3) {
        buf = mp3;
        contentType = "audio/mpeg";
      } else {
        // ffmpeg unavailable — return WAV with mp3 mime type (still playable)
        contentType = "audio/mpeg";
      }
    } else if (responseFormat === "opus") {
      const opus = await wavToOpus(buf);
      if (opus) {
        buf = opus;
        contentType = "audio/opus";
      } else {
        contentType = "audio/wav";
      }
    } else if (responseFormat === "pcm") {
      buf = wavToPcm(buf);
      contentType = "audio/pcm";
    } else {
      // wav or default
      contentType = "audio/wav";
    }

    audioBuffer = buf;
    success = true;
  } catch (err) {
    error = err.message || String(err);
    console.error(`[supertonic-tts] synthesis error: ${error}`);
  }

  const durationMs = Date.now() - startMs;

  // Audit log
  logAudit({
    voice,
    chars: text.length,
    durationMs,
    outputFile,
    success,
    error: error ?? null,
  });

  if (!success) {
    return sendError(res, 500, `Synthesis failed: ${error}`, "server_error");
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": audioBuffer.length,
    "X-Voice": voice,
    "X-Duration-Ms": durationMs.toString(),
  });
  res.end(audioBuffer);
}

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    return sendJson(res, 200, {
      status: "ok",
      provider: "supertonic-tts",
      voices: AVAILABLE_VOICES,
      defaultVoice: DEFAULT_VOICE,
    });
  }

  // Models list (OpenAI compat)
  if (req.method === "GET" && url.pathname === "/v1/models") {
    return sendJson(res, 200, {
      object: "list",
      data: [{ id: "supertonic-2", object: "model", owned_by: "supertonic" }],
    });
  }

  // TTS endpoint
  if (req.method === "POST" && url.pathname === "/v1/audio/speech") {
    return await handleSpeech(req, res);
  }

  sendError(res, 404, `Not found: ${req.method} ${url.pathname}`);
});

server.on("error", (err) => {
  console.error(`[supertonic-tts] Server error: ${err.message}`);
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Set SUPERTONIC_SERVER_PORT to change.`);
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[supertonic-tts] Server listening on http://${HOST}:${PORT}`);
  console.log(`[supertonic-tts] OpenClaw integration:`);
  console.log(`  export OPENAI_TTS_BASE_URL=http://${HOST}:${PORT}/v1`);
  console.log(`  Set provider: "openai" and openai.voice: "M3" in messages.tts config`);
  console.log(`[supertonic-tts] Available voices: ${AVAILABLE_VOICES.join(", ")}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
