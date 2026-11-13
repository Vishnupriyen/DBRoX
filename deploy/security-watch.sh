#!/usr/bin/env bash
# Every 10 minutes (cron): reads the activity log (security_log) and tells the founder about anything that looks like an
# attack or a mistake. Each kind of alert is sent once when it starts and once when it clears — never once per event.
set -uo pipefail
source "$(dirname "$0")/lib.sh"
MIN=${WATCH_MINUTES:-10}
ROWS=$(q "WITH w AS (SELECT * FROM security_log WHERE at > now() - make_interval(mins => ${MIN}))
  SELECT 'fail_total|' || count(*) FILTER (WHERE event = 'login.fail') FROM w
  UNION ALL SELECT 'fail_one_ip|' || COALESCE(max(n), 0) FROM (SELECT count(*) n FROM w WHERE event = 'login.fail' GROUP BY ip) a
  UNION ALL SELECT 'lockouts|' || count(*) FILTER (WHERE event = 'login.locked') FROM w
  UNION ALL SELECT 'admin_denied|' || count(*) FILTER (WHERE event IN ('admin.denied', 'cron.denied')) FROM w
  UNION ALL SELECT 'admin_night|' || count(*) FILTER (WHERE event = 'admin.ok' AND extract(hour FROM at AT TIME ZONE 'Asia/Kolkata') NOT BETWEEN 9 AND 20) FROM w
  UNION ALL SELECT 'new_owner|' || count(*) FILTER (WHERE event IN ('staff.add', 'staff.change') AND detail->>'role' IN ('owner', 'cadmin')) FROM w
  UNION ALL SELECT 'cross_tenant|' || count(*) FILTER (WHERE event = 'tenant.denied') FROM w
  UNION ALL SELECT 'bulk_download|' || COALESCE(max(n), 0) FROM (SELECT count(*) n FROM w WHERE event IN ('archive.month', 'privacy.export', 'support.read') GROUP BY actor) b" 2>/dev/null)
if [[ -z "$ROWS" ]]; then check security-watch 1 "could not read the activity log"; exit 0; fi
check security-watch 0 "the activity log is readable again"
val() { echo "$ROWS" | awk -F'|' -v k="$1" '$1==k{print $2+0}'; }
check failed-logins $(( $(val fail_total) > ${WATCH_FAILS:-20} || $(val fail_one_ip) > ${WATCH_FAILS:-20} ? 1 : 0 )) \
  "$(val fail_total) wrong PIN logins in ${MIN} minutes (most from one place: $(val fail_one_ip))"
check lockouts $(( $(val lockouts) > 3 ? 1 : 0 )) "$(val lockouts) logins locked for wrong PINs in ${MIN} minutes"
check admin-key $(( $(val admin_denied) > 0 ? 1 : 0 )) "$(val admin_denied) wrong admin/cron key tries in ${MIN} minutes"
check admin-night $(( $(val admin_night) > 0 ? 1 : 0 )) "the admin key was used outside office hours ($(val admin_night) times)"
check new-owner $(( $(val new_owner) > 0 ? 1 : 0 )) "a new owner or head-office login was created or changed"
check cross-tenant $(( $(val cross_tenant) > 0 ? 1 : 0 )) "$(val cross_tenant) requests for another firm's data were refused"
check bulk-download $(( $(val bulk_download) > ${WATCH_DOWNLOADS:-50} ? 1 : 0 )) "one login downloaded $(val bulk_download) bundles in ${MIN} minutes"
exit 0
