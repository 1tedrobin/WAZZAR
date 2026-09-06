import { IsEnum, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { TrackingChannelType } from '../../../database/entities/tracking-channel.entity';

export class IngestTrackingChannelDto {
  @IsUUID()
  legId: string;

  @IsEnum(TrackingChannelType)
  channelType: TrackingChannelType;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  source?: string;

  @IsObject()
  eventData: Record<string, unknown>;
}
