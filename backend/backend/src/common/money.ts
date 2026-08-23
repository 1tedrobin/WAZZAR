// Small helpers for exact money math without floating-point drift.
//
// Every money column in this codebase is `decimal(12,2)`, which TypeORM
// hands back as a string (see Shipment.price, Rider.totalEarnings, etc.).
// Doing `0.1 + 0.2`-style arithmetic directly on those strings/numbers is
// how you end up a cent off on a payout split — so anywhere pricing or
// payments needs to add, multiply, or split a money value, convert to
// integer cents first, do the arithmetic there, and convert back once at
// the end. Only whole cents ever get rounded (via Math.round), so the
// error never compounds across a chain of operations.
//
// Deliberately not using a bignum/decimal library (e.g. decimal.js) —
// TZS has no sub-cent pricing, so integer-cents math is exact and needs
// no new dependency. Revisit if a currency with >2 decimal places is
// ever supported.

export function centsFromDecimal(value: string | number): number {
  return Math.round(Number(value) * 100);
}

export function decimalFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
