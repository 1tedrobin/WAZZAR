import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminCustomersService } from './admin-customers.service';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

// Read-only, same reasoning as AdminBusinessesController: this closes
// the "no list/detail view of customer accounts at all" gap, it does
// not add a suspend/edit surface. See that controller's header comment
// for why mutating a User row is a separate, larger decision.
@ApiTags('Admin — Customers')
@ApiBearerAuth('access-token')
@Controller('admin/customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminCustomersController {
  constructor(private readonly service: AdminCustomersService) {}

  @Get()
  list(@Query() query: ListCustomersQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }
}
