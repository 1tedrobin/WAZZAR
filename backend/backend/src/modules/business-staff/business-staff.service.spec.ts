import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BusinessStaffService } from './business-staff.service';
import {
  BusinessStaff,
  BusinessStaffRole,
  BusinessStaffStatus,
} from '../../database/entities/business-staff.entity';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'st-1', ...x })),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  };
}

const BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000001';
const OTHER_BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000099';
const ENTRY_ID = 'c5f3c111-0000-4000-8000-000000000001';

function entry(overrides: Partial<BusinessStaff> = {}): BusinessStaff {
  return {
    id: ENTRY_ID,
    businessId: BUSINESS_ID,
    name: 'Fatima Ali',
    email: 'fatima@zawadiboutique.co.tz',
    role: BusinessStaffRole.STAFF,
    status: BusinessStaffStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BusinessStaff;
}

describe('BusinessStaffService', () => {
  let service: BusinessStaffService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    repo = mockRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessStaffService,
        { provide: getRepositoryToken(BusinessStaff), useValue: repo },
      ],
    }).compile();
    service = module.get(BusinessStaffService);
  });

  describe('create', () => {
    it('always lands as PENDING, regardless of what the caller passes', async () => {
      await service.create(BUSINESS_ID, {
        name: 'Fatima Ali',
        email: 'fatima@zawadiboutique.co.tz',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: BUSINESS_ID,
          status: BusinessStaffStatus.PENDING,
        }),
      );
    });

    it('defaults role to STAFF when not provided', async () => {
      await service.create(BUSINESS_ID, { name: 'Daniel', email: 'daniel@x.co.tz' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: BusinessStaffRole.STAFF }),
      );
    });

    it('honors an explicit MANAGER role', async () => {
      await service.create(BUSINESS_ID, {
        name: 'Fatima Ali',
        email: 'fatima@zawadiboutique.co.tz',
        role: BusinessStaffRole.MANAGER,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: BusinessStaffRole.MANAGER }),
      );
    });
  });

  describe('list', () => {
    it("returns only the calling business's own roster, newest first", async () => {
      repo.find.mockResolvedValue([entry()]);

      const result = await service.list(BUSINESS_ID);

      expect(repo.find).toHaveBeenCalledWith({
        where: { businessId: BUSINESS_ID },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('can flip status from PENDING to ACTIVE', async () => {
      repo.findOne.mockResolvedValue(entry());

      await service.update(BUSINESS_ID, ENTRY_ID, { status: BusinessStaffStatus.ACTIVE });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: BusinessStaffStatus.ACTIVE }),
      );
    });

    it('throws ForbiddenException for another business\'s staff entry', async () => {
      repo.findOne.mockResolvedValue(entry({ businessId: OTHER_BUSINESS_ID }));

      await expect(
        service.update(BUSINESS_ID, ENTRY_ID, { role: BusinessStaffRole.MANAGER }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('deletes an owned entry', async () => {
      repo.findOne.mockResolvedValue(entry());

      const result = await service.remove(BUSINESS_ID, ENTRY_ID);

      expect(repo.delete).toHaveBeenCalledWith({ id: ENTRY_ID });
      expect(result).toEqual({ deleted: true });
    });

    it('throws NotFoundException for a nonexistent entry', async () => {
      repo.findOne.mockResolvedValue(undefined);

      await expect(service.remove(BUSINESS_ID, ENTRY_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
