import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { ProviderInitiateResult, ProviderRefundResult } from './provider-result.types';
import { SupportedCurrency } from '../../../common/currency';

// Safaricom Daraja STK Push ("Lipa na M-Pesa Online"), registered for
// Kenya. Unlike the existing MpesaProvider (see that file's class-level
// comment — src/modules/payments/providers/mpesa.provider.ts), this one
// genuinely is Safaricom's own API for Safaricom's own home market: Kenya
// is where Safaricom operates M-Pesa directly, and developer.safaricom.co.ke
// / sandbox.safaricom.co.ke / api.safaricom.co.ke are Safaricom Kenya's
// actual Daraja domains — verified 2026-09-02.
//
// IMPORTANT DISCOVERY while building this (2026-09-02): the existing
// MpesaProvider — documented everywhere in this codebase as "the
// Tanzania M-Pesa integration" — calls that exact same
// sandbox.safaricom.co.ke / api.safaricom.co.ke domain. That's wrong for
// Tanzania. Safaricom does not operate M-Pesa in Tanzania; Vodacom
// Tanzania does, via a completely separate API with its own developer
// portal, credential model, and request/response shapes — not Safaricom
// Daraja. This means the existing "Tanzania" provider was actually built
// against Kenya's API despite validating Tanzanian (255-prefix) phone
// numbers, and PAYMENTS_GOING_LIVE.md's setup instructions (registering
// "as a Tanzanian business" with Safaricom) don't match how Vodacom
// Tanzania integration actually works either.
//
// This was NOT fixed as part of this pass — building a correct Vodacom
// Tanzania Open API integration is its own separate research-and-build
// task (different auth flow, different credential model, needs its own
// verification against Vodacom's actual docs), not something to
// improvise inside a "add the Kenya provider" change. Flagging it
// clearly here, and in
// docs/delivery-notes/PHASE4_REGIONAL_PAYMENT_PROVIDERS.md, rather than
// leaving it to be rediscovered mid-launch. The existing MpesaProvider
// has NOT been touched by this file — it's untouched, still wrong for
// Tanzania, still needs its own fix as separate work.
const MPESA_KE_SUPPORTED_CURRENCIES: SupportedCurrency[] = [SupportedCurrency.KES];

function hasRealMpesaKeCredentials(configService: ConfigService): boolean {
  return [
    'MPESA_KE_CONSUMER_KEY',
    'MPESA_KE_CONSUMER_SECRET',
    'MPESA_KE_SHORTCODE',
    'MPESA_KE_PASSKEY',
    'MPESA_KE_CALLBACK_URL',
  ].every((key) => !!configService.get<string>(key));
}

function daraJaBaseUrl(configService: ConfigService): string {
  const env = configService.get<string>('MPESA_KE_ENV') ?? 'sandbox';
  return env === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

// Same yyyyMMddHHmmss format as the Tanzania provider's darajaTimestamp
// — Daraja's Password field requires it regardless of which country's
// app is calling. Kenya is also East Africa Time (UTC+3, no DST), same
// as Tanzania, so the same offset applies — see src/common/market.ts
// for the note that Rwanda (Central Africa Time, UTC+2) is the one
// exception among this codebase's four markets.
function darajaTimestamp(): string {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  );
}

// MOCK PROVIDER by default, same convention as every other provider in
// this directory — set MPESA_KE_CONSUMER_KEY, MPESA_KE_CONSUMER_SECRET,
// MPESA_KE_SHORTCODE, MPESA_KE_PASSKEY, and MPESA_KE_CALLBACK_URL to
// switch to real Daraja calls. Deliberately a fully separate class and
// separate env var prefix from MpesaProvider, not a currency-parameterized
// shared class — the two providers are registered against different
// Safaricom Daraja apps with different shortcodes/credentials, and
// keeping them structurally separate means a config mistake can produce
// "this provider has no credentials, falls back to mock" at worst,
// never "sent a Kenyan customer's STK Push through Tanzania's shortcode"
// or vice versa.
@Injectable()
export class MpesaKenyaProvider {
  private readonly logger = new Logger(MpesaKenyaProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async initiate(
    phone: string,
    amount: string,
    reference: string,
    currency: SupportedCurrency,
  ): Promise<ProviderInitiateResult> {
    this.assertSupportedCurrency(currency);

    if (!hasRealMpesaKeCredentials(this.configService)) {
      void phone;
      void amount;
      void reference;
      return { transactionId: `MPESA-KE-${randomUUID()}`, isMock: true };
    }

    const baseUrl = daraJaBaseUrl(this.configService);
    const accessToken = await this.getAccessToken(baseUrl);

    const shortcode = this.configService.get<string>('MPESA_KE_SHORTCODE')!;
    const passkey = this.configService.get<string>('MPESA_KE_PASSKEY')!;
    const timestamp = darajaTimestamp();
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    const res = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(Number(amount)),
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: this.configService.get<string>('MPESA_KE_CALLBACK_URL'),
        AccountReference: reference,
        TransactionDesc: 'WAZZAR delivery payment',
      }),
    });

    const body = await res.json();
    if (!res.ok || body.ResponseCode !== '0') {
      throw new Error(
        `Daraja (KE) STK Push failed: ${body.errorMessage ?? body.ResponseDescription ?? res.statusText}`,
      );
    }

    return { transactionId: body.CheckoutRequestID, isMock: false };
  }

  async refund(
    externalId: string,
    amount: string,
    currency: SupportedCurrency,
  ): Promise<ProviderRefundResult> {
    this.assertSupportedCurrency(currency);

    if (!hasRealMpesaKeCredentials(this.configService)) {
      void externalId;
      void amount;
      return { refundId: `MPESA-KE-REFUND-${randomUUID()}` };
    }

    // Same limitation as the Tanzania provider (see its refund() for the
    // full explanation): Daraja has no simple refund call. B2C Reversal
    // needs an initiator name + RSA-encrypted security credential and is
    // typically done from Safaricom's business back-office, not a plain
    // API call from this codebase.
    this.logger.warn(
      `M-Pesa (KE) refund requested for externalId=${externalId} amount=${amount} — ` +
        'this must be processed manually via the Daraja B2C Reversal flow or ' +
        'Safaricom business portal. No automatic reversal was attempted.',
    );
    throw new Error(
      'M-Pesa (KE) refunds are not automated — process this manually via Safaricom ' +
        'Daraja B2C Reversal and record the outcome by hand.',
    );
  }

  private assertSupportedCurrency(currency: SupportedCurrency): void {
    if (!MPESA_KE_SUPPORTED_CURRENCIES.includes(currency)) {
      throw new Error(
        `This M-Pesa (Kenya) integration is configured for ` +
          `${MPESA_KE_SUPPORTED_CURRENCIES.join(', ')} only — ${currency} needs its ` +
          `own provider/credentials, not this one.`,
      );
    }
  }

  private async getAccessToken(baseUrl: string): Promise<string> {
    const consumerKey = this.configService.get<string>('MPESA_KE_CONSUMER_KEY')!;
    const consumerSecret = this.configService.get<string>('MPESA_KE_CONSUMER_SECRET')!;
    const basicAuth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    if (!res.ok) {
      throw new Error(`Daraja (KE) OAuth failed: ${res.status} ${res.statusText}`);
    }
    const body = await res.json();
    return body.access_token;
  }
}
