import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { Role } from '../../../database/entities/user-role.entity';

// Self-signup is limited to these three — ADMIN / SUPER_ADMIN are granted
// out-of-band, never through the public endpoint.
export const SELF_SIGNUP_ROLES = [Role.CUSTOMER, Role.RIDER, Role.BUSINESS] as const;

export class RegisterDto {
  @IsPhoneNumber(undefined, { message: 'phone must be a valid phone number, e.g. +255712345678' })
  phone: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  // Min 8 chars, at least one uppercase, one lowercase, one number, one
  // special char — matches the password policy in
  // WAZZAR_SYSTEM_ARCHITECTURE.md's Account Security section.
  @IsString()
  @MinLength(8)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9])/, {
    message:
      'password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  password: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsIn(SELF_SIGNUP_ROLES)
  role: (typeof SELF_SIGNUP_ROLES)[number];
}
