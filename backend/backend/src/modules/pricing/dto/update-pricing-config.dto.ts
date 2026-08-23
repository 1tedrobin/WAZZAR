import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { PricingMode, SurgeWindow } from '../../../database/entities/pricing-config.entity';

// Deliberately not `PartialType(CreatePricingConfigDto)` — @nestjs/mapped-types
// isn't a dependency of this project, and every field here needs to be
// optional anyway (an update only ever touches a subset), so writing it
// out plainly avoids adding a package for one DTO.
export class UpdatePricingConfigDto {
  @IsEnum(PricingMode)
  @IsOptional()
  pricingMode?: PricingMode;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  basePrice?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  pricePerKm?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  includedDistanceKm?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  pricePerKg?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  includedWeightKg?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  platformCommissionPercent?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  riderPayoutPercent?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  surgeMultiplier?: number;

  @IsArray()
  @ArrayMaxSize(12)
  @IsOptional()
  surgeActiveHours?: SurgeWindow[];

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxPrice?: number;
}
