import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { RiderLocation } from '../../database/entities/rider-location.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { Rider, RiderStatus } from '../../database/entities/rider.entity';
import { ShipmentStatusHistory } from '../../database/entities/shipment-status-history.entity';

/**
 * Piece 6 (Dispatcher/Admin Override Refinement) — Phase 2 Prep
 *
 * These tests validate dispatch service logic: assignment, ranking, queue queries.
 * Authorization (ADMIN/SUPER_ADMIN/DISPATCHER roles) is gated in dispatch.controller.ts
 * via the @Roles guard; this spec focuses on the service layer behavior.
 *
 * DISPATCHER role (added in this piece) enables dedicated dispatch operators to
 * manage shipment assignments without full admin privileges. The dispatch service
 * doesn't distinguish which role is calling — it only records who initiated the action
 * (via changedBy) in the shipment history audit trail.
 */

// Same minimal-fake-repo approach as shipments.service.spec.ts — only the
// Repository<T> methods this service actually calls.
function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
  };
}

const DISPATCHER_ID = 'd5f3c111-0000-4000-8000-000000000009';
const RIDER_ID = 'e5f3c111-0000-4000-8000-000000000010';

function makeRider(overrides: Partial<Rider> = {}): Rider {
  return {
    id: RIDER_ID,
    userId: 'user-1',
    status: RiderStatus.ACTIVE,
    isOnline: true,
    ratingAvg: null,
    ratingCount: 0,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  } as Rider;
}

// Dar es Salaam-ish coordinates, close enough together that the
// distances involved are meaningfully different but still plausible for
// one city.
const PICKUP = { latitude: -6.792, longitude: 39.208, address: 'Pickup point' };

function makeLocation(overrides: Partial<RiderLocation> = {}): RiderLocation {
  return {
    riderId: RIDER_ID,
    latitude: '-6.792',
    longitude: '39.208',
    accuracyMeters: null,
    updatedAt: new Date(),
    ...overrides,
  } as RiderLocation;
}

describe('DispatchService', () => {
  let service: DispatchService;
  let shipmentsRepo: ReturnType<typeof mockRepo>;
  let ridersRepo: ReturnType<typeof mockRepo>;
  let historyRepo: ReturnType<typeof mockRepo>;
  let locationsRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    shipmentsRepo = mockRepo();
    ridersRepo = mockRepo();
    historyRepo = mockRepo();
    locationsRepo = mockRepo();
    // Default: nobody has pinged. Individual tests override this to
    // exercise the distance-based path.
    locationsRepo.find.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: getRepositoryToken(Shipment), useValue: shipmentsRepo },
        { provide: getRepositoryToken(Rider), useValue: ridersRepo },
        { provide: getRepositoryToken(ShipmentStatusHistory), useValue: historyRepo },
        { provide: getRepositoryToken(RiderLocation), useValue: locationsRepo },
      ],
    }).compile();

    service = module.get(DispatchService);
  });

  describe('getQueue', () => {
    it('returns pending shipments and online riders in parallel', async () => {
      shipmentsRepo.find.mockResolvedValue([{ id: 'shipment-1' }]);
      ridersRepo.find.mockResolvedValue([makeRider()]);

      const result = await service.getQueue();

      expect(shipmentsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: ShipmentStatus.ASSIGNMENT_PENDING },
          order: { createdAt: 'ASC' },
        }),
      );
      expect(ridersRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: RiderStatus.ACTIVE, isOnline: true } }),
      );
      expect(result.pendingShipments).toHaveLength(1);
      expect(result.onlineRiders).toHaveLength(1);
    });
  });

  describe('getCandidates', () => {
    it('throws NotFoundException when the shipment does not exist', async () => {
      shipmentsRepo.findOne.mockResolvedValue(null);

      await expect(service.getCandidates('missing')).rejects.toThrow(NotFoundException);
    });

    it('rejects a shipment that is not ASSIGNMENT_PENDING', async () => {
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.CREATED,
      });

      await expect(service.getCandidates('shipment-1')).rejects.toThrow(ConflictException);
      expect(ridersRepo.find).not.toHaveBeenCalled();
    });

    it('falls back to rating desc, then rating count, then seniority when no rider has a recent ping', async () => {
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.ASSIGNMENT_PENDING,
        pickupLocation: PICKUP,
      });
      locationsRepo.find.mockResolvedValue([]);

      const unrated = makeRider({ id: 'r1', ratingAvg: null, createdAt: new Date('2026-01-01') });
      const lowRated = makeRider({ id: 'r2', ratingAvg: '3.50', ratingCount: 10 });
      const highRatedNewer = makeRider({
        id: 'r3',
        ratingAvg: '4.90',
        ratingCount: 5,
        createdAt: new Date('2026-02-01'),
      });
      const highRatedOlder = makeRider({
        id: 'r4',
        ratingAvg: '4.90',
        ratingCount: 5,
        createdAt: new Date('2025-06-01'),
      });
      ridersRepo.find.mockResolvedValue([unrated, lowRated, highRatedNewer, highRatedOlder]);

      const result = await service.getCandidates('shipment-1');

      expect(result.map((r) => r.id)).toEqual(['r4', 'r3', 'r2', 'r1']);
    });

    it('ranks riders with a recent ping nearest-pickup-first, ahead of any unlocated rider', async () => {
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.ASSIGNMENT_PENDING,
        pickupLocation: PICKUP,
      });

      // far has a lower distance-independent "quality" (worse rating) than
      // unlocated, but should still rank first purely on being closer.
      const near = makeRider({ id: 'near', ratingAvg: '3.00', ratingCount: 1 });
      const far = makeRider({ id: 'far', ratingAvg: '3.00', ratingCount: 1 });
      const unlocated = makeRider({ id: 'unlocated', ratingAvg: '5.00', ratingCount: 100 });
      ridersRepo.find.mockResolvedValue([far, unlocated, near]);

      locationsRepo.find.mockResolvedValue([
        makeLocation({ riderId: 'near', latitude: '-6.7925', longitude: '39.2085' }), // ~100m away
        makeLocation({ riderId: 'far', latitude: '-6.85', longitude: '39.28' }), // several km away
        // 'unlocated' deliberately has no row at all.
      ]);

      const result = await service.getCandidates('shipment-1');

      expect(result.map((r) => r.id)).toEqual(['near', 'far', 'unlocated']);
    });

    it('treats a stale ping as unlocated and falls back to the rating heuristic for it', async () => {
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.ASSIGNMENT_PENDING,
        pickupLocation: PICKUP,
      });

      const stale = makeRider({ id: 'stale', ratingAvg: '3.00', ratingCount: 1 });
      const fresh = makeRider({ id: 'fresh', ratingAvg: '3.00', ratingCount: 1 });
      ridersRepo.find.mockResolvedValue([stale, fresh]);

      locationsRepo.find.mockResolvedValue([
        // Right on top of the pickup point, but pinged 10 minutes ago —
        // past the 5-minute recency threshold, so this should NOT win on
        // distance despite being (on paper) the closest possible rider.
        makeLocation({
          riderId: 'stale',
          latitude: PICKUP.latitude.toString(),
          longitude: PICKUP.longitude.toString(),
          updatedAt: new Date(Date.now() - 10 * 60 * 1000),
        }),
        makeLocation({
          riderId: 'fresh',
          latitude: '-6.85',
          longitude: '39.28',
          updatedAt: new Date(),
        }),
      ]);

      const result = await service.getCandidates('shipment-1');

      expect(result.map((r) => r.id)).toEqual(['fresh', 'stale']);
    });
  });

  describe('assign (manual dispatcher override)', () => {
    it('throws NotFoundException when the rider does not exist', async () => {
      ridersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assign('shipment-1', RIDER_ID, DISPATCHER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(shipmentsRepo.update).not.toHaveBeenCalled();
    });

    it('rejects a rider who is not ACTIVE and online', async () => {
      ridersRepo.findOne.mockResolvedValue(
        makeRider({ status: RiderStatus.ONBOARDING, isOnline: false }),
      );

      await expect(
        service.assign('shipment-1', RIDER_ID, DISPATCHER_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(shipmentsRepo.update).not.toHaveBeenCalled();
    });

    it('assigns the shipment and records history attributed to the dispatcher', async () => {
      ridersRepo.findOne.mockResolvedValue(makeRider());
      shipmentsRepo.update.mockResolvedValue({ affected: 1 });
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.ASSIGNED,
        riderId: RIDER_ID,
      });

      const result = await service.assign('shipment-1', RIDER_ID, DISPATCHER_ID);

      expect(shipmentsRepo.update).toHaveBeenCalledWith(
        { id: 'shipment-1', status: ShipmentStatus.ASSIGNMENT_PENDING, riderId: expect.anything() },
        expect.objectContaining({ status: ShipmentStatus.ASSIGNED, riderId: RIDER_ID }),
      );
      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ShipmentStatus.ASSIGNED,
          changedBy: DISPATCHER_ID,
          reason: expect.stringContaining(RIDER_ID),
        }),
      );
      expect(result.riderId).toBe(RIDER_ID);
    });

    it('surfaces a clean conflict when the shipment was already claimed (lost race)', async () => {
      ridersRepo.findOne.mockResolvedValue(makeRider());
      shipmentsRepo.update.mockResolvedValue({ affected: 0 });
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.ASSIGNED,
        riderId: 'someone-else',
      });

      await expect(
        service.assign('shipment-1', RIDER_ID, DISPATCHER_ID),
      ).rejects.toThrow(ConflictException);
      expect(historyRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('autoAssign', () => {
    it('rejects when there are no online, active candidates', async () => {
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.ASSIGNMENT_PENDING,
      });
      ridersRepo.find.mockResolvedValue([]);

      await expect(service.autoAssign('shipment-1', DISPATCHER_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(shipmentsRepo.update).not.toHaveBeenCalled();
    });

    it('assigns the top-ranked candidate', async () => {
      shipmentsRepo.findOne.mockResolvedValueOnce({
        id: 'shipment-1',
        status: ShipmentStatus.ASSIGNMENT_PENDING,
      });
      const best = makeRider({ id: 'best-rider', ratingAvg: '5.00', ratingCount: 20 });
      const worse = makeRider({ id: 'worse-rider', ratingAvg: '3.00', ratingCount: 2 });
      ridersRepo.find.mockResolvedValue([worse, best]);
      shipmentsRepo.update.mockResolvedValue({ affected: 1 });
      shipmentsRepo.findOne.mockResolvedValueOnce({
        id: 'shipment-1',
        status: ShipmentStatus.ASSIGNED,
        riderId: 'best-rider',
      });

      const result = await service.autoAssign('shipment-1', DISPATCHER_ID);

      expect(shipmentsRepo.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ riderId: 'best-rider' }),
      );
      expect(result.riderId).toBe('best-rider');
    });
  });
});
