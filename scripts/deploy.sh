#!/usr/bin/env bash
# Deploy BuildCheck v3 on an existing EC2 host (Ubuntu + Docker installed).
#
# Usage (run ON the EC2 box, from the project root):
#   cp .env.production.example .env
#   $EDITOR .env                          # fill ANTHROPIC_API_KEY, JWT_SECRET, passwords
#   ./scripts/deploy.sh
#
# Re-run to redeploy after `git pull`.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.production.example to .env and fill values."
  exit 1
fi

echo "[deploy] building images…"
docker compose -f docker-compose.prod.yml --env-file .env build

echo "[deploy] starting stack…"
docker compose -f docker-compose.prod.yml --env-file .env up -d

echo "[deploy] waiting for server health…"
for i in $(seq 1 30); do
  if curl -sf http://localhost:${HTTP_PORT:-8080}/api/health >/dev/null 2>&1 \
     || docker compose -f docker-compose.prod.yml exec -T server wget -qO- http://localhost:3001/health >/dev/null 2>&1; then
    echo "[deploy] up."
    break
  fi
  sleep 2
done

docker compose -f docker-compose.prod.yml ps
echo "[deploy] done. App on port ${HTTP_PORT:-8080}."
