import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PartnerOperator } from '../../../database/entities/partner-operator.entity';

export interface LatraVehiclePing {
  // null in mock mode (see hasRealCredentials) — deliberately NOT a
  // fake coordinate like (0, 0): a caller that got a null-island
  // position by mistake could plot it on a real map and mislead a
  // customer into thinking their shipment is somewhere it isn't. null
  // means "no real position available," and callers (see
  // TrackingChannelsService/LatraPollingService) skip writing a
  // LOCATION_UPDATE TrackingEvent when it's null, rather than fabricating one.
  latitude: number | null;
  longitude: number | null;
  reportedAt: string;
  raw: Record<string, unknown>;
}

// True only when BOTH a LATRA_BASE_URL is configured (this codebase's
// side of the integration) AND the specific PartnerOperator has their
// own latra_api_key on file (their side — see PartnerOperator entity's
// header comment on why that column is currently plain text, unencrypted).
// All-or-nothing, same reasoning as MpesaProvider's hasRealMpesaCredentials.
function hasRealLatraCredentials(
  operator: PartnerOperator,
  configService: ConfigService,
): boolean {
  return !!configService.get<string>('LATRA_BASE_URL') && !!operator.latraApiKey;
}

// MOCK PROVIDER by default, same shape as MpesaProvider/StripeProvider
// (see payments/providers/) — stands in for Tanzania's Land Transport
// Regulatory Authority vehicle-tracking API. One real difference from
// the payment providers: this is a structural placeholder, not a
// verified integration — there's no public LATRA developer sandbox
// this codebase has been able to register for and test against, so the
// request shape below (`/vehicles/:registration/location`, a bearer
// token, a `{latitude, longitude, reportedAt}` response) is this
// codebase's best-guess contract, not one confirmed against a real
// LATRA API response. Treat the real-credentials branch as a draft to
// verify against actual LATRA API documentation once WAZZAR has partner
// access, not as tested code — see
// docs/delivery-notes/PHASE2_INTERCITY_FOUNDATION.md.
@Injectable()
export class LatraProvider {
  private readonly logger = new Logger(LatraProvider.name);

  constructor(private readonly configService: ConfigService) {}

  hasRealCredentials(operator: PartnerOperator): boolean {
    return hasRealLatraCredentials(operator, this.configService);
  }

  async pollVehicleLocation(
    operator: PartnerOperator,
    vehicleRegistration: string,
  ): Promise<LatraVehiclePing> {
    if (!hasRealLatraCredentials(operator, this.configService)) {
      this.logger.debug(
        `LATRA mock poll for vehicle ${vehicleRegistration} (operator ${operator.id}) — ` +
          'no LATRA_BASE_URL and/or operator latra_api_key configured; returning no position.',
      );
      return {
        latitude: null,
        longitude: null,
        reportedAt: new Date().toISOString(),
        raw: { mock: true, vehicleRegistration },
      };
    }

    const baseUrl = this.configService.get<string>('LATRA_BASE_URL')!;
    const res = await fetch(
      `${baseUrl}/vehicles/${encodeURIComponent(vehicleRegistration)}/location`,
      { headers: { Authorization: `Bearer ${operator.latraApiKey}` } },
    );
    if (!res.ok) {
      throw new Error(`LATRA location poll failed: ${res.status} ${res.statusText}`);
    }

    const body = await res.json();
    return {
      latitude: typeof body.latitude === 'number' ? body.latitude : null,
      longitude: typeof body.longitude === 'number' ? body.longitude : null,
      reportedAt: body.reportedAt ?? new Date().toISOString(),
      raw: body,
    };
  }
}
