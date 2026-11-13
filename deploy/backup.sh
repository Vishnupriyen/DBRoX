#!/usr/bin/env bash
# Nightly backup (cron, 2:30 am IST) and before every update.
# Security standard (13 Nov 2026): the dump is ENCRYPTED with age before it touches the disk. Only the founder's PUBLIC key
# is on this server (BACKUP_AGE_RECIPIENT in .env); the private key is kept offline by the founder, so a stolen server or
# bucket cannot open old backups. The plain dump only ever passes through a pipe in memory, never a file.
# Each backup has a manifest (rows per table, sha256, size) so the monthly restore drill (restore-drill.sh, on the
# founder's laptop) can prove the copy is complete. 14 days kept here; a copy goes to Google Cloud Storage (BACKUP_BUCKET,
# Mumbai, write-only account). A failed copy exits non-zero and sends an alert.
#   backup.sh                 — nightly: everything must succeed
#   backup.sh --before-deploy — before an update: the local encrypted copy is enough to go on (an upload failure still alerts)
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
export TAG=$(cat .live-tag 2>/dev/null || echo none)
MODE="${1:-}"
alert() { ./alert.sh "backup" "$1" || true; }
fail() { echo "✘ $1"; alert "Backup FAILED: $1"; exit 1; }

[[ -n "${BACKUP_AGE_RECIPIENT:-}" ]] || fail "BACKUP_AGE_RECIPIENT is not set in deploy/.env (the founder's age public key)"
command -v age >/dev/null || fail "age is not installed (apt install age)"
umask 077
mkdir -p backups
NAME="hanubix-$(TZ=Asia/Kolkata date +%Y-%m-%d-%H%M)"
F="backups/$NAME.dump.age"
M="backups/$NAME.manifest"
# the dump is counted as it streams (row counts for the manifest) through a pipe in memory — never a plain file on disk
FIFO_DIR=$(mktemp -d "${TMPDIR:-/dev/shm}/hbx-backup.XXXXXX" 2>/dev/null || mktemp -d)
FIFO="$FIFO_DIR/dump"; mkfifo "$FIFO"
trap 'rm -f "$F.part" "$M.part" "$M.rows"; rm -rf "$FIFO_DIR"' EXIT   # a failed run never leaves a half file that looks like a backup

# rows per table, read from the dump itself (pg_restore turns it back into COPY blocks): the read-back check and the
# manifest in one. A dump pg_restore cannot read fails here.
( docker compose exec -T db pg_restore -f - -a < "$FIFO" \
    | awk '/^COPY /{t=$2; inside=1; next} /^\\\.$/{if(inside){print t "|" n[t]+0}; inside=0; next} inside{n[t]++}' > "$M.rows" ) &
COUNTER=$!
set +e
docker compose exec -T db pg_dump -U hanubix -d dbrox -Fc | tee "$FIFO" | age -r "$BACKUP_AGE_RECIPIENT" > "$F.part"
PIPE=("${PIPESTATUS[@]}")
wait "$COUNTER"; COUNTED=$?
set -e
(( PIPE[0] == 0 )) || fail "the database dump failed"
(( PIPE[1] == 0 && PIPE[2] == 0 )) || fail "encrypting the dump failed"
(( COUNTED == 0 )) && [[ -s "$M.rows" ]] || fail "the dump could not be read back"
# an age file starts with this line; anything else is not an encrypted backup
head -c 21 "$F.part" | grep -q '^age-encryption.org/v1' || fail "the backup file is not age-encrypted"

SHA=$(sha256sum "$F.part" | cut -d' ' -f1)
SIZE=$(wc -c < "$F.part" | tr -d ' ')
{
  echo "file $NAME.dump.age"
  echo "sha256 $SHA"
  echo "bytes $SIZE"
  echo "made $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "version $TAG"
  sed 's/^/rows /' "$M.rows"
} > "$M.part"
mv "$F.part" "$F"; mv "$M.part" "$M"

if [[ -n "${BACKUP_BUCKET:-}" ]]; then
  # the server's bucket account may only CREATE objects (no read, no delete): a hacked server cannot erase the history
  if ! gsutil -q cp "$F" "$M" "$BACKUP_BUCKET/db/"; then
    if [[ "$MODE" == "--before-deploy" ]]; then
      alert "Backup copy to Google Cloud failed before an update — the encrypted copy here ($F) is kept"
      echo "⚠ Copy to Google Cloud failed — the encrypted copy here is kept; the update goes on"
    else
      fail "copy to Google Cloud failed — the encrypted copy here ($F) is kept"
    fi
  else
    date -u +%Y-%m-%dT%H:%M:%SZ > .last-backup-ok
  fi
else
  echo "⚠ BACKUP_BUCKET is not set: the backup is only on this machine"
  [[ "$MODE" == "--before-deploy" ]] || alert "Backup made but BACKUP_BUCKET is not set — no copy off this machine"
fi
find backups \( -name 'hanubix-*.dump.age' -o -name 'hanubix-*.manifest' \) -mtime +14 -delete
# plain dumps from before 13 Nov 2026 are not kept at all
find backups -name 'hanubix-*.dump' -delete
echo "✔ Backup $F ($(du -h "$F" | cut -f1), encrypted)"
