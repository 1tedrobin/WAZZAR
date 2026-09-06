import {
  DEFAULT_MARKET,
  MarketCountryCode,
  currencyForMarket,
  getMarket,
  isSupportedMarket,
  marketForPhone,
  phoneMatchesMarket,
} from './market';
import { SupportedCurrency } from './currency';

describe('market registry', () => {
  it('defaults to TZ', () => {
    expect(DEFAULT_MARKET).toBe(MarketCountryCode.TZ);
  });

  it('recognizes exactly the four supported market codes', () => {
    expect(isSupportedMarket('TZ')).toBe(true);
    expect(isSupportedMarket('KE')).toBe(true);
    expect(isSupportedMarket('UG')).toBe(true);
    expect(isSupportedMarket('RW')).toBe(true);
    expect(isSupportedMarket('US')).toBe(false);
    expect(isSupportedMarket('')).toBe(false);
  });

  describe('currencyForMarket', () => {
    it('maps each market to its one currency', () => {
      expect(currencyForMarket(MarketCountryCode.TZ)).toBe(SupportedCurrency.TZS);
      expect(currencyForMarket(MarketCountryCode.KE)).toBe(SupportedCurrency.KES);
      expect(currencyForMarket(MarketCountryCode.UG)).toBe(SupportedCurrency.UGX);
      expect(currencyForMarket(MarketCountryCode.RW)).toBe(SupportedCurrency.RWF);
    });
  });

  describe('getMarket', () => {
    it('returns the calling code and timezone for a market', () => {
      const rwanda = getMarket(MarketCountryCode.RW);
      expect(rwanda.callingCode).toBe('250');
      expect(rwanda.timezone).toBe('Africa/Kigali');
    });
  });

  describe('phoneMatchesMarket', () => {
    it('accepts a phone with the matching calling code, +prefixed or not', () => {
      expect(phoneMatchesMarket('+255712345678', MarketCountryCode.TZ)).toBe(true);
      expect(phoneMatchesMarket('255712345678', MarketCountryCode.TZ)).toBe(true);
    });

    it('rejects a phone with a different calling code', () => {
      expect(phoneMatchesMarket('+254712345678', MarketCountryCode.TZ)).toBe(false);
    });
  });

  describe('marketForPhone', () => {
    it('infers the market from a phone number calling code', () => {
      expect(marketForPhone('+256712345678')).toBe(MarketCountryCode.UG);
      expect(marketForPhone('+250712345678')).toBe(MarketCountryCode.RW);
    });

    it('returns null for a calling code with no supported market, rather than guessing', () => {
      expect(marketForPhone('+16505551234')).toBeNull();
    });
  });
});
