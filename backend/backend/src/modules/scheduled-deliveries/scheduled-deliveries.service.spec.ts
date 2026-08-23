import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ScheduledDeliveriesService } from './scheduled-deliveries.service';
import { ScheduledDelivery } from '../../database/entities/scheduled-delivery.entity';
import { ShipmentsService } from '../shipments/shipments.service';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'sd-1', ...x })),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  };
}

function mockShipmentsService() {
  return {
    create: jest.fn(async () => ({ id: 'shipment-1' })),
  };
}

const BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000001';
const OTHER_BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000099';
const SCHEDULE_ID = 'c5f3c111-0000-4000-8000-000000000001';

const LOCATION = { latitude: -6.79, longitude: 39.21, address: 'Kariakoo Market' };

function schedule(overrides: Partial<ScheduledDelivery> = {}): ScheduledDelivery {
  return {
    id: SCHEDULE_ID,
    businessId: BUSINESS_ID,
    name: 'Daily restock',
    pickupLocation: LOCATION,
    dropoffLocation: LOCATION,
    packageWeightKg: null,
    packageDescription: null,
    daysOfWeek: [1, 2, 3, 4, 5],
    timeOfDay: '09:00',
    active: true,
    nextRunAt: new Date('2026-08-24T06:00:00.000Z'),
    lastRunAt: null,
    lastRunError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ScheduledDelivery;
}

describe('ScheduledDeliveriesService', () => {
  let service: ScheduledDeliveriesService;
  let repo: ReturnType<typeof mockRepo>;
  let shipmentsService: ReturnType<typeof mockShipmentsService>;

  beforeEach(async () => {
    repo = mockRepo();
    shipmentsService = mockShipmentsService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduledDeliveriesService,
        { provide: getRepositoryToken(ScheduledDelivery), useValue: repo },
        { provide: ShipmentsService, useValue: shipmentsService },
      ],
    }).compile();
    service = module.get(ScheduledDeliveriesService);
  });

  describe('create', () => {
    it('saves a new schedule scoped to the calling business, active, with nextRunAt computed', async () => {
      await service.create(BUSINESS_ID, {
        name: 'Daily restock',
        pickupLocation: LOCATION,
        dropoffLocation: LOCATION,
        daysOfWeek: [1, 2, 3, 4, 5],
        timeOfDay: '09:00',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: BUSINESS_ID,
          name: 'Daily restock',
          daysOfWeek: [1, 2, 3, 4, 5],
          timeOfDay: '09:00',
          active: true,
          lastRunAt: null,
          lastRunError: null,
        }),
      );
      const savedArg = repo.create.mock.calls[0][0];
      expect(savedArg.nextRunAt).toBeInstanceOf(Date);
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it("returns only the calling business's own schedules, newest first", async () => {
      repo.find.mockResolvedValue([schedule()]);

      const result = await service.list(BUSINESS_ID);

      expect(repo.find).toHaveBeenCalledWith({
        where: { businessId: BUSINESS_ID },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('updates simple fields without touching nextRunAt', async () => {
      const original = schedule();
      repo.findOne.mockResolvedValue(original);

      await service.update(BUSINESS_ID, SCHEDULE_ID, { name: 'Renamed' });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Renamed', nextRunAt: original.nextRunAt }),
      );
    });

    it('recomputes nextRunAt when the recurrence changes', async () => {
      repo.findOne.mockResolvedValue(schedule({ nextRunAt: new Date('2020-01-01T00:00:00.000Z') }));

      await service.update(BUSINESS_ID, SCHEDULE_ID, { timeOfDay: '18:00' });

      const savedArg = repo.save.mock.calls[0][0];
      expect(savedArg.nextRunAt.getTime()).toBeGreaterThan(
        new Date('2020-01-01T00:00:00.000Z').getTime(),
      );
    });

    it('recomputes nextRunAt from now when re-activating a dormant schedule', async () => {
      repo.findOne.mockResolvedValue(
        schedule({ active: false, nextRunAt: new Date('2020-01-01T00:00:00.000Z') }),
      );

      await service.update(BUSINESS_ID, SCHEDULE_ID, { active: true });

      const savedArg = repo.save.mock.calls[0][0];
      expect(savedArg.active).toBe(true);
      expect(savedArg.nextRunAt.getTime()).toBeGreaterThan(
        new Date('2020-01-01T00:00:00.000Z').getTime(),
      );
    });

    it('does not recompute nextRunAt when merely deactivating', async () => {
      const original = schedule({ nextRunAt: new Date('2026-09-01T00:00:00.000Z') });
      repo.findOne.mockResolvedValue(original);

      await service.update(BUSINESS_ID, SCHEDULE_ID, { active: false });

      const savedArg = repo.save.mock.calls[0][0];
      expect(savedArg.nextRunAt).toEqual(original.nextRunAt);
    });

    it('throws NotFoundException for a nonexistent schedule', async () => {
      repo.findOne.mockResolvedValue(undefined);

      await expect(
        service.update(BUSINESS_ID, SCHEDULE_ID, { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException for another business's schedule", async () => {
      repo.findOne.mockResolvedValue(schedule({ businessId: OTHER_BUSINESS_ID }));

      await expect(
        service.update(BUSINESS_ID, SCHEDULE_ID, { name: 'X' }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an owned schedule', async () => {
      repo.findOne.mockResolvedValue(schedule());

      const result = await service.remove(BUSINESS_ID, SCHEDULE_ID);

      expect(repo.delete).toHaveBeenCalledWith({ id: SCHEDULE_ID });
      expect(result).toEqual({ deleted: true });
    });

    it("throws ForbiddenException instead of deleting another business's schedule", async () => {
      repo.findOne.mockResolvedValue(schedule({ businessId: OTHER_BUSINESS_ID }));

      await expect(service.remove(BUSINESS_ID, SCHEDULE_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  describe('runDueSchedules', () => {
    it('creates a shipment for each due schedule and advances nextRunAt', async () => {
      const now = new Date('2026-08-24T06:00:00.000Z');
      repo.find.mockResolvedValue([schedule({ nextRunAt: now })]);

      const result = await service.runDueSchedules(now);

      expect(shipmentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ pickupLocation: LOCATION, dropoffLocation: LOCATION }),
        BUSINESS_ID,
      );
      expect(result).toEqual({ ran: 1, failed: 0 });
      const savedArg = repo.save.mock.calls[0][0];
      expect(savedArg.lastRunAt).toEqual(now);
      expect(savedArg.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
      expect(savedArg.lastRunError).toBeNull();
    });

    it('queries only active schedules due by `now`', async () => {
      repo.find.mockResolvedValue([]);
      const now = new Date('2026-08-24T06:00:00.000Z');

      await service.runDueSchedules(now);

      expect(repo.find).toHaveBeenCalledWith({
        where: { active: true, nextRunAt: expect.anything() },
      });
    });

    it('records the error and still advances nextRunAt when shipment creation fails', async () => {
      const now = new Date('2026-08-24T06:00:00.000Z');
      repo.find.mockResolvedValue([schedule({ nextRunAt: now })]);
      shipmentsService.create.mockRejectedValueOnce(new Error('No active pricing config'));

      const result = await service.runDueSchedules(now);

      expect(result).toEqual({ ran: 0, failed: 1 });
      const savedArg = repo.save.mock.calls[0][0];
      expect(savedArg.lastRunError).toBe('No active pricing config');
      expect(savedArg.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
    });

    it("one schedule's failure does not stop the others in the same tick", async () => {
      const now = new Date('2026-08-24T06:00:00.000Z');
      repo.find.mockResolvedValue([
        schedule({ id: 'sched-a', nextRunAt: now }),
        schedule({ id: 'sched-b', nextRunAt: now }),
      ]);
      shipmentsService.create
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ id: 'shipment-2' });

      const result = await service.runDueSchedules(now);

      expect(result).toEqual({ ran: 1, failed: 1 });
      expect(repo.save).toHaveBeenCalledTimes(2);
    });
  });
});
