import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../jwt-payload.interface';

// Usage: findMine(@CurrentUser() user: JwtPayload) — populated on any
// route behind a guard that sets request.user in this shape. That's
// JwtAuthGuard on every normal web-app route, and also
// ApiKeyAuthGuard (see business-api-keys/guards) on the public API's
// routes, which builds a synthetic JwtPayload from the caller's API
// key so this decorator (and every service method that takes a
// JwtPayload) works identically either way.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
