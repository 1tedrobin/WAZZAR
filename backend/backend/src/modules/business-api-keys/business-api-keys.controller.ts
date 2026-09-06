import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { BusinessApiKeysService } from './business-api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

// Managing keys happens over the normal JWT-authenticated web-app API
// (a business signed into the dashboard), scoped to that business's
// own keys — same ownership pattern as business-customers/staff.
// *Using* a key against the public API is a completely separate
// surface — see PublicApiModule + ApiKeyAuthGuard — deliberately kept
// apart from this controller so a leaked API key alone can never be
// used to mint, list, or revoke other keys.
@ApiTags('Business — API Keys')
@ApiBearerAuth('access-token')
@Controller('business/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUSINESS)
export class BusinessApiKeysController {
  constructor(private readonly service: BusinessApiKeysService) {}

  @Post()
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user.sub);
  }

  @Delete(':id')
  revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.service.revoke(user.sub, id);
  }
}
