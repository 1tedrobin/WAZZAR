import { IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { TrackingChannelType } from '../../../database/entities/tracking-channel.entity';

// Deliberately narrower than IngestTrackingChannelDto's full
// TrackingChannelType enum — a partner's own system authenticates via
// PartnerApiKeyGuard (not a WAZZAR staff JWT), so it should only ever be
// able to claim PARTNER_SCAN or SMS_WEBHOOK for itself, never
// DISPATCHER_MANUAL or GPS_LIVE (those imply a WAZZAR-side actor) or
// LATRA_TRACKING (that's LatraPollingService's own channel, not
// something a partner pushes).
const PARTNER_ALLOWED_CHANNEL_TYPES = [
  TrackingChannelType.PARTNER_SCAN,
  TrackingChannelType.SMS_WEBHOOK,
] as const;

export class IngestPartnerPingDto {
  @IsUUID()
  legId: string;

  @IsIn(PARTNER_ALLOWED_CHANNEL_TYPES)
  channelType: TrackingChannelType;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  source?: string;

  @IsObject()
  eventData: Record<string, unknown>;
}
