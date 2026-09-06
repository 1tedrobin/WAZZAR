import {
  Body,
  Controller,
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
import { CarriersService } from './carriers.service';
import { CreateCarrierDto } from './dto/create-carrier.dto';
import { ListCarriersQueryDto } from './dto/list-carriers-query.dto';
import { UpdateCarrierDto } from './dto/update-carrier.dto';

// Same access shape as HubsController: DISPATCHER can read (needs to see
// which carriers exist to assign a TRUNK leg), only ADMIN/SUPER_ADMIN can
// write (onboarding a partner's vehicle is an operations decision).
// No partner-operator self-service yet — see PartnerOperatorsController's
// header comment; a partner adding their own carriers is a follow-up.
@ApiTags('Carriers')
@ApiBearerAuth('access-token')
@Controller('carriers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CarriersController {
  constructor(private readonly service: CarriersService) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  create(@Body() dto: CreateCarrierDto) {
    return this.service.create(dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.DISPATCHER)
  list(@Query() query: ListCarriersQueryDto) {
    return this.service.list(query.partnerOperatorId);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.DISPATCHER)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCarrierDto) {
    return this.service.update(id, dto);
  }
}
