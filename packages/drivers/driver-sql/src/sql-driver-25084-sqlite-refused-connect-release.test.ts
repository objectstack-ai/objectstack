// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A SQLite `connect()` that refuses its file closes what it opened before it
 * rejects (#25084).
 *
 * The refusal ({@link SqliteDatabaseFileError}: `SQLITE_CANTOPEN`,
 * `SQLITE_NOTADB`, `SQLITE_CORRUPT`) is the answer of the connection's first
 * statement, so the file was opened to give it. The pool used to keep that
 * better-sqlite3 connection: for a damaged file whose header says WAL, SQLite
 * kept its `-shm` and an empty `-wal` beside it until something called
 * `disconnect()`, and a caller that never does — the datasource connection
 * service's degraded path — kept them for the life of the process.
 *
 * Pinned with no `disconnect()` before any reading: what is left behind is
 * read straight after the rejection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from './sql-driver.js';
import { SqliteDatabaseFileError } from './sqlite-database-file.js';

const drivers: SqlDriver[] = [];
function make(filename: string): SqlDriver {
  const d = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
  drivers.push(d);
  return d;
}

/** `connect()`'s rejection, or a failure saying it resolved. */
async function refusalOf(driver: SqlDriver): Promise<any> {
  try {
    await driver.connect();
  } catch (error) {
    return error;
  }
  throw new Error('connect() resolved for a file the datasource cannot use');
}

function expectFileRefusal(error: any, filename: string, code: string): void {
  expect(error).toBeInstanceOf(SqliteDatabaseFileError);
  expect(error.code).toBe(code);
  expect(error.filename).toBe(filename);
  expect(error.message).toContain(filename);
}

/** A real SQLite database in WAL (this driver's journal mode), holding one row in `t`. */
async function seedDatabase(filename: string): Promise<void> {
  const seed = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
  await seed.connect();
  await seed.execute('CREATE TABLE t (a INTEGER)');
  await seed.execute('INSERT INTO t (a) VALUES (7)');
  await seed.disconnect();
}

/** A seeded database cut short of the pages its schema names: its header still says WAL. */
async function damagedWalDatabase(filename: string): Promise<Buffer> {
  await seedDatabase(filename);
  truncateSync(filename, 4096);
  const before = readFileSync(filename);
  // Byte 18 is the header's write version: 2 is WAL.
  expect(before[18]).toBe(2);
  return before;
}

/**
 * This process's open file descriptors on `filename` (or on any of its SQLite
 * siblings), read from `/proc/self/fd` — the operating system's own count of
 * open handles, so no driver internals are trusted to report themselves.
 */
function openHandlesOn(filename: string): string[] {
  const fds = '/proc/self/fd';
  const open: string[] = [];
  for (const fd of readdirSync(fds)) {
    let target: string;
    try {
      target = readlinkSync(join(fds, fd));
    } catch {
      continue; // the descriptor readdir itself used, already closed
    }
    if (target.startsWith(filename)) open.push(target);
  }
  return open;
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'os-25084-')); });
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
  rmSync(dir, { recursive: true, force: true });
});

describe('SqlDriver.connect — a refused SQLite file leaves no open handle behind (#25084)', () => {
  it('a damaged file whose header says WAL: same SQLITE_CORRUPT refusal, and no -shm / -wal sibling once connect() rejects (NODE_ENV=production)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const filename = join(dir, 'archive.db');
    const before = await damagedWalDatabase(filename);

    const error = await refusalOf(make(filename));

    expectFileRefusal(error, filename, 'SQLITE_CORRUPT');
    expect((error.cause as { code?: string }).code).toBe('SQLITE_CORRUPT');
    expect(error.message).toContain((error.cause as Error).message);
    // Read before any disconnect(): the refused connection is already closed.
    expect(readdirSync(dir)).toEqual(['archive.db']);
    expect(readFileSync(filename).equals(before)).toBe(true);
  });

  describe.runIf(existsSync('/proc/self/fd'))('the handle itself, counted by the operating system', () => {
    it('SQLITE_NOTADB: the same refusal, and no descriptor left open on the file', async () => {
      const filename = join(dir, 'archive.db');
      writeFileSync(filename, 'archive notes — plain text, not a SQLite database\n');

      const error = await refusalOf(make(filename));

      expectFileRefusal(error, filename, 'SQLITE_NOTADB');
      expect((error.cause as { code?: string }).code).toBe('SQLITE_NOTADB');
      expect(openHandlesOn(filename)).toEqual([]);
      expect(readdirSync(dir)).toEqual(['archive.db']);
    });

    it('SQLITE_CORRUPT: the same refusal, and no descriptor left open on the file or its siblings', async () => {
      const filename = join(dir, 'archive.db');
      await damagedWalDatabase(filename);

      expectFileRefusal(await refusalOf(make(filename)), filename, 'SQLITE_CORRUPT');
      expect(openHandlesOn(filename)).toEqual([]);
    });

    it('SQLITE_CANTOPEN: the same refusal, and no descriptor left open', async () => {
      // A link to a file in a directory that does not exist: SQLite cannot open it.
      const filename = join(dir, 'archive.db');
      symlinkSync(join(dir, 'missing', 'target.db'), filename);

      const error = await refusalOf(make(filename));

      expectFileRefusal(error, filename, 'SQLITE_CANTOPEN');
      expect(openHandlesOn(filename)).toEqual([]);
      expect(openHandlesOn(join(dir, 'missing'))).toEqual([]);
    });

    it('CONTROL: a healthy file connects and keeps its handle until disconnect()', async () => {
      const filename = join(dir, 'archive.db');
      await seedDatabase(filename);

      const driver = make(filename);
      await driver.connect();
      expect(await driver.execute('SELECT a FROM t')).toEqual([{ a: 7 }]);
      expect(openHandlesOn(filename)).not.toEqual([]);

      await driver.disconnect();
      expect(openHandlesOn(filename)).toEqual([]);
    });
  });

  it('the refused instance connects again: the same refusal while the file is bad, and a working connection once it is repaired', async () => {
    // A host-adopted driver is connected again on the SAME object
    // (`createPrebuiltDriverFactory`), so releasing must leave it usable.
    const filename = join(dir, 'archive.db');
    await damagedWalDatabase(filename);
    const driver = make(filename);

    expectFileRefusal(await refusalOf(driver), filename, 'SQLITE_CORRUPT');
    expectFileRefusal(await refusalOf(driver), filename, 'SQLITE_CORRUPT');
    expect(readdirSync(dir)).toEqual(['archive.db']);

    // The operator restores the file from a good copy.
    const good = join(dir, 'restored.db');
    await seedDatabase(good);
    rmSync(filename);
    renameSync(good, filename);

    await driver.connect();
    expect(await driver.execute('SELECT a FROM t')).toEqual([{ a: 7 }]);
  });

  it('a release that itself fails is logged at warn and the original refusal goes on unchanged', async () => {
    const filename = join(dir, 'archive.db');
    await damagedWalDatabase(filename);
    const driver = make(filename);
    const knex = (driver as any).knex;
    const realDestroy = knex.destroy.bind(knex);
    const releaseFailure = new Error('pool would not close');
    vi.spyOn(knex, 'destroy').mockRejectedValueOnce(releaseFailure).mockImplementation(realDestroy);
    const warn = vi.spyOn((driver as any).logger, 'warn');

    const error = await refusalOf(driver);

    expectFileRefusal(error, filename, 'SQLITE_CORRUPT');
    expect(error).not.toBe(releaseFailure);
    expect(warn).toHaveBeenCalledWith(expect.any(String), releaseFailure);
  });

  it('CONTROL: a healthy WAL file connects and keeps working, its -shm / -wal held open beside it', async () => {
    const filename = join(dir, 'archive.db');
    await seedDatabase(filename);

    const driver = make(filename);
    await driver.connect();
    await driver.execute('INSERT INTO t (a) VALUES (8)');
    expect(await driver.execute('SELECT a FROM t ORDER BY a')).toEqual([{ a: 7 }, { a: 8 }]);
    expect(readdirSync(dir).sort()).toEqual(['archive.db', 'archive.db-shm', 'archive.db-wal']);
  });
});
