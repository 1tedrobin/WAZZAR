import { ConfigService } from '@nestjs/config';
import { StripeProvider } from './stripe.provider';
import { MpesaProvider } from './mpesa.provider';
import { MpesaTanzaniaProvider } from './mpesa-tanzania.provider';
import { MpesaKenyaProvider } from './mpesa-kenya.provider';
import { MtnMomoProvider } from './mtn-momo.provider';
import { _resetStripeClientForTests } from './stripe-client';
import { SupportedCurrency } from '../../../common/currency';

// payments.service.spec.ts injects fully-mocked MpesaProvider/StripeProvider
// (`useValue`), so it never actually exercises either class's real body —
// only the mock-vs-real credential switch added in this pass is new
// enough to need its own direct coverage. Real network calls (Stripe SDK,
// Daraja fetch) are deliberately NOT exercised here — no real credentials
// exist to test against in this environment. What IS verified: given no
// real credentials, both providers behave exactly like their old
// always-mock versions (never touching the network), which is the
// property that matters most for not breaking anything.

function configWithout(): ConfigService {
  return { get: jest.fn(() => undefined) } as unknown as ConfigService;
}

function configWith(values: Record<string, string>): ConfigService {
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

describe('StripeProvider — mock fallback', () => {
  afterEach(() => {
    _resetStripeClientForTests();
  });

  it('stays on the mock path with no STRIPE_SECRET_KEY configured', async () => {
    const provider = new StripeProvider(configWithout());
    const result = await provider.initiate('cust-1', '8500.00', 'tok_visa');
    expect(result.transactionId).toMatch(/^STRIPE-/);
  });

  it('stays on the mock path when STRIPE_SECRET_KEY is set but not a real-looking key', async () => {
    const provider = new StripeProvider(configWith({ STRIPE_SECRET_KEY: 'placeholder' }));
    const result = await provider.initiate('cust-1', '8500.00', 'tok_visa');
    expect(result.transactionId).toMatch(/^STRIPE-/);
  });

  it('mock refund never touches the network either', async () => {
    const provider = new StripeProvider(configWithout());
    const result = await provider.refund('STRIPE-abc', '8500.00');
    expect(result.refundId).toMatch(/^STRIPE-REFUND-/);
  });

  it('accepts an explicit non-default currency on the mock path too (currency only matters once real credentials exist)', async () => {
    const provider = new StripeProvider(configWithout());
    const result = await provider.initiate(
      'cust-1',
      '8500.00',
      'tok_visa',
      SupportedCurrency.RWF,
    );
    expect(result.transactionId).toMatch(/^STRIPE-/);
  });

  // Deliberately NOT tested here: the real-credentials branch (would
  // require either a live Stripe sandbox key or mocking the `stripe`
  // package's internals, neither of which meaningfully proves this
  // works against the real API) — see PAYMENTS_GOING_LIVE.md, "Testing
  // before going live" for how to verify that path for real once
  // sandbox credentials exist.
});

describe('MpesaProvider — mock fallback', () => {
  it('stays on the mock path with no Daraja credentials configured', async () => {
    const provider = new MpesaProvider(configWithout());
    const result = await provider.initiate('255700000001', '8500.00', 'shipment-1');
    expect(result.transactionId).toMatch(/^MPESA-/);
  });

  it('stays on the mock path when only some Daraja credentials are set (deliberately all-or-nothing)', async () => {
    const provider = new MpesaProvider(
      configWith({ MPESA_CONSUMER_KEY: 'key', MPESA_CONSUMER_SECRET: 'secret' }),
    );
    const result = await provider.initiate('255700000001', '8500.00', 'shipment-1');
    expect(result.transactionId).toMatch(/^MPESA-/);
  });

  it('mock refund succeeds (real-credentials refund path is a deliberate throw — see below)', async () => {
    const provider = new MpesaProvider(configWithout());
    const result = await provider.refund('MPESA-abc', '8500.00');
    expect(result.refundId).toMatch(/^MPESA-REFUND-/);
  });

  it('refund refuses to silently pretend to succeed once real credentials exist', async () => {
    const provider = new MpesaProvider(
      configWith({
        MPESA_CONSUMER_KEY: 'key',
        MPESA_CONSUMER_SECRET: 'secret',
        MPESA_SHORTCODE: '174379',
        MPESA_PASSKEY: 'passkey',
        MPESA_CALLBACK_URL: 'https://api.wazzar.tz/payments/webhooks/mpesa',
      }),
    );
    await expect(provider.refund('MPESA-abc', '8500.00')).rejects.toThrow(
      /not automated/,
    );
  });

  // This Daraja registration is Tanzania-only (see the class-level doc
  // comment on MpesaProvider) — a KES/UGX/RWF payment would otherwise
  // silently be routed through the wrong country's M-Pesa network, which
  // is worse than refusing outright. Guard applies on both the mock and
  // real-credentials paths, and regardless of whether credentials exist
  // (a currency mismatch is a caller bug, not a config problem).
  it('rejects a non-TZS currency on initiate, even on the mock path', async () => {
    const provider = new MpesaProvider(configWithout());
    await expect(
      provider.initiate('255700000001', '8500.00', 'shipment-1', SupportedCurrency.KES),
    ).rejects.toThrow(/KES/);
  });

  it('rejects a non-TZS currency on refund, even on the mock path', async () => {
    const provider = new MpesaProvider(configWithout());
    await expect(
      provider.refund('MPESA-abc', '8500.00', SupportedCurrency.UGX),
    ).rejects.toThrow(/UGX/);
  });

  it('still defaults to TZS and succeeds when no currency argument is given', async () => {
    const provider = new MpesaProvider(configWithout());
    const result = await provider.initiate('255700000001', '8500.00', 'shipment-1');
    expect(result.transactionId).toMatch(/^MPESA-/);
  });
});

describe('MpesaKenyaProvider — mock fallback + currency guard', () => {
  it('stays on the mock path with no MPESA_KE_* credentials configured', async () => {
    const provider = new MpesaKenyaProvider(configWithout());
    const result = await provider.initiate(
      '254712345678',
      '8500.00',
      'shipment-1',
      SupportedCurrency.KES,
    );
    expect(result.transactionId).toMatch(/^MPESA-KE-/);
  });

  it('mock refund never touches the network either', async () => {
    const provider = new MpesaKenyaProvider(configWithout());
    const result = await provider.refund('MPESA-KE-abc', '8500.00', SupportedCurrency.KES);
    expect(result.refundId).toMatch(/^MPESA-KE-REFUND-/);
  });

  // This Daraja registration is Kenya-only — see the class-level doc
  // comment on MpesaKenyaProvider for why it's a fully separate class
  // (and separate env var prefix) from the Tanzania MpesaProvider,
  // rather than one class parameterized by currency.
  it('rejects a non-KES currency on initiate, even on the mock path', async () => {
    const provider = new MpesaKenyaProvider(configWithout());
    await expect(
      provider.initiate('255712345678', '8500.00', 'shipment-1', SupportedCurrency.TZS),
    ).rejects.toThrow(/TZS/);
  });

  it('rejects a non-KES currency on refund, even on the mock path', async () => {
    const provider = new MpesaKenyaProvider(configWithout());
    await expect(
      provider.refund('MPESA-KE-abc', '8500.00', SupportedCurrency.UGX),
    ).rejects.toThrow(/UGX/);
  });

  it('refund refuses to silently pretend to succeed once real credentials exist', async () => {
    const provider = new MpesaKenyaProvider(
      configWith({
        MPESA_KE_CONSUMER_KEY: 'key',
        MPESA_KE_CONSUMER_SECRET: 'secret',
        MPESA_KE_SHORTCODE: '174379',
        MPESA_KE_PASSKEY: 'passkey',
        MPESA_KE_CALLBACK_URL: 'https://api.wazzar.tz/payments/webhooks/mpesa-ke',
      }),
    );
    await expect(
      provider.refund('MPESA-KE-abc', '8500.00', SupportedCurrency.KES),
    ).rejects.toThrow(/not automated/);
  });
});

describe('MtnMomoProvider — mock fallback + currency guard', () => {
  it('stays on the mock path with no MTN_MOMO_UG_* credentials configured', async () => {
    const provider = new MtnMomoProvider(configWithout());
    const result = await provider.initiate(
      '256712345678',
      '8500.00',
      'shipment-1',
      SupportedCurrency.UGX,
    );
    expect(result.transactionId).toMatch(/^MOMO-/);
  });

  it('stays on the mock path with no MTN_MOMO_RW_* credentials configured', async () => {
    const provider = new MtnMomoProvider(configWithout());
    const result = await provider.initiate(
      '250712345678',
      '8500.00',
      'shipment-1',
      SupportedCurrency.RWF,
    );
    expect(result.transactionId).toMatch(/^MOMO-/);
  });

  it('lets Uganda go live independently of Rwanda — only MTN_MOMO_UG_* configured still uses mock for RWF', async () => {
    const provider = new MtnMomoProvider(
      configWith({
        MTN_MOMO_UG_SUBSCRIPTION_KEY: 'sub-key',
        MTN_MOMO_UG_API_USER: '11111111-1111-1111-1111-111111111111',
        MTN_MOMO_UG_API_KEY: 'api-key',
        MTN_MOMO_UG_TARGET_ENVIRONMENT: 'sandbox',
      }),
    );
    const result = await provider.initiate(
      '250712345678',
      '8500.00',
      'shipment-1',
      SupportedCurrency.RWF,
    );
    // Real MTN_MOMO_UG_* credentials exist but this is an RWF payment,
    // which only ever looks at MTN_MOMO_RW_* — none configured, so still
    // mock, not a network call using Uganda's credentials for Rwanda.
    expect(result.transactionId).toMatch(/^MOMO-/);
  });

  it('mock refund never touches the network either', async () => {
    const provider = new MtnMomoProvider(configWithout());
    const result = await provider.refund('MOMO-abc', '8500.00', SupportedCurrency.UGX);
    expect(result.refundId).toMatch(/^MOMO-REFUND-/);
  });

  it('rejects a currency with no MTN MoMo credential-set mapping at all, even on the mock path', async () => {
    const provider = new MtnMomoProvider(configWithout());
    await expect(
      provider.initiate('255712345678', '8500.00', 'shipment-1', SupportedCurrency.TZS),
    ).rejects.toThrow(/TZS/);
  });

  it('refund refuses to silently pretend to succeed once real credentials exist', async () => {
    const provider = new MtnMomoProvider(
      configWith({
        MTN_MOMO_UG_SUBSCRIPTION_KEY: 'sub-key',
        MTN_MOMO_UG_API_USER: '11111111-1111-1111-1111-111111111111',
        MTN_MOMO_UG_API_KEY: 'api-key',
        MTN_MOMO_UG_TARGET_ENVIRONMENT: 'sandbox',
      }),
    );
    await expect(
      provider.refund('MOMO-abc', '8500.00', SupportedCurrency.UGX),
    ).rejects.toThrow(/not automated|Collections credentials/);
  });
});

describe('MpesaTanzaniaProvider — mock fallback + currency guard', () => {
  // See docs/delivery-notes/TANZANIA_MPESA_FIX.md — this is the real
  // Vodacom Open API attempt that replaces MpesaProvider (deprecated,
  // was actually calling Safaricom's API) for TZS. Only the mock
  // fallback path and the currency guard are tested here, same as
  // every other provider in this file — the real-credentials path
  // (RSA encryption, getSession, c2bPayment/singleStage) is explicitly
  // NOT verified against a live sandbox anywhere in this codebase; see
  // that file for why.
  it('stays on the mock path with no MPESA_TZ_* credentials configured', async () => {
    const provider = new MpesaTanzaniaProvider(configWithout());
    const result = await provider.initiate(
      '255712345678',
      '8500.00',
      'shipment-1',
      SupportedCurrency.TZS,
    );
    expect(result.transactionId).toMatch(/^MPESA-TZ-/);
  });

  it('mock refund never touches the network either', async () => {
    const provider = new MpesaTanzaniaProvider(configWithout());
    const result = await provider.refund('MPESA-TZ-abc', '8500.00', SupportedCurrency.TZS);
    expect(result.refundId).toMatch(/^MPESA-TZ-REFUND-/);
  });

  it('rejects a non-TZS currency on initiate, even on the mock path', async () => {
    const provider = new MpesaTanzaniaProvider(configWithout());
    await expect(
      provider.initiate('254712345678', '8500.00', 'shipment-1', SupportedCurrency.KES),
    ).rejects.toThrow(/KES/);
  });

  it('rejects a non-TZS currency on refund, even on the mock path', async () => {
    const provider = new MpesaTanzaniaProvider(configWithout());
    await expect(
      provider.refund('MPESA-TZ-abc', '8500.00', SupportedCurrency.UGX),
    ).rejects.toThrow(/UGX/);
  });

  // Unlike the other three mobile-money providers in this codebase,
  // MpesaTanzaniaProvider's refund() genuinely attempts a real API call
  // rather than immediately throwing "not automated" — see its
  // class-level comment on why Vodacom's reversal endpoint looked
  // automatable from the available references. This test only confirms
  // the credential-presence check still gates it the same way every
  // other provider's real-credentials path is gated — it does NOT (and
  // cannot, in this environment) verify the actual HTTP call succeeds.
  it('does not fall through to mock behavior once real credentials are configured (would attempt a real call)', async () => {
    const provider = new MpesaTanzaniaProvider(
      configWith({
        MPESA_TZ_API_KEY: 'test-api-key',
        MPESA_TZ_PUBLIC_KEY_PEM: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBg...\n-----END PUBLIC KEY-----',
        MPESA_TZ_SERVICE_PROVIDER_CODE: '000000',
      }),
    );
    // No real network access in this test environment (and the fixture
    // public key above isn't a real RSA key), so this call is expected
    // to fail — the point of this test is only that it does NOT return
    // the mock's "MPESA-TZ-..." transactionId once credentials are
    // present, i.e. it didn't silently stay on the mock path.
    await expect(
      provider.initiate('255712345678', '8500.00', 'shipment-1', SupportedCurrency.TZS),
    ).rejects.toThrow();
  });
});
