# Payments backend — what was added

Built against `wazzar-backend-merged.zip`. The uploaded `PAYMENTS_*` docs
described a payments/pricing system that was fully planned but never
implemented — this adds the real modules, matching the existing codebase's
conventions (decimal columns as strings, raw-SQL migrations, JwtAuthGuard +
RolesGuard + @Roles, owner-or-admin access checks, mocked-repo Jest specs).

No new dependencies — everything is built on what's already in package.json
(`@nestjs/config`, `class-validator`, `typeorm`, node's built-in `crypto`
for webhook HMAC verification). Money math uses integer cents
(`src/common/money.ts`) rather than adding `decimal.js`, since TZS has no
sub-cent pricing.

## New: Pricing module (`src/modules/pricing/`)

- `PricingConfig` entity + migration `1787260000001` — time-versioned
  pricing rule (base + per-km + per-kg + surge windows + commission split),
  seeded with the Phase 1 numbers from PAYMENTS_PRICING_SUMMARY.md.
- `PricingService.calculatePrice()` — base + distance + weight, surge
  multiplier applied only inside configured hour windows, min/max clamps,
  commission/rider-payout split that always reconciles exactly to the
  total (rider gets the remainder, not its own rounded %, so no cent goes
  missing to double-rounding).
- `PricingController`:
  - `POST /pricing/calculate` — public, returns a full price breakdown
  - `GET /pricing/active` — public, the config in effect right now
  - `GET /pricing/configs`, `POST /pricing/configs`, `PUT /pricing/configs/:id`
    — admin/super-admin only. Creating a new config auto-deactivates
    whatever was active before it.
- `pricing.service.spec.ts` — reproduces the worked example from
  PAYMENTS_IMPLEMENTATION_GUIDE.md plus surge/clamp/split edge cases.

## New: Payments module (`src/modules/payments/`)

- `Payment` entity + migration `1787260000002` — FKs to `shipments` and
  `users`, unique `external_id` for provider transaction lookups.
- `PaymentsService`:
  - `initiatePayment` — validates the caller owns the shipment, the
    shipment has been priced, and no payment is already open for it;
    dispatches to a mock M-Pesa/Stripe provider or marks CASH as
    `PENDING_CASH_COLLECTION` directly.
  - `refund` — full (omit `amount`) or partial refund, capped at the
    remaining unrefunded balance.
  - `handleMpesaCallback` / `handleStripeCallback` — idempotent (a retried
    webhook for an already-terminal payment is a safe no-op), verified via
    HMAC signature (see caveat below).
  - `reconcile` — daily totals by payment method for finance.
- `MpesaProvider` / `StripeProvider` — clearly marked mocks with the exact
  swap-in code (Daraja STK Push / Stripe PaymentIntents) commented inline,
  matching PAYMENTS_IMPLEMENTATION_GUIDE.md's integration steps.
- `PaymentsController` — `/payments/initiate`, `/:id/status`, `/history`,
  `/:id/refund`, `/reconcile/:date` (admin), plus `/webhooks/mpesa` and
  `/webhooks/stripe` (no JWT — providers can't send bearer tokens; the
  signature header authenticates instead).
- `payments.service.spec.ts` — covers ownership checks, the CASH/MPESA/
  STRIPE initiate paths, provider-failure handling, refund math, webhook
  idempotency, and reconciliation aggregation.

## Known limitations (carried over from the docs, now concretely flagged in code)

- **Providers are mocked.** `MpesaProvider`/`StripeProvider` return fake
  transaction IDs instead of calling real APIs. Swap per the inline TODOs
  once credentials exist.
- **Webhook signature verification is skipped when no secret is
  configured** (`MPESA_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET` in
  `.env`) — fine for local/sandbox work, but this must not ship to
  production unset. Also: verification runs on the parsed/whitelisted
  request body, not raw bytes — a true production-grade check (especially
  for Stripe's real `timestamp.payload` scheme) needs a raw-body
  middleware ahead of the JSON parser.
- **Not wired into shipment creation.** `Shipment.price` is still set by
  hand today (`ShipmentsService.create` doesn't call `PricingService`).
  I left this alone deliberately — wiring it up touches
  `shipments.service.spec.ts`, which I didn't want to modify without being
  able to run the suite here. Straightforward next step: inject
  `PricingService` into `ShipmentsModule`, compute distance from
  pickup/dropoff coordinates, and call `calculatePrice()` in `create()`.

## Verification note

No network access in this environment, so I couldn't `npm install` and run
the real test suite. I did run a manual `tsc --noEmit` type-check against
every new file (filtering out only the expected "module not found" noise
from missing `node_modules`) and a scripted unused-import scan — both
clean. Please run the following before merging:

```bash
npm install
npm test
npm run build
```

---

## Merge note (this pass)

Merged the payments/pricing modules above into `wazzar-backend-with-dispatch-ranking.zip`
(Pieces 8–10: Dispatch, Proof of Delivery, distance-based ranking, plus live
Tracking from an earlier piece). That upload had evolved `shipments.service.ts`,
`shipments.controller.ts`, `rider.entity.ts`, `package.json`, and `app.module.ts`
since the version payments/pricing was originally built against — all changes
were additive (new POD endpoints, dispatch/tracking wiring) and didn't touch
anything payments/pricing depends on (`shipment.customerId`, `shipment.price`
were unchanged). No conflicts:

- No route prefix collisions (`/payments`, `/pricing` vs. `/dispatch`,
  `/shipments`, and the un-prefixed `tracking.controller.ts` routes).
- No migration timestamp collisions — pricing/payments migrations
  (`1787260000001`, `1787260000002`) sort after the latest existing one
  (`1787200000000`).
- No new dependencies needed on top of what `dispatch`/`tracking` already
  added (`socket.io`, `@nestjs/websockets`) — payments/pricing only use
  packages already present.
- `app.module.ts` and `.env.example` merged by hand (both trivial, no
  overlapping lines).

README updated with a "Piece 11: Pricing & Payments" section documenting
this and its known simplifications, matching the doc style already used
for Pieces 1–10.

Verification here is still: manual `tsc --noEmit` per new/touched file
(clean) and a scripted unused-import scan (clean) — no `npm install`
available in this environment. Run `npm install && npm test && npm run build`
before merging.

---

## This pass: pricing wired into shipment creation

`ShipmentsService.create()` now calls `PricingService.calculatePrice()`
before inserting the shipment — distance comes from the existing
`haversineDistanceMeters()` util in `tracking/eta.util.ts` (same one
`dispatch` already reuses for candidate ranking), weight from
`packageWeightKg`. The shipment is inserted already `QUOTED` with
`price`/`commission`/`riderPayout` set, with two status-history rows
written (`CREATED` then `QUOTED`) so the audit trail still reflects the
state machine's transition even though it now happens within one API call.

If pricing fails (no active `PricingConfig` for right now, the most
likely case), `create()` throws before anything is written — no
orphaned `CREATED` shipment with a null price.

Changes:
- `ShipmentsModule` now imports `PricingModule` (not
  `TypeOrmModule.forFeature`, since only `PricingService.calculatePrice()`
  is needed, no direct repo access).
- `ShipmentsService` constructor takes `PricingService`; `create()`
  rewritten as above.
- `shipments.service.spec.ts` updated: added a `PricingService` mock,
  rewrote the `create` test block (now asserts `QUOTED` status + price
  fields, the two-row history write, the distance/weight passed to
  `calculatePrice`, and that a pricing failure leaves nothing written).

Known gap intentionally left open, documented in the README: no DB
transaction wraps the pricing call and the insert (matches this
codebase's existing style — no transactions used anywhere yet). Payment
completion still doesn't auto-advance a shipment to `CONFIRMED` — that's
the one remaining piece flagged in the README's "Next piece".

Verification: same as before — manual `tsc --noEmit` on every
touched/new file (clean, only pre-existing `Cannot find module` noise
from missing `node_modules` filtered out) and a scripted unused-import
scan (clean). Still no `npm install` available in this environment —
please run `npm install && npm test && npm run build` and send me
anything that breaks.

---

## This pass: admin seed script (`db:seed:admin`)

Added `src/database/seeds/seed-admin.ts` and a matching `db:seed:admin`
npm script. Replaces the manual `INSERT INTO user_roles ...` that
Piece 4's README and the admin app's `README_ADMIN_WIRING.md` both
previously pointed to as the only way to bootstrap the first admin
account.

The script:
- Reads `SEED_ADMIN_PHONE`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_FULL_NAME`
  (optional), `SEED_ADMIN_ROLE` (optional, `ADMIN`/`SUPER_ADMIN`) from
  env vars — nothing hardcoded.
- Validates the password against the same policy `RegisterDto` enforces
  (min 8 chars, upper/lower/number/special), so a script-created admin
  can't end up with a password the normal login flow would never have
  accepted in the first place.
- Hashes with the same `bcrypt`/`BCRYPT_SALT_ROUNDS = 10` as
  `auth.service.ts`.
- Is idempotent: re-running with the same phone number does not create a
  duplicate `users` row or a duplicate `user_roles` row — it finds the
  existing user and only adds the role if missing, otherwise no-ops with
  a message saying so. Safe to run repeatedly against a database that
  already has data.
- Runs outside the Nest DI context (plain `DataSource` + repositories,
  same `dataSourceOptions` the TypeORM CLI already uses from
  `data-source.ts`) rather than importing `AuthModule`, to avoid pulling
  in `JwtService` and other providers the script doesn't need.

Both `README.md` (new "Seeding the first admin account" section, plus an
update to the Piece 4 "Known simplifications" note) and the admin app's
`README_ADMIN_WIRING.md` were updated to point here instead of the old
manual-SQL instructions.

No new dependencies — `ts-node` and `bcrypt` were already present.

Verification: same constraint as every other pass in this file — no
`npm install` available in this environment, so this hasn't been run
against a live database. Manual `tsc --noEmit` on the new file is clean.
Please run `SEED_ADMIN_PHONE=... SEED_ADMIN_PASSWORD=... npm run
db:seed:admin` against a migrated local database and confirm both the
fresh-user path and the re-run/idempotent path before relying on it.
