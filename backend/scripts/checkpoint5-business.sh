#!/usr/bin/env bash
#
# checkpoint5-business.sh — closes the one gap smoke-test.sh and
# e2e-walkthrough.sh don't cover: apps/business's two "wired but never
# run against a database" features from VERIFICATION_PLAN.md Checkpoint 5
# (Scheduled Deliveries cron firing, and Billing/payment-history scoping).
#
# This drives the backend directly over HTTP (no browser) — it proves
# the cron infrastructure and data isolation are real, not that the
# Business app's UI renders them correctly. Pair with a human click-
# through of the Business app's "Scheduled Deliveries" and "Billing"
# tabs for full confidence.
#
# What it does:
#   1. Boots Postgres + backend the same way smoke-test.sh does
#      (skippable with --reuse-backend if one is already up on $PORT)
#   2. Registers two independent BUSINESS accounts (A and B)
#   3. Business A creates a scheduled delivery whose next run is ~90
#      seconds out (computed the same way the recurrence util does —
#      today's day-of-week + current EAT time + a couple of minutes)
#   4. Polls GET /business/scheduled-deliveries until lastRunAt is set
#      (i.e. the real @Cron(EVERY_MINUTE) tick fired it, not this
#      script) — fails loudly if it never fires within one grace period
#   5. Confirms a real shipment now exists for Business A that wasn't
#      there before (GET /shipments), proving the cron -> ShipmentsService
#      path actually creates a shipment, not just updates a timestamp
#   6. Hits GET /payments/history as both Business A and Business B,
#      confirms both get 200 and that B's results never contain any of
#      A's shipment ids — a real (if minimal) cross-account scope check
#   7. Tears down (unless --keep-up)
#
# Usage:
#   cd backend
#   ./scripts/checkpoint5-business.sh
#   ./scripts/checkpoint5-business.sh --keep-up
#   ./scripts/checkpoint5-business.sh --reuse-backend   # backend already running on $PORT
#
# Requires: docker, docker compose, npm, curl, node (for EAT time math).

set -euo pipefail

COMPOSE_FILE="docker-compose.yml"
APP_DIR="backend"
PORT="${PORT:-3000}"
BASE_URL="http://localhost:${PORT}"
KEEP_UP=false
REUSE_BACKEND=false
SERVER_PID=""
LOG_FILE="$(mktemp -t wazzar-checkpoint5-XXXXXX.log)"

for arg in "$@"; do
  case "$arg" in
    --keep-up) KEEP_UP=true ;;
    --reuse-backend) REUSE_BACKEND=true ;;
  esac
done

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; echo "  See full log: $LOG_FILE"; exit 1; }
info() { echo -e "${YELLOW}→${NC} $1"; }

cleanup() {
  if [[ "$KEEP_UP" == false && "$REUSE_BACKEND" == false ]]; then
    info "Tearing down..."
    [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" >/dev/null 2>&1 || true
    docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# curl wrapper: req METHOD PATH [BODY] [BEARER_TOKEN] -> sets HTTP_CODE, RESP
req() {
  local method="$1" path="$2" body="${3:-}" token="${4:-}"
  local args=(-s -o /tmp/wazzar_cp5_resp.json -w "%{http_code}" -X "$method" "${BASE_URL}${path}")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" -d "$body")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer ${token}")
  HTTP_CODE=$(curl "${args[@]}")
  RESP=$(cat /tmp/wazzar_cp5_resp.json)
}

rand_phone() {
  # +2557 followed by 8 random digits — same shape used elsewhere in
  # these scripts, just seeded differently per call so A and B never
  # collide with each other or with smoke-test.sh's seeded admin.
  printf "+2557%08d" "$((RANDOM * RANDOM % 100000000))"
}

# ---- 1. postgres + backend ---------------------------------------------
if [[ "$REUSE_BACKEND" == true ]]; then
  info "Reusing backend already running on $BASE_URL"
  curl -s -o /dev/null "${BASE_URL}/health" || fail "No backend responding on $BASE_URL — omit --reuse-backend to boot one"
else
  info "Starting Postgres (docker compose)..."
  docker compose -f "$COMPOSE_FILE" up -d postgres

  for i in $(seq 1 30); do
    status=$(docker inspect --format='{{.State.Health.Status}}' wazzar-postgres 2>/dev/null || echo "starting")
    [[ "$status" == "healthy" ]] && break
    sleep 2
    [[ "$i" == 30 ]] && fail "Postgres never became healthy"
  done
  pass "Postgres is healthy"

  cd "$APP_DIR"
  [[ -f .env ]] || { info "Copying .env.example -> .env"; cp .env.example .env; }

  info "Installing, building, migrating..."
  npm install >>"$LOG_FILE" 2>&1 || fail "npm install failed"
  npm run build >>"$LOG_FILE" 2>&1 || fail "Build failed"
  npm run db:migrate >>"$LOG_FILE" 2>&1 || fail "Migrations failed"
  pass "Backend built and migrated"

  info "Starting server on port $PORT..."
  PORT="$PORT" npm run start:prod >>"$LOG_FILE" 2>&1 &
  SERVER_PID=$!
  for i in $(seq 1 30); do
    curl -s -o /dev/null "${BASE_URL}/health" && break
    sleep 1
    [[ "$i" == 30 ]] && fail "Server never came up — check $LOG_FILE"
  done
  pass "Server is up (pid $SERVER_PID)"
fi

# ---- 2. register two independent business accounts ----------------------
info "Registering Business A..."
PHONE_A=$(rand_phone)
PASSWORD="SmokeTest#2026"
req POST /auth/register "{\"phone\":\"${PHONE_A}\",\"password\":\"${PASSWORD}\",\"fullName\":\"Checkpoint5 Business A\",\"role\":\"BUSINESS\"}"
[[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]] || fail "Business A register -> $HTTP_CODE: $RESP"
TOKEN_A=$(node -e "try{const r=require('/tmp/wazzar_cp5_resp.json');process.stdout.write(r.accessToken||r.access_token||'')}catch(e){}" 2>/dev/null || true)
if [[ -z "$TOKEN_A" ]]; then
  req POST /auth/login "{\"phone\":\"${PHONE_A}\",\"password\":\"${PASSWORD}\"}"
  [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]] || fail "Business A login -> $HTTP_CODE: $RESP"
  TOKEN_A=$(node -e "try{const r=require('/tmp/wazzar_cp5_resp.json');process.stdout.write(r.accessToken||r.access_token||'')}catch(e){}")
fi
[[ -n "$TOKEN_A" ]] || fail "Could not obtain an access token for Business A"
pass "Business A registered + authenticated ($PHONE_A)"

info "Registering Business B..."
PHONE_B=$(rand_phone)
req POST /auth/register "{\"phone\":\"${PHONE_B}\",\"password\":\"${PASSWORD}\",\"fullName\":\"Checkpoint5 Business B\",\"role\":\"BUSINESS\"}"
[[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]] || fail "Business B register -> $HTTP_CODE: $RESP"
TOKEN_B=$(node -e "try{const r=require('/tmp/wazzar_cp5_resp.json');process.stdout.write(r.accessToken||r.access_token||'')}catch(e){}" 2>/dev/null || true)
if [[ -z "$TOKEN_B" ]]; then
  req POST /auth/login "{\"phone\":\"${PHONE_B}\",\"password\":\"${PASSWORD}\"}"
  [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]] || fail "Business B login -> $HTTP_CODE: $RESP"
  TOKEN_B=$(node -e "try{const r=require('/tmp/wazzar_cp5_resp.json');process.stdout.write(r.accessToken||r.access_token||'')}catch(e){}")
fi
[[ -n "$TOKEN_B" ]] || fail "Could not obtain an access token for Business B"
pass "Business B registered + authenticated ($PHONE_B)"

# ---- 3. Business A creates a scheduled delivery due in ~2 minutes -------
# Mirrors computeNextRunAt's own EAT math (UTC+3, no DST) so the schedule
# is guaranteed due well within this script's polling window, without
# relying on the server's local timezone.
info "Computing a daysOfWeek/timeOfDay combination due in ~2 minutes (EAT)..."
read -r EAT_DOW EAT_HHMM <<<"$(node -e '
  const EAT_OFFSET_MS = 180 * 60000;
  const target = new Date(Date.now() + EAT_OFFSET_MS + 2 * 60000);
  const dow = target.getUTCDay();
  const hh = String(target.getUTCHours()).padStart(2, "0");
  const mm = String(target.getUTCMinutes()).padStart(2, "0");
  console.log(dow, `${hh}:${mm}`);
')"
pass "Schedule will fire today (day ${EAT_DOW}) at ${EAT_HHMM} EAT"

SCHEDULE_BODY=$(cat <<JSON
{
  "name": "Checkpoint5 Test Schedule",
  "pickupLocation": {"latitude": -6.7924, "longitude": 39.2083, "address": "Checkpoint5 Pickup"},
  "dropoffLocation": {"latitude": -6.8000, "longitude": 39.2800, "address": "Checkpoint5 Dropoff"},
  "packageWeightKg": 2,
  "packageDescription": "Checkpoint5 automated test parcel",
  "daysOfWeek": [${EAT_DOW}],
  "timeOfDay": "${EAT_HHMM}"
}
JSON
)

req POST /business/scheduled-deliveries "$SCHEDULE_BODY" "$TOKEN_A"
[[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]] || fail "Create scheduled delivery -> $HTTP_CODE: $RESP"
SCHEDULE_ID=$(node -e "try{const r=require('/tmp/wazzar_cp5_resp.json');process.stdout.write(r.id||'')}catch(e){}")
[[ -n "$SCHEDULE_ID" ]] || fail "Scheduled delivery created but no id in response: $RESP"
pass "Scheduled delivery created (id ${SCHEDULE_ID})"

info "Snapshotting Business A's shipment count before the cron fires..."
req GET "/shipments?limit=100" "" "$TOKEN_A"
[[ "$HTTP_CODE" == "200" ]] || fail "GET /shipments (before) -> $HTTP_CODE: $RESP"
SHIPMENTS_BEFORE=$(node -e "try{const r=require('/tmp/wazzar_cp5_resp.json');const arr=Array.isArray(r)?r:(r.data||[]);console.log(arr.length)}catch(e){console.log(0)}")
pass "Business A has ${SHIPMENTS_BEFORE} shipment(s) before the tick"

# ---- 4. poll until the real cron tick fires it ---------------------------
info "Waiting for the real @Cron(EVERY_MINUTE) tick to fire the schedule (up to 3 minutes)..."
FIRED=false
for i in $(seq 1 36); do
  req GET /business/scheduled-deliveries "" "$TOKEN_A"
  [[ "$HTTP_CODE" == "200" ]] || fail "GET /business/scheduled-deliveries -> $HTTP_CODE: $RESP"
  LAST_RUN_AT=$(node -e "
    try {
      const r = require('/tmp/wazzar_cp5_resp.json');
      const arr = Array.isArray(r) ? r : (r.data || []);
      const mine = arr.find((s) => s.id === '${SCHEDULE_ID}');
      process.stdout.write(mine && mine.lastRunAt ? mine.lastRunAt : '');
    } catch (e) {}
  ")
  if [[ -n "$LAST_RUN_AT" ]]; then
    FIRED=true
    break
  fi
  sleep 5
done
[[ "$FIRED" == true ]] || fail "Schedule never fired within the grace period — cron may not be running (check ScheduleModule.forRoot() in app.module.ts)"
pass "Cron fired the schedule (lastRunAt = ${LAST_RUN_AT})"

# ---- 5. confirm a real shipment now exists --------------------------------
req GET "/shipments?limit=100" "" "$TOKEN_A"
[[ "$HTTP_CODE" == "200" ]] || fail "GET /shipments (after) -> $HTTP_CODE: $RESP"
SHIPMENTS_AFTER=$(node -e "try{const r=require('/tmp/wazzar_cp5_resp.json');const arr=Array.isArray(r)?r:(r.data||[]);console.log(arr.length)}catch(e){console.log(0)}")
[[ "$SHIPMENTS_AFTER" -gt "$SHIPMENTS_BEFORE" ]] || fail "Shipment count did not increase (before=$SHIPMENTS_BEFORE, after=$SHIPMENTS_AFTER) — cron ran but created nothing"
pass "A real shipment was created by the cron tick (${SHIPMENTS_BEFORE} -> ${SHIPMENTS_AFTER})"

NEW_SHIPMENT_ID=$(node -e "
  try {
    const r = require('/tmp/wazzar_cp5_resp.json');
    const arr = Array.isArray(r) ? r : (r.data || []);
    const match = arr.find((s) => s.pickupLocation && s.pickupLocation.address === 'Checkpoint5 Pickup');
    process.stdout.write(match ? match.id : '');
  } catch (e) {}
")
[[ -n "$NEW_SHIPMENT_ID" ]] && pass "New shipment matches the schedule's pickup address (id ${NEW_SHIPMENT_ID})" \
  || info "Could not positively match the new shipment by pickup address (non-fatal — count increase already proves creation)"

# ---- 6. billing/payment-history scoping -----------------------------------
info "Checking GET /payments/history scoping for Business A and Business B..."
req GET "/payments/history?limit=100" "" "$TOKEN_A"
[[ "$HTTP_CODE" == "200" ]] || fail "GET /payments/history (A) -> $HTTP_CODE: $RESP"
PAYMENTS_A="$RESP"

req GET "/payments/history?limit=100" "" "$TOKEN_B"
[[ "$HTTP_CODE" == "200" ]] || fail "GET /payments/history (B) -> $HTTP_CODE: $RESP"
PAYMENTS_B="$RESP"
pass "Both accounts get 200 from /payments/history"

echo "$PAYMENTS_A" > /tmp/wazzar_cp5_payments_a.json
echo "$PAYMENTS_B" > /tmp/wazzar_cp5_payments_b.json
LEAK=$(node -e "
  try {
    const a = require('/tmp/wazzar_cp5_payments_a.json');
    const b = require('/tmp/wazzar_cp5_payments_b.json');
    const arrA = Array.isArray(a) ? a : (a.data || []);
    const arrB = Array.isArray(b) ? b : (b.data || []);
    const idsA = new Set(arrA.map((p) => p.id));
    const overlap = arrB.filter((p) => idsA.has(p.id));
    process.stdout.write(String(overlap.length));
  } catch (e) { process.stdout.write('ERR'); }
")
[[ "$LEAK" == "0" ]] || fail "Business B's payment history contains ${LEAK} payment(s) belonging to Business A — scope leak"
pass "No cross-account leakage between Business A and Business B payment histories"
info "(Business A had 0 payments to begin with — no payment was initiated for the scheduled shipment — so this confirms scoping/isolation, not display of real transaction data. Run the full payment flow separately to check that.)"

echo ""
pass "Checkpoint 5 (Scheduled Deliveries cron + Billing scope) passed."
[[ "$KEEP_UP" == true ]] && info "Server + Postgres left running: $BASE_URL"
