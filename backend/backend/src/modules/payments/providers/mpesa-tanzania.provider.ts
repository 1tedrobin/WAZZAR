import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants, publicEncrypt, randomUUID } from 'crypto';
import { ProviderInitiateResult, ProviderRefundResult } from './provider-result.types';
import { SupportedCurrency } from '../../../common/currency';

// The ACTUAL Tanzania M-Pesa integration — Vodacom's "Open API"
// (openapi.m-pesa.com), not Safaricom Daraja. See
// docs/delivery-notes/PHASE4_REGIONAL_PAYMENT_PROVIDERS.md and
// docs/delivery-notes/TANZANIA_MPESA_FIX.md for the full story: the
// previously-existing MpesaProvider (mpesa.provider.ts) was built
// against Safaricom's Kenya API despite being documented as Tanzania's
// integration. That class is now deprecated — see its own class-level
// comment — and PaymentsService no longer routes TZS payments to it.
// This class is what TZS routes to instead.
//
// ⚠ CONFIDENCE LEVEL, stated plainly: this was built from Vodacom's Open
// API request/response shape as used consistently across roughly half a
// dozen independent open-source community client libraries (Python,
// Dart, Go, Elixir, PHP — pypesa, mpesa_sdk, Golang-Tanzania/mpesa,
// elixir_mpesa, and others), NOT from Vodacom's own first-party
// developer portal docs (no network access in this environment to
// register for that portal or read them directly), and NOT verified
// against a live sandbox call. The endpoint paths, field names
// (input_Amount, output_ResponseCode, etc.), and INS-0 success code are
// consistent enough across independent sources to be worth building
// against — but this is meaningfully less certain than the Kenya
// M-Pesa (official first-party Safaricom docs, extremely widely used)
// or MTN MoMo (official first-party docs) providers built alongside it.
// Treat this as a strong starting point for real sandbox testing, not
// as verified-working code.
//
// ⚠ UNRESOLVED, and explicitly NOT decided by this implementation: every
// community reference shows c2bPayment/singleStage returning
// output_ResponseCode directly in the same HTTP response — which reads
// as a SYNCHRONOUS confirm-or-fail call, unlike Safaricom Daraja's STK
// Push (which is async: you get a CheckoutRequestID immediately, then a
// separate webhook confirms success/failure later, sometimes tens of
// seconds afterward while the customer enters their PIN on their
// phone). If Vodacom's flow really is synchronous, PaymentsService could
// mark a payment COMPLETED right after initiate() returns, instead of
// PROCESSING-then-wait-for-webhook. This implementation deliberately
// does NOT make that assumption — initiate() below returns a
// transactionId the same way every other provider does, and
// PaymentsService still treats the payment as PROCESSING pending
// separate confirmation, which is the safer failure mode (a real
// successful payment sits in PROCESSING until manually reconciled,
// rather than a real failed/pending payment getting marked COMPLETED
// when money never actually moved). Confirming the real flow — and
// whether Vodacom has any server-to-server webhook/callback mechanism
// at all — requires real sandbox credentials and testing, not more
// research from here.
const MPESA_TZ_SUPPORTED_CURRENCIES: SupportedCurrency[] = [SupportedCurrency.TZS];

interface TzCredentials {
  apiKey: string;
  publicKeyPem: string; // Vodacom's published RSA public key (sandbox and production keys differ) — PEM format
  serviceProviderCode: string; // the merchant/paybill code Vodacom issues after registration
}

function getCredentials(configService: ConfigService): TzCredentials | null {
  const apiKey = configService.get<string>('MPESA_TZ_API_KEY');
  const publicKeyPem = configService.get<string>('MPESA_TZ_PUBLIC_KEY_PEM');
  const serviceProviderCode = configService.get<string>('MPESA_TZ_SERVICE_PROVIDER_CODE');
  if (!apiKey || !publicKeyPem || !serviceProviderCode) {
    return null;
  }
  return { apiKey, publicKeyPem, serviceProviderCode };
}

function baseUrl(configService: ConfigService): string {
  const env = configService.get<string>('MPESA_TZ_ENV') ?? 'sandbox';
  // Every community reference agrees on this single host for both
  // environments — sandbox vs. production is selected by the URL path
  // prefix (/sandbox/... vs /openapi/...), not a different domain,
  // unlike Safaricom Daraja's separate sandbox./api. hosts.
  return `https://openapi.m-pesa.com/${env === 'production' ? 'openapi' : 'sandbox'}/ipg/v2/vodacomTZN`;
}

// RSA-encrypts a value with Vodacom's published public key. Every
// community reference that shows the actual encryption call uses
// PKCS1 padding (RSA/ECB/PKCS1Padding in the historical Java reference
// implementation this ecosystem traces back to) — flagged here since
// getting the padding scheme wrong produces a cryptic failure, not an
// obviously-wrong one.
function encryptWithVodacomPublicKey(value: string, publicKeyPem: string): string {
  const encrypted = publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(value, 'utf8'),
  );
  return encrypted.toString('base64');
}

// MOCK PROVIDER by default, same convention as every other provider in
// this directory. Set MPESA_TZ_API_KEY, MPESA_TZ_PUBLIC_KEY_PEM, and
// MPESA_TZ_SERVICE_PROVIDER_CODE to attempt real Vodacom Open API calls
// — but see the confidence-level and unresolved-sync-vs-async caveats
// above before doing that against anything but a disposable sandbox
// account.
@Injectable()
export class MpesaTanzaniaProvider {
  private readonly logger = new Logger(MpesaTanzaniaProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async initiate(
    phone: string,
    amount: string,
    reference: string,
    currency: SupportedCurrency,
  ): Promise<ProviderInitiateResult> {
    this.assertSupportedCurrency(currency);

    const creds = getCredentials(this.configService);
    if (!creds) {
      void phone;
      void amount;
      void reference;
      return { transactionId: `MPESA-TZ-${randomUUID()}`, isMock: true };
    }

    const base = baseUrl(this.configService);
    const sessionKey = await this.getSessionKey(base, creds);
    const encryptedSessionKey = encryptWithVodacomPublicKey(sessionKey, creds.publicKeyPem);
    const thirdPartyConversationId = randomUUID().replace(/-/g, '');

    const res = await fetch(`${base}/c2bPayment/singleStage/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${encryptedSessionKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        input_Amount: amount,
        input_Country: 'TZN',
        input_Currency: currency,
        input_CustomerMSISDN: phone.replace(/^\+/, ''),
        input_ServiceProviderCode: creds.serviceProviderCode,
        input_ThirdPartyConversationID: thirdPartyConversationId,
        input_TransactionReference: reference.slice(0, 20),
        input_PurchasedItemsDesc: 'WAZZAR delivery payment',
      }),
    });

    const body = await res.json();
    if (body.output_ResponseCode !== 'INS-0') {
      throw new Error(
        `Vodacom Open API C2B payment failed: ${body.output_ResponseCode ?? res.status} ` +
          `${body.output_ResponseDesc ?? res.statusText}`,
      );
    }

    return { transactionId: body.output_TransactionID, isMock: false };
  }

  async refund(
    externalId: string,
    amount: string,
    currency: SupportedCurrency,
  ): Promise<ProviderRefundResult> {
    this.assertSupportedCurrency(currency);

    const creds = getCredentials(this.configService);
    if (!creds) {
      void externalId;
      void amount;
      return { refundId: `MPESA-TZ-REFUND-${randomUUID()}` };
    }

    // Unlike Safaricom Daraja (both TZ-mislabeled MpesaProvider and the
    // real MpesaKenyaProvider) and MTN MoMo's Collections-only
    // credentials, Vodacom's Open API reversal endpoint uses the SAME
    // session-key auth as everything else here — every community
    // reference shows a plain `reversal` POST, not a separate
    // hard-to-obtain credential class. That means an automated refund
    // attempt is genuinely plausible here, unlike the other three
    // mobile-money providers in this codebase — so this one actually
    // calls the API instead of immediately throwing "not automated".
    // Still unverified against a live sandbox — if this turns out to be
    // wrong, the failure mode is an Error being thrown (caught by
    // PaymentsService the same as any other provider failure), not a
    // silent false success.
    const base = baseUrl(this.configService);
    const sessionKey = await this.getSessionKey(base, creds);
    const encryptedSessionKey = encryptWithVodacomPublicKey(sessionKey, creds.publicKeyPem);

    const res = await fetch(`${base}/reversal/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${encryptedSessionKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        input_ReversalAmount: amount,
        input_Country: 'TZN',
        input_ServiceProviderCode: creds.serviceProviderCode,
        input_ThirdPartyConversationID: randomUUID().replace(/-/g, ''),
        input_TransactionID: externalId,
      }),
    });

    const body = await res.json();
    if (body.output_ResponseCode !== 'INS-0') {
      this.logger.warn(
        `Vodacom Open API reversal failed for externalId=${externalId} amount=${amount}: ` +
          `${body.output_ResponseCode ?? res.status} ${body.output_ResponseDesc ?? res.statusText} — ` +
          'this needs manual follow-up, the same as any failed refund attempt would.',
      );
      throw new Error(
        `Vodacom Open API reversal failed: ${body.output_ResponseCode ?? res.status} ` +
          `${body.output_ResponseDesc ?? res.statusText}`,
      );
    }

    return { refundId: body.output_TransactionID ?? body.output_ConversationID };
  }

  private assertSupportedCurrency(currency: SupportedCurrency): void {
    if (!MPESA_TZ_SUPPORTED_CURRENCIES.includes(currency)) {
      throw new Error(
        `This M-Pesa (Tanzania) integration is configured for ` +
          `${MPESA_TZ_SUPPORTED_CURRENCIES.join(', ')} only — ${currency} needs its ` +
          `own provider/credentials, not this one.`,
      );
    }
  }

  private async getSessionKey(base: string, creds: TzCredentials): Promise<string> {
    const encryptedApiKey = encryptWithVodacomPublicKey(creds.apiKey, creds.publicKeyPem);
    const res = await fetch(`${base}/getSession/`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${encryptedApiKey}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Vodacom Open API getSession failed: ${res.status} ${res.statusText}`);
    }
    const body = await res.json();
    if (body.output_ResponseCode !== 'INS-0' || !body.output_SessionID) {
      throw new Error(
        `Vodacom Open API getSession did not return a session: ` +
          `${body.output_ResponseCode ?? 'unknown'} ${body.output_ResponseDesc ?? ''}`,
      );
    }
    return body.output_SessionID;
  }
}
