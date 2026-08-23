import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RiderDocumentType } from '../../database/entities/rider.entity';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { CreateRiderProfileDto } from './dto/create-rider-profile.dto';
import { ReviewRiderDocumentDto } from './dto/review-rider-document.dto';
import { RidersService } from './riders.service';

@ApiTags('Riders')
@Controller('riders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RidersController {
  constructor(private readonly ridersService: RidersService) {}

  // POST /riders — a user with the RIDER role onboards themselves.
  // Lands in ONBOARDING status; can't go online until an admin verifies.
  @Post()
  @Roles(Role.RIDER)
  @ApiBearerAuth('access-token')
  createProfile(
    @Body() dto: CreateRiderProfileDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ridersService.createProfile(user.sub, dto);
  }

  // GET /riders/me
  @Get('me')
  @Roles(Role.RIDER)
  @ApiBearerAuth('access-token')
  findMine(@CurrentUser() user: JwtPayload) {
    return this.ridersService.findByUserId(user.sub);
  }

  // GET /riders/me/earnings
  @Get('me/earnings')
  @Roles(Role.RIDER)
  @ApiBearerAuth('access-token')
  getEarnings(@CurrentUser() user: JwtPayload) {
    return this.ridersService.getEarnings(user.sub);
  }

  // POST /riders/availability/online
  @Post('availability/online')
  @Roles(Role.RIDER)
  @ApiBearerAuth('access-token')
  goOnline(@CurrentUser() user: JwtPayload) {
    return this.ridersService.setOnline(user.sub);
  }

  // POST /riders/availability/offline
  @Post('availability/offline')
  @Roles(Role.RIDER)
  @ApiBearerAuth('access-token')
  goOffline(@CurrentUser() user: JwtPayload) {
    return this.ridersService.setOffline(user.sub);
  }

  // GET /riders/:id/public — public endpoint, no auth required.
  // Returns non-sensitive rider info for customer tracking.
  @Public()
  @Get(':id/public')
  getPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.ridersService.getPublicProfile(id);
  }

  // PATCH /riders/:id/verify — admin-only, flips ONBOARDING/INACTIVE -> ACTIVE
  @Patch(':id/verify')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  verify(@Param('id', ParseUUIDPipe) id: string) {
    return this.ridersService.verify(id);
  }

  // GET /riders/:id — admin-only, full profile (document URLs + review
  // state included) so an admin has something to review documents against.
  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.ridersService.findById(id);
  }

  // PATCH /riders/:id/documents/:documentType — admin-only, approve/reject
  // one document. Alongside (not instead of) PATCH :id/verify above.
  @Patch(':id/documents/:documentType')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  reviewDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentType', new ParseEnumPipe(RiderDocumentType)) documentType: RiderDocumentType,
    @Body() dto: ReviewRiderDocumentDto,
  ) {
    return this.ridersService.reviewDocument(id, documentType, dto);
  }
}
