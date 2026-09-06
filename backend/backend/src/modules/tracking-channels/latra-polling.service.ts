import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Leg, LegStatus, LegType } from '../../database/entities/leg.entity';
import { CarriersService } from '../carriers/carriers.service';
import { PartnerOperatorsService } from '../partner-operators/partner-operators.service';
import { LatraProvider } from './providers/latra.provider';
import { TrackingChannelType } from '../../database/entities/tracking-channel.entity';
import { TrackingChannelsService } from './tracking-channels.service';

// Requires ScheduleModule.forRoot() (already registered globally in
// app.module.ts for ScheduledDeliveriesCronService — see that module's
// comment) — nothing new to wire up there.
//
// EVERY_5_MINUTES, not EVERY_MINUTE like ScheduledDeliveriesCronService:
// a trunk-network bus's position doesn't need minute-level granularity
// the way a due delivery schedule does, and — while LatraProvider is in
// mock mode for every partner operator today (see that provider's
// header comment) — a real LATRA API is an external system this
// codebase should poll politely, not hammer every 60 seconds. 5 minutes
// is a starting guess, not a measured value; revisit once a real LATRA
// account exists and its actual rate limits are known.
@Injectable()
export class LatraPollingService {
  private readonly logger = new Logger(LatraPollingService.name);

  constructor(
    @InjectRepository(Leg)
    private readonly legsRepo: Repository<Leg>,
    private readonly carriersService: CarriersService,
    private readonly partnerOperatorsService: PartnerOperatorsService,
    private readonly latraProvider: LatraProvider,
    private readonly trackingChannelsService: TrackingChannelsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron(): Promise<void> {
    const activeTrunkLegs = await this.legsRepo.find({
      where: {
        legType: LegType.TRUNK,
        status: In([LegStatus.ASSIGNED, LegStatus.IN_PROGRESS]),
      },
    });

    if (activeTrunkLegs.length === 0) {
      return;
    }

    let polled = 0;
    let failed = 0;

    for (const leg of activeTrunkLegs) {
      if (!leg.carrierId) {
        continue;
      }
      try {
        const carrier = await this.carriersService.findOne(leg.carrierId);
        const operator = await this.partnerOperatorsService.findOne(carrier.partnerOperatorId);
        const ping = await this.latraProvider.pollVehicleLocation(operator, carrier.registration);

        await this.trackingChannelsService.recordChannelEvent(
          leg,
          TrackingChannelType.LATRA_TRACKING,
          'latra_api',
          {
            latitude: ping.latitude,
            longitude: ping.longitude,
            reportedAt: ping.reportedAt,
            raw: ping.raw,
          },
        );
        polled += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `LATRA poll failed for leg ${leg.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    this.logger.log(`LATRA polling tick: ${polled} leg(s) polled, ${failed} failed`);
  }
}
