#!/usr/bin/env bash
# run-all.sh — Run all Supertonic TTS tests and print a pass/fail summary
# Usage: bash tests/run-all.sh [--skip-voices] [--skip-long] [--skip-speed]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Parse flags
SKIP_VOICES=false
SKIP_LONG=false
SKIP_SPEED=false
for arg in "$@"; do
  case "$arg" in
    --skip-voices) SKIP_VOICES=true ;;
    --skip-long)   SKIP_LONG=true   ;;
    --skip-speed)  SKIP_SPEED=true  ;;
  esac
done

echo "================================================"
echo " Supertonic TTS — Full Test Suite"
echo " Skill: $SKILL_DIR"
echo "================================================"
echo ""

# Determine node executable (prefer bun, fall back to node)
if command -v bun &>/dev/null; then
  NODE="bun"
else
  NODE="node"
fi
echo "Runtime: $($NODE --version) ($NODE)"
echo ""

PASS=0
FAIL=0
SKIP=0

run_test() {
  local name="$1"
  local file="$2"
  local skip="$3"

  echo "--- $name ---"
  if [ "$skip" = "true" ]; then
    echo "  SKIPPED"
    ((SKIP++))
    echo ""
    return
  fi

  set +e
  "$NODE" "$file"
  local exit_code=$?
  set -e

  if [ $exit_code -eq 0 ]; then
    ((PASS++))
    echo "  Result: PASS"
  else
    ((FAIL++))
    echo "  Result: FAIL (exit $exit_code)"
  fi
  echo ""
}

run_test "test-basic"      "$SCRIPT_DIR/test-basic.js"      "false"
run_test "test-voices"     "$SCRIPT_DIR/test-voices.js"     "$SKIP_VOICES"
run_test "test-long-text"  "$SCRIPT_DIR/test-long-text.js"  "$SKIP_LONG"
run_test "test-speed"      "$SCRIPT_DIR/test-speed.js"      "$SKIP_SPEED"

echo "================================================"
echo " RESULTS: $PASS passed | $FAIL failed | $SKIP skipped"
echo "================================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
exit 0
