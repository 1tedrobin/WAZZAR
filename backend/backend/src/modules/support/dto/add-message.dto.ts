import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AddMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message: string;

  // Only meaningful on the admin route — SupportController strips/ignores
  // this on the ticket-owner route so a CUSTOMER/RIDER/BUSINESS can never
  // post something a caller-side bug or crafted request tries to hide
  // from themselves. See SupportService.addMessage's isInternalNote param,
  // which the owner route always calls with `false`.
  @IsBoolean()
  @IsOptional()
  isInternalNote?: boolean;
}
