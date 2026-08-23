import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AdminCustomersService } from './admin-customers.service';
import { UserRole, Role } from '../../database/entities/user-role.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { UserStatus } from '../../database/entities/user.entity';

const CUSTOMER_ID = 'b7e2c111-0000-4000-8000-000000000001';

function userRole(overrides: Partial<UserRole> = {}): UserRole {
  return {
    userId: CUSTOMER_ID,
    role: Role.CUSTOMER,
    verifiedAt: null,
    user: {
      id: CUSTOMER_ID,
      phone: '+255700000002',
      email: 'jane@example.com',
      fullName: 'Jane Mwangi',
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

function mockShipmentCountQueryBuilder(rawRows: { customerId: string; count: string }[]) {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(async () => rawRows),
  };
  return qb;
}

describe('AdminCustomersService', () => {
  let service: AdminCustomersService;
  let userRoleRepo: any;
  let shipmentRepo: any;

  beforeEach(async () => {
    userRoleRepo = { createQueryBuilder: jest.fn(), findOne: jest.fn() };
    shipmentRepo = { createQueryBuilder: jest.fn(), count: jest.fn(), findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminCustomersService,
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
        { provide: getRepositoryToken(Shipment), useValue: shipmentRepo },
      ],
    }).compile();

    service = module.get(AdminCustomersService);
  });

  describe('list', () => {
    it('maps user_roles rows to list items, attaching a matched shipment count', async () => {
      const qb = mockQueryBuilder([userRole()], 1);
      userRoleRepo.createQueryBuilder.mockReturnValue(qb);
      shipmentRepo.createQueryBuilder.mockReturnValue(
        mockShipmentCountQueryBuilder([{ customerId: CUSTOMER_ID, count: '4' }]),
      );

      const result = await service.list({ limit: 20, offset: 0 } as any);

      expect(result.total).toBe(1);
      expect(result.customers[0]).toMatchObject({
        id: CUSTOMER_ID,
        fullName: 'Jane Mwangi',
        shipmentCount: 4,
      });
    });

    it('defaults shipmentCount to 0 when a customer has never shipped anything', async () => {
      const qb = mockQueryBuilder([userRole()], 1);
      userRoleRepo.createQueryBuilder.mockReturnValue(qb);
      shipmentRepo.createQueryBuilder.mockReturnValue(mockShipmentCountQueryBuilder([]));

      const result = await service.list({ limit: 20, offset: 0 } as any);

      expect(result.customers[0].shipmentCount).toBe(0);
    });

    it('skips the shipment-count batch-fetch entirely when the page is empty', async () => {
      const qb = mockQueryBuilder([], 0);
      userRoleRepo.createQueryBuilder.mockReturnValue(qb);

      await service.list({ limit: 20, offset: 0 } as any);

      expect(shipmentRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('detail', () => {
    it('throws NotFoundException for a user with no CUSTOMER role', async () => {
      userRoleRepo.findOne.mockResolvedValue(null);
      await expect(service.detail(CUSTOMER_ID)).rejects.toThrow(NotFoundException);
    });

    it('combines the account, shipment counts, and last shipment date', async () => {
      userRoleRepo.findOne.mockResolvedValue(userRole());
      shipmentRepo.count.mockResolvedValueOnce(7).mockResolvedValueOnce(5);
      const lastShipmentDate = new Date('2026-08-20T10:00:00Z');
      shipmentRepo.findOne.mockResolvedValue({ createdAt: lastShipmentDate });

      const result = await service.detail(CUSTOMER_ID);

      expect(result.shipmentCount).toBe(7);
      expect(result.completedShipmentCount).toBe(5);
      expect(result.lastShipmentAt).toEqual(lastShipmentDate);
      expect(shipmentRepo.count).toHaveBeenCalledTimes(2);
      expect(shipmentRepo.count.mock.calls[0][0]).toEqual({ where: { customerId: CUSTOMER_ID } });
      const secondCallStatusFilter = shipmentRepo.count.mock.calls[1][0].where.status;
      expect(secondCallStatusFilter.value).toEqual([ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED]);
    });

    it('returns lastShipmentAt null for a customer with no shipments', async () => {
      userRoleRepo.findOne.mockResolvedValue(userRole());
      shipmentRepo.count.mockResolvedValue(0);
      shipmentRepo.findOne.mockResolvedValue(null);

      const result = await service.detail(CUSTOMER_ID);

      expect(result.lastShipmentAt).toBeNull();
    });
  });
});
