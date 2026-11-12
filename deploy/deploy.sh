#!/usr/bin/env bash
# Put a new server version live, safely: backup first, then switch, then check; if the check fails it goes straight back.
# Usage (on the server, in the repo folder): deploy/deploy.sh            — only between 11 pm and 5 am IST
#                                            deploy/deploy.sh --now      — an urgent fix in the day (founder's yes)
set -euo pipefail
cd "$(dirname "$0")"
HOUR=$(TZ=Asia/Kolkata date +%H)
if [[ "${1:-}" != "--now" ]] && (( 10#$HOUR >= 5 && 10#$HOUR < 23 )); then
  echo "Updates go out between 11 pm and 5 am, when nobody is billing. For an urgent fix: deploy/deploy.sh --now"; exit 1
fi
NEW=$(git -C .. rev-parse --short HEAD)
PREV=$(cat .live-tag 2>/dev/null || true)
[[ "$NEW" == "$PREV" ]] && { echo "Version $NEW is already live."; exit 0; }

echo "1/4 Backup before the change"; ./backup.sh
echo "2/4 Build version $NEW"
cp -r ../shared ../server/shared
docker build -q -t "hanubix-server:$NEW" ../server >/dev/null
rm -rf ../server/shared
echo "3/4 Switch to $NEW (database changes only ever add, so $PREV keeps working if we go back)"
TAG=$NEW docker compose up -d --no-deps server
echo "4/4 Check"
for i in $(seq 1 30); do
  if docker compose exec -T server node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    [[ -n "$PREV" ]] && echo "$PREV" > .previous-tag
    echo "$NEW" > .live-tag
    echo "✔ Version $NEW is live. To go back: deploy/rollback.sh"; exit 0
  fi
  sleep 2
done
echo "✘ Version $NEW did not start — going back to $PREV"
[[ -n "$PREV" ]] && TAG=$PREV docker compose up -d --no-deps server
exit 1
