/**
 * supertonic-tts/src/engine.js
 *
 * Core Supertonic 2 TTS inference engine.
 * Wraps the ONNX models into a clean `synthesize()` API.
 *
 * Environment variables (all optional, have sensible defaults):
 *   SUPERTONIC_ONNX_DIR       — path to onnx model dir (default: ~/.cache/supertonic2/onnx)
 *   SUPERTONIC_VOICE_STYLE_DIR — path to voice style dir  (default: ~/.cache/supertonic2/voice_styles)
 *   SUPERTONIC_DEFAULT_VOICE   — default voice name        (default: M3)
 *   SUPERTONIC_DEFAULT_SPEED   — default speed multiplier  (default: 1.05)
 *   SUPERTONIC_DEFAULT_STEPS   — diffusion steps           (default: 5)
 */

import fs from "fs";
import os from "os";
import path from "path";
import * as ort from "onnxruntime-node";

// ─── Config helpers ───────────────────────────────────────────────────────────

/** Expand ~ in a path string. */
function expandHome(p) {
  if (!p) return p;
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/** Resolve a dir from env var with a fallback default. */
function resolveDir(envVar, defaultRelative) {
  const fromEnv = process.env[envVar];
  if (fromEnv) return expandHome(fromEnv.trim());
  return path.join(os.homedir(), defaultRelative);
}

export const DEFAULT_ONNX_DIR = resolveDir("SUPERTONIC_ONNX_DIR", ".cache/supertonic2/onnx");
export const DEFAULT_VOICE_STYLE_DIR = resolveDir(
  "SUPERTONIC_VOICE_STYLE_DIR",
  ".cache/supertonic2/voice_styles",
);
export const DEFAULT_VOICE = (process.env.SUPERTONIC_DEFAULT_VOICE || "M3").trim();
export const DEFAULT_SPEED = parseFloat(process.env.SUPERTONIC_DEFAULT_SPEED || "1.05");
export const DEFAULT_STEPS = parseInt(process.env.SUPERTONIC_DEFAULT_STEPS || "5", 10);

/** All supported voice names. */
export const AVAILABLE_VOICES = ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"];
const AVAILABLE_LANGS = ["en", "ko", "es", "pt", "fr"];

// ─── WAV helpers ──────────────────────────────────────────────────────────────

/**
 * Encode float32 PCM samples into a WAV Buffer.
 * @param {number[]} audioData  — float32 samples in [-1, 1]
 * @param {number} sampleRate
 * @returns {Buffer}
 */
export function encodeWav(audioData, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = audioData.length * (bitsPerSample / 8);
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < audioData.length; i++) {
    const sample = Math.max(-1, Math.min(1, audioData[i]));
    buf.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
  }
  return buf;
}

/**
 * Write a WAV file from float32 PCM samples.
 */
export function writeWavFile(filePath, audioData, sampleRate) {
  fs.writeFileSync(filePath, encodeWav(audioData, sampleRate));
}

// ─── Text processing ──────────────────────────────────────────────────────────

class UnicodeProcessor {
  constructor(unicodeIndexerPath) {
    if (!fs.existsSync(unicodeIndexerPath)) {
      throw new Error(`unicode_indexer.json not found: ${unicodeIndexerPath}`);
    }
    this.indexer = JSON.parse(fs.readFileSync(unicodeIndexerPath, "utf8"));
  }

  _preprocess(text, lang) {
    text = text.normalize("NFKD");

    // Remove emojis
    const emojiPat =
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
    text = text.replace(emojiPat, "");

    const reps = {
      "–": "-",
      "‑": "-",
      "—": "-",
      _: " ",
      "\u201C": '"',
      "\u201D": '"',
      "\u2018": "'",
      "\u2019": "'",
      "´": "'",
      "`": "'",
      "[": " ",
      "]": " ",
      "|": " ",
      "/": " ",
      "#": " ",
      "→": " ",
      "←": " ",
    };
    for (const [k, v] of Object.entries(reps)) text = text.replaceAll(k, v);

    text = text.replace(/[♥☆♡©\\]/g, "");

    const exprReps = { "@": " at ", "e.g.,": "for example, ", "i.e.,": "that is, " };
    for (const [k, v] of Object.entries(exprReps)) text = text.replaceAll(k, v);

    text = text
      .replace(/ ,/g, ",")
      .replace(/ \./g, ".")
      .replace(/ !/g, "!")
      .replace(/ \?/g, "?")
      .replace(/ ;/g, ";")
      .replace(/ :/g, ":")
      .replace(/ '/g, "'");

    while (text.includes('""')) text = text.replace('""', '"');
    while (text.includes("''")) text = text.replace("''", "'");

    text = text.replace(/\s+/g, " ").trim();
    if (!/[.!?;:,'\"')\]}…。」』】〉》›»]$/.test(text)) text += ".";

    if (!AVAILABLE_LANGS.includes(lang)) {
      throw new Error(`Unsupported language: ${lang}. Supported: ${AVAILABLE_LANGS.join(", ")}`);
    }
    return `<${lang}>${text}</${lang}>`;
  }

  call(textList, langList) {
    const processed = textList.map((t, i) => this._preprocess(t, langList[i]));
    const lengths = processed.map((t) => t.length);
    const maxLen = Math.max(...lengths);

    const textIds = processed.map((txt) => {
      const row = new Array(maxLen).fill(0);
      Array.from(txt).forEach((ch, j) => {
        row[j] = this.indexer[ch.charCodeAt(0)] ?? 0;
      });
      return row;
    });

    const textMask = lengthToMask(lengths);
    return { textIds, textMask };
  }
}

// ─── Tensor helpers ───────────────────────────────────────────────────────────

function lengthToMask(lengths, maxLen = null) {
  maxLen = maxLen || Math.max(...lengths);
  return lengths.map((l) => [Array.from({ length: maxLen }, (_, j) => (j < l ? 1.0 : 0.0))]);
}

function getLatentMask(wavLengths, baseChunkSize, chunkCompressFactor) {
  const latentSize = baseChunkSize * chunkCompressFactor;
  const latentLengths = wavLengths.map((len) => Math.floor((len + latentSize - 1) / latentSize));
  return lengthToMask(latentLengths);
}

function arrayToTensor(array, dims) {
  return new ort.Tensor("float32", Float32Array.from(array.flat(Infinity)), dims);
}

function intArrayToTensor(array, dims) {
  return new ort.Tensor(
    "int64",
    BigInt64Array.from(array.flat(Infinity).map((x) => BigInt(x))),
    dims,
  );
}

// ─── Voice style loader ───────────────────────────────────────────────────────

function loadVoiceStyle(voiceStylePath) {
  if (!fs.existsSync(voiceStylePath)) {
    throw new Error(`Voice style not found: ${voiceStylePath}`);
  }
  const vs = JSON.parse(fs.readFileSync(voiceStylePath, "utf8"));
  const ttlDims = vs.style_ttl.dims;
  const dpDims = vs.style_dp.dims;

  const ttlFlat = new Float32Array(vs.style_ttl.data.flat(Infinity));
  const dpFlat = new Float32Array(vs.style_dp.data.flat(Infinity));

  return {
    ttl: new ort.Tensor("float32", ttlFlat, [1, ttlDims[1], ttlDims[2]]),
    dp: new ort.Tensor("float32", dpFlat, [1, dpDims[1], dpDims[2]]),
  };
}

// ─── Text chunking ────────────────────────────────────────────────────────────

function chunkText(text, maxLen = 300) {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n+/)
    .filter((p) => p.trim());
  const chunks = [];
  for (const para of paragraphs) {
    const sentences = para
      .trim()
      .split(
        /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/,
      );
    let cur = "";
    for (const sent of sentences) {
      if (cur.length + sent.length + 1 <= maxLen) {
        cur += (cur ? " " : "") + sent;
      } else {
        if (cur) chunks.push(cur.trim());
        cur = sent;
      }
    }
    if (cur) chunks.push(cur.trim());
  }
  return chunks.length > 0 ? chunks : [text.trim()];
}

// ─── SupertonicEngine ─────────────────────────────────────────────────────────

/**
 * Lazy-loaded Supertonic ONNX inference engine.
 * Models are loaded once on first use and cached.
 */
export class SupertonicEngine {
  /**
   * @param {object} opts
   * @param {string} [opts.onnxDir]       — path to dir with .onnx files
   * @param {string} [opts.voiceStyleDir] — path to dir with voice style JSONs
   */
  constructor(opts = {}) {
    this.onnxDir = opts.onnxDir || DEFAULT_ONNX_DIR;
    this.voiceStyleDir = opts.voiceStyleDir || DEFAULT_VOICE_STYLE_DIR;
    this._loaded = false;
    this._tts = null;
    this._cfgs = null;
    this._textProcessor = null;
    this._voiceCache = new Map();
  }

  /** Verify model files exist before attempting to load. */
  _checkModels() {
    const required = [
      "duration_predictor.onnx",
      "text_encoder.onnx",
      "vector_estimator.onnx",
      "vocoder.onnx",
      "tts.json",
      "unicode_indexer.json",
    ];
    for (const f of required) {
      const p = path.join(this.onnxDir, f);
      if (!fs.existsSync(p)) {
        throw new Error(
          `Missing model file: ${p}\nSet SUPERTONIC_ONNX_DIR or ensure models are at ~/.cache/supertonic2/onnx/`,
        );
      }
    }
  }

  /** Lazily load all ONNX models. */
  async _ensureLoaded() {
    if (this._loaded) return;
    this._checkModels();

    const opts = {};
    const [dpOrt, textEncOrt, vectorEstOrt, vocoderOrt] = await Promise.all([
      ort.InferenceSession.create(path.join(this.onnxDir, "duration_predictor.onnx"), opts),
      ort.InferenceSession.create(path.join(this.onnxDir, "text_encoder.onnx"), opts),
      ort.InferenceSession.create(path.join(this.onnxDir, "vector_estimator.onnx"), opts),
      ort.InferenceSession.create(path.join(this.onnxDir, "vocoder.onnx"), opts),
    ]);

    this._cfgs = JSON.parse(fs.readFileSync(path.join(this.onnxDir, "tts.json"), "utf8"));
    this._textProcessor = new UnicodeProcessor(path.join(this.onnxDir, "unicode_indexer.json"));

    this._dpOrt = dpOrt;
    this._textEncOrt = textEncOrt;
    this._vectorEstOrt = vectorEstOrt;
    this._vocoderOrt = vocoderOrt;

    this.sampleRate = this._cfgs.ae.sample_rate;
    this.baseChunkSize = this._cfgs.ae.base_chunk_size;
    this.chunkCompressFactor = this._cfgs.ttl.chunk_compress_factor;
    this.ldim = this._cfgs.ttl.latent_dim;

    this._loaded = true;
  }

  /** Get (or load) a voice style tensor pair. */
  _getVoiceStyle(voice) {
    if (!this._voiceCache.has(voice)) {
      const p = path.join(this.voiceStyleDir, `${voice}.json`);
      this._voiceCache.set(voice, loadVoiceStyle(p));
    }
    return this._voiceCache.get(voice);
  }

  /** Validate voice name. */
  _validateVoice(voice) {
    if (!AVAILABLE_VOICES.includes(voice)) {
      throw new Error(`Unknown voice: "${voice}". Available: ${AVAILABLE_VOICES.join(", ")}`);
    }
  }

  /** Generate noisy latent tensor. */
  _sampleNoisyLatent(duration) {
    const wavLenMax = Math.max(...duration) * this.sampleRate;
    const wavLengths = duration.map((d) => Math.floor(d * this.sampleRate));
    const chunkSize = this.baseChunkSize * this.chunkCompressFactor;
    const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
    const latentDim = this.ldim * this.chunkCompressFactor;
    const bsz = duration.length;

    const noisyLatent = Array.from({ length: bsz }, () =>
      Array.from({ length: latentDim }, () =>
        Array.from({ length: latentLen }, () => {
          const eps = 1e-10;
          const u1 = Math.max(eps, Math.random());
          const u2 = Math.random();
          return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        }),
      ),
    );

    const latentMask = getLatentMask(wavLengths, this.baseChunkSize, this.chunkCompressFactor);

    // Apply mask
    for (let b = 0; b < bsz; b++) {
      for (let d = 0; d < latentDim; d++) {
        for (let t = 0; t < latentLen; t++) {
          noisyLatent[b][d][t] *= latentMask[b][0][t];
        }
      }
    }
    return { noisyLatent, latentMask };
  }

  /** Single-batch ONNX inference pass. */
  async _infer(textList, langList, style, totalStep, speed) {
    const bsz = textList.length;
    const { textIds, textMask } = this._textProcessor.call(textList, langList);
    const textIdsShape = [bsz, textIds[0].length];
    const textMaskShape = [bsz, 1, textMask[0][0].length];
    const textMaskTensor = arrayToTensor(textMask, textMaskShape);

    // Duration predictor
    const dpResult = await this._dpOrt.run({
      text_ids: intArrayToTensor(textIds, textIdsShape),
      style_dp: style.dp,
      text_mask: textMaskTensor,
    });
    const durOnnx = Array.from(dpResult.duration.data).map((d) => d / speed);

    // Text encoder
    const textEncResult = await this._textEncOrt.run({
      text_ids: intArrayToTensor(textIds, textIdsShape),
      style_ttl: style.ttl,
      text_mask: textMaskTensor,
    });
    const textEmbTensor = textEncResult.text_emb;

    // Flow matching
    let { noisyLatent, latentMask } = this._sampleNoisyLatent(durOnnx);
    const latentShape = [bsz, noisyLatent[0].length, noisyLatent[0][0].length];
    const latentMaskShape = [bsz, 1, latentMask[0][0].length];
    const latentMaskTensor = arrayToTensor(latentMask, latentMaskShape);
    const totalStepTensor = arrayToTensor(new Array(bsz).fill(totalStep), [bsz]);

    for (let step = 0; step < totalStep; step++) {
      const vecEstResult = await this._vectorEstOrt.run({
        noisy_latent: arrayToTensor(noisyLatent, latentShape),
        text_emb: textEmbTensor,
        style_ttl: style.ttl,
        text_mask: textMaskTensor,
        latent_mask: latentMaskTensor,
        total_step: totalStepTensor,
        current_step: arrayToTensor(new Array(bsz).fill(step), [bsz]),
      });
      const denoised = Array.from(vecEstResult.denoised_latent.data);
      let idx = 0;
      for (let b = 0; b < bsz; b++)
        for (let d = 0; d < noisyLatent[b].length; d++)
          for (let t = 0; t < noisyLatent[b][d].length; t++) noisyLatent[b][d][t] = denoised[idx++];
    }

    // Vocoder
    const vocoderResult = await this._vocoderOrt.run({
      latent: arrayToTensor(noisyLatent, latentShape),
    });

    return { wav: Array.from(vocoderResult.wav_tts.data), duration: durOnnx };
  }

  /**
   * Synthesize speech from text.
   *
   * @param {string} text
   * @param {object} [opts]
   * @param {string}  [opts.voice]    — voice name (M1-M5, F1-F5). Default: M3
   * @param {string}  [opts.lang]     — language code. Default: "en"
   * @param {number}  [opts.speed]    — speed multiplier. Default: 1.05
   * @param {number}  [opts.steps]    — diffusion steps. Default: 5
   * @param {number}  [opts.silenceMs] — silence between chunks (ms). Default: 300
   * @returns {Promise<{wavBuffer: Buffer, sampleRate: number, durationSec: number}>}
   */
  async synthesize(text, opts = {}) {
    await this._ensureLoaded();

    const voice = opts.voice ?? DEFAULT_VOICE;
    const lang = opts.lang ?? "en";
    const speed = opts.speed ?? DEFAULT_SPEED;
    const steps = opts.steps ?? DEFAULT_STEPS;
    const silenceMs = opts.silenceMs ?? 300;

    this._validateVoice(voice);
    const style = this._getVoiceStyle(voice);

    const maxLen = lang === "ko" ? 120 : 300;
    const chunks = chunkText(text, maxLen);

    let wavCat = null;
    let totalDuration = 0;
    const silenceSamples = Math.floor((silenceMs / 1000) * this.sampleRate);
    const silence = new Array(silenceSamples).fill(0);

    for (const chunk of chunks) {
      const { wav, duration } = await this._infer([chunk], [lang], style, steps, speed);
      const wavLen = Math.floor(this.sampleRate * duration[0]);
      const wavSlice = wav.slice(0, wavLen);

      if (wavCat === null) {
        wavCat = wavSlice;
      } else {
        wavCat = [...wavCat, ...silence, ...wavSlice];
      }
      totalDuration += duration[0] + (wavCat.length > wavSlice.length ? silenceMs / 1000 : 0);
    }

    const wavBuffer = encodeWav(wavCat || [], this.sampleRate);
    return { wavBuffer, sampleRate: this.sampleRate, durationSec: totalDuration };
  }
}

// Singleton engine instance (lazy)
let _engine = null;
export function getEngine(opts = {}) {
  if (!_engine) _engine = new SupertonicEngine(opts);
  return _engine;
}
