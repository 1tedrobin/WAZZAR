import { IsISO8601, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class CalculatePriceDto {
  @IsNumber()
  @Min(0)
  distanceKm: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  weightKg?: number;

  // Almost always omitted — surge is normally derived from `at` (or now)
  // against the active config's surgeActiveHours. This lets a caller
  // (or a test) pin an exact multiplier instead, e.g. to reprice a
  // shipment at the multiplier that was actually quoted.
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  surgeMultiplier?: number;

  // ISO timestamp to price as of — defaults to now. Used for quoting
  // against the config that was active at some past instant (reconciling
  // an old shipment) or for testing surge windows deterministically.
  @IsISO8601()
  @IsOptional()
  at?: string;
}
