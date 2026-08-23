# Session status — 2026-08-23 (this pass)

What was asked, what got done, and what's still open. Read this before
assuming any of the 5 "fixable" gaps from the earlier A-to-Z list are
fully finished — two are only partly done.

## Starting point: the A-to-Z gaps list

The person supplied 12 gaps. Split into 5 "fixable without live infra"
and 7 "needs live infra/hardware/accounts, theirs to run":

**Fixable (5):**
1. API documentation — no Swagger/OpenAPI
2. Customer-app wiring doc — the only app without one
3. Bundle size — `admin`/`business` both throw Rollup's >500kB warning
4. Per-document rider verification — admin could only approve/reject a
   whole application, not individual documents
5. Staging/production split — code-only half (env config), not a real
   host provisioning

**Needs live infra (7, untouched this pass, as agreed up front):**
Docker build, frontend deep testing (order creation/dispatch/upload/
rating), host/DB provider selection, payments live verification,
Playwright e2e, real-device GPS, admin real-time data (push vs poll).

## What's actually done

### ✅ 1. Per-document rider verification — DONE
- Backend: `RiderDocumentType`/`DocumentReviewStatus` enums + `DocumentReview`
  interface + `documentReviews` jsonb column on `Rider`
  (`src/database/entities/rider.entity.ts`), migration
  `1787370000000-AddRiderDocumentReviews.ts`, new `RidersService.findById()`
  and `.reviewDocument()`, new `ReviewRiderDocumentDto`, two new controller
  routes (`GET /riders/:id`, `PATCH /riders/:id/documents/:documentType`,
  both admin-only), and new spec tests for both service methods.
- Frontend (admin app): `api.js` gained `getRider()`/`reviewRiderDocument()`;
  the Riders page was rebuilt so a looked-up rider shows document URLs,
  per-document Approve/Reject (reject prompts for a reason), and the
  existing whole-application Verify action side by side.
- Design choice, per instruction: sits **alongside** the existing
  whole-application verify/reject, doesn't replace it.
- **Not run against a real database or clicked through in a browser** —
  no `node_modules`/network in this sandbox. Needs a real `npm test` and
  a manual click-through before trusting it fully.

### ✅ 2. API documentation (Swagger/OpenAPI) — DONE
- Added `@nestjs/swagger` to `package.json`, enabled the Swagger CLI
  plugin in `nest-cli.json` (`introspectComments: true` — pulls the
  existing `// POST /riders — ...`-style comments most handlers already
  had into operation summaries automatically, so most DTOs didn't need
  hand-written `@ApiProperty` on every field).
- New `src/swagger.ts` — mounts at `GET /docs` (UI) and `GET /docs-json`
  (raw spec), bearer-auth scheme registered. **Defaults on everywhere
  except `NODE_ENV=production`**, where it's off unless
  `SWAGGER_ENABLED=true` is set — matches this repo's existing
  secure-by-default-in-production pattern (`security-checks.ts`) rather
  than defaulting a public route map to on in prod.
- All 17 controllers got `@ApiTags` (grouping) and `@ApiBearerAuth` on
  every route that actually requires a token — including the ones with
  per-method (not class-level) guards, like `payments` and `pricing`,
  where public routes (webhooks, `/calculate`, `/active`) correctly got
  **no** bearer-auth decorator.
- `.env.example` documents `SWAGGER_ENABLED`.
- Updated the tracker row in `docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md`
  from open to closed with the detail above.
- **⚠️ Found a real doc/code mismatch while in this file, unrelated to
  Swagger, worth someone's attention:** the "Lint errors" row directly
  above it in that same table says lint was already fully closed in an
  earlier session by *retyping* 16 `any` casts to real DTOs. But the
  actual spec files in this zip (`admin-businesses.service.spec.ts`,
  `support.service.spec.ts`, `admin-customers.service.spec.ts`) still
  have `: any`/`as any` all over them — 9, 3, and 10 occurrences
  respectively, as of the fix earlier in this same session (see the
  `.eslintrc.js` override-glob fix). Either that "Closed" claim in the
  roadmap doc is stale/inaccurate, or a different code state than what's
  in this zip was being described. Not re-investigated further this
  pass — flagging so it doesn't get taken as settled fact.
- **Not run** — no `tsc`/`eslint`/`nest build` executed in this sandbox
  (no network, no `node_modules`). The CLI plugin in particular only
  takes effect on a real `nest build`/`nest start`, never on hand
  inspection — worth confirming `/docs` actually renders correctly
  against a real build before trusting the auto-generated schemas.

### ✅ 3a. Bundle size — admin app — DONE
- `recharts` split out of `App.jsx` into its own `RevenueChart.jsx`,
  loaded via `React.lazy()` + `<Suspense>`, only fetched when the
  Analytics tab (not the default landing page in this app) actually
  renders.
- Verified no stray `recharts`-related JSX left behind in `App.jsx`, and
  brace/paren balance checked.

### 🟡 3b. Bundle size — business app — NOT STARTED
- Business app's `App.jsx` still has the direct `recharts` import
  (`BarChart`, `XAxis`, `YAxis`, `Tooltip`, `ResponsiveContainer`) and
  inline chart JSX, untouched.
- **Important difference from admin, worth knowing before doing this:**
  in the business app, the chart lives on `OverviewPage`, which is the
  **default landing page** (`useState("overview")`) — not behind a tab
  like admin's Analytics. Splitting it the same way (lazy + Suspense)
  still helps the *build-time bundle size* Rollup warns about, since
  `recharts` gets its own chunk instead of shipping in the main bundle.
  But because Overview loads on essentially every session immediately
  after login, the Suspense fallback will flash briefly almost every
  time, unlike admin where the split fully defers the load. Worth
  deciding whether that tradeoff is acceptable before applying the same
  pattern, or whether preloading the chunk on login (or just accepting
  the flash) is preferred.

### ✅ 4. Customer-app wiring doc — DONE
- New `apps/customer/WIRING_NOTES.md`, matching the format of
  `apps/business/WIRING_NOTES.md` and `apps/admin/README_ADMIN_WIRING.md`.
  Covers: real auth (device-derived password standing in for real OTP),
  real shipments/pricing/payments, the hybrid real-GPS-with-simulated-
  fallback tracking behavior, the payment-webhook self-call shim, the
  Nominatim-direct reverse-geocode carryover, the hardcoded Stripe demo
  token, and the now-dead `mockData.js`.
- **⚠️ Found while doing this, not yet acted on:** the person's original
  gap description said customer was "the only app without one" — that's
  not quite right. **The rider app has no wiring doc either.** Not
  written this pass since it wasn't asked for.

### ⬜ 5. Staging/production split (code-only half) — NOT STARTED
No work done on this yet — env-specific config files, `NODE_ENV`
branching beyond what `security-checks.ts` already does, or
`.env.staging`/`.env.production` templates.

## Everything else (the 7 infra-dependent gaps)

Untouched, as agreed at the start of this pass — Docker build, frontend
deep testing, host/DB provider selection, payments live verification,
Playwright e2e, real-device GPS, admin real-time data audit. All still
need a real environment (network, a browser, a phone, or real provider
accounts) that this sandbox doesn't have.

## General caveat covering all of the above

**Nothing in this pass was run.** This sandbox has no network access and
no `node_modules` for either the backend or any frontend app — every
change here was written and hand-reviewed (brace/paren balance checks,
reading the actual file contents back, tracing through the logic by
eye), not executed. Before trusting any of it:
- Backend: `npm install && npm run build && npm test && npm run lint`
- Each touched frontend app: `npm install && npm run build`
- Manually click through the admin Riders page's new per-document
  review flow against a real backend + seeded rider with uploaded
  document URLs
- Load `/docs` against a real running backend and check the generated
  schemas look right, especially for the CLI-plugin-inferred DTOs
