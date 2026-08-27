# Rider App — Wiring Notes

What's real, what's still a placeholder, and why. Same purpose as
`apps/customer/WIRING_NOTES.md`, `apps/business/WIRING_NOTES.md`, and
`apps/admin/README_ADMIN_WIRING.md` — read this before assuming a screen
does what it looks like it does. This app didn't have one until now even
though it's fully wired; this fills that gap.

## Run it

```bash
cp .env.example .env.local   # point VITE_API_URL at your backend if not localhost:3000
npm install
npm run dev                  # http://localhost:5175
```

The backend must already be running (`npm run dev` in
`wazzar-backend/backend`, default `http://localhost:3000`).

## Wired to the real backend

- **Auth — phone-number login, OTP screen is real UX but not a real SMS
  check.** Same known simplification as the customer app: the backend has
  no SMS/OTP endpoint (see `MASTER_GAPS_AND_ROADMAP.md`) — phone+password
  register/login is what actually exists (`POST /auth/register` role
  `RIDER`, `POST /auth/login`). `loginOrRegister()` in `api.js` derives a
  fixed per-phone-number password (`devicePasswordFor`) so the same phone
  reliably logs back into the same account, tries login first and falls
  back to register on a 401. A separate `wazzar_rider_*` localStorage key
  namespace means the same phone number can hold both a CUSTOMER and a
  RIDER account without colliding.
- **Rider onboarding / profile** — `GET /riders/me` (returns `null`, not
  a thrown error, when no profile exists yet, so the app can branch
  cleanly into the onboarding flow) and `POST /riders` to create one,
  carrying vehicle type, registration, licence number, insurance expiry,
  and four real document URLs.
- **Document uploads** — real multipart upload via `POST /uploads` for
  all four onboarding documents (ID, licence, vehicle registration,
  insurance) and for proof-of-delivery photos. Previously fake toggle
  buttons that went nowhere (see `MASTER_GAPS_AND_ROADMAP.md`, "File/photo
  upload endpoint") — now genuinely uploads and stores the returned URL.
- **Availability** — `POST /riders/availability/online` /
  `.../offline`, called from the online/offline toggle.
- **Available deliveries queue** — `GET /shipments/available`, the open
  `ASSIGNMENT_PENDING` queue (added alongside this app; the backend
  previously had no rider-facing equivalent to the admin/dispatcher
  queue), polled every 4s while online and not already on a delivery.
- **Accepting a delivery** — `POST /shipments/:id/assign`. Can return a
  409 if another rider claimed it first — the app treats that as "someone
  else got it," not a hard error.
- **Delivery progress** — `PATCH /shipments/:id/status` drives the
  forward chain (`ASSIGNED → PICKUP_IN_PROGRESS → PICKED_UP → IN_TRANSIT
  → OUT_FOR_DELIVERY`), each tap a real transition, not a local-only step
  advance.
- **Proof of delivery** — `POST /shipments/:id/deliver` with recipient
  name, a real uploaded photo URL, and notes — its own dedicated endpoint
  (not the generic status PATCH) because it writes the proof-of-delivery
  row atomically. `COMPLETED` afterward is a plain status PATCH, same
  pattern as the customer app's `completeShipment`.
- **Live GPS tracking** — real browser geolocation
  (`navigator.geolocation`, high-accuracy mode), sent to the backend via
  `POST /rider/location` every 20 seconds while online and a GPS fix is
  available. This is the other end of the customer app's live-tracking
  socket: a real ping here is what turns the customer's map marker from
  simulated to real. If the rider is offline or has no GPS fix yet, no
  pings are sent — the customer app's simulated-fallback path is what
  covers that gap on the other side, not anything this app fakes.
- **Cash collection** — `GET /payments/by-shipment/:id` looks up the
  shipment's payment (new endpoint, added alongside this pass — the
  shipment itself never carried a paymentId, which was the actual
  blocker before), and `POST /payments/:id/collect-cash` confirms it.
  Surfaced on the post-delivery "Complete" screen: if the shipment's
  payment is CASH and still `PENDING_CASH_COLLECTION`, a "Mark cash
  collected" card appears with the amount due. Deliberately
  non-blocking — a rider can still tap "Back online" without
  confirming, so a failed lookup or a rider who forgets doesn't get
  trapped on the screen; it's a prompt, not a gate.
- **Earnings / wallet** — `GET /riders/me/earnings`, one real row per
  delivered/completed shipment payout (added alongside this app; the
  backend had no rider-facing earnings read before).

## Known, deliberate workaround

- **OTP "verify" step** — same known simplification as the customer app:
  the screen is real UX, but what actually authenticates is the derived
  device password described above, not a real SMS code.
- **Withdraw button is UI-only** — the wallet screen shows real payout
  history, but "Withdraw" has no backend endpoint to call (no withdrawal
  module exists yet), so it stays a demo action. Same known-simplification
  style as the customer app's own payment-webhook self-call — not hidden,
  just not wired to anything real yet.

## Still local-only, not backend-backed

None — unlike the customer and business apps at earlier points in their
history, this app has no `mockData.js` and no local-only screens left to
flag. Everything above is either genuinely wired or an explicitly-labeled
demo action.

## Known gaps worth flagging

- **No live push for the available-deliveries queue or delivery
  progress** — both are polls (4s and — for delivery detail — a separate
  poll elsewhere in the app), not pushes, same tradeoff the other three
  apps make in their own polling loops.
- **Device-derived password auth is a real gap, not just a naming
  quibble** — same caveat as the customer app: anyone who knows or
  guesses a phone number can derive `devicePasswordFor(phone)` and log
  into that rider account from a different device, since the "password"
  isn't a secret the rider ever chose or was shown. Fine for this pass's
  demo purposes; not something to ship without real OTP or a
  rider-chosen password.
