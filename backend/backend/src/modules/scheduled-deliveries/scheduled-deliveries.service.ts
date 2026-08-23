import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ScheduledDelivery } from '../../database/entities/scheduled-delivery.entity';
import { ShipmentsService } from '../shipments/shipments.service';
import { CreateScheduledDeliveryDto } from './dto/create-scheduled-delivery.dto';
import { UpdateScheduledDeliveryDto } from './dto/update-scheduled-delivery.dto';
import { computeNextRunAt } from './scheduled-delivery-recurrence.util';

@Injectable()
export class ScheduledDeliveriesService {
  private readonly logger = new Logger(ScheduledDeliveriesService.name);

  constructor(
    @InjectRepository(ScheduledDelivery)
    private readonly repo: Repository<ScheduledDelivery>,
    // Real coupling, not incidental: runDueSchedules() creates shipments
    // through the exact same ShipmentsService.create() the New Delivery
    // modal (and every other shipment-creation path) uses, so pricing
    // and validation logic live in exactly one place rather than being
    // re-implemented here. ShipmentsModule exports ShipmentsService
    // specifically for cases like this — see its module comment.
    private readonly shipmentsService: ShipmentsService,
  ) {}

  async create(
    businessId: string,
    dto: CreateScheduledDeliveryDto,
  ): Promise<ScheduledDelivery> {
    const entry = this.repo.create({
      businessId,
      name: dto.name,
      pickupLocation: dto.pickupLocation,
      dropoffLocation: dto.dropoffLocation,
      packageWeightKg:
        dto.packageWeightKg !== undefined ? dto.packageWeightKg.toString() : null,
      packageDescription: dto.packageDescription ?? null,
      daysOfWeek: dto.daysOfWeek,
      timeOfDay: dto.timeOfDay,
      active: true,
      nextRunAt: computeNextRunAt(dto.daysOfWeek, dto.timeOfDay),
      lastRunAt: null,
      lastRunError: null,
    });
    return this.repo.save(entry);
  }

  // Newest-first, same convention as BusinessCustomersService.list.
  async list(businessId: string): Promise<ScheduledDelivery[]> {
    return this.repo.find({ where: { businessId }, order: { createdAt: 'DESC' } });
  }

  async update(
    businessId: string,
    id: string,
    dto: UpdateScheduledDeliveryDto,
  ): Promise<ScheduledDelivery> {
    const entry = await this.findOwnedOrThrow(businessId, id);

    // Captured before any field is mutated below — both checks compare
    // against the *pre-edit* state.
    const recurrenceChanged = dto.daysOfWeek !== undefined || dto.timeOfDay !== undefined;
    const reactivated = dto.active === true && !entry.active;

    if (dto.name !== undefined) entry.name = dto.name;
    if (dto.pickupLocation !== undefined) entry.pickupLocation = dto.pickupLocation;
    if (dto.dropoffLocation !== undefined) entry.dropoffLocation = dto.dropoffLocation;
    if (dto.packageWeightKg !== undefined) entry.packageWeightKg = dto.packageWeightKg.toString();
    if (dto.packageDescription !== undefined) entry.packageDescription = dto.packageDescription;
    if (dto.daysOfWeek !== undefined) entry.daysOfWeek = dto.daysOfWeek;
    if (dto.timeOfDay !== undefined) entry.timeOfDay = dto.timeOfDay;
    if (dto.active !== undefined) entry.active = dto.active;

    // Anything that changes *when* this next fires recomputes nextRunAt
    // from right now — see UpdateScheduledDeliveryDto's header comment
    // for why (editing a schedule always means "starting from this
    // edit," and re-enabling a dormant one shouldn't fire a backlog of
    // "missed" runs).
    if (recurrenceChanged || reactivated) {
      entry.nextRunAt = computeNextRunAt(entry.daysOfWeek, entry.timeOfDay, new Date());
    }

    return this.repo.save(entry);
  }

  async remove(businessId: string, id: string): Promise<{ deleted: true }> {
    await this.findOwnedOrThrow(businessId, id);
    await this.repo.delete({ id });
    return { deleted: true };
  }

  // Called by ScheduledDeliveriesCronService on a timer — there is no
  // HTTP route that triggers this. Finds every active schedule whose
  // nextRunAt has arrived, creates a real shipment for each, and always
  // advances nextRunAt regardless of whether creation succeeded.
  //
  // "Always advances" is deliberate: if shipment creation throws (the
  // likely cause is no active PricingConfig covering the route right
  // then — see PricingService), retrying the same instant on every
  // subsequent cron tick until someone notices would be worse than
  // skipping to the next scheduled occurrence and recording the error
  // on the row (lastRunError) so it's visible instead of silent.
  //
  // One schedule's failure never stops the others in the same tick —
  // each is wrapped in its own try/catch.
  async runDueSchedules(now: Date = new Date()): Promise<{ ran: number; failed: number }> {
    const due = await this.repo.find({
      where: { active: true, nextRunAt: LessThanOrEqual(now) },
    });

    let ran = 0;
    let failed = 0;

    for (const schedule of due) {
      try {
        await this.shipmentsService.create(
          {
            pickupLocation: schedule.pickupLocation,
            dropoffLocation: schedule.dropoffLocation,
            packageWeightKg:
              schedule.packageWeightKg !== null
                ? Number(schedule.packageWeightKg)
                : undefined,
            packageDescription: schedule.packageDescription ?? undefined,
          },
          schedule.businessId,
        );
        schedule.lastRunError = null;
        ran += 1;
      } catch (err) {
        schedule.lastRunError = err instanceof Error ? err.message : 'Unknown error';
        failed += 1;
        this.logger.warn(
          `Scheduled delivery ${schedule.id} (business ${schedule.businessId}) failed to create a shipment: ${schedule.lastRunError}`,
        );
      }
      schedule.lastRunAt = now;
      schedule.nextRunAt = computeNextRunAt(schedule.daysOfWeek, schedule.timeOfDay, now);
      await this.repo.save(schedule);
    }

    return { ran, failed };
  }

  // Not just findOne(id) — a business must never be able to read, edit,
  // delete, or (indirectly) trigger shipment creation on another
  // business's schedule by guessing a UUID. Same pattern as
  // BusinessCustomersService.findOwnedOrThrow.
  private async findOwnedOrThrow(
    businessId: string,
    id: string,
  ): Promise<ScheduledDelivery> {
    const entry = await this.repo.findOne({ where: { id } });
    if (!entry) {
      throw new NotFoundException(`Scheduled delivery ${id} not found`);
    }
    if (entry.businessId !== businessId) {
      throw new ForbiddenException('You do not have access to this schedule');
    }
    return entry;
  }
}
