// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A declared SQLite file whose bytes are not a SQLite database fails
 * `connect()` at once, naming the file, and the file is left exactly as it was
 * found (#24960).
 *
 * Before: the connection's first statement (`PRAGMA auto_vacuum`) answered
 * `SQLITE_NOTADB`, which `connect()` logged as "Failed to set PRAGMA
 * auto_vacuum=INCREMENTAL" and swallowed, so it resolved over a file it could
 * not read. In production the first query failed later; on a development boot
 * the step-down (`resolveSqliteDriver` in `@objectstack/service-datasource`)
 * answered with wasm SQLite, whose open moved the operator's file aside to
 * `<file>.corrupt-<timestamp>` and wrote an empty database in its place, and
 * the datasource read `connected`. `SQLITE_CANTOPEN` was already refused this
 * way (#23696); `SQLITE_NOTADB` was left out.
 *
 * The refusal is the driver's own, so it holds whatever `NODE_ENV` says: both
 * modes are pinned.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from './sql-driver.js';
import { SqliteDatabaseFileError } from './sqlite-database-file.js';

const PLAIN_TEXT = 'archive notes — this file holds plain text, not a SQLite database\n';

const drivers: SqlDriver[] = [];
function make(filename: string): SqlDriver {
  const d = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
  drivers.push(d);
  return d;
}

/** `connect()`'s rejection, or a failure saying it resolved. */
async function refusalOf(driver: SqlDriver): Promise<unknown> {
  try {
    await driver.connect();
  } catch (error) {
    return error;
  }
  throw new Error('connect() resolved for a file that is not a SQLite database');
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'os-24960-')); });
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
  rmSync(dir, { recursive: true, force: true });
});

describe('SqlDriver.connect — a declared SQLite file that is not a database (#24960)', () => {
  for (const nodeEnv of ['development', 'production'] as const) {
    it(`refuses a plain-text file with SQLITE_NOTADB, naming it, and leaves its bytes untouched (NODE_ENV=${nodeEnv})`, async () => {
      vi.stubEnv('NODE_ENV', nodeEnv);
      const filename = join(dir, 'archive.db');
      writeFileSync(filename, PLAIN_TEXT);
      const before = readFileSync(filename);

      const error = await refusalOf(make(filename));

      expect(error).toBeInstanceOf(SqliteDatabaseFileError);
      const e = error as SqliteDatabaseFileError;
      expect(e.code).toBe('SQLITE_NOTADB');
      expect(e.filename).toBe(filename);
      expect(e.message).toContain(filename);
      expect(e.message).toContain((e.cause as Error).message);
      // Nothing was written: the same bytes, and no sibling (journal, WAL,
      // `.corrupt-*`) beside it.
      expect(readFileSync(filename).equals(before)).toBe(true);
      expect(readdirSync(dir)).toEqual(['archive.db']);
    });
  }

  it('CONTROL: a real database file still connects and answers, and is not moved', async () => {
    const filename = join(dir, 'real.db');
    const seed = make(filename);
    await seed.connect();
    await seed.execute('CREATE TABLE t (a INTEGER)');
    await seed.execute('INSERT INTO t (a) VALUES (7)');
    await seed.disconnect();

    const driver = make(filename);
    await driver.connect();
    expect(await driver.execute('SELECT a FROM t')).toEqual([{ a: 7 }]);
    expect(readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toEqual([]);
  });

  it('CONTROL: an empty file is an empty SQLite database, and connects', async () => {
    const filename = join(dir, 'empty.db');
    writeFileSync(filename, '');
    const driver = make(filename);
    await driver.connect();
    expect(await driver.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
  });
});
