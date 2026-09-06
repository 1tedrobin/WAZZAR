import { IsUUID } from 'class-validator';

export class AssignRiderLegDto {
  @IsUUID()
  riderId: string;
}
