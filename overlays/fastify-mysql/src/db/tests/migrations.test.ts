import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findPending,
  findSkipped,
  isAheadOfDisk,
  readJournal,
  type JournalEntry,
} from '../../../scripts/db/journal.mjs';
import {
  describeMigrateFailure,
  runMigrate,
  runStatus,
  type Store,
} from '../../../scripts/db/runner.mjs';

const journal: JournalEntry[] = [
  { idx: 0, tag: '0000_init', when: 1000 },
  { idx: 1, tag: '0001_orders', when: 2000 },
  { idx: 2, tag: '0002_items', when: 3000 },
];

describe('the pending rule', () => {
  it('treats everything as pending when nothing was ever applied', () => {
    expect(findPending(journal, null)).toEqual(journal);
    expect(findPending(journal, [])).toEqual(journal);
  });

  it('is the entries newer than the newest recorded stamp', () => {
    expect(findPending(journal, [1000]).map((e) => e.tag)).toEqual([
      '0001_orders',
      '0002_items',
    ]);
    expect(findPending(journal, [1000, 2000, 3000])).toEqual([]);
  });

  it('names an entry older than the newest stamp and absent from the record as skipped', () => {
    // 0001 was generated on a branch and merged after 0002 had already run.
    expect(findSkipped(journal, [1000, 3000]).map((e) => e.tag)).toEqual([
      '0001_orders',
    ]);
    expect(findPending(journal, [1000, 3000])).toEqual([]);
    expect(findSkipped(journal, [1000, 2000, 3000])).toEqual([]);
    expect(findSkipped(journal, null)).toEqual([]);
  });

  it('notices a database that ran a migration this checkout lacks', () => {
    expect(isAheadOfDisk(journal, [1000, 9000])).toBe(true);
    expect(isAheadOfDisk(journal, [1000, 3000])).toBe(false);
    expect(isAheadOfDisk([], null)).toBe(false);
  });
});

describe('readJournal', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'journal-'));
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('reads no migrations from a folder with no journal', async () => {
    expect(await readJournal(join(folder, 'missing'))).toEqual([]);
  });

  it('sorts the entries by their stamp', async () => {
    await mkdir(join(folder, 'meta'));
    await writeFile(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', entries: [journal[1], journal[0]] }),
    );
    expect((await readJournal(folder)).map((e) => e.tag)).toEqual([
      '0000_init',
      '0001_orders',
    ]);
  });

  it('refuses a journal of the wrong shape', async () => {
    await mkdir(join(folder, 'meta'));
    await writeFile(join(folder, 'meta', '_journal.json'), '{}');
    await expect(readJournal(folder)).rejects.toThrow(/entries/);
  });
});

describe('the migration runner', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'runner-'));
    await mkdir(join(folder, 'meta'));
    await writeFile(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', entries: journal }),
    );
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  /**
   * A fake store whose record starts as given and grows when `migrate` runs.
   *
   * @param applied - The stamps recorded at the start, or null for no record.
   * @param migrated - Whether `migrate` records the journal; false leaves work behind.
   * @returns The store and a log of what was called.
   */
  function fakeStore(applied: number[] | null, migrated = true) {
    const calls: string[] = [];
    let record = applied;
    const store: Store = {
      table: 'record',
      listApplied: () => Promise.resolve(record),
      migrate: () => {
        calls.push('migrate');
        if (migrated) record = journal.map((entry) => entry.when);
        return Promise.resolve();
      },
      close: () => {
        calls.push('close');
        return Promise.resolve();
      },
    };
    return { open: () => Promise.resolve(store), calls };
  }

  /** @returns A writer that keeps what it was given, and that text. */
  function capture() {
    const chunks: string[] = [];
    return { out: { write: (text: string) => chunks.push(text) }, chunks };
  }

  it('names the pending migrations before applying and the record after', async () => {
    const { open, calls } = fakeStore([1000]);
    const { out, chunks } = capture();

    await runMigrate(open, { folder, out });

    const text = chunks.join('');
    expect(text).toContain('Migrations on disk: 3, already applied: 1');
    expect(text).toContain('Applying 2 pending migration(s):');
    expect(text).toContain('Recorded in record:');
    expect(text).toContain('0002_items');
    expect(calls).toEqual(['migrate', 'close']);
  });

  it('does nothing and says so when the database is up to date', async () => {
    const { open, calls } = fakeStore([1000, 2000, 3000]);
    const { out, chunks } = capture();

    await runMigrate(open, { folder, out });

    expect(chunks.join('')).toContain('No pending migrations.');
    expect(calls).toEqual(['close']);
  });

  it('runs the store verification after a migration and when nothing is pending', async () => {
    for (const applied of [[1000], [1000, 2000, 3000]]) {
      const { open, calls } = fakeStore(applied);
      const store = await open();
      store.verify = () => {
        calls.push('verify');
        return Promise.resolve();
      };

      await runMigrate(() => Promise.resolve(store), {
        folder,
        out: capture().out,
      });

      expect(calls).toContain('verify');
    }
  });

  it('fails when the store verification fails, even though nothing is pending', async () => {
    const { open, calls } = fakeStore([1000, 2000, 3000]);
    const store = await open();
    store.verify = () => Promise.reject(new Error('data is inconsistent'));
    const { out, chunks } = capture();

    await expect(
      runMigrate(() => Promise.resolve(store), { folder, out }),
    ).rejects.toThrow('data is inconsistent');
    expect(chunks.join('')).toContain('No pending migrations.');
    expect(calls).toEqual(['close']);
  });

  it('fails and names an entry the migrator would skip silently', async () => {
    const { open, calls } = fakeStore([1000, 3000]);
    const { out, chunks } = capture();

    await expect(runMigrate(open, { folder, out })).rejects.toThrow(
      /merged after a newer one/,
    );
    expect(chunks.join('')).toContain('0001_orders');
    expect(calls).toEqual(['close']);
    await expect(runStatus(open, { folder, out })).rejects.toThrow();
  });

  it('warns when the database holds a migration the checkout lacks', async () => {
    const { open } = fakeStore([1000, 2000, 3000, 9000]);
    const { out, chunks } = capture();

    await runMigrate(open, { folder, out });

    expect(chunks.join('')).toContain('Warning: the database recorded');
  });

  it('fails when the migrator leaves work behind', async () => {
    const { open } = fakeStore(null, false);
    const { out } = capture();

    await expect(runMigrate(open, { folder, out })).rejects.toThrow(
      /left work behind/,
    );
  });

  it('lists the pending migrations in status and never migrates', async () => {
    const { open, calls } = fakeStore(null);
    const { out, chunks } = capture();

    await runStatus(open, { folder, out });

    const text = chunks.join('');
    expect(text).toContain('Pending migrations (3):');
    expect(text).toContain('0000_init');
    expect(calls).toEqual(['close']);
  });

  it('migrates an empty project as a no-op', async () => {
    const { open, calls } = fakeStore(null);
    const { out, chunks } = capture();

    await runMigrate(open, { folder: join(folder, 'missing'), out });

    expect(chunks.join('')).toContain('No pending migrations.');
    expect(calls).toEqual(['close']);
  });
});

describe('describeMigrateFailure', () => {
  it('prints fixed text and the code for a connection failure, never the host or the user', () => {
    const refused = Object.assign(
      new Error('connect ECONNREFUSED 10.1.2.3:5432'),
      {
        code: 'ECONNREFUSED',
      },
    );
    const aggregate = new AggregateError([refused], '');
    const auth = Object.assign(
      new Error('password authentication failed for user "secret-user"'),
      { code: '28P01' },
    );

    for (const error of [aggregate, auth, new Error('q', { cause: refused })]) {
      const text = describeMigrateFailure(error);
      expect(text).toMatch(/Cannot reach or open the database/);
      expect(text).not.toMatch(/10\.1\.2\.3|secret-user/);
    }
    expect(describeMigrateFailure(aggregate)).toContain('ECONNREFUSED');
  });

  it('treats a missing database and a TLS failure as a connection failure, never printing their names', () => {
    const missing = Object.assign(
      new Error('database "secret-db" does not exist'),
      { code: '3D000' },
    );
    const tls = Object.assign(
      new Error(
        "Hostname/IP does not match certificate's altnames: Host: secret-host.internal",
      ),
      { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
    );

    const missingText = describeMigrateFailure(missing);
    const tlsText = describeMigrateFailure(new Error('query', { cause: tls }));

    expect(missingText).toMatch(/Cannot reach or open the database \(3D000\)/);
    expect(missingText).not.toContain('secret-db');
    expect(tlsText).toMatch(
      /Cannot reach or open the database \(ERR_TLS_CERT_ALTNAME_INVALID\)/,
    );
    expect(tlsText).not.toContain('secret-host');
  });

  it('prints the statement and every cause of a SQL failure, and never an empty line', () => {
    const cause = Object.assign(new Error('relation "orders" already exists'), {
      code: '42P07',
    });
    const failed = Object.assign(
      new Error('Failed query: create table orders\nparams: SECRET'),
      { query: 'create table orders', params: ['SECRET'], cause },
    );

    const text = describeMigrateFailure(failed);

    expect(text).toBe(
      'Failed query: create table orders\n  caused by: relation "orders" already exists',
    );
    expect(
      describeMigrateFailure(new AggregateError([new Error('first')], '')),
    ).toBe('first');
    expect(describeMigrateFailure(new Error('DATABASE_URL is required'))).toBe(
      'DATABASE_URL is required',
    );
  });
});
