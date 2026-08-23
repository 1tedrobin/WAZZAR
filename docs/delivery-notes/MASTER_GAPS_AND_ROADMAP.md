# WAZZAR — Master Gaps & Roadmap

## ⚠️ Not yet done — read this first

Everything below the dated update log is the full history of what
changed and why. This section is the short version: what's genuinely
still missing, as of 2026-08-22, in one place.

**Business app — all 4 originally-mock screens are now wired.**
Customers and Staff were the first two (earlier passes); Scheduled
deliveries and Billing (this pass, 2026-08-22) close out the rest —
see the dated entries below for each. **None of this session's work
(Scheduled deliveries, the M-Pesa fix, or Billing) has been run** —
see the next paragraph and the "Payments" section below for what that
means concretely.

Scheduled deliveries (the most involved of the four) is now built: a
`scheduled_deliveries` table plus a `@nestjs/schedule` cron job that
runs every minute, finds due active schedules, and creates real
shipments through the same `ShipmentsService.create()` every other path
uses. Billing (the last of the four) no longer pretends WAZZAR has a
subscription plan — the fake "Business Growth · TZS 45,000/month" card
is gone, replaced with a real per-delivery payment history sourced from
the existing `GET /payments/history` endpoint (no new backend module
needed — that endpoint was already scoped to the calling account).
**Not yet verified end-to-end** — no `npm install` was possible in the
sandbox this was built in (no network egress beyond what's already
vendored), so this has only been syntax-checked with `esbuild`
file-by-file, not compiled with `tsc`, run through Jest, or exercised
against a real Postgres database. Treat it as carefully written and
pattern-matched to the existing `business-customers`/`business-staff`
modules, not as confirmed working, until someone runs the real check
suite.

**Payments — code is real and ready, mock-provider fallback until real credentials exist:**
- Stripe and M-Pesa both have real integration code (not fake IDs) that
  activates automatically once real credentials are added — but no
  Stripe or Safaricom account exists yet to have actually tested either
  against real sandbox traffic. See
  `docs/delivery-notes/PAYMENTS_GOING_LIVE.md`.
- **Fixed 2026-08-22:** the M-Pesa webhook's expected data shape
  (`MpesaWebhookDto`) previously didn't match what Safaricom's Daraja
  API actually sends (`CallbackMetadata.Item[]`, not flat fields) — a
  real M-Pesa payment would not have confirmed correctly. The DTO and
  `handleMpesaCallback`'s parsing now match Daraja's real, documented
  callback shape (via a new `mpesa-callback.util.ts`), with unit tests
  built from Safaricom's own published sandbox example payload. **Still
  not verified against a real live Daraja callback** — see
  `PAYMENTS_GOING_LIVE.md`'s updated section for exactly what is and
  isn't confirmed.
- M-Pesa refunds are permanently manual by design (not a gap — Daraja
  genuinely has no simple refund API), documented in the same file.

**Infrastructure:**
- **Update, 2026-08-23:** the backend's full check suite now actually
  runs (`npm ci`, `tsc`, `eslint`, `npm test` — 191/191 passing, `npm
  run build`) — none of this had ever been executed before this pass.
  A real `docker build` still hasn't run anywhere (this sandbox has no
  reachable container registry — see the Hardening section's Docker
  update for exactly what was and wasn't possible), but every stage's
  actual commands were run directly and a real bug (bcrypt needs a
  build toolchain on Alpine, missing from both the `deps` and
  `prod-deps` stages) was found and fixed as a result. Confirm with a
  real `docker build` before depending on it for deployment.
- **Update, 2026-08-23:** the backend side of live-GPS tracking (rider
  ping → WebSocket broadcast → subscribed customer) is now confirmed
  against a real running backend + real Postgres — see the Real-time
  tracking section below for the full scripted test. What's still open
  is the *frontend* side against a real phone's actual GPS, which
  needs a real device.
- No frontend app is actually connected to Netlify yet, and no host has
  been chosen for the backend — both are one-time account setups
  described in `docs/delivery-notes/DEPLOYMENT.md`, not code gaps.

**Smaller, lower-priority items** (API docs via Swagger, deeper test
coverage past each app's login screen, a staging/production deploy
split, automated DB migrations in the deploy flow) are listed with full
detail in the dated sections below — nothing else is hidden or
undocumented.

---

Date: 2026-08-21
Status: living document — update this file as items are picked up,
scoped, or closed. Every row below is either something that doesn't
exist yet, or exists but isn't production-grade. Nothing here is
implemented by writing this file; it's the plan, not the work.

> **Update, 2026-08-22 (latest) — Billing (4th and final of the 4
> originally-mock business screens).** Unlike Scheduled deliveries,
> this one needed no new backend module at all — `GET
> /payments/history` already existed and was already scoped
> server-side to the calling account (`PaymentsService.getHistory`), and
> for a business account that account's own payments *are* its real
> per-delivery billing history, since a business is the `customerId` on
> every shipment/payment it creates. The gap was entirely on the
> frontend: `BillingPage` was rendering a fictional monthly-subscription
> invoice list (`MOCK_BUSINESS_INVOICES`) that had nothing to do with
> how WAZZAR actually charges.
>
> Fixed: `BillingPage` now fetches real payment history and renders it
> as what it actually is — one row per real payment against a real
> delivery, with real summary stats computed client-side (paid this
> month, most-used payment method, pending/awaiting count) instead of a
> fabricated plan name and a fabricated masked payment method. The old
> "Business Growth · TZS 45,000/month" card and "M-Pesa Business
> ····4471" are gone; in their place is a plain statement that WAZZAR
> bills per delivery, not as a subscription. The old fake per-row
> "Download PDF" (which only ever worked on fake `Paid` rows) is
> replaced with a real client-side CSV export of the actual fetched
> history — no backend export endpoint exists or was needed for that.
>
> `mockData.js` is now empty (a note explaining why, not deleted
> outright) — Billing was its last real consumer after Customers,
> Scheduled, and Staff were each wired in earlier passes.
>
> While doing this work, a real bug in the M-Pesa fix above was caught
> and fixed in the same pass, not left for later — see the M-Pesa entry
> below for the detail (both apps' demo webhook shims were still
> sending the old flat payload shape the corrected DTO now rejects).
>
> Same caveat as everything else in this session: no `npm install` was
> possible in this sandbox, so this was syntax-checked file-by-file with
> `esbuild` and reviewed by hand, not compiled with `tsc` or run through
> the real test suite (including the business app's existing smoke
> tests, which were not re-run).

> **Update, 2026-08-22 (earlier) — M-Pesa webhook shape fixed.** The
> concrete, well-scoped bug flagged in `PAYMENTS_GOING_LIVE.md`'s "known
> gap" section: `MpesaWebhookDto` expected a flat `{ transactionId,
> success, amount }` shape that doesn't exist in the real world.
> Safaricom's Daraja API actually POSTs a nested
> `{ Body: { stkCallback: { MerchantRequestID, CheckoutRequestID,
> ResultCode, ResultDesc, CallbackMetadata?: { Item: [...] } } } }`
> shape, with `CallbackMetadata` (the M-Pesa receipt number, amount,
> phone, transaction date — as a name/value array, not flat fields)
> present only on success and completely absent on failure/cancellation.
>
> Fixed: `MpesaWebhookDto` now matches that real shape with proper
> nested `class-validator` decorators; a new pure helper,
> `mpesa-callback.util.ts`'s `parseMpesaCallback()`, flattens it into
> the `{ transactionId, success, resultDesc, amount?,
> mpesaReceiptNumber?, phone?, transactionDate? }` shape
> `handleMpesaCallback` in `payments.service.ts` actually needs (kept
> separate and independently unit-tested, same pattern as
> `scheduled-delivery-recurrence.util.ts`). `handleMpesaCallback` itself
> now also logs a warning (doesn't block completion) if Daraja's
> reported amount doesn't match the payment's own recorded amount — a
> discrepancy that used to have no way of surfacing at all.
>
> **Caught before it shipped, worth naming explicitly:** both the
> customer and business apps have a browser-side
> `simulateProviderConfirmation()` demo shim (see each app's
> `WIRING_NOTES.md`/header comment) that fires the M-Pesa webhook
> itself right after initiating, standing in for a real Safaricom
> callback since the provider is mock-only without real credentials.
> Both shims sent the *old* flat `{transactionId, success, amount}`
> body — which the backend's new, correct DTO now rejects. Fixing only
> the backend and shipping that alone would have silently broken the
> one M-Pesa flow that's actually exercised in this environment (mock
> mode, since there are no real Daraja credentials to test the real
> path with). Both shims are updated in this same pass to send a
> Daraja-shaped `{ Body: { stkCallback: { ...,
> CallbackMetadata: { Item: [...] } } } }` body instead.
>
> Test fixtures (both the new util's spec and the existing
> `payments.service.spec.ts` `handleMpesaCallback` tests, updated to the
> new shape) are built from Safaricom's own published Daraja sandbox
> example payload, not an invented shape. **Still not verified against
> an actual live callback from Safaricom's servers** — no Safaricom
> account exists to generate one; see `PAYMENTS_GOING_LIVE.md`'s
> "Testing before going live" section. `npm install` was not possible
> in this sandbox either (no network egress), so this was
> syntax-checked file-by-file with `esbuild`, not compiled with `tsc`
> or run through the real Jest suite — same caveat as the Scheduled
> deliveries entry below.

> **Update, 2026-08-22 (earlier) — Scheduled deliveries (4th and final
> of the 4 missing business features).** The one the roadmap explicitly
> called out as hardest, because it's two pieces, not one:
>
> 1. **The CRUD half** — same shape as `business-customers`/
>    `business-staff`. New backend module `scheduled-deliveries`
>    (`POST/GET /business/scheduled-deliveries`,
>    `PATCH/DELETE /business/scheduled-deliveries/:id`), a
>    `ScheduledDelivery` entity (pickup/dropoff location, optional
>    weight/description, `daysOfWeek` + `timeOfDay` recurrence,
>    `active`, `nextRunAt`/`lastRunAt`/`lastRunError`), migration
>    `CreateScheduledDeliveriesTable`, same per-business
>    ownership-scoping pattern (`findOwnedOrThrow`) as the other two.
> 2. **The actually-hard half** — a real background job.
>    `ScheduledDeliveriesCronService` uses `@nestjs/schedule`'s `@Cron`
>    (added as a new dependency; `ScheduleModule.forRoot()` registered
>    once in `app.module.ts`) to tick every minute, find every active
>    schedule whose `nextRunAt` has arrived, and create a real shipment
>    for each via the *same* `ShipmentsService.create()` the New
>    Delivery modal uses — not a reimplementation of pricing/validation.
>    One schedule's failure (most likely cause: no active
>    `PricingConfig` covering the route at that exact moment) doesn't
>    block the others in the same tick, and doesn't retry in a loop
>    either — it's recorded on the row (`lastRunError`) and the
>    schedule still advances to its next real occurrence.
>
> **Timezone handling, called out explicitly because it's an easy place
> to get quietly wrong:** `timeOfDay` is always interpreted as EAT
> (UTC+3, no DST — WAZZAR only operates in Tanzania), via a fixed
> +180-minute offset applied to UTC in
> `scheduled-delivery-recurrence.util.ts`, specifically so a schedule's
> real fire time doesn't depend on what `TZ` the backend process happens
> to be running with (containers/CI typically default to UTC). That
> util is unit-tested on its own (`scheduled-delivery-recurrence.util.spec.ts`)
> with hand-checked EAT/UTC conversions, independent of any database.
>
> Frontend: the business app's Scheduled page is fully wired — real
> fetch/add/toggle-active/delete, an address-search-backed "New
> schedule" modal (reuses the same `AddressField` component the New
> Delivery modal uses), replacing `MOCK_BUSINESS_SCHEDULED` entirely
> (removed from `mockData.js`, along with `MOCK_BUSINESS_CUSTOMERS`/
> `MOCK_BUSINESS_STAFF`, which were already dead code left over from
> the Customers/Staff passes below — only `MOCK_BUSINESS_INVOICES`
> remains, for Billing). Full detail in `apps/business/WIRING_NOTES.md`.
>
> **Not verified end-to-end — said plainly, not glossed over:** this
> sandbox has no network egress beyond what's already vendored, so
> `npm install` was never possible here for either the backend or the
> business app. Every new/changed file was syntax-checked file-by-file
> with `esbuild` (catches parse errors, not type errors) and reviewed
> by hand against the existing `business-customers`/`business-staff`
> pattern, but that is **not** a substitute for `tsc --noEmit`, the
> real Jest suite, `npm run build`, or — especially for this feature —
> actually watching the cron job fire against a real Postgres database
> with a schedule whose `nextRunAt` is in the past. **Next step before
> treating this as closed:** run the backend's full check suite
> (`npm ci && npx tsc --noEmit && npx eslint "src/**/*.ts" && npm test
> && npm run build`) and the business app's (`npm ci && npm test &&
> npm run build`) somewhere with normal internet access, then manually
> insert a due test schedule and confirm the cron tick actually creates
> a shipment.

> **Update, 2026-08-22 (later still) — Staff (2nd of 4 missing business
> features).** Same pattern as Customers: new backend module
> (`business-staff`: entity with `MANAGER`/`STAFF` role and
> `ACTIVE`/`PENDING` status enums, migration, DTOs, service, controller,
> 8 new tests) plus full frontend wiring (real invite/list/toggle-
> status/remove, replacing `MOCK_BUSINESS_STAFF`). **Deliberately not a
> real login/invite system** — adding someone always lands them as
> `PENDING`, no email is sent, and they get no actual WAZZAR account —
> a real sub-account/permission model is a meaningfully bigger feature,
> flagged rather than half-built. Full detail:
> `apps/business/WIRING_NOTES.md`'s "Newly wired, 2026-08-22: Staff"
> section. Scheduled/Billing remain mock — not started. Re-verified
> fresh: backend 166/166 tests + clean build, business app 4/4 tests
> (one new, covering the Staff page's real wiring) + clean build.

> **Update, 2026-08-22 (later same day) — payments + first of the 4
> missing business features.** Two separate pieces of work:
>
> 1. **Payments made deploy-ready.** Both `StripeProvider` and
>    `MpesaProvider` now use real SDK/API calls the moment real
>    credentials exist in `.env` — previously both only ever generated
>    fake transaction IDs, with no real-money code path at all. Also
>    fixed a real bug found along the way: webhook signature
>    verification was checking a `JSON.stringify()`'d re-serialization
>    of the payload instead of the exact raw bytes received, which
>    would silently fail against genuine Stripe signatures — fixed via
>    `rawBody: true` in `main.ts` plus real Stripe SDK `constructEvent`
>    verification. M-Pesa refunds are honestly left manual (not
>    automatable without a much larger Daraja B2C Reversal integration)
>    rather than faked. Full detail, credential setup steps, and one
>    known remaining gap (the M-Pesa webhook DTO doesn't yet match
>    Daraja's real callback shape): `docs/delivery-notes/PAYMENTS_GOING_LIVE.md`.
>    7 new tests added (`payment-providers.spec.ts`); **not verified
>    against real Stripe/Daraja sandbox traffic** — no accounts existed
>    to test against.
> 2. **Customers (business app address book) — built and wired,
>    first of the 4 previously-mock business screens.** New backend
>    module (`business-customers`: entity, migration, DTOs, service,
>    controller, 9 new tests) plus full frontend wiring (real
>    fetch/add/delete, replacing `MOCK_BUSINESS_CUSTOMERS`). Full detail:
>    `apps/business/WIRING_NOTES.md`'s "Newly wired, 2026-08-22" section.
>    Scheduled/Staff/Billing remain mock — not started.
>
> Re-verified fresh (`rm -rf node_modules && npm ci`) after both
> pieces: backend `tsc`+`eslint`+`npm test` (158 passing) +
> `npm run build`, and the business app's `npm test` (3 passing,
> including a new Customers-page test) + `npm run build` — all clean.

> **Update, 2026-08-22 — full pass summary.** In order: (1) backend
> hardening — CORS allowlist, rate limiting, Helmet, boot-time
> production-config check; (2) customer app now consumes the
> already-built `/tracking` WebSocket for live rider GPS instead of a
> simulated position; (3) audited the business app — found it was
> already wired (root README was stale, now corrected), no wiring work
> was actually needed; (4) `admin` and `business` apps went from zero
> tests to a login-path smoke test each, matching the existing
> customer/rider pattern; (5) `.github/workflows/ci.yml` added (backend
> + all 4 apps, every push/PR), which required fixing all 16 pre-existing
> lint errors first so CI wouldn't be red on day one, plus a backend
> `Dockerfile`/`.dockerignore`/`docker-compose.yml` update and a new
> `docs/delivery-notes/DEPLOYMENT.md`. **Every item marked ✅ below was
> re-verified in one final pass**, fresh from `rm -rf node_modules` and
> `npm ci`, not assumed from earlier in the session: backend `tsc` +
> `eslint` + `npm test` (142/142) + `npm run build`, and all 4 frontend
> apps' `npm test` + `npm run build` — 9 clean runs, zero failures. The
> one thing that could **not** be verified end-to-end is noted plainly
> where it applies rather than glossed over: the backend Dockerfile
> (no Docker daemon in this environment) and the live-tracking socket
> connection itself (no running backend + real rider GPS to connect to
> here) are code-reviewed and believed correct, not watched-running
> confirmed.

> **Update, same day (earlier):** the "Backend feature gaps" and "Frontend gaps"
> sections were worked in a follow-up pass — see the ✅ markers below.
> Backend: `riders.service.spec.ts` written, `POST /uploads`,
> `POST /shipments/:id/rate-rider`, and `GET /geocode/search` all
> implemented and passing `tsc --noEmit` + the full Jest suite (142/142).
> Frontend: Vitest + RTL smoke tests added to customer and rider apps.
> **New follow-up item this created:** none of the three new backend
> endpoints (uploads, rating, geocoding) are called from any frontend
> app yet — they exist and work, but nothing in `apps/*` uses them.
> That's the natural next slice of work, not done here to keep this
> pass to backend+testing infra as asked.
>
> **Update, later same day: the frontend-wiring follow-up above is now
> done.** Customer app: `GET /geocode/search` backs the pickup/dropoff
> address search-as-you-type list (reverse geocoding on map-pin-drag
> stays a direct Nominatim call — the backend only exposes forward
> search); `POST /shipments/:id/rate-rider` fires from the
> `DeliveredScreen` star rating (Skip never submits; Submit does).
> Rider app: `POST /uploads` backs the four onboarding-document upload
> boxes (ID, licence, vehicle registration, insurance — each was a fake
> toggle button before, now a real file input + upload) and the proof-
> of-delivery photo capture, both previously local-only gestures.
> **Not run in this pass:** `npm run build` / the Vitest and Jest
> suites — this sandbox's network egress is restricted to package-
> registry domains, and `npm install` fails here (no `node_modules`
> checked into the repo), so nothing could actually be installed or
> executed. The three changed files (customer's `App.jsx`/`api.js`,
> rider's `App.jsx`/`api.js`) were syntax-checked with `esbuild`
> directly and reviewed prop-by-prop for consistency between each
> screen component's signature and its render call site, but that is
> not a substitute for a real `npm run build` + the existing smoke
> tests. **Next step: run the full check suite** (`npm run build` in
> both apps, `npm test` for the Vitest smoke tests) somewhere with a
> normal `npm install` and confirm green before treating this as
> closed. The rider/customer smoke tests don't currently exercise the
> registration, POD, or delivered/rating screens, so even a green run
> wouldn't cover the new code paths — extending those smoke tests past
> login is still open work (see "Frontend gaps" below).
>
> Two things were deliberately left out of this pass, not overlooked:
> `RegProfileScreen`'s profile-photo picker stays a local-only toggle
> (the `Rider` entity/DTO has no profile-photo field to send it to),
> and the star-rating screen's compliment tags ("Fast", "Polite", etc.)
> stay local-only too (`RateRiderDto` is just `{ rating }}`, no field
> for tags). Both would need a backend DTO change first.

This sits alongside `TEST_RUN_AND_NEXT_STEPS.md` (what was tested,
what broke, what got fixed) — this file is the fuller inventory:
everything currently missing in the monorepo, mapped onto WAZZAR's
canonical phase model (1 Single-city Foundation → 2 Intercity/Trunk
Network → 3 Business Platform → 4 Regional Expansion — see
`docs/audits/DOCS_CORRECTIONS_APPLIED.md`'s "Phase Structure"
reconciliation for how this was settled), with a cross-cutting
Hardening pass that logically has to happen before real production
use regardless of which feature phase is current.

Columns are: **Item**, **Current state**, **Why it matters**, **Plan**,
**Phase**, **Owner**, **Priority**. Owner is blank everywhere — nobody's
been assigned yet. Fill in as work is picked up.

---

## Hardening (cross-cutting, blocks real production use regardless of feature phase)

These block a real production deploy regardless of what features ship
next.

> **Update, 2026-08-22: the first four rows below are now done.**
> `CORS_ORIGIN` env var added (`src/cors-origin.ts`, shared by both the
> HTTP API in `main.ts` and the WebSocket gateway in
> `tracking.gateway.ts` — one function, so they can't drift apart
> again); `@nestjs/throttler` added with a 60 req/min global default
> and a stricter 10 req/min limit on `/auth/register`, `/auth/login`,
> `/auth/refresh`; `helmet()` middleware added in `main.ts`; a new
> `src/security-checks.ts` refuses to boot when `NODE_ENV=production`
> and `CORS_ORIGIN`, `MPESA_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`,
> or a JWT secret pair is missing/unsafe. Verified: `npm install`,
> `npx tsc --noEmit`, `npm test` (142/142 passing), `npm run build`
> all clean after these changes; `npx eslint` shows the same
> pre-existing 16 `no-explicit-any`/unused-var issues as before (now
> 16, not 7, because more spec files were added since this row was
> last written) — none introduced by this change.

| Item | Current state | Why it matters | Plan | Owner | Priority |
|---|---|---|---|---|---|
| ✅ CORS allowlist | Done — `CORS_ORIGIN` env var, shared `corsOrigin()` helper used by both HTTP CORS and the WebSocket gateway | Any website could call the API from a browser with a stolen/leaked token | — | — | Closed |
| ✅ Rate limiting | Done — `@nestjs/throttler`, global 60/min default, 10/min on `/auth/*` | Brute-force login / registration spam had no backend defense | — | — | Closed |
| ✅ Security headers | Done — `helmet()` in `main.ts` | Missing baseline protections (clickjacking, MIME sniffing, etc.) | — | — | Closed |
| ✅ Webhook secrets enforcement | Done — `security-checks.ts` refuses to boot in production if either secret is unset | A production deploy with unset secrets accepted unsigned webhook calls | — | — | Closed |
| ✅ API documentation | Done — `@nestjs/swagger` added, CLI plugin enabled (`nest-cli.json`, `introspectComments: true` — pulls existing `// POST /riders — ...`-style route comments into operation summaries automatically, no manual `@ApiProperty` needed on every DTO field), served at `/docs` (`src/swagger.ts`). All 17 controllers tagged with `@ApiTags`/`@ApiBearerAuth` for grouping/auth in the UI. Defaults on everywhere except `NODE_ENV=production`, where it's off unless `SWAGGER_ENABLED=true` is set (see `.env.example`) — matches this file's existing secure-by-default-in-production pattern (`security-checks.ts`) rather than defaulting a public route map to on in prod | New devs (and the frontend apps) have no single source of truth for request/response shapes | — | — | Closed |
| ✅ CI pipeline | Done — `.github/workflows/ci.yml`: backend (`npm ci` → `tsc` → `eslint` → `npm test` → `npm run build`) and all 4 frontend apps (`npm ci` → `npm test` → `npm run build`, matrix job) run on every push/PR to `main`. See `docs/delivery-notes/DEPLOYMENT.md` for full detail | — | — | Closed |
| ✅ Production Docker / deploy | Backend: `Dockerfile` + `.dockerignore` added (multi-stage, non-root), `docker-compose.yml` extended with a `backend` service. Frontend: all 4 apps already had a correct `netlify.toml`; connecting each to Netlify is a one-time account setup, documented step-by-step in `docs/delivery-notes/DEPLOYMENT.md` rather than automated (nothing to commit for a dashboard click). **Update, 2026-08-23:** see the update block below this table — `docker build` itself still hasn't run (no Docker daemon reachable with real Docker Hub access in any session yet), but a real bug was found and fixed by executing every stage's actual commands directly, and the Dockerfile passes `hadolint` clean | — | — | Closed (config); host selection & first real deploy still open — see `DEPLOYMENT.md` "What's still open" |
| ✅ Lint errors | Done — all 16 fixed (grew from 7 to 16 since this row was last written, as more spec files were added; all resolved together). 14 were unnecessary `as any` casts where the test data already matched the real DTO type — replaced with the real import (`CreateRiderProfileDto`, `CreateShipmentDto`, `RateRiderDto`) instead of casting. 1 was a genuinely-unused migration rollback param — fixed with the standard leading-underscore convention, which required adding `argsIgnorePattern: '^_'` to `.eslintrc.js`. 1 was a genuinely-partial test mock — kept as `as any` with a scoped comment explaining why, per this row's own original suggestion. Now that `eslint` is part of the new CI pipeline (above), this needed to be zero before CI could be trusted, not left for later | — | — | Closed |
| ✅ Frontend bundle size | Done, both apps. `admin`: `recharts` split into `RevenueChart.jsx`, lazy-loaded behind Analytics tab (2026-08-23 earlier pass). `business`: `recharts` split into `DeliveriesChart.jsx` the same way, but that chart lives on `OverviewPage` — the default landing page, not a tab — so `App.jsx` also calls `preloadDeliveriesChart()` as soon as a session is confirmed (in parallel with the profile/orders fetch that already happens on login), so the chunk is usually already warm by the time `OverviewPage` renders instead of flashing its `Suspense` fallback on nearly every login | Slower first load, not a correctness issue | — | — | Closed |
| ✅ Staging/production config split | Done (code-only — see note). New `src/env-file.ts` picks `.env.staging`/`.env.production` (falling back to `.env`) based on `NODE_ENV`, used by both `ConfigModule` (`app.module.ts`) and the TypeORM CLI (`database/data-source.ts`, which boots outside Nest and needed the same logic applied by hand). New `.env.staging.example`/`.env.production.example` templates — deliberately thin overlays listing only what differs from `.env`, not full copies. `.env.staging`/`.env.production` (the real, filled-in files) added to root `.gitignore`. New `start:staging` npm script alongside the existing `start:prod`. **Does not** provision a staging host, database, or Netlify/Render site, and does not extend `security-checks.ts`'s boot-time enforcement to `NODE_ENV=staging` — that check still only fires for `NODE_ENV=production`, unchanged; staging is documented (in `.env.staging.example`) as expected to set the same values anyway, just not force-checked. **Not run** — no `node_modules` in this sandbox, so `ConfigModule.forRoot()` reading the new `envFilePath` array and `ts-node` picking up `data-source.ts`'s new import were verified by reading, not by actually booting the app with `NODE_ENV=staging` set | One `.env` shared by every environment meant staging/production couldn't diverge (a different DB, CORS origin, Swagger toggle, etc.) without editing the same file used for local dev | Real host provisioning (which provider, DNS, first deploy) is still a one-time account-setup task, not code — see `DEPLOYMENT.md` | — | Closed (code); host provisioning still open |

> **Update, 2026-08-23 — Docker: still can't run a real `docker build`,
> but got as close as this sandbox allows, and it paid off.** This
> environment has `docker` installable via `apt` and a daemon that
> starts fine, but `registry-1.docker.io` returns 403 through this
> sandbox's network egress proxy — confirmed directly (`docker pull
> node:20-alpine` fails), not assumed. No container registry is
> reachable here at all, so a literal build still can't complete in
> this sandbox, same limitation as the prior session, just confirmed
> for a different reason (no daemon before; no registry access now).
>
> Given that, did the next best thing — verified everything short of
> the actual image assembly:
> - `hadolint` (downloaded from GitHub releases, statically checks the
>   Dockerfile without needing to pull anything) — clean, just two
>   low-priority `apk add` version-pinning warnings and one info-level
>   note about the non-numeric UID, nothing that blocks a build.
> - Ran every RUN command each stage actually executes, for real,
>   against this exact backend: `npm ci` (`deps` stage), `npm run
>   build` (`build` stage — produces `dist/main.js` correctly), `npm
>   ci --omit=dev` (`prod-deps` stage). All three passed clean.
> - Along the way, ran the full check suite this repo's own
>   `SESSION_HANDOFF_2026-08-22.md` asked for and had never been run:
>   `npm ci`, `npx tsc --noEmit`, `npx eslint "src/**/*.ts"`, `npm
>   test`, `npm run build` — all clean, **191/191 tests passing**
>   (was 142/142 as of the 2026-08-22 update above; grew with the
>   scheduled-deliveries and mpesa-callback suites added since).
> - **Found and fixed a real bug this way:** `bcrypt` is a genuine
>   dependency (see `package.json`) with a native addon built via
>   `node-gyp`. `node:20-alpine` ships no C/C++ toolchain by default —
>   a very common real-world Alpine+bcrypt failure mode if no
>   prebuilt musl binary matches. Added `RUN apk add --no-cache
>   python3 make g++` to **both** `deps` and, critically, `prod-deps`
>   — `prod-deps`'s `node_modules` is the one that actually ships in
>   the runtime image, so fixing only `deps` (where it's first
>   needed, to compile TS) would have left the *shipped* image broken
>   even though the build stage looked fine. Both fixes are
>   build-stage-only; neither toolchain reaches the final runtime
>   image.
>
> **Still open:** an actual `docker build -t wazzar-backend .` on a
> machine with normal Docker Hub access, to confirm the bcrypt fix
> above actually resolves it (it should, per the standard pattern —
> see `Dockerfile`'s comments — but "should" isn't "confirmed" until
> someone runs it for real) and to catch anything else only a real
> image assembly would surface.

---

## Real-time tracking: was built but disconnected — now wired (customer side)

> **Update, 2026-08-22:** the customer app's tracking screen now
> connects to the backend's `/tracking` Socket.IO namespace via
> `subscribeToShipmentTracking()` in `apps/customer/src/api.js`, using
> the same bearer token as the REST calls. `TrackingScreen` now shows
> the rider's real GPS position (with a "LIVE GPS" badge) the moment
> one arrives, falling back to the old simulated position only until
> the first real fix lands or if the socket can't connect. No backend
> change was needed — `tracking.gateway.ts` already broadcast on every
> `POST /rider/location`, nothing on the frontend was listening. The
> rider app's side (`POST /rider/location` every 20s) is unchanged and
> still the only thing feeding this — it doesn't need its own socket
> connection, since the backend already turns that REST ping into a
> broadcast. Verified: `npm install`, `npm run build`, and the existing
> Vitest smoke test all pass in `apps/customer`. **Not yet verified
> against a live backend + real rider GPS** — this sandbox has no
> Postgres/running backend to connect to, so the socket connection
> itself (vs. the code that sets it up) hasn't been exercised
> end-to-end. Confirm with a real `npm run dev` backend + a phone
> browser as the rider before calling this fully done.

> **Update, 2026-08-23 — done: exercised for real against a live
> backend.** Installed Postgres locally, ran every migration for
> real, booted the actual compiled backend (`node dist/main` — the
> exact command the Dockerfile's `CMD` runs), and drove a shipment
> through its real lifecycle over genuine HTTP calls: register
> customer + rider → rider onboarding → admin verify → rider goes
> online → customer creates a shipment → confirm → assignment-pending
> → rider claims it (→ `ASSIGNED`). Then opened a real Socket.IO
> connection to `/tracking` as the customer, subscribed to the
> shipment, and had the rider `POST /rider/location` a real GPS
> coordinate. The customer's socket received a live `tracking:update`
> broadcast with the correct coordinates within ~1.5s — the exact
> rider-ping → WebSocket-broadcast path this row was waiting on.
> `GET /shipments/:id/tracking` (the HTTP one-off read) was checked
> too and reflects the same location. Also checked the access-control
> side while the harness was already wired up: a second, unrelated
> customer trying to subscribe to the first customer's shipment is
> correctly rejected with an `error` event, not silently allowed —
> `tracking-access.util.ts` behaves as intended under a real socket,
> not just in its unit tests. All of this was scripted (register →
> shipment lifecycle → subscribe → ping → assert) rather than
> clicked through manually, so it's easy to rerun after future
> tracking-related changes. **Still open:** this confirms the
> backend's rider-ping → broadcast path end-to-end; it does not
> replace confirming the *frontend* pieces (rider app actually
> sending real device GPS every 20s, customer app's `TrackingScreen`
> rendering a live update) against a real phone, which still needs a
> real device and hasn't been done in any session.

| Item | Current state | Why it matters | Plan | Owner | Priority |
|---|---|---|---|---|---|
| ✅ WebSocket tracking gateway unused by any frontend | Fixed on the customer side (see above). Admin app was never checked for a tracking-map screen — worth a quick look if it has one | Was REST polling wearing real-time infrastructure that wasn't wired up | Live end-to-end test still needed (see update above) | — | Closed (customer app); admin app unaudited |
| ✅ Backend rider-ping → WebSocket-broadcast path unverified against a live server | Fixed, 2026-08-23 — see update above. Scripted end-to-end test (17/17 checks) confirms the real path works, including access control | Was the one piece of tracking infra nobody had watched actually run | Frontend-against-a-real-phone check still open (see update above) | — | Closed (backend path); real-device frontend check still open |

---

## Backend feature gaps (things no endpoint exists for yet)

**Status update, 2026-08-21: the four High/Medium items below are now
implemented.** Kept in the table (marked done) rather than deleted, so
the "why it matters" and design-decision context isn't lost.

| Item | Current state | Why it matters | Plan | Owner | Priority |
|---|---|---|---|---|---|
| ✅ `riders.service.spec.ts` | Done — 15 tests covering `createProfile`, `findByUserId`, `setOnline`/`setOffline`, `getEarnings`, `verify` | Was the only untested backend module | Written mirroring `shipments.service.spec.ts`'s mocking pattern | — | Closed |
| ✅ File/photo upload endpoint | Done — `POST /uploads` (any authenticated user), local-disk storage under `UPLOADS_DIR`, served back at `/uploads/:filename`, 10MB limit, image/PDF allowlist. Rider onboarding now has real `idDocumentUrl`/`licenseDocumentUrl`/`vehicleRegistrationDocumentUrl`/`insuranceDocumentUrl` columns (migration `AddRiderDocumentUrls`) wired into `POST /riders`. **Now wired into the rider app** — the four onboarding-document upload boxes and the proof-of-delivery photo capture call it for real (see the "later same day" update at the top of this file) | Rider onboarding docs and proof-of-delivery photos previously had nowhere real to go | Storage engine is isolated in `UploadsService`/`UploadsController` specifically so swapping to S3-compatible storage later touches only those two files, not callers | — | Closed (backend + rider-app frontend); not yet build/test-verified, see top-of-file update |
| ✅ Customer-rating endpoint | Done — `POST /shipments/:id/rate-rider` (owning customer only, one rating per shipment, only after DELIVERED/COMPLETED), updates `Rider.ratingAvg`/`ratingCount` (migration `AddShipmentRiderRating` adds `shipments.rider_rating`). Covered by 6 new tests in `shipments.service.spec.ts` | Riders previously couldn't be rated by customers at all | — | — | Closed (backend + customer-app frontend); not yet build/test-verified, see top-of-file update |
| ✅ Geocoding / places-search endpoint | Done — `GET /geocode/search?q=&countryCode=`, backed by a Nominatim adapter (`GeocodingService`), isolated behind that one class the same way LATRA is meant to be isolated behind an adapter. **Untested against the live Nominatim API** — the sandbox this was built in only allows egress to package-registry domains, not `nominatim.openstreetmap.org`; needs a real smoke test once deployed somewhere with normal internet access | Customer app's address autocomplete was a fixed mock list | — | — | Closed (backend, unverified against live API, + customer-app frontend); not yet build/test-verified, see top-of-file update |
| ✅ Rider verification: per-document status | Done. Backend: `RiderDocumentType`/`DocumentReviewStatus` enums, `DocumentReview` interface, new `documentReviews` jsonb column on `Rider` (migration `AddRiderDocumentReviews`), `RidersService.findById()`/`.reviewDocument()`, `ReviewRiderDocumentDto`, `GET /riders/:id` + `PATCH /riders/:id/documents/:documentType` (both admin-only), new spec tests. Frontend (admin app): `getRider()`/`reviewRiderDocument()` in `api.js`; the Riders page shows document URLs with per-document Approve/Reject (reject prompts for a reason) alongside the existing whole-application Verify action, not replacing it. **Not run** — no real database or browser click-through in the sandbox this was built in | An admin can't reject just the insurance doc and ask for a re-upload without rejecting the whole application | — | — | Closed (code); needs a real `npm test` + manual click-through before trusting it fully |

---

## Frontend gaps

**Status update, 2026-08-22: all 4 apps now have a test framework and a
login smoke test.** Previously only `customer` and `rider` did.
`admin` and `business` were still completely untested — this pass
closes that gap the same way, not a new approach.

What was added, per app:

- **`apps/admin`** — `vitest` + `@testing-library/react` +
  `@testing-library/jest-dom` added as dev dependencies; `test` script
  added (`vitest run`); `src/test/setup.js` and
  `src/test/App.smoke.test.jsx` added. The test mocks only the two
  network-calling functions the login → dashboard path needs
  (`login`, `getDispatchQueue`) via `vi.importActual` + override —
  everything else (`currentUser`, `isAuthenticated`, `roleSummary`,
  `logout`) is the **real** `api.js` code, reading/writing the same
  `localStorage` keys production does. Covers: login form submits with
  the real `api.login` call signature, session lands in `localStorage`
  under the real keys, `AppShell` renders, and the real (unmocked)
  `DispatchPage` reaches its empty-state copy.
- **`apps/business`** — same treatment. One extra wrinkle found and
  fixed: `recharts`'s `<ResponsiveContainer>` (used on the Overview
  page, which every login lands on) throws `ReferenceError:
  ResizeObserver is not defined` under jsdom — jsdom doesn't implement
  the browser API recharts needs to measure its container. Fixed with
  a small no-op `ResizeObserver` polyfill in `src/test/setup.js`
  (standard practice for testing recharts/jsdom, not something
  business-app-specific). Mocks `login` and `listShipments`; covers
  login → the real Overview page's stat cards and chart section
  actually rendering.
- Both new test suites, all 4 apps' `npm run build`, and the backend's
  full Jest suite (142/142) were re-run after these changes — all
  green. See the per-app "Verified" note below for exactly what was
  and wasn't checked.

**Verified:** `npm install`, `npm run build`, and `npm test` all pass,
freshly re-run, for `customer`, `admin`, `rider`, and `business` — plus
the backend's `npm test` (142/142). This is the first time all four
frontend apps have been installed and tested in the same pass; earlier
notes in this file only ever confirmed 2 of the 4 had a test framework
at all.

**Still not covered, honestly:** these are smoke tests of the login →
first-screen path only, same scope as the original customer/rider
tests — they do not cover order creation, dispatch assignment, ratings,
document upload, or any other deeper flow in any of the 4 apps. Full
coverage of those flows is still open work, not done here.

| Item | Current state | Why it matters | Plan | Owner | Priority |
|---|---|---|---|---|---|
| ✅ No test framework in customer/rider | Done — `vitest` + `@testing-library/react`, one smoke-test file each (`src/test/App.smoke.test.jsx`) covering login through to the home screen | Component/interaction bugs like the missing `api` import (see `TEST_RUN_AND_NEXT_STEPS.md`) won't be caught until a human manually walks every screen | Extend coverage past login (order flow for customer, accept→deliver loop for rider) as a follow-up — still open. The geocoding search, rating submission, document-upload, and POD-photo code added in the frontend-wiring pass still isn't exercised by any test — still open | — | Partially closed |
| ✅ No test framework in admin/business | Done — same pattern as customer/rider (see update above): `vitest` + RTL, one login-through-first-screen smoke test each | Same risk class as customer/rider had | Extend past login (dispatch-assign flow for admin, order-creation flow for business) — open, not done here | — | Partially closed |
| Admin/business real-time data | Both apps are wired to the real backend (per `README_ADMIN_WIRING.md` / `README_BUSINESS_RIDER_MERGE.md`) but, like the tracking gap above, nothing pushes updates — dashboards are pull/poll or static-on-load | Not verified either way in this pass — needs a read of each app's polling behavior specifically, not assumed from the wiring docs alone | Audit both apps' data-refresh strategy explicitly as its own task | — | Low |

---

## Documentation gaps

> **Update, 2026-08-22:** the root `README.md`'s app table was
> significantly stale — it said `rider` and `business` were both
> unwired, when `apps/business/WIRING_NOTES.md` (and a fresh
> `npm run build` check) show `business` has been wired for a while
> (auth, orders, pricing, payments, geocoding all real — only 4
> screens with no backend feature yet, clearly banner-labeled in the
> UI). Root README corrected. **Lesson for next pass:** trust
> `docs/delivery-notes/` and each app's own `*_WIRING_NOTES.md` over
> the root README's summary table — the summary line drifts faster
> than the detailed notes do.

| Item | Current state | Why it matters | Plan | Owner | Priority |
|---|---|---|---|---|---|
| ✅ No customer-app wiring note | Done — new `apps/customer/WIRING_NOTES.md`, matching the format of `apps/business/WIRING_NOTES.md`/`apps/admin/README_ADMIN_WIRING.md`. Covers real auth (device-derived password standing in for real OTP), real shipments/pricing/payments, the hybrid real-GPS-with-simulated-fallback tracking behavior, the payment-webhook self-call shim, the Nominatim-direct reverse-geocode carryover, the hardcoded Stripe demo token, and the now-dead `mockData.js`. **Correction found while writing this:** the original framing of this gap ("customer is the only app without one") wasn't quite right — the **rider app has no wiring doc either**, still open, not written since it wasn't asked for at the time | Anyone picking up the customer app has to re-derive its wiring status from source instead of reading a doc, the way they can for the other three | Rider app still needs the same treatment | — | Closed (customer app); rider app wiring doc still open |
| `docs/planning/WAZZAR_MASTER_INDEX.md` and siblings are stale | Already self-flagged in-file: "pre-build planning/specification... some specifics here... may no longer match the real backend" | Anyone reading planning docs before delivery-notes docs will get a wrong picture of current state | No action needed beyond what's already there — the in-file warning is doing its job. Listed here only so it's not missed in a "what's missing" sweep | — | Low |
| Root-level architecture overview | No single top-level doc describing how `backend/`, `apps/*`, and `docs/*` relate, or which delivery-notes doc to read first for current status | New contributor has to piece the monorepo layout together from `README.md` + folder names | Add a short "start here" section to the root `README.md` pointing at `docs/delivery-notes/` for current status and this file for the gap list | — | Low |

---

## Explicitly out of scope for now (Phase 2+, not gaps in the current phase)

> **Renumbered (2026-08-22) to match the canonical phase scheme used everywhere else in this repo** (see `docs/audits/DOCS_CORRECTIONS_APPLIED.md`'s "Phase Structure" reconciliation): 1 Single-city foundation → 2 Intercity/Trunk Network → 3 Business Platform → 4 Regional Expansion. This section previously used an inherited "Phase 0 Audit → 1 Core Foundation → 2 First Delivery Loop → 3 Intercity → 4 Business → 5 Scale" numbering that predates that reconciliation and doesn't match it — fixed below. It also called Business Platform work "not evaluated in this pass," which is stale now that `business-customers`, `business-staff`, and `scheduled-deliveries` are real, wired modules, not future work.

Listed so they don't get mistaken for missing MVP work — these are
intentionally deferred per WAZZAR's own phase model, not oversights:

- Intercity/multi-leg shipments, carrier partners (PAX etc.), LATRA
  adapter — Phase 2
- Business bulk-send, CSV upload, and invoicing beyond what's already
  built (`business-customers`, `business-staff`, `scheduled-deliveries`
  are real Phase 1 features today, not deferred — see `apps/business`
  and this doc's own entries above) — remaining scope not evaluated in
  this pass, Phase 3
- Multi-country config, currency, regulations — Phase 4
- Dynamic pricing, route optimization, analytics, insurance — Phase 4
