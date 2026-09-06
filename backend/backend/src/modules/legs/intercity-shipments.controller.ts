import { Controller, Get, Param, ParseUUIDPipe, Post, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { PlanIntercityShipmentDto } from './dto/plan-intercity-shipment.dto';
import { LegsService } from './legs.service';

// Deliberately `@Controller('shipments')` — the same base path as
// ShipmentsController — rather than a separate `/intercity-shipments`
// resource. No route here collides with ShipmentsController's own
// routes (POST /shipments/intercity and GET /shipments/:id/legs are
// each a distinct exact path from anything there), and this keeps the
// URL shape consistent with how a customer already thinks about
// shipments: one resource, LOCAL or INTERCITY (see Shipment.shipmentType).
// No @Roles restriction, matching ShipmentsController's own POST
// /shipments — ownership is enforced in the service (the shipment is
// always created for the calling user; GET .../legs reuses
// ShipmentsService.findOne's owning-customer-or-admin check), not by role.
@ApiTags('Shipments (Intercity)')
@ApiBearerAuth('access-token')
@Controller('shipments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntercityShipmentsController {
  constructor(private readonly legsService: LegsService) {}

  // POST /shipments/intercity
  @Post('intercity')
  planIntercityShipment(
    @Body() dto: PlanIntercityShipmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.legsService.planIntercityShipment(dto, user.sub);
  }

  // GET /shipments/:id/legs
  @Get(':id/legs')
  getLegs(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.legsService.getLegs(id, user);
  }
}
