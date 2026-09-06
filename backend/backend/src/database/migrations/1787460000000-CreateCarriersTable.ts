import { MigrationInterface, QueryRunner } from 'typeorm';

// A single bus/truck/van belonging to a PartnerOperator. See Carrier
// entity for the routes/schedule JSONB design notes.
export class CreateCarriersTable1787460000000 implements MigrationInterface {
  name = 'CreateCarriersTable1787460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "carriers_vehicle_type_enum" AS ENUM ('BUS', 'TRUCK', 'VAN');
    `);
    await queryRunner.query(`
      CREATE TYPE "carriers_status_enum" AS ENUM ('ACTIVE', 'INACTIVE');
    `);

    await queryRunner.query(`
      CREATE TABLE "carriers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "partner_operator_id" uuid NOT NULL
          REFERENCES "partner_operators" ("id") ON DELETE CASCADE,
        "vehicle_type" "carriers_vehicle_type_enum" NOT NULL,
        "registration" varchar(100) NOT NULL,
        "capacity_kg" int,
        "routes" jsonb NOT NULL DEFAULT '[]',
        "schedule" jsonb,
        "status" "carriers_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);

    // Every list/lookup is "this partner's fleet" or "which carriers
    // are ACTIVE right now for dispatch ranking" — matches the two real
    // query shapes CarriersService/LegsService use.
    await queryRunner.query(`
      CREATE INDEX "idx_carriers_partner_operator" ON "carriers" ("partner_operator_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_carriers_status" ON "carriers" ("status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "carriers";`);
    await queryRunner.query(`DROP TYPE "carriers_status_enum";`);
    await queryRunner.query(`DROP TYPE "carriers_vehicle_type_enum";`);
  }
}
