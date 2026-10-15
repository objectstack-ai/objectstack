// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A SQLite file the driver cannot create or open fails `connect()` at once,
 * naming the file and the operating system's answer (#23696).
 *
 * Before: a filename under `/proc/<missing>/` never finished connecting. Node's
 * recursive mkdir loops on that path (`mkdir` of the level answers `ENOENT`,
 * its parent answers `EEXIST`, retry) and burns system CPU, so a declared
 * datasource there was refused only by a plugin start timeout that named
 * neither the datasource nor the path. A filename SQLite itself cannot open
 * (`SQLITE_CANTOPEN`) was logged and swallowed: `connect()` resolved and the
 * datasource counted as connected while it could answer no query.
 *
 * What the boot prints is `datasource '<name>': connect failed — <reason>`
 * (ADR-0062 D5, the connection service); `<reason>` is this error's message,
 * so the pins here hold the file and the cause in it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from './sql-driver.js';
import { SqliteDatabaseFileError } from './sqlite-database-file.js';

/** The refusal must arrive within this; before the fix it never arrived. */
const WITHIN_MS = 1_000;

const drivers: SqlDriver[] = [];
function make(filename: string): SqlDriver {
  const d = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
  drivers.push(d);
  return d;
}

/** `connect()`'s rejection, or a failure naming the wait when it never settles. */
async function refusalOf(driver: SqlDriver): Promise<{ error: unknown; ms: number }> {
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const never = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`connect() had not settled after ${5 * WITHIN_MS} ms`)), 5 * WITHIN_MS);
  });
  try {
    await Promise.race([driver.connect(), never]);
  } catch (error) {
    if ((error as Error).message.startsWith('connect() had not settled')) throw error;
    return { error, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
  throw new Error('connect() resolved for a file that cannot be created or opened');
}

function expectNamedRefusal(error: unknown, filename: string, code: string): void {
  expect(error).toBeInstanceOf(SqliteDatabaseFileError);
  const e = error as SqliteDatabaseFileError;
  expect(e.code).toBe(code);
  expect(e.filename).toBe(filename);
  expect(e.message).toContain(filename);
  expect(e.message).toContain((e.cause as Error).message);
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'os-23696-')); });
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
  rmSync(dir, { recursive: true, force: true });
});

describe('SqlDriver.connect — a SQLite file that cannot be created or opened (#23696)', () => {
  it.runIf(existsSync('/proc/self'))(
    'refuses a directory the OS will not make (/proc/<missing>/) at once — the shape that looped',
    async () => {
      const filename = `/proc/os-23696-${process.pid}/a/ds.db`;
      const { error, ms } = await refusalOf(make(filename));
      expectNamedRefusal(error, filename, 'ENOENT');
      expect(ms).toBeLessThan(WITHIN_MS);
    },
  );

  it('refuses a path through a regular file, naming it', async () => {
    writeFileSync(join(dir, 'plain'), '');
    const through = join(dir, 'plain', 'sub', 'ds.db');
    const throughRefusal = await refusalOf(make(through));
    expectNamedRefusal(throughRefusal.error, through, 'ENOTDIR');
    expect(throughRefusal.ms).toBeLessThan(WITHIN_MS);

    // The file holds the directory's own name.
    const at = join(dir, 'plain', 'ds.db');
    const atRefusal = await refusalOf(make(at));
    expectNamedRefusal(atRefusal.error, at, 'EEXIST');
    expect(atRefusal.ms).toBeLessThan(WITHIN_MS);
  });

  it('refuses a file SQLite cannot open (SQLITE_CANTOPEN) instead of resolving', async () => {
    const filename = join(dir, 'is-a-directory');
    mkdirSync(filename);
    const { error, ms } = await refusalOf(make(filename));
    expectNamedRefusal(error, filename, 'SQLITE_CANTOPEN');
    expect(ms).toBeLessThan(WITHIN_MS);
  });

  it('CONTROL: a creatable path three levels deep is made, opened and answers', async () => {
    const filename = join(dir, 'x', 'y', 'z', 'ds.db');
    const driver = make(filename);
    await driver.connect();
    expect(existsSync(filename)).toBe(true);
    expect(await driver.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
  });
});
