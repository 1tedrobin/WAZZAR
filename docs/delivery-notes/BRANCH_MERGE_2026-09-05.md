# Branch merge, 2026-09-05 — reconciling two divergent ZIPs

Two ZIP exports of this project had diverged from the same Phase 2
foundation into two separate lines of work, each missing what the
other built:

- **`WAZZAR-phase2-self-service-booking-2026-09-05.zip`** — rider
  self-service on legs (`self-claim`/`self-start`/`self-complete`),
  carrier/partner self-service (`carrier-start`/`carrier-complete`),
  `apps/customer`'s intercity booking flow (the "Sending between
  cities" toggle + hub picker), and opening `GET /hubs` to
  CUSTOMER/BUSINESS roles. See
  `docs/delivery-notes/PHASE2_INTERCITY_FOUNDATION.md`'s "Update,
  2026-09-05" section.
- **`WAZZAR-merged-2026-09-04-v3.zip`** — Phase 3 in full (business API
  keys + public API, invoicing, analytics dashboard, CSV bulk send) and
  Phase 4 underway (multi-currency/multi-market, regional mobile-money
  providers). See `backend/README.md`'s "Piece 16" section for the
  rundown.

## How they were reconciled

The Phase 3/4 ZIP was used as the base (it was the broader superset for
backend infra — migrations, currency plumbing, new modules). The Phase
2 self-service ZIP's unique work was then layered on top:

- `legs.service.ts` — added `selfClaimLocalLeg`, `selfAdvanceLocalLeg`,
  `carrierAdvanceTrunkLeg`, and the `afterLegStatusChange` refactor
  (the shared shipment-cascade/tracking-event/broadcast tail, now
  called by dispatcher, rider, and carrier paths alike) on top of the
  Phase 4 branch's currency-aware version of this file. The cascade
  logic itself was untouched by either branch's currency work, so this
  was a clean splice, not a rewrite.
- `legs.module.ts` — registered the two new controllers +
  `PartnerOperatorsModule`.
- New files `partner-legs.controller.ts` / `rider-legs.controller.ts`
  copied over as-is; their dependencies (`PartnerOperatorsModule`,
  `PartnerApiKeyGuard`, etc.) were already common to both branches.
- `hubs.controller.ts` — widened the two read routes to
  CUSTOMER/BUSINESS.
- `apps/customer` (`App.jsx`, `api.js`, smoke test) — taken wholesale
  from the self-service ZIP; confirmed line-by-line that the Phase 3/4
  ZIP's version was a strict subset (it simply predates the intercity
  booking UI) with nothing unique of its own to lose.
- `apps/business`, all backend entities/services/migrations, and every
  other shared file — taken from the Phase 3/4 ZIP; confirmed the same
  way that the self-service ZIP had nothing unique in these files.
- `.gitignore` files (root + every app + backend) were missing
  entirely from the Phase 3/4 ZIP — restored from the other one.
- `backend/README.md` and `MASTER_GAPS_AND_ROADMAP.md` — hand-merged;
  both had real, different dated entries on each side that needed
  combining rather than picking one.

## Verified for real, 2026-09-05

Backend: `npm install`, `tsc --noEmit`, `eslint`, the full `jest` suite
(**378/378 passing, 32/32 suites** — including the self-service leg
tests carried over from the Phase 2 ZIP), and `nest build` all ran
clean.

Frontend: all four apps (`customer`, `admin`, `business`, `rider`) ran
`npm install` and `vite build` clean. `apps/customer` also ran `vitest
run` (3/3 passing, including the intercity-booking end-to-end test).
`apps/admin` and `apps/rider` have no unique test suites beyond what
was already passing before this merge.

Still not run: against a real Postgres database or a live HTTP server
— same caveat every prior pass in this project has carried.

## Pre-existing issue fixed

`backend/README.md` had one dangling half-sentence fragment ("section
before trusting either in production.") left over from an earlier
edit, present identically in both source ZIPs before this merge —
grammatically disconnected from the bullet above it, with no clear
original sentence to restore it into. Removed.
