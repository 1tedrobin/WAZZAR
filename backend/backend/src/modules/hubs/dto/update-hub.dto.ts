import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

// Written out plainly rather than `PartialType(CreateHubDto)` — same
// reasoning as UpdatePricingConfigDto: every field here is optional
// anyway, and this repo doesn't otherwise depend on @nestjs/mapped-types.
export class UpdateHubDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @IsOptional()
  city?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @IsOptional()
  longitude?: number;

  @IsString()
  @MinLength(1)
  @IsOptional()
  address?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  capacityKg?: number;

  @IsOptional()
  managerId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
