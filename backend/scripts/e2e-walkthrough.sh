#!/usr/bin/env bash
#
# e2e-walkthrough.sh — one command that boots Postgres, the backend, and
# the customer + rider apps, then drives a real browser through placing
# and delivering one shipment across both apps.
#
# This is the layer above smoke-test.sh: that script proves the API
# works via curl; this one proves the actual rendered screens work
# together. It does NOT replace a human looking at the apps — see the
# header comment in e2e/shipment-walkthrough.spec.js for exactly what
# this does and doesn't cover (notably: apps/business and apps/admin's
# own UI aren't driven by this test).
#
# Usage:
#   cd backend
#   ./scripts/e2e-walkthrough.sh
#   ./scripts/e2e-walkthrough.sh --keep-up   # leave everything running after
#   ./scripts/e2e-walkthrough.sh --headed    # watch it click through in a real window
#
# Requires: docker, docker compose, npm, node, and enough of a display
# stack for Playwright's bundled Chromium (headless by default — add
# --headed only where you actually have a display).

set -euo pipefail

COMPOSE_FILE="docker-compose.yml"
APP_DIR="backend"
BACKEND_PORT="${PORT:-3000}"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
CUSTOMER_PORT=5173
RIDER_PORT=5174
SEED_ADMIN_PHONE="${SEED_ADMIN_PHONE:-+255700000001}"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-SmokeTest#2026}"
KEEP_UP=false
HEADED=""
LOG_FILE="$(mktemp -t wazzar-e2e-XXXXXX.log)"
PIDS=()

for arg in "$@"; do
  case "$arg" in
    --keep-up) KEEP_UP=true ;;
    --headed) HEADED="--headed" ;;
  esac
done

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; echo "  Full log: $LOG_FILE"; exit 1; }
info() { echo -e "${YELLOW}→${NC} $1"; }

cleanup() {
  if [[ "$KEEP_UP" == false ]]; then
    info "Tearing down..."
    for pid in "${PIDS[@]:-}"; do
      kill "$pid" >/dev/null 2>&1 || true
    done
    docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
  else
    info "--keep-up set: backend on $BACKEND_URL, customer on http://localhost:${CUSTOMER_PORT}, rider on http://localhost:${RIDER_PORT} (log: $LOG_FILE)"
  fi
}
trap cleanup EXIT

wait_for() {
  local url="$1" name="$2"
  for i in $(seq 1 30); do
    curl -s -o /dev/null "$url" && return 0
    sleep 1
  done
  fail "$name never came up at $url"
}

# ---- postgres + backend (same as smoke-test.sh) --------------------------
info "Starting Postgres..."
docker compose -f "$COMPOSE_FILE" up -d postgres
for i in $(seq 1 30); do
  status=$(docker inspect --format='{{.State.Health.Status}}' wazzar-postgres 2>/dev/null || echo "starting")
  [[ "$status" == "healthy" ]] && break
  sleep 2
  [[ "$i" == 30 ]] && fail "Postgres never became healthy"
done
pass "Postgres healthy"

cd "$APP_DIR"
[[ -f .env ]] || cp .env.example .env

info "Installing + building backend..."
npm install >>"$LOG_FILE" 2>&1 || fail "backend npm install failed"
npm run build >>"$LOG_FILE" 2>&1 || fail "backend build failed"
npm run db:migrate >>"$LOG_FILE" 2>&1 || fail "migrations failed"
SEED_ADMIN_PHONE="$SEED_ADMIN_PHONE" SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
  npm run db:seed:admin >>"$LOG_FILE" 2>&1 || fail "db:seed:admin failed"
npm run db:seed:pricing >>"$LOG_FILE" 2>&1 || fail "db:seed:pricing failed"
pass "Backend built, migrated, seeded"

info "Starting backend..."
PORT="$BACKEND_PORT" npm run start:prod >>"$LOG_FILE" 2>&1 &
PIDS+=($!)
wait_for "${BACKEND_URL}/health" "Backend"
pass "Backend up on $BACKEND_URL"

# ---- customer + rider dev servers -----------------------------------
cd ..
for app_info in "customer:$CUSTOMER_PORT" "rider:$RIDER_PORT"; do
  app="${app_info%%:*}"
  port="${app_info##*:}"
  APP_PATH="apps/${app}"

  (
    cd "$APP_PATH"
    [[ -f .env.local ]] || cp .env.example .env.local
    sed -i.bak "s#^VITE_API_URL=.*#VITE_API_URL=${BACKEND_URL}#" .env.local
    rm -f .env.local.bak
    npm install >>"$LOG_FILE" 2>&1
  ) || fail "apps/${app}: npm install failed"

  info "Starting apps/${app} on port ${port}..."
  (cd "$APP_PATH" && npx vite --port "$port" --strictPort >>"$LOG_FILE" 2>&1) &
  PIDS+=($!)
  wait_for "http://localhost:${port}" "apps/${app}"
  pass "apps/${app} up on http://localhost:${port}"
done

# ---- playwright -------------------------------------------------------
cd scripts/e2e
info "Installing Playwright..."
npm install >>"$LOG_FILE" 2>&1 || fail "e2e npm install failed"
npx playwright install --with-deps chromium >>"$LOG_FILE" 2>&1 \
  || fail "Playwright browser install failed — see $LOG_FILE (may need sudo/root for --with-deps on a fresh machine)"

info "Running the walkthrough..."
CUSTOMER_URL="http://localhost:${CUSTOMER_PORT}" \
RIDER_URL="http://localhost:${RIDER_PORT}" \
BACKEND_URL="$BACKEND_URL" \
SEED_ADMIN_PHONE="$SEED_ADMIN_PHONE" \
SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
  npx playwright test $HEADED || fail "Walkthrough failed — see the Playwright HTML report and $LOG_FILE"

echo ""
pass "Shipment placed by customer, delivered by rider, end to end."
[[ "$KEEP_UP" == true ]] && info "Everything left running — see above for URLs."
