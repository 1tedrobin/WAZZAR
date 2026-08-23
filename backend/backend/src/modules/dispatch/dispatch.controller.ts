import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { DispatchService } from './dispatch.service';
import { AssignShipmentDto } from './dto/assign-shipment.dto';
import { AutoAssignDto } from './dto/auto-assign.dto';

// Dispatch operations are restricted to ADMIN, SUPER_ADMIN, and DISPATCHER roles.
// 
// DISPATCHER (added in Piece 6, Phase 2 prep) is a dedicated operational role for
// dispatch coordinators, allowing fine-grained audit trails and billing per
// dispatcher without requiring full admin privileges. Dispatchers cannot access
// other admin functions (no user management, config changes, etc.) — dispatch
// routes are the only surface they can reach.
//
// DISPATCHER role is not self-signup; it must be granted out-of-band by an
// existing ADMIN or SUPER_ADMIN (e.g. via seed script or manual DB update).
@ApiTags('Dispatch')
@ApiBearerAuth('access-token')
@Controller('dispatch')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.DISPATCHER)
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  // GET /dispatch/queue — everything waiting to be dispatched + everyone
  // currently dispatchable.
  @Get('queue')
  getQueue() {
    return this.dispatchService.getQueue();
  }

  // GET /dispatch/shipments/:id/candidates — ranked candidate riders for
  // one shipment (v1 heuristic, not geo — see dispatch.service.ts).
  @Get('shipments/:id/candidates')
  getCandidates(@Param('id', ParseUUIDPipe) id: string) {
    return this.dispatchService.getCandidates(id);
  }

  // POST /dispatch/shipments/:id/assign — dispatcher picks the rider.
  @Post('shipments/:id/assign')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignShipmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dispatchService.assign(id, dto.riderId, user.sub, dto.reason);
  }

  // POST /dispatch/shipments/:id/auto-assign — system picks the top
  // candidate and assigns it.
  @Post('shipments/:id/auto-assign')
  autoAssign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AutoAssignDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dispatchService.autoAssign(id, user.sub, dto.reason);
  }
}
