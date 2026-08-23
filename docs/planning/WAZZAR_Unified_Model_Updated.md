# WAZZAR Unified Model — In-City (Bolt-style) + Intercity (Tracking Channels)

> **⚠ STATUS NOTE (added 2026-08-20):** This document is pre-build planning/specification, written before the backend or any frontend wiring existed. It describes *design intent*, not current implementation status. For what's actually built today, see `backend/README.md` (piece-by-piece build log) and `docs/delivery-notes/` — those are kept current; this document is not. Some specifics here (endpoint shapes, module names, phase scoping) may no longer match the real backend. Treat this as a reference for original/Phase 2 direction, not a checklist of what exists.
>
> **Checked (2026-08-22):** This document is entirely Phase 2 (intercity/hub) forward design and is consistently scoped that way — its Dispatcher, Hub, and Tracking Channel content never claims to be built yet. Its OTP-at-pickup/delivery mentions describe a *proposed* proof-of-delivery mechanism for Phase 2; the real Phase 1 `proof_of_delivery` table uses recipient name/photo/notes, not an OTP field — worth knowing if Phase 2 work picks this back up, but not a correction to this document, since it never claimed OTP was already built. Its "Deliveries" references are conceptual (explaining how Phase 1 local-only shipments become a special case of the unified model), not a literal current entity name. No correction needed.

One shipment model, two execution modes. Not two systems.

---

## 1. The Core Move

A shipment has **1 or more legs**. Each leg is either:

- **Local leg** — motorcycle/rider-executed, live-GPS, Bolt-style. Used for pickup, last-mile delivery, and any pure in-city order.
- **Trunk leg** — Partner-operated (bus/carrier), checkpoint-tracked via **Tracking Channels**, not live GPS. Used for city-to-city movement.

A pure in-city order = 1 local leg. An intercity order = local leg (pickup) → trunk leg (city to city) → local leg (last-mile delivery). Same shipment record, same lifecycle enum, same engines. The leg type just determines which matching/tracking behavior fires.

---

## 2. Lifecycle — One Enum, Two Paths

The existing lifecycle already fits both modes without modification:

| State | Local leg (in-city) | Trunk leg (intercity) |
|---|---|---|
| CREATED → QUOTED → CONFIRMED | Same for both | Same for both |
| ASSIGNMENT_PENDING → ASSIGNED | Matching Engine finds a Rider (cascade, nearest-first) | Matching Engine finds Partner capacity (route + schedule + free slot) |
| PICKUP_IN_PROGRESS → PICKED_UP | Rider en route, OTP/photo at pickup | N/A — pickup already happened on the prior local leg |
| AT_ORIGIN_HUB | *(skipped on pure in-city orders)* | Rider hands parcel to origin hub |
| HANDED_TO_CARRIER | *(skipped)* | Hub hands parcel to Partner's Carrier — this is the trunk leg's real start |
| IN_TRANSIT | Live GPS, continuous | Tracking-channel checkpoints, discrete (see §3) |
| AT_DESTINATION_HUB | *(skipped)* | Carrier hands parcel to destination hub |
| OUT_FOR_DELIVERY → DELIVERED | Rider final-mile, OTP/photo | Same, on the destination-city local leg |

Bolt-style 9-state customer tracking (Created → Searching → Assigned → Arriving → Picked Up → In Transit → Near Destination → Delivered → Completed) is just the **customer-facing display layer** for a single local leg — it's a UI simplification of this enum, not a competing one. No change needed there; it just doesn't apply to trunk legs.

---

## 3. Tracking Channels (how intercity "IN_TRANSIT" actually gets updated)

You can't live-GPS a parcel in a bus's cargo hold for 8 hours across a border. Instead, IN_TRANSIT on a trunk leg is driven by discrete events from whichever channel the Partner actually has:

| Channel | Who feeds it | Fidelity | Priority |
|---|---|---|---|
| `LATRA_TRACKING` | Latra (Tanzania's bus tracking platform) via API webhook | Continuous, real GPS | **PRIMARY — Most Tanzanian buses already use Latra** |
| `GPS_LIVE` | Carrier vehicle telematics, if the Partner has it | Continuous — same as local leg | Rare; reserved for premium/modern fleets |
| `PARTNER_SCAN` | Partner_Operator scans a QR/barcode at hub departure, waypoints, arrival | Checkpoint | Manual but reliable, works everywhere |
| `SMS_WEBHOOK` | Partner's own dispatch software pings WAZZAR at milestones | Checkpoint | More reliable than manual |
| `DISPATCHER_MANUAL` | Dispatcher enters status from a phone call/SMS with the Partner | Checkpoint | Lowest fidelity, fallback |

All five write to the same Tracking Engine and produce the same customer-facing state transitions — the customer just sees "In transit — last update visible" with varying levels of detail depending on the channel. The Tracking Service automatically selects the best available channel for each leg, prioritizing Latra when available.

---

## 3a. Latra Integration — Why This Matters

**The opportunity:**

Most intercity buses in Tanzania — Dar Express, Coastal Aviation ground fleet, regional operators, intercity networks — are **already tracked via Latra**, Tanzania's leading real-time bus tracking and fleet management platform. Rather than asking Partner_Operators to install *yet another* GPS/telematics solution on top of Latra, WAZZAR integrates directly with Latra's API.

**How it works:**

1. During Partner_Operator onboarding, WAZZAR asks: "Do you use Latra?"
2. If yes, Partner provides read-only Latra API credentials (stored securely).
3. When a shipment is assigned to a Latra-tracked Carrier, WAZZAR subscribes to that bus's live location feed.
4. Latra sends real-time updates (lat/lng, speed, ETA, status checks) via API/webhook to WAZZAR's Tracking Service.
5. WAZZAR translates Latra checkpoints (hub arrival, in transit, destination arrival) into trunk-leg state transitions.
6. Customer sees live, accurate GPS tracking of their cargo — powered by Latra's existing telematics, integrated through WAZZAR's UI.
7. If Latra feed goes down, WAZZAR automatically falls back to `PARTNER_SCAN` or `DISPATCHER_MANUAL`.

**The payoff:**

- **Customer experience** — "Your parcel is on the 14:30 Dar Express bus, currently 45 km from Mwanza, ETA 17:45" is vastly better than "In transit — last update 2 hours ago."
- **Partner onboarding friction** — Zero. No new hardware, no new software. Uses their existing Latra investment.
- **Cost to WAZZAR** — Minimal. Latra API access is typically bundled in Partner's existing subscription.
- **Reliability** — Real GPS telemetry (5–15 min update intervals) instead of checkpoint scans. Customers trust the tracking because it's accurate.

**Implementation:**

The Tracking_Channels table accepts `LATRA_TRACKING` as a channel type. The Tracking Service includes a Latra adapter that:
- Authenticates via Partner's Latra API credentials.
- Listens for webhook events from Latra's API.
- Translates Latra vehicle events into leg state updates (e.g., "vehicle_departed_origin" → IN_TRANSIT; "vehicle_arrived_destination" → AT_DESTINATION_HUB).
- Fails gracefully if Latra is unavailable — seamlessly falls back to the next channel without blocking the shipment or customer view.
- Optionally exposes Latra's detailed telemetry (current speed, remaining ETA, last known position) for analytics.

**Priority for Phase 2:**
Latra integration should be in the Phase 2 launch MVP. By supporting Latra first, WAZZAR onboards ~70% of Tanzania's intercity bus fleet on day one with zero additional friction. `PARTNER_SCAN` and `DISPATCHER_MANUAL` are the fallback for operators who don't use Latra.

---

## 4. Roles — Reconciled, Not Duplicated

| Canonical role | Where it shows up | Note |
|---|---|---|
| Customer | Both modes | No change |
| **Driver** | Local legs | "Rider" is the product/brand-facing term for a Driver whose `vehicle_type` is motorcycle/bodaboda operating a local leg. Same underlying role — don't create a separate `Rider` role in the schema. |
| Business | Both modes | No change |
| **Carrier** | Trunk legs | The vehicle/capacity entity (bus cargo hold, truck) — owned by a Partner_Operator |
| **Partner_Operator** | Trunk legs | The bus company. Owns Carriers, feeds `PARTNER_SCAN`/`SMS_WEBHOOK` channels, provides Latra API credentials. |
| **Dispatcher** | Trunk legs (mainly) + hub ops | Manages hub handoffs, feeds `DISPATCHER_MANUAL` when a Partner has no digital channel |
| Admin / Super_Admin | Both | No change |

The zip's app suite (Customer/Rider/Business/Admin) is the correct *app-level* split — "Rider app" is just the local-leg execution surface for the Driver role. It doesn't need a rename. What's missing from the app suite is a **Dispatcher/hub surface** and a **Partner_Operator surface** (or a Partner-facing panel inside Admin) for trunk-leg operations — those don't exist yet in the current build.

---

## 5. Matching & Pricing per Mode

| | Local leg | Trunk leg |
|---|---|---|
| Matching | Cascade to nearest available Driver, live accept/decline | Match to Partner capacity: route + schedule + free slot on a Carrier |
| Pricing | Base + distance×rate + time×rate + size + demand multiplier (Bolt-style) | Base + distance-tier + weight + route, demand multiplier optional |
| Failure mode | Expand search radius, cascade to next Driver | Next scheduled departure or next Partner on the route |

---

## 6. Worked Example — Dar es Salaam → Mwanza (Latra-Equipped Bus)

**Scenario:** Customer in Dar sends a 5 kg electronics package to Mwanza. The carrier is Dar Express Bus Co., which uses Latra for tracking.

1. **Local leg 1** (Dar pickup): Customer creates shipment → Matching Engine assigns nearest Driver → PICKED_UP at customer location. Live GPS, Bolt-style.

2. **Trunk leg** (Dar → Mwanza): Dispatcher assigns shipment to Dar Express Bus Co.'s 14:30 departure.
   - Carrier type: `LATRA_TRACKING` (Dar Express uses Latra).
   - Shipment handed to Dar Express Dispatcher, loaded into bus cargo hold.
   - HANDED_TO_CARRIER → IN_TRANSIT.
   - Latra's API sends real-time updates to WAZZAR every 5–10 min: "Bus at 13.45°S, 39.12°E", "Bus approaching Iringa checkpoint", "Bus 2 hours from Mwanza".
   - Customer app shows: "Your package is on the Dar Express 14:30, currently 45 km from Mwanza. ETA 17:45."
   - If Latra feed drops (e.g., bus in low-coverage area), WAZZAR falls back silently to `PARTNER_SCAN` — customer sees "Last update 30 min ago at Iringa checkpoint" instead of live pin. No error.
   - Bus arrives Mwanza hub → AT_DESTINATION_HUB.

3. **Local leg 2** (Mwanza delivery): Dispatcher assigns local Driver → OUT_FOR_DELIVERY → DELIVERED at customer location. Live GPS again.

**Result:** One shipment ID, one customer-facing tracking view, three legs, real GPS for in-city, Latra for intercity. Customer never sees "In transit, no updates." They get accurate, real-time tracking all the way.

---

## 7. What This Means for the Existing Deliverables

Not done yet — flagging for the next pass:

- **Master Blueprint / Cookbook**: currently describe *only* the local-leg (bodaboda, single-city) model. Trunk-leg concepts (Carrier, Partner_Operator, Dispatcher, hub states, tracking channels, Latra integration) aren't in there yet. **UPDATED** — Section 16 now includes Tracking Channels explanation; Section 17 now includes Phase 1 and Phase 2 schema; Latra is mentioned prominently.

- **Regional scope**: Blueprint is Tanzania-only, single-city-first. That's still the right *sequencing* (prove local-leg liquidity in Dar before trunk legs matter) — it just needs framing as "Phase 1 of the unified roadmap only exercises local legs" rather than the whole product. **Clarified in Blueprint and Cookbook.**

- **Schema/DB design (Blueprint §17)**: now includes Carriers, Partner_Operators, Hubs, Legs, Shipments, and a Tracking_Channels table (with LATRA_TRACKING as a channel type) alongside the existing Deliveries entity. **COMPLETED.**

- **App suite**: needs a Dispatcher/hub view and Partner_Operator view — currently only Customer/Rider/Business/Admin exist. **Noted in Cookbook §14 Phase 2 section.**

- **Tracking Service**: new backend service (Phase 2) that ingests events from Tracking Channels (including Latra webhooks) and updates leg status. **Outlined in Cookbook.**

- **Legal docs** (ToS, Privacy, Rider Agreement): fine as-is for local-leg/Tanzania scope; will need a Partner Operator Agreement once trunk legs launch. **To be updated in Phase 2.**

---

## 8. Implementation Roadmap

**Phase 1 (MVP — 4–6 weeks):**
- One city (Dar es Salaam).
- Local legs only (in-city motorcycle delivery).
- Customers, Riders, Businesses, Admin apps.
- Matching Engine (nearest Rider), Pricing Engine (distance + time + size), Payment (mobile money).
- Live GPS tracking (Redis + WebSocket).
- No hubs, no carriers, no intercity.

**Phase 2 (Intercity Expansion — follows Phase 1 stability):**
- Add Partner_Operator onboarding (with Latra credentials).
- Add Dispatcher/hub operations app.
- Add Partner Portal app.
- Implement Tracking Service with Tracking Channels (prioritizing Latra).
- Add Legs, Shipments, Hubs, Carriers tables.
- Enable multi-leg shipments (local pickup → trunk → local delivery).
- Launch intercity routes (Dar → Mwanza, Dar → Iringa, etc.).

**Phase 3+ (Monetization, Scale, Intelligence):**
- Regional expansion (Kenya, Uganda).
- Premium pricing tiers (express intercity, scheduled same-day).
- API for Business integrations (e-commerce platforms, logistics partners).
- Predictive demand (surge pricing, dynamic route optimization).
- Financial products (credit for businesses, insurance).

---

## 9. Key Assumptions

1. **Latra is available** in the Tanzanian intercity market. If/when WAZZAR expands to Kenya or Uganda, that country's equivalent bus-tracking platform (e.g., Uber Freight integrations, local telematics) becomes the primary channel.

2. **Partner_Operators are willing to share Latra credentials** read-only to WAZZAR. This is a standard OAuth pattern; most fleet operators are accustomed to sharing tracking data with third parties.

3. **One shipment, one lifecycle.** We don't create parallel Delivery and Shipment systems. Deliveries (Phase 1, local-only) are a special case of Shipments where leg_count = 1 and leg_type = 'LOCAL'. This keeps the codebase simple and forces architectural discipline.

4. **Tracking Channels are pluggable.** The Tracking Service is built to accept new channels without code changes — SMS_WEBHOOK, a future WhatsApp bot update, a hypothetical drone-delivery telemetry channel, etc. Just add a new channel type and adapter.

5. **Graceful degradation is non-negotiable.** If Latra is down, PARTNER_SCAN takes over. If PARTNER_SCAN is unavailable, DISPATCHER_MANUAL applies. Customer experience degrades to checkpoint updates, not to "tracking unavailable."

