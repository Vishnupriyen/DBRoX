#!/usr/bin/env bash
# Pins the exact Docker images (sha256 digests) the server runs, so a re-pull never brings an unreviewed image.
# Run once at setup and again on purpose when updating images (patch policy: docs/security/11-vulnerability-patch.md).
# Writes PG_IMAGE, CADDY_IMAGE and NODE_IMAGE into deploy/.env; docker-compose.yml and deploy.sh use them.
set -euo pipefail
cd "$(dirname "$0")"
pin() { docker pull -q "$1" >/dev/null; docker inspect --format '{{index .RepoDigests 0}}' "$1"; }
set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
set_env PG_IMAGE "$(pin postgres:16)"
set_env CADDY_IMAGE "$(pin caddy:2)"
set_env NODE_IMAGE "$(pin node:22-slim)"
grep -E '^(PG|CADDY|NODE)_IMAGE=' .env
echo "✔ Images pinned. Next deploy/deploy.sh builds and runs exactly these."
