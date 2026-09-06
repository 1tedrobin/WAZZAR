import { IsEnum, IsNotEmpty, IsPhoneNumber, IsString, IsUUID, ValidateIf } from 'class-validator';
import { PaymentMethod } from '../../../database/entities/payment.entity';

export class InitiatePaymentDto {
  @IsUUID()
  shipmentId: string;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  // Required for MPESA and MOBILE_MONEY. Deliberately just
  // @IsPhoneNumber(undefined) — any globally-valid phone number — rather
  // than a fixed-country regex: which specific provider (Tanzania
  // M-Pesa, Kenya M-Pesa, or MTN MoMo) this actually gets routed to
  // depends on the shipment's currency, not something this DTO knows in
  // isolation. PaymentsService.resolveMobileMoneyProvider() does the
  // real currency-appropriate validation before ever calling a provider
  // — same pattern as RegisterDto/AuthService's phoneMatchesMarket
  // check.
  @ValidateIf(
    (dto) => dto.method === PaymentMethod.MPESA || dto.method === PaymentMethod.MOBILE_MONEY,
  )
  @IsPhoneNumber(undefined, { message: 'phoneNumber must be a valid phone number, e.g. +255712345678' })
  phoneNumber?: string;

  // Required for STRIPE only — a client-side token/payment method id
  // from Stripe Elements. Never a raw card number (see PCI note in
  // docs/delivery-notes/PAYMENTS_GOING_LIVE.md).
  @ValidateIf((dto) => dto.method === PaymentMethod.STRIPE)
  @IsString()
  @IsNotEmpty()
  cardToken?: string;
}
