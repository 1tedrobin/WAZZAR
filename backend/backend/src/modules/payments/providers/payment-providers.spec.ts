import { ConfigService } from '@nestjs/config';
import { StripeProvider } from './stripe.provider';
import { MpesaProvider } from './mpesa.provider';
import { _resetStripeClientForTests } from './stripe-client';

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
});
