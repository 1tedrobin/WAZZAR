import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { Invoice } from '../../database/entities/invoice.entity';
import { InvoiceLineItem } from '../../database/entities/invoice-line-item.entity';
import { Payment, PaymentStatus, PaymentMethod } from '../../database/entities/payment.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x: any) => (Array.isArray(x) ? x.map((r, i) => ({ id: `row-${i}`, ...r })) : { id: 'row-1', ...x })),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };
}

const BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000001';
const OTHER_BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000099';
const SHIPMENT_ID = 'd5f3c111-0000-4000-8000-000000000001';
const PAYMENT_ID = 'e5f3c111-0000-4000-8000-000000000001';
const INVOICE_ID = 'f5f3c111-0000-4000-8000-000000000001';

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: PAYMENT_ID,
    shipmentId: SHIPMENT_ID,
    customerId: BUSINESS_ID,
    method: PaymentMethod.MPESA,
    status: PaymentStatus.COMPLETED,
    amount: '5000.00',
    externalId: 'MPESA-abc',
    provider: 'mpesa',
    errorMessage: null,
    refundedAmount: '0.00',
    refundReason: null,
    metadata: null,
    createdAt: new Date('2026-06-10T10:00:00Z'),
    updatedAt: new Date('2026-06-10T10:05:00Z'),
    completedAt: new Date('2026-06-10T10:05:00Z'),
    failedAt: null,
    ...overrides,
  } as Payment;
}

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: SHIPMENT_ID,
    customerId: BUSINESS_ID,
    riderId: null,
    status: ShipmentStatus.COMPLETED,
    pickupLocation: { latitude: -6.8, longitude: 39.28, address: 'Mikocheni B, Dar es Salaam' },
    dropoffLocation: { latitude: -6.81, longitude: 39.29, address: 'CBD, Dar es Salaam' },
    packageWeightKg: null,
    packageDescription: null,
    price: '5000.00',
    commission: '750.00',
    riderPayout: '4250.00',
    riderRating: null,
    createdAt: new Date('2026-06-10T09:00:00Z'),
    updatedAt: new Date('2026-06-10T10:05:00Z'),
    completedAt: new Date('2026-06-10T10:05:00Z'),
    ...overrides,
  } as Shipment;
}

function invoiceRow(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: INVOICE_ID,
    businessId: BUSINESS_ID,
    invoiceNumber: 'INV-2026-0001',
    periodStart: '2026-06-01',
    periodEnd: '2026-06-30',
    subtotalAmount: '5000.00',
    taxRatePercent: '0.00',
    taxAmount: '0.00',
    totalAmount: '5000.00',
    currency: 'TZS',
    shipmentCount: 1,
    createdAt: new Date('2026-07-01T08:00:00Z'),
    ...overrides,
  } as Invoice;
}

describe('InvoicesService', () => {
  let service: InvoicesService;
  let invoicesRepo: ReturnType<typeof mockRepo>;
  let lineItemsRepo: ReturnType<typeof mockRepo>;
  let paymentsRepo: ReturnType<typeof mockRepo>;
  let shipmentsRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    invoicesRepo = mockRepo();
    lineItemsRepo = mockRepo();
    paymentsRepo = mockRepo();
    shipmentsRepo = mockRepo();

    const dataSource = {
      transaction: jest.fn(async (cb) =>
        cb({
          getRepository: (entity: unknown) => {
            if (entity === Invoice) return invoicesRepo;
            if (entity === InvoiceLineItem) return lineItemsRepo;
            throw new Error('Unexpected repo requested in transaction');
          },
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: getRepositoryToken(Invoice), useValue: invoicesRepo },
        { provide: getRepositoryToken(InvoiceLineItem), useValue: lineItemsRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepo },
        { provide: getRepositoryToken(Shipment), useValue: shipmentsRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = module.get(InvoicesService);
  });

  describe('generate', () => {
    it('throws BadRequestException when periodStart is after periodEnd', async () => {
      await expect(
        service.generate(BUSINESS_ID, { periodStart: '2026-06-30', periodEnd: '2026-06-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when there are no eligible payments', async () => {
      paymentsRepo.find.mockResolvedValue([]);

      await expect(
        service.generate(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-30' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('excludes payments already attached to a prior invoice', async () => {
      lineItemsRepo.find.mockResolvedValue([{ paymentId: PAYMENT_ID }]);
      paymentsRepo.find.mockResolvedValue([]);

      await expect(
        service.generate(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-30' }),
      ).rejects.toThrow(BadRequestException);

      const queryArg = paymentsRepo.find.mock.calls[0][0];
      expect(queryArg.where.id).toBeDefined();
    });

    it('computes subtotal/tax/total in cents and snapshots line items', async () => {
      paymentsRepo.find.mockResolvedValue([payment(), payment({ id: 'e5f3c111-0000-4000-8000-000000000002', amount: '3000.50' })]);
      shipmentsRepo.find.mockResolvedValue([shipment()]);

      const result = await service.generate(BUSINESS_ID, {
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        taxRatePercent: 18,
      });

      // subtotal = 5000.00 + 3000.50 = 8000.50; tax = 18% = 1440.09 (rounded); total = 9440.59
      const savedInvoiceArg = invoicesRepo.create.mock.calls[0][0];
      expect(savedInvoiceArg.subtotalAmount).toBe('8000.50');
      expect(savedInvoiceArg.taxAmount).toBe('1440.09');
      expect(savedInvoiceArg.totalAmount).toBe('9440.59');
      expect(savedInvoiceArg.shipmentCount).toBe(2);
      expect(result.lineItems).toBeDefined();
    });

    it('builds a "Delivery — X to Y" description from the shipment addresses', async () => {
      paymentsRepo.find.mockResolvedValue([payment()]);
      shipmentsRepo.find.mockResolvedValue([shipment()]);

      await service.generate(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-30' });

      const lineItemArgs = lineItemsRepo.create.mock.calls;
      expect(lineItemArgs[0][0].description).toBe('Delivery — Mikocheni B to CBD');
    });

    it('numbers the invoice INV-{year}-{seq} based on this business\'s existing count', async () => {
      paymentsRepo.find.mockResolvedValue([payment()]);
      shipmentsRepo.find.mockResolvedValue([shipment()]);
      invoicesRepo.count.mockResolvedValue(6);

      await service.generate(BUSINESS_ID, { periodStart: '2026-06-01', periodEnd: '2026-06-30' });

      const savedInvoiceArg = invoicesRepo.create.mock.calls[0][0];
      expect(savedInvoiceArg.invoiceNumber).toMatch(/^INV-\d{4}-0007$/);
    });
  });

  describe('list', () => {
    it('returns only the calling business\'s own invoices, newest first', async () => {
      invoicesRepo.find.mockResolvedValue([invoiceRow()]);

      const result = await service.list(BUSINESS_ID);

      expect(invoicesRepo.find).toHaveBeenCalledWith({
        where: { businessId: BUSINESS_ID },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('returns an owned invoice with its line items', async () => {
      invoicesRepo.findOne.mockResolvedValue(invoiceRow());
      lineItemsRepo.find.mockResolvedValue([{ id: 'li-1', invoiceId: INVOICE_ID }]);

      const result = await service.findOne(BUSINESS_ID, INVOICE_ID);

      expect(result.lineItems).toHaveLength(1);
    });

    it('throws NotFoundException for a nonexistent invoice', async () => {
      invoicesRepo.findOne.mockResolvedValue(undefined);

      await expect(service.findOne(BUSINESS_ID, INVOICE_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for another business\'s invoice', async () => {
      invoicesRepo.findOne.mockResolvedValue(invoiceRow({ businessId: OTHER_BUSINESS_ID }));

      await expect(service.findOne(BUSINESS_ID, INVOICE_ID)).rejects.toThrow(ForbiddenException);
    });
  });
});
