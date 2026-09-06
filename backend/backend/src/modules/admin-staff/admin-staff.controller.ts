import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { Role } from '../../database/entities/user-role.entity';
import { AdminStaffService, StaffMember } from './admin-staff.service';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
@Controller('admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminStaffController {
  constructor(private readonly adminStaffService: AdminStaffService) {}
  @Get()
  async list(): Promise<StaffMember[]> {
    return this.adminStaffService.listStaff();
  }
  @Post()
  async createOrPromote(
    @Body() dto: CreateStaffUserDto,
    @CurrentUser() requester: JwtPayload,
  ): Promise<StaffMember> {
    return this.adminStaffService.createOrPromote(dto, requester.sub);
  }
  @Delete(':userId/:role')
  async revokeRole(
    @Param('userId') userId: string,
    @Param('role', new ParseEnumPipe(Role)) role: Role,
  ): Promise<{ status: string }> {
    await this.adminStaffService.revokeRole(userId, role);
    return { status: 'ok' };
  }
}