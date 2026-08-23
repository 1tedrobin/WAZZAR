import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { UserStatus } from '../../../database/entities/user.entity';

// Identical shape to ListBusinessesQueryDto — same reasoning: `search`
// matches against the account's name/phone/email via ILIKE, fine at
// current scale.
export class ListCustomersQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  search?: string;

  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number = 0;
}
