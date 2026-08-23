import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';

// This is the real shape Safaricom's Daraja API sends to an STK Push
// callback URL — NOT the flattened `{ transactionId, success, amount }`
// shape this DTO used to have (see
// docs/delivery-notes/PAYMENTS_GOING_LIVE.md's "known gap" section,
// now closed by this file + mpesa-callback.util.ts). Confirmed against
// Safaricom's published Daraja documentation; still never exercised
// against a real live callback — see that doc's "Testing before going
// live" section for why and what to do about it.
//
// A real success callback looks like:
//   { Body: { stkCallback: { MerchantRequestID, CheckoutRequestID,
//     ResultCode: 0, ResultDesc, CallbackMetadata: { Item: [
//       { Name: "Amount", Value: 1 },
//       { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
//       { Name: "TransactionDate", Value: 20170727165451 },
//       { Name: "PhoneNumber", Value: 254708374149 } ] } } } }
// A real failure/cancellation callback has NO CallbackMetadata at
// all — just a non-zero ResultCode and a human-readable ResultDesc
// (e.g. "Request cancelled by user").

class MpesaCallbackMetadataItem {
  @IsString()
  Name: string;

  // Daraja sends numbers for Amount/PhoneNumber/TransactionDate and a
  // string for MpesaReceiptNumber — one field, two possible JSON
  // types, so this is deliberately not over-constrained. Value can
  // also be entirely absent on some documented edge cases, hence
  // optional.
  @IsOptional()
  Value?: string | number;
}

class MpesaCallbackMetadata {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MpesaCallbackMetadataItem)
  Item: MpesaCallbackMetadataItem[];
}

class MpesaStkCallback {
  @IsString()
  MerchantRequestID: string;

  // What Payment.externalId is stored as — see mpesa.provider.ts's
  // initiate(), which returns CheckoutRequestID as transactionId, and
  // mpesa-callback.util.ts's parseMpesaCallback(), which looks the
  // payment up by this same field.
  @IsString()
  CheckoutRequestID: string;

  // 0 = success. Any other value (Daraja uses a range of specific
  // codes — 1032 = "cancelled by user", 1037 = "timeout", etc.) means
  // the payment did not go through; ResultDesc carries the
  // human-readable reason.
  @IsInt()
  ResultCode: number;

  @IsString()
  ResultDesc: string;

  // Present only when ResultCode === 0 — see the header comment.
  // Never assume this exists just because a callback arrived.
  @IsOptional()
  @ValidateNested()
  @Type(() => MpesaCallbackMetadata)
  CallbackMetadata?: MpesaCallbackMetadata;
}

class MpesaCallbackBody {
  @ValidateNested()
  @Type(() => MpesaStkCallback)
  stkCallback: MpesaStkCallback;
}

export class MpesaWebhookDto {
  @ValidateNested()
  @Type(() => MpesaCallbackBody)
  Body: MpesaCallbackBody;
}
