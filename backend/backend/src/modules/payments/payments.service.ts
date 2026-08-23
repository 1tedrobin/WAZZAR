import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, Repository } from 'typeorm';
import { Payment, PaymentMethod, PaymentStatus } from '../../database/entities/payment.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { Role } from '../../database/entities/user-role.entity';
import { centsFromDecimal, decimalFromCents } from '../../common/money';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { ShipmentsService } from '../shipments/shipments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { MpesaWebhookDto } from './dto/mpesa-webhook.dto';
import { PaymentHistoryQueryDto } from './dto/payment-history-query.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { StripeWebhookDto } from './dto/stripe-webhook.dto';
import { MpesaProvider } from './providers/mpesa.provider';
import { StripeProvider } from './providers/stripe.provider';
import { getStripeClient } from './providers/stripe-client';
import { verifyWebhookSignature } from './webhook-signature';
import { parseMpesaCallback } from './mpesa-callback.util';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN];

// Payment states a shipment can't have two payments open in at once —
// a second initiate() call while one of these is outstanding almost
// always means the client retried an in-flight request, not a genuine
// second payment for the same delivery.
const OPEN_PAYMENT_STATUSES = [
  PaymentStatus.PENDING,
  PaymentStatus.PROCESSING,
  PaymentStatus.COMPLETED,
  PaymentStatus.PENDING_CASH_COLLECTION,
];

export interface ReconciliationReport {
  date: string;
  paymentsCompleted: number;
  totalAmount: string;
  totalRefunded: string;
  byMethod: Record<PaymentMethod, { count: number; totalAmount: string }>;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentsRepo: Repository<Payment>,
    @InjectRepository(Shipment)
    private readonly shipmentsRepo: Repository<Shipment>,
    private readonly mpesaProvider: MpesaProvider,
    private readonly stripeProvider: StripeProvider,
    private readonly configService: ConfigService,
    private readonly shipmentsService: ShipmentsService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async initiatePayment(dto: InitiatePaymentDto, customerId: string): Promise<Payment> {
    const shipment = await this.shipmentsRepo.findOne({ where: { id: dto.shipmentId } });
    if (!shipment) {
      throw new NotFoundException(`Shipment ${dto.shipmentId} not found`);
    }
    if (shipment.customerId !== customerId) {
      throw new ForbiddenException('You do not have access to this shipment');
    }
    if (!shipment.price) {
      throw new BadRequestException('Shipment has not been priced yet');
    }

    const existing = await this.paymentsRepo.findOne({
      where: { shipmentId: shipment.id, status: In(OPEN_PAYMENT_STATUSES) },
    });
    if (existing) {
      throw new ConflictException(
        `Shipment ${shipment.id} already has a payment in status ${existing.status}`,
      );
    }

    const payment = await this.paymentsRepo.save(
      this.paymentsRepo.create({
        shipmentId: shipment.id,
        customerId,
        method: dto.method,
        status: PaymentStatus.PENDING,
        amount: shipment.price,
        provider: dto.method,
      }),
    );

    if (dto.method === PaymentMethod.CASH) {
      payment.status = PaymentStatus.PENDING_CASH_COLLECTION;
      return this.paymentsRepo.save(payment);
    }

    try {
      const result = await this.callProviderInitiate(dto, payment);
      payment.status = PaymentStatus.PROCESSING;
      payment.externalId = result.transactionId;
      return await this.paymentsRepo.save(payment);
    } catch (err) {
      payment.status = PaymentStatus.FAILED;
      payment.errorMessage = err instanceof Error ? err.message : 'Provider error';
      payment.failedAt = new Date();
      await this.paymentsRepo.save(payment);
      throw new BadGatewayException(
        `${dto.method} provider failed to initiate payment: ${payment.errorMessage}`,
      );
    }
  }

  async checkStatus(id: string, requester: JwtPayload): Promise<Payment> {
    const payment = await this.findByIdOrThrow(id);
    this.assertCanAccess(payment, requester);
    return payment;
  }

  // POST /payments/:id/collect-cash — the rider assigned to the shipment
  // (or an admin) confirms a CASH payment was physically collected.
  // Mirrors the M-Pesa/Stripe webhooks in shape (mark COMPLETED, then
  // run the shipment's QUOTED -> CONFIRMED transition in the same
  // transaction) but is a direct call rather than a provider callback,
  // since CASH never goes through a provider — see Piece 12 in the
  // README for why this path was missing until now.
  //
  // Idempotent like the webhooks: a payment already COMPLETED (e.g. a
  // retried request) is a no-op, not an error. Anything else — wrong
  // method, or a status that isn't PENDING_CASH_COLLECTION or COMPLETED
  // (FAILED, REFUNDED, ...) — is a genuine conflict and throws.
  async confirmCashCollection(id: string, requester: JwtPayload): Promise<Payment> {
    const payment = await this.findByIdOrThrow(id);

    if (payment.method !== PaymentMethod.CASH) {
      throw new ConflictException(
        `Payment ${id} is a ${payment.method} payment, not CASH`,
      );
    }
    if (payment.status === PaymentStatus.COMPLETED) {
      return payment;
    }
    if (payment.status !== PaymentStatus.PENDING_CASH_COLLECTION) {
      throw new ConflictException(
        `Cannot confirm cash collection for a payment in status ${payment.status}`,
      );
    }

    const canCollect = await this.shipmentsService.isAssignedRiderOrAdmin(
      payment.shipmentId,
      requester,
    );
    if (!canCollect) {
      throw new ForbiddenException(
        'Only the rider assigned to this shipment, or an admin, can confirm cash collection',
      );
    }

    payment.status = PaymentStatus.COMPLETED;
    payment.completedAt = new Date();
    payment.metadata = { ...(payment.metadata ?? {}), cashCollectedBy: requester.sub };

    // Same one-transaction pattern as the webhook handlers: the payment
    // write and the shipment's QUOTED -> CONFIRMED transition commit
    // together or not at all.
    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(Payment, payment);
      await this.shipmentsService.confirmAfterPayment(payment.shipmentId, manager);
      return saved;
    });
  }

  async getHistory(
    customerId: string,
    query: PaymentHistoryQueryDto,
  ): Promise<Payment[]> {
    return this.paymentsRepo.find({
      where: {
        customerId,
        ...(query.status ? { status: query.status } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit,
      skip: query.offset,
    });
  }

  async refund(
    id: string,
    dto: RefundPaymentDto,
    requester: JwtPayload,
  ): Promise<Payment> {
    const payment = await this.findByIdOrThrow(id);
    this.assertCanAccess(payment, requester);

    if (
      payment.status !== PaymentStatus.COMPLETED &&
      payment.status !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new ConflictException(
        `Cannot refund a payment in status ${payment.status}`,
      );
    }

    const remainingCents =
      centsFromDecimal(payment.amount) - centsFromDecimal(payment.refundedAmount);
    const requestedCents =
      dto.amount !== undefined ? centsFromDecimal(dto.amount) : remainingCents;

    if (requestedCents <= 0 || requestedCents > remainingCents) {
      throw new BadRequestException(
        `Refund amount must be between 0.01 and ${decimalFromCents(remainingCents)} (the remaining refundable balance)`,
      );
    }

    if (payment.method !== PaymentMethod.CASH && payment.externalId) {
      // Let a provider error surface as-is (BadGatewayException isn't
      // forced here, unlike initiate) — refunds are rarer and an admin
      // is usually driving this, so the raw error is more useful than a
      // generic wrapper.
      await this.callProviderRefund(payment, decimalFromCents(requestedCents));
    }

    payment.refundedAmount = decimalFromCents(
      centsFromDecimal(payment.refundedAmount) + requestedCents,
    );
    payment.refundReason = dto.reason;
    payment.status =
      centsFromDecimal(payment.refundedAmount) >= centsFromDecimal(payment.amount)
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;

    return this.paymentsRepo.save(payment);
  }

  // Idempotent: a payment already in a terminal state (COMPLETED/FAILED)
  // is left untouched and this just returns ok, so a provider retrying
  // the same callback can never double-process it.
  async handleMpesaCallback(
    payload: MpesaWebhookDto,
    signature: string | undefined,
    rawBody?: string,
  ): Promise<{ status: string }> {
    if (
      !verifyWebhookSignature(
        rawBody ?? JSON.stringify(payload),
        signature,
        this.configService.get<string>('MPESA_WEBHOOK_SECRET'),
      )
    ) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    // payload is the real, deeply-nested Daraja shape — see
    // MpesaWebhookDto's header comment. parseMpesaCallback flattens it
    // to just what this method needs; nothing below reads payload's
    // raw fields directly.
    const parsed = parseMpesaCallback(payload);

    const payment = await this.paymentsRepo.findOne({
      where: { externalId: parsed.transactionId },
    });
    if (!payment) {
      // Nothing we can do with a callback for a transaction we never
      // initiated — ack it anyway so the provider stops retrying.
      return { status: 'ok' };
    }
    if (payment.status === PaymentStatus.COMPLETED || payment.status === PaymentStatus.FAILED) {
      return { status: 'ok' };
    }

    if (parsed.success) {
      payment.status = PaymentStatus.COMPLETED;
      payment.completedAt = new Date();

      // Daraja is the source of truth for whether the payment happened
      // at all — this never blocks completing the payment — but a
      // mismatch between what we asked for and what was actually paid
      // would otherwise pass through completely silently. Worth a loud
      // log for someone to investigate, not worth failing the webhook
      // over (the money did move; refusing to record that would be
      // worse).
      if (parsed.amount !== undefined && centsFromDecimal(payment.amount) !== centsFromDecimal(parsed.amount)) {
        this.logger.warn(
          `M-Pesa callback amount mismatch for payment ${payment.id}: expected ${payment.amount}, Daraja reported ${parsed.amount}`,
        );
      }
    } else {
      payment.status = PaymentStatus.FAILED;
      payment.errorMessage = parsed.resultDesc || 'M-Pesa reported payment failure';
      payment.failedAt = new Date();
    }
    payment.metadata = {
      ...(payment.metadata ?? {}),
      lastMpesaCallback: payload,
      ...(parsed.mpesaReceiptNumber ? { mpesaReceiptNumber: parsed.mpesaReceiptNumber } : {}),
    };

    // Single transaction: the payment write and (when successful) the
    // shipment's QUOTED -> CONFIRMED transition + its history row commit
    // together or not at all. First dataSource.transaction() call in
    // this codebase — see README Piece 12.
    await this.dataSource.transaction(async (manager) => {
      await manager.save(Payment, payment);
      if (parsed.success) {
        await this.shipmentsService.confirmAfterPayment(payment.shipmentId, manager);
      }
    });

    return { status: 'ok' };
  }

  async handleStripeCallback(
    payload: StripeWebhookDto,
    signature: string | undefined,
    rawBody?: string,
  ): Promise<{ status: string }> {
    const stripeWebhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

    // A real Stripe webhook secret (always prefixed `whsec_`) means real
    // Stripe traffic is expected — verify it the way Stripe actually
    // signs (HMAC over `${timestamp}.${rawBody}` with rotating
    // signature versions), not the simplified generic HMAC scheme below,
    // which cannot validate a genuine Stripe signature. Requires
    // rawBody (see main.ts's `rawBody: true` and the controller) — if
    // that's somehow missing, fail closed rather than silently
    // downgrading to the weaker check.
    if (stripeWebhookSecret?.startsWith('whsec_')) {
      if (!rawBody) {
        throw new ForbiddenException('Missing raw request body for Stripe signature verification');
      }
      try {
        getStripeClient(this.configService).webhooks.constructEvent(
          rawBody,
          signature ?? '',
          stripeWebhookSecret,
        );
      } catch {
        throw new ForbiddenException('Invalid webhook signature');
      }
    } else if (
      !verifyWebhookSignature(rawBody ?? JSON.stringify(payload), signature, stripeWebhookSecret)
    ) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    const externalId = payload.data?.object?.id as string | undefined;
    if (!externalId) {
      return { status: 'ok' };
    }

    const payment = await this.paymentsRepo.findOne({ where: { externalId } });
    if (!payment) {
      return { status: 'ok' };
    }

    switch (payload.type) {
      case 'payment_intent.succeeded':
        if (payment.status === PaymentStatus.COMPLETED) return { status: 'ok' };
        payment.status = PaymentStatus.COMPLETED;
        payment.completedAt = new Date();
        break;
      case 'payment_intent.payment_failed':
        if (payment.status === PaymentStatus.FAILED) return { status: 'ok' };
        payment.status = PaymentStatus.FAILED;
        payment.errorMessage = 'Stripe reported payment failure';
        payment.failedAt = new Date();
        break;
      case 'charge.refunded':
        // amount_refunded is in Stripe's smallest currency unit (cents
        // for TZS-equivalent 2-decimal currencies); no-op if absent.
        {
          const refundedMinorUnits = payload.data.object.amount_refunded as
            | number
            | undefined;
          if (typeof refundedMinorUnits === 'number') {
            payment.refundedAmount = decimalFromCents(refundedMinorUnits);
            payment.status =
              refundedMinorUnits >= centsFromDecimal(payment.amount)
                ? PaymentStatus.REFUNDED
                : PaymentStatus.PARTIALLY_REFUNDED;
          }
        }
        break;
      default:
        return { status: 'ok' };
    }

    payment.metadata = { ...(payment.metadata ?? {}), lastStripeEvent: payload.type };

    // Same reasoning as the M-Pesa handler above: one transaction for
    // the payment write and (on success) the shipment confirmation.
    await this.dataSource.transaction(async (manager) => {
      await manager.save(Payment, payment);
      if (payload.type === 'payment_intent.succeeded') {
        await this.shipmentsService.confirmAfterPayment(payment.shipmentId, manager);
      }
    });

    return { status: 'ok' };
  }

  async reconcile(date: string): Promise<ReconciliationReport> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('date must be an ISO date, e.g. 2026-08-19');
    }

    const payments = await this.paymentsRepo.find({
      where: { completedAt: Between(start, end) },
    });

    const byMethod: ReconciliationReport['byMethod'] = {
      [PaymentMethod.MPESA]: { count: 0, totalAmount: '0.00' },
      [PaymentMethod.STRIPE]: { count: 0, totalAmount: '0.00' },
      [PaymentMethod.CASH]: { count: 0, totalAmount: '0.00' },
    };

    let totalCents = 0;
    let totalRefundedCents = 0;

    for (const payment of payments) {
      totalCents += centsFromDecimal(payment.amount);
      totalRefundedCents += centsFromDecimal(payment.refundedAmount);

      const bucket = byMethod[payment.method];
      bucket.count += 1;
      bucket.totalAmount = decimalFromCents(
        centsFromDecimal(bucket.totalAmount) + centsFromDecimal(payment.amount),
      );
    }

    return {
      date,
      paymentsCompleted: payments.length,
      totalAmount: decimalFromCents(totalCents),
      totalRefunded: decimalFromCents(totalRefundedCents),
      byMethod,
    };
  }

  private async callProviderInitiate(dto: InitiatePaymentDto, payment: Payment) {
    if (dto.method === PaymentMethod.MPESA) {
      return this.mpesaProvider.initiate(dto.phoneNumber!, payment.amount, payment.shipmentId);
    }
    return this.stripeProvider.initiate(payment.customerId, payment.amount, dto.cardToken!);
  }

  private async callProviderRefund(payment: Payment, amount: string) {
    if (payment.method === PaymentMethod.MPESA) {
      return this.mpesaProvider.refund(payment.externalId!, amount);
    }
    return this.stripeProvider.refund(payment.externalId!, amount);
  }

  private async findByIdOrThrow(id: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { id } });
    if (!payment) {
      throw new NotFoundException(`Payment ${id} not found`);
    }
    return payment;
  }

  // Owner (the customer who initiated it) or an admin — no rider access,
  // unlike shipments: a rider doesn't need to see the customer's payment
  // details to fulfil a delivery.
  private assertCanAccess(payment: Payment, requester: JwtPayload): void {
    if (payment.customerId === requester.sub) return;
    if (requester.roles.some((role) => ADMIN_ROLES.includes(role))) return;
    throw new ForbiddenException('You do not have access to this payment');
  }
}
