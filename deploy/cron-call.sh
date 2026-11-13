#!/usr/bin/env bash
# Runs one of the server's scheduled jobs from inside the machine: cron-call.sh relay|cover|archive|daily|retention
# The call goes to the server container directly (never through the public address; Caddy refuses /v1/cron/* from outside)
# with CRON_KEY from .env. Each job records its run in job_runs; monitor.sh alerts when one is late.
set -euo pipefail
cd "$(dirname "$0")"
export TAG=$(cat .live-tag 2>/dev/null || echo none)
JOB="${1:?which job: relay, cover, archive, daily, retention}"
[[ "$JOB" =~ ^[a-z-]+$ ]] || { echo "bad job name"; exit 2; }
docker compose exec -T server node -e "
fetch('http://localhost:8080/v1/cron/' + process.argv[1], { method: 'POST', headers: { 'x-cron-key': process.env.CRON_KEY || '', 'content-type': 'application/json' }, body: '{}' })
  .then(async r => { console.log(new Date().toISOString(), process.argv[1], r.status, (await r.text()).slice(0, 300)); process.exit(r.ok ? 0 : 1); })
  .catch(e => { console.error(new Date().toISOString(), process.argv[1], 'failed', e.message); process.exit(1); })" "$JOB"
