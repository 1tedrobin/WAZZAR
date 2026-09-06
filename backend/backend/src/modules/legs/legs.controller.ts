import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { AssignCarrierLegDto } from './dto/assign-carrier-leg.dto';
import { AssignRiderLegDto } from './dto/assign-rider-leg.dto';
import { LegsService } from './legs.service';

// DISPATCHER/ADMIN/SUPER_ADMIN only across this whole controller — see
// LegsService's header comment on why there's no rider/carrier
// self-service leg management in this pass. A DISPATCHER is further
// scoped to their assigned hub(s) inside LegsService itself
// (assertDispatcherHubAccess) — enforced in the service rather than
// here since it depends on which hub(s) a specific leg touches, not
// just the caller's role.
@ApiTags('Legs (Intercity)')
@ApiBearerAuth('access-token')
@Controller('legs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.DISPATCHER)
export class LegsController {
  constructor(private readonly legsService: LegsService) {}

  // GET /legs/pending — registered before any :id route (none exist yet
  // on this controller, but keeping the convention ShipmentsController
  // already established for .../available matters if one is ever added).
  @Get('pending')
  getPendingQueue(@CurrentUser() user: JwtPayload) {
    return this.legsService.getPendingQueue(user);
  }

  // GET /legs/active — legs already ASSIGNED/IN_PROGRESS, so the admin
  // Dispatch page can offer start/complete/cancel actions, not only the
  // initial assign step the pending queue above covers.
  @Get('active')
  getActiveQueue(@CurrentUser() user: JwtPayload) {
    return this.legsService.getActiveQueue(user);
  }

  @Post(':id/assign-rider')
  assignRider(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRiderLegDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.legsService.assignRider(id, dto, user);
  }

  @Post(':id/assign-carrier')
  assignCarrier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignCarrierLegDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.legsService.assignCarrier(id, dto, user);
  }

  @Post(':id/start')
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.legsService.startLeg(id, user);
  }

  @Post(':id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.legsService.completeLeg(id, user);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.legsService.cancelLeg(id, user);
  }
}
