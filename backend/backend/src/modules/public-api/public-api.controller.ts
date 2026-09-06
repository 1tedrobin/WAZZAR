import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyScope } from '../../database/entities/api-key.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { RequireScope } from '../business-api-keys/decorators/require-scope.decorator';
import { ApiKeyAuthGuard } from '../business-api-keys/guards/api-key-auth.guard';
import { CreateShipmentDto } from '../shipments/dto/create-shipment.dto';
import { ListShipmentsQueryDto } from '../shipments/dto/list-shipments-query.dto';
import { ShipmentsService } from '../shipments/shipments.service';
import { TrackingService } from '../tracking/tracking.service';

// The public, API-key-authenticated counterpart to the web app's
// JWT-authenticated /shipments routes — deliberately a small,
// versioned subset (create/list/get a shipment, read tracking), not a
// mirror of everything ShipmentsController exposes. Assigning riders,
// updating status, proof-of-delivery, and rating stay operational
// concerns of the WAZZAR apps themselves, not something an external
// integration should be able to do directly.
//
// Every route reuses the existing service methods as-is — a
// synthetic JwtPayload built by ApiKeyAuthGuard (sub = businessId,
// roles = [BUSINESS]) stands in for a real logged-in user, so a
// shipment created via API key is indistinguishable from one created
// through the business app, and the same ownership checks
// (assertCanAccess in ShipmentsService) apply to both. @CurrentUser()
// works here for free since it just reads req.user, which
// ApiKeyAuthGuard populates the same shape JwtAuthGuard would.
@ApiTags('Public API')
@ApiSecurity('api-key')
@Controller('v1/api')
@UseGuards(ApiKeyAuthGuard)
export class PublicApiController {
  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly trackingService: TrackingService,
  ) {}

  @Post('shipments')
  @RequireScope(ApiKeyScope.SHIPMENTS_WRITE)
  createShipment(@Body() dto: CreateShipmentDto, @CurrentUser() user: JwtPayload) {
    return this.shipmentsService.create(dto, user.sub);
  }

  @Get('shipments')
  @RequireScope(ApiKeyScope.SHIPMENTS_READ)
  listShipments(@Query() query: ListShipmentsQueryDto, @CurrentUser() user: JwtPayload) {
    return this.shipmentsService.findAll(query, user.sub);
  }

  @Get('shipments/:id')
  @RequireScope(ApiKeyScope.SHIPMENTS_READ)
  getShipment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.shipmentsService.findOne(id, user);
  }

  @Get('shipments/:id/tracking')
  @RequireScope(ApiKeyScope.TRACKING_READ)
  getTracking(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.trackingService.getShipmentTracking(id, user);
  }
}
