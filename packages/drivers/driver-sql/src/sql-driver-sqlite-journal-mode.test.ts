// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3941: every ObjectStack SQLite database used to run SQLite's built-in
// `journal_mode = delete`, which is the worst mode for the platform's normal
// shape — several processes on one file (a dev server, `os migrate`, a test
// run). `SqlDriver.connect()` now asks a file-backed database for WAL, with an
// escape hatch for the filesystems where WAL cannot work.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from './sql-driver.js';

const dirs: string[] = [];
const drivers: SqlDriver[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-journal-'));
  dirs.push(dir);
  return join(dir, 'app.db');
}

function make(cfg: Record<string, unknown>): SqlDriver & { knex: any; logger: any } {
  const d = new SqlDriver({ useNullAsDefault: true, ...cfg } as any);
  drivers.push(d);
  return d as any;
}

function sqlite(filename: string, cfg: Record<string, unknown> = {}) {
  return make({ client: 'better-sqlite3', connection: { filename }, ...cfg });
}

/** `PRAGMA journal_mode` as the file itself reports it. */
async function journalMode(driver: any): Promise<string> {
  const rows = await driver.knex.raw('PRAGMA journal_mode');
  return String(rows[0].journal_mode).toLowerCase();
}

/** Silence + capture the driver's warnings. */
function captureWarnings(driver: any): string[] {
  const seen: string[] = [];
  driver.logger = { warn: (msg: string) => seen.push(String(msg)) };
  return seen;
}

/**
 * Stand in for `knex.raw`, which knex itself defines read-only. `pass` runs the
 * real thing, so a stub only has to describe the statements it cares about.
 */
function stubRaw(
  driver: any,
  impl: (sql: string, pass: () => Promise<any>) => Promise<any>,
): void {
  const real = driver.knex.raw.bind(driver.knex);
  Object.defineProperty(driver.knex, 'raw', {
    configurable: true,
    writable: true,
    value: (sql: string, ...rest: unknown[]) =>
      impl(String(sql), () => real(sql, ...rest) as Promise<any>),
  });
}

const ENV = 'OS_DATABASE_SQLITE_JOURNAL_MODE';
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV];
  delete process.env[ENV];
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
  await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

describe('SqlDriver — SQLite journal mode (#3941)', () => {
  it('puts a file-backed database in WAL mode on connect', async () => {
    const file = tempDb();
    const d = sqlite(file);
    const warnings = captureWarnings(d);

    await d.connect();

    expect(await journalMode(d)).toBe('wal');
    expect(warnings).toEqual([]);
    // The shared-memory index and the log itself only exist while a connection
    // is attached — which is exactly what makes occupancy visible (#3940).
    expect(existsSync(`${file}-wal`)).toBe(true);
  });

  it('converts an existing rollback-journal database in place', async () => {
    const file = tempDb();

    const first = sqlite(file, { sqliteJournalMode: 'delete' });
    await first.connect();
    await first.knex.raw('CREATE TABLE t (a integer)');
    await first.knex.raw('INSERT INTO t VALUES (1)');
    expect(await journalMode(first)).toBe('delete');
    await first.disconnect();

    const second = sqlite(file);
    await second.connect();
    expect(await journalMode(second)).toBe('wal');
    // Conversion is a header change, not a rebuild: every row survives it.
    const rows = await second.knex.raw('SELECT a FROM t');
    expect(rows).toEqual([{ a: 1 }]);
  });

  it('keeps the ADR-0057 auto_vacuum=INCREMENTAL default alongside WAL', async () => {
    const d = sqlite(tempDb());
    await d.connect();

    expect(await journalMode(d)).toBe('wal');
    const av = await d.knex.raw('PRAGMA auto_vacuum');
    expect(av[0].auto_vacuum).toBe(2); // 2 = INCREMENTAL
    // The reclaim path ADR-0057 relies on still runs under WAL.
    await expect(d.knex.raw('PRAGMA incremental_vacuum')).resolves.toBeDefined();
  });

  it('leaves `:memory:` alone — it has no journal and nobody to share it with', async () => {
    const d = sqlite(':memory:');
    const warnings = captureWarnings(d);

    await d.connect();

    expect(await journalMode(d)).toBe('memory');
    expect(warnings).toEqual([]);
  });

  it('is a no-op for non-SQLite dialects', async () => {
    const d = make({ client: 'pg', connection: 'postgres://u:p@127.0.0.1:1/d' });
    const raw = vi.spyOn(d.knex, 'raw');
    // `ensureDatabaseExists` probes `SELECT 1` on pg and fails to reach the
    // host; the point is only that no PRAGMA is ever issued.
    await d.connect().catch(() => {});
    for (const call of raw.mock.calls) {
      expect(String(call[0])).not.toMatch(/journal_mode/i);
    }
  });

  describe('opt-out for filesystems that cannot host WAL', () => {
    it('applies `delete` from config, reverting a database already in WAL', async () => {
      const file = tempDb();
      const converted = sqlite(file);
      await converted.connect();
      expect(await journalMode(converted)).toBe('wal');
      await converted.disconnect();

      // Journal mode is persistent, so opting out has to *apply* `delete`:
      // merely skipping would leave the database in WAL forever.
      const optedOut = sqlite(file, { sqliteJournalMode: 'delete' });
      const warnings = captureWarnings(optedOut);
      await optedOut.connect();

      expect(await journalMode(optedOut)).toBe('delete');
      expect(warnings).toEqual([]);
      expect(existsSync(`${file}-wal`)).toBe(false);
    });

    it(`honours ${ENV}=delete`, async () => {
      process.env[ENV] = 'delete';
      const d = sqlite(tempDb());
      await d.connect();
      expect(await journalMode(d)).toBe('delete');
    });

    it('lets an explicit driver config outrank the environment', async () => {
      process.env[ENV] = 'delete';
      const d = sqlite(tempDb(), { sqliteJournalMode: 'wal' });
      await d.connect();
      expect(await journalMode(d)).toBe('wal');
    });

    it('reports an unrecognised mode and stays on WAL rather than silently opting out', async () => {
      process.env[ENV] = 'wal2';
      const d = sqlite(tempDb());
      const warnings = captureWarnings(d);

      await d.connect();

      expect(await journalMode(d)).toBe('wal');
      expect(warnings.join('\n')).toMatch(/Ignoring SQLite journal mode 'wal2'/);
    });
  });

  describe('failure modes that are not loud on their own', () => {
    it('reports a silent refusal instead of assuming the mode took', async () => {
      const file = tempDb();
      const d = sqlite(file);
      const warnings = captureWarnings(d);
      // What a filesystem that cannot host WAL answers: the old mode, no error.
      stubRaw(d, (sql, pass) =>
        /journal_mode\s*=/i.test(sql) ? Promise.resolve([{ journal_mode: 'delete' }]) : pass(),
      );

      await expect(d.connect()).resolves.toBeUndefined();

      expect(warnings.join('\n')).toMatch(/kept journal_mode='delete'/);
      expect(warnings.join('\n')).toMatch(new RegExp(`${ENV}=delete`));
    });

    it('reverts to `delete` when WAL is accepted but cannot be read through', async () => {
      const file = tempDb();
      const d = sqlite(file);
      const warnings = captureWarnings(d);
      // The NFS/SMB shape: the mode change lands, then the first read through
      // the WAL's shared-memory index fails.
      let failReads = true;
      stubRaw(d, (sql, pass) => {
        if (failReads && /FROM sqlite_master/i.test(sql)) {
          failReads = false; // one failure is enough to trip the revert
          return Promise.reject(
            Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR_SHMOPEN' }),
          );
        }
        return pass();
      });

      await expect(d.connect()).resolves.toBeUndefined();

      expect(await journalMode(d)).toBe('delete');
      expect(warnings.join('\n')).toMatch(/accepted WAL .* but cannot read through it/);
      expect(warnings.join('\n')).toMatch(/reverted to journal_mode=delete/);
    });

    it('recovers a database an earlier boot left stranded in WAL', async () => {
      const file = tempDb();
      const stranded = sqlite(file);
      await stranded.connect(); // the file is WAL from here on
      await stranded.disconnect();

      // Second boot finds it already in the target mode — and must still prove
      // the mode works, or the revert that fixes it never gets another attempt.
      const d = sqlite(file);
      const warnings = captureWarnings(d);
      let failReads = true;
      stubRaw(d, (sql, pass) => {
        if (failReads && /FROM sqlite_master/i.test(sql)) {
          failReads = false;
          return Promise.reject(
            Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR_SHMOPEN' }),
          );
        }
        return pass();
      });

      await d.connect();

      expect(await journalMode(d)).toBe('delete');
      expect(warnings.join('\n')).toMatch(/reverted to journal_mode=delete/);
    });

    it('treats a busy read as contention, not as an unusable WAL', async () => {
      const file = tempDb();
      const d = sqlite(file);
      const warnings = captureWarnings(d);
      // What another connection in EXCLUSIVE locking mode produces — transient,
      // and no reason to take a working database out of WAL.
      let failReads = true;
      stubRaw(d, (sql, pass) => {
        if (failReads && /FROM sqlite_master/i.test(sql)) {
          failReads = false;
          return Promise.reject(
            Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }),
          );
        }
        return pass();
      });

      await d.connect();

      expect(await journalMode(d)).toBe('wal');
      expect(warnings).toEqual([]);
    });

    it('does not chase the journal mode when the connection itself cannot come up', async () => {
      const d = sqlite(tempDb());
      const warnings = captureWarnings(d);
      // A native better-sqlite3 that cannot load fails on the FIRST pragma;
      // asking it for more would only repeat the same warning (#2229).
      const attempted: string[] = [];
      stubRaw(d, (sql) => {
        attempted.push(sql);
        return Promise.reject(
          Object.assign(new Error('NODE_MODULE_VERSION 127'), { code: 'ERR_DLOPEN_FAILED' }),
        );
      });

      await expect(d.connect()).resolves.toBeUndefined();

      expect(attempted).toEqual(['PRAGMA auto_vacuum = INCREMENTAL']);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/native better-sqlite3 unavailable/);
    });
  });
});
