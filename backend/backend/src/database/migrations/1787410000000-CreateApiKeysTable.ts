import { MigrationInterface, QueryRunner } from 'typeorm';

// New table backing Phase 3's "API subscriptions" feature — lets a
// business generate its own API key(s) and call a small public API
// surface (POST/GET shipments, GET tracking) directly, instead of
// only through the business web app. See
// docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md's Phase 3 section.
//
// Only a bcrypt hash of each key is ever stored — same principle as
// `users.password_hash` — the plaintext key is shown to the caller
// exactly once, at creation time, and cannot be recovered afterwards
// (only revoked and replaced with a new one). `key_prefix` is the
// non-secret leading segment of the key, kept in the clear so lookups
// can narrow to a handful of candidate rows instead of bcrypt-
// comparing against the whole table on every request — see
// ApiKeyAuthGuard.
export class CreateApiKeysTable1787410000000 implements MigrationInterface {
  name = 'CreateApiKeysTable1787410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TYPE "api_key_scope_enum" AS ENUM ('shipments:read', 'shipments:write', 'tracking:read');
    `);
    await queryRunner.query(`
      CREATE TYPE "api_key_status_enum" AS ENUM ('ACTIVE', 'REVOKED');
    `);

    await queryRunner.query(`
      CREATE TABLE "api_keys" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "business_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "name" varchar(100) NOT NULL,
        "key_prefix" varchar(20) NOT NULL,
        "key_hash" varchar NOT NULL,
        "scopes" "api_key_scope_enum"[] NOT NULL DEFAULT '{}',
        "status" "api_key_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "last_used_at" timestamp,
        "request_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "revoked_at" timestamp
      );
    `);

    // Every business-facing list/ownership check is "this business's
    // own keys" — the one index that matters for that shape.
    await queryRunner.query(`
      CREATE INDEX "idx_api_keys_business_id" ON "api_keys" ("business_id");
    `);
    // ApiKeyAuthGuard's hot path: given an incoming key, narrow to
    // rows sharing its prefix before bcrypt-comparing the rest.
    await queryRunner.query(`
      CREATE INDEX "idx_api_keys_key_prefix" ON "api_keys" ("key_prefix");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "api_keys";`);
    await queryRunner.query(`DROP TYPE "api_key_scope_enum";`);
    await queryRunner.query(`DROP TYPE "api_key_status_enum";`);
  }
}
