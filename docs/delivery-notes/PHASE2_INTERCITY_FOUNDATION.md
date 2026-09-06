# Phase 2 (Intercity/Trunk Network) — foundation

Written 2026-09-03. Phase 2 was previously 0% complete — this pass builds
the backend foundation it all sits on: hubs, partner operators, carriers,
the leg model that drives intercity shipments, tracking-channel ingestion
(including a LATRA adapter), and a hub-scoped dispatcher permission
model. **Nothing frontend was built** — no dispatcher app, no admin UI
for managing hubs/carriers/partner operators. See "What's explicitly not
built" at the bottom.

**Verified for real, not just syntax-checked** — unlike some earlier
passes on this project, this sandbox had actual npm registry access:
`npm install` (806 packages), `npx tsc --noEmit`, `npx eslint`, the full
`npx jest` suite (270/270 passing across 25 suites, 42 of them new), and
`npx nest build` (real `dist/` output) were all run and are clean. Still
never run against a real Postgres database or a live HTTP server — see
"Not verified" below for what that leaves open.

## The model, in one picture

An INTERCITY shipment (`shipments.shipment_type = 'INTERCITY'`, as
opposed to every Phase 1 shipment, which is `LOCAL`) is backed by exactly
3 `legs` rows today:

```
1. LOCAL  customer pickup  -> origin hub        (a rider)
2. TRUNK  origin hub       -> destination hub    (a carrier)
3. LOCAL  destination hub  -> customer dropoff   (a rider)
```

`shipments.leg_count` / `shipments.current_leg` track this; both are
`NULL` for every LOCAL shipment (Phase 1 behavior is completely
unchanged — see "Why this is safe for Phase 1" below).

Each leg moves through its own small state machine —
`PENDING -> ASSIGNED -> IN_PROGRESS -> COMPLETED` (or `CANCELLED` from
any non-terminal state) — and the meaningful transitions cascade back
onto the *parent shipment's existing* `ShipmentStatus` enum
(`shipment-status.transitions.ts`, untouched):

| Leg event | Parent shipment becomes |
|---|---|
| Leg 1 ASSIGNED | `ASSIGNED` |
| Leg 1 IN_PROGRESS | `PICKUP_IN_PROGRESS` |
| Leg 1 COMPLETED | `PICKED_UP` (+ `current_leg` -> 2) |
| Leg 2 (TRUNK) IN_PROGRESS | `IN_TRANSIT` |
| Leg 2 COMPLETED | (no shipment-level change — still `IN_TRANSIT`; `current_leg` -> 3) |
| Leg 3 IN_PROGRESS | `OUT_FOR_DELIVERY` |
| Leg 3 COMPLETED | `DELIVERED` |

This mapping is a pure function — `legs/intercity-status.util.ts`,
independently unit-tested — and every status it produces was already a
legal transition in the existing state machine before this pass. Nothing
about `shipment-status.transitions.ts`, `PaymentsService`, rating, or the
customer tracking screen needed to change to support this: as far as
they're concerned, an intercity shipment just moves through the same
statuses a local one does, on a different schedule.

## What's new

**Entities/migrations** (`hubs`, `hub_assignments`, `partner_operators`,
`carriers`, `legs`, `tracking_channels`, `tracking_events`, plus an
additive `shipments.shipment_type` / `leg_count` / `current_leg`) — 8
migrations, `1787400000000` through `1787470000000`, continuing on from
the last existing one (`1787370000000-AddRiderDocumentReviews`).

**`hubs` module** — CRUD (ADMIN/SUPER_ADMIN write, +DISPATCHER read),
plus `POST/GET/DELETE /hubs/:id/staff` to scope a DISPATCHER-role user to
the hub(s) they operate. Deliberately reuses the existing
`Role.DISPATCHER` (added back in Piece 6) rather than the separate
`dispatchers` table `WAZZAR_SYSTEM_ARCHITECTURE.md`'s Phase 2 pseudocode
sketches — that would have created a second, competing notion of
"dispatcher."

**`partner-operators` module** — CRUD for the bus/trucking companies
WAZZAR contracts with, plus API-key issuance (`POST /partner-operators`)
and rotation (`POST /:id/rotate-key`). The raw key is shown exactly once
and shaped `<operatorId>.<64 hex chars>`; only its bcrypt hash is stored.
A new `PartnerApiKeyGuard` authenticates a partner's own systems the same
way `JwtAuthGuard` authenticates WAZZAR users, for the one endpoint that
needs it (see tracking-channels below).

**`carriers` module** — CRUD for a partner operator's individual
buses/trucks/vans, each with a small `routes` JSONB list
(`{fromCity, toCity}` pairs) used to shortlist carrier candidates for a
TRUNK leg. No ranking/scheduling logic yet — just an ACTIVE + route-match
filter.

**`legs` module** — the core:
- `POST /shipments/intercity` — plans a new intercity shipment (pickup/
  dropoff + an explicit origin/destination hub id), pricing it via the
  *existing* `PricingService.calculatePrice` against the summed
  straight-line distance across all 3 legs. This is a deliberate
  stand-in, not a finished intercity pricing model — see "Known
  simplifications."
- `GET /shipments/:id/legs` — same access rule as the shipment itself.
- `GET /legs/pending`, `GET /legs/active` (added 2026-09-03 alongside the
  admin UI work — see the update below), `POST /legs/:id/assign-rider`,
  `.../assign-carrier`, `.../start`, `.../complete`, `.../cancel` —
  DISPATCHER/ADMIN/SUPER_ADMIN only, a DISPATCHER further scoped to legs
  touching a hub they're assigned to.

**`tracking-channels` module** — ingests raw tracking pings for a leg
(`tracking_channels`, an audit log) and normalizes a `LOCATION_UPDATE`
into `tracking_events` (the customer/dispatcher-facing timeline) whenever
a ping actually carries coordinates. Three ways a ping arrives:
1. `POST /tracking-channels` — a dispatcher/admin logging one by hand.
2. `POST /tracking-channels/partner-ping` — a partner's own system, via
   `PartnerApiKeyGuard`, scoped so a partner can only push pings for legs
   whose carrier is actually one of their own.
3. `LatraPollingService` — a `@Cron(EVERY_5_MINUTES)` job that polls
   every ASSIGNED/IN_PROGRESS TRUNK leg's carrier through `LatraProvider`.

Every ingestion path also pushes a `tracking:leg-update` event over the
*existing* Socket.IO gateway (`TrackingGateway`, extended additively with
one new broadcast method — `tracking:update`, Phase 1's own event, is
completely untouched) to the same `shipment:{id}` room a customer is
already subscribed to.

**`LatraProvider`** — same mock-by-default Wire Pattern as
`MpesaProvider`/`StripeProvider`: real calls happen only when both
`LATRA_BASE_URL` (this codebase's side) and a specific partner
operator's own `latra_api_key` (their side) are configured. **Unlike the
payment providers, this is a structural placeholder, not a verified
integration** — there is no public LATRA developer sandbox this project
has been able to register for, so the request/response shape
(`GET /vehicles/:registration/location`, a bearer token, a
`{latitude, longitude, reportedAt}` response) is a best guess pending
real API documentation, not tested code. In mock mode it returns
`latitude: null, longitude: null` rather than a fake coordinate, so
nothing downstream ever plots a fabricated position.

## Why this is safe for Phase 1

- `shipments.shipment_type` defaults to `LOCAL`; `leg_count`/
  `current_leg` default to `NULL`. Every existing/future LOCAL shipment
  is completely unaffected — nothing about `ShipmentsService`,
  `DispatchService`, `PaymentsService`, or any of the four frontend apps
  needed to change.
- `TrackingGateway.broadcastToShipment` (Phase 1's rider-GPS broadcast)
  is untouched; `broadcastLegUpdate` is a new method on a distinctly
  named event.
- `shipment-status.transitions.ts` — the actual state-machine map — has
  zero new edges. `intercity-status.util.ts` only *selects* among
  transitions that were already legal.
- Every new migration is a new table or an additive column with a safe
  default; nothing alters or drops an existing column.

## Known simplifications (flagged, not hidden)

- **Rider/carrier self-service, added 2026-09-05 — but incomplete.**
  `POST /legs/:id/self-claim`, `.../self-start`, `.../self-complete`
  (rider JWT) and `.../carrier-start`, `.../carrier-complete` (partner
  API key) now exist — mirroring `ShipmentsService.assign`/
  `submitProofOfDelivery`'s conditional-update-by-owner pattern. Two real
  gaps remain: (1) self-claim has no geographic scoping — any ACTIVE,
  online rider anywhere can claim any PENDING LOCAL leg system-wide,
  same openness Phase 1 has (moot there — single city); (2) completing a
  final leg (the actual customer-facing delivery) still doesn't capture
  proof-of-delivery evidence the way Phase 1's `submitProofOfDelivery`
  does. Both flagged in `LegsService`'s own comments, not hidden.
- **Always exactly 3 legs.** `planIntercityShipment` and
  `intercity-status.util.ts` are both hard-coded to the
  LOCAL/TRUNK/LOCAL shape. A multi-hub relay (more than one TRUNK leg) or
  a same-hub-pickup shortcut isn't supported — would need a variable-leg
  reducer instead of the fixed status-mapping table above.
- **Intercity pricing reuses Phase 1's rate card wholesale** (same
  per-km/per-kg config, applied to the summed 3-leg distance). No
  separate trunk-leg carrier-cost line item, no partner revenue-share
  economics. Real intercity pricing is its own project.
- **Cancelling one leg cancels the whole shipment.** No reroute/
  redo-leg recovery flow — a bus breaking down mid-route takes the
  whole intercity job down with it in this pass.
- **`PartnerOperator.latra_api_key` is stored as plain text.** Flagged
  directly on the entity — this codebase has no encryption-at-rest
  utility anywhere yet (Stripe/M-Pesa secrets are all env vars, never DB
  columns). Don't put a real LATRA credential in that column before a
  real encryption solution exists.
- **No partner self-service portal.** Onboarding a partner operator and
  their carriers is entirely an ADMIN action today; a partner adding
  their own vehicles/routes is a follow-up.

## What's explicitly not built

- **A separate dispatcher app.** Turned out not to be needed — see
  "Update, 2026-09-03" below. Every dispatcher-facing action (leg
  assign/start/complete/cancel, hub staffing) and all three new CRUD
  surfaces (Hubs, Carriers, Partner Operators) are wired into
  `apps/admin` instead. `apps/admin/README_ADMIN_WIRING.md` has the full
  page-by-page detail.
- **A real LATRA integration** — see `LatraProvider`'s note above. Not
  something a code change can close — see the note at the very end of
  this document.

## Update, 2026-09-05 — rider/carrier self-service, customer booking

Two more of the pass's own follow-ups closed, plus one gap found and
fixed along the way:

**Rider self-service** (`legs/rider-legs.controller.ts`, JWT + RIDER
role): `POST /legs/:id/self-claim`, `.../self-start`, `.../self-complete`
mirror `ShipmentsService.assign`/`submitProofOfDelivery`'s exact
race-safe, conditional-UPDATE-by-owner pattern for LOCAL legs. **Two
gaps remain, flagged in `LegsService`'s own comments**: no geographic
scoping on self-claim (same openness Phase 1 already has), and no
proof-of-delivery capture on a final leg's completion.

**Carrier self-service** (`legs/partner-legs.controller.ts`,
`PartnerApiKeyGuard`): `POST /legs/:id/carrier-start`,
`.../carrier-complete` — a partner operator's own system advancing its
own carrier's TRUNK leg, same ownership-check shape as
`TrackingChannelsService.ingestPartnerPing`.

Both share one new private method, `LegsService.afterLegStatusChange`
— the shipment-cascade/tracking-event/broadcast tail that used to live
only inside the dispatcher-driven `advanceStatus`, now called by all
three paths (dispatcher, rider, carrier) after each one does its own
authorized write.

**Customer-facing intercity booking** (`apps/customer`): a "Sending
between cities" toggle on the package-details step opens a new
`IntercityHubsScreen` (pick an origin and destination hub from
`GET /hubs`, unfiltered — no attempt to auto-match a geocoded address to
a hub's city, since `LocationDto` carries no structured city field to
match against) before the price estimate. Confirming calls
`POST /shipments/intercity` (`api.planIntercityShipment`) instead of
`POST /shipments`. The price preview reuses the same
`POST /pricing/calculate` call the LOCAL flow already previews with —
just fed the sum of pickup→originHub + originHub→destinationHub +
destinationHub→dropoff distances (same haversine util already in
`App.jsx`) instead of a direct pickup→dropoff distance — since no
separate intercity quote endpoint exists server-side (see
`LegsService.planIntercityShipment`'s pricing note above); this should
land at or very near the real price without being a guarantee of it.

**Gap found and fixed along the way**: `GET /hubs` (and `GET /hubs/:id`)
only allowed ADMIN/SUPER_ADMIN/DISPATCHER — a CUSTOMER booking an
intercity shipment couldn't have listed hubs to choose from at all.
Added `Role.CUSTOMER`/`Role.BUSINESS` to those two read routes (writes
unchanged, still ADMIN/SUPER_ADMIN-only).

Verified for real: backend re-ran its full check suite (`tsc`/
`eslint`/`jest`, 283/283 across 25 suites, 15 of them new) after the
self-service methods and the hub role change; `apps/customer` ran `npm
install`, `vite build`, and `vitest run` (3/3 — including a new test
that drives the entire intercity flow for real: login, pickup, dropoff,
the intercity toggle, picking two different hubs, and confirming, then
asserts `planIntercityShipment` — not `createShipment` — was called
with the chosen hub ids).

## Update, 2026-09-03 — folded into `apps/admin` instead of a 5th app

Asked directly: "can't the dispatcher app be inside the admin app?" —
yes, and the codebase already assumed as much before Phase 2 existed.
`apps/admin/src/api.js`'s `roleSummary()` already distinguished
`isAdmin`/`isDispatcher`, and its Dispatch page (Phase 1's local-dispatch
queue) was already reachable by a DISPATCHER-only login. Backend-side,
`LegsService.assertDispatcherHubAccess` already treats ADMIN/SUPER_ADMIN
as a superset of DISPATCHER (admins bypass hub-scoping entirely) — there
was no backend reason for two separate frontends.

What changed in `apps/admin`:
- **Dispatch page** gained an "Intercity (Phase 2)" section: pending
  local/trunk legs (click to assign a rider from the same online-riders
  list Phase 1 dispatch already fetches, or a carrier from `GET
  /carriers`) and active legs (Start/Complete/Cancel inline, calling
  `GET /legs/active` — a new backend endpoint added in this pass
  alongside the frontend work, since advancing an already-assigned leg
  needed a way to list it that `GET /legs/pending` doesn't cover; see
  `LegsService.getActiveQueue`).
- **Hubs, Carriers, Partner Operators** — three new full-CRUD pages.
  Partner operator create/rotate surfaces the one-time raw API key in a
  dedicated `ApiKeyReveal` modal so it can't be missed. A hub's staff
  (dispatcher assignment) lives inside its edit modal rather than a
  separate screen.
- **Role-based nav filtering** — `NAV` items now carry a
  `dispatcherVisible` flag; `AppShell` shows the full console to
  ADMIN/SUPER_ADMIN but filters a DISPATCHER-only login down to just
  Dispatch. Deliveries was **not** added to that list even though it
  seemed like an obvious companion — `ShipmentsService.assertCanAccess`
  doesn't grant DISPATCHER access to an arbitrary shipment, so showing
  it would mean a working-looking page that 403s on every lookup.

Verified for real, same discipline as the backend pass: `npm install`,
`npx vite build`, and `npx vitest run` all ran clean (3/3 tests, one of
them new — logging in as a DISPATCHER-only account and asserting the
sidebar only shows Dispatch). Not verified: against a real running
backend (every check here used mocked or empty API responses).

## Not verified

- **No real Postgres.** Every migration is new SQL, syntactically valid
  TypeScript (confirmed via `tsc`), but never actually run — no
  `npm run db:migrate` against a live database, so no confirmation the
  DDL executes cleanly, that the FK constraints (`legs.rider_id ->
  riders.id`, etc.) are correctly named, or that existing Phase 1 rows
  really do migrate forward with `shipment_type = 'LOCAL'` as expected.
- **No live HTTP server.** Every controller/guard/DTO compiles and is
  unit-tested at the service layer, but nothing here has been exercised
  end-to-end through an actual running NestJS process (routing
  conflicts between `IntercityShipmentsController` and
  `ShipmentsController` sharing `@Controller('shipments')`, guard
  ordering, DTO validation on real HTTP bodies — all reasoned through,
  none observed).
- **`LatraProvider`'s real-credentials branch** — see above; there's no
  sandbox to test the actual HTTP call against.

## On real LATRA credentials

This is the one open item from the original three (customer booking,
rider/carrier self-service, real LATRA credentials) that isn't a coding
task. LATRA (Tanzania's Land Transport Regulatory Authority) issues API
access to registered transport operators/partners through its own
onboarding process — there's no public sandbox or self-serve developer
signup to build and verify a real integration against. `LatraProvider`
already has the adapter shape ready (mock by default, same pattern as
`MpesaProvider`/`StripeProvider` — see that file's header comment): once
WAZZAR actually has a `LATRA_BASE_URL` and a partner operator's real
`latra_api_key`, plugging them in is a config change, not a rebuild. But
obtaining those credentials is an operations/business step outside this
codebase, not something to build around here.

