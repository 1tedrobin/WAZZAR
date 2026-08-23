# WAZZAR headless test harness

Runs every checkpoint in `VERIFICATION_PLAN.md` without a human clicking
through anything, using a real Postgres (via `docker-compose.yml`) and a
real backend — no mocks, no fixtures standing in for the database.

## One command

```bash
cd backend
./scripts/run-all-checkpoints.sh
```

Runs Checkpoints 1 through 6 in order, isolates each stage with its own
clean Postgres, and prints a single pass/fail matrix at the end that
lines up with `VERIFICATION_PLAN.md`'s own Summary Checklist. Expect
roughly 10-15 minutes end to end. Add `--skip-docker` to skip Checkpoint
6 if you don't want to wait on (or don't have) container registry access.

## What each piece covers, and what it doesn't

| Script | Covers | Does NOT cover |
|---|---|---|
| `smoke-test.sh` | Checkpoints 1-3: backend compiles/lints/191 tests/builds, boots for real against Postgres, `/health`, `/health/db`, `/pricing/*`, `/auth/login` with a seeded admin, all 4 frontend apps install + build | Whether any screen actually renders correctly — build success only |
| `e2e-walkthrough.sh` (+ `e2e/shipment-walkthrough.spec.js`) | Checkpoint 4: a real Playwright browser drives the customer app and rider app together through one full shipment — register, go online, book, accept, pick up, deliver — against the real backend. **Now also asserts the tracking screen shows the real rider's name ("WAZZAR Rider"), not the old "Juma Mwakalinga" mock** — this specific claim in Checkpoint 4 Test Case 3 had no assertion behind it before | apps/business and apps/admin UI — deliberately out of scope, see the spec's own header comment |
| `checkpoint5-business.sh` | Checkpoint 5: registers two real Business accounts, creates a Scheduled Delivery due ~2 minutes out, waits for the **real** `@Cron(EVERY_MINUTE)` tick (not a manual trigger) to fire it, confirms a real shipment was created, then checks `GET /payments/history` for both accounts returns 200 with no cross-account leakage | Whether the Business app's own "Scheduled Deliveries" / "Billing" tabs render this correctly — this is API-level only, no browser |
| Checkpoint 6 (inline in `run-all-checkpoints.sh`) | Attempts `docker build`, reports PASS/FAIL/SKIPPED — SKIPPED specifically means no container registry was reachable to pull the base image, distinct from a real build failure | Actually deploying anywhere |

## Running pieces individually

Each script is also independently runnable and self-contained (own
Postgres lifecycle, own teardown):

```bash
./scripts/smoke-test.sh [--keep-up] [--skip-apps]
./scripts/e2e-walkthrough.sh [--keep-up] [--headed]
./scripts/checkpoint5-business.sh [--keep-up] [--reuse-backend]
```

`--reuse-backend` on `checkpoint5-business.sh` skips its own
Postgres/backend bring-up and talks to whatever's already listening on
`$PORT` (default 3000) — useful for chaining after `smoke-test.sh
--keep-up` without paying the startup cost twice.

## What's still NOT automated (needs a human)

- **Look and feel.** Every script here checks that the right API calls
  fire and the right data ends up on screen as *text* — none of it
  judges layout, spacing, or whether something that renders correctly
  still looks broken.
- **Real payment provider credentials.** M-Pesa and Stripe both stay on
  their mock/fake-data code path without real sandbox credentials (see
  `.env.example`) — nothing here can test the real webhook round-trip.
- **Deployment.** Nothing here provisions Netlify/Railway/etc. Checkpoint
  6 only proves the image *can* build, not that it runs correctly once
  deployed somewhere.

## Requirements

`docker`, `docker compose` (v2 CLI plugin), `node`, `npm`, `curl`. For
`e2e-walkthrough.sh`, also enough of a display stack for Playwright's
bundled headless Chromium (works out of the box on most CI images and
desktop Linux/macOS).
