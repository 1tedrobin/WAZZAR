import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Rider, RiderStatus } from '../../database/entities/rider.entity';
import { RiderLocation } from '../../database/entities/rider-location.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { Role } from '../../database/entities/user-role.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { TrackingGateway } from './tracking.gateway';
import { TrackingService } from './tracking.service';

// Minimal fake of the slice of Repository<T> this service actually calls
// — same pattern as shipments.service.spec.ts.
function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ riderId: 'rider-1', ...x })),
    findOne: jest.fn(),
    find: jest.fn(async () => []),
  };
}

const CUSTOMER_ID = 'a5f3c111-0000-4000-8000-000000000001';
const RIDER_USER_ID = 'b5f3c111-0000-4000-8000-000000000002';
const RIDER_ID = 'd5f3c111-0000-4000-8000-000000000004';

function requester(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: CUSTOMER_ID, phone: '+255700000000', roles: [Role.CUSTOMER], ...overrides };
}

describe('TrackingService', () => {
  let service: TrackingService;
  let locationsRepo: ReturnType<typeof mockRepo>;
  let ridersRepo: ReturnType<typeof mockRepo>;
  let shipmentsRepo: ReturnType<typeof mockRepo>;
  let gateway: { broadcastToShipment: jest.Mock };

  beforeEach(async () => {
    locationsRepo = mockRepo();
    ridersRepo = mockRepo();
    shipmentsRepo = mockRepo();
    gateway = { broadcastToShipment: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: getRepositoryToken(RiderLocation), useValue: locationsRepo },
        { provide: getRepositoryToken(Rider), useValue: ridersRepo },
        { provide: getRepositoryToken(Shipment), useValue: shipmentsRepo },
        { provide: TrackingGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get(TrackingService);
  });

  describe('updateLocation', () => {
    const dto = { latitude: -6.792, longitude: 39.208, accuracyMeters: 15 };

    it('throws NotFoundException with no rider profile for the account', async () => {
      ridersRepo.findOne.mockResolvedValue(null);

      await expect(service.updateLocation(RIDER_USER_ID, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the rider is offline', async () => {
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        userId: RIDER_USER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: false,
      });

      await expect(service.updateLocation(RIDER_USER_ID, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('creates a new location row when the rider has none yet', async () => {
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        userId: RIDER_USER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: true,
      });
      locationsRepo.findOne.mockResolvedValue(null);

      await service.updateLocation(RIDER_USER_ID, dto);

      // Note: mockRepo's create() returns the same object it's given, and
      // the service mutates that object in place afterwards — so the
      // recorded call args reflect the final, mutated state, not a bare
      // { riderId } shape.
      expect(locationsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ riderId: RIDER_ID }),
      );
      expect(locationsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          riderId: RIDER_ID,
          latitude: dto.latitude.toString(),
          longitude: dto.longitude.toString(),
          accuracyMeters: dto.accuracyMeters,
        }),
      );
    });

    it('updates the existing row in place when the rider already has one', async () => {
      const existing = { riderId: RIDER_ID, latitude: '0', longitude: '0', accuracyMeters: null };
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        userId: RIDER_USER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: true,
      });
      locationsRepo.findOne.mockResolvedValue(existing);

      await service.updateLocation(RIDER_USER_ID, dto);

      expect(locationsRepo.create).not.toHaveBeenCalled();
      expect(locationsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: dto.latitude.toString() }),
      );
    });

    it('broadcasts to every shipment currently assigned to the rider and being tracked', async () => {
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        userId: RIDER_USER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: true,
      });
      locationsRepo.findOne.mockResolvedValue(null);
      // Deliberately partial Shipment mocks (only the fields
      // updateLocation/broadcastToShipment actually read); typing this as
      // Shipment[] would mean filling in a dozen unrelated columns with
      // no test value.
      shipmentsRepo.find.mockResolvedValue([
        {
          id: 'shipment-1',
          riderId: RIDER_ID,
          status: ShipmentStatus.IN_TRANSIT,
          pickupLocation: {},
          dropoffLocation: {},
        },
        {
          id: 'shipment-2',
          riderId: RIDER_ID,
          status: ShipmentStatus.ASSIGNED,
          pickupLocation: {},
          dropoffLocation: {},
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);

      await service.updateLocation(RIDER_USER_ID, dto);

      expect(gateway.broadcastToShipment).toHaveBeenCalledTimes(2);
      expect(gateway.broadcastToShipment).toHaveBeenCalledWith(
        'shipment-1',
        expect.objectContaining({ shipmentId: 'shipment-1' }),
      );
      expect(gateway.broadcastToShipment).toHaveBeenCalledWith(
        'shipment-2',
        expect.objectContaining({ shipmentId: 'shipment-2' }),
      );
    });

    it('does not broadcast when the rider has no actively-tracked shipments', async () => {
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        userId: RIDER_USER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: true,
      });
      locationsRepo.findOne.mockResolvedValue(null);
      shipmentsRepo.find.mockResolvedValue([]);

      await service.updateLocation(RIDER_USER_ID, dto);

      expect(gateway.broadcastToShipment).not.toHaveBeenCalled();
    });
  });

  describe('getShipmentTracking', () => {
    const shipment = {
      id: 'shipment-1',
      customerId: CUSTOMER_ID,
      riderId: RIDER_ID,
      status: ShipmentStatus.IN_TRANSIT,
      pickupLocation: { latitude: -6.8, longitude: 39.2, address: 'A' },
      dropoffLocation: { latitude: -6.79, longitude: 39.21, address: 'B' },
    };

    it('throws NotFoundException for an unknown shipment', async () => {
      shipmentsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getShipmentTracking('missing-id', requester()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for a caller with no access', async () => {
      shipmentsRepo.findOne.mockResolvedValue(shipment);
      ridersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getShipmentTracking('shipment-1', requester({ sub: 'someone-else' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns a snapshot with riderLocation null when no location has been reported', async () => {
      shipmentsRepo.findOne.mockResolvedValue(shipment);
      locationsRepo.findOne.mockResolvedValue(null);

      const result = await service.getShipmentTracking('shipment-1', requester());

      expect(result.riderLocation).toBeNull();
      expect(result.etaSeconds).toBeNull();
      expect(result.status).toBe(ShipmentStatus.IN_TRANSIT);
    });

    it('returns a snapshot with rider location and a computed ETA when a location exists', async () => {
      shipmentsRepo.findOne.mockResolvedValue(shipment);
      locationsRepo.findOne.mockResolvedValue({
        riderId: RIDER_ID,
        latitude: '-6.795',
        longitude: '39.205',
        accuracyMeters: 10,
        updatedAt: new Date('2026-08-19T12:00:00Z'),
      });

      const result = await service.getShipmentTracking('shipment-1', requester());

      expect(result.riderLocation).toEqual({
        latitude: -6.795,
        longitude: 39.205,
        accuracyMeters: 10,
      });
      expect(typeof result.etaSeconds).toBe('number');
      expect(result.lastUpdated).toEqual(new Date('2026-08-19T12:00:00Z'));
    });
  });
});
