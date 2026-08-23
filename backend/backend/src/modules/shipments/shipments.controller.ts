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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ListShipmentsQueryDto } from './dto/list-shipments-query.dto';
import { RateRiderDto } from './dto/rate-rider.dto';
import { SubmitProofOfDeliveryDto } from './dto/submit-proof-of-delivery.dto';
import { UpdateShipmentStatusDto } from './dto/update-shipment-status.dto';

@ApiTags('Shipments')
@ApiBearerAuth('access-token')
@Controller('shipments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  // POST /shipments
  @Post()
  create(@Body() dto: CreateShipmentDto, @CurrentUser() user: JwtPayload) {
    return this.shipmentsService.create(dto, user.sub);
  }

  // GET /shipments?status=...&limit=...&offset=... (always scoped to the
  // caller — see ListShipmentsQueryDto)
  @Get()
  findAll(
    @Query() query: ListShipmentsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shipmentsService.findAll(query, user.sub);
  }

  // GET /shipments/available — rider-facing open queue (unassigned,
  // ASSIGNMENT_PENDING). Registered before ':id' so 'available' never
  // gets swallowed by the ':id' param, same convention used for
  // GET /payments/reconcile/:date.
  @Get('available')
  @Roles(Role.RIDER)
  findAvailable(@Query() query: ListShipmentsQueryDto) {
    return this.shipmentsService.findAvailableForRider(query.limit, query.offset);
  }

  // GET /shipments/:id — owning customer, assigned rider, or admin only
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.shipmentsService.findOne(id, user);
  }

  // GET /shipments/:id/history — full audit trail, oldest first. Same
  // access rule as findOne (owning customer, assigned rider, or admin).
  @Get(':id/history')
  getHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.shipmentsService.getStatusHistory(id, user);
  }

  // PATCH /shipments/:id/status — owning customer, assigned rider, or
  // admin only. Can't be used to reach ASSIGNED — see POST :id/assign.
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShipmentStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shipmentsService.updateStatus(id, dto.status, user, dto.reason);
  }

  // POST /shipments/:id/assign — a RIDER claims an ASSIGNMENT_PENDING
  // shipment for themselves. No body: the rider is always the caller.
  @Post(':id/assign')
  @Roles(Role.RIDER)
  assign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.shipmentsService.assign(id, user.sub);
  }

  // POST /shipments/:id/deliver — the assigned RIDER confirms delivery
  // with recipient details. Can't be reached via PATCH :id/status — see
  // ShipmentsService.updateStatus.
  @Post(':id/deliver')
  @Roles(Role.RIDER)
  deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitProofOfDeliveryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shipmentsService.submitProofOfDelivery(id, user.sub, dto);
  }

  // GET /shipments/:id/proof-of-delivery — owning customer, assigned
  // rider, or admin only (same rule as GET /shipments/:id).
  @Get(':id/proof-of-delivery')
  getProofOfDelivery(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shipmentsService.getProofOfDelivery(id, user);
  }

  // POST /shipments/:id/rate-rider — no @Roles restriction, same
  // convention as POST /shipments (create): ownership is enforced in
  // the service (only the customer who placed this exact shipment),
  // not by role.
  @Post(':id/rate-rider')
  rateRider(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateRiderDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shipmentsService.rateRider(id, dto, user);
  }
}
