#!/usr/bin/env bash
# MONTHLY ACCESS REVIEW (cron, 1st of the month): writes deploy/reviews/access-review-YYYY-MM.md for the founder to read,
# tick and sign. The signed copy goes into the evidence folder (docs/security/22-evidence-index.md).
set -uo pipefail
source "$(dirname "$0")/lib.sh"
mkdir -p reviews
MONTH=$(TZ=Asia/Kolkata date +%Y-%m)
F="reviews/access-review-$MONTH.md"
table() { echo; echo '```'; q "$1" 2>&1; echo '```'; }
{
  echo "# Access review — $MONTH"
  echo; echo "Made $(TZ=Asia/Kolkata date '+%d %b %Y %H:%M') IST by deploy/access-review.sh. Read every section, tick it, sign at the end."
  echo; echo "## 1. Logins per firm (role, last login)"
  table "SELECT t.name AS firm, u.role, count(*) AS people, max(u.last_login)::date AS last_login FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.active GROUP BY 1, 2 ORDER BY 1, 2"
  echo; echo "## 2. People not logged in for 90 days (remove access if they left)"
  table "SELECT t.name AS firm, u.id, u.role, COALESCE(u.last_login::date::text, 'never') AS last_login FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.active AND (u.last_login IS NULL OR u.last_login < now() - interval '90 days') ORDER BY 1"
  echo; echo "## 3. Owner and head-office logins (they can see and export everything)"
  table "SELECT t.name AS firm, u.id, u.role, length(u.pin_hash) > 0 AS has_pin, u.pin_len, u.last_login::date FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.active AND u.role IN ('owner', 'cadmin') ORDER BY 1"
  echo; echo "## 4. Admin key (control panel) use last month"
  table "SELECT at AT TIME ZONE 'Asia/Kolkata' AS at_ist, event, target, ip, ok FROM security_log WHERE event LIKE 'admin.%' AND at > now() - interval '1 month' ORDER BY at"
  echo; echo "## 5. Support access granted and used last month"
  table "SELECT at AT TIME ZONE 'Asia/Kolkata' AS at_ist, event, tenant_id, actor FROM security_log WHERE event LIKE 'support.%' AND at > now() - interval '1 month' ORDER BY at"
  echo; echo "## 6. SSH keys that can log in to this machine"
  echo '```'; for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do [[ -f "$f" ]] && { echo "$f"; ssh-keygen -lf "$f" 2>&1; }; done; echo '```'
  echo; echo "## 7. Check by hand (tick each)"
  echo "- [ ] GitHub: collaborators of Vishnupriyen/Hanubix — only the people who should be there (Settings → Collaborators)"
  echo "- [ ] Hostinger: users of the account and the VPS panel"
  echo "- [ ] Google Cloud: IAM members of the backup project; the server's account can only create objects"
  echo "- [ ] Razorpay: team members"
  echo "- [ ] Google Play Console: users and permissions"
  echo "- [ ] Anyone who left this month: leaver checklist done the same day (docs/security/15-hr-security.md)"
  case "$(date +%m)" in 01|04|07|10) echo "- [ ] QUARTER: rotate ADMIN_KEY and CRON_KEY in deploy/.env, then deploy/deploy.sh --now";; esac
  [[ "$(date +%m)" == 01 ]] && echo "- [ ] YEAR: rotate JWT_SECRET (move the old one to JWT_SECRET_OLD for 30 days); check the backup private key opens a backup (restore drill)"
  echo; echo "Reviewed by: ______________________   Date: ____________   Signature: ______________________"
} > "$F"
./alert.sh access-review "the monthly access review for $MONTH is ready: deploy/$F — read, tick and sign"
echo "✔ $F"
