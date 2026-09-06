import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PartnerOperatorStatus } from '../../../database/entities/partner-operator.entity';

export class UpdatePartnerOperatorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(PartnerOperatorStatus)
  @IsOptional()
  status?: PartnerOperatorStatus;
}
