# WAZZAR Admin Console — wiring notes

This app is wired to the **real** backend (`wazzar-backend/backend`), not
mock data. Read this before assuming a page is broken — several pages are
intentionally limited because the backend doesn't have the endpoint yet,
not because of a wiring bug.

## Run it

```bash
cp .env.example .env.local   # point VITE_API_URL at your backend if not localhost:3000
npm install
npm run dev                  # http://localhost:5174
```

The backend must already be running (`npm run dev` in `wazzar-backend/backend`,
default `http://localhost:3000`). Dev port here was moved to 5174 — the
original template had every WAZZAR frontend defaulting to port 3000, which
collides with the backend's own default port.

## You need an admin account first

The backend has **no admin self-signup**. `POST /auth/register` only
accepts `CUSTOMER`, `RIDER`, or `BUSINESS`. To get in, run the seed
script from the backend (see `backend/README.md`'s "Seeding the first
admin account" section for full details):

```bash
cd backend  # wazzar-backend/backend
SEED_ADMIN_PHONE=+255700000000 \
SEED_ADMIN_PASSWORD='Admin123!' \
npm run db:seed:admin
```

Then log in to this app with that phone/password. The script is
idempotent, so it's safe to re-run against the same database.

This is a real limitation of the backend as delivered, not something this
app can work around — see `wazzar-backend/backend/README.md`'s "Known
simplifications" notes on Piece 4. (Previously this required a manual
`INSERT INTO user_roles ...` — the seed script now does that safely
instead.)

## What's actually wired, page by page

| Page | Backed by | Notes |
|---|---|---|
| **Dispatch** | `GET /dispatch/queue`, `GET /dispatch/shipments/:id/candidates`, `POST /dispatch/shipments/:id/assign`, `POST /dispatch/shipments/:id/auto-assign`, plus Phase 2's `GET /legs/pending`, `GET /legs/active`, `POST /legs/:id/assign-rider`, `.../assign-carrier`, `.../start`, `.../complete`, `.../cancel` | Fully real. Local (Phase 1) dispatch — pending shipments, online riders, assign/auto-assign — plus an "Intercity (Phase 2)" section below it: pending local/trunk legs (click to assign a rider or carrier) and active legs (start/complete/cancel). See "Phase 2 — why it's here, not a separate app" below. |
| **Deliveries** | `GET /shipments/:id`, `GET /shipments/:id/history`, `GET /shipments/:id/proof-of-delivery`, `PATCH /shipments/:id/status` | **Lookup by ID only.** The backend's `GET /shipments` is hard-scoped to the caller's own `customerId` — there is no "list all shipments" route an admin can call. The page seeds quick-pick IDs from the dispatch queue since those are real IDs you can act on immediately. **ADMIN/SUPER_ADMIN only** — `ShipmentsService.assertCanAccess` doesn't grant DISPATCHER access to an arbitrary shipment, so this is hidden from DISPATCHER-only accounts (see the role-based nav note below) rather than shown and then 403ing. |
| **Riders** | `GET /riders/:id`, `PATCH /riders/:id/verify`, `PATCH /riders/:id/documents/:documentType`, plus the online-rider subset of `GET /dispatch/queue` | **Still no list endpoint** — an admin needs a rider's ID from elsewhere (support contact, onboarding record, the online-riders table) to look one up. Once looked up, the page shows document URLs, lets an admin verify the whole application, and approve/reject each document (ID, license, vehicle registration, insurance) independently with a rejection reason. Riders have no `name` field in the schema (just vehicle/license/rating), so they're shown by ID + vehicle everywhere. |
| **Finance** | `GET /payments/reconcile/:date`, `GET /payments/:id/status`, `POST /payments/:id/refund`, `POST /payments/:id/collect-cash` | Reconciliation is a real daily report. Refund/collect-cash are lookup-by-ID, same reason as Deliveries — no `GET /payments` list endpoint. |
| **Pricing** | `GET /pricing/configs`, `GET /pricing/active`, `POST /pricing/configs`, `PUT /pricing/configs/:id` | Fully real, full CRUD. This wasn't in the original 8-page plan but it's a genuine admin-only backend feature, so it's on the nav. |
| **Analytics** | `GET /payments/reconcile/:date`, called once per day for the last 7 days | The only time-series data the backend has. No city breakdowns, delivery-time averages, or retention — there's no analytics module for those. |
| **Support** | `GET /support/admin/tickets`, `GET /support/admin/tickets/:id`, `PATCH /support/admin/tickets/:id`, `POST /support/admin/tickets/:id/messages` | Fully real. Any CUSTOMER/RIDER/BUSINESS can raise a ticket via `/support/tickets`; this console filters/lists all of them, updates status/priority/assignment, and can reply or leave an admin-only internal note. |
| **Businesses** | `GET /admin/businesses`, `GET /admin/businesses/:id` | Real, read-only. Lists every BUSINESS-role account (there's no separate businesses table — it's users + user_roles, same as riders), with profile, staff count, and saved-customer count on the detail view. No suspend/edit action yet — see `admin-businesses.controller.ts` for why that's scoped out. |
| **Customers** | `GET /admin/customers`, `GET /admin/customers/:id` | Real, read-only, same shape as Businesses. `shipmentCount`/`completedShipmentCount`/`lastShipmentAt` stand in for the profile/staff stats since customers have no profile table. |
| **Hubs** *(Phase 2)* | `GET/POST/PATCH /hubs`, `GET/POST/DELETE /hubs/:id/staff` | Fully real, full CRUD. Clicking a hub opens one modal with both the edit form and its assigned-dispatcher staff list (add/remove by user ID) — no separate "staff" screen. |
| **Carriers** *(Phase 2)* | `GET/POST/PATCH /carriers`, plus `GET /partner-operators` to populate the operator picker | Fully real, full CRUD. Creating one requires at least one partner operator to already exist (disabled + a note if none do). Routes are a small repeatable from-city/to-city list, not a separate page. |
| **Partner Operators** *(Phase 2)* | `GET/POST/PATCH /partner-operators`, `POST /partner-operators/:id/rotate-key` | Fully real, full CRUD. Create and Rotate key both return a raw API key shown exactly once (`ApiKeyReveal` modal) — it cannot be fetched again afterward, matching the backend's own one-time-reveal design. |

## Phase 2 — why it's here, not a separate app

The original plan (see `WAZZAR_SYSTEM_ARCHITECTURE.md`) sketched Phase 2's
dispatcher-facing work as a separate app. It's built into this one
instead: `api.roleSummary()` already distinguished `isAdmin`/`isDispatcher`
before Phase 2 existed (Dispatch has always been reachable by a
DISPATCHER-only login), and the backend already treats ADMIN/SUPER_ADMIN
as a superset of DISPATCHER everywhere Phase 2 touches
(`LegsService.assertDispatcherHubAccess` bypasses hub-scoping entirely
for admins) — there was no backend reason to split the two into separate
frontends.

One real consequence: `NAV` now carries a `dispatcherVisible` flag, and
`AppShell` filters the sidebar by it (`isAdmin ? NAV : NAV.filter(n =>
n.dispatcherVisible)`). Today only **Dispatch** is `dispatcherVisible:
true`. Everything else — Deliveries included — is hidden from a
DISPATCHER-only login rather than shown and left to 403, because most of
it genuinely doesn't authorize DISPATCHER server-side (see the Deliveries
row above). Hubs/Carriers are DISPATCHER-*readable* on the backend but
kept out of the dispatcher-visible nav anyway — a hub-scoped dispatcher's
daily work is the Dispatch page itself, which already shows hub/route
names inline (`leg.fromLocation.address`/`toLocation.address`) without
needing the standalone management pages.

## Why the Customers/Businesses pages used to be stubbed, and no longer are

An earlier delivery for this app (see `ADMIN_APP_WIRING_SUMMARY.md`,
`WIRING_CHECKLIST.md` from the previous pass) assumed a `service.js` with
60+ endpoints across customers, businesses, support, and analytics. Only
8 controllers shipped in that pass (`auth`, `health`, `pricing`,
`riders`, `shipments`, `dispatch`, `payments`, `tracking`). Support,
Businesses, and Customers have since all been built for real (see the
rows above) — Customers was the last of the three; wiring the UI to a
URL that didn't exist yet would have looked done while silently 404ing,
so that page said plainly what was missing until the backend module
existed.

## What a full build-out would still need on the backend

For richer Analytics, or for Riders/Deliveries/Finance to become real
list pages instead of lookup-by-ID: an admin-scoped `GET` route that
isn't hard-limited to the caller's own records the way `GET /shipments`
and `GET /payments/history` are today. (Support, Businesses, and
Customers all followed the same shape when they were built — see
`backend/src/modules/support/`, `backend/src/modules/admin-businesses/`,
and `backend/src/modules/admin-customers/` for reference.) For Phase 2
specifically: no rider/carrier self-service (every leg action here is
DISPATCHER/ADMIN-only — see `docs/delivery-notes/PHASE2_INTERCITY_FOUNDATION.md`),
and no customer-facing "book an intercity shipment" flow anywhere yet —
`POST /shipments/intercity` exists but nothing in `apps/customer` calls it.

