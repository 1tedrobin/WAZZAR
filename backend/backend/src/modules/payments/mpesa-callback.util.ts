import { MpesaWebhookDto } from './dto/mpesa-webhook.dto';

// Turns the real, deeply-nested Daraja STK Push callback shape into
// the flat set of fields payments.service.ts actually needs — kept as
// a separate, pure function (no NestJS, no database) so it can be unit
// tested against real-looking Daraja payloads on its own, the same way
// scheduled-delivery-recurrence.util.ts is kept separate from its
// service.
export interface ParsedMpesaCallback {
  // Correlates to Payment.externalId — see mpesa.provider.ts's
  // initiate(), which stores CheckoutRequestID there.
  transactionId: string;
  success: boolean;
  resultDesc: string;
  // Only ever populated when success is true — CallbackMetadata is
  // absent on Daraja's own failure callbacks, so there is nothing to
  // read these from otherwise.
  amount?: number;
  mpesaReceiptNumber?: string;
  phone?: string;
  transactionDate?: string;
}

function findMetadataValue(
  items: { Name: string; Value?: string | number }[] | undefined,
  name: string,
): string | number | undefined {
  return items?.find((item) => item.Name === name)?.Value;
}

export function parseMpesaCallback(dto: MpesaWebhookDto): ParsedMpesaCallback {
  const callback = dto.Body.stkCallback;
  const success = callback.ResultCode === 0;
  const items = callback.CallbackMetadata?.Item;

  if (!success) {
    return {
      transactionId: callback.CheckoutRequestID,
      success: false,
      resultDesc: callback.ResultDesc,
    };
  }

  const amountValue = findMetadataValue(items, 'Amount');
  const phoneValue = findMetadataValue(items, 'PhoneNumber');
  const dateValue = findMetadataValue(items, 'TransactionDate');
  const receiptValue = findMetadataValue(items, 'MpesaReceiptNumber');

  return {
    transactionId: callback.CheckoutRequestID,
    success: true,
    resultDesc: callback.ResultDesc,
    amount: amountValue !== undefined ? Number(amountValue) : undefined,
    mpesaReceiptNumber: receiptValue !== undefined ? String(receiptValue) : undefined,
    phone: phoneValue !== undefined ? String(phoneValue) : undefined,
    transactionDate: dateValue !== undefined ? String(dateValue) : undefined,
  };
}
