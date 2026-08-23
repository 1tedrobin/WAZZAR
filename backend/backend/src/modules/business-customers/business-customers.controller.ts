import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { BusinessCustomersService } from './business-customers.service';
import { CreateBusinessCustomerDto } from './dto/create-business-customer.dto';
import { UpdateBusinessCustomerDto } from './dto/update-business-customer.dto';

// Every route here is scoped to the calling business's own address
// book (see BusinessCustomersService.findOwnedOrThrow) — there is no
// admin/cross-business view, unlike most other modules. That's
// intentional: this is a business's private contact list, not
// platform data an admin needs oversight of.
@ApiTags('Business — Customers')
@ApiBearerAuth('access-token')
@Controller('business/customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUSINESS)
export class BusinessCustomersController {
  constructor(private readonly service: BusinessCustomersService) {}

  @Post()
  create(@Body() dto: CreateBusinessCustomerDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBusinessCustomerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(user.sub, id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(user.sub, id);
  }
}
