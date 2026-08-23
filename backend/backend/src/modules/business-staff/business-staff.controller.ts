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
import { BusinessStaffService } from './business-staff.service';
import { CreateBusinessStaffDto } from './dto/create-business-staff.dto';
import { UpdateBusinessStaffDto } from './dto/update-business-staff.dto';

// Every route scoped to the calling business's own roster — see
// BusinessStaffService.findOwnedOrThrow. This is a private team list,
// not platform data an admin needs oversight of, same reasoning as
// BusinessCustomersController.
@ApiTags('Business — Staff')
@ApiBearerAuth('access-token')
@Controller('business/staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUSINESS)
export class BusinessStaffController {
  constructor(private readonly service: BusinessStaffService) {}

  @Post()
  create(@Body() dto: CreateBusinessStaffDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBusinessStaffDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(user.sub, id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(user.sub, id);
  }
}
