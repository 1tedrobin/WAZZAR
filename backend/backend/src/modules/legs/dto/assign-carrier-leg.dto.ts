import { IsUUID } from 'class-validator';

export class AssignCarrierLegDto {
  @IsUUID()
  carrierId: string;
}
