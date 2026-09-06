import { IsUUID } from 'class-validator';

export class ListTrackingChannelsQueryDto {
  @IsUUID()
  legId: string;
}
