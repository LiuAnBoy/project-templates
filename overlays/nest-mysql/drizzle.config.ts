import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit's settings: `pnpm db:generate` reads the schema and writes SQL
 * into `drizzle/`. Applying is `pnpm db:migrate`, never `drizzle-kit push`.
 * `pnpm db:pull` is the only command that connects, and reads `DATABASE_URL`.
 */
export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
