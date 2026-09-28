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
//
// In WAL mode — the file-backed default — the freed bytes must leave the
// `-wal` sidecar too, so every size below is the database file PLUS the
// `-wal` file, read while the driver is still open. One statement over the
// whole freelist spilled its pages into the WAL (25,754 free pages: the file
// went to 16,384 bytes and the `-wal` to 94,430,432, held until the last
// connection closed), and nothing checkpointed or truncated it.

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import knex, { type Knex } from 'knex';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';

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

/** The `-wal` sidecar's size in bytes; 0 when there is none. */
function walBytes(filename: string): number {
  return existsSync(`${filename}-wal`) ? statSync(`${filename}-wal`).size : 0;
}

/** The database file and its `-wal` sidecar, as the file system reports them. */
function onDisk(filename: string): { file: number; wal: number } {
  return { file: statSync(filename).size, wal: walBytes(filename) };
}

/** A connected driver on `filename`, and a `close()` the cleanup then skips. */
async function openDriver(
  filename: string,
  cfg: Partial<SqlDriverConfig> = {},
): Promise<{ driver: SqlDriver; close: () => Promise<void> }> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true, ...cfg });
  let open = true;
  const close = async () => {
    if (!open) return;
    open = false;
    await driver.disconnect();
  };
  cleanup.push(close);
  await driver.connect();
  return { driver, close };
}

/** Fill `rows` rows of ~4 KB each, then delete them all: roughly one freelist page per row. */
async function freePages(driver: SqlDriver, rows: number): Promise<void> {
  await driver.initObjects([{ name: 'bulk', fields: { body: { type: 'text' } } }]);
  const body = 'x'.repeat(4000);
  for (let i = 0; i < rows; i += 100) {
    const batch = Array.from({ length: Math.min(100, rows - i) }, (_, j) => ({ id: `r${i + j}`, body }));
    await driver.bulkCreate('bulk', batch);
  }
  await driver.deleteMany('bulk', { where: { id: { $ne: '' } } });
}

/** The freelist and page count as a SECOND, read-only connection reads them. */
async function secondConnection(filename: string): Promise<{ freelist: number; pages: number }> {
  const reader: Knex = knex({
    client: 'better-sqlite3',
    connection: { filename, options: { readonly: true } },
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
  it('WAL (the file-backed default): every free page leaves the database, and its bytes leave the -wal sidecar too, while the driver is open', async () => {
    const file = tempDb();
    const { driver, close } = await openDriver(file);
    await freePages(driver, 300);
    const before = await secondConnection(file);
    expect(before.freelist).toBeGreaterThanOrEqual(250);
    expect(walBytes(file)).toBeGreaterThan(0);

    await driver.reclaimSpace();

    const after = await secondConnection(file);
    expect(after).toEqual({ freelist: 0, pages: before.pages - before.freelist });
    expect(onDisk(file)).toEqual({ file: after.pages * PAGE_SIZE, wal: 0 });
    await close();
    expect(onDisk(file)).toEqual({ file: after.pages * PAGE_SIZE, wal: 0 });
  });

  it('WAL, another connection holding a read transaction: the call neither waits nor fails, and writes the WAL a chunk at a time', async () => {
    const file = tempDb();
    // Fill and delete, then reopen: the last close checkpoints and removes the
    // WAL, so with the reader below pinning every frame, the `-wal` size after
    // the call is exactly what the call wrote.
    const first = await openDriver(file);
    await freePages(first.driver, 600);
    await first.close();
    const { driver } = await openDriver(file);
    // A page cache of about 100 pages (400 KiB): one statement over 600 free
    // pages outgrows it and spills them into the WAL, and so does any fixed
    // chunk sized for the default cache.
    await driver.execute('PRAGMA cache_size = -400');

    const reader: Knex = knex({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
    cleanup.push(() => reader.destroy());
    const snapshot = await reader.transaction();
    // Runs before the destroy above: a failed assertion must not leave the
    // reader's connection checked out, or the destroy waits for it.
    cleanup.push(async () => {
      if (!snapshot.isCompleted()) await snapshot.rollback();
    });
    await snapshot.raw('SELECT count(*) AS n FROM bulk');
    const before = await secondConnection(file);
    expect(before.freelist).toBeGreaterThanOrEqual(550);
    const walBefore = walBytes(file);

    const started = performance.now();
    await expect(driver.reclaimSpace()).resolves.toBeUndefined();
    const elapsed = performance.now() - started;

    // Waiting on the reader would take the connection's whole busy timeout.
    const [{ timeout }] = (await driver.execute('PRAGMA busy_timeout')) as Array<{ timeout: number }>;
    expect(timeout).toBe(5000);
    expect(elapsed).toBeLessThan(timeout / 2);
    expect(await secondConnection(file)).toEqual({ freelist: 0, pages: before.pages - before.freelist });
    // Measured: 0.08 of the freed bytes in 25-page chunks, 0.87 for one
    // statement and for one 1,000-page chunk alike.
    expect(walBytes(file) - walBefore).toBeLessThan((before.freelist * PAGE_SIZE) / 4);

    // Once the reader is gone, the next reclaim returns what this one left.
    await snapshot.commit();
    await freePages(driver, 10);
    expect((await secondConnection(file)).freelist).toBeGreaterThan(0);
    await driver.reclaimSpace();
    const settled = await secondConnection(file);
    expect(settled.freelist).toBe(0);
    expect(onDisk(file)).toEqual({ file: settled.pages * PAGE_SIZE, wal: 0 });
  });

  it('control: a file whose auto_vacuum is still NONE frees nothing, and the loop stops', async () => {
    const file = tempDb();
    // Created before the driver's INCREMENTAL default: a table already exists,
    // so that default cannot change this file's layout.
    const legacy: Knex = knex({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
    await legacy.raw('CREATE TABLE legacy_marker (x INTEGER)');
    await legacy.destroy();
    const { driver } = await openDriver(file);
    await freePages(driver, 300);
    const before = await secondConnection(file);
    expect(before.freelist).toBeGreaterThanOrEqual(250);
    const diskBefore = onDisk(file);

    await expect(driver.reclaimSpace()).resolves.toBeUndefined();

    expect(await secondConnection(file)).toEqual(before);
    const disk = onDisk(file);
    expect(disk.file).toBe(before.pages * PAGE_SIZE);
    expect(disk.file + disk.wal).toBeLessThanOrEqual(diskBefore.file + diskBefore.wal);
  });

  it('DELETE journal: the file shrinks while the driver is still open', async () => {
    const file = tempDb();
    const { driver } = await openDriver(file, { sqliteJournalMode: 'delete' });
    await freePages(driver, 300);
    const before = await secondConnection(file);
    expect(before.freelist).toBeGreaterThanOrEqual(250);
    expect(statSync(file).size).toBe(before.pages * PAGE_SIZE);

    await driver.reclaimSpace();

    const after = await secondConnection(file);
    expect(after).toEqual({ freelist: 0, pages: before.pages - before.freelist });
    expect(onDisk(file)).toEqual({ file: after.pages * PAGE_SIZE, wal: 0 });
  });

  it.each(['wal', 'delete'] as const)('control, %s journal: an empty freelist resolves, and nothing changes', async (mode) => {
    const file = tempDb();
    const { driver } = await openDriver(file, { sqliteJournalMode: mode });
    await freePages(driver, 0);
    const before = await secondConnection(file);
    expect(before.freelist).toBe(0);
    const diskBefore = onDisk(file);

    await expect(driver.reclaimSpace()).resolves.toBeUndefined();

    expect(await secondConnection(file)).toEqual(before);
    expect(onDisk(file)).toEqual(diskBefore);
  });

  it('the pooled connection is handed back: the driver answers a query after the call', async () => {
    const file = tempDb();
    const { driver } = await openDriver(file);
    await freePages(driver, 50);
    await driver.reclaimSpace();
    await driver.bulkCreate('bulk', [{ id: 'after', body: 'still writable' }]);
    expect(await driver.count('bulk', {})).toBe(1);
  });
});
