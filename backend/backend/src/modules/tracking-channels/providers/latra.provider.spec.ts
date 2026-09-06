import { ConfigService } from '@nestjs/config';
import { LatraProvider } from './latra.provider';
import { PartnerOperator, PartnerOperatorStatus } from '../../../database/entities/partner-operator.entity';

// Same reasoning as payment-providers.spec.ts (mpesa/stripe): no real
// LATRA credentials exist to test against in this environment, so this
// only verifies the mock-vs-real switch itself, not a real integration —
// see LatraProvider's header comment for why the real-credentials branch
// is a draft, not verified code.

function configWithout(): ConfigService {
  return { get: jest.fn(() => undefined) } as unknown as ConfigService;
}

function configWith(values: Record<string, string>): ConfigService {
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

function operator(overrides: Partial<PartnerOperator> = {}): PartnerOperator {
  return {
    id: 'operator-1',
    name: 'Kilimanjaro Express',
    phone: null,
    email: null,
    apiKeyHash: 'hashed',
    latraApiKey: null,
    status: PartnerOperatorStatus.ACTIVE,
    createdAt: new Date(),
    ...overrides,
  } as PartnerOperator;
}

describe('LatraProvider', () => {
  it('returns null coordinates (not a fake position) with no LATRA_BASE_URL configured', async () => {
    const provider = new LatraProvider(configWithout());
    const result = await provider.pollVehicleLocation(
      operator({ latraApiKey: 'some-key' }),
      'T 123 XYZ',
    );

    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
    expect(provider.hasRealCredentials(operator({ latraApiKey: 'some-key' }))).toBe(false);
  });

  it('stays on the mock path when LATRA_BASE_URL is set but the operator has no latra_api_key', async () => {
    const provider = new LatraProvider(configWith({ LATRA_BASE_URL: 'https://latra.example' }));
    const result = await provider.pollVehicleLocation(operator({ latraApiKey: null }), 'T 123 XYZ');

    expect(result.latitude).toBeNull();
    expect(result.raw).toEqual(
      expect.objectContaining({ mock: true, vehicleRegistration: 'T 123 XYZ' }),
    );
  });

  it('reports real credentials only when both LATRA_BASE_URL and the operator key are set', () => {
    const provider = new LatraProvider(configWith({ LATRA_BASE_URL: 'https://latra.example' }));
    expect(provider.hasRealCredentials(operator({ latraApiKey: 'op-key' }))).toBe(true);
    expect(provider.hasRealCredentials(operator({ latraApiKey: null }))).toBe(false);
  });
});
