import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AdminBusinessesService } from './admin-businesses.service';
import { UserRole, Role } from '../../database/entities/user-role.entity';
import { BusinessProfile } from '../../database/entities/business-profile.entity';
import { BusinessStaff } from '../../database/entities/business-staff.entity';
import { BusinessCustomer } from '../../database/entities/business-customer.entity';
import { UserStatus } from '../../database/entities/user.entity';

const BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000001';

function userRole(overrides: Partial<UserRole> = {}): UserRole {
  return {
    userId: BUSINESS_ID,
    role: Role.BUSINESS,
    verifiedAt: null,
    user: {
      id: BUSINESS_ID,
      phone: '+255700000001',
      email: 'shop@example.com',
      fullName: 'Kariakoo Traders',
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
    },
    ...overrides,
  } as UserRole;
}

function mockQueryBuilder(rows: UserRole[], total: number) {
  const qb: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(async () => [rows, total]),
  };
  return qb;
}

describe('AdminBusinessesService', () => {
  let service: AdminBusinessesService;
  let userRoleRepo: any;
  let profileRepo: any;
  let staffRepo: any;
  let businessCustomerRepo: any;

  beforeEach(async () => {
    userRoleRepo = { createQueryBuilder: jest.fn(), findOne: jest.fn() };
    profileRepo = { find: jest.fn(), findOne: jest.fn() };
    staffRepo = { count: jest.fn() };
    businessCustomerRepo = { count: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBusinessesService,
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
        { provide: getRepositoryToken(BusinessProfile), useValue: profileRepo },
        { provide: getRepositoryToken(BusinessStaff), useValue: staffRepo },
        { provide: getRepositoryToken(BusinessCustomer), useValue: businessCustomerRepo },
      ],
    }).compile();

    service = module.get(AdminBusinessesService);
  });

  describe('list', () => {
    it('maps user_roles rows to list items, attaching a matched profile', async () => {
      const qb = mockQueryBuilder([userRole()], 1);
      userRoleRepo.createQueryBuilder.mockReturnValue(qb);
      profileRepo.find.mockResolvedValue([
        { businessId: BUSINESS_ID, businessName: 'Kariakoo Traders Ltd', category: 'Retail' },
      ]);

      const result = await service.list({ limit: 20, offset: 0 } as any);

      expect(result.total).toBe(1);
      expect(result.businesses[0]).toMatchObject({
        id: BUSINESS_ID,
        businessName: 'Kariakoo Traders Ltd',
        category: 'Retail',
      });
    });

    it('leaves businessName/category null when no profile exists yet', async () => {
      const qb = mockQueryBuilder([userRole()], 1);
      userRoleRepo.createQueryBuilder.mockReturnValue(qb);
      profileRepo.find.mockResolvedValue([]);

      const result = await service.list({ limit: 20, offset: 0 } as any);

      expect(result.businesses[0].businessName).toBeNull();
      expect(result.businesses[0].category).toBeNull();
    });

    it('skips the profile batch-fetch entirely when the page is empty', async () => {
      const qb = mockQueryBuilder([], 0);
      userRoleRepo.createQueryBuilder.mockReturnValue(qb);

      await service.list({ limit: 20, offset: 0 } as any);

      expect(profileRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('detail', () => {
    it('throws NotFoundException for a user with no BUSINESS role', async () => {
      userRoleRepo.findOne.mockResolvedValue(null);
      await expect(service.detail(BUSINESS_ID)).rejects.toThrow(NotFoundException);
    });

    it('combines the account, profile, and counts', async () => {
      userRoleRepo.findOne.mockResolvedValue(userRole());
      profileRepo.findOne.mockResolvedValue({ businessId: BUSINESS_ID, businessName: 'Kariakoo Traders Ltd' });
      staffRepo.count.mockResolvedValue(3);
      businessCustomerRepo.count.mockResolvedValue(12);

      const result = await service.detail(BUSINESS_ID);

      expect(result.staffCount).toBe(3);
      expect(result.customerCount).toBe(12);
      expect(result.profile?.businessName).toBe('Kariakoo Traders Ltd');
    });
  });
});
