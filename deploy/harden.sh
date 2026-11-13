#!/usr/bin/env bash
# Locks down the Hostinger VPS (Ubuntu). Run once as root after the machine is bought, and again after any change here:
#   SSH_ALLOW_FROM="203.0.113.7 198.51.100.0/24" deploy/harden.sh
# - firewall: only 80/443 open to everyone; SSH (22) only from SSH_ALLOW_FROM (or rate-limited from anywhere if not set)
# - SSH: keys only, no passwords, root only with a key, 3 tries
# - fail2ban on SSH; automatic security updates; Docker log size limits; the secrets file readable by root only
# Check afterwards with deploy/verify-harden.sh (it must print all ✔). See docs/security/12-network-server-hardening.md.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo "Run as root"; exit 1; }
D="$(cd "$(dirname "$0")" && pwd)"
# never lock ourselves out: SSH keys must already be in place before passwords are switched off
# (a real key line, not just the file: an empty authorized_keys with passwords off would lock everyone out)
if ! cat /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys 2>/dev/null | grep -Eqs '^(ssh-|ecdsa-|sk-)'; then
  echo "✘ No SSH key is set up (authorized_keys holds no key). Add your key first (ssh-copy-id), then run this again."; exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ufw fail2ban unattended-upgrades age curl >/dev/null

# firewall — SSH is allowed FIRST (and the address running this script stays allowed), then it is tightened: there is
# never a moment with SSH blocked. A clean start (reset) only while the firewall is off, when it blocks nothing.
ufw status | grep -q 'Status: active' || ufw --force reset >/dev/null   # only if not 'Status: active'
CUR_IP=${SSH_CLIENT%% *}
[[ -n "$CUR_IP" ]] && ufw allow from "$CUR_IP" to any port 22 proto tcp
if [[ -n "${SSH_ALLOW_FROM:-}" ]]; then for ip in $SSH_ALLOW_FROM; do ufw allow from "$ip" to any port 22 proto tcp; done
else ufw limit 22/tcp; echo "⚠ SSH is open to every address (rate-limited). Set SSH_ALLOW_FROM to your own IPs and run again."; fi
ufw allow 80/tcp; ufw allow 443/tcp
ufw default deny incoming; ufw default allow outgoing
# with SSH_ALLOW_FROM set, the open-to-everyone SSH rules of an earlier run are removed (the allowed addresses stay)
if [[ -n "${SSH_ALLOW_FROM:-}" ]]; then for r in 'limit 22/tcp' 'allow 22/tcp' 'allow 22' 'allow OpenSSH'; do ufw delete $r >/dev/null 2>&1 || true; done; fi
ufw --force enable

# SSH: keys only
cat > /etc/ssh/sshd_config.d/60-hanubix.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PermitEmptyPasswords no
MaxAuthTries 3
X11Forwarding no
LoginGraceTime 30
EOF
sshd -t && systemctl reload ssh 2>/dev/null || systemctl reload sshd

# fail2ban: 5 wrong SSH tries → banned for an hour
cat > /etc/fail2ban/jail.d/hanubix.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null; systemctl restart fail2ban

# automatic security updates (a reboot, if one is needed, at 03:30 IST when nobody is billing)
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52hanubix-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "22:00";
EOF
systemctl enable --now unattended-upgrades >/dev/null

# Docker: every container's log is capped (20 MB × 10 files)
mkdir -p /etc/docker
if [[ ! -f /etc/docker/daemon.json ]] || ! grep -q max-size /etc/docker/daemon.json; then
  echo '{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "10" }, "no-new-privileges": true }' > /etc/docker/daemon.json
  systemctl restart docker 2>/dev/null || true
fi

# the secrets file: root only
[[ -f "$D/.env" ]] && { chown root:root "$D/.env"; chmod 600 "$D/.env"; }
chmod 700 "$D/backups" 2>/dev/null || true
echo "✔ Hardened. Now run: deploy/verify-harden.sh"
