import { MigrationInterface, QueryRunner } from 'typeorm';

// Bus/trucking companies WAZZAR contracts with for TRUNK legs. See
// PartnerOperator entity for the api_key_hash / latra_api_key design
// notes.
export class CreatePartnerOperatorsTable1787450000000 implements MigrationInterface {
  name = 'CreatePartnerOperatorsTable1787450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "partner_operators_status_enum" AS ENUM ('ACTIVE', 'SUSPENDED');
    `);

    await queryRunner.query(`
      CREATE TABLE "partner_operators" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "phone" varchar(20),
        "email" varchar(255),
        "api_key_hash" varchar(255) NOT NULL,
        "latra_api_key" varchar(255),
        "status" "partner_operators_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "partner_operators";`);
    await queryRunner.query(`DROP TYPE "partner_operators_status_enum";`);
  }
}
