import { IsOptional, IsString } from 'class-validator';

export class AutoAssignDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
