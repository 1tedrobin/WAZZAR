import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProofOfDeliveryTable1787200000000 implements MigrationInterface {
  name = 'CreateProofOfDeliveryTable1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // shipment_id is the primary key — exactly one proof-of-delivery row
    // per shipment, same reasoning as rider_locations keying on rider_id.
    await queryRunner.query(`
      CREATE TABLE "proof_of_delivery" (
        "shipment_id" uuid PRIMARY KEY,
        "recipient_name" varchar(255) NOT NULL,
        "photo_url" text,
        "notes" text,
        "delivered_by" uuid NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_proof_of_delivery_shipment"
          FOREIGN KEY ("shipment_id") REFERENCES "shipments" ("id") ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "proof_of_delivery";`);
  }
}
