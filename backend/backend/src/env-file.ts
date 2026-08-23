// Single source of truth for "which .env file(s) does this environment
// load", used by both ConfigModule (app.module.ts, the running app) and
// the TypeORM CLI (database/data-source.ts, migrations run outside Nest).
// Keeping one function means the app and the migration CLI can't silently
// load different config for the same deploy.
//
// This is the code-only half of the staging/production split: it lets a
// real NODE_ENV=staging or NODE_ENV=production host point at its own env
// file instead of everyone sharing one `.env`. It does NOT provision a
// staging host, database, or Netlify/Render site — see
// docs/delivery-notes/DEPLOYMENT.md for the one-time account-setup half
// of that, which is unchanged by this.
//
// Convention (first file found wins for a given key — dotenv/ConfigModule
// both stop at the first value they see for a variable, later files in
// the array only fill in anything the earlier ones didn't set):
//   NODE_ENV=production  -> .env.production, then .env
//   NODE_ENV=staging     -> .env.staging, then .env
//   NODE_ENV=development -> .env
//   NODE_ENV=test         -> .env.test if present, then .env
//   (unset)               -> .env
//
// A real deploy is expected to set NODE_ENV as a real process env var
// (Render/Railway/etc. dashboard, systemd unit, Docker `-e`), not rely on
// a value baked into any .env file — process.env always wins over
// anything dotenv loads, so this only ever fills gaps.
export function envFilePaths(): string[] {
  const env = process.env.NODE_ENV;

  if (env === 'production') return ['.env.production', '.env'];
  if (env === 'staging') return ['.env.staging', '.env'];
  if (env === 'test') return ['.env.test', '.env'];

  // development, or NODE_ENV unset — local default, unchanged from before
  // this split existed.
  return ['.env'];
}
