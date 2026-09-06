import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { ProviderInitiateResult, ProviderRefundResult } from './provider-result.types';
import { SupportedCurrency } from '../../../common/currency';

// MTN Mobile Money "Collections" product (Request to Pay) — covers UGX
// (Uganda) and RWF (Rwanda) via one class, unlike the two separate
// MpesaProvider/MpesaKenyaProvider classes. That asymmetry is
// deliberate: MTN Mobile Money's Collections API has the exact same
// auth flow and endpoint shape in every country MTN operates it in —
// only the credentials (a distinct "API user" + subscription per
// country's own MTN MoMo Developer Portal registration) and
// X-Target-Environment value differ. Verified against MTN's published
// Collections API request/response shape 2026-09-02 (api docs at
// momodeveloper.mtn.com); NOT verified against a live sandbox — no
// network access in this environment to actually call it, and no real
// credentials exist yet regardless (see PAYMENTS_GOING_LIVE.md's
// pattern for the equivalent M-Pesa caveat).
//
// Credential sets are looked up per-country via env var prefix
// (MTN_MOMO_UG_* / MTN_MOMO_RW_*) rather than sharing one set across
// countries — same reasoning as the Mpesa TZ/KE split: a shared
// credential set would risk a Ugandan payment being submitted against
// Rwanda's MTN subscription (or the reverse), which is worse than
// falling back to mock mode. See CREDENTIAL_SETS below.
const CREDENTIAL_SETS: Record<string, { envPrefix: string; currency: SupportedCurrency }> = {
  [SupportedCurrency.UGX]: { envPrefix: 'MTN_MOMO_UG', currency: SupportedCurrency.UGX },
  [SupportedCurrency.RWF]: { envPrefix: 'MTN_MOMO_RW', currency: SupportedCurrency.RWF },
};

interface CredentialSet {
  subscriptionKey: string; // Ocp-Apim-Subscription-Key — same value on every call
  apiUser: string; // X-Reference-Id (UUID) used as the OAuth username — provisioned once at setup, not generated per-request
  apiKey: string; // OAuth password, paired with apiUser
  targetEnvironment: string; // X-Target-Environment — 'sandbox' in test; MTN assigns the production value per country/account at approval time, it is NOT literally 'production'
  callbackUrl?: string;
}

function getCredentialSet(
  configService: ConfigService,
  currency: SupportedCurrency,
): CredentialSet | null {
  const config = CREDENTIAL_SETS[currency];
  if (!config) {
    return null;
  }
  const { envPrefix } = config;
  const get = (suffix: string) => configService.get<string>(`${envPrefix}_${suffix}`);

  const subscriptionKey = get('SUBSCRIPTION_KEY');
  const apiUser = get('API_USER');
  const apiKey = get('API_KEY');
  const targetEnvironment = get('TARGET_ENVIRONMENT');

  if (!subscriptionKey || !apiUser || !apiKey || !targetEnvironment) {
    return null;
  }

  return {
    subscriptionKey,
    apiUser,
    apiKey,
    targetEnvironment,
    callbackUrl: get('CALLBACK_URL') ?? undefined,
  };
}

function baseUrl(): string {
  // MTN's sandbox and production traffic both go through this same host
  // — sandbox vs. production is selected by the X-Target-Environment
  // header, not a different domain (unlike Safaricom Daraja's separate
  // sandbox./api. hosts). See the CredentialSet.targetEnvironment note
  // above.
  return 'https://sandbox.momodeveloper.mtn.com';
}

// MOCK PROVIDER by default, same convention as every other provider in
// this directory. Set MTN_MOMO_UG_SUBSCRIPTION_KEY / _API_USER / _API_KEY
// / _TARGET_ENVIRONMENT (and the RW_ equivalents for Rwanda) to switch a
// given country to real MTN MoMo calls — each country independently, so
// Uganda can go live before Rwanda's credentials exist or vice versa.
@Injectable()
export class MtnMomoProvider {
  private readonly logger = new Logger(MtnMomoProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async initiate(
    phone: string,
    amount: string,
    reference: string,
    currency: SupportedCurrency,
  ): Promise<ProviderInitiateResult> {
    const creds = getCredentialSet(this.configService, currency);
    if (!CREDENTIAL_SETS[currency]) {
      throw new Error(
        `This MTN Mobile Money integration is configured for ` +
          `${Object.keys(CREDENTIAL_SETS).join(', ')} only — ${currency} needs its ` +
          `own provider/credentials, not this one.`,
      );
    }

    if (!creds) {
      void phone;
      void amount;
      void reference;
      return { transactionId: `MOMO-${randomUUID()}`, isMock: true };
    }

    const accessToken = await this.getAccessToken(creds);
    // X-Reference-Id on THIS request (distinct from creds.apiUser, which
    // is a separate, permanently-provisioned X-Reference-Id used only
    // for the OAuth token exchange) is what correlates the async result
    // — MTN's Request to Pay returns 202 Accepted with no body, and the
    // actual outcome (SUCCESSFUL/FAILED) arrives via callback or must be
    // polled with GET .../requesttopay/<this-reference-id>.
    const requestReferenceId = randomUUID();

    const res = await fetch(`${baseUrl()}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
        'X-Reference-Id': requestReferenceId,
        'X-Target-Environment': creds.targetEnvironment,
        ...(creds.callbackUrl ? { 'X-Callback-Url': creds.callbackUrl } : {}),
      },
      body: JSON.stringify({
        amount,
        currency,
        externalId: reference,
        payer: { partyIdType: 'MSISDN', partyId: phone.replace(/^\+/, '') },
        payerMessage: 'WAZZAR delivery payment',
        payeeNote: `Shipment ${reference}`,
      }),
    });

    // 202 Accepted with an empty body is success for Request to Pay —
    // there is no transaction id in the response itself, only the
    // X-Reference-Id this call already generated and sent.
    if (res.status !== 202) {
      const body = await res.text();
      throw new Error(`MTN MoMo requesttopay failed: ${res.status} ${body}`);
    }

    return { transactionId: requestReferenceId, isMock: false };
  }

  async refund(
    externalId: string,
    amount: string,
    currency: SupportedCurrency,
  ): Promise<ProviderRefundResult> {
    if (!CREDENTIAL_SETS[currency]) {
      throw new Error(
        `This MTN Mobile Money integration is configured for ` +
          `${Object.keys(CREDENTIAL_SETS).join(', ')} only — ${currency} needs its ` +
          `own provider/credentials, not this one.`,
      );
    }

    const creds = getCredentialSet(this.configService, currency);
    if (!creds) {
      void externalId;
      void amount;
      return { refundId: `MOMO-REFUND-${randomUUID()}` };
    }

    // MTN MoMo's Collections product has a separate "Disbursements"
    // product for sending money out (refunds), which needs its own,
    // separate subscription/credentials from Collections — not
    // something this provider can do with Collections-only credentials.
    // Same shape of limitation as both M-Pesa providers' refund(): flag
    // clearly and require a manual process rather than pretend to
    // automate it.
    this.logger.warn(
      `MTN MoMo refund requested for externalId=${externalId} amount=${amount} ` +
        `currency=${currency} — Collections credentials cannot disburse. This must be ` +
        'processed manually via a Disbursements-product subscription or MTN business portal.',
    );
    throw new Error(
      'MTN MoMo refunds are not automated — Collections credentials cannot send money ' +
        'out. Process this manually via a Disbursements subscription and record the ' +
        'outcome by hand.',
    );
  }

  private async getAccessToken(creds: CredentialSet): Promise<string> {
    const basicAuth = Buffer.from(`${creds.apiUser}:${creds.apiKey}`).toString('base64');

    const res = await fetch(`${baseUrl()}/collection/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Ocp-Apim-Subscription-Key': creds.subscriptionKey,
      },
    });
    if (!res.ok) {
      throw new Error(`MTN MoMo OAuth failed: ${res.status} ${res.statusText}`);
    }
    const body = await res.json();
    return body.access_token;
  }
}
