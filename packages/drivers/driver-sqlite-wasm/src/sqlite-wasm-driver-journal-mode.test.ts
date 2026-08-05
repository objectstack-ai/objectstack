// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3941: the base SqlDriver puts a file-backed SQLite database in WAL mode so
// several processes can share one file. This transport must stay out of it —
// its persistence is a byte-image export, and sql.js *accepts* WAL (its VFS is
// memory-backed), so nothing refuses on our behalf.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteWasmDriver } from '../src/index.js';

const dirs: string[] = [];
const drivers: SqliteWasmDriver[] = [];

function newDriver(): { driver: SqliteWasmDriver; dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wasm-journal-'));
  const file = join(dir, 'test.db');
  const driver = new SqliteWasmDriver({ filename: file, persist: 'on-write' });
  dirs.push(dir);
  drivers.push(driver);
  return { driver, dir, file };
}

afterEach(async () => {
  await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SqliteWasmDriver — stays out of WAL (#3941)', () => {
  it('leaves the journal mode alone on a file-backed database', async () => {
    const { driver, dir } = newDriver();
    await driver.connect();

    const rows: any = await (driver as any).knex.raw('PRAGMA journal_mode');
    expect(String(rows[0].journal_mode).toLowerCase()).not.toBe('wal');
    // A WAL switch here would also start writing a log this driver never reads.
    expect(readdirSync(dir).filter((f) => f.endsWith('-wal'))).toEqual([]);
  });

  it('parks a write-ahead log a real SQLite left behind, and says what was lost', async () => {
    const { driver, dir, file } = newDriver();
    const warnings: string[] = [];

    // What an unclean kill of the native driver leaves: an image plus a log
    // holding commits only a real SQLite can checkpoint.
    await driver.initObjects([{ name: 'acct', fields: { name: { type: 'string' } } }]);
    await driver.disconnect();
    writeFileSync(`${file}-wal`, Buffer.alloc(4096, 1));

    const reopened = new SqliteWasmDriver({
      filename: file,
      persist: 'on-write',
      logger: { warn: (m: string) => warnings.push(String(m)) } as any,
    });
    drivers.push(reopened);
    await reopened.connect();
    // Force the connection open (the pool is lazy) so the loader actually runs.
    await (reopened as any).knex.raw('SELECT 1');

    expect(existsSync(`${file}-wal`)).toBe(false);
    expect(readdirSync(dir).some((f) => f.includes('-wal.orphaned-'))).toBe(true);
    expect(warnings.join('\n')).toMatch(/write-ahead log that wasm SQLite cannot read/);
    expect(warnings.join('\n')).toMatch(/wal_checkpoint\(TRUNCATE\)/);
    // The image itself still opened — a parked log is not a corrupt database.
    const rows: any = await (reopened as any).knex.raw(
      "SELECT name FROM sqlite_master WHERE name = 'acct'",
    );
    expect(rows).toHaveLength(1);
  });

  it('ignores an empty log — a checkpointed one carries nothing', async () => {
    const { driver, file } = newDriver();
    const warnings: string[] = [];
    await driver.initObjects([{ name: 'acct', fields: { name: { type: 'string' } } }]);
    await driver.disconnect();
    writeFileSync(`${file}-wal`, Buffer.alloc(0));

    const reopened = new SqliteWasmDriver({
      filename: file,
      persist: 'on-write',
      logger: { warn: (m: string) => warnings.push(String(m)) } as any,
    });
    drivers.push(reopened);
    await reopened.connect();
    await (reopened as any).knex.raw('SELECT 1');

    expect(warnings).toEqual([]);
    expect(existsSync(`${file}-wal`)).toBe(true);
  });
});
