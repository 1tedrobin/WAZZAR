# Phase 4, Piece 1: Multi-Currency Core

**Date:** 2026-09-02
**Scope:** One of three Phase 4 "Regional Expansion" sub-pieces —
multi-currency data model and money-handling. Does NOT include
country/locale config (market definitions, address/phone formats) or new
regional payment providers (M-Pesa Kenya, Airtel Money, MTN MoMo) — those
are separate, still-unstarted pieces of Phase 4. See
`MASTER_GAPS_AND_ROADMAP.md`'s Phase 4 entry.

## Why this, and why first

Phase 4 was chosen deliberately over finishing Phase 1's remaining
blockers (payment credentials, e2e testing, live GPS/geocoding,
deployment) — that's a real sequencing tradeoff, not a gap that was
missed; see the conversation this note came out of if you need the
reasoning. Within Phase 4, currency was picked first because the other
two sub-pieces (locale config, new payment providers) both assume
multi-currency money-handling already exists underneath them.

## What changed

- **`src/common/currency.ts`** (new) — registry of supported ISO 4217
  codes (TZS, KES, UGX, RWF) with Stripe minor-unit metadata.
- **Migration `AddCurrencyToMoneyTables`** — adds a `currency` column
  (Postgres enum, default `'TZS'`) to `pricing_configs`, `shipments`,
  `payments`. Every existing row backfills to TZS; every new row defaults
  to it unless a caller explicitly asks for something else. **Zero
  behavior change for Phase 1** until a second currency's pricing config
  is actually created.
- **`PricingService`** — the "only one active config at a time" rule is
  now scoped **per currency**, not global. Creating a KES config no
  longer deactivates the active TZS config (previously would have,
  breaking Phase 1 the moment any second-market pricing existed).
  `calculatePrice`, `getActiveConfig`, `createConfig` all take an
  optional `currency`, defaulting to TZS.
- **`ShipmentsService` / `PaymentsService`** — currency flows quote →
  shipment → payment automatically; no caller needs to pass it more than
  once (at `CreateShipmentDto.currency`, optional, defaults TZS).
- **Stripe provider — bug fix + currency-aware.** The old code hardcoded
  `currency: 'tzs'` and sent the raw shilling amount as Stripe's
  minor-unit `amount`, on the assumption TZS is a zero-decimal currency
  on Stripe. **It isn't** — verified against Stripe's current docs (RWF
  and UGX are zero-decimal there; TZS and KES are standard 2-decimal
  presentment currencies). Had this shipped against live credentials
  unchanged, every real Stripe charge would have been submitted at 1/100th
  of the intended amount. Never hit production (no live Stripe
  credentials exist yet — see `PAYMENTS_GOING_LIVE.md`), but would have
  been the first thing to break once they were added. Fixed via
  `toStripeMinorUnits()`/`fromStripeMinorUnits()` in `currency.ts`.
- **M-Pesa provider — currency-guarded, not extended.** This provider is
  wired to one Daraja registration (Tanzania — see the 255-prefix phone
  validation in `InitiatePaymentDto`). Rather than silently accepting a
  KES/UGX/RWF payment and routing it through the wrong country's M-Pesa
  network, it now throws explicitly for any currency other than TZS.
  Building the real Kenya/Uganda/Rwanda mobile-money integrations is the
  "new regional payment providers" Phase 4 sub-piece — not done here.
- **Reconciliation report** — `PaymentsService.reconcile()` now also
  breaks totals out `byCurrency`, since summing raw amounts across
  currencies (the old `totalAmount`/`totalRefunded` fields) stops being a
  meaningful number the moment more than one currency has payments. Old
  fields kept for backward compatibility; they're only correct while
  everything is still TZS.
- **`seed-pricing.ts`** — takes `SEED_PRICING_CURRENCY` (default TZS);
  run once per currency to seed more than one market's initial pricing.
- **Tests** — new `src/common/currency.spec.ts` covers the Stripe
  zero-decimal conversion directly (the thing that was actually buggy).
  Updated `pricing.service.spec.ts` and `payments.service.spec.ts`
  fixtures/assertions for the new required `currency` field and the
  per-currency active-config scoping; added coverage for two currencies'
  configs not clobbering each other, and for the M-Pesa currency guard.

## What did NOT change

- Frontend apps (`apps/customer`, `apps/business`, `apps/admin`,
  `apps/rider`) are plain JS, not TypeScript — no type definitions to
  update, and none were touched. None of them currently let a user pick
  a currency; every request they send omits `currency`, which resolves
  to TZS exactly as before. Surfacing currency selection in the UI is
  locale/config work, not this piece.
- `Rider.totalEarnings` was deliberately left alone. It's a running sum
  with no currency of its own — fine while every rider operates in one
  market (TZS), but wrong the moment a rider's shipments could span
  currencies. Not needed for Phase 1, and cross-currency rider payouts
  are a dispatch/market-assignment question this pass didn't try to
  answer. Flagging so it isn't mistaken for an oversight later.
- No changes to `common/money.ts`. Its cents-conversion helpers
  (`centsFromDecimal`/`decimalFromCents`) are about `decimal(12,2)`
  column storage, which is identical across every currency in this
  schema — a different concern from Stripe's per-currency minor-unit
  format. See the doc comment at the top of `currency.ts` for the full
  distinction; conflating the two was part of what caused the original
  Stripe bug.

## Verification status

Built and reasoned through by hand against the existing code and test
patterns — **not run**. This environment has no network access to
`npm install`, so nothing here has gone through a real `tsc` compile or
`npm test`. Before merging:

1. `npm install && npm run build` in `backend/backend` — check for any
   TypeScript error this pass introduced.
2. `npm test` — confirm the updated/new specs pass, especially
   `pricing.service.spec.ts`, `payments.service.spec.ts`,
   `common/currency.spec.ts`, and `providers/payment-providers.spec.ts`.
3. `npm run typeorm migration:run` locally against a scratch Postgres to
   confirm `AddCurrencyToMoneyTables` applies and rolls back cleanly.
