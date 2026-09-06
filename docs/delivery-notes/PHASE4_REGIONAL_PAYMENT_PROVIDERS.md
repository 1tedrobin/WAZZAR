# Phase 4, Piece 3: New Regional Payment Providers

**Date:** 2026-09-02
**Scope:** Third and final of the three Phase 4 "Regional Expansion"
sub-pieces named in `MASTER_GAPS_AND_ROADMAP.md`. Builds on
`PHASE4_MULTI_CURRENCY_CORE.md` (currency data model) and
`PHASE4_LOCALE_MARKET_CONFIG.md` (market/country registry). Adds actual
payment-provider integrations for Kenya and Uganda/Rwanda, which the
currency and locale work made room for but didn't itself provide.

## What changed

- **`MpesaKenyaProvider`** (new) — Safaricom Daraja STK Push, registered
  for Kenya. KES-only. Own env var prefix (`MPESA_KE_*`), fully separate
  class and credential set from the existing `MpesaProvider`.
- **`MtnMomoProvider`** (new) — MTN Mobile Money Collections API
  (Request to Pay), covers both UGX (Uganda) and RWF (Rwanda) through
  one class, since MTN's Collections API has the same auth flow and
  endpoint shape in every country MTN operates it in — only credentials
  differ. Per-country credential sets (`MTN_MOMO_UG_*` / `MTN_MOMO_RW_*`)
  so Uganda and Rwanda can go live independently of each other.
- **`PaymentMethod.MOBILE_MONEY`** (new enum value) — covers MTN MoMo
  (and any future non-M-Pesa mobile money brand). `PaymentMethod.MPESA`
  now covers both Tanzania and Kenya M-Pesa — same real-world brand name
  in both countries, routed to the right provider server-side.
- **`PaymentsService.resolveMobileMoneyProvider(method, currency)`** —
  the actual routing logic: `MPESA` + `TZS` → `MpesaProvider`, `MPESA` +
  `KES` → `MpesaKenyaProvider`, `MOBILE_MONEY` + `UGX`/`RWF` →
  `MtnMomoProvider`. Any other combination throws `BadRequestException`
  **before** a payment row is created — not inside the provider
  try/catch, which would have mislabeled a request-shape error as a
  provider failure (502 instead of 400).
- **`InitiatePaymentDto.phoneNumber`** — relaxed from a Tanzania-only
  regex to a generic `@IsPhoneNumber(undefined)` check. Which specific
  market/provider a phone number needs to match now depends on the
  shipment's currency, which this DTO can't know in isolation — same
  reasoning, same pattern, as `RegisterDto`/`AuthService`'s
  `phoneMatchesMarket` check from the locale-config piece.
- **New tests**: routing coverage in `payments.service.spec.ts`
  (`describe('regional mobile-money routing (Phase 4)')`), plus
  dedicated mock-fallback and currency-guard tests for both new provider
  classes in `payment-providers.spec.ts`.

## Important discovery: the existing "Tanzania" M-Pesa provider is wrong

While researching how to build `MpesaKenyaProvider` correctly, I
verified (web search, 2026-09-02) that Safaricom's Daraja API —
`developer.safaricom.co.ke` / `sandbox.safaricom.co.ke` /
`api.safaricom.co.ke` — is Safaricom's own platform, and **Safaricom
operates M-Pesa in Kenya, not Tanzania.** Tanzania's M-Pesa is run by
Vodacom Tanzania, a related but distinct company, via its own separate
API with its own developer registration process — not Safaricom Daraja.

The **existing** `MpesaProvider` (untouched by this pass, in place since
before Phase 4 started) calls that same `sandbox.safaricom.co.ke` /
`api.safaricom.co.ke` domain, while validating Tanzanian (`255`-prefix)
phone numbers and being documented throughout this codebase — including
in `PAYMENTS_GOING_LIVE.md`'s setup instructions ("register... as a
registered Tanzanian business" with Safaricom) — as the Tanzania
integration. That instruction doesn't describe a real path to a working
Tanzania M-Pesa integration; Safaricom has no Tanzanian business
registration process to go through, because Safaricom doesn't operate
there.

**This predates the Phase 4 work entirely** — it's not something
introduced by the currency/locale/provider passes, and it sat
undiscovered inside code that `MASTER_GAPS_AND_ROADMAP.md` had listed as
"90% complete, code ready" for Phase 1. It was found only because
building a *genuinely* Kenya-registered M-Pesa provider required
checking where Safaricom's API actually operates, and the answer didn't
match what the "Tanzania" provider already assumed.

**What this pass did NOT do:** fix the Tanzania integration. That needs
real research into Vodacom Tanzania's actual Open API — different
developer portal, likely a different auth flow and credential model,
not something to improvise by pattern-matching against Safaricom's docs.
Flagged clearly in both `mpesa.provider.ts`'s and
`mpesa-kenya.provider.ts`'s class-level comments, and in
`PAYMENTS_GOING_LIVE.md`, rather than left to be discovered mid-launch
when a real Tanzanian M-Pesa payment silently fails or (worse) silently
succeeds against the wrong country's sandbox.

**Practical implication for the Phase 1 launch blockers list:** the
"real payment provider credentials" blocker in
`MASTER_GAPS_AND_ROADMAP.md` is now understood to be more than a
credentials-acquisition task for M-Pesa — the integration itself needs
verifying against Vodacom Tanzania's actual API before any credentials
would even be the right shape to plug in. Stripe is unaffected — that
integration was already correctly currency-generic (Kenya can use
Stripe as-is, no change needed there) and its earlier zero-decimal bug
was fixed in the currency-core piece.

## What did NOT change

- No Airtel Money integration, despite Airtel Money also operating in
  Uganda and Rwanda (and Tanzania, Kenya) — MTN MoMo was picked as the
  one new mobile-money brand to build this pass, since MTN's API is
  reasonably documented and consistent across countries. Adding Airtel
  Money is the same shape of work (new provider class(es), new
  `PaymentMethod` handling if it needs to be distinguished from MTN) but
  wasn't done here.
- No fix to the Tanzania M-Pesa integration — see above.
- No refund automation for either new provider. Same limitation as the
  existing Tanzania M-Pesa provider: Safaricom Daraja's B2C Reversal
  needs an RSA-encrypted security credential and is typically a
  back-office process; MTN MoMo's Collections credentials can't
  disburse at all (that's a separate "Disbursements" product/
  subscription). Both new providers' `refund()` throw with a clear
  message rather than pretending to automate something that isn't.
- No frontend changes. All four apps are plain JS with no shared type
  layer — same point made in the currency-core and locale-config notes.
  Nothing currently lets a customer pick MOBILE_MONEY as a payment
  method in the UI; that's a frontend task building on this.
- No live-sandbox verification of either new provider's real-credentials
  code path — no network access in this environment, and no real
  credentials exist for any of these providers yet regardless. The
  request/response shapes were verified against MTN's and Safaricom's
  published documentation (web search, 2026-09-02), not against an
  actual sandbox call.

## Verification status

Same caveat as the other two Phase 4 pieces: written and reasoned
through by hand, **not run**. In addition to the general
build/test/migration steps in `PHASE4_MULTI_CURRENCY_CORE.md`:

1. `AddMobileMoneyToPaymentMethodEnum` — confirm `ALTER TYPE ... ADD
   VALUE` actually runs cleanly against a real Postgres instance
   (it should; this is the same technique `AddDispatcherRole` already
   used successfully in this codebase for a different enum).
2. Specifically exercise `POST /payments/initiate` with
   `method: MPESA` against a KES shipment — should hit
   `MpesaKenyaProvider`'s mock path (`MPESA-KE-...` externalId), not
   the TZS one.
3. Specifically exercise `POST /payments/initiate` with
   `method: MOBILE_MONEY` against a UGX and a RWF shipment — both
   should hit `MtnMomoProvider`'s mock path (`MOMO-...` externalId).
4. Specifically exercise an invalid combination (e.g. `method: MPESA`
   against a UGX shipment) — should get a 400 with a clear message, and
   confirm no `Payment` row was written for it at all.
5. Before ever pointing `MPESA_KE_*` or `MTN_MOMO_UG_*`/`MTN_MOMO_RW_*`
   at real credentials: read this note's "important discovery" section
   above and decide whether the existing Tanzania integration needs
   fixing first, since it shares a great deal of code shape with the
   new Kenya one and the same class of mistake (assuming an API
   operates somewhere it doesn't) is worth double-checking isn't
   present in the new providers too, beyond what a web search alone
   could confirm.
