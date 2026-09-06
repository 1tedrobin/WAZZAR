import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { ProviderInitiateResult, ProviderRefundResult } from './provider-result.types';
import { DEFAULT_CURRENCY, SupportedCurrency } from '../../../common/currency';

// ⛔ DEPRECATED (2026-09-03) — no longer wired into PaymentsService's
// routing. See docs/delivery-notes/TANZANIA_MPESA_FIX.md for the full
// story. This class is Safaricom Daraja code that was mislabeled as
// Tanzania's M-Pesa integration; TZS payments are now routed to
// MpesaTanzaniaProvider (mpesa-tanzania.provider.ts), a real attempt at
// Vodacom Tanzania's actual Open API. This class is left in place,
// untouched beyond this notice, rather than deleted, because:
//   (a) it's functionally identical to MpesaKenyaProvider (same
//       Safaricom Daraja API this class was always actually calling)
//       and deleting it outright — vs. just leaving it unreferenced —
//       felt like a bigger, separate cleanup decision than this fix
//       should make unilaterally;
//   (b) its webhook plumbing (MpesaWebhookDto, parseMpesaCallback,
//       handleMpesaCallback in payments.service.ts) is still live and
//       still correct — it's genuine Safaricom Daraja callback-shape
//       handling, just now understood to serve Kenya
//       (MpesaKenyaProvider) rather than Tanzania. Nothing there needed
//       to change.
// If this class is still unreferenced by the time someone reads this,
// that's expected — check MpesaKenyaProvider and
// PaymentsService.resolveMobileMoneyProvider() for where its old role
// actually lives now.
//
// This provider talks to the MPESA_SHORTCODE configured in .env, which is
// registered against one specific market's Daraja app (Tanzania, given
// the 255-prefix phone validation in InitiatePaymentDto). It is NOT a
// generic "M-Pesa anywhere" integration — Safaricom Kenya M-Pesa and
// Vodacom Tanzania M-Pesa are separate Daraja registrations with
// different shortcodes/credentials, and this class only ever holds one
// set. Accepting a KES/UGX/RWF payment here would silently route it
// through the wrong country's M-Pesa network. A real M-Pesa-Kenya (or
// other regional mobile-money) provider is new-provider work, not part
// of this multi-currency core pass — see MASTER_GAPS_AND_ROADMAP.md
// Phase 4 "New regional payment providers".
//
// ⚠ KNOWN ISSUE, discovered 2026-09-02 while building
// providers/mpesa-kenya.provider.ts (see that file's class-level comment
// for the full writeup, and
// docs/delivery-notes/PHASE4_REGIONAL_PAYMENT_PROVIDERS.md): this class's
// daraJaBaseUrl() below points at sandbox.safaricom.co.ke /
// api.safaricom.co.ke — Safaricom's own domain. That's correct for
// Kenya, but this class is documented (and named via env vars) as the
// TANZANIA integration. Safaricom does not operate M-Pesa in Tanzania —
// Vodacom Tanzania does, via a separate API this class was never built
// against. This predates the Phase 4 work and was not introduced or
// fixed here; a real Vodacom Tanzania Open API integration is separate,
// not-yet-started work.
const MPESA_SUPPORTED_CURRENCIES: SupportedCurrency[] = [DEFAULT_CURRENCY];

// True only when every credential Daraja STK Push actually needs is
// configured. Deliberately all-or-nothing — a partially-configured set
// (e.g. consumer key set but no passkey) almost always means someone is
// mid-setup, and should get the obvious mock behavior rather than a
// confusing runtime failure on the missing piece.
function hasRealMpesaCredentials(configService: ConfigService): boolean {
  return [
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_URL',
  ].every((key) => !!configService.get<string>(key));
}

function daraJaBaseUrl(configService: ConfigService): string {
  // sandbox.safaricom.co.ke for testing, api.safaricom.co.ke once
  // Safaricom approves the app for production (a real registration
  // process with Safaricom, not a config flag anyone can flip).
  const env = configService.get<string>('MPESA_ENV') ?? 'sandbox';
  return env === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

// Timestamp in Daraja's required yyyyMMddHHmmss format, East Africa
// Time (UTC+3, no DST) — Daraja validates the Password field against
// this exact format and timezone.
function darajaTimestamp(): string {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000); // shift to EAT
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  );
}

// MOCK PROVIDER by default — stands in for the real Safaricom Daraja
// API ("Lipa na M-Pesa" STK Push) until credentials exist. Set
// MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE,
// MPESA_PASSKEY, and MPESA_CALLBACK_URL in `.env` to switch this to
// real Daraja calls automatically — see
// docs/delivery-notes/PAYMENTS_GOING_LIVE.md for where each of those
// comes from and the exact steps.
@Injectable()
export class MpesaProvider {
  private readonly logger = new Logger(MpesaProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async initiate(
    phone: string,
    amount: string,
    reference: string,
    currency: SupportedCurrency = DEFAULT_CURRENCY,
  ): Promise<ProviderInitiateResult> {
    this.assertSupportedCurrency(currency);

    if (!hasRealMpesaCredentials(this.configService)) {
      void phone;
      void amount;
      void reference;
      return { transactionId: `MPESA-${randomUUID()}`, isMock: true };
    }

    const baseUrl = daraJaBaseUrl(this.configService);
    const accessToken = await this.getAccessToken(baseUrl);

    const shortcode = this.configService.get<string>('MPESA_SHORTCODE')!;
    const passkey = this.configService.get<string>('MPESA_PASSKEY')!;
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
        // Daraja wants a whole-shilling integer, not a decimal string.
        Amount: Math.round(Number(amount)),
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: this.configService.get<string>('MPESA_CALLBACK_URL'),
        AccountReference: reference,
        TransactionDesc: 'WAZZAR delivery payment',
      }),
    });

    const body = await res.json();
    if (!res.ok || body.ResponseCode !== '0') {
      throw new Error(
        `Daraja STK Push failed: ${body.errorMessage ?? body.ResponseDescription ?? res.statusText}`,
      );
    }

    // CheckoutRequestID is what the real callback correlates back to —
    // see mpesa-callback.util.ts's parseMpesaCallback(), which reads
    // it back out of the real Daraja callback shape, and
    // handleMpesaCallback in payments.service.ts, which looks up the
    // Payment by it.
    return { transactionId: body.CheckoutRequestID, isMock: false };
  }

  async refund(
    externalId: string,
    amount: string,
    currency: SupportedCurrency = DEFAULT_CURRENCY,
  ): Promise<ProviderRefundResult> {
    this.assertSupportedCurrency(currency);

    if (!hasRealMpesaCredentials(this.configService)) {
      void externalId;
      void amount;
      return { refundId: `MPESA-REFUND-${randomUUID()}` };
    }

    // Deliberately NOT automated even though real credentials exist.
    // Unlike Stripe, Daraja has no simple "refund" call — reversing an
    // M-Pesa payment is a B2C Reversal API request that additionally
    // needs an initiator name, a security-credential (RSA-encrypted
    // initiator password using Safaricom's public certificate), and is
    // typically done from the Daraja/business back-office rather than
    // silently in-app. Pretending to automate this would be worse than
    // refusing — it would tell a customer their money is coming back
    // when nothing has actually been reversed. See
    // PAYMENTS_GOING_LIVE.md's "M-Pesa refunds are manual" section for
    // the actual process.
    this.logger.warn(
      `M-Pesa refund requested for externalId=${externalId} amount=${amount} — ` +
        'this must be processed manually via the Daraja B2C Reversal flow or ' +
        'Safaricom business portal. No automatic reversal was attempted.',
    );
    throw new Error(
      'M-Pesa refunds are not automated — process this manually via Safaricom ' +
        'Daraja B2C Reversal (see PAYMENTS_GOING_LIVE.md) and record the outcome by hand.',
    );
  }

  private assertSupportedCurrency(currency: SupportedCurrency): void {
    if (!MPESA_SUPPORTED_CURRENCIES.includes(currency)) {
      throw new Error(
        `This M-Pesa integration is configured for ${MPESA_SUPPORTED_CURRENCIES.join(', ')} ` +
          `only — ${currency} needs its own provider/credentials, not this one.`,
      );
    }
  }

  private async getAccessToken(baseUrl: string): Promise<string> {
    const consumerKey = this.configService.get<string>('MPESA_CONSUMER_KEY')!;
    const consumerSecret = this.configService.get<string>('MPESA_CONSUMER_SECRET')!;
    const basicAuth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    if (!res.ok) {
      throw new Error(`Daraja OAuth failed: ${res.status} ${res.statusText}`);
    }
    const body = await res.json();
    return body.access_token;
  }
}
