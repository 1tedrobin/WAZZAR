import { SetMetadata } from '@nestjs/common';
import { ApiKeyScope } from '../../../database/entities/api-key.entity';

export const REQUIRE_SCOPE_KEY = 'requireScope';

// Usage: @RequireScope(ApiKeyScope.SHIPMENTS_WRITE) — a key needs at
// least one of the listed scopes (OR, not AND; every route in this
// pass only ever needs one). Mirrors @Roles()'s shape deliberately —
// same "list of things the caller needs at least one of" pattern.
export const RequireScope = (...scopes: ApiKeyScope[]) => SetMetadata(REQUIRE_SCOPE_KEY, scopes);
