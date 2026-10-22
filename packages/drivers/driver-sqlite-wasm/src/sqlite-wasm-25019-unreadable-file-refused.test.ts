// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A file wasm SQLite cannot read is refused at connect, naming the file, with
 * the code the native driver answers for the same file, and is left exactly as
 * it was found (#25019): nothing renamed, nothing written beside it, no empty
 * database in its place.
 *
 * Before, `WasmSqliteConnection.open()` moved such a file to
 * `<file>.corrupt-<timestamp>` and started an empty database, so a declared
 * `sqlite-wasm` datasource over an operator's file read as connected, in
 * development and production alike.
 *
 * Real sql.js and real files in a scratch directory.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteWasmDriver, WasmSqliteConnection } from './index.js';

let dir: string;
const drivers: SqliteWasmDriver[] = [];

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wasm-25019-')); });

afterEach(async () => {
  await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
  rmSync(dir, { recursive: true, force: true });
});

function driverFor(filename: string): SqliteWasmDriver {
  const driver = new SqliteWasmDriver({ filename, persist: 'on-write', logger: { warn: () => {} } });
  drivers.push(driver);
  return driver;
}

/** A real database written by this driver, holding one row in `t`. Its size in bytes. */
async function seedDatabase(filename: string): Promise<number> {
  const seed = new SqliteWasmDriver({ filename, persist: 'on-disconnect' });
  await seed.connect();
  await seed.execute('CREATE TABLE t (a INTEGER)');
  await seed.execute('INSERT INTO t (a) VALUES (7)');
  await seed.disconnect();
  return statSync(filename).size;
}

/** `connect()`'s rejection; a failure when it resolves instead. */
async function connectRefusal(driver: SqliteWasmDriver): Promise<any> {
  try {
    await driver.connect();
  } catch (error) {
    return error;
  }
  throw new Error('connect() resolved over a file wasm SQLite cannot read');
}

/** The driver's refusal: the native driver's class and code, the file named, and how to move it aside. */
function expectFileRefusal(error: any, filename: string, code: 'SQLITE_NOTADB' | 'SQLITE_CORRUPT'): void {
  expect(error?.name).toBe('SqliteDatabaseFileError');
  expect(error?.code).toBe(code);
  expect(error?.filename).toBe(filename);
  expect(String(error?.message)).toContain(`SQLite database file '${filename}'`);
  expect(String(error?.message)).toContain(
    `To start from an empty database, move the file aside yourself (mv '${filename}' '${filename}.unreadable') and start again; to keep its data, restore a copy that opens.`,
  );
}

describe('a file wasm SQLite cannot read is refused at connect and left as it was found (#25019)', () => {
  it('plain text: SQLITE_NOTADB, naming the file', async () => {
    const filename = join(dir, 'archive.db');
    const bytes = Buffer.from('id,name\n1,not a database\n'.repeat(20));
    writeFileSync(filename, bytes);

    const refusal = await connectRefusal(driverFor(filename));
    expectFileRefusal(refusal, filename, 'SQLITE_NOTADB');
    expect(String(refusal.message)).toContain('was left as it is');

    expect(readdirSync(dir)).toEqual(['archive.db']);
    expect(readFileSync(filename).equals(bytes)).toBe(true);
  });

  it('a database truncated inside its 100-byte header: SQLITE_CORRUPT, naming the file', async () => {
    const filename = join(dir, 'archive.db');
    await seedDatabase(filename);
    truncateSync(filename, 50);
    const bytes = readFileSync(filename);

    expectFileRefusal(await connectRefusal(driverFor(filename)), filename, 'SQLITE_CORRUPT');

    expect(readdirSync(dir)).toEqual(['archive.db']);
    expect(readFileSync(filename).equals(bytes)).toBe(true);
  });

  it('a database short of the pages its schema names: SQLITE_CORRUPT, naming the file', async () => {
    const filename = join(dir, 'archive.db');
    const size = await seedDatabase(filename);
    truncateSync(filename, Math.floor(size / 2));
    const bytes = readFileSync(filename);

    expectFileRefusal(await connectRefusal(driverFor(filename)), filename, 'SQLITE_CORRUPT');

    expect(readdirSync(dir)).toEqual(['archive.db']);
    expect(readFileSync(filename).equals(bytes)).toBe(true);
  });

  it('a refused file keeps the write-ahead log beside it: nothing is parked', async () => {
    const filename = join(dir, 'archive.db');
    writeFileSync(filename, 'not a database');
    const wal = Buffer.from('a stale write-ahead log');
    writeFileSync(`${filename}-wal`, wal);

    expectFileRefusal(await connectRefusal(driverFor(filename)), filename, 'SQLITE_NOTADB');

    expect(readdirSync(dir).sort()).toEqual(['archive.db', 'archive.db-wal']);
    expect(readFileSync(`${filename}-wal`).equals(wal)).toBe(true);
  });

  it('WasmSqliteConnection.open() itself rejects with the code and the file, and writes nothing', async () => {
    const filename = join(dir, 'archive.db');
    writeFileSync(filename, 'not a database');

    const conn = new WasmSqliteConnection({ filename, logger: { warn: () => {} } });
    let refusal: any;
    await conn.open().catch((e: unknown) => { refusal = e; });
    expect(refusal?.code).toBe('SQLITE_NOTADB');
    expect(refusal?.filename).toBe(filename);
    expect(String(refusal?.message)).toContain(`mv '${filename}' '${filename}.unreadable'`);
    expect(String((refusal?.cause as Error)?.message)).toBe('file is not a database');

    expect(readdirSync(dir)).toEqual(['archive.db']);
    expect(readFileSync(filename, 'utf8')).toBe('not a database');
  });
});

describe('CONTROLS: what keeps today\'s behaviour (#25019)', () => {
  it('a real database opens and answers', async () => {
    const filename = join(dir, 'archive.db');
    await seedDatabase(filename);
    const driver = driverFor(filename);
    await driver.connect();
    expect(await driver.execute('SELECT a FROM t')).toEqual([{ a: 7 }]);
  });

  it('an absent file is created', async () => {
    const filename = join(dir, 'new', 'archive.db');
    const driver = driverFor(filename);
    await driver.connect();
    await driver.execute('CREATE TABLE t (a INTEGER)');
    await driver.flush();
    expect(existsSync(filename)).toBe(true);
  });

  it('an empty file opens as an empty database', async () => {
    const filename = join(dir, 'archive.db');
    writeFileSync(filename, '');
    const driver = driverFor(filename);
    await driver.connect();
    expect(await driver.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    expect(readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toEqual([]);
  });
});
