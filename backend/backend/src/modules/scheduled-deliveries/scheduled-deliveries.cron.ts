import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScheduledDeliveriesService } from './scheduled-deliveries.service';

// This is the "second half" the roadmap doc flagged as the genuinely
// hard part of scheduled deliveries: not another CRUD module, but real
// infrastructure — a process that wakes up on its own and turns due
// schedules into real shipments without anyone asking it to.
//
// Requires @nestjs/schedule's ScheduleModule.forRoot() to be imported
// once, globally, in AppModule — @Cron() decorators are inert without
// it. See app.module.ts.
//
// EVERY_MINUTE, not something coarser: timeOfDay has minute granularity
// ("HH:mm" — see the recurrence util), so anything coarser risks firing
// up to just-under-one-tick late, which for e.g. an hourly check could
// mean up to 59 minutes. A one-minute tick keeps that worst case to
// under a minute, and runDueSchedules() is cheap to call when nothing
// is due (one indexed SELECT that returns zero rows).
@Injectable()
export class ScheduledDeliveriesCronService {
  private readonly logger = new Logger(ScheduledDeliveriesCronService.name);

  constructor(private readonly scheduledDeliveriesService: ScheduledDeliveriesService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    const { ran, failed } = await this.scheduledDeliveriesService.runDueSchedules();
    if (ran > 0 || failed > 0) {
      this.logger.log(
        `Scheduled deliveries tick: ${ran} shipment(s) created, ${failed} failed`,
      );
    }
  }
}
