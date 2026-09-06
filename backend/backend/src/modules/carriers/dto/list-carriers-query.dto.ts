import { IsOptional, IsUUID } from 'class-validator';

export class ListCarriersQueryDto {
  @IsUUID()
  @IsOptional()
  partnerOperatorId?: string;
}
