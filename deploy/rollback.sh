#!/usr/bin/env bash
# One step back to the version that was live before the last update. Data is untouched (database changes only ever add).
set -euo pipefail
cd "$(dirname "$0")"
PREV=$(cat .previous-tag 2>/dev/null || true)
LIVE=$(cat .live-tag 2>/dev/null || true)
[[ -z "$PREV" ]] && { echo "No earlier version recorded — nothing to go back to."; exit 1; }
docker image inspect "hanubix-server:$PREV" >/dev/null 2>&1 || { echo "Version $PREV is no longer on this machine."; exit 1; }
TAG=$PREV docker compose up -d --no-deps server
for _ in $(seq 1 30); do
  if TAG=$PREV docker compose exec -T server node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo "$PREV" > .live-tag; [[ -n "$LIVE" ]] && echo "$LIVE" > .previous-tag
    echo "✔ Back on version $PREV (was ${LIVE:-unknown})."; exit 0
  fi
  sleep "${HEALTH_WAIT:-2}"
done
echo "✘ Version $PREV did not start — putting ${LIVE:-it} back"
[[ -n "$LIVE" ]] && TAG=$LIVE docker compose up -d --no-deps server
exit 1
