#!/usr/bin/env bash
# Weekly (cron): the server's secrets file (.env) encrypted with the same age public key and copied to the bucket, so a
# lost machine can be rebuilt. Never written anywhere in plain text.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
[[ -n "${BACKUP_AGE_RECIPIENT:-}" ]] || { ./alert.sh backup-env "BACKUP_AGE_RECIPIENT is not set"; exit 1; }
umask 077; mkdir -p backups
F="backups/env-$(TZ=Asia/Kolkata date +%Y-%m-%d).age"
age -r "$BACKUP_AGE_RECIPIENT" -o "$F" .env
if [[ -n "${BACKUP_BUCKET:-}" ]]; then
  gsutil -q cp "$F" "$BACKUP_BUCKET/env/" || { ./alert.sh backup-env "the encrypted .env copy could not be sent to the bucket"; exit 1; }
fi
find backups -name 'env-*.age' -mtime +35 -delete
echo "✔ .env copy $F (encrypted)"
