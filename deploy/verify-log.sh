#!/usr/bin/env bash
# Nightly (cron): walks the activity log's hash chain. Every row's hash = sha256(previous hash + the row), so editing or
# removing any row breaks the chain from that row on. Prints "chain broken at id N" and exits non-zero (and alerts).
# When the chain is whole, the day's last hash is written off the machine (BACKUP_BUCKET/seclog-anchors/), so even
# someone with full database access cannot rewrite history unseen: tomorrow's chain must still pass through today's anchor.
set -uo pipefail
source "$(dirname "$0")/lib.sh"
BROKEN=$(q "SELECT seclog_verify()") || { ./alert.sh verify-log "could not run the activity-log check"; echo "✘ could not run the check"; exit 2; }
if [[ -n "$BROKEN" ]]; then
  echo "✘ chain broken at id $BROKEN"
  ./alert.sh verify-log "activity log chain broken at id $BROKEN — freeze the logs, see docs/security/09-incident-response.md"
  echo bad > .state/seclog-chain
  exit 1
fi
mkdir -p anchors
DAY=$(TZ=Asia/Kolkata date +%Y-%m-%d)
# yesterday's anchor must still be in the chain unchanged (a whole chain rebuilt from scratch would pass the walk above)
LAST=$(ls anchors/*.txt 2>/dev/null | grep -v "/$DAY.txt" | sort | tail -1 || true)
if [[ -n "$LAST" ]]; then
  read -r AID AHASH < "$LAST"
  if [[ "$AID" =~ ^[0-9]+$ ]]; then
    NOW=$(q "SELECT encode(hash, 'hex') FROM security_log WHERE id = $AID")
    if [[ -n "$NOW" && "$NOW" != "$AHASH" ]]; then
      echo "✘ chain broken at id $AID (the row no longer matches the anchor kept off the machine)"
      ./alert.sh verify-log "activity log rewritten: row $AID no longer matches its anchor — see docs/security/09-incident-response.md"
      echo bad > .state/seclog-chain; exit 1
    fi
  fi
fi
q "SELECT id || ' ' || encode(hash, 'hex') FROM security_log ORDER BY id DESC LIMIT 1" > "anchors/$DAY.txt"
if [[ -n "${BACKUP_BUCKET:-}" ]]; then
  gsutil -q cp "anchors/$DAY.txt" "$BACKUP_BUCKET/seclog-anchors/$DAY.txt" || { ./alert.sh verify-log "could not copy today's log anchor off the machine"; exit 1; }
fi
find anchors -name '*.txt' -mtime +400 -delete
date -u +%Y-%m-%dT%H:%M:%SZ > .last-verify-ok
echo ok > .state/seclog-chain
echo "✔ activity log chain whole ($(cut -d' ' -f1 "anchors/$DAY.txt" 2>/dev/null || echo 0) rows so far)"
