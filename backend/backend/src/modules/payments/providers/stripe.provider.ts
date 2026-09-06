import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { getStripeClient, hasRealStripeCredentials } from './stripe-client';
import { ProviderInitiateResult, ProviderRefundResult } from './provider-result.types';
import { DEFAULT_CURRENCY, SupportedCurrency, toStripeMinorUnits } from '../../../common/currency';

// Stays on the mock path (random fake IDs, no network call) unless a
// real-looking STRIPE_SECRET_KEY is configured — see
// hasRealStripeCredentials() in stripe-client.ts. This means local dev
// and the existing test suite (which injects a fully-mocked
// StripeProvider via `useValue` — see payments.service.spec.ts — so
// never actually reaches this class) are unaffected either way; this
// only changes behavior once a real key is added to `.env`.
//
// See docs/delivery-notes/PAYMENTS_GOING_LIVE.md for exactly what
// credentials are needed and the steps to flip this on for real.
@Injectable()
export class StripeProvider {
  constructor(private readonly configService: ConfigService) {}

  async initiate(
    customerId: string,
    amount: string,
    cardToken: string,
    currency: SupportedCurrency = DEFAULT_CURRENCY,
  ): Promise<ProviderInitiateResult> {
    if (!hasRealStripeCredentials(this.configService)) {
      void customerId;
      void amount;
      void cardToken;
      void currency;
      return { transactionId: `STRIPE-${randomUUID()}`, isMock: true };
    }

    const stripe = getStripeClient(this.configService);
    // amount is a decimal string (e.g. "8500.00" TZS, always 2 decimal
    // places in this schema — see the module doc comment in
    // common/currency.ts). Stripe wants the smallest currency unit,
    // which varies by currency: TZS and KES are standard 2-decimal
    // presentment currencies on Stripe (amount * 100), while RWF and UGX
    // are zero-decimal there (the raw whole-unit amount) — see
    // toStripeMinorUnits(), which is the single source of truth for this
    // distinction rather than assuming one currency's behavior here.
    //
    // FIX (2026-09-02): this previously hardcoded `currency: 'tzs'` and
    // sent Math.round(Number(amount)) directly on the assumption that
    // TZS was zero-decimal on Stripe. It isn't — TZS is a normal
    // 2-decimal presentment currency there. That meant a real charge for
    // e.g. "8500.00" TZS would have been submitted as amount: 8500,
    // which Stripe would read as 85.00 TZS: a 100x undercharge. This had
    // never run against real Stripe (mock path only, no live credentials
    // yet — see PAYMENTS_GOING_LIVE.md), so no real charge was affected,
    // but it would have been the first thing to break once live
    // credentials were added.
    const intent = await stripe.paymentIntents.create({
      amount: toStripeMinorUnits(amount, currency),
      currency: currency.toLowerCase(),
      payment_method: cardToken,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: { wazzarCustomerId: customerId },
    });
    return { transactionId: intent.id, isMock: false };
  }

  async refund(
    externalId: string,
    amount: string,
    currency: SupportedCurrency = DEFAULT_CURRENCY,
  ): Promise<ProviderRefundResult> {
    if (!hasRealStripeCredentials(this.configService)) {
      void externalId;
      void amount;
      void currency;
      return { refundId: `STRIPE-REFUND-${randomUUID()}` };
    }

    const stripe = getStripeClient(this.configService);
    const refund = await stripe.refunds.create({
      payment_intent: externalId,
      amount: toStripeMinorUnits(amount, currency),
    });
    return { refundId: refund.id };
  }
}
