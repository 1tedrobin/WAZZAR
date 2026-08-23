import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingConfig, PricingMode } from '../../database/entities/pricing-config.entity';

// Minimal fake of the slice of Repository<T> this service actually calls.
function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'config-1', ...x })),
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
  };
}

// Matches the Phase 1 Tanzania config seeded by the
// CreatePricingConfigsTable migration.
function activeConfig(overrides: Partial<PricingConfig> = {}): PricingConfig {
  return {
    id: 'config-1',
    pricingMode: PricingMode.HYBRID,
    isActive: true,
    basePrice: '5000.00',
    pricePerKm: '500.00',
    includedDistanceKm: '1.00',
    pricePerKg: '1000.00',
    includedWeightKg: '0.50',
    platformCommissionPercent: '20.00',
    riderPayoutPercent: '80.00',
    surgeMultiplier: '1.50',
    surgeActiveHours: [[8, 11], [17, 21]],
    minPrice: '2000.00',
    maxPrice: '50000.00',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    effectiveTo: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    ...overrides,
  } as PricingConfig;
}

describe('PricingService', () => {
  let service: PricingService;
  let configRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    configRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingService,
        { provide: getRepositoryToken(PricingConfig), useValue: configRepo },
      ],
    }).compile();

    service = module.get(PricingService);
  });

  describe('calculatePrice', () => {
    it('matches the worked example from the implementation guide (5km, 2kg, off-peak)', async () => {
      configRepo.findOne.mockResolvedValue(activeConfig());

      const quote = await service.calculatePrice({
        distanceKm: 5,
        weightKg: 2,
        at: '2026-01-15T06:00:00Z', // 06:00 UTC — outside both surge windows
      });

      expect(quote.basePrice).toBe('5000.00');
      expect(quote.distanceCharge).toBe('2000.00'); // (5-1) * 500
      expect(quote.weightCharge).toBe('1500.00'); // (2-0.5) * 1000
      expect(quote.subtotal).toBe('8500.00');
      expect(quote.surgeMultiplier).toBe('1.00');
      expect(quote.price).toBe('8500.00');
      expect(quote.commission).toBe('1700.00'); // 20%
      expect(quote.riderPayout).toBe('6800.00'); // 80%
    });

    it('applies the surge multiplier when the quote time falls in a surge window', async () => {
      configRepo.findOne.mockResolvedValue(activeConfig());

      // 09:00 local hour falls inside the [8,11] window.
      const quote = await service.calculatePrice({
        distanceKm: 5,
        weightKg: 2,
        at: new Date(2026, 0, 15, 9, 0, 0).toISOString(),
      });

      expect(quote.surgeMultiplier).toBe('1.50');
      expect(quote.subtotal).toBe('8500.00');
      expect(quote.price).toBe('12750.00'); // 8500 * 1.5
    });

    it('does not apply surge outside the configured hours', async () => {
      configRepo.findOne.mockResolvedValue(activeConfig());

      const quote = await service.calculatePrice({
        distanceKm: 5,
        weightKg: 2,
        at: new Date(2026, 0, 15, 14, 0, 0).toISOString(),
      });

      expect(quote.surgeMultiplier).toBe('1.00');
      expect(quote.price).toBe('8500.00');
    });

    it('honours an explicit surgeMultiplier override instead of deriving one', async () => {
      configRepo.findOne.mockResolvedValue(activeConfig());

      const quote = await service.calculatePrice({
        distanceKm: 5,
        weightKg: 2,
        surgeMultiplier: 2,
        at: new Date(2026, 0, 15, 14, 0, 0).toISOString(), // off-peak hour
      });

      expect(quote.surgeMultiplier).toBe('2.00');
      expect(quote.price).toBe('17000.00'); // 8500 * 2
    });

    it('floors the price at minPrice when the subtotal would come in under it', async () => {
      configRepo.findOne.mockResolvedValue(activeConfig({ minPrice: '6000.00' }));

      // distance/weight both under the included allowance, so subtotal
      // is just the 5000 base — below the 6000 floor set above.
      const quote = await service.calculatePrice({
        distanceKm: 0.5,
        weightKg: 0,
        at: '2026-01-15T14:00:00Z', // off-peak — isolates the min-price floor from surge
      });

      expect(quote.subtotal).toBe('5000.00');
      expect(quote.price).toBe('6000.00');
    });

    it('caps the price at maxPrice for a very long, heavy delivery', async () => {
      configRepo.findOne.mockResolvedValue(activeConfig());

      const quote = await service.calculatePrice({ distanceKm: 500, weightKg: 200 });

      expect(quote.price).toBe('50000.00');
    });

    it('splits commission and rider payout so they always sum to the total price', async () => {
      configRepo.findOne.mockResolvedValue(
        activeConfig({ platformCommissionPercent: '25.00', riderPayoutPercent: '75.00' }),
      );

      const quote = await service.calculatePrice({ distanceKm: 3.3, weightKg: 1.7 });

      expect(Number(quote.commission) + Number(quote.riderPayout)).toBeCloseTo(
        Number(quote.price),
        2,
      );
    });

    it('throws NotFoundException when no active config covers the requested time', async () => {
      configRepo.findOne.mockResolvedValue(undefined);

      await expect(service.calculatePrice({ distanceKm: 5 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createConfig', () => {
    const validDto = {
      pricingMode: PricingMode.HYBRID,
      basePrice: 5000,
      platformCommissionPercent: 20,
      riderPayoutPercent: 80,
    };

    it('rejects a commission split that does not sum to 100', async () => {
      await expect(
        service.createConfig(
          { ...validDto, platformCommissionPercent: 30, riderPayoutPercent: 80 },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(configRepo.save).not.toHaveBeenCalled();
    });

    it('deactivates any currently-active config before creating the new one', async () => {
      await service.createConfig(validDto, 'admin-1');

      expect(configRepo.update).toHaveBeenCalledWith(
        { isActive: true },
        expect.objectContaining({ isActive: false }),
      );
    });

    it('rejects an invalid surge window', async () => {
      await expect(
        service.createConfig(
          { ...validDto, surgeActiveHours: [[11, 8]] },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the config as active with the given admin as createdBy', async () => {
      await service.createConfig(validDto, 'admin-1');

      expect(configRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true, createdBy: 'admin-1' }),
      );
    });
  });

  describe('updateConfig', () => {
    it('throws NotFoundException for an unknown config id', async () => {
      configRepo.findOne.mockResolvedValue(undefined);

      await expect(
        service.updateConfig('missing-id', { basePrice: 6000 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('re-validates the commission split when only one side of it changes', async () => {
      configRepo.findOne.mockResolvedValue(activeConfig());

      await expect(
        service.updateConfig('config-1', { platformCommissionPercent: 50 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('applies a partial update without requiring every field', async () => {
      configRepo.findOne.mockResolvedValue(activeConfig());

      const updated = await service.updateConfig('config-1', { basePrice: 6000 });

      expect(updated.basePrice).toBe('6000');
      expect(updated.pricePerKm).toBe('500.00'); // untouched
    });
  });
});
