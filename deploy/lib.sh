# Shared by the watcher scripts (monitor, security-watch, verify-log, access-review). Sourced, never run.
cd "$(dirname "${BASH_SOURCE[0]}")"
[[ -f .env ]] && { set -a; source .env; set +a; }
export TAG=$(cat .live-tag 2>/dev/null || echo none)
mkdir -p .state
# one SQL answer from the database (as the owner role, inside the machine; Postgres is never open to the internet)
q() { docker compose exec -T db psql -U hanubix -d dbrox -qtAX -c "$1"; }
# alert only when something CHANGES (ok → bad: alert; bad → ok: "cleared"), so a long outage never sends hundreds of messages
check() { # check <name> <bad: 0|1> <message>
  local name=$1 bad=$2 msg=$3 file=".state/$1" was
  was=$(cat "$file" 2>/dev/null || echo ok)
  if [[ "$bad" == 1 ]]; then
    [[ "$was" != bad ]] && ./alert.sh "$name" "$msg"
    echo bad > "$file"
  else
    [[ "$was" == bad ]] && ./alert.sh "$name" "cleared — ${msg}"
    echo ok > "$file"
  fi
}
age_hours() { # hours since the UTC time written in a file (a large number when it is missing)
  local f=$1
  [[ -s "$f" ]] || { echo 99999; return; }
  local t; t=$(date -u -d "$(cat "$f")" +%s 2>/dev/null) || { echo 99999; return; }
  echo $(( ( $(date -u +%s) - t ) / 3600 ))
}
