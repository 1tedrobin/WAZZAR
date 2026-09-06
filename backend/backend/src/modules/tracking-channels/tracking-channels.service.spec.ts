import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { TrackingChannelsService } from './tracking-channels.service';
import { Leg, LegStatus, LegType } from '../../database/entities/leg.entity';
import { TrackingChannel, TrackingChannelType } from '../../database/entities/tracking-channel.entity';
import { TrackingEvent } from '../../database/entities/tracking-event.entity';
import { Role } from '../../database/entities/user-role.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { HubsService } from '../hubs/hubs.service';
import { CarriersService } from '../carriers/carriers.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { PartnerOperatorStatus } from '../../database/entities/partner-operator.entity';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'row-1', ...x })),
    find: jest.fn(async () => []),
    findOne: jest.fn(),
  };
}

const LEG_ID = 'a5f3c111-0000-4000-8000-000000000001';
const SHIPMENT_ID = 'b5f3c111-0000-4000-8000-000000000002';
const HUB_ID = 'c5f3c111-0000-4000-8000-000000000003';
const OPERATOR_ID = 'd5f3c111-0000-4000-8000-000000000004';
const CARRIER_ID = 'e5f3c111-0000-4000-8000-000000000005';

function leg(overrides: Partial<Leg> = {}): Leg {
  return {
    id: LEG_ID,
    shipmentId: SHIPMENT_ID,
    legType: LegType.TRUNK,
    sequence: 2,
    fromLocation: { latitude: -6.8, longitude: 39.28, address: 'A' },
    toLocation: { latitude: -2.5, longitude: 32.9, address: 'B' },
    fromHubId: HUB_ID,
    toHubId: 'other-hub',
    status: LegStatus.IN_PROGRESS,
    riderId: null,
    carrierId: CARRIER_ID,
    createdAt: new Date(),
    assignedAt: new Date(),
    completedAt: null,
    ...overrides,
  } as Leg;
}

function requester(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: 'dispatcher-1', phone: '+255700000000', roles: [Role.DISPATCHER], ...overrides };
}

describe('TrackingChannelsService', () => {
  let service: TrackingChannelsService;
  let channelsRepo: ReturnType<typeof mockRepo>;
  let eventsRepo: ReturnType<typeof mockRepo>;
  let legsRepo: ReturnType<typeof mockRepo>;
  let hubsService: { findAssignedHubIds: jest.Mock };
  let carriersService: { findOne: jest.Mock };
  let gateway: { broadcastLegUpdate: jest.Mock };

  beforeEach(async () => {
    channelsRepo = mockRepo();
    eventsRepo = mockRepo();
    legsRepo = mockRepo();
    hubsService = { findAssignedHubIds: jest.fn(async () => [HUB_ID]) };
    carriersService = {
      findOne: jest.fn(async () => ({ id: CARRIER_ID, partnerOperatorId: OPERATOR_ID })),
    };
    gateway = { broadcastLegUpdate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingChannelsService,
        { provide: getRepositoryToken(TrackingChannel), useValue: channelsRepo },
        { provide: getRepositoryToken(TrackingEvent), useValue: eventsRepo },
        { provide: getRepositoryToken(Leg), useValue: legsRepo },
        { provide: HubsService, useValue: hubsService },
        { provide: CarriersService, useValue: carriersService },
        { provide: TrackingGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get(TrackingChannelsService);
  });

  describe('recordChannelEvent', () => {
    it('writes a LOCATION_UPDATE event and broadcasts when lat/lng are present', async () => {
      await service.recordChannelEvent(leg(), TrackingChannelType.GPS_LIVE, 'test', {
        latitude: -2.5,
        longitude: 32.9,
      });

      expect(eventsRepo.save).toHaveBeenCalled();
      expect(gateway.broadcastLegUpdate).toHaveBeenCalledWith(
        SHIPMENT_ID,
        expect.objectContaining({ latitude: -2.5, longitude: 32.9 }),
      );
    });

    it('logs the raw channel row but skips the event when no coordinates are present', async () => {
      await service.recordChannelEvent(leg(), TrackingChannelType.DISPATCHER_MANUAL, 'test', {
        note: 'bus delayed at checkpoint',
      });

      expect(channelsRepo.save).toHaveBeenCalled();
      expect(eventsRepo.save).not.toHaveBeenCalled();
      expect(gateway.broadcastLegUpdate).not.toHaveBeenCalled();
    });
  });

  describe('ingestManual', () => {
    it('rejects a dispatcher not assigned to a hub this leg touches', async () => {
      legsRepo.findOne.mockResolvedValue(leg());
      hubsService.findAssignedHubIds.mockResolvedValue(['some-other-hub']);

      await expect(
        service.ingestManual(
          { legId: LEG_ID, channelType: TrackingChannelType.DISPATCHER_MANUAL, eventData: {} },
          requester(),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('ingestPartnerPing', () => {
    it('rejects a ping for a leg whose carrier belongs to a different operator', async () => {
      legsRepo.findOne.mockResolvedValue(leg());
      carriersService.findOne.mockResolvedValue({
        id: CARRIER_ID,
        partnerOperatorId: 'a-different-operator',
      });

      await expect(
        service.ingestPartnerPing(
          { legId: LEG_ID, channelType: TrackingChannelType.PARTNER_SCAN, eventData: {} },
          {
            id: OPERATOR_ID,
            name: 'Kilimanjaro Express',
            phone: null,
            email: null,
            apiKeyHash: 'x',
            latraApiKey: null,
            status: PartnerOperatorStatus.ACTIVE,
            createdAt: new Date(),
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a ping for a LOCAL leg', async () => {
      legsRepo.findOne.mockResolvedValue(leg({ legType: LegType.LOCAL, carrierId: null }));

      await expect(
        service.ingestPartnerPing(
          { legId: LEG_ID, channelType: TrackingChannelType.PARTNER_SCAN, eventData: {} },
          {
            id: OPERATOR_ID,
            name: 'Kilimanjaro Express',
            phone: null,
            email: null,
            apiKeyHash: 'x',
            latraApiKey: null,
            status: PartnerOperatorStatus.ACTIVE,
            createdAt: new Date(),
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
