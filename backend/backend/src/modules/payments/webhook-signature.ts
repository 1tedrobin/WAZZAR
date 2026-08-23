import { createHmac, timingSafeEqual } from 'crypto';

// Generic HMAC-SHA256(rawBody, secret) === signature check, used for
// both webhook endpoints. This is deliberately the *simplified* scheme
// docs/delivery-notes/PAYMENTS_GOING_LIVE.md describes for M-Pesa — it is NOT
// Stripe's real verification algorithm (which signs a
// `${timestamp}.${payload}` string, supports multiple signature
// versions/rotation, and needs `stripe.webhooks.constructEvent()` or an
// equivalent reimplementation). Swap this out for the real Stripe SDK
// call before accepting live Stripe traffic.
//
// If no secret is configured, verification is skipped (returns true)
// rather than rejecting every webhook — that's what keeps this endpoint
// callable in local/sandbox development before secrets are wired into
// .env. This is exactly the "Webhook verification TODO" flagged as a
// pre-production security-review item in docs/delivery-notes/PAYMENTS_GOING_LIVE.md;
// do not deploy to production with WEBHOOK secrets unset.
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) {
    return true;
  }
  if (!signature) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, signatureBuf);
}
