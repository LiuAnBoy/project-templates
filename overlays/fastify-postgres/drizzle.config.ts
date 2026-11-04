import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit's settings: `pnpm db:generate` reads the schema and writes SQL
 * into `drizzle/`. Applying is `pnpm db:migrate`, never `drizzle-kit push`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
});
