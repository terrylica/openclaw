/**
 * test-basic.js — Basic synthesis test
 * Generates a short phrase and verifies the output file exists and is non-zero.
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "st2-test-"));
const outFile = path.join(tmpDir, "test-basic.wav");

console.log("=== test-basic.js ===");
console.log(`Output: ${outFile}`);

const text = "Hello from Supertonic two. This is a basic synthesis test.";
const voice = "M3";

const startMs = Date.now();
let success = false;

try {
  const result = await engine.synthesize(text, { voice, lang: "en" });
  fs.writeFileSync(outFile, result.wavBuffer);

  const stat = fs.statSync(outFile);
  const durationMs = Date.now() - startMs;

  if (stat.size === 0) {
    throw new Error("Output file is empty (0 bytes)");
  }
  if (stat.size < 44) {
    throw new Error(`Output file too small (${stat.size} bytes) — likely invalid WAV`);
  }

  // Verify WAV header magic
  const header = Buffer.alloc(4);
  const fd = fs.openSync(outFile, "r");
  fs.readSync(fd, header, 0, 4, 0);
  fs.closeSync(fd);
  if (header.toString("ascii") !== "RIFF") {
    throw new Error("Output is not a valid WAV file (missing RIFF header)");
  }

  logAudit({ voice, chars: text.length, durationMs, outputFile: outFile, success: true });

  console.log(
    `✓ PASS — file size: ${stat.size} bytes | duration: ${result.durationSec.toFixed(2)}s | inference: ${(durationMs / 1000).toFixed(2)}s`,
  );
  success = true;
} catch (err) {
  const durationMs = Date.now() - startMs;
  logAudit({
    voice,
    chars: text.length,
    durationMs,
    outputFile: null,
    success: false,
    error: err.message,
  });
  console.error(`✗ FAIL — ${err.message}`);
}

process.exit(success ? 0 : 1);
