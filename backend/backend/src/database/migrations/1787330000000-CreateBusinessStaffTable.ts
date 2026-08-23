import { MigrationInterface, QueryRunner } from 'typeorm';

// New table for the business app's "Staff" screen — previously pure
// mock data (see docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md, "4
// mock screens with no backend feature"). Second of the 4 to get a
// real backend, after business_customers.
//
// Deliberately scoped as a TEAM ROSTER, not real login accounts — a
// business owner can record who's on their team, but this does NOT
// create a WAZZAR account those people can log in with. Giving staff
// real, scoped login access would need a proper sub-account/permission
// model (a staff member's session would need to inherit the parent
// business's shipments, but not its billing/settings, etc.) — a
// meaningfully bigger feature than this table, and not built here. See
// BusinessStaffService for the same note.
export class CreateBusinessStaffTable1787330000000 implements MigrationInterface {
  name = 'CreateBusinessStaffTable1787330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TYPE "business_staff_role_enum" AS ENUM ('MANAGER', 'STAFF');
    `);
    await queryRunner.query(`
      CREATE TYPE "business_staff_status_enum" AS ENUM ('ACTIVE', 'PENDING');
    `);

    await queryRunner.query(`
      CREATE TABLE "business_staff" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "business_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "name" varchar(150) NOT NULL,
        "email" varchar(255) NOT NULL,
        "role" "business_staff_role_enum" NOT NULL DEFAULT 'STAFF',
        "status" "business_staff_status_enum" NOT NULL DEFAULT 'PENDING',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_business_staff_business_id" ON "business_staff" ("business_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "business_staff";`);
    await queryRunner.query(`DROP TYPE "business_staff_role_enum";`);
    await queryRunner.query(`DROP TYPE "business_staff_status_enum";`);
  }
}
