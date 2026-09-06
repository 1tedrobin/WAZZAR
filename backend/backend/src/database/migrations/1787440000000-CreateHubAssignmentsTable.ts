import { MigrationInterface, QueryRunner } from 'typeorm';

// Scopes a DISPATCHER-role user to the hub(s) they operate — see
// HubAssignment entity for why this is a join table reusing the
// existing Role.DISPATCHER rather than the architecture doc's separate
// `dispatchers` table.
export class CreateHubAssignmentsTable1787440000000 implements MigrationInterface {
  name = 'CreateHubAssignmentsTable1787440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "hub_assignments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "hub_id" uuid NOT NULL REFERENCES "hubs" ("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "assigned_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "uq_hub_assignments_hub_user" UNIQUE ("hub_id", "user_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_hub_assignments_user" ON "hub_assignments" ("user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "hub_assignments";`);
  }
}
