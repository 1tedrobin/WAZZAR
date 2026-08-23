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
| **Dispatch** | `GET /dispatch/queue`, `GET /dispatch/shipments/:id/candidates`, `POST /dispatch/shipments/:id/assign`, `POST /dispatch/shipments/:id/auto-assign` | Fully real. Shows pending shipments and online riders, lets you assign or auto-assign. |
| **Deliveries** | `GET /shipments/:id`, `GET /shipments/:id/history`, `GET /shipments/:id/proof-of-delivery`, `PATCH /shipments/:id/status` | **Lookup by ID only.** The backend's `GET /shipments` is hard-scoped to the caller's own `customerId` — there is no "list all shipments" route an admin can call. The page seeds quick-pick IDs from the dispatch queue since those are real IDs you can act on immediately. |
| **Riders** | `GET /riders/:id`, `PATCH /riders/:id/verify`, `PATCH /riders/:id/documents/:documentType`, plus the online-rider subset of `GET /dispatch/queue` | **Still no list endpoint** — an admin needs a rider's ID from elsewhere (support contact, onboarding record, the online-riders table) to look one up. Once looked up, the page shows document URLs, lets an admin verify the whole application, and approve/reject each document (ID, license, vehicle registration, insurance) independently with a rejection reason. Riders have no `name` field in the schema (just vehicle/license/rating), so they're shown by ID + vehicle everywhere. |
| **Finance** | `GET /payments/reconcile/:date`, `GET /payments/:id/status`, `POST /payments/:id/refund`, `POST /payments/:id/collect-cash` | Reconciliation is a real daily report. Refund/collect-cash are lookup-by-ID, same reason as Deliveries — no `GET /payments` list endpoint. |
| **Pricing** | `GET /pricing/configs`, `GET /pricing/active`, `POST /pricing/configs`, `PUT /pricing/configs/:id` | Fully real, full CRUD. This wasn't in the original 8-page plan but it's a genuine admin-only backend feature, so it's on the nav. |
| **Analytics** | `GET /payments/reconcile/:date`, called once per day for the last 7 days | The only time-series data the backend has. No city breakdowns, delivery-time averages, or retention — there's no analytics module for those. |
| **Support** | `GET /support/admin/tickets`, `GET /support/admin/tickets/:id`, `PATCH /support/admin/tickets/:id`, `POST /support/admin/tickets/:id/messages` | Fully real. Any CUSTOMER/RIDER/BUSINESS can raise a ticket via `/support/tickets`; this console filters/lists all of them, updates status/priority/assignment, and can reply or leave an admin-only internal note. |
| **Businesses** | `GET /admin/businesses`, `GET /admin/businesses/:id` | Real, read-only. Lists every BUSINESS-role account (there's no separate businesses table — it's users + user_roles, same as riders), with profile, staff count, and saved-customer count on the detail view. No suspend/edit action yet — see `admin-businesses.controller.ts` for why that's scoped out. |
| **Customers** | `GET /admin/customers`, `GET /admin/customers/:id` | Read-only, same shape as Businesses. `shipmentCount`/`completedShipmentCount`/`lastShipmentAt` stand in for the profile/staff stats since customers have no profile table. |

## Why the unwired page isn't stubbed with fake data

An earlier delivery for this app (see `ADMIN_APP_WIRING_SUMMARY.md`,
`WIRING_CHECKLIST.md` from the previous pass) assumed a `service.js` with
60+ endpoints across customers, businesses, support, and analytics. Only
8 controllers shipped in that pass (`auth`, `health`, `pricing`,
`riders`, `shipments`, `dispatch`, `payments`, `tracking`) — support and
businesses have since been built for real (see the rows above) — but
Customers is still missing. Wiring the UI to a URL that doesn't exist
would have looked done while silently 404ing, so that page still says
plainly what's missing instead.

## What a full build-out would need on the backend

If/when Customers or richer Analytics get built, each needs (at
minimum): a TypeORM entity + migration, a service, a `@Controller` with
list/detail routes guarded by `@Roles(ADMIN, SUPER_ADMIN)`, and — for
Riders/Deliveries/Finance to become real list pages instead of
lookup-by-ID — an admin-scoped `GET` route that isn't hard-limited to
the caller's own records the way `GET /shipments` and
`GET /payments/history` are today. (Support and Businesses both followed
exactly this shape — see `backend/src/modules/support/` and
`backend/src/modules/admin-businesses/` for reference. Customers is the
odd one out: there's no existing "customers" entity to list at all —
CUSTOMER-role accounts today are just users with that role, same as
Businesses, so a Customers page would likely follow the exact same
users+user_roles pattern `admin-businesses.service.ts` already uses.)
