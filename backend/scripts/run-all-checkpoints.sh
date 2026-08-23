#!/usr/bin/env bash
#
# run-all-checkpoints.sh — one command that runs every checkpoint in
# VERIFICATION_PLAN.md headlessly and prints a single pass/fail matrix
# at the end, matching that doc's "Summary Checklist" line for line.
#
# This chains three existing scripts rather than re-implementing them:
#   - smoke-test.sh          -> Checkpoints 1-3 (compile, backend runtime,
#                                app startup/build) + a slice of 7 (migrate)
#   - e2e-walkthrough.sh     -> Checkpoint 4 (customer+rider browser flow,
#                                now including the rider-name assertion
#                                added alongside this harness)
#   - checkpoint5-business.sh -> Checkpoint 5 (Scheduled Deliveries cron,
#                                Billing/payment-history scoping)
#
# Checkpoint 6 (Docker build) is reported separately: as of this repo's
# last session, `docker build` was never actually completed even by the
# people who wrote the Dockerfile, because no container registry was
# reachable to pull the base image (see the Dockerfile's own header
# comment). This script attempts it and reports honestly whichever of
# "passed" / "failed" / "skipped: no registry access" applies — it does
# not pretend a registry-blocked failure is a code problem.
#
# Each stage gets its own Postgres lifecycle (start clean, tear down) so
# a failure in one doesn't leave stale state for the next. This trades
# total runtime for isolation — expect ~10-15 minutes end to end.
#
# Usage:
#   cd backend
#   ./scripts/run-all-checkpoints.sh
#   ./scripts/run-all-checkpoints.sh --skip-docker   # skip Checkpoint 6 entirely
#
# Requires everything the three chained scripts require: docker, docker
# compose, npm, node, curl, and (for e2e-walkthrough.sh) enough of a
# display stack for Playwright's headless Chromium.

set -uo pipefail  # deliberately not -e: we want every checkpoint attempted

SKIP_DOCKER=false
for arg in "$@"; do
  case "$arg" in
    --skip-docker) SKIP_DOCKER=true ;;
  esac
done

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

declare -A RESULT
declare -A RESULT_DETAIL

run_stage() {
  local key="$1" label="$2" cmd="$3"
  echo ""
  echo -e "${YELLOW}══════════════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}▶ ${label}${NC}"
  echo -e "${YELLOW}══════════════════════════════════════════════════════════${NC}"
  if eval "$cmd"; then
    RESULT["$key"]="PASS"
  else
    RESULT["$key"]="FAIL"
  fi
}

cd "$SCRIPT_DIR/.."

# ---- Checkpoints 1-3 + partial 7: smoke-test.sh --------------------------
run_stage "cp123" "Checkpoints 1-3: compilation, backend runtime, app startup" \
  "./scripts/smoke-test.sh"

# ---- Checkpoint 4: e2e-walkthrough.sh ------------------------------------
run_stage "cp4" "Checkpoint 4: customer + rider end-to-end browser flow" \
  "./scripts/e2e-walkthrough.sh"

# ---- Checkpoint 5: checkpoint5-business.sh -------------------------------
run_stage "cp5" "Checkpoint 5: Scheduled Deliveries cron + Billing scope" \
  "./scripts/checkpoint5-business.sh"

# ---- Checkpoint 6: docker build ------------------------------------------
if [[ "$SKIP_DOCKER" == true ]]; then
  RESULT["cp6"]="SKIPPED"
  RESULT_DETAIL["cp6"]="skipped via --skip-docker"
else
  echo ""
  echo -e "${YELLOW}══════════════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}▶ Checkpoint 6: Docker build${NC}"
  echo -e "${YELLOW}══════════════════════════════════════════════════════════${NC}"
  DOCKER_LOG="$(mktemp -t wazzar-docker-build-XXXXXX.log)"
  if docker build -t wazzar-backend ./backend >"$DOCKER_LOG" 2>&1; then
    RESULT["cp6"]="PASS"
  else
    if grep -qiE "pull access denied|429 Too Many Requests|failed to resolve source metadata|i/o timeout|no such host|temporary failure in name resolution" "$DOCKER_LOG"; then
      RESULT["cp6"]="SKIPPED"
      RESULT_DETAIL["cp6"]="no container registry access in this environment (see $DOCKER_LOG)"
    else
      RESULT["cp6"]="FAIL"
      RESULT_DETAIL["cp6"]="see $DOCKER_LOG"
    fi
  fi
fi

# ---- Report ----------------------------------------------------------------
echo ""
echo -e "${YELLOW}══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  RESULTS — matches VERIFICATION_PLAN.md's Summary Checklist${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════════${NC}"

report_line() {
  local key="$1" label="$2"
  local status="${RESULT[$key]:-NOT RUN}"
  local color="$RED"
  local mark="✗"
  if [[ "$status" == "PASS" ]]; then color="$GREEN"; mark="✓"; fi
  if [[ "$status" == "SKIPPED" ]]; then color="$YELLOW"; mark="○"; fi
  echo -e "  ${color}${mark} [${status}]${NC} ${label}"
  [[ -n "${RESULT_DETAIL[$key]:-}" ]] && echo "      (${RESULT_DETAIL[$key]})"
}

report_line "cp123" "Backend code compiles, lints, 191 tests pass, TS builds"
report_line "cp123" "Backend runtime: /health, /health/db, /pricing/*, /auth/login"
report_line "cp123" "All 4 frontend apps install + build"
report_line "cp4"   "Customer app: order placed, rider assigned, delivered"
report_line "cp4"   "Customer tracking screen shows the real rider (not a mock)"
report_line "cp5"   "Business app: Scheduled Deliveries cron actually fires"
report_line "cp5"   "Business app: Billing/payment-history is caller-scoped"
report_line "cp6"   "Docker build"

echo ""
FAIL_COUNT=0
for k in "${!RESULT[@]}"; do
  [[ "${RESULT[$k]}" == "FAIL" ]] && FAIL_COUNT=$((FAIL_COUNT + 1))
done

if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo -e "${GREEN}All runnable checkpoints passed.${NC}"
  echo "Still not covered by any automated script (needs a human):"
  echo "  - Whether the UI actually looks/feels right (these scripts check wiring, not design)"
  echo "  - Real M-Pesa/Stripe credentials against sandbox (payments stay on the mock provider without them)"
  echo "  - Hosting/deployment (Netlify, Railway, etc. — nothing here provisions infrastructure)"
  exit 0
else
  echo -e "${RED}${FAIL_COUNT} checkpoint stage(s) failed — see logs above for the failing stage.${NC}"
  exit 1
fi
