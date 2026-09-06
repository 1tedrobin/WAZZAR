// Currency registry for WAZZAR's multi-currency core (Phase 4).
//
// Scope note: this is deliberately just a registry + Stripe minor-unit
// helpers. It does NOT decide which currency applies to which country,
// user, or market — that's country/locale config, a separate piece of
// Phase 4 work. Every currency-aware field in this codebase (PricingConfig,
// Shipment, Payment) defaults to TZS everywhere, so Phase 1 behavior is
// unchanged until something explicitly requests a different currency.
//
// IMPORTANT — this is a different concern from `common/money.ts`:
//   - money.ts converts between a decimal(12,2) DB column (e.g. "8500.00")
//     and integer "hundredths" for exact arithmetic. That conversion is
//     always /100 or *100, for every currency, because every money column
//     in this schema is declared decimal(12,2) regardless of currency —
//     it has nothing to do with what a given currency's real-world minor
//     unit is.
//   - currency.ts (this file) is about what Stripe's API expects for the
//     `amount` field on PaymentIntents/Refunds, which DOES vary by
//     currency: Stripe wants "smallest currency unit" — 8500 for
//     USD 85.00, but 8500 for JPY ¥8500 (JPY has no minor unit at all).
//     Get this wrong and a zero-decimal-currency charge is either 100x
//     overcharged or undercharged.
//
// Reference: https://stripe.com/docs/currencies#zero-decimal — verified
// 2026-09-01. RWF and UGX are zero-decimal on Stripe; TZS and KES are NOT
// (both are standard 2-decimal presentment currencies there), even though
// none of these currencies has real sub-unit coins in circulation. This
// matters because the previous single-currency Stripe integration assumed
// TZS was zero-decimal and sent the raw shilling amount directly as
// Stripe's minor-unit amount — see the fix in providers/stripe.provider.ts.

export enum SupportedCurrency {
  TZS = 'TZS', // Tanzanian Shilling — Phase 1 (Dar es Salaam)
  KES = 'KES', // Kenyan Shilling — Phase 4 target market
  UGX = 'UGX', // Ugandan Shilling — Phase 4 target market
  RWF = 'RWF', // Rwandan Franc — Phase 4 target market
}

export const DEFAULT_CURRENCY = SupportedCurrency.TZS;

interface CurrencyInfo {
  code: SupportedCurrency;
  name: string;
  symbol: string;
  // Whether Stripe treats this as a zero-decimal currency (amount field
  // is the whole-unit integer, not amount * 10^decimals). Independent of
  // how many decimals we store in Postgres, which is always 2 (see the
  // module doc comment above).
  stripeZeroDecimal: boolean;
}

const CURRENCY_INFO: Record<SupportedCurrency, CurrencyInfo> = {
  [SupportedCurrency.TZS]: {
    code: SupportedCurrency.TZS,
    name: 'Tanzanian Shilling',
    symbol: 'TSh',
    stripeZeroDecimal: false,
  },
  [SupportedCurrency.KES]: {
    code: SupportedCurrency.KES,
    name: 'Kenyan Shilling',
    symbol: 'KSh',
    stripeZeroDecimal: false,
  },
  [SupportedCurrency.UGX]: {
    code: SupportedCurrency.UGX,
    name: 'Ugandan Shilling',
    symbol: 'USh',
    stripeZeroDecimal: true,
  },
  [SupportedCurrency.RWF]: {
    code: SupportedCurrency.RWF,
    name: 'Rwandan Franc',
    symbol: 'FRw',
    stripeZeroDecimal: true,
  },
};

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return Object.prototype.hasOwnProperty.call(CURRENCY_INFO, value);
}

export function getCurrencyInfo(code: SupportedCurrency): CurrencyInfo {
  return CURRENCY_INFO[code];
}

// Convert a decimal(12,2) amount string (as stored in this schema, e.g.
// "8500.00") to the integer Stripe wants in the PaymentIntent/Refund
// `amount` field, for the given currency.
export function toStripeMinorUnits(amount: string, currency: SupportedCurrency): number {
  const info = getCurrencyInfo(currency);
  const value = Number(amount);
  return info.stripeZeroDecimal ? Math.round(value) : Math.round(value * 100);
}

// Inverse of toStripeMinorUnits — Stripe's minor-unit integer back to a
// decimal(12,2) string for storage (e.g. Payment.refundedAmount).
export function fromStripeMinorUnits(minorUnits: number, currency: SupportedCurrency): string {
  const info = getCurrencyInfo(currency);
  return info.stripeZeroDecimal ? minorUnits.toFixed(2) : (minorUnits / 100).toFixed(2);
}
