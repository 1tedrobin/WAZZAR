import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4 new regional payment providers, first piece: adds
// 'MOBILE_MONEY' to the existing payments_method_enum (alongside MPESA,
// STRIPE, CASH already there) so a payment can be tagged as MTN Mobile
// Money without overloading the MPESA value for a different brand. See
// docs/delivery-notes/PHASE4_REGIONAL_PAYMENT_PROVIDERS.md.
//
// down() intentionally throws rather than attempting a rollback — same
// reasoning and same shape as AddDispatcherRole1787280000000's down()
// for user_roles_role_enum: Postgres has no DROP VALUE for enums, and
// safely removing one means recreating the type and re-pointing every
// column that references it, which isn't something to do generically
// without knowing whether MOBILE_MONEY rows exist by the time this
// might be rolled back.
export class AddMobileMoneyToPaymentMethodEnum1787400000000
  implements MigrationInterface
{
  name = 'AddMobileMoneyToPaymentMethodEnum1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "payments_method_enum" ADD VALUE 'MOBILE_MONEY';
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    throw new Error(
      'Rollback not supported: MOBILE_MONEY cannot be removed from ' +
        "payments_method_enum automatically. Manual intervention required " +
        "(see AddDispatcherRole1787280000000's down() for the SQL shape).",
    );
  }
}
