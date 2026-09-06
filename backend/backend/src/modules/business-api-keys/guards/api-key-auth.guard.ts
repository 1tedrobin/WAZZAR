import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyScope } from '../../../database/entities/api-key.entity';
import { Role } from '../../../database/entities/user-role.entity';
import { JwtPayload } from '../../auth/jwt-payload.interface';
import { BusinessApiKeysService } from '../business-api-keys.service';
import { REQUIRE_SCOPE_KEY } from '../decorators/require-scope.decorator';

// Sits in front of PublicApiController's routes instead of
// JwtAuthGuard — a public-API caller authenticates with a long-lived
// API key (X-API-Key header), not a short-lived login token. On
// success it populates `request.user` with a JwtPayload-shaped object
// (sub = the key's businessId, roles = [BUSINESS]) so the reused
// ShipmentsService/TrackingService methods — which only care about
// `.sub` and `.roles` — work completely unmodified, and it populates
// `request.apiKey` with the full key record for anything that wants
// it (nothing does yet, but it's there rather than thrown away).
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeysService: BusinessApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey = request.headers['x-api-key'];

    if (!rawKey || typeof rawKey !== 'string') {
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    const apiKey = await this.apiKeysService.validateKey(rawKey);
    if (!apiKey) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    const requiredScopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(REQUIRE_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredScopes?.length && !requiredScopes.some((scope) => apiKey.scopes.includes(scope))) {
      throw new ForbiddenException(`This API key is missing a required scope: ${requiredScopes.join(' or ')}`);
    }

    request.apiKey = apiKey;
    request.user = { sub: apiKey.businessId, phone: '', roles: [Role.BUSINESS] } satisfies JwtPayload;
    return true;
  }
}
