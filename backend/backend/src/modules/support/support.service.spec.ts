import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportTicket, TicketStatus } from '../../database/entities/support-ticket.entity';
import { SupportTicketMessage } from '../../database/entities/support-ticket-message.entity';
import { Role } from '../../database/entities/user-role.entity';

function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'row-1', ...x })),
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
  };
}

const CUSTOMER_ID = 'a5f3c111-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = 'a5f3c111-0000-4000-8000-000000000099';
const ADMIN_ID = 'a5f3c111-0000-4000-8000-0000000000ad';
const TICKET_ID = 'c5f3c111-0000-4000-8000-000000000001';

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: TICKET_ID,
    raisedByUserId: CUSTOMER_ID,
    raisedByRole: Role.CUSTOMER,
    shipmentId: null,
    subject: 'My parcel is late',
    category: undefined,
    priority: undefined,
    status: TicketStatus.OPEN,
    assignedAdminId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  } as SupportTicket;
}

describe('SupportService', () => {
  let service: SupportService;
  let ticketRepo: ReturnType<typeof mockRepo>;
  let messageRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    ticketRepo = mockRepo();
    messageRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: getRepositoryToken(SupportTicket), useValue: ticketRepo },
        { provide: getRepositoryToken(SupportTicketMessage), useValue: messageRepo },
      ],
    }).compile();

    service = module.get(SupportService);
  });

  describe('create', () => {
    it('creates a ticket and its first message, snapshotting the raiser role', async () => {
      const result = await service.create(CUSTOMER_ID, [Role.CUSTOMER], {
        subject: 'My parcel is late',
        message: 'It has been 3 hours',
      } as any);

      expect(ticketRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ raisedByUserId: CUSTOMER_ID, raisedByRole: Role.CUSTOMER }),
      );
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'It has been 3 hours', isInternalNote: false }),
      );
      expect(result.messages).toHaveLength(1);
    });
  });

  describe('getOwn / findOwnedOrThrow', () => {
    it('throws NotFoundException for an unknown id', async () => {
      ticketRepo.findOne.mockResolvedValue(null);
      await expect(service.getOwn(CUSTOMER_ID, TICKET_ID)).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when the ticket isn't the caller's own", async () => {
      ticketRepo.findOne.mockResolvedValue(ticket({ raisedByUserId: OTHER_CUSTOMER_ID }));
      await expect(service.getOwn(CUSTOMER_ID, TICKET_ID)).rejects.toThrow(ForbiddenException);
    });

    it('excludes internal notes from the owner-facing thread', async () => {
      ticketRepo.findOne.mockResolvedValue(ticket());
      messageRepo.find.mockResolvedValue([]);
      await service.getOwn(CUSTOMER_ID, TICKET_ID);
      expect(messageRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isInternalNote: false }) }),
      );
    });
  });

  describe('replyOwn', () => {
    it('rejects a reply on a CLOSED ticket', async () => {
      ticketRepo.findOne.mockResolvedValue(ticket({ status: TicketStatus.CLOSED }));
      await expect(
        service.replyOwn(CUSTOMER_ID, TICKET_ID, [Role.CUSTOMER], { message: 'hello' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('reopens a RESOLVED ticket back to OPEN on reply', async () => {
      const t = ticket({ status: TicketStatus.RESOLVED });
      ticketRepo.findOne.mockResolvedValue(t);
      await service.replyOwn(CUSTOMER_ID, TICKET_ID, [Role.CUSTOMER], { message: 'still broken' });
      expect(ticketRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: TicketStatus.OPEN }),
      );
    });
  });

  describe('update', () => {
    it('stamps resolvedAt when status moves to RESOLVED, and clears it on the way back out', async () => {
      ticketRepo.findOne.mockResolvedValue(ticket());
      const resolved = await service.update(TICKET_ID, { status: TicketStatus.RESOLVED } as any);
      expect(resolved.resolvedAt).toBeInstanceOf(Date);

      ticketRepo.findOne.mockResolvedValue(ticket({ status: TicketStatus.RESOLVED, resolvedAt: new Date() }));
      const reopened = await service.update(TICKET_ID, { status: TicketStatus.OPEN } as any);
      expect(reopened.resolvedAt).toBeNull();
    });
  });

  describe('addAdminMessage', () => {
    it('records an internal note as such and attributes it to the acting admin role', async () => {
      ticketRepo.findOne.mockResolvedValue(ticket());
      await service.addAdminMessage(ADMIN_ID, TICKET_ID, [Role.ADMIN], {
        message: 'checking with rider',
        isInternalNote: true,
      });
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ authorId: ADMIN_ID, authorRole: Role.ADMIN, isInternalNote: true }),
      );
    });
  });
});
