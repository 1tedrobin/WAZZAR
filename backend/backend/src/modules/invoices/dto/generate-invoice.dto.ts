import { IsDateString, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class GenerateInvoiceDto {
  // Inclusive. Compared against Payment.completedAt (date part) —
  // see InvoicesService.generate.
  @IsDateString()
  periodStart: string;

  // Inclusive.
  @IsDateString()
  periodEnd: string;

  // Percent, e.g. 18 for Tanzania's standard VAT rate. Omitted/0 means
  // no tax line — WAZZAR doesn't assume every business is VAT-
  // registered, so this is opt-in per invoice, not a fixed constant.
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  taxRatePercent?: number;
}
