# Full-system audit — 2026-09-03

Requested: a pass over everything built across the four Phase 3
deliveries (`API_SUBSCRIPTIONS.md`, `ADVANCED_INVOICING.md`,
`ANALYTICS_DASHBOARD.md`, `CSV_BULK_SEND.md`) checking for bugs,
duplicates, and missing logic, with the goal of one unified,
consistent system rather than four features that happen to sit next
to each other.

## What was checked

- **Duplicate symbols**: grepped `apps/business/src/App.jsx` for
  duplicate top-level `function`/`const` declarations across every
  edit this session — none found (a near-miss was caught and fixed
  mid-session: a second `STATUS_LABELS` const for the Analytics page
  collided with an existing one; resolved by reusing the existing map
  instead of introducing a duplicate).
- **Route collisions**: listed every `@Controller()` path across the
  backend — no two controllers register the same prefix.
- **Migration collisions**: checked every index/constraint name across
  every migration file for duplicates. Two pre-existing duplicates
  exist (`fk_shipments_rider`, `chk_shipments_rider_rating_range` — up
  and down of a repair migration) and predate this work; the two new
  migrations added this session (`api_keys`, `invoices` +
  `invoice_line_items`) introduce no new collisions.
- **Runtime correctness of `pdfkit` integration**: `tsc --noEmit`
  passing doesn't prove a `require()`-shaped CommonJS import actually
  works at runtime under this project's tsconfig (no
  `esModuleInterop`). Compiled and ran `invoice-pdf.util.ts` directly
  against a real invoice object outside the test suite — confirmed it
  produces a valid PDF (`%PDF` header, non-trivial byte length), not
  just a type that happens to check.
- **`csv-parse` header handling**: ran the bulk-shipments CSV parser
  directly against a CSV with mixed-case headers and a quoted field
  containing a comma (`"123 Main St, Mikocheni"`) — confirmed the
  header-lowercasing callback and quoted-field handling both work as
  the service code assumes, rather than trusting the type signature
  alone.
- **Cross-file consistency**: confirmed `StatCard`, `Modal`'s `wide`
  prop, `ApiError`, and every `COLORS` key referenced by new frontend
  components actually exist and match their real signatures.
- **`ApiKeyAuthGuard`/`CurrentUser` interaction**: confirmed
  `CurrentUser()` reads `request.user`, which `ApiKeyAuthGuard`
  populates before the handler runs — the public API's reuse of
  `@CurrentUser()` alongside `JwtAuthGuard`'s routes was previously
  correct but under-documented; updated `current-user.decorator.ts`'s
  comment, which had gone stale (still describing itself as
  JWT-only).
- **ESLint**: this project's `.eslintrc.js` was never actually run
  against any of the new modules this session. Running it found one
  real violation — see below — and confirmed everything else (all
  four new backend modules, the entity/migration files, the payments
  provider changes) is clean. Also ran across the entire backend
  (`src/**/*.ts`), not just the new files, to make sure nothing
  latent was sitting elsewhere: clean.

## Bugs found and fixed

1. **`AnalyticsService.buildDailySeries` float-accumulation
   inconsistency.** The daily spend series accumulated each day's
   total by repeatedly adding decimal-string prices as JS floats and
   rounding after every addition, while the totals calculation right
   above it correctly used `common/money.ts`'s integer-cents helpers.
   This didn't happen to produce wrong numbers in testing (rounding
   after each step self-corrects for small day-to-day sums), but it's
   the exact pattern `money.ts` exists to rule out, and would only
   need a larger day (many shipments, unlucky decimal combinations) to
   actually drift. Fixed to accumulate in integer cents throughout,
   converting to a decimal once per day at the end — same principle
   `InvoicesService.generate()` already follows. Added a regression
   test using classic float-drift-prone values (0.10/0.20/0.30).

2. **`ApiKeyAuthGuard`'s scope check used an `as never` cast** to
   satisfy `Array.includes()` against a `string[]` reflector result
   instead of the actual `ApiKeyScope[]` type. Not a runtime bug (enum
   values are plain strings, so the comparison worked), but it's the
   kind of unsafe-cast-to-satisfy-the-compiler pattern that hides a
   real type mismatch if `ApiKeyScope` ever changes shape. Fixed by
   typing the reflector call as `ApiKeyScope[]` directly, removing the
   cast entirely.

3. **ESLint violation in `BusinessApiKeysService.omitHash()`.** Used
   `const { keyHash: _keyHash, ...safe }` to omit the hash field,
   assuming (incorrectly, for this repo) that an underscore prefix
   would be recognized as "intentionally unused." This project's
   `.eslintrc.js` only applies that exemption to function *arguments*
   (`argsIgnorePattern: '^_'`), not destructured variables — so this
   would have failed CI. Fixed with an explicit
   `eslint-disable-next-line` and a comment explaining why, rather
   than relying on a convention this repo doesn't actually configure.

4. **Pre-existing, independent bug: `Payment.isMock` referenced but
   never declared.** Every delivery note this session flagged the same
   single pre-existing test-suite failure
   (`payments.service.spec.ts`, blocked by a `tsc` error) as
   "unrelated, not touched." On this audit pass it was worth actually
   looking at rather than continuing to note around it, since a
   project-wide compile error is squarely a "unified system" concern
   even when it predates this work.

   The root cause: `PaymentsService.initiate()` set
   `saved.isMock = result.isMock` on the returned `Payment`, with a
   comment referencing "the field's own comment on Payment" — but
   neither `Payment` nor `ProviderInitiateResult` actually declared an
   `isMock` field anywhere. This looks like a half-finished feature:
   flagging whether a payment response came from the mock/sandbox
   provider path (relevant since `PAYMENTS_GOING_LIVE.md` documents
   that neither M-Pesa nor Stripe has real credentials configured yet)
   rather than a real Daraja/Stripe call, so a business/admin UI could
   eventually show "this wasn't a real charge."

   Fixed properly, matching the original comment's evident intent:
   - `ProviderInitiateResult.isMock: boolean` — both `MpesaProvider`
     and `StripeProvider` now set it explicitly on every return path
     (`true` on the mock branch, `false` on the real-API branch).
   - `Payment.isMock?: boolean` — added as a genuinely transient field
     (no `@Column` decorator, so it's never persisted and never
     populated when a `Payment` is loaded back out of the database —
     exactly what the original comment already promised). Documented
     that a past payment's mock/real status isn't queryable after the
     fact; a future pass could add a real persisted column if that
     ever needs to change.
   - Result: `tsc --noEmit` now passes with **zero** errors across the
     entire project (previously two, on every single check this
     session), and all 22 backend test suites pass (261 tests, up
     from 225 — `payments.service.spec.ts`'s tests were present but
     silently blocked from actually running cleanly by the compile
     error).

5. **Pre-existing, independent bug: the rider app couldn't build at
   all.** `apps/rider/src/api.js` imports `socket.io-client` (used for
   the live dispatch/tracking socket — `io(...)`,
   `socket.on("dispatch:new-request", ...)`, etc.) but
   `apps/rider/package.json` never listed it as a dependency. `npm
   install` therefore never installed it, and `vite build` failed
   outright with an unresolved-import error — this wasn't a "missing
   frontend GPS test" gap (as `MASTER_GAPS_AND_ROADMAP.md`'s Phase 1
   critical path describes), it was the rider app failing to produce a
   deployable build at all. The customer app imports the identical
   package for the same purpose and has it correctly declared at
   `^4.7.5`; added the same version to the rider app's dependencies to
   match. Confirmed the fix: `apps/rider` now runs `npm install` and
   `vite build` cleanly, and its existing smoke test suite (2/2) still
   passes. Checked the admin and customer apps too — customer already
   had it, admin doesn't use sockets at all, so neither needed a
   change.

## Final verification

- Backend: `tsc --noEmit` — 0 errors. `npx jest` — 22/22 suites, 261/261
  tests passing. `npx eslint "src/**/*.ts"` — 0 problems.
- Business app: `npm run build` — succeeds, `AnalyticsCharts` still
  splits into its own lazy chunk as intended. Smoke test suite — 4/4
  passing.
- No duplicate declarations, no route/migration-index collisions
  introduced this session, no dead/unused imports found across any
  file touched or added.
