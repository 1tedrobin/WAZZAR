# Phase 4, Piece 2: Locale / Market Config

**Date:** 2026-09-02
**Scope:** Second of three Phase 4 "Regional Expansion" sub-pieces —
country/market registry, tying a user's registered country to a default
currency and validating their phone number matches it. Builds directly
on `PHASE4_MULTI_CURRENCY_CORE.md`. Does NOT include address format
parsing/validation, full i18n (translated strings), or new regional
payment providers — still separate, still unstarted.

## What changed

- **`src/common/market.ts`** (new) — registry of four markets (TZ, KE,
  UG, RW), each mapped to exactly one `SupportedCurrency`, a calling
  code, and an IANA timezone. `phoneMatchesMarket()` and
  `marketForPhone()` are prefix-based sanity checks, not full address/
  number formatting.
- **Migration `AddCountryCodeToUsers`** — adds `country_code` (Postgres
  enum, default `'TZ'`) to `users`. Every existing row backfills to TZ;
  zero behavior change until someone registers with a different market.
- **`User` entity** — new `countryCode` field.
- **`RegisterDto` / `AuthService.register`** — accepts an optional
  `countryCode`. When given, it's cross-checked against the phone
  number's calling code and rejected with `BadRequestException` on a
  mismatch (catches the likely error of picking the wrong country in a
  signup dropdown). When omitted, defaults to TZ with **no** cross-check
  — matches every existing caller's behavior exactly.
- **`ShipmentsService.create`** — when a shipment request omits
  `currency` (the common case — no frontend currently sends it), it now
  looks up the requesting customer's `countryCode` and defaults to
  *their* market's currency instead of a hardcoded TZS. A caller that
  explicitly passes `currency` skips this lookup entirely. This is the
  piece that actually connects locale config to the currency core: a
  customer who registered with `countryCode: KE` now gets KES-priced
  shipments automatically.
- **Went back and fixed a latent bug in the currency-core pass**: three
  DTOs (`CalculatePriceDto.currency`, `CreatePricingConfigDto.currency`,
  `CreateShipmentDto.currency`) previously had a
  `= DEFAULT_CURRENCY` class-field initializer. Depending on
  class-transformer's exact default-value behavior, that risked always
  populating `'TZS'` even when a caller omitted the field — which would
  have silently defeated this piece's market-fallback logic (an omitted
  currency would never look like `undefined` to `ShipmentsService`).
  Removed the initializers; the TZS fallback is now applied explicitly
  in service code (`dto.currency ?? DEFAULT_CURRENCY`), matching how
  every other optional field in this codebase's DTOs already works.
- **New tests**: `src/common/market.spec.ts` (registry + phone-matching
  logic), `src/modules/auth/auth.service.spec.ts` (new file — there was
  no `AuthService` test coverage at all before this pass; only the
  new `register()` market logic is covered, not the pre-existing
  login/refresh/getCurrentUser surface), and a new
  `describe('currency market fallback (Phase 4)')` block in
  `shipments.service.spec.ts`.

## What did NOT change

- No address parsing, formatting, or validation per country. `LocationDto`
  is still just `{ latitude, longitude, address: string }` — `address`
  stays a free-text field regardless of market.
- No i18n / translated UI strings. This is purely backend market
  resolution.
- Frontend apps still don't let a user pick a country at signup — every
  registration call omits `countryCode` and lands on TZ exactly as
  before. Surfacing a country selector is frontend work this pass didn't
  touch (all four apps are plain JS, so there's no shared type layer to
  update — see the currency-core note for the same point).
- `Rider.totalEarnings` / cross-currency rider payouts — still flagged as
  unsolved, same as the currency-core note.
- Regulatory/compliance requirements per country (licensing, tax) — not
  addressed at all; this piece is purely "which currency and calling
  code," nothing about what's legally required to operate in each
  market.

## Verification status

Same caveat as the currency-core piece: written and reasoned through by
hand against existing patterns, **not run** — this environment has no
network access for `npm install`/`tsc`/`npm test`/a real Postgres. Before
merging, in addition to the currency-core piece's verification steps:

1. Confirm `AddCountryCodeToUsers` runs after `AddCurrencyToMoneyTables`
   (timestamp-ordered: `...390000000` after `...380000000` — should sort
   correctly via TypeORM's default filename-order migration runner, but
   worth a glance at `migration:show` output).
2. Specifically exercise `POST /auth/register` with `countryCode: 'KE'`
   and a `+255` (Tanzanian) phone number — should get a 400, not a
   silently-created mismatched account.
3. Specifically exercise `POST /shipments` as a KE-registered customer
   with no `currency` in the body — the resulting shipment's `price`
   should quote against a KES `PricingConfig` (which won't exist yet on
   a fresh DB — see `SEED_PRICING_CURRENCY=KES npm run seed:pricing`,
   documented in `PHASE4_MULTI_CURRENCY_CORE.md`), not silently fall
   through to TZS.
