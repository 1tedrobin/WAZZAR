import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartnerOperator } from '../../database/entities/partner-operator.entity';
import { PartnerApiKeyGuard } from './guards/partner-api-key.guard';
import { PartnerOperatorsController } from './partner-operators.controller';
import { PartnerOperatorsService } from './partner-operators.service';

@Module({
  imports: [TypeOrmModule.forFeature([PartnerOperator])],
  controllers: [PartnerOperatorsController],
  providers: [PartnerOperatorsService, PartnerApiKeyGuard],
  // Exported so CarriersModule can validate partnerOperatorId at create
  // time, and TrackingChannelsModule can use PartnerApiKeyGuard to
  // authenticate partner-ingested tracking pings.
  exports: [PartnerOperatorsService, PartnerApiKeyGuard],
})
export class PartnerOperatorsModule {}
