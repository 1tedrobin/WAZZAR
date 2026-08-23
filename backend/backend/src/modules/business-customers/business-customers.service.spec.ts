import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BusinessCustomersService } from './business-customers.service';
import { BusinessCustomer } from '../../database/entities/business-customer.entity';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'bc-1', ...x })),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  };
}

const BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000001';
const OTHER_BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000099';
const ENTRY_ID = 'b5f3c111-0000-4000-8000-000000000001';

function entry(overrides: Partial<BusinessCustomer> = {}): BusinessCustomer {
  return {
    id: ENTRY_ID,
    businessId: BUSINESS_ID,
    name: 'Neema K.',
    phone: '0754221909',
    address: 'Mikocheni B, Selander Bridge',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BusinessCustomer;
}

describe('BusinessCustomersService', () => {
  let service: BusinessCustomersService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    repo = mockRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessCustomersService,
        { provide: getRepositoryToken(BusinessCustomer), useValue: repo },
      ],
    }).compile();
    service = module.get(BusinessCustomersService);
  });

  describe('create', () => {
    it('saves a new entry scoped to the calling business', async () => {
      await service.create(BUSINESS_ID, {
        name: 'Neema K.',
        phone: '0754221909',
        address: 'Mikocheni B, Selander Bridge',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: BUSINESS_ID,
          name: 'Neema K.',
          phone: '0754221909',
          address: 'Mikocheni B, Selander Bridge',
          notes: null,
        }),
      );
      expect(repo.save).toHaveBeenCalled();
    });

    it('stores optional notes when provided', async () => {
      await service.create(BUSINESS_ID, {
        name: 'Neema K.',
        phone: '0754221909',
        address: 'Mikocheni B',
        notes: 'Ring twice, dog in yard',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ notes: 'Ring twice, dog in yard' }),
      );
    });
  });

  describe('list', () => {
    it('returns only the calling business\'s own entries, newest first', async () => {
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
    it('updates only the fields provided', async () => {
      repo.findOne.mockResolvedValue(entry());

      await service.update(BUSINESS_ID, ENTRY_ID, { notes: 'Gate code 4471' });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Neema K.', notes: 'Gate code 4471' }),
      );
    });

    it('throws NotFoundException for a nonexistent entry', async () => {
      repo.findOne.mockResolvedValue(undefined);

      await expect(
        service.update(BUSINESS_ID, ENTRY_ID, { name: 'New name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the entry belongs to a different business', async () => {
      repo.findOne.mockResolvedValue(entry({ businessId: OTHER_BUSINESS_ID }));

      await expect(
        service.update(BUSINESS_ID, ENTRY_ID, { name: 'New name' }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an owned entry', async () => {
      repo.findOne.mockResolvedValue(entry());

      const result = await service.remove(BUSINESS_ID, ENTRY_ID);

      expect(repo.delete).toHaveBeenCalledWith({ id: ENTRY_ID });
      expect(result).toEqual({ deleted: true });
    });

    it('throws ForbiddenException instead of deleting another business\'s entry', async () => {
      repo.findOne.mockResolvedValue(entry({ businessId: OTHER_BUSINESS_ID }));

      await expect(service.remove(BUSINESS_ID, ENTRY_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a nonexistent entry', async () => {
      repo.findOne.mockResolvedValue(undefined);

      await expect(service.remove(BUSINESS_ID, ENTRY_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
