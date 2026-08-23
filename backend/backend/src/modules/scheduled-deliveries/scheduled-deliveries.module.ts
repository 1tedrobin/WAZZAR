import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduledDelivery } from '../../database/entities/scheduled-delivery.entity';
import { ShipmentsModule } from '../shipments/shipments.module';
import { ScheduledDeliveriesController } from './scheduled-deliveries.controller';
import { ScheduledDeliveriesCronService } from './scheduled-deliveries.cron';
import { ScheduledDeliveriesService } from './scheduled-deliveries.service';

@Module({
  // ShipmentsModule (not just its entity) is imported so
  // ScheduledDeliveriesService can inject the real ShipmentsService —
  // see that service's constructor comment for why this is a real
  // dependency, not just entity re-registration.
  imports: [TypeOrmModule.forFeature([ScheduledDelivery]), ShipmentsModule],
  controllers: [ScheduledDeliveriesController],
  // The cron service is a provider here (not exported — nothing else
  // needs to inject it) purely so Nest instantiates it and its
  // @Cron() decorator gets registered. ScheduleModule.forRoot() must
  // also be imported once globally in AppModule for @Cron to do
  // anything at all.
  providers: [ScheduledDeliveriesService, ScheduledDeliveriesCronService],
})
export class ScheduledDeliveriesModule {}
