import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { getStripeClient, hasRealStripeCredentials } from './stripe-client';
import { ProviderInitiateResult, ProviderRefundResult } from './provider-result.types';

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
  ): Promise<ProviderInitiateResult> {
    if (!hasRealStripeCredentials(this.configService)) {
      void customerId;
      void amount;
      void cardToken;
      return { transactionId: `STRIPE-${randomUUID()}` };
    }

    const stripe = getStripeClient(this.configService);
    // amount is a decimal string (e.g. "8500.00" TZS) — Stripe wants
    // the smallest currency unit. TZS has no minor unit in practice,
    // and Stripe treats it as a zero-decimal currency — see
    // https://stripe.com/docs/currencies#zero-decimal. If this ever
    // needs to charge in a currency with real cents (e.g. USD), swap
    // this for Math.round(Number(amount) * 100).
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount)),
      currency: 'tzs',
      payment_method: cardToken,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: { wazzarCustomerId: customerId },
    });
    return { transactionId: intent.id };
  }

  async refund(externalId: string, amount: string): Promise<ProviderRefundResult> {
    if (!hasRealStripeCredentials(this.configService)) {
      void externalId;
      void amount;
      return { refundId: `STRIPE-REFUND-${randomUUID()}` };
    }

    const stripe = getStripeClient(this.configService);
    const refund = await stripe.refunds.create({
      payment_intent: externalId,
      amount: Math.round(Number(amount)),
    });
    return { refundId: refund.id };
  }
}
