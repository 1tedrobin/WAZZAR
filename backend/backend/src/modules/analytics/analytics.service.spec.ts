import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';

function mockRepo() {
  return { find: jest.fn().mockResolvedValue([]) };
}

const BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000001';

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'shipment-1',
    customerId: BUSINESS_ID,
    riderId: null,
    status: ShipmentStatus.COMPLETED,
    pickupLocation: { latitude: -6.8, longitude: 39.28, address: 'Mikocheni B, Dar es Salaam' },
    dropoffLocation: { latitude: -6.81, longitude: 39.29, address: 'CBD, Dar es Salaam' },
    packageWeightKg: null,
    packageDescription: null,
    price: '5000.00',
    commission: '750.00',
    riderPayout: '4250.00',
    riderRating: 5,
    createdAt: new Date('2026-06-10T09:00:00Z'),
    assignedAt: null,
    pickedUpAt: null,
    deliveredAt: new Date('2026-06-10T09:20:00Z'),
    completedAt: new Date('2026-06-10T09:25:00Z'),
    ...overrides,
  } as Shipment;
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    repo = mockRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnalyticsService, { provide: getRepositoryToken(Shipment), useValue: repo }],
    }).compile();
    service = module.get(AnalyticsService);
  });

  describe('range resolution', () => {
    it('defaults to the last 30 days when no range is given', async () => {
      const result = await service.getSummary(BUSINESS_ID, {});

      const days = (new Date(`${result.periodEnd}T00:00:00Z`).getTime() -
        new Date(`${result.periodStart}T00:00:00Z`).getTime()) / 86400000;
      expect(days).toBe(29);
    });

    it('throws BadRequestException when only one of periodStart/periodEnd is given', async () => {
      await expect(service.getSummary(BUSINESS_ID, { periodStart: '2026-06-01' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when periodStart is after periodEnd', async () => {
      await expect(
        service.getSummary(BUSINESS_ID, { periodStart: '2026-06-30', periodEnd: '2026-06-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('scopes the shipment query to the given business and range', async () => {
      await service.getSummary(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-30' });

      const queryArg = repo.find.mock.calls[0][0];
      expect(queryArg.where.customerId).toBe(BUSINESS_ID);
    });
  });

  describe('totals', () => {
    it('computes completion rate, spend (excluding cancelled), delivery time, and rating averages', async () => {
      repo.find.mockResolvedValue([
        shipment({ id: 's1', status: ShipmentStatus.COMPLETED, price: '5000.00', riderRating: 5 }),
        shipment({ id: 's2', status: ShipmentStatus.DELIVERED, price: '3000.00', riderRating: 4 }),
        shipment({ id: 's3', status: ShipmentStatus.CANCELLED, price: '2000.00', riderRating: null, deliveredAt: null }),
      ]);

      const result = await service.getSummary(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-30' });

      expect(result.totals.shipments).toBe(3);
      expect(result.totals.completed).toBe(2);
      expect(result.totals.cancelled).toBe(1);
      expect(result.totals.completionRate).toBeCloseTo(66.7, 1);
      // Spend excludes the cancelled shipment's price.
      expect(result.totals.totalSpend).toBe(8000);
      expect(result.totals.avgDeliveryMinutes).toBe(20);
      expect(result.totals.avgRiderRating).toBe(4.5);
    });

    it('returns nulls for completion rate / delivery time / rating when there is no relevant data', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.getSummary(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-30' });

      expect(result.totals.completionRate).toBeNull();
      expect(result.totals.avgDeliveryMinutes).toBeNull();
      expect(result.totals.avgRiderRating).toBeNull();
      expect(result.totals.totalSpend).toBe(0);
    });
  });

  describe('dailySeries', () => {
    it('pre-seeds every date in range with zeros, even with no shipments', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.getSummary(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-03' });

      expect(result.dailySeries).toEqual([
        { date: '2026-06-01', shipments: 0, spend: 0 },
        { date: '2026-06-02', shipments: 0, spend: 0 },
        { date: '2026-06-03', shipments: 0, spend: 0 },
      ]);
    });

    it('buckets shipments by their created date and sums spend', async () => {
      repo.find.mockResolvedValue([
        shipment({ id: 's1', createdAt: new Date('2026-06-01T08:00:00Z'), price: '1000.00' }),
        shipment({ id: 's2', createdAt: new Date('2026-06-01T18:00:00Z'), price: '2000.00' }),
        shipment({ id: 's3', createdAt: new Date('2026-06-02T08:00:00Z'), price: '3000.00' }),
      ]);

      const result = await service.getSummary(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-02' });

      expect(result.dailySeries[0]).toEqual({ date: '2026-06-01', shipments: 2, spend: 3000 });
      expect(result.dailySeries[1]).toEqual({ date: '2026-06-02', shipments: 1, spend: 3000 });
    });

    it('sums fractional-cent-prone amounts exactly, without float drift', async () => {
      // 0.1 + 0.2 style values that famously misbehave under naive
      // float addition (0.1 + 0.2 !== 0.3 in JS) — exercises the
      // cents-based accumulation in buildDailySeries.
      repo.find.mockResolvedValue([
        shipment({ id: 's1', createdAt: new Date('2026-06-01T08:00:00Z'), price: '10.10' }),
        shipment({ id: 's2', createdAt: new Date('2026-06-01T09:00:00Z'), price: '10.20' }),
        shipment({ id: 's3', createdAt: new Date('2026-06-01T10:00:00Z'), price: '10.30' }),
      ]);

      const result = await service.getSummary(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-01' });

      expect(result.dailySeries[0].spend).toBe(30.6);
      expect(result.totals.totalSpend).toBe(30.6);
    });
  });

  describe('statusBreakdown', () => {
    it('groups by status, sorted by count descending', async () => {
      repo.find.mockResolvedValue([
        shipment({ id: 's1', status: ShipmentStatus.COMPLETED }),
        shipment({ id: 's2', status: ShipmentStatus.COMPLETED }),
        shipment({ id: 's3', status: ShipmentStatus.CANCELLED }),
      ]);

      const result = await service.getSummary(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-30' });

      expect(result.statusBreakdown[0]).toEqual({ status: ShipmentStatus.COMPLETED, count: 2 });
      expect(result.statusBreakdown[1]).toEqual({ status: ShipmentStatus.CANCELLED, count: 1 });
    });
  });

  describe('topDestinations', () => {
    it('groups by the first segment of the dropoff address, top 5', async () => {
      repo.find.mockResolvedValue([
        shipment({ id: 's1', dropoffLocation: { latitude: 0, longitude: 0, address: 'CBD, Dar es Salaam' } }),
        shipment({ id: 's2', dropoffLocation: { latitude: 0, longitude: 0, address: 'CBD, Dar es Salaam' } }),
        shipment({ id: 's3', dropoffLocation: { latitude: 0, longitude: 0, address: 'Masaki, Dar es Salaam' } }),
      ]);

      const result = await service.getSummary(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-30' });

      expect(result.topDestinations[0]).toEqual({ area: 'CBD', count: 2 });
      expect(result.topDestinations[1]).toEqual({ area: 'Masaki', count: 1 });
    });
  });
});
