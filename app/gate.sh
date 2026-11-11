#!/usr/bin/env bash
# THE RELEASE GATE — nothing ships unless every step passes.   cd app && npm run gate
# 1 types · 2 tests in UTC · 3 tests in Indian time (incl. money & stock chaos laws) · 4 build
# 5 full business day in a real browser (distributor, then the company journey) · 6 every screen, every role, at 360 px
set -euo pipefail
cd "$(dirname "$0")"
OUT="${GATE_OUT:-e2e/out}"; rm -rf "$OUT"; mkdir -p "$OUT"
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
step '1/6 Type check';                 npx tsc -b
step '2/6 Tests (UTC)';                TZ=UTC npx vitest run
step '3/6 Tests (Asia/Kolkata)';       TZ=Asia/Kolkata CHAOS_SEEDS="${CHAOS_SEEDS:-6}" CHAOS_STEPS="${CHAOS_STEPS:-400}" npx vitest run
step '4/6 Build';                      npx vite build
step '5/6 Business day, end to end';
PORT="${GATE_PORT:-4173}"; export E2E_URL="http://localhost:$PORT"   # GATE_PORT lets two copies run the gate side by side
npx vite preview --port "$PORT" --strictPort >/dev/null 2>&1 & PREVIEW=$!
trap 'kill $PREVIEW 2>/dev/null || true' EXIT
for i in $(seq 1 40); do curl -sf "$E2E_URL" >/dev/null && break; sleep 0.5; done
TZ=Asia/Kolkata node e2e/flow.cjs "$OUT"
TZ=Asia/Kolkata node e2e/company.cjs "$OUT"   # the company side: rep → distributor → goods receipt → claim → credit note
step '6/6 Every screen, every role, 360 px and 412 px'
TZ=Asia/Kolkata node e2e/sweep.cjs "$OUT"
printf '\n\033[1;32m✔ GATE PASSED — safe to release.\033[0m\n'
