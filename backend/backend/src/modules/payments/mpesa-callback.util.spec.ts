import { parseMpesaCallback } from './mpesa-callback.util';
import { MpesaWebhookDto } from './dto/mpesa-webhook.dto';

// Fixture shaped exactly like Safaricom's published Daraja sandbox
// example (values changed, structure identical).
function successPayload(): MpesaWebhookDto {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: 'ws_CO_191220191020363925',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 8500 },
            { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
            { Name: 'TransactionDate', Value: 20261124101530 },
            { Name: 'PhoneNumber', Value: 254708374149 },
          ],
        },
      },
    },
  } as MpesaWebhookDto;
}

function failurePayload(): MpesaWebhookDto {
  // Real Daraja failure callbacks have no CallbackMetadata at all.
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: 'ws_CO_191220191020363925',
        ResultCode: 1032,
        ResultDesc: 'Request cancelled by user',
      },
    },
  } as MpesaWebhookDto;
}

describe('parseMpesaCallback', () => {
  it('extracts transactionId, success, and metadata fields from a real success callback', () => {
    const parsed = parseMpesaCallback(successPayload());

    expect(parsed).toEqual({
      transactionId: 'ws_CO_191220191020363925',
      success: true,
      resultDesc: 'The service request is processed successfully.',
      amount: 8500,
      mpesaReceiptNumber: 'NLJ7RT61SV',
      phone: '254708374149',
      transactionDate: '20261124101530',
    });
  });

  it('reports failure and skips metadata fields entirely for a failed/cancelled callback', () => {
    const parsed = parseMpesaCallback(failurePayload());

    expect(parsed).toEqual({
      transactionId: 'ws_CO_191220191020363925',
      success: false,
      resultDesc: 'Request cancelled by user',
    });
    expect(parsed.amount).toBeUndefined();
    expect(parsed.mpesaReceiptNumber).toBeUndefined();
  });

  it('does not throw if CallbackMetadata is present but missing an expected item', () => {
    const payload = successPayload();
    payload.Body.stkCallback.CallbackMetadata!.Item = [{ Name: 'Amount', Value: 500 }];

    const parsed = parseMpesaCallback(payload);

    expect(parsed.amount).toBe(500);
    expect(parsed.mpesaReceiptNumber).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
  });
});
