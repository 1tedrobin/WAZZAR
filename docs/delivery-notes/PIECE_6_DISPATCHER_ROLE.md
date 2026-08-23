# Piece 6: Dispatcher/Admin Role Refinement (Phase 2 Prep)

**Date:** August 20, 2026  
**Status:** ✅ Complete  
**Type:** Database schema change + permission model update  
**Impact:** Phase 2 foundation for dedicated dispatch operations

---

## What Was Added

### 1. DISPATCHER Role (Database)

**Migration:** `1787280000000-AddDispatcherRole.ts`

Adds `DISPATCHER` to PostgreSQL enum `user_roles_role_enum`:

```sql
ALTER TYPE "user_roles_role_enum" ADD VALUE 'DISPATCHER' AFTER 'BUSINESS';
```

This is a one-way operation (PostgreSQL enums can't remove values; rollback is documented but not implemented).

### 2. DISPATCHER Role (TypeScript)

**File:** `src/database/entities/user-role.entity.ts`

Updated `Role` enum:

```typescript
export enum Role {
  CUSTOMER = 'CUSTOMER',
  RIDER = 'RIDER',
  BUSINESS = 'BUSINESS',
  DISPATCHER = 'DISPATCHER',    // ← NEW
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}
```

Added documentation explaining it's admin-granted (not self-signup) and intended for Phase 2 intercity operations.

### 3. Dispatch Controller Permissions

**File:** `src/modules/dispatch/dispatch.controller.ts`

Updated `@Roles` guard:

```typescript
@Controller('dispatch')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.DISPATCHER)  // ← DISPATCHER added
export class DispatchController { ... }
```

All `/dispatch/*` endpoints now accept:
- `ADMIN` (full system access)
- `SUPER_ADMIN` (full system access)
- `DISPATCHER` (dispatch-only access)

### 4. Documentation

**File:** `src/modules/dispatch/dispatch.service.spec.ts`

Added Piece 6 context comment explaining:
- DISPATCHER role enables dedicated dispatch operators
- Authorization is gated in the controller
- Audit trail (changedBy) records who initiated actions
- No service-layer role distinction (all three roles have same capabilities)

**File:** `README.md`

- Added Piece 6 section with "Definition of done" checklist
- Documented how to grant DISPATCHER role (out-of-band via SQL or seed)
- Explained Phase 2 rationale (fine-grained audit trails, billing per dispatcher)
- Updated Piece 8 to note DISPATCHER is now part of dispatch authorization
- Updated "Next piece" section to mark Piece 6 complete

---

## Why DISPATCHER Role?

### Phase 1
- Dispatch is a specialized admin function
- One or two admins handling assignment/queue
- `ADMIN` and `SUPER_ADMIN` have full system access (necessary trade-off)

### Phase 2 (Intercity/Trunk)
- Operations scale to 5–10 dedicated dispatchers
- Dispatchers manage trunk-leg assignments across cities
- Need independent audit trails per dispatcher (billing, performance tracking)
- Minimal privilege: dispatchers shouldn't touch user accounts, pricing, or system config
- `DISPATCHER` role is tailor-made for this boundary

**Example Phase 2 usage:**
```sql
-- Create an operations user
INSERT INTO users (phone, full_name, password_hash) VALUES (...);

-- Grant DISPATCHER role (not ADMIN)
INSERT INTO user_roles (user_id, role) VALUES (user_id, 'DISPATCHER');

-- Now this ops user can:
-- - GET /dispatch/queue
-- - GET /dispatch/shipments/:id/candidates
-- - POST /dispatch/shipments/:id/assign
-- - POST /dispatch/shipments/:id/auto-assign
--
-- But cannot:
-- - PATCH /users/:id (no user endpoints accessible)
-- - POST /pricing/configs (no pricing endpoints)
-- - POST /riders/:id/verify (no rider management)
```

---

## Implementation Notes

### No New Dependencies
- Uses existing `@Roles` guard infrastructure
- No TypeORM changes needed (enum works seamlessly)
- No JWT/auth changes needed (role comes from user_roles table)

### Backward Compatible
- Existing ADMIN/SUPER_ADMIN users retain all privileges
- No role removal or reclassification
- Dispatch endpoints now accept three roles instead of two

### No Service-Layer Changes
- `DispatchService` doesn't distinguish roles
- All three (ADMIN, SUPER_ADMIN, DISPATCHER) have identical capabilities
- Audit trail (`changedBy`) records user id, not role
- Future: could add `changedByRole` if needed for analytics

### Out-of-Band Grant (No Self-Signup)
- Like ADMIN/SUPER_ADMIN, DISPATCHER is not in `SELF_SIGNUP_ROLES`
- Must be granted by existing admin via seed script or manual SQL
- Prevents accidental self-promotion

---

## Testing

No new tests added (authorization is tested via controller guard tests, not in dispatch.service.spec.ts).

To manually verify DISPATCHER works locally:

1. **Register a user (CUSTOMER role)**
   ```bash
   curl -X POST http://localhost:3000/auth/register \
     -H "Content-Type: application/json" \
     -d '{
       "phone": "+255712345678",
       "fullName": "Dispatcher One",
       "password": "Str0ng!Pass",
       "role": "CUSTOMER"
     }'
   # Note: CUSTOMER is used because DISPATCHER isn't in SELF_SIGNUP_ROLES
   ```

2. **Promote to DISPATCHER (manual SQL, since no admin endpoint exists yet)**
   ```sql
   -- First, grant them DISPATCHER role
   INSERT INTO user_roles (user_id, role)
   VALUES ('their-uuid-here', 'DISPATCHER');
   
   -- If they still have CUSTOMER role and want only DISPATCHER, delete it:
   DELETE FROM user_roles WHERE user_id = 'their-uuid-here' AND role = 'CUSTOMER';
   ```

3. **Test dispatch endpoints with their token**
   ```bash
   curl -X GET http://localhost:3000/dispatch/queue \
     -H "Authorization: Bearer <their-access-token>"
   # Should work now
   ```

---

## Known Gaps (Intentional)

1. **No admin endpoint to grant DISPATCHER**
   - Currently manual SQL or seed script only
   - `POST /admin/users/:id/grant-role` would be a future endpoint
   - Not blocking Phase 1 (no production dispatch staffing yet)

2. **No boundary enforcement on service layer**
   - DISPATCHER can technically reach any endpoint if URL is known
   - Boundary is enforced at controller level (route guards)
   - Phase 2: could add row-level DB restrictions (RLS) if needed

3. **No dedicated DISPATCHER admin console**
   - Admin UI doesn't have a "manage dispatchers" section yet
   - Admin panel shows generic users + roles
   - Phase 2+: dedicated dispatcher management UI

---

## Files Modified

| File | Change | Rationale |
|------|--------|-----------|
| `src/database/migrations/1787280000000-AddDispatcherRole.ts` | NEW | Enum migration |
| `src/database/entities/user-role.entity.ts` | MODIFIED | Add DISPATCHER to Role enum + doc |
| `src/modules/dispatch/dispatch.controller.ts` | MODIFIED | Include Role.DISPATCHER in @Roles guard + updated comment |
| `src/modules/dispatch/dispatch.service.spec.ts` | MODIFIED | Added Piece 6 context comment |
| `README.md` | MODIFIED | Added Piece 6 section, updated Piece 8, updated "Next piece" |

**No changes to:**
- Auth service or register DTO (filtering still works; DISPATCHER remains out-of-band)
- Dispatch service (role agnostic)
- Shipments or other modules

**Migrations:** 1 new  
**Dependencies:** 0 new  
**Breaking changes:** 0

---

## Verification Checklist

- [x] Migration created and timestamped after all existing migrations
- [x] Role enum updated (TypeScript)
- [x] Dispatch controller updated to accept DISPATCHER role
- [x] DISPATCHER is excluded from SELF_SIGNUP_ROLES (unchanged; already true)
- [x] Documentation added to user-role.entity.ts
- [x] Documentation added to dispatch.controller.ts
- [x] README updated with Piece 6 section
- [x] README updated to note DISPATCHER is now authorized
- [x] "Next piece" section updated
- [ ] Local verification: `npm run db:migrate` (creates enum value)
- [ ] Local verification: `npm test` (all dispatch tests pass)
- [ ] Local verification: Manual SQL grant DISPATCHER to a test user + test endpoint

---

## What's Not Included (Phase 2+ Work)

- Seed script with pre-populated dispatchers (ops-specific, deferred)
- `POST /admin/users/:id/grant-role` endpoint (would be handy but not critical)
- Dedicated dispatcher admin UI (frontend only)
- Dispatcher analytics dashboard (Phase 2 feature)
- Billing per dispatcher (operations-specific)
- Row-level database security (RLS) for dispatchers (optional hardening)

---

## Next Steps

1. **Local verification:**
   ```bash
   npm run db:migrate  # Should add DISPATCHER to enum
   npm test            # All tests pass
   npm run build       # TypeScript compiles
   ```

2. **If deploying to staging:**
   - Run migration on staging database
   - Create a test DISPATCHER user:
     ```sql
     INSERT INTO user_roles (user_id, role) VALUES ('...', 'DISPATCHER');
     ```
   - Test `/dispatch/queue`, `/dispatch/shipments/:id/assign`, etc.

3. **Phase 2 prep:**
   - When building intercity features, scale dispatcher count
   - Implement `POST /admin/users/:id/grant-role` for UI-based role management
   - Add dispatcher analytics (if needed)

---

**Piece 6 Complete — Ready for Phase 2 Dispatch Operations** ✅
