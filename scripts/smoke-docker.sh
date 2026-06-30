#!/usr/bin/env sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
SERVICE="${ATOMIC_DOCKER_SERVICE:-atomic-payments}"
PORT="${ATOMIC_DOCKER_PORT:-3005}"
BASE_URL="${ATOMIC_BASE_URL:-http://127.0.0.1:${PORT}}"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
}

trap cleanup EXIT INT TERM

docker compose -f "$COMPOSE_FILE" up --build -d "$SERVICE"

attempt=0
until node -e "fetch('${BASE_URL}/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker compose -f "$COMPOSE_FILE" logs "$SERVICE"
    echo "Docker smoke target did not become ready at ${BASE_URL}" >&2
    exit 1
  fi
  sleep 2
done

ATOMIC_BASE_URL="$BASE_URL" ATOMIC_SMOKE_KEEP_DATA=1 node scripts/smoke-core.js
