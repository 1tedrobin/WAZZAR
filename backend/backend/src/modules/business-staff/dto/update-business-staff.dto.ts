import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { BusinessStaffRole, BusinessStaffStatus } from '../../../database/entities/business-staff.entity';

export class UpdateBusinessStaffDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @IsOptional()
  name?: string;

  @IsEmail()
  @MaxLength(255)
  @IsOptional()
  email?: string;

  @IsEnum(BusinessStaffRole)
  @IsOptional()
  role?: BusinessStaffRole;

  @IsEnum(BusinessStaffStatus)
  @IsOptional()
  status?: BusinessStaffStatus;
}
