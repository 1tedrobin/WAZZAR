import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds per-document review state, alongside the existing whole-application
// `status`/`documents_verified_at` columns (AddRiderDocumentUrls) — an admin
// could previously only approve/reject a rider's entire application at
// once; this lets them also record a decision on an individual document
// (ID vs. license vs. vehicle registration vs. insurance). Defaults to an
// empty object: a rider with no entry for a given document simply hasn't
// had that document reviewed yet (treated as PENDING by the service/UI).
export class AddRiderDocumentReviews1787370000000 implements MigrationInterface {
  name = 'AddRiderDocumentReviews1787370000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "riders"
        ADD COLUMN "document_reviews" jsonb NOT NULL DEFAULT '{}';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "riders"
        DROP COLUMN "document_reviews";
    `);
  }
}
