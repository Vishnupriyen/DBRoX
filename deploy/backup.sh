#!/usr/bin/env bash
# Nightly backup (cron, 2:30 am IST) and before every update. Checked by reading it back; 14 days kept here, and a copy goes
# to Google Cloud Storage when BACKUP_BUCKET is set in .env (gs://…), so losing the machine never loses the data.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
export TAG=$(cat .live-tag 2>/dev/null || echo none)
mkdir -p backups
F="backups/hanubix-$(TZ=Asia/Kolkata date +%Y-%m-%d-%H%M).dump"
trap 'rm -f "$F.part"' EXIT   # a failed dump never leaves a half file that looks like a backup
docker compose exec -T db pg_dump -U hanubix -d dbrox -Fc > "$F.part"
docker compose exec -T db pg_restore --list < "$F.part" > /dev/null || { echo "✘ Backup could not be read back"; exit 1; }
mv "$F.part" "$F"
if [[ -n "${BACKUP_BUCKET:-}" ]]; then
  gsutil -q cp "$F" "$BACKUP_BUCKET/" || echo "⚠ Copy to Google Cloud failed — the backup here is kept; it is copied again tomorrow night"
fi
find backups -name 'hanubix-*.dump' -mtime +14 -delete
echo "✔ Backup $F ($(du -h "$F" | cut -f1))"
