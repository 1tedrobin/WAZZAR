import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class RefundPaymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  // Omit for a full refund of whatever hasn't already been refunded;
  // provide for a partial refund. Validated against the remaining
  // refundable balance in PaymentsService.refund().
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  amount?: number;
}
