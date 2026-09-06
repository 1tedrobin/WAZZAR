import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LegStatus } from '../../database/entities/leg.entity';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { LegsService } from './legs.service';

// A rider acting on their OWN leg — separate from LegsController
// (DISPATCHER/ADMIN/SUPER_ADMIN-only) since the roles don't overlap at
// all. Same @Controller('legs') base path as LegsController and
// IntercityShipmentsController — no route here collides with either
// (self-claim/self-start/self-complete are distinct static suffixes
// from assign-rider/assign-carrier/start/complete/cancel).
@ApiTags('Legs (Rider self-service)')
@ApiBearerAuth('access-token')
@Controller('legs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.RIDER)
export class RiderLegsController {
  constructor(private readonly legsService: LegsService) {}

  @Post(':id/self-claim')
  selfClaim(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.legsService.selfClaimLocalLeg(id, user.sub);
  }

  @Post(':id/self-start')
  selfStart(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.legsService.selfAdvanceLocalLeg(id, user.sub, LegStatus.IN_PROGRESS);
  }

  @Post(':id/self-complete')
  selfComplete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.legsService.selfAdvanceLocalLeg(id, user.sub, LegStatus.COMPLETED);
  }
}
