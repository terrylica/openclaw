/**
 * supertonic-tts/audit.js
 *
 * Audit trail logger. Appends one JSONL line per TTS call to:
 *   ~/.openclaw/logs/supertonic-tts-audit.jsonl
 *
 * Each line:
 *   {"ts":1234567890,"voice":"M3","chars":142,"durationMs":234,"outputFile":"/tmp/...","success":true,"error":null}
 *
 * Usage:
 *   import { logAudit } from './audit.js';
 *   logAudit({ voice: 'M3', chars: 50, durationMs: 400, outputFile: '/tmp/foo.wav', success: true });
 */

import fs from "fs";
import os from "os";
import path from "path";

/** Resolve audit log path from env or default. */
function resolveAuditPath() {
  const fromEnv = process.env.SUPERTONIC_AUDIT_LOG?.trim();
  if (fromEnv) {
    return fromEnv.startsWith("~/") ? path.join(os.homedir(), fromEnv.slice(2)) : fromEnv;
  }
  return path.join(os.homedir(), ".openclaw", "logs", "supertonic-tts-audit.jsonl");
}

const AUDIT_LOG_PATH = resolveAuditPath();

/**
 * Append one line to the audit log.
 * Never throws — errors are silently ignored so TTS delivery isn't blocked.
 *
 * @param {object} entry
 * @param {string}  entry.voice       — voice used (e.g. "M3")
 * @param {number}  entry.chars       — character count of input text
 * @param {number}  entry.durationMs  — inference wall-clock time in ms
 * @param {string}  [entry.outputFile] — path to generated audio file
 * @param {boolean} entry.success     — whether synthesis succeeded
 * @param {string|null} [entry.error] — error message if failed
 */
export function logAudit(entry) {
  try {
    const line = JSON.stringify({
      ts: Math.floor(Date.now() / 1000),
      voice: entry.voice ?? "unknown",
      chars: entry.chars ?? 0,
      durationMs: entry.durationMs ?? 0,
      outputFile: entry.outputFile ?? null,
      success: entry.success ?? false,
      error: entry.error ?? null,
    });
    // Ensure log directory exists
    const dir = path.dirname(AUDIT_LOG_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, line + "\n", "utf8");
  } catch {
    // Never block TTS on audit failures
  }
}

export { AUDIT_LOG_PATH };
