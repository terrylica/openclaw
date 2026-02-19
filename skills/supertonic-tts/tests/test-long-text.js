/**
 * test-long-text.js — Test chunking behavior with a long paragraph
 * Verifies that text longer than maxLen (300 chars) is correctly chunked
 * and all chunks are synthesized and concatenated.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

const { getEngine } = await import(`${skillRoot}/src/engine.js`);
const { logAudit } = await import(`${skillRoot}/audit.js`);

const engine = getEngine();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "st2-long-"));
const outFile = path.join(tmpDir, "long-text.wav");

console.log("=== test-long-text.js ===");

// A paragraph that should be chunked (>300 chars)
const longText = `Artificial intelligence has transformed the way we interact with technology. 
From voice assistants to autonomous vehicles, machine learning models now power 
many aspects of modern life. Text-to-speech systems like Supertonic represent 
one of the most useful applications, enabling natural-sounding speech synthesis 
from arbitrary text input. This test ensures that long-form content is correctly 
chunked and concatenated into a smooth, continuous audio stream.`
  .replace(/\n/g, " ")
  .trim();

console.log(`Text length: ${longText.length} chars`);
console.log(`Text: "${longText.slice(0, 80)}..."`);

const voice = "M3";
const startMs = Date.now();
let success = false;

try {
  const result = await engine.synthesize(longText, { voice, lang: "en" });
  fs.writeFileSync(outFile, result.wavBuffer);

  const stat = fs.statSync(outFile);
  const durationMs = Date.now() - startMs;

  if (stat.size < 44) throw new Error(`File too small: ${stat.size} bytes`);

  // A long text should produce longer audio than a short phrase
  // (basic sanity: > 0.5 seconds)
  const minExpectedSec = 0.5;
  if (result.durationSec < minExpectedSec) {
    throw new Error(
      `Audio too short: ${result.durationSec.toFixed(2)}s (expected > ${minExpectedSec}s)`,
    );
  }

  logAudit({ voice, chars: longText.length, durationMs, outputFile: outFile, success: true });
  console.log(
    `✓ PASS — file: ${stat.size} bytes | audio: ${result.durationSec.toFixed(2)}s | inference: ${(durationMs / 1000).toFixed(2)}s`,
  );
  success = true;
} catch (err) {
  const durationMs = Date.now() - startMs;
  logAudit({
    voice,
    chars: longText.length,
    durationMs,
    outputFile: null,
    success: false,
    error: err.message,
  });
  console.error(`✗ FAIL — ${err.message}`);
}

process.exit(success ? 0 : 1);
