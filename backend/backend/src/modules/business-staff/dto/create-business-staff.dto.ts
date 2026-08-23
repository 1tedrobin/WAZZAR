import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { BusinessStaffRole } from '../../../database/entities/business-staff.entity';

export class CreateBusinessStaffDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsEnum(BusinessStaffRole)
  @IsOptional()
  role?: BusinessStaffRole;
}
