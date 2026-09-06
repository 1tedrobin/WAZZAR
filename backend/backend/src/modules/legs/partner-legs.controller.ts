import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { PartnerOperator } from '../../database/entities/partner-operator.entity';
import { LegStatus } from '../../database/entities/leg.entity';
import { CurrentPartnerOperator } from '../partner-operators/decorators/current-partner-operator.decorator';
import { PartnerApiKeyGuard } from '../partner-operators/guards/partner-api-key.guard';
import { LegsService } from './legs.service';

// A partner operator's own system (bus company backend, not a WAZZAR
// staff account) advancing its own carrier's TRUNK leg — authenticated
// by PartnerApiKeyGuard, same as
// TrackingChannelsController.ingestPartnerPing, not JwtAuthGuard/RolesGuard.
// Same @Controller('legs') base path as the other leg controllers —
// carrier-start/carrier-complete are distinct static suffixes from
// everything else registered there.
@Controller('legs')
@UseGuards(PartnerApiKeyGuard)
export class PartnerLegsController {
  constructor(private readonly legsService: LegsService) {}

  @Post(':id/carrier-start')
  carrierStart(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPartnerOperator() operator: PartnerOperator,
  ) {
    return this.legsService.carrierAdvanceTrunkLeg(id, operator, LegStatus.IN_PROGRESS);
  }

  @Post(':id/carrier-complete')
  carrierComplete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPartnerOperator() operator: PartnerOperator,
  ) {
    return this.legsService.carrierAdvanceTrunkLeg(id, operator, LegStatus.COMPLETED);
  }
}
