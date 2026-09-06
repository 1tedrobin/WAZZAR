import { IsOptional, IsString } from 'class-validator';

export class ListHubsQueryDto {
  @IsString()
  @IsOptional()
  city?: string;
}
