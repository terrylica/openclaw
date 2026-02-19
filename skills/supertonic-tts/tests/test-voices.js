/**
 * test-voices.js — Test all available voices (M1-M5, F1-F5)
 * Logs which voices succeed and which fail.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");

const { getEngine, AVAILABLE_VOICES } = await import(`${skillRoot}/src/engine.js`);
const { logAudit } = await import(`${skillRoot}/audit.js`);

const engine = getEngine();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "st2-voices-"));

console.log("=== test-voices.js ===");
console.log(`Testing ${AVAILABLE_VOICES.length} voices: ${AVAILABLE_VOICES.join(", ")}`);
console.log(`Output dir: ${tmpDir}\n`);

const text = "The quick brown fox jumps over the lazy dog.";
const results = [];

for (const voice of AVAILABLE_VOICES) {
  const outFile = path.join(tmpDir, `${voice}.wav`);
  const startMs = Date.now();
  try {
    const result = await engine.synthesize(text, { voice, lang: "en" });
    fs.writeFileSync(outFile, result.wavBuffer);
    const stat = fs.statSync(outFile);
    if (stat.size < 44) throw new Error(`File too small: ${stat.size} bytes`);

    const durationMs = Date.now() - startMs;
    logAudit({ voice, chars: text.length, durationMs, outputFile: outFile, success: true });
    console.log(
      `  ✓ ${voice} — ${stat.size} bytes | ${result.durationSec.toFixed(2)}s audio | ${(durationMs / 1000).toFixed(2)}s inference`,
    );
    results.push({ voice, success: true, sizeBytes: stat.size, durationMs });
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
    console.error(`  ✗ ${voice} — FAILED: ${err.message}`);
    results.push({ voice, success: false, error: err.message, durationMs });
  }
}

console.log("\n--- Summary ---");
const passed = results.filter((r) => r.success);
const failed = results.filter((r) => !r.success);
console.log(`Passed: ${passed.length}/${results.length}`);
if (failed.length > 0) {
  console.log(`Failed voices: ${failed.map((r) => r.voice).join(", ")}`);
}

process.exit(failed.length === 0 ? 0 : 1);
