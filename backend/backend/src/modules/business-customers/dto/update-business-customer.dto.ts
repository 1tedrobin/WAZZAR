import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateBusinessCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @IsOptional()
  name?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @IsOptional()
  phone?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @IsOptional()
  address?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;
}
