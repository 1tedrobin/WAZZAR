export interface ProviderInitiateResult {
  transactionId: string;
  // True when this came from a provider's mock path (no real
  // Safaricom/Stripe credentials configured — see
  // hasRealMpesaCredentials/hasRealStripeCredentials) rather than an
  // actual Daraja/Stripe call. Surfaced on the Payment response (see
  // Payment.isMock) so a business/admin UI can flag "this wasn't a
  // real charge" instead of presenting a fake transaction ID as if it
  // were real money movement.
  isMock: boolean;
}

export interface ProviderRefundResult {
  refundId: string;
}
