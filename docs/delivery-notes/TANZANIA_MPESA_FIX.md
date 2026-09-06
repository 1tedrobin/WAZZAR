# Tanzania M-Pesa Fix

**Date:** 2026-09-03
**Scope:** Follow-up to the discovery documented in
`PHASE4_REGIONAL_PAYMENT_PROVIDERS.md` — the existing `MpesaProvider`,
labeled everywhere as Tanzania's M-Pesa integration, was actually built
against Safaricom's Kenya API. This piece replaces it for TZS traffic
with a real attempt at Vodacom Tanzania's actual API ("Open API",
`openapi.m-pesa.com`).

**This is a Phase 1 correctness fix, not a Phase 4 feature** — it
directly affects the existing "real payment provider credentials"
blocker in `MASTER_GAPS_AND_ROADMAP.md` for the Dar es Salaam launch,
independent of any Phase 4 market expansion.

## What changed

- **`MpesaTanzaniaProvider`** (new,
  `providers/mpesa-tanzania.provider.ts`) — implements the Vodacom Open
  API flow: encrypt an Application API Key with Vodacom's RSA public
  key → `getSession` → encrypt the returned session key the same way →
  `c2bPayment/singleStage` for a payment, `reversal` for a refund. TZS
  only.
- **`MpesaProvider` (old) is now deprecated**, not deleted. Marked
  clearly in its own class comment. It's no longer registered in
  `PaymentsModule` or injected into `PaymentsService` — nothing routes
  to it anymore. Left in place because it's functionally identical to
  `MpesaKenyaProvider` (same underlying Safaricom Daraja API this class
  was always actually calling) and because its webhook plumbing
  (`MpesaWebhookDto`, `parseMpesaCallback`, `handleMpesaCallback`) is
  still correct and still live — it's genuine Safaricom Daraja
  callback-shape handling, now understood to serve **Kenya**
  (`MpesaKenyaProvider`) rather than Tanzania. Point
  `MPESA_KE_CALLBACK_URL` at the same existing
  `/payments/webhooks/mpesa` endpoint.
- **`PaymentsService.resolveMobileMoneyProvider`** — `MPESA` + `TZS` now
  routes to `MpesaTanzaniaProvider` instead of the deprecated class.
  `MPESA` + `KES` routing (→ `MpesaKenyaProvider`) is unchanged.
- **Tests** updated/added: `payments.service.spec.ts`'s existing M-Pesa
  tests now mock `MpesaTanzaniaProvider` instead of the old class (same
  test coverage, correct target); new mock-fallback + currency-guard
  tests for `MpesaTanzaniaProvider` in `payment-providers.spec.ts`. The
  old `MpesaProvider`'s own tests are untouched and still pass — the
  class itself still works, it's just unused by the app now.

## How sure is this actually correct?

Meaningfully less certain than every other provider built in this
project. Ranked:

1. **Stripe, Safaricom Daraja (Kenya), MTN MoMo** — official first-party
   documentation exists and is what these were built against.
2. **This (Vodacom Tanzania Open API)** — built from the *consistent
   agreement of roughly six independent open-source community client
   libraries* (Python: `pypesa`, `mobile_payments`; Dart: `mpesa_sdk`;
   Go: `Golang-Tanzania/mpesa`; Elixir: `elixir_mpesa`; PHP:
   `api-m-pesa-curl`), not Vodacom's own developer portal docs — no
   network access in this environment to register for that portal, and
   no real credentials exist regardless. The endpoint paths
   (`/ipg/v2/vodacomTZN/...`), field names (`input_Amount`,
   `output_ResponseCode`, `INS-0` for success), and RSA-encrypt-then-
   session-key auth flow were consistent across every independent
   source checked, which is a reasonable bar of confidence for
   community-reverse-engineered docs — but it is not the same as an
   official spec, and **has not been run against a live sandbox at
   all**.

**Explicitly unresolved, and not guessed at**: every community
reference shows `c2bPayment/singleStage` returning
`output_ResponseCode` directly in the same HTTP response, which reads as
a **synchronous** confirm-or-fail call — unlike Safaricom Daraja's STK
Push, which is async (immediate `CheckoutRequestID`, real
success/failure arrives later via webhook). If Vodacom's flow really is
synchronous, `PaymentsService` could mark a payment `COMPLETED`
immediately after `initiate()` returns instead of `PROCESSING`-then-
wait. **This implementation deliberately does not make that
assumption** — `initiate()` returns a `transactionId` the same shape as
every other provider, and the payment stays `PROCESSING` until
something else confirms it, same as the async providers. That's the
safer failure mode: a real successful Vodacom payment would sit in
`PROCESSING` needing manual reconciliation, rather than risking a real
failed/pending payment getting marked `COMPLETED` when money never
moved. Confirming which is actually true — and whether Vodacom has any
webhook/callback mechanism at all — needs real sandbox access, not more
research.

**Refunds work differently here than the other three mobile-money
providers.** Safaricom Daraja (both the deprecated TZ-mislabeled class
and the real `MpesaKenyaProvider`) and MTN MoMo's Collections
credentials all genuinely can't automate a refund with the credentials
this codebase has — see their `refund()` methods, which throw
"not automated" immediately. Vodacom's `reversal` endpoint, by every
community reference checked, uses the *same* session-key auth as
payments — so `MpesaTanzaniaProvider.refund()` actually attempts the
call instead of refusing outright. If this turns out to be wrong (padding
scheme mismatch, wrong field name, endpoint doesn't behave as the
community docs suggest), the failure mode is an `Error` thrown and
caught the same way any other provider failure is handled — not a
silent false success.

## What did NOT change

- No live sandbox verification — see above.
- No webhook/callback endpoint for Vodacom, since it's unknown whether
  one exists or what shape it would take. If the synchronous-response
  assumption above turns out to be wrong (i.e. Vodacom really is
  async), this is the next thing that would need building, informed by
  real sandbox behavior.
- `mpesa.provider.ts` itself is untouched beyond its deprecation
  comment — not deleted, not refactored. Its webhook infrastructure
  (`MpesaWebhookDto`, `parseMpesaCallback`,
  `PaymentsService.handleMpesaCallback`) is unchanged and still correct
  for Kenya.
- `PAYMENTS_GOING_LIVE.md`'s M-Pesa credential table and setup steps
  were not rewritten for `MPESA_TZ_*` — that doc already got a pointer
  to this note in the previous pass; a full rewrite covering four
  M-Pesa-family provider setups (TZ, KE, plus the two MTN MoMo country
  credential sets) is a documentation task that deserves its own pass
  once at least one of them has actually been sandbox-tested, rather
  than writing polished setup instructions for something unverified.

## Verification status

Same caveat as every other piece: written and reasoned through by hand,
**not run** — no network access in this environment. Specific to this
piece, before pointing `MPESA_TZ_*` at anything real:

1. Register for Vodacom's actual Open API developer portal and compare
   its real documentation against everything asserted above — this
   piece was built without ever seeing that portal.
2. Test `getSession` against the sandbox first, in isolation, before
   attempting a full payment — confirms the RSA encryption
   (padding scheme, public key format) is right before anything
   involving money is attempted.
3. Once `getSession` works: test `c2bPayment/singleStage` and watch
   whether the response actually arrives synchronously or whether the
   real behavior is closer to Daraja's async pattern — this determines
   whether `PaymentsService`'s `PROCESSING`-then-wait handling needs to
   change to `COMPLETED`-immediately, or whether a webhook endpoint
   needs building instead.
4. Only then test `reversal`, given it's real money moving back out.
