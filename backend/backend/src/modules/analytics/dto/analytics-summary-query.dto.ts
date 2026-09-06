import { IsDateString, IsOptional } from 'class-validator';

export class AnalyticsSummaryQueryDto {
  // Inclusive. Both omitted = last 30 days ending today (see
  // AnalyticsService.resolveRange). Providing one without the other is
  // rejected — a half-open range is more likely a mistake than intent.
  @IsDateString()
  @IsOptional()
  periodStart?: string;

  @IsDateString()
  @IsOptional()
  periodEnd?: string;
}
