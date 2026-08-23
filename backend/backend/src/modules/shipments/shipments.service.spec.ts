import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { RateRiderDto } from './dto/rate-rider.dto';
import { ProofOfDelivery } from '../../database/entities/proof-of-delivery.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { Rider, RiderStatus } from '../../database/entities/rider.entity';
import { ShipmentStatusHistory } from '../../database/entities/shipment-status-history.entity';
import { Role } from '../../database/entities/user-role.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { PricingService } from '../pricing/pricing.service';

// Minimal fake of the slice of Repository<T> this service actually calls.
// Deliberately not a full mock of TypeORM's Repository — just what's used.
function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'shipment-1', ...x })),
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
  };
}

const CUSTOMER_ID = 'a5f3c111-0000-4000-8000-000000000001';
const RIDER_USER_ID = 'b5f3c111-0000-4000-8000-000000000002';
const OTHER_USER_ID = 'c5f3c111-0000-4000-8000-000000000003';

function requester(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: CUSTOMER_ID, phone: '+255700000000', roles: [Role.CUSTOMER], ...overrides };
}

describe('ShipmentsService', () => {
  let service: ShipmentsService;
  let shipmentsRepo: ReturnType<typeof mockRepo>;
  let ridersRepo: ReturnType<typeof mockRepo>;
  let historyRepo: ReturnType<typeof mockRepo>;
  let proofRepo: ReturnType<typeof mockRepo>;
  let pricingService: { calculatePrice: jest.Mock };

  const DEFAULT_QUOTE = {
    pricingConfigId: 'config-1',
    basePrice: '5000.00',
    distanceCharge: '0.00',
    weightCharge: '0.00',
    subtotal: '5000.00',
    surgeMultiplier: '1.00',
    surgeAmount: '0.00',
    price: '5000.00',
    commission: '1000.00',
    riderPayout: '4000.00',
  };

  beforeEach(async () => {
    shipmentsRepo = mockRepo();
    ridersRepo = mockRepo();
    historyRepo = mockRepo();
    proofRepo = mockRepo();
    pricingService = { calculatePrice: jest.fn(async () => DEFAULT_QUOTE) };

    // Fake DataSource: transaction() just invokes the callback with a
    // manager whose getRepository(Entity) routes back to the same repo
    // mocks above, so create()'s manager-scoped writes inside the
    // transaction are visible to the same shipmentsRepo/historyRepo
    // assertions the tests already make. Mirrors the pattern in
    // payments.service.spec.ts.
    const repoByEntity = new Map<unknown, ReturnType<typeof mockRepo>>([
      [Shipment, shipmentsRepo],
      [ShipmentStatusHistory, historyRepo],
    ]);
    const dataSource = {
      transaction: jest.fn(async (cb: (manager: { getRepository: jest.Mock }) => Promise<unknown>) =>
        cb({
          getRepository: jest.fn((entity: unknown) => {
            const repo = repoByEntity.get(entity);
            if (!repo) {
              throw new Error(`No mock repo registered for entity in test DataSource`);
            }
            return repo;
          }),
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentsService,
        { provide: getRepositoryToken(Shipment), useValue: shipmentsRepo },
        { provide: getRepositoryToken(Rider), useValue: ridersRepo },
        { provide: getRepositoryToken(ShipmentStatusHistory), useValue: historyRepo },
        { provide: getRepositoryToken(ProofOfDelivery), useValue: proofRepo },
        { provide: PricingService, useValue: pricingService },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get(ShipmentsService);
  });

  describe('create', () => {
    const dto: CreateShipmentDto = {
      pickupLocation: { latitude: -6.8, longitude: 39.28, address: 'A' },
      dropoffLocation: { latitude: -6.79, longitude: 39.2, address: 'B' },
      packageWeightKg: 2,
    };

    it('creates the shipment under the calling customer, priced and QUOTED', async () => {
      await service.create(dto, CUSTOMER_ID);

      expect(shipmentsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ShipmentStatus.QUOTED,
          customerId: CUSTOMER_ID,
          price: DEFAULT_QUOTE.price,
          commission: DEFAULT_QUOTE.commission,
          riderPayout: DEFAULT_QUOTE.riderPayout,
        }),
      );
    });

    it('quotes using the haversine distance between pickup and dropoff, and the given weight', async () => {
      await service.create(dto, CUSTOMER_ID);

      expect(pricingService.calculatePrice).toHaveBeenCalledWith(
        expect.objectContaining({ weightKg: 2 }),
      );
      const [call] = pricingService.calculatePrice.mock.calls[0];
      expect(call.distanceKm).toBeGreaterThan(0);
    });

    it('writes a CREATED row followed by a QUOTED row to the status history', async () => {
      await service.create(dto, CUSTOMER_ID);

      expect(historyRepo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          status: ShipmentStatus.CREATED,
          changedBy: CUSTOMER_ID,
          reason: null,
        }),
      );
      expect(historyRepo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          status: ShipmentStatus.QUOTED,
          changedBy: CUSTOMER_ID,
        }),
      );
      expect(historyRepo.save).toHaveBeenCalledTimes(2);
    });

    it('propagates a pricing failure without inserting the shipment', async () => {
      pricingService.calculatePrice.mockRejectedValue(
        new NotFoundException('No active pricing configuration for this time'),
      );

      await expect(service.create(dto, CUSTOMER_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(shipmentsRepo.save).not.toHaveBeenCalled();
      expect(historyRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findOne / access control', () => {
    it('throws NotFoundException when the shipment does not exist', async () => {

      shipmentsRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing-id', requester())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lets the owning customer read their own shipment', async () => {
      const shipment = { id: 'shipment-1', customerId: CUSTOMER_ID, riderId: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);

      await expect(service.findOne('shipment-1', requester())).resolves.toEqual(shipment);
    });

    it('rejects a customer who does not own the shipment', async () => {
      const shipment = { id: 'shipment-1', customerId: OTHER_USER_ID, riderId: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);

      await expect(service.findOne('shipment-1', requester())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets an admin read any shipment', async () => {
      const shipment = { id: 'shipment-1', customerId: OTHER_USER_ID, riderId: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);

      await expect(
        service.findOne('shipment-1', requester({ sub: 'admin-1', roles: [Role.ADMIN] })),
      ).resolves.toEqual(shipment);
    });

    it('lets the assigned rider read the shipment', async () => {
      const shipment = { id: 'shipment-1', customerId: OTHER_USER_ID, riderId: 'rider-1' };
      shipmentsRepo.findOne.mockResolvedValue(shipment);
      ridersRepo.findOne.mockResolvedValue({ id: 'rider-1', userId: RIDER_USER_ID });

      await expect(
        service.findOne('shipment-1', requester({ sub: RIDER_USER_ID, roles: [Role.RIDER] })),
      ).resolves.toEqual(shipment);
    });
  });

  describe('updateStatus', () => {
    it('rejects ASSIGNED — must go through assign() instead', async () => {
      await expect(
        service.updateStatus('shipment-1', ShipmentStatus.ASSIGNED, requester()),
      ).rejects.toThrow(ConflictException);

      expect(shipmentsRepo.findOne).not.toHaveBeenCalled();
    });

    it('rejects a transition that skips a step', async () => {
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        customerId: CUSTOMER_ID,
        status: ShipmentStatus.CREATED,
      });

      await expect(
        service.updateStatus('shipment-1', ShipmentStatus.CONFIRMED, requester()),
      ).rejects.toThrow(ConflictException);

      expect(historyRepo.save).not.toHaveBeenCalled();
    });

    it('applies a valid transition, stamps the timestamp, and records history with the reason', async () => {
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        customerId: CUSTOMER_ID,
        status: ShipmentStatus.CREATED,
      });

      const result = await service.updateStatus(
        'shipment-1',
        ShipmentStatus.QUOTED,
        requester(),
        'auto-quoted',
      );

      expect(result.status).toBe(ShipmentStatus.QUOTED);
      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ShipmentStatus.QUOTED,
          changedBy: CUSTOMER_ID,
          reason: 'auto-quoted',
        }),
      );
    });

    it('rejects DELIVERED — must go through submitProofOfDelivery() instead', async () => {
      await expect(
        service.updateStatus('shipment-1', ShipmentStatus.DELIVERED, requester()),
      ).rejects.toThrow(ConflictException);

      expect(shipmentsRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('confirmAfterPayment', () => {
    it('moves a QUOTED shipment to CONFIRMED and records history with no user attribution', async () => {
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        customerId: CUSTOMER_ID,
        status: ShipmentStatus.QUOTED,
      });

      await service.confirmAfterPayment('shipment-1');

      expect(shipmentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ShipmentStatus.CONFIRMED }),
      );
      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ShipmentStatus.CONFIRMED,
          changedBy: null,
          reason: 'Payment completed',
        }),
      );
    });

    it('is a no-op for a shipment that is not QUOTED (e.g. already CONFIRMED or cancelled)', async () => {
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        customerId: CUSTOMER_ID,
        status: ShipmentStatus.CANCELLED,
      });

      await service.confirmAfterPayment('shipment-1');

      expect(shipmentsRepo.save).not.toHaveBeenCalled();
      expect(historyRepo.save).not.toHaveBeenCalled();
    });

    it('is a no-op for an unknown shipment id, without throwing', async () => {
      shipmentsRepo.findOne.mockResolvedValue(undefined);

      await expect(service.confirmAfterPayment('missing-shipment')).resolves.toBeUndefined();
      expect(shipmentsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('isAssignedRiderOrAdmin', () => {
    it('returns true for an admin regardless of shipment state', async () => {
      const result = await service.isAssignedRiderOrAdmin(
        'shipment-1',
        requester({ sub: OTHER_USER_ID, roles: [Role.ADMIN] }),
      );

      expect(result).toBe(true);
      expect(shipmentsRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns false for a non-rider, non-admin caller', async () => {
      const result = await service.isAssignedRiderOrAdmin(
        'shipment-1',
        requester({ roles: [Role.CUSTOMER] }),
      );

      expect(result).toBe(false);
    });

    it('returns true for the rider actually assigned to the shipment', async () => {
      shipmentsRepo.findOne.mockResolvedValue({ id: 'shipment-1', riderId: 'rider-1' });
      ridersRepo.findOne.mockResolvedValue({ id: 'rider-1', userId: RIDER_USER_ID });

      const result = await service.isAssignedRiderOrAdmin(
        'shipment-1',
        requester({ sub: RIDER_USER_ID, roles: [Role.RIDER] }),
      );

      expect(result).toBe(true);
    });

    it('returns false for a rider who is not the one assigned', async () => {
      shipmentsRepo.findOne.mockResolvedValue({ id: 'shipment-1', riderId: 'rider-1' });
      ridersRepo.findOne.mockResolvedValue({ id: 'rider-2', userId: OTHER_USER_ID });

      const result = await service.isAssignedRiderOrAdmin(
        'shipment-1',
        requester({ sub: OTHER_USER_ID, roles: [Role.RIDER] }),
      );

      expect(result).toBe(false);
    });

    it('returns false when the shipment has no rider assigned yet', async () => {
      shipmentsRepo.findOne.mockResolvedValue({ id: 'shipment-1', riderId: null });

      const result = await service.isAssignedRiderOrAdmin(
        'shipment-1',
        requester({ sub: RIDER_USER_ID, roles: [Role.RIDER] }),
      );

      expect(result).toBe(false);
    });
  });

  describe('assign', () => {
    it('rejects when the caller has no rider profile', async () => {
      ridersRepo.findOne.mockResolvedValue(null);

      await expect(service.assign('shipment-1', RIDER_USER_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(shipmentsRepo.update).not.toHaveBeenCalled();
    });

    it('rejects a rider who is not ACTIVE and online', async () => {
      ridersRepo.findOne.mockResolvedValue({
        id: 'rider-1',
        userId: RIDER_USER_ID,
        status: RiderStatus.ONBOARDING,
        isOnline: false,
      });

      await expect(service.assign('shipment-1', RIDER_USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(shipmentsRepo.update).not.toHaveBeenCalled();
    });

    it('claims the shipment and records history when the conditional update wins', async () => {
      ridersRepo.findOne.mockResolvedValue({
        id: 'rider-1',
        userId: RIDER_USER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: true,
      });
      shipmentsRepo.update.mockResolvedValue({ affected: 1 });
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.ASSIGNED,
        riderId: 'rider-1',
      });

      const result = await service.assign('shipment-1', RIDER_USER_ID);

      expect(result.riderId).toBe('rider-1');
      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ShipmentStatus.ASSIGNED,
          changedBy: RIDER_USER_ID,
          reason: null,
        }),
      );
    });

    it('loses the race cleanly when another rider claimed it first (affected === 0)', async () => {
      ridersRepo.findOne.mockResolvedValue({
        id: 'rider-1',
        userId: RIDER_USER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: true,
      });
      shipmentsRepo.update.mockResolvedValue({ affected: 0 });
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.ASSIGNED,
        riderId: 'some-other-rider',
      });

      await expect(service.assign('shipment-1', RIDER_USER_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(historyRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('submitProofOfDelivery', () => {
    const dto = { recipientName: 'Asha M.' };

    it('rejects when the caller has no rider profile', async () => {
      ridersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submitProofOfDelivery('shipment-1', RIDER_USER_ID, dto),
      ).rejects.toThrow(NotFoundException);
      expect(shipmentsRepo.update).not.toHaveBeenCalled();
    });

    it('confirms delivery, saves the proof, and records history when the conditional update wins', async () => {
      ridersRepo.findOne.mockResolvedValue({ id: 'rider-1', userId: RIDER_USER_ID });
      shipmentsRepo.update.mockResolvedValue({ affected: 1 });
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.DELIVERED,
        riderId: 'rider-1',
      });

      const result = await service.submitProofOfDelivery('shipment-1', RIDER_USER_ID, dto);

      expect(shipmentsRepo.update).toHaveBeenCalledWith(
        { id: 'shipment-1', status: ShipmentStatus.OUT_FOR_DELIVERY, riderId: 'rider-1' },
        expect.objectContaining({ status: ShipmentStatus.DELIVERED }),
      );
      expect(proofRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shipmentId: 'shipment-1',
          recipientName: 'Asha M.',
          deliveredBy: RIDER_USER_ID,
        }),
      );
      expect(proofRepo.save).toHaveBeenCalled();
      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ShipmentStatus.DELIVERED,
          changedBy: RIDER_USER_ID,
          reason: 'Delivered to Asha M.',
        }),
      );
      expect(result.status).toBe(ShipmentStatus.DELIVERED);
    });

    it('rejects with 403 when the shipment is assigned to a different rider', async () => {
      ridersRepo.findOne.mockResolvedValue({ id: 'rider-1', userId: RIDER_USER_ID });
      shipmentsRepo.update.mockResolvedValue({ affected: 0 });
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.OUT_FOR_DELIVERY,
        riderId: 'some-other-rider',
      });

      await expect(
        service.submitProofOfDelivery('shipment-1', RIDER_USER_ID, dto),
      ).rejects.toThrow(ForbiddenException);
      expect(proofRepo.save).not.toHaveBeenCalled();
    });

    it('rejects with 409 when the shipment is not OUT_FOR_DELIVERY', async () => {
      ridersRepo.findOne.mockResolvedValue({ id: 'rider-1', userId: RIDER_USER_ID });
      shipmentsRepo.update.mockResolvedValue({ affected: 0 });
      shipmentsRepo.findOne.mockResolvedValue({
        id: 'shipment-1',
        status: ShipmentStatus.IN_TRANSIT,
        riderId: 'rider-1',
      });

      await expect(
        service.submitProofOfDelivery('shipment-1', RIDER_USER_ID, dto),
      ).rejects.toThrow(ConflictException);
      expect(proofRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getProofOfDelivery', () => {
    it('enforces the same access rule as findOne', async () => {
      const shipment = { id: 'shipment-1', customerId: OTHER_USER_ID, riderId: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);

      await expect(
        service.getProofOfDelivery('shipment-1', requester()),
      ).rejects.toThrow(ForbiddenException);
      expect(proofRepo.findOne).not.toHaveBeenCalled();
    });

    it('404s when no proof has been submitted yet', async () => {
      const shipment = { id: 'shipment-1', customerId: CUSTOMER_ID, riderId: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);
      proofRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getProofOfDelivery('shipment-1', requester()),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the proof for the owning customer', async () => {
      const shipment = { id: 'shipment-1', customerId: CUSTOMER_ID, riderId: null };
      const proof = { shipmentId: 'shipment-1', recipientName: 'Asha M.' };
      shipmentsRepo.findOne.mockResolvedValue(shipment);
      proofRepo.findOne.mockResolvedValue(proof);

      await expect(
        service.getProofOfDelivery('shipment-1', requester()),
      ).resolves.toEqual(proof);
    });
  });

  describe('getStatusHistory', () => {
    it('enforces the same access rule as findOne', async () => {
      const shipment = { id: 'shipment-1', customerId: OTHER_USER_ID, riderId: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);

      await expect(service.getStatusHistory('shipment-1', requester())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns history rows oldest-first for the owning customer', async () => {
      const shipment = { id: 'shipment-1', customerId: CUSTOMER_ID, riderId: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);
      const rows = [{ status: ShipmentStatus.CREATED }, { status: ShipmentStatus.QUOTED }];
      historyRepo.find.mockResolvedValue(rows);

      const result = await service.getStatusHistory('shipment-1', requester());

      expect(historyRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shipmentId: 'shipment-1' },
          order: { changedAt: 'ASC' },
        }),
      );
      expect(result).toEqual(rows);
    });
  });

  describe('rateRider', () => {
    const RIDER_ID = 'rider-1';

    it('rejects a caller who is not the owning customer', async () => {
      const shipment = { id: 'shipment-1', customerId: CUSTOMER_ID, riderId: RIDER_ID, status: ShipmentStatus.DELIVERED, riderRating: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);

      await expect(
        service.rateRider('shipment-1', { rating: 5 } satisfies RateRiderDto, requester({ sub: OTHER_USER_ID })),
      ).rejects.toThrow(ForbiddenException);
      expect(shipmentsRepo.save).not.toHaveBeenCalled();
    });

    it('rejects rating before the shipment is delivered', async () => {
      const shipment = { id: 'shipment-1', customerId: CUSTOMER_ID, riderId: RIDER_ID, status: ShipmentStatus.IN_TRANSIT, riderRating: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);

      await expect(
        service.rateRider('shipment-1', { rating: 5 } satisfies RateRiderDto, requester()),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects rating a shipment with no assigned rider', async () => {
      const shipment = { id: 'shipment-1', customerId: CUSTOMER_ID, riderId: null, status: ShipmentStatus.DELIVERED, riderRating: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);

      await expect(
        service.rateRider('shipment-1', { rating: 5 } satisfies RateRiderDto, requester()),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects rating the same shipment twice', async () => {
      const shipment = { id: 'shipment-1', customerId: CUSTOMER_ID, riderId: RIDER_ID, status: ShipmentStatus.DELIVERED, riderRating: 4 };
      shipmentsRepo.findOne.mockResolvedValue(shipment);

      await expect(
        service.rateRider('shipment-1', { rating: 5 } satisfies RateRiderDto, requester()),
      ).rejects.toThrow(ConflictException);
    });

    it('saves the rating and updates the rider rolling average from zero', async () => {
      const shipment = { id: 'shipment-1', customerId: CUSTOMER_ID, riderId: RIDER_ID, status: ShipmentStatus.DELIVERED, riderRating: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);
      ridersRepo.findOne.mockResolvedValue({ id: RIDER_ID, ratingAvg: null, ratingCount: 0 });

      const result = await service.rateRider('shipment-1', { rating: 5 } satisfies RateRiderDto, requester());

      expect(result.riderRating).toBe(5);
      expect(shipmentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ riderRating: 5 }),
      );
      expect(ridersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ ratingCount: 1, ratingAvg: '5.00' }),
      );
    });

    it('folds a new rating into an existing rider average', async () => {
      const shipment = { id: 'shipment-1', customerId: CUSTOMER_ID, riderId: RIDER_ID, status: ShipmentStatus.COMPLETED, riderRating: null };
      shipmentsRepo.findOne.mockResolvedValue(shipment);
      ridersRepo.findOne.mockResolvedValue({ id: RIDER_ID, ratingAvg: '4.00', ratingCount: 3 });

      await service.rateRider('shipment-1', { rating: 5 } satisfies RateRiderDto, requester());

      // (4*3 + 5) / 4 = 4.25
      expect(ridersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ ratingCount: 4, ratingAvg: '4.25' }),
      );
    });
  });
});
