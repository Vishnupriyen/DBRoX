#!/usr/bin/env bash
# Nightly backup (cron, 2:30 am IST) and before every update. Checked by reading it back; 14 days kept here, and a copy goes
# to Google Cloud Storage when BACKUP_BUCKET is set in .env (gs://…), so losing the machine never loses the data.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
mkdir -p backups
F="backups/hanubix-$(TZ=Asia/Kolkata date +%Y-%m-%d-%H%M).dump"
docker compose exec -T db pg_dump -U hanubix -d dbrox -Fc > "$F"
docker compose exec -T db pg_restore --list < "$F" > /dev/null || { echo "✘ Backup $F could not be read back"; rm -f "$F"; exit 1; }
[[ -n "${BACKUP_BUCKET:-}" ]] && gsutil -q cp "$F" "$BACKUP_BUCKET/"
find backups -name 'hanubix-*.dump' -mtime +14 -delete
echo "✔ Backup $F ($(du -h "$F" | cut -f1))"
