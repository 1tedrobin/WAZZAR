import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { SupportTicketMessage } from '../../database/entities/support-ticket-message.entity';
import { SupportTicket, TicketStatus } from '../../database/entities/support-ticket.entity';
import { Role } from '../../database/entities/user-role.entity';
import { AddMessageDto } from './dto/add-message.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListMyTicketsQueryDto } from './dto/list-my-tickets-query.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

export interface TicketWithMessages {
  ticket: SupportTicket;
  messages: SupportTicketMessage[];
}

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(SupportTicketMessage)
    private readonly messageRepo: Repository<SupportTicketMessage>,
  ) {}

  // Called from both the ticket-owner create route and nowhere else —
  // raisedByRole is a snapshot of the caller's primary role at creation
  // time (see JwtPayload.roles), not a live lookup, so it can't drift if
  // the user's roles change later. A user with multiple roles (there's
  // no such case today, but the schema allows it) is recorded under
  // whichever role happens to be first in the token.
  async create(userId: string, roles: Role[], dto: CreateTicketDto): Promise<TicketWithMessages> {
    const ticket = await this.ticketRepo.save(
      this.ticketRepo.create({
        raisedByUserId: userId,
        raisedByRole: roles[0],
        shipmentId: dto.shipmentId ?? null,
        subject: dto.subject,
        category: dto.category,
        assignedAdminId: null,
        resolvedAt: null,
        closedAt: null,
      }),
    );
    const message = await this.messageRepo.save(
      this.messageRepo.create({
        ticketId: ticket.id,
        authorId: userId,
        authorRole: roles[0],
        message: dto.message,
        isInternalNote: false,
      }),
    );
    return { ticket, messages: [message] };
  }

  // Owner-scoped list — GET /support/tickets.
  async listOwn(userId: string, query: ListMyTicketsQueryDto): Promise<SupportTicket[]> {
    return this.ticketRepo.find({
      where: { raisedByUserId: userId, ...(query.status ? { status: query.status } : {}) },
      order: { createdAt: 'DESC' },
    });
  }

  // Owner-scoped detail — GET /support/tickets/:id. Internal notes are
  // filtered out here; that's the whole point of the flag.
  async getOwn(userId: string, id: string): Promise<TicketWithMessages> {
    const ticket = await this.findOwnedOrThrow(userId, id);
    const messages = await this.messageRepo.find({
      where: { ticketId: id, isInternalNote: false },
      order: { createdAt: 'ASC' },
    });
    return { ticket, messages };
  }

  // Owner reply — POST /support/tickets/:id/messages. A CLOSED ticket
  // can't be replied to (the ticket-owner's way to reopen is a new
  // ticket, or an admin can PATCH it back to OPEN) — everything short of
  // CLOSED accepts a reply, and RESOLVED->OPEN happens implicitly so a
  // reply after "resolved" actually gets seen instead of sitting under a
  // status the admin queue may be filtering out.
  async replyOwn(userId: string, id: string, roles: Role[], dto: AddMessageDto): Promise<SupportTicketMessage> {
    const ticket = await this.findOwnedOrThrow(userId, id);
    if (ticket.status === TicketStatus.CLOSED) {
      throw new ForbiddenException('This ticket is closed. Open a new ticket instead.');
    }
    if (ticket.status === TicketStatus.RESOLVED) {
      ticket.status = TicketStatus.OPEN;
      await this.ticketRepo.save(ticket);
    }
    return this.messageRepo.save(
      this.messageRepo.create({
        ticketId: id,
        authorId: userId,
        authorRole: roles[0],
        message: dto.message,
        isInternalNote: false,
      }),
    );
  }

  // Admin list — GET /support/admin/tickets. No ownership scoping;
  // access is gated entirely by @Roles(ADMIN, SUPER_ADMIN) on the route.
  async listAll(query: ListTicketsQueryDto): Promise<{ tickets: SupportTicket[]; total: number }> {
    const where: FindOptionsWhere<SupportTicket> = {};
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.priority) where.priority = query.priority;
    if (query.assignedAdminId) where.assignedAdminId = query.assignedAdminId;

    const [tickets, total] = await this.ticketRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: query.limit,
      skip: query.offset,
    });
    return { tickets, total };
  }

  // Admin detail — GET /support/admin/tickets/:id. Includes internal
  // notes, unlike getOwn.
  async getAdmin(id: string): Promise<TicketWithMessages> {
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const messages = await this.messageRepo.find({
      where: { ticketId: id },
      order: { createdAt: 'ASC' },
    });
    return { ticket, messages };
  }

  // Admin update — PATCH /support/admin/tickets/:id. resolved_at/
  // closed_at are set here (not by the client) the first time status
  // crosses into RESOLVED/CLOSED, and cleared if it's moved back out —
  // same "derive the timestamp from the transition" approach as
  // shipment status history rather than trusting a client-supplied date.
  async update(id: string, dto: UpdateTicketDto): Promise<SupportTicket> {
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (dto.status !== undefined) {
      ticket.status = dto.status;
      ticket.resolvedAt = dto.status === TicketStatus.RESOLVED ? new Date() : null;
      ticket.closedAt = dto.status === TicketStatus.CLOSED ? new Date() : null;
    }
    if (dto.priority !== undefined) ticket.priority = dto.priority;
    if (dto.assignedAdminId !== undefined) ticket.assignedAdminId = dto.assignedAdminId;

    return this.ticketRepo.save(ticket);
  }

  // Admin reply/internal note — POST /support/admin/tickets/:id/messages.
  async addAdminMessage(
    adminUserId: string,
    id: string,
    roles: Role[],
    dto: AddMessageDto,
  ): Promise<SupportTicketMessage> {
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    return this.messageRepo.save(
      this.messageRepo.create({
        ticketId: id,
        authorId: adminUserId,
        authorRole: roles.includes(Role.SUPER_ADMIN) ? Role.SUPER_ADMIN : Role.ADMIN,
        message: dto.message,
        isInternalNote: !!dto.isInternalNote,
      }),
    );
  }

  private async findOwnedOrThrow(userId: string, id: string): Promise<SupportTicket> {
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.raisedByUserId !== userId) {
      throw new ForbiddenException('This ticket does not belong to you');
    }
    return ticket;
  }
}
