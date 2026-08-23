import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportTicketMessage } from '../../database/entities/support-ticket-message.entity';
import { SupportTicket } from '../../database/entities/support-ticket.entity';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [TypeOrmModule.forFeature([SupportTicket, SupportTicketMessage])],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
