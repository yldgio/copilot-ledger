#!/bin/bash
set -e
TARGET="$HOME/.copilot/extensions/copilot-ledger"
mkdir -p "$TARGET"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/extension/extension.mjs" "$TARGET/extension.mjs"
echo "✓ copilot-ledger installed at $TARGET"
echo "  Run /ledger init in any repo to start tracking."
