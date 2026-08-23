import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';
import { envFilePaths } from '../env-file';

// The TypeORM CLI (npm run typeorm / db:migrate) boots outside Nest, so it
// never goes through ConfigModule — it needs the same NODE_ENV-aware file
// order applied by hand here. dotenv.config() never overrides a key
// already in process.env (real deploy env vars still win), and calling it
// once per path in order means the first file that sets a given key wins,
// matching ConfigModule's envFilePath behavior in app.module.ts. See
// env-file.ts.
envFilePaths().forEach((path) => dotenv.config({ path }));

// Managed Postgres providers (Supabase, Render, most others) require SSL
// and use a certificate node-postgres won't validate by default. Local/
// Docker Postgres has no SSL at all, so this is opt-in via DATABASE_SSL
// rather than always-on — set DATABASE_SSL=true for Supabase/Render/etc.
const useSsl = process.env.DATABASE_SSL === 'true';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  entities: [__dirname + '/entities/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false, // never true outside local scratch work — migrations only
  logging: process.env.LOG_LEVEL === 'debug',
};

// Used by the TypeORM CLI (npm run typeorm / db:migrate)
export default new DataSource(dataSourceOptions);
