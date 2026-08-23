# Test Run Report & Way Forward

Date: 2026-08-21
Scope: full repo — `backend/backend`, `apps/customer`, `apps/admin`,
`apps/business`, `apps/rider`.

## Critical bug found and fixed: customer app's order flow was completely broken

`apps/customer/src/App.jsx` called `api.loginOrRegister`,
`api.createShipment`, `api.initiatePayment`, `api.requestDispatch`,
`api.getShipment`, `api.completeShipment`, and `api.calculatePrice`
throughout the file, but **never imported `api.js`** — `import * as
api from "./api"` was missing entirely. Every one of those calls
would throw `ReferenceError: api is not defined` the moment a real
user tried to log in, get a quote, or place an order. `vite build`
doesn't catch this (it's a runtime reference, not a syntax error),
which is why it passed the build check in the previous test-run pass
without surfacing.

Fixed: added the missing import. `admin`, `business`, and `rider`
all had it correctly — this was isolated to `customer`.

## Also fixed in this pass: customer app's own profile was still mock data

`AccountScreen` and the home-screen header avatar showed
`MOCK_CUSTOMER.name` / `.phone` / `.initials` / `.rating` — the
placeholder record, not the person actually logged in — even though
the app already had a real, logged-in `user` object available from
`api.loginOrRegister`'s response (it just wasn't being kept in
state). Fixed:
- `handleVerifyOtp` now stores `result.user` in state.
- `AccountScreen` and `HomeScreenFull` now derive name/phone/initials
  from the real user, falling back to the mock placeholder only
  before login (i.e. before there's a real user to show).
- The fabricated "4.8" customer rating badge was removed rather than
  wired — there's no backend field backing a customer's own rating
  (User entity has no rating column), so showing a number would be
  inventing data, not surfacing real data.

What's *still* intentionally mock in the customer app, and why: the
assigned rider's name/photo on the tracking screen (`MOCK_RIDER`) —
per `README_ADMIN_WIRING.md`, riders have no `name` field in the
schema at all, so there's nothing real to show yet — and the
pickup/dropoff address autocomplete suggestions (`MOCK_PICKUP_
SUGGESTIONS` / `MOCK_DROPOFF_SUGGESTIONS`) — there's no geocoding/
places-search endpoint in the backend. Both are genuine backend gaps,
not wiring bugs.

## What was run

### Backend (`backend/backend`)
- `npm test` (Jest)
- `npx tsc --noEmit` (full type-check)
- `npx eslint "src/**/*.ts"`

### Frontend apps (`apps/customer`, `apps/admin`, `apps/business`, `apps/rider`)
- `npm run build` (vite build) — none of the four apps have a test
  framework wired in yet, so a production build is the closest
  available check. (Also why the customer app's broken `api` import
  above didn't get caught by the first pass — build success doesn't
  mean runtime-correct for plain JS/JSX with no type-checker.)

## Results

### Backend tests — 8 suites, 121 tests, all passing

| Suite | Result |
|---|---|
| shipments.service.spec.ts | PASS |
| payments.service.spec.ts | PASS |
| dispatch.service.spec.ts | PASS |
| tracking.service.spec.ts | PASS |
| pricing.service.spec.ts | PASS |
| shipment-status.transitions.spec.ts | PASS |
| tracking-access.util.spec.ts | PASS |
| eta.util.spec.ts | PASS |

**Coverage gap:** the `riders` module has no `.spec.ts` at all. It's
the only service module in `src/modules/` without test coverage,
including the two endpoints added for the rider app
(`GET /shipments/available`, `GET /riders/me/earnings`).

### Backend type-check — 1 real bug found and fixed

`src/database/seeds/seed-admin.ts` failed `tsc --noEmit`:

```
error TS2345: Argument of type 'Role' is not assignable to
parameter of type 'Role.ADMIN | Role.SUPER_ADMIN'.
```

Cause: `ADMIN_ROLES` is declared as a narrow tuple type
(`[Role.ADMIN, Role.SUPER_ADMIN] as const`), so
`ADMIN_ROLES.includes(roleInput as Role)` doesn't type-check against
the wider `Role` enum, even though the runtime check is correct.

Fix applied (one line, no behavior change):

```ts
// before
if (!ADMIN_ROLES.includes(roleInput as Role)) {

// after
if (!(ADMIN_ROLES as readonly Role[]).includes(roleInput as Role)) {
```

`tsc --noEmit` is clean after this fix.

### Backend lint — 7 pre-existing style errors, none blocking

- `no-explicit-any` in 3 spec files (`pricing.service.spec.ts`,
  `shipments.service.spec.ts` ×4, `tracking.service.spec.ts`) — test
  mocks typed as `any`.
- 1 unused `queryRunner` param in
  `migrations/1787280000000-AddDispatcherRole.ts`.

Left untouched — style-only, not correctness bugs.

### Frontend builds — all 4 clean

| App | Result |
|---|---|
| customer | Built clean (after the `api` import fix above) |
| rider | Built clean |
| admin | Built clean (chunk >500kB warning) |
| business | Built clean (chunk >500kB warning) |

The admin/business warning is Rollup noting a single JS chunk over
500kB post-minification (driven by `recharts`) — not an error, just
a future code-splitting opportunity.

## Way forward — recommended next steps, in priority order

1. **Write `riders.service.spec.ts`.** The only untested backend
   module, and it now owns two endpoints (`getEarnings`;
   `findAvailableForRider` lives on the shipments side and does have
   coverage — confirm it's exercised there). Mirror the mocking
   pattern already used in `shipments.service.spec.ts`.
2. **Integration-test the full order/delivery loop against a live
   Postgres**, both sides: customer places an order (now that its
   `api` import is fixed) through to a rider completing it. Nothing
   in this repo has been run against a real database yet — everything
   verified so far is unit tests + production builds, not a live run.
   Given the customer bug above, treat a live run as required before
   calling any app "done," not optional polish.
3. **Decide on a file-upload story.** Rider onboarding docs and
   proof-of-delivery photos are still client-side-only gestures —
   there's no upload endpoint anywhere in the backend. This blocks
   real rider verification and real POD evidence.
4. **Add a customer-rating endpoint**, or leave it removed as it is
   now. Right now nothing invents a fake number for it, which is the
   safer state, but riders can't be rated by customers at all.
5. **Add a geocoding/places-search endpoint** so the customer app's
   pickup/dropoff address suggestions can be real instead of a fixed
   mock list.
6. Optional cleanup: fix the 7 lint errors, code-split
   admin/business to clear the chunk-size warning, refresh the
   stale "there's no rider app wired up in this pass" comment in
   `apps/customer/src/App.jsx` (rider app is wired now).

