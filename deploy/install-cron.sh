#!/usr/bin/env bash
# Puts every scheduled job of the Hanubix server into root's crontab (run once after setup, and again after an update
# that changes this file). The machine's clock is UTC; the IST time is in each comment. Re-running replaces the block.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
LOG=/var/log/hanubix
mkdir -p "$LOG"
BLOCK=$(cat <<EOF
# >>> hanubix (deploy/install-cron.sh — do not edit by hand)
* * * * *    $D/cron-call.sh relay      >> $LOG/relay.log 2>&1      # company-link relay safety net, every minute
*/5 * * * *  $D/cron-call.sh cover      >> $LOG/cover.log 2>&1      # head office stock figures, every 5 minutes
35 18 * * *  $D/cron-call.sh daily      >> $LOG/daily.log 2>&1      # 00:05 IST plans, trial and grace status
30 20 * * *  $D/cron-call.sh archive    >> $LOG/archive.log 2>&1    # 02:00 IST old records to the archive
0 21 * * *   $D/backup.sh               >> $LOG/backup.log 2>&1     # 02:30 IST encrypted backup, copied off the machine
30 21 * * *  $D/verify-log.sh           >> $LOG/verify-log.log 2>&1 # 03:00 IST activity-log chain check + anchor
0 22 1 * *   $D/cron-call.sh retention  >> $LOG/retention.log 2>&1  # 03:30 IST on the 1st: retention (purges, log months)
15 22 * * 0  $D/backup-env.sh           >> $LOG/backup.log 2>&1     # 03:45 IST Sundays: the encrypted .env copy
*/5 * * * *  $D/monitor.sh              >> $LOG/monitor.log 2>&1    # health, disk, backups, jobs
*/10 * * * * $D/security-watch.sh       >> $LOG/security.log 2>&1   # wrong logins, admin key, cross-firm requests
0 3 1 * *    $D/access-review.sh        >> $LOG/review.log 2>&1     # 08:30 IST on the 1st: monthly access review report
# <<< hanubix
EOF
)
CUR=$(crontab -l 2>/dev/null | sed '/^# >>> hanubix/,/^# <<< hanubix/d' || true)
printf '%s\n%s\n' "$CUR" "$BLOCK" | sed '/^$/N;/^\n$/D' | crontab -
# the job logs hold IPs and URLs (personal data): kept 90 days at most
cat > /etc/logrotate.d/hanubix <<EOF
$LOG/*.log {
  weekly
  rotate 12
  maxage 90
  compress
  missingok
  notifempty
}
EOF
echo "✔ Hanubix jobs installed:"; crontab -l | sed -n '/^# >>> hanubix/,/^# <<< hanubix/p'
