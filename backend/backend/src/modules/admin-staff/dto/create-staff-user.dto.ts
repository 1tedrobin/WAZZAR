import { IsEnum, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { Role } from '../../../database/entities/user-role.entity';

// Staff-only subset — this DTO deliberately can't grant CUSTOMER, RIDER, or
// BUSINESS (those come from the normal self-signup path in
// auth/dto/register.dto.ts). Mirrors what backend/backend/src/database/seeds/seed-admin.ts
// already validates, exposed here as a real endpoint instead of a CLI-only script.
const STAFF_ROLES = [Role.DISPATCHER, Role.ADMIN, Role.SUPER_ADMIN] as const;

export class CreateStaffUserDto {
  @IsString()
  phone: string;

  // Only required when creating a brand-new user. Omit this field to
  // promote an existing user (found by phone) to a staff role instead —
  // the service treats a missing password as "this must already exist".
  @IsOptional()
  @IsString()
  @MinLength(8)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9])/, {
    message:
      'password must contain an uppercase letter, a lowercase letter, a number, and a special character',
  })
  password?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsEnum(STAFF_ROLES, {
    message: `role must be one of ${STAFF_ROLES.join(', ')}`,
  })
  role: Role;
}