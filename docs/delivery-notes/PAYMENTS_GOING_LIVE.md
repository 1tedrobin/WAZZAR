# Payments — going live

Referenced from code comments throughout `src/modules/payments/` — this
is where those comments point. Written 2026-08-22, alongside making the
payments module actually able to use real Stripe/M-Pesa credentials
instead of only ever generating fake transaction IDs.

## Where things stood before this pass

Both providers (`mpesa.provider.ts`, `stripe.provider.ts`) only ever
returned fake, random transaction IDs — no code path to real money
existed at all. That's now fixed: both switch to a real integration
automatically the moment real credentials are present in `.env`,
**nothing else needs to change** — no code, no flag, no redeploy step
beyond adding the values.

**Nobody in this project has real Stripe or Safaricom Daraja
credentials as of this writing.** This pass could not test the real
paths against a live sandbox for that reason — see "Testing before
going live" below for how to actually confirm it works once you do.

## What flips each provider from mock to real

| Provider | Flips to real when... | Stays mock when... |
|---|---|---|
| Stripe | `STRIPE_SECRET_KEY` is set and starts with `sk_` | Unset, or set to a placeholder that doesn't start with `sk_` |
| M-Pesa | **All five** of `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL` are set | Any of the five is missing (deliberately all-or-nothing — a partial set means someone's mid-setup, not ready for real traffic) |

## Getting Stripe credentials

1. Create a Stripe account at stripe.com (business details, bank
   account for payouts — this part is entirely outside this repo).
2. Dashboard → **Developers → API keys**. Copy the **Secret key**
   (`sk_test_...` for sandbox testing, `sk_live_...` once approved for
   production) into `STRIPE_SECRET_KEY`.
3. Dashboard → **Developers → Webhooks → Add endpoint**. Point it at
   `https://<your-backend-domain>/payments/webhooks/stripe`. Subscribe
   to at minimum `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `charge.refunded` (the three event
   types `handleStripeCallback` in `payments.service.ts` currently
   handles). Copy the **Signing secret** (`whsec_...`) into
   `STRIPE_WEBHOOK_SECRET`.
4. Currency: the integration currently charges in `tzs` (Tanzanian
   Shilling), treated as Stripe's zero-decimal currency convention — see
   the comment in `stripe.provider.ts` if this ever needs to support a
   currency with real cents (e.g. USD for cross-border customers).

**What's fully automated once these are set:** charging a card
(`POST /payments/initiate` with `method: STRIPE`), and refunds
(`POST /payments/:id/refund`) — Stripe's refund API is a real, simple
API call, unlike M-Pesa's (below).

## Getting M-Pesa (Safaricom Daraja) credentials

1. Register at developer.safaricom.co.ke, create an app in the Daraja
   portal. This gives you a **Consumer Key** and **Consumer Secret**
   (`MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET`) for the **sandbox**
   environment immediately — no approval wait for sandbox testing.
2. Sandbox testing uses Safaricom's shared test shortcode `174379` and
   test passkey (both published in Daraja's sandbox docs) —
   `MPESA_SHORTCODE` / `MPESA_PASSKEY`.
3. `MPESA_CALLBACK_URL` must be a **publicly reachable HTTPS URL**
   (Safaricom's servers call it, so `localhost` will never work — use
   ngrok or a real deployed backend for testing) pointing at
   `https://<your-backend-domain>/payments/webhooks/mpesa`.
4. **Going to production is a separate, real business process with
   Safaricom** — a registered Tanzanian business, their own paybill/
   till number (replaces the shared sandbox shortcode), and Safaricom's
   approval. Nothing in this repo can shortcut that; `MPESA_ENV=production`
   only points the code at the production API host once you have
   production credentials from that process.

**What's fully automated once these are set:** initiating an STK Push
prompt on the customer's phone (`POST /payments/initiate` with
`method: MPESA`).

**What is NOT automated, on purpose, even with real credentials:**
M-Pesa refunds. Unlike Stripe, Daraja has no simple "refund" endpoint —
reversing a payment is a **B2C Reversal** request that needs an
initiator name and an RSA-encrypted security credential (using
Safaricom's public certificate), and in practice is usually done from
the Daraja/business back-office rather than a plain API call. Calling
`POST /payments/:id/refund` on an M-Pesa payment with real credentials
configured will throw a clear error telling you to process it manually
— on purpose, since silently pretending to refund a customer when
nothing was actually reversed would be worse than refusing outright.

## M-Pesa webhook shape — fixed 2026-08-22

`MpesaWebhookDto` (`src/modules/payments/dto/mpesa-webhook.dto.ts`) used
to expect a simplified `{ transactionId, success, amount }` shape that
did not match what Safaricom's Daraja API actually sends. That's now
fixed: the DTO matches the real, nested Daraja STK Push callback shape
(`{ Body: { stkCallback: { MerchantRequestID, CheckoutRequestID,
ResultCode, ResultDesc, CallbackMetadata?: { Item: [...] } } } }`), and
a new pure helper, `mpesa-callback.util.ts`'s `parseMpesaCallback()`,
flattens it into what `handleMpesaCallback` in `payments.service.ts`
actually needs (`transactionId`, `success`, and — only on success, since
Daraja omits `CallbackMetadata` entirely on failure/cancellation — the
M-Pesa receipt number, amount, phone, and transaction date pulled out of
`CallbackMetadata.Item`'s name/value array). The STK Push *initiate*
call already returned the real `CheckoutRequestID` as the transaction id
(see `mpesa.provider.ts`); the callback side is what didn't line up
before, and does now.

One thing worth calling out: `handleMpesaCallback` now also compares
the amount Daraja reports in the callback against the payment's own
recorded amount and logs a warning on mismatch — it does **not** block
completing the payment on a mismatch (Daraja's `ResultCode` is still the
source of truth for whether money moved), it just surfaces a
discrepancy that would otherwise pass through silently.

**Still not verified against a live callback** — same caveat as
everywhere else in this document: no Safaricom account exists to
generate real STK Push traffic against this code. The new DTO and
parser were written from Safaricom's published Daraja documentation
(including the exact `CallbackMetadata.Item` names —
`Amount`/`MpesaReceiptNumber`/`TransactionDate`/`PhoneNumber` — and the
documented behavior that failure callbacks omit `CallbackMetadata`
entirely), and are covered by unit tests using a payload shaped exactly
like Safaricom's own published sandbox example
(`mpesa-callback.util.spec.ts`, plus `payments.service.spec.ts`'s
`handleMpesaCallback` tests updated to the new shape) — but that is
still not the same as a real callback arriving from Safaricom's
servers. Do the real sandbox test in "Testing before going live" below
before trusting this with real money.

## Testing before going live

1. **Stripe sandbox:** use `sk_test_...` keys and Stripe's published
   test card numbers (e.g. `4242 4242 4242 4242`) — no real money
   moves. Confirm a full `POST /payments/initiate` →
   `POST /payments/webhooks/stripe` (Stripe CLI's `stripe listen
   --forward-to` is the standard way to receive real webhook calls on
   a local machine) → payment lands `COMPLETED` cycle before trusting
   this in production.
2. **M-Pesa sandbox:** use the shared sandbox shortcode/passkey above.
   Confirm the STK prompt actually arrives on a real Safaricom test
   phone number and that the callback both parses correctly (see the
   "M-Pesa webhook shape" section above — the DTO/parsing gap that used
   to block this is now fixed, but never confirmed against a real
   Daraja callback) and moves the payment to `COMPLETED`.
3. Neither of these was possible to verify in the environment this was
   built in (no accounts, no way to receive an inbound webhook call) —
   this is written from correct understanding of both APIs' documented
   behavior, not confirmed against live traffic. Budget real testing
   time before a real transaction depends on this.
