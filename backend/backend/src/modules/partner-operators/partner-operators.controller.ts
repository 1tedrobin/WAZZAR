import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreatePartnerOperatorDto } from './dto/create-partner-operator.dto';
import { UpdatePartnerOperatorDto } from './dto/update-partner-operator.dto';
import { PartnerOperatorsService } from './partner-operators.service';

// ADMIN/SUPER_ADMIN only, no DISPATCHER read access unlike HubsController
// — which partner companies WAZZAR contracts with (and their API keys)
// is a commercial/operations concern, not something a hub-level
// dispatcher needs visibility into to do their job.
@ApiTags('Partner Operators')
@ApiBearerAuth('access-token')
@Controller('partner-operators')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class PartnerOperatorsController {
  constructor(private readonly service: PartnerOperatorsService) {}

  // Response includes the raw apiKey exactly once — the caller (an
  // admin onboarding a new bus company) must copy it down immediately;
  // it cannot be retrieved again, only rotated (POST /:id/rotate-key).
  @Post()
  create(@Body() dto: CreatePartnerOperatorDto) {
    return this.service.create(dto);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePartnerOperatorDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/rotate-key')
  rotateKey(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.rotateKey(id);
  }
}
