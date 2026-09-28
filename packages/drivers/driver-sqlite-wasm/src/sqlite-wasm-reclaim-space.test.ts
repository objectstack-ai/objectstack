// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `reclaimSpace()` (ADR-0057 §3.4) is inherited from `SqlDriver`, and on this
// transport it returns the WHOLE freelist: the wasm dialect steps every PRAGMA
// until SQLite reports done, so `PRAGMA incremental_vacuum` runs to its end
// through `knex.raw`. `SqlDriver` drives better-sqlite3 through that binding's
// own `exec()` instead, because knex's better-sqlite3 client stepped the
// statement once and freed one page per call; this transport stays on the
// `knex.raw` arm, and this file pins that it is complete there.
//
// Read from a second reader: the image this driver persists, opened by a fresh
// sql.js database, never the live one that issued the statement.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';

import { SqliteWasmDriver } from '../src/index.js';

const PAGE_SIZE = 4096;
const dirs: string[] = [];
const drivers: SqliteWasmDriver[] = [];

afterEach(async () => {
  await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openDriver(): Promise<{ driver: SqliteWasmDriver; file: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'wasm-reclaim-'));
  dirs.push(dir);
  const file = join(dir, 'app.db');
  const driver = new SqliteWasmDriver({ filename: file, persist: 'on-write' });
  drivers.push(driver);
  await driver.connect();
  return { driver, file };
}

/** Fill `rows` rows of ~4 KB each, then delete them all: roughly one freelist page per row. */
async function freePages(driver: SqliteWasmDriver, rows: number): Promise<void> {
  await driver.initObjects([{ name: 'bulk', fields: { body: { type: 'text' } } }]);
  const body = 'x'.repeat(4000);
  for (let i = 0; i < rows; i += 100) {
    const batch = Array.from({ length: Math.min(100, rows - i) }, (_, j) => ({ id: `r${i + j}`, body }));
    await driver.bulkCreate('bulk', batch);
  }
  await driver.deleteMany('bulk', { where: { id: { $ne: '' } } } as any);
  await driver.flush();
}

/** The freelist and page count of the persisted image, read by a fresh sql.js database. */
async function persistedImage(file: string): Promise<{ freelist: number; pages: number }> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(file));
  try {
    const freelist = Number(db.exec('PRAGMA freelist_count')[0].values[0][0]);
    const pages = Number(db.exec('PRAGMA page_count')[0].values[0][0]);
    return { freelist, pages };
  } finally {
    db.close();
  }
}

describe('SqliteWasmDriver.reclaimSpace() returns the whole freelist', () => {
  it('every free page leaves the persisted image, and the file shrinks to the pages left', async () => {
    const { driver, file } = await openDriver();
    await freePages(driver, 300);
    const before = await persistedImage(file);
    expect(before.freelist).toBeGreaterThanOrEqual(250);

    await driver.reclaimSpace();
    await driver.flush();

    const after = await persistedImage(file);
    expect(after).toEqual({ freelist: 0, pages: before.pages - before.freelist });
    expect(statSync(file).size).toBe(after.pages * PAGE_SIZE);
  });

  it('control: an empty freelist resolves, and the image is unchanged', async () => {
    const { driver, file } = await openDriver();
    await freePages(driver, 0);
    const before = await persistedImage(file);
    expect(before.freelist).toBe(0);

    await expect(driver.reclaimSpace()).resolves.toBeUndefined();
    await driver.flush();

    expect(await persistedImage(file)).toEqual(before);
  });
});
