# Business app + Rider app/backend — merge notes

This pass merged two separate deliverables into the monorepo:
`wazzar-business-app-wired.zip` (business app wired to the real backend)
and `wazzar_backend_riders.zip` (backend riders/shipments additions +
rider app wired to match). Both are now the working code in
`apps/business`, `apps/rider`, and `backend/backend` — this note records
what changed and what was fixed while merging, so it isn't lost.

## Backend — two new endpoints (`riders` + `shipments` modules)

- **`GET /riders/me/earnings`** — a rider's total earnings + delivery
  list, computed live from `Shipment.riderPayout` on that rider's
  `DELIVERED`/`COMPLETED` shipments. Deliberately *not* read from
  `Rider.totalEarnings` — that column exists on the entity but nothing
  writes to it, so summing from `Shipment` avoids a second, driftable
  running total. `RidersModule` now imports `Shipment` read-only
  (`ShipmentsModule` remains the sole writer).
- **`GET /shipments/available`** — the rider-facing open queue:
  unassigned, `ASSIGNMENT_PENDING` shipments, oldest first. Registered
  before `:id` in the controller so it can't be swallowed by the
  `:id` param route (same convention as `/payments/reconcile/:date`).
  This is the rider-facing counterpart to the admin-only
  `GET /dispatch/queue` — riders have no dispatcher UI, so they get their
  own simple FIFO read instead of `DispatchService`'s geo-ranked
  candidates.

Both were additive — no entity/DTO changes needed, no existing route
conflicts, no behavior change to anything else in either module.

**Not applied:** the delivered backend zip's `package.json` had dropped
the `db:seed:admin` script. That script (and its `seed-admin.ts`) were
added in this repo in a later commit than the zip was built from and are
still very much needed (see `README_ADMIN_WIRING.md`) — the monorepo's
`package.json` was left as-is rather than overwritten.

## Rider app — now wired to the real backend

`apps/rider/src/App.jsx` and the new `src/api.js` replace the old
mock-data build. `mockData.js` is deleted — nothing in the wired app
references it anymore. Added `.env.example` (`VITE_API_URL`, mirrors the
business/customer apps) and `package-lock.json` (previously absent).

## Business app — now wired to the real backend

`apps/business/src/App.jsx` + new `src/api.js` replace the old mock-data
build. `src/mockData.js` is trimmed to only the four screens with no
backend model to back them (Customers/CRM, Scheduled/recurring,
Staff/team, Billing/subscriptions) — Orders and the Overview chart are
now real, computed from `/shipments`. Added `.env.example` and
`WIRING_NOTES.md` (kept alongside the app — full page-by-page rundown of
what's real vs. still a UI-only placeholder, same spirit as
`README_ADMIN_WIRING.md`).

## Fixed while merging: dev-server port collisions

Every WAZZAR frontend originally defaulted its Vite dev server to
**port 3000** — the same port the backend defaults to (`PORT=3000` in
`backend/backend/.env.example`). Admin's earlier wiring pass already
moved it to `5174` for this reason. This pass:

- **business**: `vite.config.js` was already updated to `3004` in the
  delivered zip, but its `netlify.toml` `[dev]` port was **not** —
  still `3000`, out of sync with its own vite config. Fixed to `3004`
  to match.
- **rider**: still defaulted to `3000` in both `vite.config.js` and
  `netlify.toml`. Fixed to `5175` in both.
- **customer**: also still defaulted to `3000` in both files, wasn't part
  of either deliverable merged here but had the identical bug. Fixed to
  `5173` in both, on request, for consistency with the other three.

Current state, all four apps:

| App | Dev port |
|---|---|
| customer | 5173 |
| admin | 5174 |
| business | 3004 |
| rider | 5175 |

All four now run on distinct ports from each other and from the backend
(`3000`), so any combination can run side by side locally.

## Verification done

- Full `diff -rq` between the delivered backend zip and the monorepo's
  existing `backend/backend` to confirm the only real changes were the
  five files above (plus the `package.json` script removal, not
  applied).
- Confirmed frontend/backend pairing: `apps/rider/src/api.js` calls
  `/riders/me/earnings` and `/shipments/available` — exactly the two
  routes added on the backend side, so the two halves of this
  deliverable are consistent with each other.
- Grepped both apps' `App.jsx` for leftover references to deleted mock
  exports (`MOCK_BUSINESS_ORDERS`, `MOCK_BUSINESS_CHART`, rider's old
  `mockData.js`) — none found.
- Syntax-checked every added/modified `.jsx`/`.js`/`.ts` file with
  esbuild (parse-only, not a full typecheck — no network access to
  `npm install` in this environment, so `tsc`/Vite build weren't run).
- Diffed `package.json`/`package-lock.json` for both apps against the
  delivered zips to confirm no dependency drift (rider needed no new
  packages; business's `recharts`/`lucide-react` were already present).

## Follow-up: customer app port fix + pricing config seed

Two more things came up while smoke-testing this merge, done as
follow-on commits:

- **`apps/customer`** had the identical port-3000-collides-with-backend
  bug as business/rider, just not part of either deliverable merged
  above. Fixed to `5173` in `vite.config.js` + `netlify.toml`, for
  consistency with the other three (`5174` admin, `3004` business,
  `5175` rider).
- **No active `PricingConfig` on a fresh database** — flagged as a known
  gap in `apps/business/WIRING_NOTES.md` but never actually closed:
  `/pricing/calculate` and shipment creation both throw on a clean
  install with no config seeded, which would have silently broken the
  New Delivery modal in both the business and customer apps the moment
  anyone tried it end to end. Added
  `backend/backend/src/database/seeds/seed-pricing.ts` (`npm run
  db:seed:pricing`), mirroring `seed-admin.ts`'s pattern: idempotent,
  env-var overridable, workable defaults so it runs with zero
  configuration. Documented in `backend/README.md` (new "Seeding an
  initial pricing config" section) and `apps/business/WIRING_NOTES.md`
  (gap marked closed).
