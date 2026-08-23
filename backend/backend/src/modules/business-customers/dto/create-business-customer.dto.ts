import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBusinessCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  phone: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  address: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
