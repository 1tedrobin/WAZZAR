import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';

// One real Stripe client, constructed lazily and reused — both
// StripeProvider (payment intents, refunds) and PaymentsService's
// webhook verification (constructEvent) need one, and constructing a
// second client per call would be wasteful. `constructEvent` doesn't
// make a network call — it's pure local HMAC verification — so this is
// safe to call even before any real Stripe API request has been made.
let cached: Stripe | undefined;

// True only when STRIPE_SECRET_KEY looks like a real Stripe secret key
// (always prefixed `sk_test_` or `sk_live_`) — this is the single
// switch that decides "use the real Stripe SDK" vs. "stay on the mock
// provider" everywhere in this module. Empty/unset/placeholder values
// in .env.example never match this, so local dev stays on the mock by
// default with zero extra configuration.
export function hasRealStripeCredentials(configService: ConfigService): boolean {
  const key = configService.get<string>('STRIPE_SECRET_KEY');
  return !!key && key.startsWith('sk_');
}

export function getStripeClient(configService: ConfigService): Stripe {
  if (!cached) {
    const key = configService.get<string>('STRIPE_SECRET_KEY');
    if (!key) {
      // Only reachable if a caller uses this without checking
      // hasRealStripeCredentials()/a whsec_ secret first — a clear
      // error here is much easier to debug than a cryptic Stripe SDK
      // constructor failure.
      throw new Error(
        'getStripeClient() called without STRIPE_SECRET_KEY configured. ' +
          'Check hasRealStripeCredentials() or the caller\'s webhook-secret prefix check first.',
      );
    }
    cached = new Stripe(key);
  }
  return cached;
}

// Test-only escape hatch: lets payments.service.spec.ts / a future
// stripe-client.spec.ts reset the cached client between tests instead
// of leaking state across test files.
export function _resetStripeClientForTests(): void {
  cached = undefined;
}
