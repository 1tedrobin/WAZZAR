# API Subscriptions (Phase 3) — 2026-09-02

Businesses can now generate their own API keys and call a small public
API directly (create/list/get shipments, read tracking) without going
through the business web app. First of Phase 3's four items to ship —
see `MASTER_GAPS_AND_ROADMAP.md`'s Phase 3 entry for the other three
(CSV bulk send, advanced invoicing, analytics dashboard — all still
not started).

## What's new

**Backend**
- `ApiKey` entity + `CreateApiKeysTable` migration (`api_keys` table).
- `business-api-keys` module: `POST/GET /business/api-keys`,
  `DELETE /business/api-keys/:id` — JWT-authenticated, BUSINESS role,
  scoped to the caller's own keys (same ownership pattern as
  `business-customers`/`business-staff`). Generates a
  `wzr_live_`-prefixed key, returns the plaintext exactly once, stores
  only a bcrypt hash (`BusinessApiKeysService`).
- `ApiKeyAuthGuard` + `@RequireScope()`: authenticates requests via an
  `X-API-Key` header instead of a JWT, builds a synthetic `JwtPayload`
  (`sub` = businessId, `roles` = [BUSINESS]) so existing service
  methods work unmodified, and enforces per-route scopes
  (`shipments:read`, `shipments:write`, `tracking:read`).
- `public-api` module: `POST/GET /v1/api/shipments`,
  `GET /v1/api/shipments/:id`, `GET /v1/api/shipments/:id/tracking` —
  API-key-authenticated, reuses `ShipmentsService`/`TrackingService`
  as-is. Deliberately a small subset — no assign/status/POD/rating
  routes; those stay operational concerns of the WAZZAR apps.
- `TrackingModule` now exports `TrackingService` (previously
  module-private) so `PublicApiModule` can reuse
  `getShipmentTracking()`.
- Tests: `business-api-keys.service.spec.ts` (10 tests: key
  generation/hashing, ownership scoping, revoke idempotency,
  `validateKey`'s prefix-then-bcrypt lookup). Full suite green (261
  passing, 22/22 suites, 0 TypeScript errors). **Update
  (2026-09-03):** at the time this note was first written, one
  unrelated pre-existing suite (`payments.service.spec.ts`) was
  failing to compile because `Payment.isMock` was referenced but never
  declared anywhere. Fixed during the full-system audit — see
  `FULL_SYSTEM_AUDIT_2026-09-03.md` — and the whole project now type-checks and
  tests cleanly.

**Frontend (business app)**
- New "API keys" nav item / page (`ApiKeysPage`): list keys (name,
  prefix, scopes, status, last used), generate a new key via
  `GenerateApiKeyModal` (name + scope checkboxes), reveal the
  plaintext key once with a copy button (`RevealedKeyBox`), revoke.
- `api.js`: `listApiKeys`, `createApiKey`, `revokeApiKey`.
- `npm run build` and the existing smoke test suite (4/4) both pass.

## Known limitations, documented rather than glossed over

- No per-key rate limiting — only the existing app-wide `ThrottlerModule`
  (60 req/min/IP) applies to `/v1/api/*` same as everything else. A
  business hammering the public API with one key isn't isolated from
  others sharing an IP, or throttled independently of its own web-app
  usage.
- No key rotation helper — revoking and generating a fresh key is the
  only path today; there's no "rotate with overlap" flow.
- No usage dashboard beyond lifetime `requestCount` / `lastUsedAt` per
  key — no request log, no per-scope breakdown, no rate/quota tier.
- No API documentation page for external developers (no published
  OpenAPI/reference doc pointing at `/v1/api/*` specifically) — Swagger
  picks the routes up under the "Public API" tag, but nothing links to
  it from the business app yet.
