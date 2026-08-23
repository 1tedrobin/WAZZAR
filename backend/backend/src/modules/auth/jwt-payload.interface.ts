import { Role } from '../../database/entities/user-role.entity';

// `sub` follows the JWT convention (subject = user id). Roles are embedded
// so guards can check access without a DB round-trip on every request.
export interface JwtPayload {
  sub: string;
  phone: string;
  roles: Role[];
}
