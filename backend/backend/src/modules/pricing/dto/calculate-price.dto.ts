import { IsEnum, IsISO8601, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { SupportedCurrency } from '../../../common/currency';

export class CalculatePriceDto {
  // Which market's PricingConfig to quote against. Deliberately no
  // `= DEFAULT_CURRENCY` initializer here — omitted must stay
  // `undefined` after transform so callers can distinguish "no
  // preference" from "explicitly TZS" (ShipmentsService uses that to
  // fall back to the customer's registered market instead of a hard
  // TZS default). PricingService.calculatePrice applies the actual
  // TZS fallback via `dto.currency ?? DEFAULT_CURRENCY`.
  @IsEnum(SupportedCurrency)
  @IsOptional()
  currency?: SupportedCurrency;

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
