#!/bin/bash
set -e
TARGET="$HOME/.copilot/extensions/copilot-ledger"
mkdir -p "$TARGET"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/extension/extension.mjs" ] && [ -f "$SCRIPT_DIR/extension/lib.mjs" ]; then
  cp "$SCRIPT_DIR/extension/extension.mjs" "$TARGET/extension.mjs"
  cp "$SCRIPT_DIR/extension/lib.mjs" "$TARGET/lib.mjs"
else
  if [ -z "${COPILOT_LEDGER_RAW_BASE:-}" ]; then
    echo "Set COPILOT_LEDGER_RAW_BASE to the raw GitHub URL when running install.sh through curl." >&2
    exit 1
  fi
  RAW_BASE="${COPILOT_LEDGER_RAW_BASE%/}"
  curl -fsSL "$RAW_BASE/extension/extension.mjs" -o "$TARGET/extension.mjs"
  curl -fsSL "$RAW_BASE/extension/lib.mjs" -o "$TARGET/lib.mjs"
fi
echo "✓ copilot-ledger installed at $TARGET"
echo "  Run /ledger init in any repo to start tracking."
