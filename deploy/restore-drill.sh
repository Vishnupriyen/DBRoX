#!/usr/bin/env bash
# MONTHLY RESTORE DRILL — run on the founder's laptop (never on the server: the private key never goes there).
#   deploy/restore-drill.sh <backup.dump.age> <backup.manifest> <age private key file>
# 1. checks the file is the one the server made (sha256 and size from the manifest)
# 2. decrypts it into a throw-away Postgres (Docker) — through a pipe, no plain file on disk
# 3. counts the rows of every table and compares them with the manifest
# 4. prints the time it took (the RTO evidence) — file the output in the evidence folder (docs/security/22-evidence-index.md)
set -euo pipefail
DUMP=${1:?backup .dump.age file}; MAN=${2:?manifest file}; KEY=${3:?age private key file}
START=$(date +%s)
want=$(awk '$1=="sha256"{print $2}' "$MAN"); got=$(sha256sum "$DUMP" | cut -d' ' -f1)
[[ "$want" == "$got" ]] || { echo "✘ the backup file does not match its manifest (sha256)"; exit 1; }
echo "✔ file matches the manifest ($(awk '$1=="bytes"{print $2}' "$MAN") bytes)"
NAME="hanubix-drill-$$"; PORT=${DRILL_PORT:-55432}
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=drill -e POSTGRES_USER=hanubix -e POSTGRES_DB=dbrox -p "127.0.0.1:$PORT:5432" postgres:16 >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U hanubix -d dbrox >/dev/null 2>&1 && break; sleep 1; done
# the roles the dump refers to (owners, grants) exist on the server; here they are created empty first
docker exec "$NAME" psql -U hanubix -d dbrox -qc "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='hanubix_app') THEN CREATE ROLE hanubix_app; END IF; END \$\$;"
age -d -i "$KEY" "$DUMP" | docker exec -i "$NAME" pg_restore -U hanubix -d dbrox --no-owner --exit-on-error
echo "✔ decrypted and restored"
bad=0; n=0
while read -r kind tbl _; do   # manifest lines: "rows public.docs_p0|1234"
  [[ "$kind" == rows ]] || continue
  t=${tbl%%|*}; want=${tbl##*|}
  got=$(docker exec "$NAME" psql -U hanubix -d dbrox -tAc "SELECT count(*) FROM $t")
  n=$((n+1))
  if [[ "$got" != "$want" ]]; then echo "✘ $t: $got rows, manifest says $want"; bad=1; fi
done < "$MAN"
(( bad == 0 )) || { echo "✘ RESTORE DRILL FAILED"; exit 1; }
echo "✔ RESTORE DRILL PASSED — $n tables match the manifest, $(( $(date +%s) - START )) seconds (target: under 4 hours)"
