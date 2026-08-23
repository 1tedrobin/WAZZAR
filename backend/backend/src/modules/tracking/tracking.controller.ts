import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { UpdateRiderLocationDto } from './dto/update-rider-location.dto';
import { TrackingService } from './tracking.service';

// No single @Controller() prefix here — the two routes below live under
// different resources (`/rider/...` and `/shipments/...`), matching the
// paths in WAZZAR_SYSTEM_ARCHITECTURE.md rather than inventing a
// `/tracking/...` prefix of their own.
@ApiTags('Tracking')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  // POST /rider/location
  @Post('rider/location')
  @Roles(Role.RIDER)
  updateLocation(
    @Body() dto: UpdateRiderLocationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.trackingService.updateLocation(user.sub, dto);
  }

  // GET /shipments/:id/tracking — owning customer, assigned rider, or
  // admin only (same rule as GET /shipments/:id). Live updates instead
  // come from the WebSocket /tracking namespace (`subscribe` event); this
  // is the one-off HTTP read.
  @Get('shipments/:id/tracking')
  getTracking(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.trackingService.getShipmentTracking(id, user);
  }
}
