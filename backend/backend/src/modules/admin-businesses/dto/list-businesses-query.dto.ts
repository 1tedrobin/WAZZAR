import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { UserStatus } from '../../../database/entities/user.entity';

// Mirrors ListTicketsQueryDto's shape. `search` matches against the
// account's name/phone/email — there's no dedicated search index for
// this yet (ILIKE over a handful of columns), fine at current scale,
// worth revisiting if the businesses table gets large.
export class ListBusinessesQueryDto {
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
