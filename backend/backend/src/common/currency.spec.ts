import {
  DEFAULT_CURRENCY,
  SupportedCurrency,
  fromStripeMinorUnits,
  getCurrencyInfo,
  isSupportedCurrency,
  toStripeMinorUnits,
} from './currency';

describe('currency registry', () => {
  it('defaults to TZS', () => {
    expect(DEFAULT_CURRENCY).toBe(SupportedCurrency.TZS);
  });

  it('recognizes exactly the four supported ISO codes', () => {
    expect(isSupportedCurrency('TZS')).toBe(true);
    expect(isSupportedCurrency('KES')).toBe(true);
    expect(isSupportedCurrency('UGX')).toBe(true);
    expect(isSupportedCurrency('RWF')).toBe(true);
    expect(isSupportedCurrency('USD')).toBe(false);
    expect(isSupportedCurrency('')).toBe(false);
  });

  describe('toStripeMinorUnits', () => {
    // TZS and KES are standard 2-decimal presentment currencies on
    // Stripe — the fix this pass made (previously TZS was wrongly
    // treated as zero-decimal, which would have undercharged 100x).
    it('multiplies by 100 for TZS (a 2-decimal Stripe currency)', () => {
      expect(toStripeMinorUnits('8500.00', SupportedCurrency.TZS)).toBe(850000);
    });

    it('multiplies by 100 for KES (a 2-decimal Stripe currency)', () => {
      expect(toStripeMinorUnits('1250.50', SupportedCurrency.KES)).toBe(125050);
    });

    // UGX and RWF ARE zero-decimal on Stripe — the raw whole-unit amount
    // goes through unchanged.
    it('passes UGX through unchanged (a zero-decimal Stripe currency)', () => {
      expect(toStripeMinorUnits('8500.00', SupportedCurrency.UGX)).toBe(8500);
    });

    it('passes RWF through unchanged (a zero-decimal Stripe currency)', () => {
      expect(toStripeMinorUnits('8500.00', SupportedCurrency.RWF)).toBe(8500);
    });

    it('rounds rather than truncating', () => {
      expect(toStripeMinorUnits('10.005', SupportedCurrency.TZS)).toBe(1001);
    });
  });

  describe('fromStripeMinorUnits', () => {
    it('divides by 100 for a 2-decimal currency', () => {
      expect(fromStripeMinorUnits(850000, SupportedCurrency.TZS)).toBe('8500.00');
    });

    it('passes a zero-decimal currency through unchanged', () => {
      expect(fromStripeMinorUnits(8500, SupportedCurrency.RWF)).toBe('8500.00');
    });

    it('round-trips with toStripeMinorUnits for both decimal shapes', () => {
      const tzsMinor = toStripeMinorUnits('8500.00', SupportedCurrency.TZS);
      expect(fromStripeMinorUnits(tzsMinor, SupportedCurrency.TZS)).toBe('8500.00');

      const ugxMinor = toStripeMinorUnits('8500.00', SupportedCurrency.UGX);
      expect(fromStripeMinorUnits(ugxMinor, SupportedCurrency.UGX)).toBe('8500.00');
    });
  });

  describe('getCurrencyInfo', () => {
    it('flags exactly UGX and RWF as Stripe zero-decimal, not TZS or KES', () => {
      expect(getCurrencyInfo(SupportedCurrency.TZS).stripeZeroDecimal).toBe(false);
      expect(getCurrencyInfo(SupportedCurrency.KES).stripeZeroDecimal).toBe(false);
      expect(getCurrencyInfo(SupportedCurrency.UGX).stripeZeroDecimal).toBe(true);
      expect(getCurrencyInfo(SupportedCurrency.RWF).stripeZeroDecimal).toBe(true);
    });
  });
});
