import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePartnerOperatorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;
}
