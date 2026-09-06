import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Leg } from '../../database/entities/leg.entity';
import { TrackingChannel } from '../../database/entities/tracking-channel.entity';
import { TrackingEvent } from '../../database/entities/tracking-event.entity';
import { CarriersModule } from '../carriers/carriers.module';
import { HubsModule } from '../hubs/hubs.module';
import { PartnerOperatorsModule } from '../partner-operators/partner-operators.module';
import { TrackingModule } from '../tracking/tracking.module';
import { LatraPollingService } from './latra-polling.service';
import { LatraProvider } from './providers/latra.provider';
import { TrackingChannelsController } from './tracking-channels.controller';
import { TrackingChannelsService } from './tracking-channels.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TrackingChannel, TrackingEvent, Leg]),
    HubsModule,
    CarriersModule,
    PartnerOperatorsModule,
    TrackingModule,
  ],
  controllers: [TrackingChannelsController],
  providers: [TrackingChannelsService, LatraProvider, LatraPollingService],
  exports: [TrackingChannelsService],
})
export class TrackingChannelsModule {}
