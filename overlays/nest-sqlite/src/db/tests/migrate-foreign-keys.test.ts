import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openStore } from '../../../scripts/db/adapter.mjs';
import { runMigrate } from '../../../scripts/db/runner.mjs';

const BREAKPOINT = '\n--> statement-breakpoint\n';

const CREATE = [
  'CREATE TABLE `parent` (`id` text PRIMARY KEY NOT NULL, `n` integer);',
  'CREATE TABLE `child` (`id` text PRIMARY KEY NOT NULL, `parent_id` text NOT NULL, FOREIGN KEY (`parent_id`) REFERENCES `parent`(`id`) ON UPDATE no action ON DELETE cascade);',
].join(BREAKPOINT);

/** What drizzle-kit generates when a column of a referenced table changes type. */
const REBUILD = [
  'PRAGMA foreign_keys=OFF;',
  'CREATE TABLE `__new_parent` (`id` text PRIMARY KEY NOT NULL, `n` text);',
  'INSERT INTO `__new_parent`("id", "n") SELECT "id", "n" FROM `parent`;',
  'DROP TABLE `parent`;',
  'ALTER TABLE `__new_parent` RENAME TO `parent`;',
  'PRAGMA foreign_keys=ON;',
].join(BREAKPOINT);

describe('db:migrate on SQLite', () => {
  let folder: string;
  let file: string;
  const quiet = { write: () => true };

  /**
   * Writes a migrations folder holding the first `sql.length` migrations.
   *
   * @param name - The folder's name under the test folder.
   * @param sql - The SQL of each migration, in order.
   * @returns The folder.
   */
  function migrations(name: string, sql: string[]): string {
    const dir = join(folder, name);
    mkdirSync(join(dir, 'meta'), { recursive: true });
    const entries = sql.map((text, idx) => {
      const tag = `000${idx}_step`;
      writeFileSync(join(dir, `${tag}.sql`), text);
      return {
        idx,
        version: '6',
        when: 1000 * (idx + 1),
        tag,
        breakpoints: true,
      };
    });
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'sqlite', entries }),
    );
    return dir;
  }

  /** @returns The number of rows in `child`, read through a fresh connection. */
  function childRows(): number {
    const connection = new BetterSqlite3(file);
    try {
      return (
        connection.prepare('select count(*) as n from child').get() as {
          n: number;
        }
      ).n;
    } finally {
      connection.close();
    }
  }

  /**
   * Applies the first migration and inserts a parent with one child.
   *
   * @returns Nothing.
   */
  async function seed(): Promise<void> {
    await runMigrate(openStore, {
      folder: migrations('one', [CREATE]),
      out: quiet,
    });
    const connection = new BetterSqlite3(file);
    connection.exec(
      "insert into parent values ('p', 1); insert into child values ('c', 'p');",
    );
    connection.close();
  }

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'sqlite-migrate-'));
    file = join(folder, 'app.db');
    process.env.DATABASE_URL = file;
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
    rmSync(folder, { recursive: true, force: true });
  });

  it('keeps the child rows when a migration rebuilds the table they reference', async () => {
    await seed();

    await runMigrate(openStore, {
      folder: migrations('two', [CREATE, REBUILD]),
      out: quiet,
    });

    expect(childRows()).toBe(1);
  });

  it('fails when a migration leaves a row that breaks a foreign key', async () => {
    await seed();
    const orphan =
      "INSERT INTO `child` (`id`, `parent_id`) VALUES ('x', 'missing');";

    await expect(
      runMigrate(openStore, {
        folder: migrations('two', [CREATE, orphan]),
        out: quiet,
      }),
    ).rejects.toThrow(/break a foreign key \(1 in child\)/);
  });
});
