#!/usr/bin/env bash
#
# smoke-test.sh — one-command backend smoke test.
#
# What it does:
#   1. Starts Postgres via docker-compose.yml (already in backend/)
#   2. Waits for it to be healthy
#   3. Runs migrations, then db:seed:admin and db:seed:pricing
#   4. Boots the backend (npm run start:prod against a fresh build)
#   5. Hits /health, /health/db, /pricing/active, /pricing/calculate,
#      and /auth/login (with the seeded admin) — fails loudly on any
#      non-2xx or unexpected shape
#   6. Installs + builds all four frontend apps (customer, rider,
#      business, admin) against this running backend, as a build-only
#      sanity check (not a UI walkthrough)
#   7. Tears everything down (unless --keep-up is passed)
#
# Usage:
#   cd backend
#   ./scripts/smoke-test.sh
#   ./scripts/smoke-test.sh --keep-up     # leave postgres + server running after
#   ./scripts/smoke-test.sh --skip-apps   # backend only, skip the 4 frontend builds
#
# Requires: docker, docker compose (v2 CLI plugin), npm, curl, node.
# Assumes it's run from the backend/ directory (where docker-compose.yml
# and backend/ — the actual Nest app — live), with apps/ as a sibling
# of backend/ (i.e. the standard WAZZAR/ repo layout).

set -euo pipefail

# ---- config -----------------------------------------------------------
COMPOSE_FILE="docker-compose.yml"
APP_DIR="backend"                    # nested backend/backend Nest app
PORT="${PORT:-3000}"
BASE_URL="http://localhost:${PORT}"
SEED_ADMIN_PHONE="${SEED_ADMIN_PHONE:-+255700000001}"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-SmokeTest#2026}"
KEEP_UP=false
SKIP_APPS=false
SERVER_PID=""
LOG_FILE="$(mktemp -t wazzar-smoke-XXXXXX.log)"
FRONTEND_APPS=(customer rider business admin)

for arg in "$@"; do
  case "$arg" in
    --keep-up) KEEP_UP=true ;;
    --skip-apps) SKIP_APPS=true ;;
  esac
done

# ---- helpers ------------------------------------------------------------
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; echo "  See full server log: $LOG_FILE"; exit 1; }
info() { echo -e "${YELLOW}→${NC} $1"; }

cleanup() {
  if [[ "$KEEP_UP" == false ]]; then
    info "Tearing down..."
    [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" >/dev/null 2>&1 || true
    docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
  else
    info "--keep-up set: leaving postgres + server running (PID $SERVER_PID, log: $LOG_FILE)"
  fi
}
trap cleanup EXIT

# curl wrapper: $1=method $2=path $3=body(optional) -> prints body, sets HTTP_CODE
req() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -o /tmp/wazzar_smoke_resp.json -w "%{http_code}" -X "$method" "${BASE_URL}${path}")
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  HTTP_CODE=$(curl "${args[@]}")
  RESP=$(cat /tmp/wazzar_smoke_resp.json)
}

# ---- 1. postgres --------------------------------------------------------
info "Starting Postgres (docker compose)..."
docker compose -f "$COMPOSE_FILE" up -d postgres

info "Waiting for Postgres healthcheck..."
for i in $(seq 1 30); do
  status=$(docker inspect --format='{{.State.Health.Status}}' wazzar-postgres 2>/dev/null || echo "starting")
  [[ "$status" == "healthy" ]] && break
  sleep 2
  [[ "$i" == 30 ]] && fail "Postgres never became healthy"
done
pass "Postgres is healthy"

# ---- 2. install, build, migrate, seed -----------------------------------
cd "$APP_DIR"

if [[ ! -f .env ]]; then
  info "No .env found, copying .env.example (fill in real secrets before deploying anywhere real)"
  cp .env.example .env
fi

info "npm install..."
npm install >>"$LOG_FILE" 2>&1 || fail "npm install failed"
pass "Dependencies installed"

info "npm run build..."
npm run build >>"$LOG_FILE" 2>&1 || fail "Build failed"
pass "Build succeeded"

info "Running migrations..."
npm run db:migrate >>"$LOG_FILE" 2>&1 || fail "Migrations failed"
pass "Migrations applied"

info "Seeding admin user..."
SEED_ADMIN_PHONE="$SEED_ADMIN_PHONE" SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
  npm run db:seed:admin >>"$LOG_FILE" 2>&1 || fail "db:seed:admin failed"
pass "Admin seeded ($SEED_ADMIN_PHONE)"

info "Seeding pricing config..."
npm run db:seed:pricing >>"$LOG_FILE" 2>&1 || fail "db:seed:pricing failed"
pass "Pricing config seeded"

# ---- 3. boot the server --------------------------------------------------
info "Starting server (start:prod) on port $PORT..."
PORT="$PORT" npm run start:prod >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!

for i in $(seq 1 30); do
  if curl -s -o /dev/null "${BASE_URL}/health"; then break; fi
  sleep 1
  [[ "$i" == 30 ]] && fail "Server never came up — check $LOG_FILE"
done
pass "Server is up (pid $SERVER_PID)"

# ---- 4. hit the endpoints -------------------------------------------------
req GET /health
[[ "$HTTP_CODE" == "200" ]] && echo "$RESP" | grep -q '"status":"ok"' \
  && pass "GET /health -> 200 ok" || fail "GET /health -> $HTTP_CODE: $RESP"

req GET /health/db
[[ "$HTTP_CODE" == "200" ]] && echo "$RESP" | grep -q '"connected":true' \
  && pass "GET /health/db -> 200, DB connected" || fail "GET /health/db -> $HTTP_CODE: $RESP"

req GET /pricing/active
[[ "$HTTP_CODE" == "200" ]] && pass "GET /pricing/active -> 200" \
  || fail "GET /pricing/active -> $HTTP_CODE: $RESP"

# Adjust this payload if CalculatePriceDto's shape changes.
req POST /pricing/calculate '{"distanceKm": 10}'
[[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]] && pass "POST /pricing/calculate -> $HTTP_CODE: $RESP" \
  || fail "POST /pricing/calculate -> $HTTP_CODE: $RESP"

req POST /auth/login "{\"phone\":\"${SEED_ADMIN_PHONE}\",\"password\":\"${SEED_ADMIN_PASSWORD}\"}"
[[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]] && echo "$RESP" | grep -q "accessToken\|access_token" \
  && pass "POST /auth/login (seeded admin) -> $HTTP_CODE, token returned" \
  || fail "POST /auth/login -> $HTTP_CODE: $RESP"

echo ""
pass "Backend smoke checks passed."

# ---- 5. frontend apps: build-only sanity check ---------------------------
# This does NOT walk a shipment through the UI — it just proves each app
# installs and builds cleanly against this running backend's API shape.
# Real end-to-end still means opening each app and clicking through.
if [[ "$SKIP_APPS" == true ]]; then
  info "Skipping frontend app builds (--skip-apps)"
else
  # We're currently inside backend/backend; apps/ is a sibling of backend/.
  APPS_ROOT="../../apps"
  if [[ ! -d "$APPS_ROOT" ]]; then
    fail "Expected apps/ at $APPS_ROOT (sibling of backend/) — layout doesn't match, use --skip-apps to bypass"
  fi

  for app in "${FRONTEND_APPS[@]}"; do
    APP_PATH="${APPS_ROOT}/${app}"
    [[ -d "$APP_PATH" ]] || fail "apps/${app} not found at $APP_PATH"

    (
      cd "$APP_PATH"
      if [[ ! -f .env.local ]]; then
        info "apps/${app}: no .env.local, copying .env.example (VITE_API_URL=${BASE_URL})"
        cp .env.example .env.local
        # Point it at the backend this script just booted, not whatever
        # default port the .env.example ships with.
        sed -i.bak "s#^VITE_API_URL=.*#VITE_API_URL=${BASE_URL}#" .env.local
        rm -f .env.local.bak
      fi
      npm install >>"$LOG_FILE" 2>&1
      npm run build >>"$LOG_FILE" 2>&1
    ) || fail "apps/${app}: install or build failed"

    [[ -d "${APP_PATH}/dist" ]] && pass "apps/${app}: installed + built (dist/ present)" \
      || fail "apps/${app}: build reported success but dist/ is missing"
  done
fi

echo ""
pass "All smoke checks passed."
[[ "$KEEP_UP" == true ]] && info "Server + Postgres left running: $BASE_URL"
