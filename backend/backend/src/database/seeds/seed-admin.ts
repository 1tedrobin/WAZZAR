/**
 * Seeds the first ADMIN user, idempotently.
 *
 * This exists because ADMIN/SUPER_ADMIN are intentionally excluded from
 * POST /auth/register (see RegisterDto's SELF_SIGNUP_ROLES) — admin grants
 * are out-of-band by design, per the "Known simplifications" note on
 * Piece 4 in ../../../README.md. Before this script, that meant a manual
 * `INSERT INTO user_roles ...` every time a fresh environment needed its
 * first admin. This script does the same thing, safely and repeatably.
 *
 * Usage:
 *   cd backend
 *   npm run db:seed:admin
 *
 * Reads credentials from env vars so nothing is hardcoded:
 *   SEED_ADMIN_PHONE      required, e.g. +255700000000
 *   SEED_ADMIN_PASSWORD   required, must satisfy RegisterDto's password
 *                         policy (min 8 chars, upper/lower/number/special)
 *   SEED_ADMIN_FULL_NAME  optional, defaults to "Admin"
 *   SEED_ADMIN_ROLE       optional, "ADMIN" or "SUPER_ADMIN", defaults to
 *                         "ADMIN"
 *
 * Idempotent: running it twice with the same phone number does not create
 * a duplicate user or duplicate role row — it upgrades an existing user to
 * the requested role if they don't already have it, and leaves everything
 * else untouched. Safe to run against a database that already has data.
 */
import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { dataSourceOptions } from '../data-source';
import { DataSource } from 'typeorm';
import { User, UserStatus } from '../entities/user.entity';
import { UserRole, Role } from '../entities/user-role.entity';

// Matches BCRYPT_SALT_ROUNDS in auth.service.ts — kept as a separate
// constant here rather than importing from the auth module, since this
// script runs outside the Nest DI context and auth.service.ts pulls in
// other providers (JwtService, repos) that would drag the whole module
// graph in for no reason.
const BCRYPT_SALT_ROUNDS = 10;

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

async function seedAdmin() {
  const phone = process.env.SEED_ADMIN_PHONE;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const fullName = process.env.SEED_ADMIN_FULL_NAME || 'Admin';
  const roleInput = (process.env.SEED_ADMIN_ROLE || 'ADMIN').toUpperCase();

  if (!phone) {
    console.error('SEED_ADMIN_PHONE is required (e.g. +255700000000). Aborting.');
    process.exit(1);
  }
  if (!password) {
    console.error('SEED_ADMIN_PASSWORD is required. Aborting.');
    process.exit(1);
  }
  if (!(ADMIN_ROLES as readonly Role[]).includes(roleInput as Role)) {
    console.error(
      `SEED_ADMIN_ROLE must be one of ${ADMIN_ROLES.join(', ')}, got "${roleInput}". Aborting.`,
    );
    process.exit(1);
  }
  const role = roleInput as Role;

  // Same password policy RegisterDto enforces — checked here too so a bad
  // password fails fast instead of creating a user that can't ever log in
  // through normal validation-consistent expectations elsewhere.
  const passwordPolicy = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9])/;
  if (password.length < 8 || !passwordPolicy.test(password)) {
    console.error(
      'SEED_ADMIN_PASSWORD must be at least 8 characters and contain an ' +
        'uppercase letter, a lowercase letter, a number, and a special ' +
        'character (same policy as /auth/register). Aborting.',
    );
    process.exit(1);
  }

  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const roleRepo = dataSource.getRepository(UserRole);

  try {
    let user = await userRepo.findOne({ where: { phone } });

    if (!user) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
      user = userRepo.create({
        phone,
        fullName,
        passwordHash,
        status: UserStatus.ACTIVE,
      });
      user = await userRepo.save(user);
      console.log(`Created user ${user.id} (${phone}).`);
    } else {
      console.log(`User ${user.id} (${phone}) already exists — not modifying password or profile.`);
    }

    const existingRole = await roleRepo.findOne({
      where: { userId: user.id, role },
    });

    if (existingRole) {
      console.log(`User already has role ${role} — nothing to do.`);
    } else {
      const userRole = roleRepo.create({
        userId: user.id,
        role,
        verifiedAt: new Date(),
      });
      await roleRepo.save(userRole);
      console.log(`Granted role ${role} to user ${user.id}.`);
    }

    console.log('Done. Log in with the phone/password above.');
  } finally {
    await dataSource.destroy();
  }
}

seedAdmin().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
