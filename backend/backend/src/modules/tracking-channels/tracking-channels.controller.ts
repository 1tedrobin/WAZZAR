import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { PartnerApiKeyGuard } from '../partner-operators/guards/partner-api-key.guard';
import { CurrentPartnerOperator } from '../partner-operators/decorators/current-partner-operator.decorator';
import { PartnerOperator } from '../../database/entities/partner-operator.entity';
import { IngestPartnerPingDto } from './dto/ingest-partner-ping.dto';
import { IngestTrackingChannelDto } from './dto/ingest-tracking-channel.dto';
import { ListTrackingChannelsQueryDto } from './dto/list-tracking-channels-query.dto';
import { TrackingChannelsService } from './tracking-channels.service';

@ApiTags('Tracking Channels (Intercity)')
@Controller('tracking-channels')
export class TrackingChannelsController {
  constructor(private readonly service: TrackingChannelsService) {}

  // POST /tracking-channels — WAZZAR dispatcher/admin manual ingest.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.DISPATCHER)
  @ApiBearerAuth('access-token')
  ingestManual(@Body() dto: IngestTrackingChannelDto, @CurrentUser() user: JwtPayload) {
    return this.service.ingestManual(dto, user);
  }

  // POST /tracking-channels/partner-ping — an external partner
  // operator's own system, authenticated by API key rather than a
  // WAZZAR user JWT — see PartnerApiKeyGuard.
  @Post('partner-ping')
  @UseGuards(PartnerApiKeyGuard)
  ingestPartnerPing(
    @Body() dto: IngestPartnerPingDto,
    @CurrentPartnerOperator() operator: PartnerOperator,
  ) {
    return this.service.ingestPartnerPing(dto, operator);
  }

  // GET /tracking-channels?legId= — raw ingestion log for a leg.
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.DISPATCHER)
  @ApiBearerAuth('access-token')
  list(@Query() query: ListTrackingChannelsQueryDto) {
    return this.service.list(query.legId);
  }

  // GET /tracking-channels/events?legId= — normalized timeline for a leg.
  @Get('events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.DISPATCHER)
  @ApiBearerAuth('access-token')
  listEvents(@Query() query: ListTrackingChannelsQueryDto) {
    return this.service.listEvents(query.legId);
  }
}
