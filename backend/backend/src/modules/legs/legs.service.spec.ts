import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { LegsService } from './legs.service';
import { Leg, LegStatus, LegType } from '../../database/entities/leg.entity';
import { Shipment, ShipmentStatus, ShipmentType } from '../../database/entities/shipment.entity';
import { ShipmentStatusHistory } from '../../database/entities/shipment-status-history.entity';
import { TrackingEvent } from '../../database/entities/tracking-event.entity';
import { Rider, RiderStatus } from '../../database/entities/rider.entity';
import { Role } from '../../database/entities/user-role.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { HubsService } from '../hubs/hubs.service';
import { CarriersService } from '../carriers/carriers.service';
import { PricingService } from '../pricing/pricing.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { CarrierStatus } from '../../database/entities/carrier.entity';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => (Array.isArray(x) ? x : { id: x.id ?? 'row-1', ...x })),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
}

const CUSTOMER_ID = 'a5f3c111-0000-4000-8000-000000000001';
const DISPATCHER_ID = 'b5f3c111-0000-4000-8000-000000000002';
const ADMIN_ID = 'c5f3c111-0000-4000-8000-000000000003';
const RIDER_ID = 'd5f3c111-0000-4000-8000-000000000004';
const CARRIER_ID = 'e5f3c111-0000-4000-8000-000000000005';
const ORIGIN_HUB_ID = 'f5f3c111-0000-4000-8000-000000000006';
const DEST_HUB_ID = 'a6f3c111-0000-4000-8000-000000000007';
const SHIPMENT_ID = 'b6f3c111-0000-4000-8000-000000000008';
const LEG_ID = 'c6f3c111-0000-4000-8000-000000000009';
const RIDER_USER_ID = 'd6f3c111-0000-4000-8000-000000000010';
const PARTNER_OPERATOR_ID = 'e6f3c111-0000-4000-8000-000000000011';
const OTHER_OPERATOR_ID = 'f6f3c111-0000-4000-8000-000000000012';

function requester(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: DISPATCHER_ID, phone: '+255700000000', roles: [Role.DISPATCHER], ...overrides };
}

function hub(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    name: `Hub ${id}`,
    city: id === ORIGIN_HUB_ID ? 'Dar es Salaam' : 'Mwanza',
    latitude: '-6.7924',
    longitude: '39.2083',
    address: 'Some address',
    capacityKg: null,
    managerId: null,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function leg(overrides: Partial<Leg> = {}): Leg {
  return {
    id: LEG_ID,
    shipmentId: SHIPMENT_ID,
    legType: LegType.LOCAL,
    sequence: 1,
    fromLocation: { latitude: -6.8, longitude: 39.28, address: 'Pickup' },
    toLocation: { latitude: -6.79, longitude: 39.2, address: 'Origin Hub' },
    fromHubId: null,
    toHubId: ORIGIN_HUB_ID,
    status: LegStatus.PENDING,
    riderId: null,
    carrierId: null,
    createdAt: new Date(),
    assignedAt: null,
    completedAt: null,
    ...overrides,
  } as Leg;
}

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: SHIPMENT_ID,
    customerId: CUSTOMER_ID,
    riderId: null,
    status: ShipmentStatus.ASSIGNMENT_PENDING,
    pickupLocation: { latitude: -6.8, longitude: 39.28, address: 'Pickup' },
    dropoffLocation: { latitude: -6.79, longitude: 39.2, address: 'Dropoff' },
    packageWeightKg: null,
    packageDescription: null,
    price: '10000.00',
    commission: '2000.00',
    riderPayout: '8000.00',
    createdAt: new Date(),
    assignedAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    riderRating: null,
    completedAt: null,
    shipmentType: ShipmentType.INTERCITY,
    legCount: 3,
    currentLeg: 1,
    ...overrides,
  } as Shipment;
}

const DEFAULT_QUOTE = {
  pricingConfigId: 'config-1',
  basePrice: '5000.00',
  distanceCharge: '0.00',
  weightCharge: '0.00',
  subtotal: '5000.00',
  surgeMultiplier: '1.00',
  surgeAmount: '0.00',
  price: '10000.00',
  commission: '2000.00',
  riderPayout: '8000.00',
};

describe('LegsService', () => {
  let service: LegsService;
  let legsRepo: ReturnType<typeof mockRepo>;
  let shipmentsRepo: ReturnType<typeof mockRepo>;
  let historyRepo: ReturnType<typeof mockRepo>;
  let trackingEventsRepo: ReturnType<typeof mockRepo>;
  let ridersRepo: ReturnType<typeof mockRepo>;
  let hubsService: { findOne: jest.Mock; findAssignedHubIds: jest.Mock };
  let carriersService: { findOne: jest.Mock };
  let pricingService: { calculatePrice: jest.Mock };
  let shipmentsService: { findOne: jest.Mock };
  let gateway: { broadcastLegUpdate: jest.Mock };

  beforeEach(async () => {
    legsRepo = mockRepo();
    shipmentsRepo = mockRepo();
    historyRepo = mockRepo();
    trackingEventsRepo = mockRepo();
    ridersRepo = mockRepo();

    hubsService = {
      findOne: jest.fn(async (id: string) => hub(id)),
      findAssignedHubIds: jest.fn(async () => [ORIGIN_HUB_ID]),
    };
    carriersService = {
      findOne: jest.fn(async () => ({
        id: CARRIER_ID,
        status: CarrierStatus.ACTIVE,
      })),
    };
    pricingService = { calculatePrice: jest.fn(async () => DEFAULT_QUOTE) };
    shipmentsService = { findOne: jest.fn(async () => shipment()) };
    gateway = { broadcastLegUpdate: jest.fn() };

    const repoByEntity = new Map<unknown, ReturnType<typeof mockRepo>>([
      [Shipment, shipmentsRepo],
      [Leg, legsRepo],
      [ShipmentStatusHistory, historyRepo],
    ]);
    const dataSource = {
      transaction: jest.fn(async (cb: (manager: { getRepository: jest.Mock }) => Promise<unknown>) =>
        cb({
          getRepository: jest.fn((entity: unknown) => {
            const repo = repoByEntity.get(entity);
            if (!repo) throw new Error('No mock repo registered for entity in test DataSource');
            return repo;
          }),
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegsService,
        { provide: getRepositoryToken(Leg), useValue: legsRepo },
        { provide: getRepositoryToken(Shipment), useValue: shipmentsRepo },
        { provide: getRepositoryToken(ShipmentStatusHistory), useValue: historyRepo },
        { provide: getRepositoryToken(TrackingEvent), useValue: trackingEventsRepo },
        { provide: getRepositoryToken(Rider), useValue: ridersRepo },
        { provide: HubsService, useValue: hubsService },
        { provide: CarriersService, useValue: carriersService },
        { provide: PricingService, useValue: pricingService },
        { provide: ShipmentsService, useValue: shipmentsService },
        { provide: TrackingGateway, useValue: gateway },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get(LegsService);
  });

  describe('planIntercityShipment', () => {
    const dto = {
      pickupLocation: { latitude: -6.8, longitude: 39.28, address: 'Pickup' },
      dropoffLocation: { latitude: -2.5, longitude: 32.9, address: 'Dropoff' },
      originHubId: ORIGIN_HUB_ID,
      destinationHubId: DEST_HUB_ID,
      packageWeightKg: 5,
    };

    it('creates an INTERCITY shipment with 3 legs in sequence', async () => {
      const result = await service.planIntercityShipment(dto, CUSTOMER_ID);

      expect(shipmentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          shipmentType: ShipmentType.INTERCITY,
          legCount: 3,
          currentLeg: 1,
          status: ShipmentStatus.QUOTED,
          price: '10000.00',
        }),
      );
      expect(result.legs).toHaveLength(3);
      expect(result.legs.map((l) => l.legType)).toEqual([
        LegType.LOCAL,
        LegType.TRUNK,
        LegType.LOCAL,
      ]);
      expect(result.legs.map((l) => l.sequence)).toEqual([1, 2, 3]);
      expect(result.legs[0].toHubId).toBe(ORIGIN_HUB_ID);
      expect(result.legs[1].fromHubId).toBe(ORIGIN_HUB_ID);
      expect(result.legs[1].toHubId).toBe(DEST_HUB_ID);
      expect(result.legs[2].fromHubId).toBe(DEST_HUB_ID);
      expect(result.legs[2].toHubId).toBeNull();
    });

    it('rejects when origin and destination hubs are the same', async () => {
      hubsService.findOne.mockImplementation(async (id: string) => hub(id));
      await expect(
        service.planIntercityShipment(
          { ...dto, destinationHubId: ORIGIN_HUB_ID },
          CUSTOMER_ID,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('assignRider', () => {
    it('assigns an ACTIVE, online rider to a LOCAL leg and cascades the shipment to ASSIGNED', async () => {
      legsRepo.findOne.mockResolvedValue(leg({ sequence: 1, legType: LegType.LOCAL }));
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: true,
      });
      legsRepo.update.mockResolvedValue({ affected: 1 });
      shipmentsRepo.findOne.mockResolvedValue(shipment({ status: ShipmentStatus.ASSIGNMENT_PENDING }));

      const result = await service.assignRider(
        LEG_ID,
        { riderId: RIDER_ID },
        requester(),
      );

      expect(legsRepo.update).toHaveBeenCalledWith(
        { id: LEG_ID, status: LegStatus.PENDING, riderId: IsNull() },
        expect.objectContaining({ status: LegStatus.ASSIGNED, riderId: RIDER_ID }),
      );
      expect(shipmentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ShipmentStatus.ASSIGNED }),
      );
      expect(gateway.broadcastLegUpdate).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('rejects assigning a rider to a TRUNK leg', async () => {
      legsRepo.findOne.mockResolvedValue(leg({ legType: LegType.TRUNK }));

      await expect(
        service.assignRider(LEG_ID, { riderId: RIDER_ID }, requester()),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a rider that is not ACTIVE and online', async () => {
      legsRepo.findOne.mockResolvedValue(leg({ legType: LegType.LOCAL }));
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: false,
      });

      await expect(
        service.assignRider(LEG_ID, { riderId: RIDER_ID }, requester()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a dispatcher not assigned to a hub this leg touches', async () => {
      legsRepo.findOne.mockResolvedValue(leg({ legType: LegType.LOCAL, toHubId: DEST_HUB_ID }));
      hubsService.findAssignedHubIds.mockResolvedValue([ORIGIN_HUB_ID]);

      await expect(
        service.assignRider(LEG_ID, { riderId: RIDER_ID }, requester()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows an admin regardless of hub assignment', async () => {
      legsRepo.findOne.mockResolvedValue(leg({ legType: LegType.LOCAL, toHubId: DEST_HUB_ID }));
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: true,
      });
      legsRepo.update.mockResolvedValue({ affected: 1 });
      shipmentsRepo.findOne.mockResolvedValue(shipment());

      await service.assignRider(
        LEG_ID,
        { riderId: RIDER_ID },
        requester({ sub: ADMIN_ID, roles: [Role.ADMIN] }),
      );

      expect(hubsService.findAssignedHubIds).not.toHaveBeenCalled();
    });
  });

  describe('assignCarrier', () => {
    it('rejects assigning a carrier to a LOCAL leg', async () => {
      legsRepo.findOne.mockResolvedValue(leg({ legType: LegType.LOCAL }));

      await expect(
        service.assignCarrier(LEG_ID, { carrierId: CARRIER_ID }, requester()),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects an INACTIVE carrier', async () => {
      legsRepo.findOne.mockResolvedValue(
        leg({ legType: LegType.TRUNK, fromHubId: ORIGIN_HUB_ID, toHubId: DEST_HUB_ID }),
      );
      carriersService.findOne.mockResolvedValue({ id: CARRIER_ID, status: CarrierStatus.INACTIVE });

      await expect(
        service.assignCarrier(LEG_ID, { carrierId: CARRIER_ID }, requester()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('startLeg / completeLeg', () => {
    it('moves an ASSIGNED leg 1 to IN_PROGRESS and cascades PICKUP_IN_PROGRESS', async () => {
      legsRepo.findOne.mockResolvedValue(
        leg({ sequence: 1, legType: LegType.LOCAL, status: LegStatus.ASSIGNED }),
      );
      shipmentsRepo.findOne.mockResolvedValue(shipment({ status: ShipmentStatus.ASSIGNED }));

      await service.startLeg(LEG_ID, requester());

      expect(shipmentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ShipmentStatus.PICKUP_IN_PROGRESS }),
      );
    });

    it('completing the final leg (sequence 3) marks the shipment DELIVERED', async () => {
      legsRepo.findOne.mockResolvedValue(
        leg({
          sequence: 3,
          legType: LegType.LOCAL,
          status: LegStatus.IN_PROGRESS,
          fromHubId: DEST_HUB_ID,
          toHubId: null,
        }),
      );
      hubsService.findAssignedHubIds.mockResolvedValue([DEST_HUB_ID]);
      shipmentsRepo.findOne.mockResolvedValue(
        shipment({ status: ShipmentStatus.OUT_FOR_DELIVERY, currentLeg: 3, legCount: 3 }),
      );

      await service.completeLeg(LEG_ID, requester());

      expect(shipmentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ShipmentStatus.DELIVERED }),
      );
      // Final leg (sequence === legCount) does not advance currentLeg further.
      const savedArg = shipmentsRepo.save.mock.calls[0][0];
      expect(savedArg.currentLeg).toBe(3);
    });

    it('completing leg 1 (sequence 1 of 3) advances currentLeg to 2 and cascades PICKED_UP', async () => {
      legsRepo.findOne.mockResolvedValue(
        leg({
          sequence: 1,
          legType: LegType.LOCAL,
          status: LegStatus.IN_PROGRESS,
          toHubId: ORIGIN_HUB_ID,
        }),
      );
      shipmentsRepo.findOne.mockResolvedValue(
        shipment({ status: ShipmentStatus.PICKUP_IN_PROGRESS, currentLeg: 1, legCount: 3 }),
      );

      await service.completeLeg(LEG_ID, requester());

      const savedArg = shipmentsRepo.save.mock.calls[0][0];
      expect(savedArg.status).toBe(ShipmentStatus.PICKED_UP);
      expect(savedArg.currentLeg).toBe(2);
    });

    it('rejects an invalid transition (PENDING -> COMPLETED)', async () => {
      legsRepo.findOne.mockResolvedValue(leg({ status: LegStatus.PENDING }));

      await expect(service.completeLeg(LEG_ID, requester())).rejects.toThrow(ConflictException);
    });
  });

  describe('cancelLeg', () => {
    it('cancels sibling legs and the parent shipment', async () => {
      legsRepo.findOne.mockResolvedValue(
        leg({ sequence: 2, legType: LegType.TRUNK, status: LegStatus.ASSIGNED, fromHubId: ORIGIN_HUB_ID, toHubId: DEST_HUB_ID }),
      );
      legsRepo.find.mockResolvedValue([
        leg({ id: 'leg-1', sequence: 1, status: LegStatus.COMPLETED }),
        leg({ id: LEG_ID, sequence: 2, status: LegStatus.ASSIGNED }),
        leg({ id: 'leg-3', sequence: 3, status: LegStatus.PENDING }),
      ]);
      shipmentsRepo.findOne.mockResolvedValue(shipment({ status: ShipmentStatus.IN_TRANSIT }));

      await service.cancelLeg(LEG_ID, requester({ sub: ADMIN_ID, roles: [Role.ADMIN] }));

      // leg-3 (still PENDING) should be saved as CANCELLED; leg-1
      // (already COMPLETED) should not be touched.
      const cancelledSiblingSave = legsRepo.save.mock.calls.find(
        (call: unknown[]) => (call[0] as Leg).id === 'leg-3',
      );
      expect(cancelledSiblingSave?.[0].status).toBe(LegStatus.CANCELLED);

      expect(shipmentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ShipmentStatus.CANCELLED }),
      );
    });
  });

  describe('getPendingQueue', () => {
    it('scopes results to a DISPATCHER\'s assigned hub(s)', async () => {
      legsRepo.find.mockResolvedValue([
        leg({ id: 'leg-a', legType: LegType.LOCAL, toHubId: ORIGIN_HUB_ID, status: LegStatus.PENDING }),
        leg({ id: 'leg-b', legType: LegType.TRUNK, fromHubId: DEST_HUB_ID, toHubId: 'other-hub', status: LegStatus.PENDING }),
      ]);
      hubsService.findAssignedHubIds.mockResolvedValue([ORIGIN_HUB_ID]);

      const result = await service.getPendingQueue(requester());

      expect(result.pendingLocalLegs.map((l) => l.id)).toEqual(['leg-a']);
      expect(result.pendingTrunkLegs).toHaveLength(0);
    });

    it('returns everything for an admin, unscoped', async () => {
      legsRepo.find.mockResolvedValue([
        leg({ id: 'leg-a', legType: LegType.LOCAL, status: LegStatus.PENDING }),
        leg({ id: 'leg-b', legType: LegType.TRUNK, status: LegStatus.PENDING }),
      ]);

      const result = await service.getPendingQueue(
        requester({ sub: ADMIN_ID, roles: [Role.ADMIN] }),
      );

      expect(hubsService.findAssignedHubIds).not.toHaveBeenCalled();
      expect(result.pendingLocalLegs).toHaveLength(1);
      expect(result.pendingTrunkLegs).toHaveLength(1);
    });
  });

  describe('getActiveQueue', () => {
    it('returns ASSIGNED/IN_PROGRESS legs, scoped to a DISPATCHER\'s hub(s)', async () => {
      legsRepo.find.mockResolvedValue([
        leg({ id: 'leg-a', legType: LegType.LOCAL, toHubId: ORIGIN_HUB_ID, status: LegStatus.ASSIGNED }),
        leg({ id: 'leg-b', legType: LegType.TRUNK, fromHubId: DEST_HUB_ID, toHubId: 'other-hub', status: LegStatus.IN_PROGRESS }),
      ]);
      hubsService.findAssignedHubIds.mockResolvedValue([ORIGIN_HUB_ID]);

      const result = await service.getActiveQueue(requester());

      expect(legsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: expect.anything() },
        }),
      );
      expect(result.activeLocalLegs.map((l) => l.id)).toEqual(['leg-a']);
      expect(result.activeTrunkLegs).toHaveLength(0);
    });

    it('returns an empty queue without querying legs when a dispatcher has no hub assignments', async () => {
      hubsService.findAssignedHubIds.mockResolvedValue([]);

      const result = await service.getActiveQueue(requester());

      expect(legsRepo.find).not.toHaveBeenCalled();
      expect(result).toEqual({ activeLocalLegs: [], activeTrunkLegs: [] });
    });
  });

  describe('selfClaimLocalLeg', () => {
    it('lets an ACTIVE, online rider claim their own PENDING LOCAL leg', async () => {
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        userId: RIDER_USER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: true,
      });
      legsRepo.findOne.mockResolvedValue(leg({ legType: LegType.LOCAL, status: LegStatus.PENDING }));
      legsRepo.update.mockResolvedValue({ affected: 1 });
      shipmentsRepo.findOne.mockResolvedValue(shipment({ status: ShipmentStatus.ASSIGNMENT_PENDING }));

      const result = await service.selfClaimLocalLeg(LEG_ID, RIDER_USER_ID);

      expect(legsRepo.update).toHaveBeenCalledWith(
        { id: LEG_ID, status: LegStatus.PENDING, riderId: IsNull() },
        expect.objectContaining({ status: LegStatus.ASSIGNED, riderId: RIDER_ID }),
      );
      expect(shipmentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ShipmentStatus.ASSIGNED }),
      );
      expect(result).toBeDefined();
    });

    it('rejects a rider with no profile on their account', async () => {
      ridersRepo.findOne.mockResolvedValue(undefined);

      await expect(service.selfClaimLocalLeg(LEG_ID, RIDER_USER_ID)).rejects.toThrow(
        'No rider profile for this account yet',
      );
    });

    it('rejects an offline rider', async () => {
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        userId: RIDER_USER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: false,
      });

      await expect(service.selfClaimLocalLeg(LEG_ID, RIDER_USER_ID)).rejects.toThrow(ForbiddenException);
    });

    it('rejects claiming a TRUNK leg', async () => {
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        userId: RIDER_USER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: true,
      });
      legsRepo.findOne.mockResolvedValue(leg({ legType: LegType.TRUNK }));

      await expect(service.selfClaimLocalLeg(LEG_ID, RIDER_USER_ID)).rejects.toThrow(ConflictException);
    });

    it('rejects a leg already claimed by someone else (lost the race)', async () => {
      ridersRepo.findOne.mockResolvedValue({
        id: RIDER_ID,
        userId: RIDER_USER_ID,
        status: RiderStatus.ACTIVE,
        isOnline: true,
      });
      legsRepo.findOne
        .mockResolvedValueOnce(leg({ legType: LegType.LOCAL, status: LegStatus.PENDING }))
        .mockResolvedValueOnce(leg({ legType: LegType.LOCAL, status: LegStatus.ASSIGNED, riderId: 'someone-else' }));
      legsRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.selfClaimLocalLeg(LEG_ID, RIDER_USER_ID)).rejects.toThrow(ConflictException);
    });
  });

  describe('selfAdvanceLocalLeg', () => {
    it('lets the assigned rider start their own leg', async () => {
      legsRepo.findOne.mockResolvedValue(
        leg({ legType: LegType.LOCAL, status: LegStatus.ASSIGNED, riderId: RIDER_ID }),
      );
      ridersRepo.findOne.mockResolvedValue({ id: RIDER_ID, userId: RIDER_USER_ID });
      legsRepo.update.mockResolvedValue({ affected: 1 });
      shipmentsRepo.findOne.mockResolvedValue(shipment({ status: ShipmentStatus.ASSIGNED }));

      await service.selfAdvanceLocalLeg(LEG_ID, RIDER_USER_ID, LegStatus.IN_PROGRESS);

      expect(legsRepo.update).toHaveBeenCalledWith(
        { id: LEG_ID, status: LegStatus.ASSIGNED, riderId: RIDER_ID },
        expect.objectContaining({ status: LegStatus.IN_PROGRESS }),
      );
    });

    it('rejects a rider who is not the one assigned to this leg', async () => {
      legsRepo.findOne.mockResolvedValue(
        leg({ legType: LegType.LOCAL, status: LegStatus.ASSIGNED, riderId: 'someone-else' }),
      );
      ridersRepo.findOne.mockResolvedValue({ id: RIDER_ID, userId: RIDER_USER_ID });
      legsRepo.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.selfAdvanceLocalLeg(LEG_ID, RIDER_USER_ID, LegStatus.IN_PROGRESS),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects advancing a TRUNK leg', async () => {
      legsRepo.findOne.mockResolvedValue(leg({ legType: LegType.TRUNK }));
      ridersRepo.findOne.mockResolvedValue({ id: RIDER_ID, userId: RIDER_USER_ID });

      await expect(
        service.selfAdvanceLocalLeg(LEG_ID, RIDER_USER_ID, LegStatus.IN_PROGRESS),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('carrierAdvanceTrunkLeg', () => {
    const operator = (id: string) => ({
      id,
      name: 'Kilimanjaro Express',
      phone: null,
      email: null,
      apiKeyHash: 'x',
      latraApiKey: null,
      status: 'ACTIVE' as const,
      createdAt: new Date(),
    });

    it("lets a partner operator advance its own carrier's TRUNK leg", async () => {
      legsRepo.findOne.mockResolvedValue(
        leg({ legType: LegType.TRUNK, status: LegStatus.ASSIGNED, carrierId: CARRIER_ID }),
      );
      carriersService.findOne.mockResolvedValue({ id: CARRIER_ID, partnerOperatorId: PARTNER_OPERATOR_ID });
      legsRepo.update.mockResolvedValue({ affected: 1 });
      shipmentsRepo.findOne.mockResolvedValue(shipment({ status: ShipmentStatus.PICKED_UP }));

      await service.carrierAdvanceTrunkLeg(
        LEG_ID,
        operator(PARTNER_OPERATOR_ID) as never,
        LegStatus.IN_PROGRESS,
      );

      expect(legsRepo.update).toHaveBeenCalledWith(
        { id: LEG_ID, status: LegStatus.ASSIGNED, carrierId: CARRIER_ID },
        expect.objectContaining({ status: LegStatus.IN_PROGRESS }),
      );
    });

    it("rejects a leg whose carrier belongs to a different operator", async () => {
      legsRepo.findOne.mockResolvedValue(
        leg({ legType: LegType.TRUNK, status: LegStatus.ASSIGNED, carrierId: CARRIER_ID }),
      );
      carriersService.findOne.mockResolvedValue({ id: CARRIER_ID, partnerOperatorId: OTHER_OPERATOR_ID });

      await expect(
        service.carrierAdvanceTrunkLeg(
          LEG_ID,
          operator(PARTNER_OPERATOR_ID) as never,
          LegStatus.IN_PROGRESS,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a LOCAL leg', async () => {
      legsRepo.findOne.mockResolvedValue(leg({ legType: LegType.LOCAL }));

      await expect(
        service.carrierAdvanceTrunkLeg(
          LEG_ID,
          operator(PARTNER_OPERATOR_ID) as never,
          LegStatus.IN_PROGRESS,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
