import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { CreatePricingConfigDto } from './dto/create-pricing-config.dto';
import { UpdatePricingConfigDto } from './dto/update-pricing-config.dto';
import { PricingService } from './pricing.service';

// Unlike ShipmentsController/RidersController, guards go on individual
// routes here rather than the whole controller — /calculate and /active
// are intentionally public (a customer needs a quote before they have
// an account), while the /configs routes are admin-only.
@ApiTags('Pricing')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  // POST /pricing/calculate — no auth required
  @Post('calculate')
  calculate(@Body() dto: CalculatePriceDto) {
    return this.pricingService.calculatePrice(dto);
  }

  // GET /pricing/active — no auth required
  @Get('active')
  getActive() {
    return this.pricingService.getActiveConfig();
  }

  // GET /pricing/configs — admin only
  @Get('configs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  getAllConfigs() {
    return this.pricingService.getAllConfigs();
  }

  // POST /pricing/configs — admin only. Deactivates whatever config was
  // previously active (see PricingService.createConfig).
  @Post('configs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  createConfig(@Body() dto: CreatePricingConfigDto, @CurrentUser() user: JwtPayload) {
    return this.pricingService.createConfig(dto, user.sub);
  }

  // PUT /pricing/configs/:id — admin only, in-place update (doesn't
  // change which config is active).
  @Put('configs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  updateConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePricingConfigDto,
  ) {
    return this.pricingService.updateConfig(id, dto);
  }
}
