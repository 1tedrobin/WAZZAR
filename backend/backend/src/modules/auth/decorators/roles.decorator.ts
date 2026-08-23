import { SetMetadata } from '@nestjs/common';
import { Role } from '../../../database/entities/user-role.entity';

export const ROLES_KEY = 'roles';

// Usage: @Roles(Role.ADMIN) — must be paired with JwtAuthGuard +
// RolesGuard (RolesGuard reads req.user.roles, which only JwtAuthGuard
// populates), e.g. @UseGuards(JwtAuthGuard, RolesGuard).
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
