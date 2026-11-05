import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createPool, type Pool } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { describeMigrateFailure } from '../../../scripts/db/runner.mjs';
import { randomTableName, testTarget, type TestTarget } from './support.js';

/**
 * Writes a migrations folder: the SQL files and the journal that lists them.
 *
 * @param folder - The folder to fill.
 * @param statements - One file per entry; the breakpoint marker splits a file into statements.
 * @returns Resolves when the folder is written.
 */
async function writeMigrations(
  folder: string,
  statements: string[],
): Promise<void> {
  await mkdir(join(folder, 'meta'), { recursive: true });
  const entries = statements.map((_, idx) => ({
    idx,
    version: '5',
    when: 1_730_000_000_000 + idx,
    tag: `${String(idx).padStart(4, '0')}_step`,
    breakpoints: true,
  }));
  await writeFile(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'mysql', entries }),
  );
  for (const [idx, text] of statements.entries()) {
    await writeFile(
      join(folder, `${String(idx).padStart(4, '0')}_step.sql`),
      text,
    );
  }
}

describe('what the migrator leaves and prints on a real MySQL', () => {
  let target: TestTarget;
  let pool: Pool;
  let folder: string;
  const tables: string[] = [];

  /**
   * Picks a table name and remembers it for the cleanup.
   *
   * @param label - A word for the name.
   * @returns The name.
   */
  function table(label: string): string {
    const name = randomTableName(label);
    tables.push(name);
    return name;
  }

  /**
   * Runs the real migrator over a folder with a record table of the test's own, so
   * the project's `__drizzle_migrations` is never touched.
   *
   * @param migrationsFolder - The folder.
   * @param record - The record table's name.
   * @returns Resolves when the migrator finishes.
   */
  async function runMigrator(
    migrationsFolder: string,
    record: string,
  ): Promise<void> {
    await migrate(drizzle(pool, { mode: 'default' }), {
      migrationsFolder,
      migrationsTable: record,
    });
  }

  beforeAll(async () => {
    target = await testTarget();
    pool = createPool({ uri: target.url, connectionLimit: 2 });
    folder = await mkdtemp(join(tmpdir(), 'mysql-migrate-'));
  });
  afterAll(async () => {
    // Children first: a foreign key refuses to drop the parent under them.
    for (const name of [...tables].reverse()) {
      await pool
        .query(`drop table if exists \`${name}\``)
        .catch(() => undefined);
    }
    await rm(folder, { recursive: true, force: true });
    await pool.end();
    await target.dispose();
  });

  it('keeps the child rows when a migration changes a parent that has ON DELETE CASCADE children', async () => {
    const parent = table('parent');
    const child = table('child');
    const record = table('rec_cascade');
    await writeMigrations(folder, [
      `CREATE TABLE \`${parent}\` (\`id\` char(36) NOT NULL, \`label\` varchar(20) NOT NULL, CONSTRAINT \`${parent}_id\` PRIMARY KEY(\`id\`));`,
      `CREATE TABLE \`${child}\` (\`id\` char(36) NOT NULL, \`parent_id\` char(36) NOT NULL, CONSTRAINT \`${child}_id\` PRIMARY KEY(\`id\`), CONSTRAINT \`${child}_fk\` FOREIGN KEY (\`parent_id\`) REFERENCES \`${parent}\`(\`id\`) ON DELETE cascade);`,
    ]);
    await runMigrator(folder, record);
    await pool.query(`insert into \`${parent}\` values ('p1', 'one')`);
    await pool.query(
      `insert into \`${child}\` values ('c1', 'p1'), ('c2', 'p1')`,
    );

    await writeMigrations(folder, [
      `CREATE TABLE \`${parent}\` (\`id\` char(36) NOT NULL, \`label\` varchar(20) NOT NULL, CONSTRAINT \`${parent}_id\` PRIMARY KEY(\`id\`));`,
      `CREATE TABLE \`${child}\` (\`id\` char(36) NOT NULL, \`parent_id\` char(36) NOT NULL, CONSTRAINT \`${child}_id\` PRIMARY KEY(\`id\`), CONSTRAINT \`${child}_fk\` FOREIGN KEY (\`parent_id\`) REFERENCES \`${parent}\`(\`id\`) ON DELETE cascade);`,
      `ALTER TABLE \`${parent}\` MODIFY COLUMN \`label\` varchar(120) NOT NULL;--> statement-breakpoint\nALTER TABLE \`${parent}\` ADD \`note\` text;`,
    ]);
    await runMigrator(folder, record);

    const [rows] = await pool.query(`select count(*) as n from \`${child}\``);
    expect(Number((rows as { n: number }[])[0]?.n)).toBe(2);
  });

  it('leaves the statements before the failing one committed and unrecorded, and names the failing statement', async () => {
    const first = table('half_a');
    const record = table('rec_half');
    await writeMigrations(folder, [
      `CREATE TABLE \`${first}\` (\`id\` int);--> statement-breakpoint\nALTER TABLE \`${first}\` ADD \`id\` int;`,
    ]);

    const error = await runMigrator(folder, record).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeDefined();
    const [present] = await pool.query(
      'select count(*) as n from information_schema.TABLES where TABLE_SCHEMA = database() and TABLE_NAME = ?',
      [first],
    );
    expect(Number((present as { n: number }[])[0]?.n)).toBe(1);
    const [recorded] = await pool.query(
      `select count(*) as n from \`${record}\``,
    );
    expect(Number((recorded as { n: number }[])[0]?.n)).toBe(0);
    expect(describeMigrateFailure(error)).toContain(`ALTER TABLE \`${first}\``);
  });

  it('prints the statement and the code of a unique index over duplicate rows, and no value of the rows', async () => {
    const rows = table('dup');
    const record = table('rec_dup');
    await pool.query(
      `create table \`${rows}\` (id int auto_increment primary key, email varchar(60))`,
    );
    await pool.query(
      `insert into \`${rows}\` (email) values ('MIGRATE-SENTINEL-1'), ('MIGRATE-SENTINEL-1')`,
    );
    await writeMigrations(folder, [
      `CREATE UNIQUE INDEX \`${rows}_email\` ON \`${rows}\` (\`email\`);`,
    ]);

    const error = await runMigrator(folder, record).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    const text = describeMigrateFailure(error);
    expect(text).toContain('CREATE UNIQUE INDEX');
    expect(text).toContain('ER_DUP_ENTRY');
    expect(text).not.toContain('SENTINEL');
    expect(String((error as Error).cause)).toContain('SENTINEL');
  });
});
