import { IsEnum, IsNotEmpty, IsString, IsUUID, Matches, ValidateIf } from 'class-validator';
import { PaymentMethod } from '../../../database/entities/payment.entity';

export class InitiatePaymentDto {
  @IsUUID()
  shipmentId: string;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  // Required for MPESA only. 255XXXXXXXXX — matches the format already
  // used for User.phone at registration (see RegisterDto).
  @ValidateIf((dto) => dto.method === PaymentMethod.MPESA)
  @IsString()
  @Matches(/^255\d{9}$/, {
    message: 'phoneNumber must be in 255XXXXXXXXX format',
  })
  phoneNumber?: string;

  // Required for STRIPE only — a client-side token/payment method id
  // from Stripe Elements. Never a raw card number (see PCI note in
  // docs/delivery-notes/PAYMENTS_GOING_LIVE.md).
  @ValidateIf((dto) => dto.method === PaymentMethod.STRIPE)
  @IsString()
  @IsNotEmpty()
  cardToken?: string;
}
