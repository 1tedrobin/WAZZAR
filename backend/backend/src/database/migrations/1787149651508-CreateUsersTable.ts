import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1787149651508 implements MigrationInterface {
  name = 'CreateUsersTable1787149651508';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TYPE "users_status_enum" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "phone" varchar(20) NOT NULL UNIQUE,
        "email" varchar(255) UNIQUE,
        "password_hash" varchar(255) NOT NULL,
        "full_name" varchar(255) NOT NULL,
        "profile_photo_url" text,
        "status" "users_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_users_phone" ON "users" ("phone");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_users_email" ON "users" ("email");
    `);

    await queryRunner.query(`
      CREATE TYPE "user_roles_role_enum" AS ENUM (
        'CUSTOMER', 'RIDER', 'BUSINESS', 'ADMIN', 'SUPER_ADMIN'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "user_roles" (
        "user_id" uuid NOT NULL,
        "role" "user_roles_role_enum" NOT NULL,
        "verified_at" timestamp,
        PRIMARY KEY ("user_id", "role"),
        CONSTRAINT "fk_user_roles_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_user_roles_role" ON "user_roles" ("role");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_roles";`);
    await queryRunner.query(`DROP TYPE "user_roles_role_enum";`);
    await queryRunner.query(`DROP TABLE "users";`);
    await queryRunner.query(`DROP TYPE "users_status_enum";`);
  }
}
