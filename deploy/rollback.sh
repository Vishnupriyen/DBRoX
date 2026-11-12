#!/usr/bin/env bash
# One step back to the version that was live before the last update. Data is untouched (database changes only ever add).
set -euo pipefail
cd "$(dirname "$0")"
PREV=$(cat .previous-tag 2>/dev/null) || { echo "No earlier version recorded."; exit 1; }
LIVE=$(cat .live-tag)
TAG=$PREV docker compose up -d --no-deps server
echo "$PREV" > .live-tag; echo "$LIVE" > .previous-tag
echo "✔ Back on version $PREV (was $LIVE)."
