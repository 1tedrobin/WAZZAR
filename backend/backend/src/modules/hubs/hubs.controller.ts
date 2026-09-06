import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AssignHubStaffDto } from './dto/assign-hub-staff.dto';
import { CreateHubDto } from './dto/create-hub.dto';
import { ListHubsQueryDto } from './dto/list-hubs-query.dto';
import { UpdateHubDto } from './dto/update-hub.dto';
import { HubsService } from './hubs.service';

// Reads (list/detail) are open to DISPATCHER as well as ADMIN/SUPER_ADMIN
// — a dispatcher needs to see hub details to do their job, same as
// DispatchController's queue is DISPATCHER-readable — and, since
// 2026-09-05, to CUSTOMER and BUSINESS too: booking an intercity
// shipment (POST /shipments/intercity) requires picking an origin/
// destination hub, so whoever can create a shipment needs to be able to
// list them first. Writes (create/update/staffing) stay ADMIN/
// SUPER_ADMIN-only — onboarding a new physical transfer point is an
// operations decision, not a per-hub dispatcher or customer action.
@ApiTags('Hubs')
@ApiBearerAuth('access-token')
@Controller('hubs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HubsController {
  constructor(private readonly service: HubsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  create(@Body() dto: CreateHubDto) {
    return this.service.create(dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.DISPATCHER, Role.CUSTOMER, Role.BUSINESS)
  list(@Query() query: ListHubsQueryDto) {
    return this.service.list(query.city);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.DISPATCHER, Role.CUSTOMER, Role.BUSINESS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHubDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/staff')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  assignStaff(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignHubStaffDto) {
    return this.service.assignStaff(id, dto);
  }

  @Get(':id/staff')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  listStaff(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listStaff(id);
  }

  @Delete(':id/staff/:userId')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  removeStaff(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.service.removeStaff(id, userId);
  }
}
