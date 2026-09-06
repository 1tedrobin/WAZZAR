import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { HubsService } from './hubs.service';
import { Hub } from '../../database/entities/hub.entity';
import { HubAssignment } from '../../database/entities/hub-assignment.entity';
import { Role, UserRole } from '../../database/entities/user-role.entity';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'hub-1', ...x })),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  };
}

const HUB_ID = 'a5f3c111-0000-4000-8000-000000000001';
const DISPATCHER_USER_ID = 'b5f3c111-0000-4000-8000-000000000002';

function hub(overrides: Partial<Hub> = {}): Hub {
  return {
    id: HUB_ID,
    name: 'Dar Central Hub',
    city: 'Dar es Salaam',
    latitude: '-6.79240000',
    longitude: '39.20830000',
    address: 'Kariakoo, Dar es Salaam',
    capacityKg: 2000,
    managerId: null,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  } as Hub;
}

describe('HubsService', () => {
  let service: HubsService;
  let hubsRepo: ReturnType<typeof mockRepo>;
  let hubAssignmentsRepo: ReturnType<typeof mockRepo>;
  let userRoleRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    hubsRepo = mockRepo();
    hubAssignmentsRepo = mockRepo();
    userRoleRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HubsService,
        { provide: getRepositoryToken(Hub), useValue: hubsRepo },
        { provide: getRepositoryToken(HubAssignment), useValue: hubAssignmentsRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
      ],
    }).compile();
    service = module.get(HubsService);
  });

  describe('create', () => {
    it('stores lat/lng as strings for the decimal columns', async () => {
      await service.create({
        name: 'Dar Central Hub',
        city: 'Dar es Salaam',
        latitude: -6.7924,
        longitude: 39.2083,
        address: 'Kariakoo, Dar es Salaam',
      });

      expect(hubsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Dar Central Hub',
          city: 'Dar es Salaam',
          latitude: '-6.7924',
          longitude: '39.2083',
          capacityKg: null,
          managerId: null,
        }),
      );
    });
  });

  describe('list', () => {
    it('filters by city when provided', async () => {
      hubsRepo.find.mockResolvedValue([hub()]);

      await service.list('Dar es Salaam');

      expect(hubsRepo.find).toHaveBeenCalledWith({
        where: { city: 'Dar es Salaam' },
        order: { name: 'ASC' },
      });
    });

    it('returns every hub when no city filter is given', async () => {
      hubsRepo.find.mockResolvedValue([hub()]);

      await service.list();

      expect(hubsRepo.find).toHaveBeenCalledWith({ where: {}, order: { name: 'ASC' } });
    });
  });

  describe('assignStaff', () => {
    it('assigns a user who holds the DISPATCHER role', async () => {
      hubsRepo.findOne.mockResolvedValue(hub());
      userRoleRepo.findOne.mockResolvedValue({ userId: DISPATCHER_USER_ID, role: Role.DISPATCHER });
      hubAssignmentsRepo.findOne.mockResolvedValue(undefined);

      await service.assignStaff(HUB_ID, { userId: DISPATCHER_USER_ID });

      expect(hubAssignmentsRepo.create).toHaveBeenCalledWith({
        hubId: HUB_ID,
        userId: DISPATCHER_USER_ID,
      });
      expect(hubAssignmentsRepo.save).toHaveBeenCalled();
    });

    it('rejects a user who does not hold the DISPATCHER role', async () => {
      hubsRepo.findOne.mockResolvedValue(hub());
      userRoleRepo.findOne.mockResolvedValue(undefined);

      await expect(
        service.assignStaff(HUB_ID, { userId: DISPATCHER_USER_ID }),
      ).rejects.toThrow(BadRequestException);
      expect(hubAssignmentsRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a duplicate assignment', async () => {
      hubsRepo.findOne.mockResolvedValue(hub());
      userRoleRepo.findOne.mockResolvedValue({ userId: DISPATCHER_USER_ID, role: Role.DISPATCHER });
      hubAssignmentsRepo.findOne.mockResolvedValue({
        id: 'existing',
        hubId: HUB_ID,
        userId: DISPATCHER_USER_ID,
      });

      await expect(
        service.assignStaff(HUB_ID, { userId: DISPATCHER_USER_ID }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException for a nonexistent hub', async () => {
      hubsRepo.findOne.mockResolvedValue(undefined);

      await expect(
        service.assignStaff(HUB_ID, { userId: DISPATCHER_USER_ID }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAssignedHubIds', () => {
    it('returns the hub ids a user is assigned to', async () => {
      hubAssignmentsRepo.find.mockResolvedValue([
        { id: '1', hubId: HUB_ID, userId: DISPATCHER_USER_ID, assignedAt: new Date() },
      ]);

      const result = await service.findAssignedHubIds(DISPATCHER_USER_ID);

      expect(result).toEqual([HUB_ID]);
    });
  });
});
