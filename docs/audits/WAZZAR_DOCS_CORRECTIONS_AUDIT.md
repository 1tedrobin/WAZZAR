# WAZZAR Docs Corrections Audit

**Purpose:** line-item corrections needed to bring six documents — Master Blueprint, Engineering Cookbook, Rider Ops Playbook, Terms of Service, Privacy Policy, Rider Partner Agreement — into agreement with **one single source of truth: the code actually running in this repo** (`backend/backend/src`, `apps/*`), not any prior planning doc.

**Working assumption, stated so it can be corrected:** "reflect on 1 thing" is read here as *one ground truth to reconcile everything against*, and the codebase is the only thing in this repo that's unambiguous and verifiable — so that's the anchor. The separate question of *vision* — legacy single-city motorcycle vs. the multi-leg intercity model in `docs/planning/WAZZAR_Unified_Model_Updated.md` — is resolved at the end of this audit: both are in scope, as sequential phases, not a choice between them.

Documents audited live in:
- `docs/legal/` — Terms of Service, Privacy Policy, Rider Partner Agreement
- `docs/planning/legacy-v1/` — Master Blueprint, Engineering Cookbook, Rider Ops Playbook

Ground truth evidence cited below is all from `backend/backend/src/`.

---

## 1. Terms of Service (`docs/legal/WAZZAR_Terms_of_Service.docx`)

| # | Current text | Correction needed | Evidence |
|---|---|---|---|
| 1.1 | §2 defines "Delivery" as the core transactional term throughout the document | Rename to "Shipment" throughout, matching the actual entity/API name | `shipment.entity.ts`, `shipments/` module — no "Delivery" anywhere in code |
| 1.2 | §5: "Accounts are created and verified by phone number" (implies OTP verification) | Rewrite: accounts are created with phone number **and password**; there is currently no OTP/SMS verification step | `User` entity — `passwordHash` required column; code comment: *"Phase 1 skips OTP/phone verification... Users land straight in ACTIVE on register"* |
| 1.3 | §7 implies mobile money broadly, cards, and cash on delivery are all live payment options | Correct to: cash and M-Pesa (mocked, not a live SDK) and Stripe (mocked) are the only implemented methods today; no business invoice billing path exists yet | `PaymentMethod` enum = `MPESA`, `STRIPE`, `CASH` only; README notes providers are mocked |
| 1.4 | §10 Business Accounts described as a separate account type with staff users | Note that in the data model, Business is a `Role` value on the same `User`/`UserRole` table as Customer/Rider/Admin, not a separate account entity | `user-role.entity.ts` — `Role` enum includes `BUSINESS` |
| 1.5 | §12 (Data Protection) footnote: *"a standalone Privacy Policy should be drafted alongside these Terms"* | Delete — the Privacy Policy already exists as its own document | Stale placeholder left over from initial drafting |
| 1.6 | Whole document assumes a single Rider completes one motorcycle delivery end-to-end | Add a note (or new clause) that intercity/trunk-leg liability via a bus-partner Carrier is **not yet defined anywhere in this document** — flag as an open item for legal review once Phase 2 scope is confirmed, not something to silently imply is covered | No `Carrier`/`Partner_Operator`/`Leg` concept exists in code or legal text |

---

## 2. Privacy Policy (`docs/legal/WAZZAR_Privacy_Policy.docx`)

| # | Current text | Correction needed | Evidence |
|---|---|---|---|
| 2.1 | §2 "Payment data" row lists mobile money account reference generically | Correct to name M-Pesa specifically (the only mobile money provider actually integrated, and only as a mock) | `PaymentMethod.MPESA` only |
| 2.2 | Document is a byte-identical duplicate of a second uploaded copy | Delete the duplicate source file wherever it's stored outside this repo — only one copy now lives in `docs/legal/` | N/A — housekeeping |
| 2.3 | §2 "Identity data" mentions date of birth "where required" | Confirm against the actual `User` entity whether DOB is a collected field at all today, and remove/adjust if it isn't yet implemented | Check `user.entity.ts` — no DOB column currently present |

---

## 3. Rider Partner Agreement (`docs/legal/WAZZAR_Rider_Partner_Agreement.docx`)

| # | Current text | Correction needed | Evidence |
|---|---|---|---|
| 3.1 | §7 Fees, Payment, and Payout — describes wallet, commission, and payout to mobile money/bank | Confirm wallet/payout mechanics match `payment.entity.ts` and `pricing-config` — align commission-rate language with however `PricingConfig` actually models commission today rather than leaving it fully generic | `payment.entity.ts`, `pricing-config` entity |
| 3.2 | Entire Agreement is written for a single independent Rider on a motorcycle | Same gap as ToS 1.6 — no legal language exists yet for a bus-partner Carrier role, even though the code's `Role` enum already includes `DISPATCHER`, added specifically to prepare for "Phase 2 (intercity/trunk legs)" | `user-role.entity.ts` code comment re: `DISPATCHER` |

---

## 4. Master Blueprint (`docs/planning/legacy-v1/WAZZAR_Master_Blueprint.docx`)

| # | Current text | Correction needed | Evidence |
|---|---|---|---|
| 4.1 | §1/§4 brand story: *"WAZZAR (Swahili for 'send')"*, tagline *"Nitumie kupitia Wazzar"* | This is a leftover from the mechanical TUMA→WAZZAR rename — "Wazzar" is not a Swahili word. Needs a human-written replacement brand story, not a substitution | Rename script cannot fix linguistic content |
| 4.2 | §8 auth flow: *"Phone number authentication (OTP-based, no password to remember)"* | Rewrite to match actual Phase 1 auth: phone + password, no OTP yet | Same as ToS 1.2 |
| 4.3 | §8 customer-facing delivery lifecycle: 9 states (Created → Searching Rider → Rider Assigned → Rider Arriving → Package Picked Up → In Transit → Near Destination → Delivered → Completed) | Replace with the actual 12-value `ShipmentStatus` enum: CREATED, QUOTED, CONFIRMED, ASSIGNMENT_PENDING, ASSIGNED, PICKUP_IN_PROGRESS, PICKED_UP, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, COMPLETED, CANCELLED | `shipment-status.transitions.ts` |
| 4.4 | §16 Technical Architecture lists 10 separate services: Auth, User, Delivery, Matching, Pricing, Location, Payment, Notification, Messaging, Analytics | Replace with actual structure: one NestJS app, modules for `auth`, `shipments`, `riders`, `dispatch`, `tracking`, `payments`, `pricing`, `health`. No standalone User service (folded into auth/riders). **Notification, Messaging, and Analytics modules don't exist yet** — mark as not-yet-built rather than implying they're live | `backend/backend/src/modules/` directory listing |
| 4.5 | §7 Payments section lists M-Pesa, Tigo Pesa/Mixx, Airtel Money, HaloPesa, cards, cash, business invoicing | Correct to the 3 actually implemented: MPESA (mocked), STRIPE (mocked), CASH. Remove Tigo Pesa, Airtel Money, HaloPesa, and business invoicing until built | `PaymentMethod` enum |
| 4.6 | No mention of a Dispatcher role anywhere in the user-roles section | Add DISPATCHER as a defined role, noting it exists in code today specifically to prepare for Phase 2 intercity dispatch | `Role` enum |
| 4.7 | Scope is single-city (Dar es Salaam), motorcycle-only, with intercity/regional pushed to Phase 3–4 | Do not silently rewrite this — see the open decision at the bottom of this audit. The database schema currently *matches* this single-leg scope (no `Leg`/`Carrier` tables exist yet), so this section is not wrong about what's built, only potentially out of date with product direction | `shipment.entity.ts` — no leg/carrier tables |

---

## 5. Engineering Cookbook (`docs/planning/legacy-v1/WAZZAR_Engineering_Cookbook.md`)

| # | Current text | Correction needed | Evidence |
|---|---|---|---|
| 5.1 | Mobile stack: Flutter for both Customer and Rider apps | Correct to: plain React + Vite web apps for all four surfaces (Customer, Rider, Admin, Business). No Flutter, no React Native, no native mobile app exists | `apps/` directory — all four are Vite/React projects |
| 5.2 | Repo layout: `services/` directory with ~10 independent microservices | Correct to: single `backend/backend/` NestJS app with a `modules/` directory (modular monolith), not separate deployable services | `backend/backend/src/modules/` |
| 5.3 | Team structure: fixed 6-person team (1 Integration Lead + 5 builders), formal branching/merge-window/ADR process | No evidence this process is running — delivery notes (`docs/delivery-notes/PIECE_6_SUMMARY.md` etc.) read as incremental, small-batch delivery, not a 6-person parallel workflow. Either mark this section as aspirational/not-yet-adopted, or confirm with the team whether it should be corrected or kept as a target | `docs/delivery-notes/` |
| 5.4 | Sprint 1 tasking gives Customer app, Rider app, and Business dashboard equal build priority | Correct to actual build order: Customer and Admin apps wired to the real backend first; Rider and Business apps are still UI-only on mock data | `apps/rider`, `apps/business` — per repo README, not yet wired |
| 5.5 | No mention that a newer, separate build cookbook (`docs/planning/WAZZAR_BUILD_COOKBOOK.md`) already exists in this repo with a different stack (React Native for mobile) | Add a cross-reference note so a reader doesn't act on this file without knowing a second, conflicting cookbook exists one folder up | `docs/planning/WAZZAR_BUILD_COOKBOOK.md` |

---

## 6. Rider Ops Playbook (`docs/planning/legacy-v1/WAZZAR_Rider_Ops_Playbook.docx`)

| # | Current text | Correction needed | Evidence |
|---|---|---|---|
| 6.1 | Rider onboarding/registration flow described in the playbook | Cross-check every field/step described against `riders/dto/create-rider-profile.dto.ts` and `riders.service.ts` and correct any field names or steps that don't match what the API actually accepts today | `riders/dto/create-rider-profile.dto.ts` |
| 6.2 | References to Rider app screens/flows | Note that the Rider app is currently UI-only on mock data and not wired to the backend described elsewhere in this playbook — operational procedures that assume live data (e.g. real-time earnings, live order queue) aren't actually testable yet | `apps/rider` — per repo README |

---

## Resolved: both scopes are in — this is a sequence, not a choice

The open item flagged above has been resolved: **both** the single-city motorcycle model and the multi-leg intercity/Partner/Carrier model are the plan, in that order. This matches the canonical phase roadmap for this project (reconciled 2026-08-22 — see `DOCS_CORRECTIONS_APPLIED.md` §Phase Structure): Phase 1 Core Foundation / First Complete Delivery Loop (single-city, motorcycle, matches what's built and what these legacy docs describe), then Phase 2 Intercity/Trunk Network (the multi-leg/Carrier/`DISPATCHER` model already specified in `WAZZAR_Unified_Model_Updated.md` and `WAZZAR_SYSTEM_ARCHITECTURE.md`), then Phase 3 Business Platform, then Phase 4 Regional Expansion/Scale.

Practical effect on the corrections above:

- **Master Blueprint 4.7** — the existing "Dar es Salaam launch, intercity/regional in Phase 2" framing was already correct and should be *kept*, not softened or removed. It's describing the same sequence, just from the earlier planning doc's point of view. (Master Blueprint §5's own phase table was separately corrected 2026-08-22 to match this — it previously had Business as Phase 2 and Intercity as Phase 3, backwards from every other reference in this repo and from its own §11 DISPATCHER note.)
- **ToS 1.6 and Rider Partner Agreement 3.2** — the missing Carrier/Partner-Operator liability language is no longer an "if this becomes real" flag — it's a known future requirement. Legal review should scope a Phase 2 addendum (or a separate Carrier/Partner Agreement) now, ahead of the intercity build, rather than retrofitting it after the fact.
- **`DISPATCHER` role (Master Blueprint 4.6, Rider Partner Agreement 3.2)** — confirmed as intentional early groundwork for Phase 2, not a stray addition to explain away.
- No document needs to pick a side between "motorcycle-only" and "intercity" — both are correct, just for different phases. Where a doc implies one *instead of* the other (rather than one *before* the other), that's the actual wording to fix.
