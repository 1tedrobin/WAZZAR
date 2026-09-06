import { ArrayNotEmpty, IsArray, IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiKeyScope } from '../../../database/entities/api-key.entity';

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  // No default here on purpose — a caller has to explicitly choose
  // what a key can do rather than getting every scope by default,
  // even though every scope this ships with is fairly low-risk today.
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(ApiKeyScope, { each: true })
  scopes: ApiKeyScope[];
}
