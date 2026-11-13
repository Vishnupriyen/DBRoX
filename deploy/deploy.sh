#!/usr/bin/env bash
# Put a new server version live, safely: backup first, then switch, then check; if the check fails it goes straight back.
# Usage (on the server, in the repo folder): deploy/deploy.sh            — only between 11 pm and 5 am IST
#                                            deploy/deploy.sh --now      — an urgent fix in the day (founder's yes)
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
HOUR=$(TZ=Asia/Kolkata date +%H)
if [[ "${1:-}" != "--now" ]] && (( 10#$HOUR >= 5 && 10#$HOUR < 23 )); then
  echo "Updates go out between 11 pm and 5 am, when nobody is billing. For an urgent fix: deploy/deploy.sh --now"; exit 1
fi
NEW=$(git -C .. rev-parse --short HEAD)
PREV=$(cat .live-tag 2>/dev/null || true)
export TAG=${PREV:-none}
[[ "$NEW" == "$PREV" ]] && { echo "Version $NEW is already live."; exit 0; }
# only code that passed the full quality gate on GitHub goes live: the Deploy workflow tags it gate-<commit> after the gate
# (security standard, section 8 item 14). No tag → no deploy, whoever runs this.
git -C .. fetch -q --tags 2>/dev/null || true
if ! git -C .. tag --points-at HEAD | grep -q '^gate-'; then
  echo "✘ $NEW has no gate-passed tag. Run the Deploy workflow on GitHub for this commit first (it runs the gate and tags it)."; exit 1
fi
chmod 600 .env 2>/dev/null || true   # the secrets file: never readable by other users of the machine
# every deploy is written to the activity log: who, which version, when
logdeploy() { docker compose exec -T db psql -U hanubix -d dbrox -qtAX -c "SELECT seclog_add(NULL, '$(id -un 2>/dev/null || echo root)', 'founder', 'deploy', '$1', NULL, $2, '{\"from\": \"${PREV:-none}\"}'::jsonb)" >/dev/null 2>&1 || true; }
healthy() {
  for _ in $(seq 1 30); do
    TAG=$1 docker compose exec -T server node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && return 0
    sleep "${HEALTH_WAIT:-2}"
  done
  return 1
}

echo "1/4 Backup before the change"; ./backup.sh --before-deploy
echo "2/4 Build version $NEW"
trap 'rm -rf ../server/shared' EXIT   # the image gets today's shared table list, never a stale copy
rm -rf ../server/shared && cp -r ../shared ../server/shared
docker build -q --build-arg "NODE_IMAGE=${NODE_IMAGE:-node:22-slim}" -t "hanubix-server:$NEW" ../server >/dev/null
echo "3/4 Switch to $NEW (database changes only ever add, so ${PREV:-the earlier version} keeps working if we go back)"
TAG=$NEW docker compose up -d --no-deps server
echo "4/4 Check"
if healthy "$NEW"; then
  [[ -n "$PREV" ]] && echo "$PREV" > .previous-tag
  echo "$NEW" > .live-tag
  logdeploy "$NEW" true
  echo "✔ Version $NEW is live. To go back: deploy/rollback.sh"; exit 0
fi
if [[ -n "$PREV" ]]; then
  echo "✘ Version $NEW did not start — going back to $PREV"
  TAG=$PREV docker compose up -d --no-deps server
  healthy "$PREV" && echo "✔ Back on $PREV." || echo "✘ $PREV did not start either — check: docker compose logs server"
else
  echo "✘ Version $NEW did not start and there is no earlier version — stopped. Check: docker compose logs server"
  TAG=$NEW docker compose stop server
fi
logdeploy "$NEW" false
exit 1
