# Customer App — Wiring Notes

What's real, what's still a placeholder, and why. Same purpose as
`apps/business/WIRING_NOTES.md` and `apps/admin/README_ADMIN_WIRING.md` —
read this before assuming a screen does what it looks like it does. This
app didn't have one until now even though it's fully wired; this fills
that gap.

## Run it

```bash
cp .env.example .env.local   # point VITE_API_URL at your backend if not localhost:3000
npm install
npm run dev                  # http://localhost:5173
```

## Wired to the real backend

- **Auth — phone-number login, OTP screen is real UX but not a real SMS
  check.** The backend has no SMS/OTP endpoint (see
  `MASTER_GAPS_AND_ROADMAP.md`) — phone+password register/login is what
  actually exists (`POST /auth/register` role `CUSTOMER`, `POST
  /auth/login`). `loginOrRegister()` in `api.js` derives a fixed
  per-phone-number password (`devicePasswordFor`) so the same phone
  reliably logs back into the same account on the same device, tries
  login first, and falls back to register on a 401. This is a known
  simplification standing in for real OTP, not a security model — a real
  SMS provider integration would replace this function, not the OTP
  screen's UX.
- **Shipments** — `POST /shipments` creates the real order;
  `GET /shipments/:id` polls it every 3 seconds while on the matching or
  tracking screen (`STATUS_TO_STEP` maps the real backend `ShipmentStatus`
  enum onto the app's 9-step UI timeline — no fake step advancement,
  whatever it shows is whatever the backend reports at that instant).
  `PATCH /shipments/:id/status` is called twice by this app itself, not
  a backend automation: once to push a paid shipment into
  `ASSIGNMENT_PENDING` (`requestDispatch`, standing in for a dispatcher/
  auto-assign rule this pass doesn't have a UI for) and once to close
  `DELIVERED` → `COMPLETED` (`completeShipment`, fired the moment the
  poll above observes `DELIVERED`).
- **Pricing** — live quotes via `POST /pricing/calculate` (public, no
  auth) using a real distance between geocoded pickup/dropoff points; the
  shipment's authoritative price is still computed again by the backend
  at creation time, same as the business app.
- **Payments** — `POST /payments/initiate`. See "Known, deliberate
  workaround" below for the webhook shim, which is the one genuinely
  fake piece of this flow.
- **Live tracking — real GPS with a graceful simulated fallback, not a
  full simulation.** `subscribeToShipmentTracking()` opens the backend's
  `/tracking` Socket.IO namespace and subscribes to the shipment's room;
  the moment the assigned rider's app sends a real GPS ping
  (`POST /rider/location` server-side), `liveRiderLocation` becomes real
  coordinates and the map marker switches to it. Until then — or if the
  socket can't connect, or the rider hasn't sent a fix yet — `
  getRiderPosition()`'s old lerp-along-the-route simulation still runs,
  purely so the map never looks empty or frozen. This is the one screen
  where "wired" and "still simulated" are both true at once, depending on
  whether a real rider happens to be pinging yet.
- **Rider info on the tracking screen** — `GET /riders/:id/public` (no
  auth) once `shipment.riderId` is set. Real name/vehicle/rating; falls
  back to a generic "Rider" placeholder object only while unassigned or
  if the fetch fails, not fabricated data pretending to be real.
- **Rider rating** — `POST /shipments/:id/rate-rider`, one rating per
  shipment, fires only when the customer picks stars and taps Submit
  (never on Skip).
- **Geocoding (forward search)** — `GET /geocode/search`, the backend's
  Nominatim adapter, for the pickup/dropoff address-search-as-you-type
  list. Previously called Nominatim directly from the browser; now
  routed through the backend.

## Known, deliberate workaround

- **Payment webhook shim** — MPESA/STRIPE payments only really complete
  when the provider calls `POST /payments/webhooks/{mpesa,stripe}`
  directly, server-to-server, never from a browser. Both providers are
  mocked on this backend (fake transaction IDs, no real Daraja/Stripe
  account), so there's no real callback coming. To keep the demo flow
  moving, `simulateProviderConfirmation()` fires that same webhook call
  itself, right after `initiatePayment()` — clearly a demo-only shim
  (a browser confirming its own payment is not a real confirmation of
  anything), not something a production client should ever do. The
  M-Pesa body it sends is shaped like a real Daraja STK Push callback,
  matching what the backend's `MpesaWebhookDto` actually validates now
  — not a simplified fake shape. **CASH has no webhook at all** — a cash
  order correctly stays `PENDING_CASH_COLLECTION` until a rider or admin
  calls `POST /payments/:id/collect-cash` for real, which is exactly
  what should happen; this app has no screen for that action (it's a
  rider/admin one).
- **Reverse geocoding stays a direct Nominatim call**, not routed through
  the backend — same as the business app's note on this. The backend
  only exposes forward search (`GET /geocode/search`); turning a dragged
  map pin back into an address text still calls Nominatim's `/reverse`
  straight from the browser (`reverseGeocode()` in `App.jsx`).
- **Stripe card payments use a hardcoded fake token** (`tok_demo_visa`)
  — there's no real Stripe Elements card-entry form wired up in this
  pass, so a "card" payment never collects a real card number. Consistent
  with the backend's Stripe integration being mocked too (see Payments
  live verification in `MASTER_GAPS_AND_ROADMAP.md`).

## Still local-only, not backend-backed

- **`mockData.js` is dead code** — nothing in `App.jsx` imports it
  anymore (every screen that used to read `MOCK_RIDER`/`MOCK_CUSTOMER`/
  etc. now reads real fetched data instead). Same end state as the
  business app's `mockData.js`, which was emptied out for the same
  reason; this one just hasn't been deleted yet. Safe to delete outright
  rather than emptying it — nothing references it.

## Known gaps worth flagging

- **No live push for order-status changes on this screen either** —
  functionally fine here since the 3-second poll is tight enough for an
  active delivery to feel responsive, unlike the business app's 20-second
  dashboard poll, but it's still a poll, not a push, and burns a request
  every 3s per open tracking screen.
- **One rider-position source of truth, two code paths** — the real-GPS/
  simulated-fallback split described above works, but means the map's
  actual behavior on any given order depends on whether the assigned
  rider's device has sent a GPS ping yet, which isn't something this app
  can predict or communicate to the customer ("is this the real rider
  position or not?" has no UI answer right now).
- **Device-derived password auth (see "Auth" above) is a real gap, not
  just a naming quibble** — anyone who knows (or guesses) a phone number
  can derive `devicePasswordFor(phone)` themselves and log into that
  account from a different device, since the "password" isn't a secret
  the customer ever chose or was shown. Fine for this pass's demo
  purposes; not something to ship without real OTP or a real
  customer-chosen password.
