import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds DISPATCHER role to support dedicated dispatch operator identity.
 *
 * Context: Phase 2 (intercity/trunk legs) requires audit trails and billing
 * attribution per dispatcher. This migration adds DISPATCHER to the role enum
 * — an admin-granted role (like ADMIN/SUPER_ADMIN), not self-signup.
 *
 * Backward compatibility: Existing ADMIN/SUPER_ADMIN users retain all
 * dispatch permissions (no role removals). New DISPATCHER users can be
 * granted independently, allowing fine-grained access control.
 */
export class AddDispatcherRole1787280000000 implements MigrationInterface {
  name = 'AddDispatcherRole1787280000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 'DISPATCHER' to the user_roles_role_enum
    await queryRunner.query(`
      ALTER TYPE "user_roles_role_enum" ADD VALUE 'DISPATCHER' AFTER 'BUSINESS';
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Rollback: This is tricky because PostgreSQL enums can't directly remove
    // values. We'd need to:
    // 1. Create a new enum without DISPATCHER
    // 2. Update the column type
    // 3. Drop the old enum
    //
    // For now, we're intentionally not supporting rollback — adding a role
    // is a one-way operation. If needed, a manual down migration should:
    //
    //   -- Ensure no users have DISPATCHER role
    //   -- DELETE FROM user_roles WHERE role = 'DISPATCHER';
    //
    //   -- Create new enum
    //   -- CREATE TYPE "user_roles_role_enum_new" AS ENUM (...without DISPATCHER...);
    //
    //   -- Alter table
    //   -- ALTER TABLE user_roles ALTER COLUMN role TYPE "user_roles_role_enum_new"
    //     USING role::text::"user_roles_role_enum_new";
    //
    //   -- Drop old enum
    //   -- DROP TYPE "user_roles_role_enum";
    //
    //   -- Rename new enum
    //   -- ALTER TYPE "user_roles_role_enum_new" RENAME TO "user_roles_role_enum";
    //
    // Not implementing this by default — enum rollbacks are almost never needed.
    throw new Error(
      'Rollback not supported: DISPATCHER role cannot be easily removed from enum. ' +
      'Manual intervention required if needed.',
    );
  }
}
