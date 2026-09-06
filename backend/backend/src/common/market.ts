// Country/locale config — the second Phase 4 sub-piece, built on top of
// the multi-currency core in src/common/currency.ts. A "market" here is
// deliberately minimal: just enough to (a) know which currency a user's
// shipments should default to, and (b) sanity-check a phone number was
// entered for the country the user says they're in. It is NOT address
// parsing/formatting, tax/regulatory rules, or shipment routing — those
// stay out of scope (see PHASE4_MULTI_CURRENCY_CORE.md's "what did NOT
// change" and MASTER_GAPS_AND_ROADMAP.md's Phase 4 entry).
//
// Every market maps 1:1 to a SupportedCurrency for now (one country, one
// currency) — that's true for all four Phase 1/4 markets and keeps this
// registry simple. If a shared-currency zone (e.g. a future EAC common
// currency) is ever added, this 1:1 assumption is the first thing to
// revisit.

import { SupportedCurrency } from './currency';

export enum MarketCountryCode {
  TZ = 'TZ', // Tanzania — Phase 1 (Dar es Salaam)
  KE = 'KE', // Kenya
  UG = 'UG', // Uganda
  RW = 'RW', // Rwanda
}

export const DEFAULT_MARKET = MarketCountryCode.TZ;

interface MarketInfo {
  countryCode: MarketCountryCode;
  name: string;
  currency: SupportedCurrency;
  // E.164 calling code, no leading '+' — e.g. '255' for Tanzania. Used
  // to sanity-check a registering user's phone matches the market they
  // selected, and to infer a market from a bare phone number when no
  // market was given.
  callingCode: string;
  // IANA timezone. Only Rwanda differs among these four — Tanzania,
  // Kenya, and Uganda are all East Africa Time (UTC+3); Rwanda is
  // Central Africa Time (UTC+2). Nothing in this codebase reads this
  // yet (MpesaProvider's darajaTimestamp() hardcodes EAT because that
  // provider is Tanzania-only regardless — see mpesa.provider.ts) but a
  // future scheduled-delivery or surge-window feature operating outside
  // Tanzania would need it, so it's captured here now rather than
  // rediscovered later.
  timezone: string;
}

const MARKET_INFO: Record<MarketCountryCode, MarketInfo> = {
  [MarketCountryCode.TZ]: {
    countryCode: MarketCountryCode.TZ,
    name: 'Tanzania',
    currency: SupportedCurrency.TZS,
    callingCode: '255',
    timezone: 'Africa/Dar_es_Salaam',
  },
  [MarketCountryCode.KE]: {
    countryCode: MarketCountryCode.KE,
    name: 'Kenya',
    currency: SupportedCurrency.KES,
    callingCode: '254',
    timezone: 'Africa/Nairobi',
  },
  [MarketCountryCode.UG]: {
    countryCode: MarketCountryCode.UG,
    name: 'Uganda',
    currency: SupportedCurrency.UGX,
    callingCode: '256',
    timezone: 'Africa/Kampala',
  },
  [MarketCountryCode.RW]: {
    countryCode: MarketCountryCode.RW,
    name: 'Rwanda',
    currency: SupportedCurrency.RWF,
    callingCode: '250',
    timezone: 'Africa/Kigali',
  },
};

export function isSupportedMarket(value: string): value is MarketCountryCode {
  return Object.prototype.hasOwnProperty.call(MARKET_INFO, value);
}

export function getMarket(countryCode: MarketCountryCode): MarketInfo {
  return MARKET_INFO[countryCode];
}

// The currency a user in this market should default to when they don't
// explicitly choose one — e.g. ShipmentsService falling back to the
// requesting customer's registered market instead of a hardcoded
// currency. See User.countryCode.
export function currencyForMarket(countryCode: MarketCountryCode): SupportedCurrency {
  return getMarket(countryCode).currency;
}

// True if `phone` (any format containing the digits, with or without a
// leading '+') starts with the given market's calling code. A loose
// prefix check, not full E.164 validation — RegisterDto's
// @IsPhoneNumber already guarantees `phone` is a globally valid number
// before this ever runs; this only checks it's valid for the *claimed*
// market, catching the likely-user-error case of picking the wrong
// country in a dropdown.
export function phoneMatchesMarket(phone: string, countryCode: MarketCountryCode): boolean {
  const digitsOnly = phone.replace(/[^\d]/g, '');
  return digitsOnly.startsWith(getMarket(countryCode).callingCode);
}

// Best-effort market guess from a phone number's calling code, for
// contexts with no explicit country selection. Returns null (not a
// default) when the number doesn't match any supported market's calling
// code — callers should fall back to DEFAULT_MARKET themselves rather
// than have this silently guess wrong.
export function marketForPhone(phone: string): MarketCountryCode | null {
  const digitsOnly = phone.replace(/[^\d]/g, '');
  const match = Object.values(MARKET_INFO).find((info) =>
    digitsOnly.startsWith(info.callingCode),
  );
  return match?.countryCode ?? null;
}
