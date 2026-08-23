import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { MpesaWebhookDto } from './dto/mpesa-webhook.dto';
import { PaymentHistoryQueryDto } from './dto/payment-history-query.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { StripeWebhookDto } from './dto/stripe-webhook.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // POST /payments/initiate — the calling customer starts a payment for
  // their own shipment.
  @Post('initiate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  initiate(@Body() dto: InitiatePaymentDto, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.initiatePayment(dto, user.sub);
  }

  // GET /payments/history?status=...&limit=...&offset=... — always
  // scoped to the caller, same pattern as GET /shipments.
  @Get('history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  history(@Query() query: PaymentHistoryQueryDto, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.getHistory(user.sub, query);
  }

  // GET /payments/reconcile/:date — admin only, finance report.
  // Registered before ':id/status' so 'reconcile' never gets swallowed
  // by the ':id' param (Nest matches static segments before the DI
  // order alone would suggest — this ordering just keeps intent obvious).
  @Get('reconcile/:date')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  reconcile(@Param('date') date: string) {
    return this.paymentsService.reconcile(date);
  }

  // GET /payments/:id/status — owning customer or admin only.
  @Get(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  status(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.checkStatus(id, user);
  }

  // POST /payments/:id/refund — owning customer or admin only. Full
  // refund if `amount` omitted, partial otherwise.
  @Post(':id/refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.refund(id, dto, user);
  }

  // POST /payments/:id/collect-cash — the rider assigned to the
  // shipment, or an admin, confirms a CASH payment was physically
  // collected. No request body: who's confirming comes from the JWT.
  @Post(':id/collect-cash')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @Roles(Role.RIDER, Role.ADMIN, Role.SUPER_ADMIN)
  collectCash(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.confirmCashCollection(id, user);
  }

  // POST /payments/webhooks/mpesa — no JWT: the provider can't send a
  // bearer token. The x-mpesa-signature header does the authenticating
  // instead (see webhook-signature.ts). req.rawBody is the exact bytes
  // received (see main.ts's `rawBody: true`) — passed through so the
  // signature can be checked against what was actually sent, not a
  // re-serialized copy of the parsed body.
  @Post('webhooks/mpesa')
  mpesaWebhook(
    @Body() payload: MpesaWebhookDto,
    @Headers('x-mpesa-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.paymentsService.handleMpesaCallback(payload, signature, req.rawBody?.toString('utf8'));
  }

  // POST /payments/webhooks/stripe — same idea, verified via
  // stripe-signature.
  @Post('webhooks/stripe')
  stripeWebhook(
    @Body() payload: StripeWebhookDto,
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.paymentsService.handleStripeCallback(payload, signature, req.rawBody?.toString('utf8'));
  }
}
