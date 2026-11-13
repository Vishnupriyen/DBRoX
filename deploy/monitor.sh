#!/usr/bin/env bash
# Every 5 minutes (cron): is the service up, is there room, is the backup fresh, are the jobs running?
# Alerts go to the founder only when something changes (see lib.sh). An outside uptime check (free tier, set up once —
# deploy/README.md) covers the case where this whole machine is dead.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

# 1. the server answers /health (3 tries, HEALTH_GAP seconds apart)
up=0
for i in 1 2 3; do
  if docker compose exec -T server node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then up=1; break; fi
  (( i < 3 )) && sleep "${HEALTH_GAP:-20}"
done
check health $(( 1 - up )) "the Hanubix server is not answering its health check (docker compose logs server)"

# 2. disk and memory
DISK=$(df -P "${DISK_PATH:-/}" | awk 'NR==2{gsub("%","",$5); print $5}')
check disk $(( ${DISK:-0} > ${DISK_MAX:-80} ? 1 : 0 )) "disk ${DISK}% full (limit ${DISK_MAX:-80}%)"
MEM=$(free | awk '/^Mem:/{printf "%d", ($2-$7)*100/$2}' 2>/dev/null || echo 0)
check memory $(( ${MEM:-0} > ${MEM_MAX:-90} ? 1 : 0 )) "memory ${MEM}% used (limit ${MEM_MAX:-90}%)"

# 3. the last good backup (written by backup.sh after the copy left the machine) is under 26 hours old
H=$(age_hours .last-backup-ok)
check backup $(( H > 26 ? 1 : 0 )) "no good off-site backup for ${H} hours (limit 26)"
# 4. the activity-log check ran in the last 26 hours
H=$(age_hours .last-verify-ok)
check seclog-verify $(( H > 26 ? 1 : 0 )) "the activity-log chain check has not passed for ${H} hours"

# 5. the server's scheduled jobs ran in their window (job_runs is written by each /v1/cron route)
if (( up == 1 )); then
  LATE=$(q "SELECT string_agg(job, ', ') FROM (VALUES ('relay', 5), ('cover', 15), ('archive', 1560), ('daily', 1560), ('retention', 46080)) AS w(job, mins)
            LEFT JOIN job_runs j USING (job) WHERE j.last_ok_at IS NULL OR j.last_ok_at < now() - make_interval(mins => w.mins)" 2>/dev/null || echo "?")
  check jobs $([[ -n "$LATE" ]] && echo 1 || echo 0) "scheduled jobs late or failing: ${LATE:-none}"
  FAILED=$(q "SELECT count(*) FROM relay_failed" 2>/dev/null || echo 0)
  check relay $(( ${FAILED:-0} > 0 ? 1 : 0 )) "${FAILED} company-link records could not be relayed (relay_failed)"
  CAP=$(q "SELECT COALESCE(max(count), 0) FROM scan_daily WHERE day = current_date" 2>/dev/null || echo 0)
  check scan-cap $(( ${CAP:-0} >= ${SCAN_DAILY_CAP:-2000} ? 1 : 0 )) "the daily AI photo-reading cap (${SCAN_DAILY_CAP:-2000}) is reached"
fi

# 6. containers restarting by themselves
for c in server db caddy; do
  ID=$(docker compose ps -q "$c" 2>/dev/null | head -1)
  [[ -z "$ID" ]] && continue
  N=$(docker inspect -f '{{.RestartCount}}' "$ID" 2>/dev/null || echo 0)
  WAS=$(cat ".state/restarts-$c" 2>/dev/null || echo "$N")
  echo "$N" > ".state/restarts-$c"
  check "restart-$c" $(( N > WAS ? 1 : 0 )) "container $c restarted by itself (restart count ${N})"
done

# 7. the HTTPS certificate has more than 14 days left
if [[ -n "${DOMAIN:-}" ]] && command -v openssl >/dev/null; then
  END=$(echo | openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [[ -n "$END" ]]; then
    DAYS=$(( ( $(date -u -d "$END" +%s) - $(date -u +%s) ) / 86400 ))
    check certificate $(( DAYS < 14 ? 1 : 0 )) "the HTTPS certificate for ${DOMAIN} ends in ${DAYS} days"
  fi
fi
exit 0
