import { IsEnum, IsOptional } from 'class-validator';
import { TicketStatus } from '../../../database/entities/support-ticket.entity';

export class ListMyTicketsQueryDto {
  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;
}
