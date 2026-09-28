// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `reclaimSpace()` (ADR-0057 §3.4) returns the WHOLE freelist on SQLite, read
// from a SECOND connection rather than from the one that issued the statement.
//
// SQLite's incremental-vacuum program frees one page per step. knex's
// better-sqlite3 client runs a statement that declares no result columns with
// `Statement.run()`, which steps it once, so this method used to free ONE page
// per call: 300 → 299 from a second connection, and the lifecycle sweep that
// calls it after every bulk delete left the file at its high-water mark.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import knex, { type Knex } from 'knex';
import { SqlDriver } from './sql-driver.js';

const PAGE_SIZE = 4096;
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-reclaim-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'app.db');
}

async function openDriver(filename: string, cfg: Record<string, unknown> = {}): Promise<SqlDriver> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true, ...cfg } as any);
  let open = true;
  cleanup.push(async () => {
    if (open) await driver.disconnect();
  });
  await driver.connect();
  (driver as any).close = async () => {
    open = false;
    await driver.disconnect();
  };
  return driver;
}

/** Fill `rows` rows of ~4 KB each, then delete them all: roughly one freelist page per row. */
async function freePages(driver: SqlDriver, rows: number): Promise<void> {
  await driver.initObjects([{ name: 'bulk', fields: { body: { type: 'text' } } }]);
  const body = 'x'.repeat(4000);
  for (let i = 0; i < rows; i += 100) {
    const batch = Array.from({ length: Math.min(100, rows - i) }, (_, j) => ({ id: `r${i + j}`, body }));
    await driver.bulkCreate('bulk', batch);
  }
  await driver.deleteMany('bulk', { where: { id: { $ne: '' } } } as any);
}

/** The freelist and page count as a SECOND, read-only connection reads them. */
async function secondConnection(filename: string): Promise<{ freelist: number; pages: number }> {
  const reader: Knex = knex({
    client: 'better-sqlite3',
    connection: { filename, options: { readonly: true } } as any,
    useNullAsDefault: true,
  });
  try {
    const [free] = await reader.raw('PRAGMA freelist_count');
    const [count] = await reader.raw('PRAGMA page_count');
    return { freelist: Number(free.freelist_count), pages: Number(count.page_count) };
  } finally {
    await reader.destroy();
  }
}

describe('SqlDriver.reclaimSpace() on better-sqlite3 returns the whole freelist', () => {
  it('WAL (the file-backed default): every free page leaves the database, and the file shrinks once closed', async () => {
    const file = tempDb();
    const driver = await openDriver(file);
    await freePages(driver, 300);
    const before = await secondConnection(file);
    expect(before.freelist).toBeGreaterThanOrEqual(250);

    await driver.reclaimSpace();

    const after = await secondConnection(file);
    expect(after).toEqual({ freelist: 0, pages: before.pages - before.freelist });
    await (driver as any).close();
    expect(statSync(file).size).toBe(after.pages * PAGE_SIZE);
  });

  it('DELETE journal: the file shrinks while the driver is still open', async () => {
    const file = tempDb();
    const driver = await openDriver(file, { sqliteJournalMode: 'delete' });
    await freePages(driver, 300);
    const before = await secondConnection(file);
    expect(before.freelist).toBeGreaterThanOrEqual(250);
    expect(statSync(file).size).toBe(before.pages * PAGE_SIZE);

    await driver.reclaimSpace();

    const after = await secondConnection(file);
    expect(after).toEqual({ freelist: 0, pages: before.pages - before.freelist });
    expect(statSync(file).size).toBe(after.pages * PAGE_SIZE);
  });

  it('control: an empty freelist resolves, and nothing changes', async () => {
    const file = tempDb();
    const driver = await openDriver(file, { sqliteJournalMode: 'delete' });
    await freePages(driver, 0);
    const before = await secondConnection(file);
    expect(before.freelist).toBe(0);

    await expect(driver.reclaimSpace()).resolves.toBeUndefined();

    expect(await secondConnection(file)).toEqual(before);
  });

  it('the pooled connection is handed back: the driver answers a query after the call', async () => {
    const file = tempDb();
    const driver = await openDriver(file);
    await freePages(driver, 50);
    await driver.reclaimSpace();
    await driver.bulkCreate('bulk', [{ id: 'after', body: 'still writable' }]);
    expect(await driver.count('bulk', {} as any)).toBe(1);
  });
});
