import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds columns for the document URLs the rider onboarding UI has always
// collected in principle, but had nowhere real to store — see
// MASTER_GAPS_AND_ROADMAP.md ("File/photo upload endpoint"). Populated
// by clients calling POST /uploads first, then passing the returned
// URLs into POST /riders. All nullable: existing rider rows (created
// before this migration, or by any admin/dev flow that skips document
// upload) stay valid.
export class AddRiderDocumentUrls1787300000000 implements MigrationInterface {
  name = 'AddRiderDocumentUrls1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "riders"
        ADD COLUMN "id_document_url" varchar(500),
        ADD COLUMN "license_document_url" varchar(500),
        ADD COLUMN "vehicle_registration_document_url" varchar(500),
        ADD COLUMN "insurance_document_url" varchar(500);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "riders"
        DROP COLUMN "id_document_url",
        DROP COLUMN "license_document_url",
        DROP COLUMN "vehicle_registration_document_url",
        DROP COLUMN "insurance_document_url";
    `);
  }
}
