import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { CarriersService } from './carriers.service';
import { Carrier, CarrierStatus, CarrierVehicleType } from '../../database/entities/carrier.entity';
import { PartnerOperatorsService } from '../partner-operators/partner-operators.service';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'carrier-1', ...x })),
    find: jest.fn(),
    findOne: jest.fn(),
  };
}

const OPERATOR_ID = 'a5f3c111-0000-4000-8000-000000000001';
const CARRIER_ID = 'b5f3c111-0000-4000-8000-000000000001';

function carrier(overrides: Partial<Carrier> = {}): Carrier {
  return {
    id: CARRIER_ID,
    partnerOperatorId: OPERATOR_ID,
    vehicleType: CarrierVehicleType.BUS,
    registration: 'T 123 XYZ',
    capacityKg: 3000,
    routes: [{ fromCity: 'Dar es Salaam', toCity: 'Mwanza' }],
    schedule: null,
    status: CarrierStatus.ACTIVE,
    createdAt: new Date(),
    ...overrides,
  } as Carrier;
}

describe('CarriersService', () => {
  let service: CarriersService;
  let repo: ReturnType<typeof mockRepo>;
  let partnerOperatorsService: { findOne: jest.Mock };

  beforeEach(async () => {
    repo = mockRepo();
    partnerOperatorsService = { findOne: jest.fn().mockResolvedValue({ id: OPERATOR_ID }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CarriersService,
        { provide: getRepositoryToken(Carrier), useValue: repo },
        { provide: PartnerOperatorsService, useValue: partnerOperatorsService },
      ],
    }).compile();
    service = module.get(CarriersService);
  });

  describe('create', () => {
    it('validates the partner operator exists before creating', async () => {
      await service.create({
        partnerOperatorId: OPERATOR_ID,
        vehicleType: CarrierVehicleType.BUS,
        registration: 'T 123 XYZ',
      });

      expect(partnerOperatorsService.findOne).toHaveBeenCalledWith(OPERATOR_ID);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerOperatorId: OPERATOR_ID,
          vehicleType: CarrierVehicleType.BUS,
          registration: 'T 123 XYZ',
          routes: [],
        }),
      );
    });

    it('propagates NotFoundException when the partner operator does not exist', async () => {
      partnerOperatorsService.findOne.mockRejectedValue(new NotFoundException());

      await expect(
        service.create({
          partnerOperatorId: OPERATOR_ID,
          vehicleType: CarrierVehicleType.BUS,
          registration: 'T 123 XYZ',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('findActiveForRoute', () => {
    it('queries only ACTIVE carriers, then filters by route', async () => {
      // repo.find() here is a mock, so unlike real Postgres it won't
      // actually apply the `where: {status: ACTIVE}` filter itself —
      // this test only returns ACTIVE carriers in the mocked resolved
      // value (what a real DB call scoped to that where clause would
      // return), and separately asserts the where clause was correct.
      repo.find.mockResolvedValue([
        carrier(),
        carrier({ id: 'carrier-2', routes: [{ fromCity: 'Mwanza', toCity: 'Dar es Salaam' }] }),
      ]);

      const result = await service.findActiveForRoute('Dar es Salaam', 'Mwanza');

      expect(repo.find).toHaveBeenCalledWith({ where: { status: CarrierStatus.ACTIVE } });
      expect(result.map((c) => c.id)).toEqual([CARRIER_ID]);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a nonexistent carrier', async () => {
      repo.findOne.mockResolvedValue(undefined);

      await expect(service.findOne(CARRIER_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
