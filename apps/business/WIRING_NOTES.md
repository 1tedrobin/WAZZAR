# Business App — Wiring Notes

What's real, what's still a placeholder, and why. Written the way the
backend repo documents its own pieces (`CHANGES.md`, `PIECE_6_SUMMARY.md`)
— read this before assuming a screen does what it looks like it does.

## Wired to the real backend

- **Auth** — `POST /auth/register` (role `BUSINESS`), `POST /auth/login`,
  `GET /auth/me`. Unlike the customer app's OTP-flavored flow, this is a
  real login form: the merchant sets and types their own password. Session
  (access + refresh token, cached user) lives in `localStorage` under
  `wazzar_business_*` keys.
- **Orders = shipments** — `POST /shipments`, `GET /shipments`. Every
  order row is a real `Shipment` row, fetched and polled every 20s (no
  WebSocket wired up for this app in this pass — see "Known gaps" below).
- **Overview stats + weekly chart** — computed client-side in `App.jsx`
  (`statsFor`, `weeklyChartData`) from the real order list. Nothing here
  is hardcoded.
- **Pricing** — live quotes via `POST /pricing/calculate` in the New
  Delivery modal, using a real haversine distance between geocoded
  pickup/dropoff points. The shipment's authoritative price is still
  computed again by the backend at creation time.
- **Payments** — `POST /payments/initiate`. M-Pesa also calls the mock
  webhook shim (`simulateProviderConfirmation`, same pattern as the
  customer app) to move the shipment `QUOTED → CONFIRMED`, then
  `PATCH /shipments/:id/status` into `ASSIGNMENT_PENDING` so it actually
  enters the dispatch queue. Cash orders correctly stay at "Awaiting
  Payment" — they only move forward once someone calls
  `POST /payments/:id/collect-cash` for real, which is a rider/admin
  action this app doesn't have a screen for. `GET /payments/history`
  backs the Billing page (see "Newly wired, 2026-08-22 (later):
  Billing" below).
- **Geocoding** — real forward search via Nominatim (OpenStreetMap, free,
  no key), same helper the wired customer-app uses. Both pickup and
  dropoff require picking an actual search result before a delivery can
  be created — there's no such thing as an unresolved address in this
  app.

## Known, deliberate workaround

- **Recipient name/phone** — the `Shipment` entity has no field for this
  *anywhere* in the system (proof-of-delivery captures a recipient name,
  but only at the moment a rider marks `DELIVERED` — too late for an
  Orders list). This app stores `"Recipient: NAME · PHONE"` in
  `dropoffLocation.instruction` and parses it back out
  (`parseRecipient` in `App.jsx`). It's a real, working round-trip, not a
  fabrication — but a dedicated field on the backend would be the right
  fix, and this parsing should be deleted once it exists.
- **Package size → weight** — the UI's Small/Medium/Large buttons map to
  1 / 3 / 8 kg (`WEIGHT_KG_BY_SIZE`) since the backend only takes a
  `packageWeightKg` number, not a size enum. Placeholder numbers, not
  measured.
- **Rider name** — not shown. `riderId` has no BUSINESS-accessible
  lookup endpoint (`/riders/:id` is admin-only), so the Orders table and
  order detail modal show "Assigned" / "Not yet assigned" instead of a
  fabricated name.

## Newly wired, 2026-08-22: Customers (address book)

Previously local mock data (see the old note this replaces, below).
Now backed by a real `business_customers` table — see the backend's
`business-customers` module (`POST/GET /business/customers`,
`PATCH/DELETE /business/customers/:id`), all scoped server-side to the
calling business account (one business can never see or edit another's
address book, enforced in `BusinessCustomersService`, not just hidden
in the UI).

**Deliberately still NOT** a link to real platform `CUSTOMER` accounts —
this is a business's own saved recipients, who may not have a WAZZAR
account at all. And **deliberately missing** the old mock's "orders" /
"lastOrder" columns: `Shipment` has no recipient-phone field to match
an address-book entry against yet, so those would have been fabricated
numbers, not real ones. Linking shipments to address-book entries (so
"12 orders, last today" becomes real) is a natural follow-up, not done
here — see `CreateBusinessCustomersTable`'s migration comment for the
same note in the backend.

Full CRUD is wired in the UI: add (modal, real save), list (real
fetch, loading/error states), delete (real, with per-row confirmation
state). Editing an existing entry has a backend endpoint
(`PATCH /business/customers/:id`) but no UI trigger yet — only
add/list/delete have UI, since that's what the original mock screen
exposed; editing would be a small additive follow-up, not a gap in
what already existed.

## Newly wired, 2026-08-22: Staff (team roster)

Same treatment as Customers, second of the 4 previously-mock screens.
New backend module `business-staff`
(`POST/GET /business/staff`, `PATCH/DELETE /business/staff/:id`),
same ownership-scoping pattern as `business-customers`.

**Deliberately still NOT a real login/invite system.** "Invite staff"
adds a roster entry (always lands as `PENDING` status — see
`BusinessStaffService.create`'s comment) — no email is sent, and
nobody gets an actual WAZZAR account or login access from this. Giving
staff real, scoped login access would need a proper sub-account/
permission model (their session would need to inherit the parent
business's shipments but not its billing/settings, etc.) — a
meaningfully bigger feature than a roster table, and not built here.
The UI's `<DemoBanner>` on this page says so explicitly rather than
implying more than what's real.

What IS real: adding a roster entry, listing it, removing it, and
toggling a status pill between Active/Pending (calls the real
`PATCH` endpoint) — all backed by the real table, scoped so one
business can never see or edit another's roster.

## Newly wired, 2026-08-22 (later): Scheduled deliveries

Third and most involved of the 4 previously-mock screens — see
`docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md`'s 2026-08-22 entry for
the full backend writeup (new `scheduled-deliveries` module, entity,
migration, and a `@nestjs/schedule` cron job that's the actual reason
this one was harder than Customers/Staff). This app's side of it:

- **Full CRUD, same shape as Customers** — add (modal, real save),
  list (real fetch, loading/error states), toggle active/inactive
  (real `PATCH`, same busy-state pattern as Staff's status toggle),
  delete (real, per-row busy state). `mockData.js`'s
  `MOCK_BUSINESS_SCHEDULED` is gone.
- **The "New schedule" modal reuses `AddressField`** — the same
  geocoded-search input the New Delivery modal uses for pickup/dropoff,
  so a schedule's locations are real coordinates, not typed strings.
  Recurrence is a day-of-week multi-select (Sun–Sat) plus a time input;
  the time is always East Africa Time server-side regardless of the
  merchant's device timezone — see the backend note on why.
- **Next run / recurrence display is computed from real server data**
  (`describeRecurrence`, `fmtTimeOfDay`, `fmtNextRun` in `App.jsx`),
  not hardcoded strings like the old mock's `"Weekdays · 9:00 AM"`.
- **This app never "runs" a schedule.** There's no button anywhere in
  this UI that creates a shipment from a schedule directly — that only
  ever happens on the backend, once a minute, via the cron job. If a
  schedule's next run time passes while nobody has this app open, the
  shipment still gets created; it'll just show up in Orders next time
  someone loads the page.
- The New Delivery modal's old disabled "Schedule — Soon" button is now
  a real "Make recurring…" button that closes the modal and jumps to
  the Scheduled page — it doesn't carry over whatever pickup/dropoff
  was typed into the one-off modal, since a schedule's fields are
  edited fresh in its own modal, not prefilled from an unrelated draft.

**Not yet verified against a real backend** — same caveat as the
backend-side note: this sandbox couldn't `npm install` or run the app,
so this was hand-reviewed and syntax-checked (`esbuild`) against the
existing `AddressField`/`Modal`/`DataTable` components, not actually
clicked through in a browser.

## Newly wired, 2026-08-22 (later): Billing

Fourth and last of the previously-mock screens — see
`docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md`'s 2026-08-22 entry for
the full writeup. Unlike Scheduled deliveries, this needed **no new
backend module** — `GET /payments/history` already existed and was
already scoped server-side to the calling account, and a business
account's own payments already *are* its real per-delivery billing
history (a business is the `customerId` on every shipment/payment it
creates).

- **`BillingPage` now fetches real payment history** via a new
  `listPaymentHistory()` in `api.js`, with real loading/error states —
  `mockData.js`'s `MOCK_BUSINESS_INVOICES` is gone, and `mockData.js`
  itself is now an empty placeholder file (it had no other consumers
  left after this).
- **The fictional subscription framing is gone.** No more "Business
  Growth · TZS 45,000/month" plan card or "M-Pesa Business ····4471"
  masked account — replaced with a plain statement that WAZZAR bills
  per delivery, plus real summary stats computed client-side from the
  fetched payments (paid this month, most-used payment method,
  pending/awaiting count).
- **The payment history table is one row per real `Payment`**, each
  tied to a real `Shipment` — date, a short shipment reference, method
  (M-Pesa/Card/Cash), amount, and status. Status uses the real backend
  `PaymentStatus` enum (`PENDING`/`PROCESSING`/`COMPLETED`/`FAILED`/
  `REFUNDED`/`PARTIALLY_REFUNDED`/`PENDING_CASH_COLLECTION`), mapped to
  the same kind of short Pill label the rest of the app already uses
  (`COMPLETED` → "Paid", matching what "Paid" meant on the old fake
  invoice list, just per-delivery instead of per-month).
- **The old fake per-row "Download PDF"** (which only ever worked on
  fake `Paid` rows, and never produced a real file) is replaced with a
  real client-side CSV export of the actual fetched history. No backend
  export endpoint exists or was needed for this — it's generated
  entirely in the browser from data already on the page.
- **Fetches up to 100 most recent payments** (`GET
  /payments/history?limit=100` — the backend's documented max per
  page); there's no pagination UI yet for a business with more than 100
  payments in its history. Worth adding real pagination if that becomes
  a real constraint, but not built here.

**Not yet verified against a real backend** — same caveat as
Scheduled deliveries above: hand-reviewed and syntax-checked
(`esbuild`), not actually clicked through in a browser.

## Still demo data — not wired

None. As of this pass, all four originally-mock business screens
(Customers, Staff, Scheduled deliveries, Billing) are wired to real
backend data — see each "Newly wired" section above for what "wired"
means concretely for that screen, including the places each one is
honest about a real, remaining backend limitation (e.g. Staff isn't a
real login/invite system; Scheduled deliveries' cron job has never
been watched firing against a real database).

## Business profile (Settings)

Name / category / pickup address are saved to `localStorage`
(`wazzar_business_profile_<userId>`), not to the backend — there's no
business-profile table. The pickup address doubles as the default
pickup point for new deliveries; the first time it (or a fresh account)
gets used, the New Delivery modal makes the merchant re-confirm it via
the real address search so it's always backed by real coordinates, then
saves the resolved point back into the profile so it doesn't ask again.

## Known gaps worth flagging

- **Dev port collision**: this app's Vite dev server used to default to
  port 3000 — same as the backend's default (`PORT=3000` in
  `wazzar-backend/backend/.env.example`). You can't run both at once like
  that. Fixed here (now `3004`); the customer/rider/admin apps still have
  the same collision and would benefit from the same fix.
- **No live push** — order status changes (rider assigned, picked up,
  delivered…) show up via a 20-second poll, not a push. The backend does
  have a `/tracking` WebSocket namespace, but it's shaped around a single
  shipment's rider location, not a dashboard-wide order feed — wiring
  that up well is a separate piece, not something bolted on here.
- ~~**No active `PricingConfig` = broken quotes/creation**~~ — closed.
  Both `/pricing/calculate` and shipment creation depend on the backend
  having an active pricing config seeded; run `npm run db:seed:pricing`
  in `wazzar-backend/backend` once against a fresh database (see that
  repo's README) and the New Delivery modal's quotes/creation will work.
  If you still see a server error there against an *established*
  database, it's a real bug, not this known gap.
