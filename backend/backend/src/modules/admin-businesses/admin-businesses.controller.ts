import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminBusinessesService } from './admin-businesses.service';
import { ListBusinessesQueryDto } from './dto/list-businesses-query.dto';

// Read-only on purpose — this closes the "no list/detail view of
// business accounts at all" gap (see README_ADMIN_WIRING.md), it does
// not add a suspend/edit surface. There is no existing admin route
// anywhere in the backend today that mutates a User row (riders/:id/
// verify mutates a Rider, not a User) — adding one is a separate,
// larger decision (what CAN an admin change on someone's account?) than
// this task scoped to.
@ApiTags('Admin — Businesses')
@ApiBearerAuth('access-token')
@Controller('admin/businesses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminBusinessesController {
  constructor(private readonly service: AdminBusinessesService) {}

  @Get()
  list(@Query() query: ListBusinessesQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }
}
