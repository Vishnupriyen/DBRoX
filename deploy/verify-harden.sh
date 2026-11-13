#!/usr/bin/env bash
# Checks the machine is still locked down as deploy/harden.sh left it. Every line must be ✔ (exit 0).
# Run after harden.sh, after every OS upgrade, and in the monthly access review. Output goes into the evidence folder.
set -uo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
bad=0
ok() { echo "✔ $1"; }
no() { echo "✘ $1"; bad=1; }
t() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else no "$1"; fi; }
t "firewall on"                                  "ufw status | grep -q 'Status: active'"
t "firewall: nothing open but 22, 80, 443"       "! ufw status | awk '/ALLOW|LIMIT/{print \$1}' | grep -vE '^(22|80|443)(/tcp)?\$' | grep -q ."
t "SSH: no passwords"                            "sshd -T 2>/dev/null | grep -qi '^passwordauthentication no'"
t "SSH: root only with a key"                    "sshd -T 2>/dev/null | grep -qiE '^permitrootlogin (prohibit-password|without-password|no)'"
t "fail2ban guarding SSH"                        "fail2ban-client status sshd"
t "automatic security updates on"                "grep -q 'Unattended-Upgrade \"1\"' /etc/apt/apt.conf.d/20auto-upgrades"
t "Docker logs capped"                           "grep -q max-size /etc/docker/daemon.json"
t "Postgres not reachable from outside (5432)"   "! ss -ltn | grep -E '(0\.0\.0\.0|\[::\]|\*):5432 '"
t "secrets file readable by root only"           "[[ \$(stat -c %a '$D/.env') == 600 && \$(stat -c %U '$D/.env') == root ]]"
t "backups are encrypted (no plain dumps)"       "! ls '$D'/backups/*.dump >/dev/null 2>&1"
t "age public key set for backups"               "grep -q '^BACKUP_AGE_RECIPIENT=age1' '$D/.env'"
t "no age PRIVATE key on this machine"           "! grep -rqs 'AGE-SECRET-KEY-' '$D' /root 2>/dev/null"
t "Hanubix jobs installed in cron"               "crontab -l | grep -q '>>> hanubix'"
(( bad == 0 )) && echo "✔ ALL CHECKS PASSED" || echo "✘ SOME CHECKS FAILED — run deploy/harden.sh, then this again"
exit $bad
