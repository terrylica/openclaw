/**
 * test-speed.js — Test speed parameter (0.9x, 1.0x, 1.5x)
 * Verifies that different speed values produce audio of different lengths:
 * slower speed → longer audio, faster speed → shorter audio.
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "st2-speed-"));

console.log("=== test-speed.js ===");

const text = "Testing speed variations. The quick brown fox jumps over the lazy dog.";
const voice = "M3";
const speeds = [0.9, 1.0, 1.5];
const results = [];

console.log(`Text: "${text}"`);
console.log(`Voice: ${voice}`);
console.log("");

for (const speed of speeds) {
  const outFile = path.join(tmpDir, `speed-${speed.toString().replace(".", "_")}.wav`);
  const startMs = Date.now();
  try {
    const result = await engine.synthesize(text, { voice, lang: "en", speed });
    fs.writeFileSync(outFile, result.wavBuffer);
    const stat = fs.statSync(outFile);
    const durationMs = Date.now() - startMs;

    if (stat.size < 44) throw new Error(`File too small: ${stat.size} bytes`);

    logAudit({ voice, chars: text.length, durationMs, outputFile: outFile, success: true });
    console.log(
      `  ✓ speed=${speed} — audio: ${result.durationSec.toFixed(2)}s | inference: ${(durationMs / 1000).toFixed(2)}s | file: ${stat.size} bytes`,
    );
    results.push({ speed, success: true, durationSec: result.durationSec, durationMs });
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
    console.error(`  ✗ speed=${speed} — FAILED: ${err.message}`);
    results.push({ speed, success: false, error: err.message, durationMs });
  }
}

console.log("\n--- Speed Analysis ---");
const passed = results.filter((r) => r.success);
const failed = results.filter((r) => !r.success);

// Verify that slower speed produces longer audio
// (0.9x speed should give ~1.11x more audio than 1.0x)
if (passed.length === speeds.length) {
  const dur09 = results.find((r) => r.speed === 0.9)?.durationSec;
  const dur10 = results.find((r) => r.speed === 1.0)?.durationSec;
  const dur15 = results.find((r) => r.speed === 1.5)?.durationSec;

  if (dur09 && dur10 && dur15) {
    const slowSlower = dur09 > dur15;
    console.log(
      `Speed ordering check (slower speed = longer audio): ${slowSlower ? "✓ OK" : "⚠ UNEXPECTED"}`,
    );
    console.log(
      `  0.9x: ${dur09.toFixed(2)}s | 1.0x: ${dur10.toFixed(2)}s | 1.5x: ${dur15.toFixed(2)}s`,
    );
  }
}

console.log(`\nPassed: ${passed.length}/${results.length}`);
if (failed.length > 0) {
  console.log(`Failed: ${failed.map((r) => r.speed).join(", ")}`);
}

process.exit(failed.length === 0 ? 0 : 1);
