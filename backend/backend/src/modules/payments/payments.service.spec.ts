import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Payment, PaymentMethod, PaymentStatus } from '../../database/entities/payment.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { Role } from '../../database/entities/user-role.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { MpesaProvider } from './providers/mpesa.provider';
import { StripeProvider } from './providers/stripe.provider';
import { ShipmentsService } from '../shipments/shipments.service';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'payment-1', ...x })),
    findOne: jest.fn(),
    find: jest.fn(async (): Promise<Payment[]> => []),
  };
}

const CUSTOMER_ID = 'a5f3c111-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = 'a5f3c111-0000-4000-8000-000000000099';
const ADMIN_ID = 'a5f3c111-0000-4000-8000-000000000002';
const SHIPMENT_ID = 'b5f3c111-0000-4000-8000-000000000001';

function requester(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: CUSTOMER_ID, phone: '+255700000000', roles: [Role.CUSTOMER], ...overrides };
}

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: SHIPMENT_ID,
    customerId: CUSTOMER_ID,
    riderId: null,
    price: '8500.00',
    commission: '1700.00',
    riderPayout: '6800.00',
    ...overrides,
  } as Shipment;
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-1',
    shipmentId: SHIPMENT_ID,
    customerId: CUSTOMER_ID,
    method: PaymentMethod.MPESA,
    status: PaymentStatus.PROCESSING,
    amount: '8500.00',
    externalId: 'MPESA-abc',
    provider: 'MPESA',
    errorMessage: null,
    refundedAmount: '0.00',
    refundReason: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    failedAt: null,
    ...overrides,
  } as Payment;
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentsRepo: ReturnType<typeof mockRepo>;
  let shipmentsRepo: ReturnType<typeof mockRepo>;
  let mpesaProvider: { initiate: jest.Mock; refund: jest.Mock };
  let stripeProvider: { initiate: jest.Mock; refund: jest.Mock };
  let shipmentsService: { confirmAfterPayment: jest.Mock; isAssignedRiderOrAdmin: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let managerSave: jest.Mock;

  beforeEach(async () => {
    paymentsRepo = mockRepo();
    shipmentsRepo = mockRepo();
    mpesaProvider = {
      initiate: jest.fn(async () => ({ transactionId: 'MPESA-abc' })),
      refund: jest.fn(async () => ({ refundId: 'MPESA-REFUND-abc' })),
    };
    stripeProvider = {
      initiate: jest.fn(async () => ({ transactionId: 'STRIPE-abc' })),
      refund: jest.fn(async () => ({ refundId: 'STRIPE-REFUND-abc' })),
    };
    shipmentsService = {
      confirmAfterPayment: jest.fn(async () => undefined),
      isAssignedRiderOrAdmin: jest.fn(async () => true),
    };
    // Fake DataSource: transaction() just invokes the callback with a
    // manager whose save() records what it was called with (entity
    // class + payload) and returns the payload, same shape a real
    // manager.save() resolves to.
    managerSave = jest.fn(async (_entity: unknown, data: unknown) => data);
    dataSource = {
      transaction: jest.fn(async (cb: (manager: { save: jest.Mock }) => Promise<unknown>) =>
        cb({ save: managerSave }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentsRepo },
        { provide: getRepositoryToken(Shipment), useValue: shipmentsRepo },
        { provide: MpesaProvider, useValue: mpesaProvider },
        { provide: StripeProvider, useValue: stripeProvider },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
        { provide: ShipmentsService, useValue: shipmentsService },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('initiatePayment', () => {
    it('throws NotFoundException for an unknown shipment', async () => {
      shipmentsRepo.findOne.mockResolvedValue(undefined);

      await expect(
        service.initiatePayment(
          { shipmentId: SHIPMENT_ID, method: PaymentMethod.CASH },
          CUSTOMER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException for another customer's shipment", async () => {
      shipmentsRepo.findOne.mockResolvedValue(shipment());

      await expect(
        service.initiatePayment(
          { shipmentId: SHIPMENT_ID, method: PaymentMethod.CASH },
          OTHER_CUSTOMER_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the shipment has no price yet', async () => {
      shipmentsRepo.findOne.mockResolvedValue(shipment({ price: null }));

      await expect(
        service.initiatePayment(
          { shipmentId: SHIPMENT_ID, method: PaymentMethod.CASH },
          CUSTOMER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when an open payment already exists for the shipment', async () => {
      shipmentsRepo.findOne.mockResolvedValue(shipment());
      paymentsRepo.findOne.mockResolvedValue(payment({ status: PaymentStatus.PROCESSING }));

      await expect(
        service.initiatePayment(
          { shipmentId: SHIPMENT_ID, method: PaymentMethod.CASH },
          CUSTOMER_ID,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('marks a CASH payment PENDING_CASH_COLLECTION without calling a provider', async () => {
      shipmentsRepo.findOne.mockResolvedValue(shipment());
      paymentsRepo.findOne.mockResolvedValue(undefined);

      const result = await service.initiatePayment(
        { shipmentId: SHIPMENT_ID, method: PaymentMethod.CASH },
        CUSTOMER_ID,
      );

      expect(result.status).toBe(PaymentStatus.PENDING_CASH_COLLECTION);
      expect(mpesaProvider.initiate).not.toHaveBeenCalled();
      expect(stripeProvider.initiate).not.toHaveBeenCalled();
    });

    it('calls the M-Pesa provider and marks the payment PROCESSING on success', async () => {
      shipmentsRepo.findOne.mockResolvedValue(shipment());
      paymentsRepo.findOne.mockResolvedValue(undefined);

      const result = await service.initiatePayment(
        { shipmentId: SHIPMENT_ID, method: PaymentMethod.MPESA, phoneNumber: '255712345678' },
        CUSTOMER_ID,
      );

      expect(mpesaProvider.initiate).toHaveBeenCalledWith(
        '255712345678',
        '8500.00',
        SHIPMENT_ID,
      );
      expect(result.status).toBe(PaymentStatus.PROCESSING);
      expect(result.externalId).toBe('MPESA-abc');
    });

    it('marks the payment FAILED and rethrows when the provider call throws', async () => {
      shipmentsRepo.findOne.mockResolvedValue(shipment());
      paymentsRepo.findOne.mockResolvedValue(undefined);
      mpesaProvider.initiate.mockRejectedValue(new Error('sandbox timeout'));

      await expect(
        service.initiatePayment(
          { shipmentId: SHIPMENT_ID, method: PaymentMethod.MPESA, phoneNumber: '255712345678' },
          CUSTOMER_ID,
        ),
      ).rejects.toThrow(BadGatewayException);

      expect(paymentsRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: PaymentStatus.FAILED, errorMessage: 'sandbox timeout' }),
      );
    });
  });

  describe('checkStatus', () => {
    it('returns the payment for its owning customer', async () => {
      paymentsRepo.findOne.mockResolvedValue(payment());

      const result = await service.checkStatus('payment-1', requester());
      expect(result.id).toBe('payment-1');
    });

    it('allows an admin to view any payment', async () => {
      paymentsRepo.findOne.mockResolvedValue(payment());

      const result = await service.checkStatus(
        'payment-1',
        requester({ sub: ADMIN_ID, roles: [Role.ADMIN] }),
      );
      expect(result.id).toBe('payment-1');
    });

    it('throws ForbiddenException for a non-owning, non-admin caller', async () => {
      paymentsRepo.findOne.mockResolvedValue(payment());

      await expect(
        service.checkStatus('payment-1', requester({ sub: OTHER_CUSTOMER_ID })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for an unknown payment id', async () => {
      paymentsRepo.findOne.mockResolvedValue(undefined);

      await expect(service.checkStatus('missing', requester())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('refund', () => {
    it('throws ConflictException when the payment is not COMPLETED or PARTIALLY_REFUNDED', async () => {
      paymentsRepo.findOne.mockResolvedValue(payment({ status: PaymentStatus.PROCESSING }));

      await expect(
        service.refund('payment-1', { reason: 'customer request' }, requester()),
      ).rejects.toThrow(ConflictException);
    });

    it('defaults to a full refund of the remaining balance when amount is omitted', async () => {
      paymentsRepo.findOne.mockResolvedValue(
        payment({ status: PaymentStatus.COMPLETED, amount: '8500.00', refundedAmount: '0.00' }),
      );

      const result = await service.refund(
        'payment-1',
        { reason: 'customer request' },
        requester(),
      );

      expect(result.refundedAmount).toBe('8500.00');
      expect(result.status).toBe(PaymentStatus.REFUNDED);
    });

    it('marks PARTIALLY_REFUNDED when a partial amount is given', async () => {
      paymentsRepo.findOne.mockResolvedValue(
        payment({ status: PaymentStatus.COMPLETED, amount: '8500.00', refundedAmount: '0.00' }),
      );

      const result = await service.refund(
        'payment-1',
        { reason: 'partial damage', amount: 2000 },
        requester(),
      );

      expect(result.refundedAmount).toBe('2000.00');
      expect(result.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    });

    it('rejects a refund amount greater than the remaining balance', async () => {
      paymentsRepo.findOne.mockResolvedValue(
        payment({ status: PaymentStatus.COMPLETED, amount: '8500.00', refundedAmount: '5000.00' }),
      );

      await expect(
        service.refund('payment-1', { reason: 'too much', amount: 4000 }, requester()),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not call a provider for a CASH payment refund', async () => {
      paymentsRepo.findOne.mockResolvedValue(
        payment({
          method: PaymentMethod.CASH,
          status: PaymentStatus.COMPLETED,
          externalId: null,
        }),
      );

      await service.refund('payment-1', { reason: 'refused delivery' }, requester());

      expect(mpesaProvider.refund).not.toHaveBeenCalled();
      expect(stripeProvider.refund).not.toHaveBeenCalled();
    });
  });

  describe('confirmCashCollection', () => {
    it('rejects a non-CASH payment', async () => {
      paymentsRepo.findOne.mockResolvedValue(
        payment({ method: PaymentMethod.MPESA, status: PaymentStatus.PROCESSING }),
      );

      await expect(
        service.confirmCashCollection('payment-1', requester({ roles: [Role.RIDER] })),
      ).rejects.toThrow(ConflictException);
      expect(shipmentsService.isAssignedRiderOrAdmin).not.toHaveBeenCalled();
    });

    it('rejects a CASH payment that is not PENDING_CASH_COLLECTION or COMPLETED', async () => {
      paymentsRepo.findOne.mockResolvedValue(
        payment({ method: PaymentMethod.CASH, status: PaymentStatus.FAILED }),
      );

      await expect(
        service.confirmCashCollection('payment-1', requester({ roles: [Role.RIDER] })),
      ).rejects.toThrow(ConflictException);
    });

    it('is idempotent: a CASH payment already COMPLETED is returned as-is, no transaction run', async () => {
      const existing = payment({ method: PaymentMethod.CASH, status: PaymentStatus.COMPLETED });
      paymentsRepo.findOne.mockResolvedValue(existing);

      const result = await service.confirmCashCollection(
        'payment-1',
        requester({ roles: [Role.RIDER] }),
      );

      expect(result).toBe(existing);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(shipmentsService.isAssignedRiderOrAdmin).not.toHaveBeenCalled();
    });

    it('rejects a caller who is not the assigned rider or an admin', async () => {
      paymentsRepo.findOne.mockResolvedValue(
        payment({ method: PaymentMethod.CASH, status: PaymentStatus.PENDING_CASH_COLLECTION }),
      );
      shipmentsService.isAssignedRiderOrAdmin.mockResolvedValue(false);

      await expect(
        service.confirmCashCollection('payment-1', requester({ roles: [Role.RIDER] })),
      ).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('marks the payment COMPLETED, records who collected it, and confirms the shipment in one transaction', async () => {
      paymentsRepo.findOne.mockResolvedValue(
        payment({ method: PaymentMethod.CASH, status: PaymentStatus.PENDING_CASH_COLLECTION }),
      );
      shipmentsService.isAssignedRiderOrAdmin.mockResolvedValue(true);
      const collectingRider = requester({ sub: 'rider-user-1', roles: [Role.RIDER] });

      const result = await service.confirmCashCollection('payment-1', collectingRider);

      expect(shipmentsService.isAssignedRiderOrAdmin).toHaveBeenCalledWith(
        SHIPMENT_ID,
        collectingRider,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(managerSave).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          status: PaymentStatus.COMPLETED,
          metadata: expect.objectContaining({ cashCollectedBy: 'rider-user-1' }),
        }),
      );
      expect(shipmentsService.confirmAfterPayment).toHaveBeenCalledWith(
        SHIPMENT_ID,
        expect.anything(),
      );
      expect(result.status).toBe(PaymentStatus.COMPLETED);
    });
  });

  describe('handleMpesaCallback', () => {
    // Real Daraja shape — see MpesaWebhookDto / mpesa-callback.util.ts.
    // Kept minimal here (no unrelated CallbackMetadata items); the
    // parsing itself has its own dedicated tests in
    // mpesa-callback.util.spec.ts, so these only need to exercise
    // PaymentsService's own logic (lookup, status transitions,
    // idempotency, transaction boundaries).
    function daraja(overrides: {
      resultCode: number;
      resultDesc?: string;
      checkoutRequestId?: string;
    }) {
      return {
        Body: {
          stkCallback: {
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: overrides.checkoutRequestId ?? 'MPESA-abc',
            ResultCode: overrides.resultCode,
            ResultDesc: overrides.resultDesc ?? 'The service request is processed successfully.',
            ...(overrides.resultCode === 0
              ? {
                  CallbackMetadata: {
                    Item: [
                      { Name: 'Amount', Value: 8500 },
                      { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
                      { Name: 'TransactionDate', Value: 20261124101530 },
                      { Name: 'PhoneNumber', Value: 254708374149 },
                    ],
                  },
                }
              : {}),
          },
        },
      };
    }

    it('marks a PROCESSING payment COMPLETED on a successful callback, inside one transaction', async () => {
      paymentsRepo.findOne.mockResolvedValue(payment({ status: PaymentStatus.PROCESSING }));

      const result = await service.handleMpesaCallback(daraja({ resultCode: 0 }), undefined);

      expect(result).toEqual({ status: 'ok' });
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(managerSave).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({ status: PaymentStatus.COMPLETED }),
      );
      expect(shipmentsService.confirmAfterPayment).toHaveBeenCalledWith(
        SHIPMENT_ID,
        expect.anything(),
      );
    });

    it('marks a PROCESSING payment FAILED on a failed callback, without confirming the shipment', async () => {
      paymentsRepo.findOne.mockResolvedValue(payment({ status: PaymentStatus.PROCESSING }));

      await service.handleMpesaCallback(
        daraja({ resultCode: 1032, resultDesc: 'Request cancelled by user' }),
        undefined,
      );

      expect(managerSave).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          status: PaymentStatus.FAILED,
          errorMessage: 'Request cancelled by user',
        }),
      );
      expect(shipmentsService.confirmAfterPayment).not.toHaveBeenCalled();
    });

    it('is idempotent: a second callback for an already-COMPLETED payment is a no-op', async () => {
      paymentsRepo.findOne.mockResolvedValue(payment({ status: PaymentStatus.COMPLETED }));

      await service.handleMpesaCallback(daraja({ resultCode: 0 }), undefined);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(shipmentsService.confirmAfterPayment).not.toHaveBeenCalled();
    });

    it('acks a callback for an unknown transaction id without throwing', async () => {
      paymentsRepo.findOne.mockResolvedValue(undefined);

      const result = await service.handleMpesaCallback(
        daraja({ resultCode: 0, checkoutRequestId: 'MPESA-unknown' }),
        undefined,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(shipmentsService.confirmAfterPayment).not.toHaveBeenCalled();
    });

    it('stores the M-Pesa receipt number from CallbackMetadata on success', async () => {
      paymentsRepo.findOne.mockResolvedValue(payment({ status: PaymentStatus.PROCESSING }));

      await service.handleMpesaCallback(daraja({ resultCode: 0 }), undefined);

      expect(managerSave).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          metadata: expect.objectContaining({ mpesaReceiptNumber: 'NLJ7RT61SV' }),
        }),
      );
    });
  });

  describe('handleStripeCallback', () => {
    it('marks a payment COMPLETED on payment_intent.succeeded, inside one transaction', async () => {
      paymentsRepo.findOne.mockResolvedValue(
        payment({ status: PaymentStatus.PROCESSING, externalId: 'STRIPE-abc' }),
      );

      await service.handleStripeCallback(
        { type: 'payment_intent.succeeded', data: { object: { id: 'STRIPE-abc' } } },
        undefined,
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(managerSave).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({ status: PaymentStatus.COMPLETED }),
      );
      expect(shipmentsService.confirmAfterPayment).toHaveBeenCalledWith(
        SHIPMENT_ID,
        expect.anything(),
      );
    });

    it('ignores unrecognized event types', async () => {
      paymentsRepo.findOne.mockResolvedValue(
        payment({ status: PaymentStatus.PROCESSING, externalId: 'STRIPE-abc' }),
      );

      const result = await service.handleStripeCallback(
        { type: 'customer.created', data: { object: { id: 'STRIPE-abc' } } },
        undefined,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(shipmentsService.confirmAfterPayment).not.toHaveBeenCalled();
    });

    it('does not confirm the shipment on payment_intent.payment_failed', async () => {
      paymentsRepo.findOne.mockResolvedValue(
        payment({ status: PaymentStatus.PROCESSING, externalId: 'STRIPE-abc' }),
      );

      await service.handleStripeCallback(
        { type: 'payment_intent.payment_failed', data: { object: { id: 'STRIPE-abc' } } },
        undefined,
      );

      expect(managerSave).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({ status: PaymentStatus.FAILED }),
      );
      expect(shipmentsService.confirmAfterPayment).not.toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    it('rejects a malformed date', async () => {
      await expect(service.reconcile('not-a-date')).rejects.toThrow(BadRequestException);
    });

    it('aggregates totals across the payments returned for the day', async () => {
      paymentsRepo.find.mockResolvedValue([
        payment({ method: PaymentMethod.MPESA, amount: '8500.00', refundedAmount: '0.00' }),
        payment({ method: PaymentMethod.CASH, amount: '5000.00', refundedAmount: '1000.00' }),
      ]);

      const report = await service.reconcile('2026-08-19');

      expect(report.paymentsCompleted).toBe(2);
      expect(report.totalAmount).toBe('13500.00');
      expect(report.totalRefunded).toBe('1000.00');
      expect(report.byMethod[PaymentMethod.MPESA].count).toBe(1);
      expect(report.byMethod[PaymentMethod.CASH].totalAmount).toBe('5000.00');
    });
  });
});
