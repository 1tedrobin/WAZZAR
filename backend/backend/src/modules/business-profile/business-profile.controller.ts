import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../modules/auth/guards/roles.guard';
import { Roles } from '../../modules/auth/decorators/roles.decorator';
import { CurrentUser } from '../../modules/auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { BusinessProfileService } from './business-profile.service';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';

@ApiTags('Business — Profile')
@ApiBearerAuth('access-token')
@Controller('business/profile')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUSINESS, Role.SUPER_ADMIN)
export class BusinessProfileController {
  constructor(private profileService: BusinessProfileService) {}

  @Get()
  async getProfile(@CurrentUser() user: JwtPayload) {
    return this.profileService.getOrCreateProfile(user.sub);
  }

  @Patch()
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateBusinessProfileDto,
  ) {
    return this.profileService.updateProfile(user.sub, dto);
  }
}
