# WAZZAR Backend Skeleton

This is deliberately the smallest possible "real" backend: an API server that
boots, connects to Postgres, and proves both are alive. No business features
yet — that's the next piece, built on top of this once it's confirmed working.

## What's here

- NestJS app (`backend/`) with a `/health` and `/health/db` endpoint
- TypeORM wired up to Postgres, migration-based (no auto-sync)
- Docker Compose for a local Postgres instance
- **Auth** vertical slice: `POST /auth/register`, `POST /auth/login`,
  `POST /auth/refresh`, `GET /auth/me`, backed by real `users` and
  `user_roles` tables, JWT access + refresh tokens, bcrypt password
  hashing, and role-based guards (`JwtAuthGuard`, `RolesGuard`, `@Roles()`)
- **Shipments** vertical slice: `POST /shipments`, `GET /shipments/:id`,
  `GET /shipments` (filter by `status`, paginated, scoped to the
  authenticated caller), `PATCH /shipments/:id/status` (validated
  state-machine transitions), and `POST /shipments/:id/assign` (a rider
  self-claims an `ASSIGNMENT_PENDING` shipment), backed by a real
  `shipments` table (matches the Phase 1 schema in
  `WAZZAR_SYSTEM_ARCHITECTURE.md`) — access is scoped to the owning
  customer, the assigned rider, or an admin
- **Riders** vertical slice: `POST /riders` (self-onboard), `GET /riders/me`,
  `POST /riders/availability/online` / `.../offline`, `PATCH /riders/:id/verify`
  (admin), backed by a real `riders` table with a DB-level foreign key from
  `shipments.rider_id`
- **Status history**: every status a shipment passes through (including the
  initial `CREATED` on creation) is written to a `shipment_statuses` audit
  table — who changed it (`changed_by`, from the bearer token; null for
  system/pre-Auth writes), when, and an optional `reason`. Readable via
  `GET /shipments/:id/history`, same access rule as the shipment itself.
- **Live tracking**: `POST /rider/location` (a rider pings their current
  GPS position, upserted into a `rider_locations` table), `GET
  /shipments/:id/tracking` (HTTP snapshot: rider location, status,
  pickup/dropoff, a distance-based ETA estimate), and a `/tracking`
  WebSocket namespace (Socket.IO) that pushes a `tracking:update` event to
  every client subscribed to a shipment's room whenever the assigned
  rider's location changes — same access rule as the shipment itself,
  enforced on both the HTTP and WebSocket paths.
- **Dispatch**: `GET /dispatch/queue` (pending shipments + online riders),
  `GET /dispatch/shipments/:id/candidates` (nearest-pickup-first, using
  each rider's last-known `rider_locations` ping; riders with no recent
  ping fall back to a rating/seniority heuristic),
  `POST /dispatch/shipments/:id/assign` (admin picks a specific rider),
  `POST /dispatch/shipments/:id/auto-assign` (system picks the top
  candidate) — the dispatcher/admin override on top of rider self-claim
  that Piece 6 flagged as missing. Admin/Super_Admin only.
- **Proof of delivery**: `POST /shipments/:id/deliver` (the assigned
  rider confirms delivery — recipient name, optional photo URL, optional
  notes — atomically moving the shipment `OUT_FOR_DELIVERY` →
  `DELIVERED` and writing a `proof_of_delivery` row) and `GET
  /shipments/:id/proof-of-delivery` (read it back), same access rule as
  the shipment itself. `PATCH /shipments/:id/status` can no longer be
  used to reach `DELIVERED` directly — same reasoning as `ASSIGNED`
  being carved out for `POST /shipments/:id/assign`.

## Setup (run these in order)

```bash
# 1. Start Postgres
docker-compose up -d

# 2. Install backend deps
cd backend
npm install

# 3. Configure env
cp .env.example .env

# 4. Run migrations (creates the shipments table)
npm run db:migrate

# 5. Start the server
npm run dev
```

## Seeding the first admin account

`ADMIN`/`SUPER_ADMIN` can't be created through `/auth/register` (see Piece 4's
"Known simplifications" below) — use the seed script instead of a manual
`INSERT`:

```bash
SEED_ADMIN_PHONE=+255700000000 \
SEED_ADMIN_PASSWORD='Admin123!' \
SEED_ADMIN_FULL_NAME='Admin' \
npm run db:seed:admin
```

Idempotent — safe to run again against the same database; it won't create a
duplicate user or duplicate role. Defaults to the `ADMIN` role; set
`SEED_ADMIN_ROLE=SUPER_ADMIN` for the higher tier. Full details and env var
list are in the script's header comment at
`src/database/seeds/seed-admin.ts`.

## Seeding an initial pricing config

A fresh database has zero rows in `pricing_configs`. Every quote and
every shipment-creation call goes through `PricingService`, which
throws if no config is active — so without this, `POST
/pricing/calculate` and `POST /shipments` both fail immediately on a
clean install, in every app (customer, business) that creates
shipments. `PricingConfig` writes are admin-only and there's no
bootstrap route, so — same reasoning as the admin account above — the
first one needs a seed script too:

```bash
npm run db:seed:pricing
```

Every field has a workable default (base 2000/TZS, 500/km after the
first 2km, 300/kg after the first 1kg, 20/80 commission split, 1.5x
surge 07:00-10:00 & 17:00-20:00) — running it with no env vars at all
is enough to unblock quoting locally. Override any of them with
`SEED_PRICING_*` env vars; see the script's header comment at
`src/database/seeds/seed-pricing.ts` for the full list.

Idempotent in a narrower sense than the admin seed: if an active config
already exists, it leaves it alone and exits rather than replacing it —
this script only exists to get a blank database off zero, not to roll
out price changes. Use `POST /pricing/configs` or `PUT
/pricing/configs/:id` (admin-only, see Piece 11 below) for that once
the system is live.

## Definition of "done" — Piece 1: bare skeleton

- [ ] `docker-compose up -d` starts Postgres without errors
- [ ] `npm run dev` starts the server and logs the listening port
- [ ] `curl http://localhost:3000/health` returns `{"status":"ok", ...}`
- [ ] `curl http://localhost:3000/health/db` returns `{"status":"ok", "database": {"connected": true, "queryable": true}}`

## Definition of "done" — Piece 2: Shipments

*(Superseded by Piece 4 below — kept for history. `customerId` is no
longer a request field; it comes from the bearer token.)*

- [ ] `npm run db:migrate` runs cleanly and creates the `shipments` table
- [ ] Creating a shipment works (see Piece 4 for the auth step this now
  needs first)
- [ ] Fetching it back works: `curl http://localhost:3000/shipments/<id-from-above>`
- [ ] Fetching a random UUID returns a 404, not a crash

## Definition of "done" — Piece 3: Status transitions & listing

*(Superseded by Piece 4 below — kept for history. Listing is now scoped
to the caller's token, not a `customerId` query param.)*

- [ ] A valid transition succeeds:
  ```bash
  curl -X PATCH http://localhost:3000/shipments/<id>/status \
    -H "Authorization: Bearer <accessToken>" \
    -H "Content-Type: application/json" \
    -d '{"status": "QUOTED"}'
  ```
  Returns the updated shipment with the new status.
- [ ] An invalid transition (e.g. `CREATED` straight to `DELIVERED`) returns
  `409 Conflict`, not a silent write.
- [ ] Moving into `ASSIGNED`, `PICKED_UP`, `DELIVERED`, or `COMPLETED` stamps
  the matching timestamp column (`assigned_at`, `picked_up_at`, etc.).
- [ ] `COMPLETED` and `CANCELLED` are terminal — any further transition
  attempt from either also returns `409`.

The full transition map lives in `shipment-status.transitions.ts`, kept
separate from the service so a future assignment/matching service can reuse
`isValidShipmentStatusTransition` without depending on `ShipmentsService`.

## Definition of "done" — Piece 4: Auth

- [ ] `npm run db:migrate` creates the `users` and `user_roles` tables
- [ ] Register works:
  ```bash
  curl -X POST http://localhost:3000/auth/register \
    -H "Content-Type: application/json" \
    -d '{
      "phone": "+255712345678",
      "email": "seeker@example.com",
      "password": "Str0ng!Pass",
      "fullName": "Asha Mwakalinga",
      "role": "CUSTOMER"
    }'
  ```
  Returns `{ accessToken, refreshToken, user: { id, phone, ... } }`.
- [ ] A weak password (no uppercase, no digit, etc.) is rejected with 400.
- [ ] Registering the same phone twice returns `409 Conflict`.
- [ ] Login works with the same phone/password and returns fresh tokens.
- [ ] Wrong password (or unknown phone) returns `401` with the same
  generic message either way — doesn't leak which one was wrong.
- [ ] `GET /auth/me` with `Authorization: Bearer <accessToken>` returns the
  current user; with no header, or an expired/garbage token, returns `401`.
- [ ] `POST /auth/refresh` with the `refreshToken` returns a new
  `accessToken` + `refreshToken` pair.
- [ ] `POST /shipments` and `GET /shipments` now require a valid bearer
  token — `customerId` comes from the token, not the request.

**Known simplifications:**
- No OTP/SMS verification yet (no Twilio wired up) — registered users land
  straight in `ACTIVE`. Revisit once an SMS provider exists.
- No Google OAuth yet (Foundation 6 in the architecture doc covers the
  flow) — phone + password only for now.
- Logout / "sign out of all devices" isn't implemented — refresh tokens
  aren't persisted anywhere to revoke, so a still-valid one can't be killed
  early. Needs a `refresh_tokens` table (or Redis) before that's real.
- `ADMIN` / `SUPER_ADMIN` can't be self-assigned through `/auth/register`
  (only `CUSTOMER`, `RIDER`, `BUSINESS` can) — granting admin is an
  out-of-band step by design. **A seed script now exists for this** —
  see `npm run db:seed:admin` below instead of the manual SQL this note
  used to point to.

## Definition of "done" — Piece 5: Riders

- [ ] `npm run db:migrate` creates the `riders` table and adds the
  `fk_shipments_rider` foreign key to `shipments.rider_id`
- [ ] A user with the `RIDER` role can onboard:
  ```bash
  curl -X POST http://localhost:3000/riders \
    -H "Authorization: Bearer <riderAccessToken>" \
    -H "Content-Type: application/json" \
    -d '{
      "vehicleType": "bodaboda",
      "vehicleRegistration": "T123ABC",
      "licenseNumber": "DL-998877"
    }'
  ```
  Returns the new rider profile with `status: "ONBOARDING"`, `isOnline: false`.
- [ ] Onboarding twice with the same account returns `409 Conflict`.
- [ ] A `CUSTOMER`-role token gets `403 Forbidden` on any `/riders` route.
- [ ] `GET /riders/me` returns the caller's own profile.
- [ ] `POST /riders/availability/online` on a still-`ONBOARDING` rider
  returns `403` — can't go online before verification.
- [ ] An admin verifies the rider:
  ```bash
  curl -X PATCH http://localhost:3000/riders/<riderId>/verify \
    -H "Authorization: Bearer <adminAccessToken>"
  ```
  Sets `status: "ACTIVE"` and stamps `documentsVerifiedAt`.
- [ ] `POST /riders/availability/online` now succeeds (`isOnline: true`);
  `POST /riders/availability/offline` always succeeds regardless of status.

**Known simplifications:**
- No document upload/review flow — `PATCH /riders/:id/verify` just flips
  the status; there's nothing yet for an admin to actually *look at*
  before verifying. Flagged with a `TODO` in `riders.service.ts`.
- Nothing seeds an `ADMIN` user, so testing the `/verify` route requires
  manually promoting a user to `ADMIN` in the database first (see the
  "Known simplifications" note on Piece 4 — admin grants are out-of-band
  for now).

## Definition of "done" — Piece 6: Assignment

- [ ] With a shipment sitting in `ASSIGNMENT_PENDING`
  (`PATCH /shipments/:id/status` through `CREATED` → `QUOTED` →
  `CONFIRMED` → `ASSIGNMENT_PENDING` first) and a `RIDER`-role account
  that's been onboarded, verified (`PATCH /riders/:id/verify`), and set
  online (`POST /riders/availability/online`):
  ```bash
  curl -X POST http://localhost:3000/shipments/<id>/assign \
    -H "Authorization: Bearer <riderAccessToken>"
  ```
  Returns the shipment with `status: "ASSIGNED"`, `riderId` set, and
  `assignedAt` stamped.
- [ ] The same call from a rider who is `ONBOARDING` or offline returns
  `403 Forbidden`.
- [ ] Calling assign again on the same shipment (already `ASSIGNED`)
  returns `409 Conflict`.
- [ ] Calling assign on a shipment still in `CREATED` (not yet
  `ASSIGNMENT_PENDING`) returns `409 Conflict`.
- [ ] `PATCH /shipments/:id/status` with `{"status": "ASSIGNED"}` is
  rejected with `409` — assignment only happens through the dedicated
  endpoint, since it has to set `riderId` atomically in the same write.
- [ ] Ownership is enforced: a `CUSTOMER` who doesn't own the shipment
  gets `403` on `GET /shipments/:id`; once assigned, the assigned rider
  can read/patch it too; an `ADMIN` can always read/patch any shipment.

**Known simplifications:**
- Assignment is rider self-claim only ("first online, verified rider to
  call it wins") — there's no dispatcher/admin override
  (`POST /shipments/:id/assign { riderId }` by an admin) and no actual
  matching algorithm (nearest rider, rating, etc.) — that's the
  `matching-service` / Matching Engine described in
  `WAZZAR_SYSTEM_ARCHITECTURE.md`, well beyond Phase 1 skeleton scope.
- No un-assign / reassign path if a rider accepts and then can't do the
  job — falls back to `CANCELLED` (still a valid transition from
  `ASSIGNED`) rather than releasing the shipment back to the pool.

## Definition of "done" — Piece 6.5: Status history

- [ ] `npm run db:migrate` creates the `shipment_statuses` table with a
  cascading FK to `shipments`
- [ ] Creating a shipment writes one `CREATED` history row automatically
- [ ] A valid `PATCH /shipments/:id/status` call writes a matching history
  row, with `changed_by` set to the caller's user id and `reason` set if
  one was passed in the request body
- [ ] `POST /shipments/:id/assign` writes an `ASSIGNED` history row
  attributed to the claiming rider's user id
- [ ] An invalid transition (rejected with `409`) writes nothing to history
- [ ] `GET /shipments/:id/history` returns rows oldest-first, and enforces
  the same access rule as `GET /shipments/:id` (403 for anyone who isn't
  the owning customer, the assigned rider, or an admin)

**Known simplifications:**
- `changed_by` is always the acting user's id from the bearer token —
  there's no separate "system" actor concept yet, so anything not driven
  by a request (there isn't anything like that yet) would have no clean
  way to attribute a row.

## Definition of "done" — Piece 7: Live Tracking

- [ ] `npm run db:migrate` creates the `rider_locations` table (PK on
  `rider_id`, FK to `riders`, `ON DELETE CASCADE`)
- [ ] `npm install` pulls in `@nestjs/websockets`, `@nestjs/platform-socket.io`,
  and `socket.io`
- [ ] An online, verified rider can ping their location:
  ```bash
  curl -X POST http://localhost:3000/rider/location \
    -H "Authorization: Bearer <riderAccessToken>" \
    -H "Content-Type: application/json" \
    -d '{"latitude": -6.792, "longitude": 39.208, "accuracyMeters": 12}'
  ```
  Returns the upserted `rider_locations` row. A second ping updates the
  same row in place (one row per rider, not a history table).
- [ ] An **offline** rider gets `403 Forbidden` pinging `/rider/location` —
  mirrors the same "must be online" rule `POST /shipments/:id/assign` uses.
- [ ] `GET /shipments/:id/tracking` returns `{ shipmentId, status,
  riderLocation, pickupLocation, dropoffLocation, etaSeconds, lastUpdated
  }` — `riderLocation`/`etaSeconds`/`lastUpdated` are `null` until the
  assigned rider has sent at least one location ping.
- [ ] Same access rule as `GET /shipments/:id`: owning customer, assigned
  rider, or admin only — anyone else gets `403`.
- [ ] WebSocket: connect to the `/tracking` namespace with a bearer token
  (`auth: { token }` on connect, or a `?token=` query param), then emit
  `subscribe` with `{ shipmentId }`. A client with no/invalid token is
  disconnected immediately; a client without access to that shipment gets
  an `error` event instead of joining the room.
- [ ] On a successful `subscribe`, the server immediately emits one
  `tracking:update` snapshot (so the client isn't stuck waiting for the
  rider's next ping), then a fresh `tracking:update` on every subsequent
  `POST /rider/location` from the assigned rider, for as long as the
  shipment is in `ASSIGNED`, `PICKUP_IN_PROGRESS`, `PICKED_UP`,
  `IN_TRANSIT`, or `OUT_FOR_DELIVERY`.
- [ ] `etaSeconds` targets the pickup location before the rider has picked
  up, and the dropoff location from `PICKED_UP` onward.

**Known simplifications:**
- `etaSeconds` is a straight-line (haversine) distance divided by a flat
  assumed average speed — not a real routing engine. Foundation 8 in
  `WAZZAR_SYSTEM_ARCHITECTURE.md` calls for Google Directions/Distance
  Matrix, but there's no Maps API key configured anywhere in this repo
  yet. Fine for showing a plausible, moving ETA; not a delivery guarantee.
- `rider_locations` holds only the *current* position per rider (upserted
  in place), not a `tracking_events` history/audit trail — that's a
  Phase 2 table in the architecture doc, alongside the other tracking
  channels (`LATRA_TRACKING`, `PARTNER_SCAN`, `SMS_WEBHOOK`,
  `DISPATCHER_MANUAL`). This piece only implements `GPS_LIVE`.
- A rider's location row isn't deleted when they go offline or a
  shipment completes — the architecture doc's Location Privacy section
  ("live location not stored long-term") wants that, but wiring it into
  `RidersService.setOffline` / the shipment-completion path touches two
  other modules and felt like scope creep for this piece. Flagged here,
  not forgotten.
- No Redis. The architecture doc describes caching `rider:{rider_id}:location`
  in Redis for the polling path; this repo doesn't have Redis
  provisioned anywhere yet (no `REDIS_URL` in `.env.example`,  no
  redis service in `docker-compose.yml`), so Postgres is the only store
  and the WebSocket broadcast is in-process (Socket.IO's default
  in-memory adapter). Works correctly for a single backend instance;
  running more than one instance behind a load balancer would need a
  Redis (or similar) Socket.IO adapter so a broadcast on instance A
  reaches a socket connected to instance B. Not a concern until this is
  actually deployed with more than one backend process.
- No rate limiting on `POST /rider/location` — a misbehaving or malicious
  client could hammer it. Fine for now; worth a look before this is
  public.
- The WebSocket auth check only runs once, at connect time. A token that
  expires mid-connection doesn't force a disconnect — the socket stays
  open until the client closes it or the server restarts. `subscribe`/
  `unsubscribe` calls after expiry still use the stale `client.data.user`
  payload from connect time.

## Definition of "done" — Piece 6: Dispatcher/Admin Role Refinement (Phase 2 Prep)

*This was flagged in Piece 6 as a missing piece; implemented in parallel with Pieces 7–13.*

- [ ] `npm run db:migrate` adds `DISPATCHER` to the `user_roles_role_enum`
  (migration `1787280000000`)
- [ ] `DISPATCHER` role exists in the `Role` enum (user-role.entity.ts)
- [ ] `DISPATCHER` is excluded from public `/auth/register` (`SELF_SIGNUP_ROLES`)
  — it's admin-granted only, like `ADMIN` and `SUPER_ADMIN`
- [ ] All `/dispatch/*` endpoints now accept `DISPATCHER` role in addition
  to `ADMIN` and `SUPER_ADMIN`
- [ ] Audit trail (shipment history) records which role initiated dispatch
  actions (via `changedBy`)
- [ ] To grant `DISPATCHER` to a user (out-of-band): either seed a script
  or manually:
  ```sql
  INSERT INTO user_roles (user_id, role)
  VALUES ('uuid-of-existing-user', 'DISPATCHER');
  ```

**Rationale (Phase 2):** Intercity/trunk operations need dispatch as a separate
concern from general admin duties. A `DISPATCHER` role lets ops teams manage
shipment assignment without access to user management, pricing, config changes,
etc. Enables fine-grained audit trails and billing per dispatcher.

**Known simplifications:**
- `GET /dispatch/queue` has no pagination — fine at MVP scale.
- DISPATCHER cannot access other admin surfaces (no intentional boundary
  enforcement yet — relies on API design, not row-level DB restrictions).

## Definition of "done" — Piece 8: Dispatch (dispatcher/admin override)

- [ ] `GET /dispatch/queue` (admin/super_admin/dispatcher) returns every
  `ASSIGNMENT_PENDING` shipment, oldest first, and every `ACTIVE` +
  online rider
- [ ] `GET /dispatch/shipments/:id/candidates` 409s if the shipment isn't
  `ASSIGNMENT_PENDING`; otherwise returns the online/active rider pool,
  ranked (see Piece 10 below for how ranking actually works now)
- [ ] `POST /dispatch/shipments/:id/assign { riderId, reason? }` lets a
  dispatcher/admin claim a specific rider for a shipment — same race-safe
  conditional UPDATE as the rider self-claim path
  (`POST /shipments/:id/assign`), so an admin and a self-claiming rider
  can't both win
- [ ] `POST /dispatch/shipments/:id/auto-assign { reason? }` picks the
  top-ranked candidate and assigns it the same way
- [ ] Every dispatch endpoint is `ADMIN`/`SUPER_ADMIN`/`DISPATCHER` — role
  refinement complete (Piece 6 above)

## Definition of "done" — Piece 9: Proof of Delivery

- [ ] `npm run db:migrate` creates the `proof_of_delivery` table (PK on
  `shipment_id`, FK to `shipments`, `ON DELETE CASCADE`)
- [ ] The rider assigned to a shipment that's `OUT_FOR_DELIVERY` can
  confirm delivery:
  ```bash
  curl -X POST http://localhost:3000/shipments/<id>/deliver \
    -H "Authorization: Bearer <riderAccessToken>" \
    -H "Content-Type: application/json" \
    -d '{"recipientName": "Asha M.", "photoUrl": "https://example.com/pod.jpg"}'
  ```
  Returns the shipment with `status: "DELIVERED"` and `deliveredAt` stamped.
- [ ] A rider who isn't the one assigned to the shipment gets `403`
- [ ] Calling it on a shipment that isn't `OUT_FOR_DELIVERY` gets `409`
- [ ] `PATCH /shipments/:id/status` with `{"status": "DELIVERED"}` is
  rejected with `409` — same reasoning as `ASSIGNED` being carved out
  for `POST /shipments/:id/assign`
- [ ] `GET /shipments/:id/proof-of-delivery` returns the submitted proof
  — same access rule as `GET /shipments/:id` (owning customer, assigned
  rider, or admin); `404` if delivery hasn't been confirmed yet

**Known simplifications:**
- No upload endpoint behind `photoUrl` — it's a plain validated-URL
  string field, not a pre-signed-S3 flow. Same gap that made tracking's
  ETA a straight-line estimate: no AWS credentials configured anywhere
  in this repo yet. A client needs its own hosted image to pass in.
- Only the assigned rider can submit proof — no admin override if a
  rider can't complete the confirmation themselves (lost phone, app
  crash, etc.).
- One proof per shipment, not appendable/correctable after the fact.

## Definition of "done" — Piece 10: Distance-based dispatch ranking

- [ ] `GET /dispatch/shipments/:id/candidates` ranks riders with a
  `rider_locations` ping less than 5 minutes old by straight-line
  distance to the shipment's pickup point, nearest first
- [ ] Riders with no ping, or one older than 5 minutes, are ranked among
  themselves by the original rating/seniority heuristic (highest rating
  first, then most-rated, then longest-tenured) and listed **after**
  every located rider — an unknown distance never outranks a known one
- [ ] `POST /dispatch/shipments/:id/auto-assign` picks whoever now ends
  up first in that ordering (no logic change there — it already just
  takes `candidates[0]`)

**Known simplifications:**
- Same straight-line-distance caveat as `tracking/eta.util.ts`'s ETA —
  haversine to the pickup point, not a real routing distance. Good
  enough for "who to offer this to first", not turn-by-turn accurate.
- The 5-minute "recent ping" threshold is a guess, not a measured value
  — there's no telemetry yet on real-world ping cadence to tune it
  against.
- Ranks against the pickup point only. A shipment where the assigned
  rider is mid-route on something else isn't modeled — this is a v1
  "who's physically closest right now" heuristic, not a route-aware
  matching engine.

## Next piece

Dispatch (Piece 8), Proof of Delivery (Piece 9), and distance-based
dispatch ranking (Piece 10) are done — see the sections above.

## Definition of "done" — Piece 11: Pricing & Payments

- `POST /pricing/calculate` (public) returns a full price breakdown —
  base + billable distance + billable weight, surge multiplier applied
  only inside a configured hour window, min/max clamps, and a
  commission/rider-payout split that always reconciles exactly to the
  total (the rider gets the remainder rather than its own rounded
  percentage, so double-rounding never drops a cent).
- `PricingConfig` is time-versioned (`effective_from`/`effective_to`),
  so a shipment quoted weeks ago can still be repriced against the
  config that was actually active then. Only one config is `isActive`
  at a time in this Phase 1 model — creating a new one via
  `POST /pricing/configs` (admin only) closes out whatever was active
  before it.
- `POST /payments/initiate` (MPESA/STRIPE/CASH) validates the caller
  owns the shipment, the shipment has been priced, and no payment is
  already open for it, then dispatches to a provider — or, for CASH,
  marks the payment `PENDING_CASH_COLLECTION` directly with no provider
  call.
- `POST /payments/webhooks/{mpesa,stripe}` update payment status
  idempotently — a retried callback for an already-terminal payment
  (`COMPLETED`/`FAILED`) is a safe no-op, so a provider's at-least-once
  delivery can't double-process a payment.
- `POST /payments/:id/refund` (full or partial, owning customer or
  admin), `GET /payments/history`, `GET /payments/reconcile/:date`
  (admin, daily totals by method).
- `ShipmentsService.create()` now computes a quote itself —
  `PricingService.calculatePrice()` is called with the haversine
  distance between `pickupLocation`/`dropoffLocation` (same util
  `tracking`/`dispatch` already use) and `packageWeightKg`, before the
  shipment is inserted. The shipment lands in the DB already `QUOTED`
  with `price`/`commission`/`riderPayout` set — `CREATED` is still
  recorded as a first status-history row (the state machine's
  `CREATED -> QUOTED` transition still happened, just atomically within
  one API call rather than as two separate customer actions) followed
  by a `QUOTED` row. If pricing fails (most likely: no active
  `PricingConfig` covers right now), the whole call throws and nothing
  is written — no orphaned shipment stuck at `CREATED` with a null price.

### Known simplifications (Piece 11)

- **M-Pesa and Stripe are mocked.** `MpesaProvider`/`StripeProvider`
  return fake transaction IDs instead of calling the real Daraja/Stripe
  APIs. The swap-in code for both is commented inline in each provider
  file — this is a deliberate placeholder, not an oversight.
- **Webhook signature verification is skipped when no secret is
  configured** (`MPESA_WEBHOOK_SECRET`/`STRIPE_WEBHOOK_SECRET` in
  `.env`) — fine for local/sandbox work, but this must be set before
  any production deploy. It also verifies against the parsed/whitelisted
  body, not raw request bytes — a real production check (especially for
  Stripe's actual `timestamp.payload` scheme) needs a raw-body
  middleware ahead of the JSON parser.
- ~~**No transaction wraps the pricing call and the insert.**~~ Closed
  — see Piece 14 below.
- ~~**Payment completion doesn't drive shipment status.**~~ Closed — see
  Piece 12 below.
- ~~**A fresh database has no `PricingConfig` row, so every quote/create
  call throws.**~~ Closed — `npm run db:seed:pricing` seeds one active
  config with workable defaults (see "Seeding an initial pricing
  config" below), same idea as `db:seed:admin` for the first admin
  account.

## Definition of "done" — Piece 12: Payment completion confirms the shipment

- `ShipmentsService.confirmAfterPayment(shipmentId)` moves a shipment
  `QUOTED -> CONFIRMED` and writes a status-history row (`changedBy:
  null`, `reason: 'Payment completed'`) since the transition is driven
  by a provider webhook, not a logged-in user. It goes through
  `isValidShipmentStatusTransition` like every other transition — no
  separate write path.
- `PaymentsService.handleMpesaCallback`/`handleStripeCallback` call it
  once a payment lands `COMPLETED` (`payload.success` for M-Pesa,
  `payment_intent.succeeded` for Stripe) — after the payment itself is
  saved, so a shipment-side failure can't leave the payment stuck
  mid-write.
- `ShipmentsModule` now exports `ShipmentsService` and `PaymentsModule`
  imports `ShipmentsModule` to call it. No cycle: `ShipmentsModule`
  doesn't depend on `PaymentsModule`.
- Deliberately tolerant, not throwing: if the shipment is already past
  `QUOTED` (already `CONFIRMED`, or `CANCELLED`) by the time the
  callback arrives, `confirmAfterPayment` is a silent no-op rather than
  raising — a webhook shouldn't come back as an error to the payment
  provider just because the shipment side has nothing to do. Combined
  with the existing payment-level idempotency check (an already-
  `COMPLETED`/`FAILED` payment short-circuits before this is ever
  called), a retried callback can't double-write history either.

### Known simplifications (Piece 12)

- ~~**Cash payments never reach this path.**~~ Closed — see Piece 13.
- ~~Still no DB transaction wrapping the payment save and the shipment
  update~~ Closed — see Piece 13.

## Definition of "done" — Piece 13: Transactional writes + cash collection

- **Transaction around payment completion.** `PaymentsService` now
  injects `DataSource` (`@InjectDataSource()`, same pattern
  `health.controller.ts` already used) and wraps the payment save plus
  the shipment confirmation in one `dataSource.transaction(...)` call,
  in `handleMpesaCallback`, `handleStripeCallback`, and the new
  `confirmCashCollection` below. First `dataSource.transaction()` call
  in this codebase — the rest still doesn't use one (e.g.
  `ShipmentsService.create()`'s pricing call + insert, noted in Piece
  11), so this is scoped to the one path that was explicitly flagged,
  not a sweep.
- `ShipmentsService.confirmAfterPayment(shipmentId, manager?)` now
  takes an optional `EntityManager`. When PaymentsService is inside a
  transaction it passes its manager through, so the shipment
  save + status-history row are part of the same DB transaction as the
  payment save — commit or rollback together. Without a manager (called
  standalone, or from existing unit tests) it falls back to its own
  injected repos, unchanged from Piece 12.
- **`POST /payments/:id/collect-cash`** — the rider assigned to the
  shipment, or an admin, confirms a `CASH` payment was physically
  collected. No request body; the caller identity comes from the JWT.
  - Validates the payment is `CASH` (`ConflictException` otherwise) and
    `PENDING_CASH_COLLECTION` — idempotent like the webhooks: already
    `COMPLETED` is a no-op returning the payment as-is; any other
    status (`FAILED`, `REFUNDED`, ...) is a genuine conflict.
  - Authorization goes through `ShipmentsService.isAssignedRiderOrAdmin`
    — deliberately narrower than the general shipment-access rule (no
    customer access): confirming cash was physically collected isn't
    something the paying customer attests to.
  - Marks the payment `COMPLETED`, records who collected it in the
    existing `metadata` jsonb column (`cashCollectedBy`, no migration
    needed), and runs `confirmAfterPayment` in the same transaction as
    everything above.

### Known simplifications (Piece 13)

- The transaction wrapping is scoped to payment-completion only (the
  three call sites above). `ShipmentsService.create()`'s pricing call +
  insert was the other flagged gap — closed in Piece 14 below.
- No endpoint to *initiate* a cash-collection reminder or nudge a rider
  — `collect-cash` only confirms one that's already
  `PENDING_CASH_COLLECTION` (created via the existing
  `POST /payments/initiate` with `method: CASH`).

## Definition of "done" — Piece 14: Shipment creation transaction wrapping

- `ShipmentsService` now injects `DataSource` (`@InjectDataSource()`,
  same pattern `PaymentsService` uses since Piece 13) and wraps
  `create()`'s shipment insert plus both status-history rows
  (`CREATED`, then `QUOTED`) in one `dataSource.transaction(...)` call —
  they commit or roll back together, closing the gap flagged in Piece
  11 and 13.
- The `PricingService.calculatePrice()` call stays **outside** the
  transaction: it's a read against `PricingConfig`, not a write that
  needs to roll back with anything, so there's nothing gained by
  including it and every extra statement inside a transaction holds a
  connection open longer.
- `recordStatusHistory(shipmentId, status, changedBy, reason, manager?)`
  now takes the same optional `EntityManager` parameter
  `confirmAfterPayment` already does — inside the transaction it uses
  `manager.getRepository(ShipmentStatusHistory)`; called without one
  (existing call sites like `updateStatus`, `assign`) it falls back to
  the injected repo, unchanged.
- No behavior change for callers: same inputs, same return value, same
  thrown exceptions when pricing fails. The only difference is that a
  crash between the shipment insert and the history writes can no
  longer leave a shipment stuck without its `CREATED`/`QUOTED` audit
  trail.

### Known simplifications (Piece 14)

- Only `create()` is wrapped. Other multi-statement paths elsewhere in
  the service (`updateStatus`, `assign`) still do sequential awaits
  against the service's own repos — they weren't flagged as a gap and
  are out of scope for this pass.

## Next piece

**Piece 6 (Dispatcher/Admin Role Refinement) and Piece 14 (shipment
creation transaction wrapping) are complete, and — updated 2026-08-22,
after merging a second backend build — so is a good deal more:**

- All four frontend apps (customer, admin, business, rider) are wired to
  this backend — no app is still on static mock data end-to-end (see
  `docs/delivery-notes/README_BUSINESS_RIDER_MERGE.md` and
  `docs/delivery-notes/TEST_RUN_AND_NEXT_STEPS.md`).
- New backend modules: `business-customers` (a business's own saved-
  recipient address book), `business-staff` (a roster, not a real login
  system), `geocoding` (live OpenStreetMap Nominatim address search),
  `uploads` (local-disk file storage for rider docs and proof-of-delivery
  photos).
- Rider document uploads (`AddRiderDocumentUrls` migration) and a
  shipment-level rider rating (`AddShipmentRiderRating` migration,
  `POST /shipments/:id/rate-rider`).
- Security hardening: rate limiting (`@nestjs/throttler`), `helmet()`,
  CORS locked to an explicit origin list in production, real HMAC
  webhook signature verification, and a boot-time config safety check
  (`security-checks.ts`) that refuses to start in production with unsafe
  defaults.
- Payments now has real Stripe/M-Pesa credential paths — see
  `docs/delivery-notes/PAYMENTS_GOING_LIVE.md` — but both providers still
  default to their mock/fake-data path until real credentials are set.
- A Dockerfile, `docker-compose.yml` backend service, and a CI workflow
  (`.github/workflows/ci.yml`) now exist for the backend.

**Updated again 2026-08-22 (later the same day), after a third merge:**

- New `scheduled-deliveries` module — recurring/scheduled deliveries,
  backed by a real background job (`@nestjs/schedule`'s `@Cron`, see
  `scheduled-deliveries.cron.ts`) that creates a real `Shipment` when a
  schedule's `next_run_at` comes due, not just CRUD.
- **Real bug fix:** `MpesaWebhookDto` previously expected a flattened
  `{transactionId, success, amount}` payload that does not match what
  Safaricom's Daraja API actually sends — a real M-Pesa payment would
  never have confirmed correctly. Fixed to the real nested
  `Body.stkCallback.{...}` shape, with a dedicated parsing util
  (`mpesa-callback.util.ts`) and tests built from Safaricom's own
  published sandbox payload.
- **Verified for real, later the same day (2026-08-22):** `npm install`
  and `npm test` were actually run this time — 191 tests across 15
  suites pass, including both of the above (`mpesa-callback.util.spec.ts`
  and both scheduled-deliveries specs). See
  `docs/delivery-notes/VERIFICATION_2026-08-22.md`. That pass found and
  fixed a separate, serious bug in the business frontend app (an
  unterminated comment silently deleting 83 lines of real code,
  including its entire sidebar nav) — not in this backend, but caught
  by the same "actually run it" discipline.
  section before trusting either in production.

See `docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md` for what's still
open. Phase 2 pieces (intercity/trunk, Latra tracking, SMS notifications) —
see `WAZZAR_Unified_Model_Updated.md` for roadmap.
