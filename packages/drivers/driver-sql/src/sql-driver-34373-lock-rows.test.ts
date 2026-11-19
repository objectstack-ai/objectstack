// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #34373 — `DriverOptions.lockRows` on `find()`, the promise
 * `supports.lockRows` makes for this driver: inside a transaction, no other
 * writer commits a change to a row the read returned until that transaction
 * ends.
 *
 * The engine's sender is a predicate delete on an object that delete-family
 * lookups reference: it reads the matched ids, walks the cascade, then deletes
 * those rows by id, so the caller's predicate ("delete only if still pending")
 * is not on the final DELETE. Without the lock a concurrent commit between the
 * read and the delete moves the row out of the predicate and the row is
 * deleted anyway. These pins hold the driver half of that, per dialect:
 *
 * - **PostgreSQL / MySQL** take row locks (`FOR UPDATE`). Two orders, both
 *   measured live: a writer that comes AFTER the locked read waits until the
 *   reader's transaction ends; a writer that holds the row BEFORE the read makes
 *   the read wait, and the read then answers the committed row as the writer
 *   left it, so a row moved out of the predicate is not returned.
 * - **SQLite** has no row lock and compiles `forUpdate()` to nothing. Its
 *   promise is kept by the database: a writer in another connection that
 *   commits between the read and the transaction's own write makes that write
 *   fail (busy), never succeed over the moved row. Measured on a file database
 *   with two drivers.
 * - **Every dialect**: a lock request with no transaction is refused,
 *   `PRECONDITION_REQUIRED` / 428, rather than read unlocked.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os34373_lock_rows';
const SHAPE = { name: TABLE, fields: { status: { type: 'string' } } } as any;
/** Long enough for a writer that is NOT blocked to finish on any measured cell. */
const SETTLE_MS = 400;

/** A promise's state, read without awaiting it. */
function track<T>(p: Promise<T>) {
  const state = { settled: false, value: undefined as T | undefined, error: undefined as unknown };
  const done = p.then(
    (v) => { state.settled = true; state.value = v; return v; },
    (e) => { state.settled = true; state.error = e; throw e; },
  );
  return { state, done };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('sql-driver — lockRows without a transaction is refused (#34373)', () => {
  let driver: SqlDriver;
  beforeEach(async () => {
    driver = new SqlDriver(DIALECT_CELLS[0]!.config());
    await driver.initObjects([SHAPE]);
    await driver.create(TABLE, { id: 'r1', status: 'pending' });
  });
  afterEach(async () => { await driver.disconnect(); });

  it('declares supports.lockRows', () => {
    expect(driver.supports.lockRows).toBe(true);
  });

  it('answers PRECONDITION_REQUIRED / 428 and reads nothing', async () => {
    await expect(driver.find(TABLE, { where: { status: 'pending' } }, { lockRows: true }))
      .rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 });
    await expect(driver.findOne(TABLE, { where: { id: 'r1' } }, { lockRows: true }))
      .rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 });
  });

  it('inside a transaction answers the same rows a plain read does', async () => {
    const trx = await driver.beginTransaction();
    try {
      const locked = await driver.find(TABLE, { where: { status: 'pending' }, fields: ['id'] }, { transaction: trx, lockRows: true });
      expect(locked.map((r) => r.id)).toEqual(['r1']);
    } finally {
      await driver.commit(trx);
    }
  });
});

function rowLockSuite(cell: DialectCell) {
  describe(`sql-driver — lockRows takes row locks (${cell.label}) [#34373]`, () => {
    let driver: SqlDriver;
    /** A second driver: its own pool, so its writes are another session's. */
    let writer: SqlDriver;

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      writer = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([SHAPE]);
      await writer.initObjects([SHAPE]);
      await driver.create(TABLE, { id: 'r1', status: 'pending' });
    });

    afterEach(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await writer.disconnect();
      await driver.disconnect();
    });

    it('a writer after the locked read waits until the reader commits, then finds the row gone', async () => {
      const trx = await driver.beginTransaction();
      const matched = await driver.find(TABLE, { where: { status: 'pending' }, fields: ['id'] }, { transaction: trx, lockRows: true });
      expect(matched.map((r) => r.id)).toEqual(['r1']);

      // The concurrent commit the card describes: move the row out of the
      // predicate between the read and the delete.
      const move = track(writer.update(TABLE, 'r1', { status: 'active' }));
      await pause(SETTLE_MS);
      expect(move.state.settled, 'the writer must wait for the locked row').toBe(false);

      const removed = await driver.deleteMany(TABLE, { object: TABLE, where: { id: { $in: ['r1'] } } } as any, { transaction: trx });
      expect(removed).toBe(1);
      await driver.commit(trx);

      // The writer ran after the delete committed: the row it meant to move
      // is gone, so nothing was deleted out of the predicate.
      await move.done.catch(() => undefined);
      expect(await writer.findOne(TABLE, { where: { id: 'r1' } })).toBeNull();
    }, 60_000);

    it('a read behind a writer that holds the row waits, then does not return a row moved out of the predicate', async () => {
      const wtrx = await writer.beginTransaction();
      await writer.update(TABLE, 'r1', { status: 'active' }, { transaction: wtrx });

      const trx = await driver.beginTransaction();
      const read = track(driver.find(TABLE, { where: { status: 'pending' }, fields: ['id'] }, { transaction: trx, lockRows: true }));
      await pause(SETTLE_MS);
      expect(read.state.settled, 'the locked read must wait for the writer').toBe(false);

      await writer.commit(wtrx);
      const matched = await read.done;
      // Re-checked against the committed row: no longer pending, not matched,
      // so the delete that follows has nothing to remove.
      expect(matched).toEqual([]);
      await driver.commit(trx);
      expect(await writer.findOne(TABLE, { where: { id: 'r1' } })).toMatchObject({ id: 'r1', status: 'active' });
    }, 60_000);
  });
}

for (const cell of DIALECT_CELLS) {
  if (cell.id === 'sqlite') continue;
  declareDialectCell(cell, 'lockRows row locks (#34373)', rowLockSuite);
}

/**
 * SQLite, two drivers on one file: two connections, as two processes would
 * hold. Both journal modes measured; neither lets the moved row be deleted.
 */
describe('sql-driver — lockRows on SQLite: a commit from another connection cannot slip in (#34373)', () => {
  let dir: string;
  let driver: SqlDriver;
  let writer: SqlDriver;

  async function open(journal: 'wal' | 'delete') {
    dir = mkdtempSync(join(tmpdir(), 'os34373-'));
    const config = () => ({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'db.sqlite') },
      useNullAsDefault: true,
      sqliteJournalMode: journal,
    });
    driver = new SqlDriver(config() as any);
    writer = new SqlDriver(config() as any);
    // `connect()` applies the journal mode, as a booted datasource does.
    await driver.connect();
    await writer.connect();
    await driver.initObjects([SHAPE]);
    await writer.initObjects([SHAPE]);
    await driver.create(TABLE, { id: 'r1', status: 'pending' });
    const mode = await driver.execute('PRAGMA journal_mode') as Array<{ journal_mode: string }>;
    expect(mode[0]?.journal_mode).toBe(journal);
  }

  afterEach(async () => {
    await writer.disconnect();
    await driver.disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it('WAL (the file default): the other connection commits, and the transaction\'s own delete is refused busy; the row is kept as moved', async () => {
    await open('wal');
    const trx = await driver.beginTransaction();
    const matched = await driver.find(TABLE, { where: { status: 'pending' }, fields: ['id'] }, { transaction: trx, lockRows: true });
    expect(matched.map((r) => r.id)).toEqual(['r1']);

    try {
      await writer.update(TABLE, 'r1', { status: 'active' });
    } catch (e) {
      await driver.rollback(trx);
      throw e;
    }
    await expect(driver.deleteMany(TABLE, { object: TABLE, where: { id: { $in: ['r1'] } } } as any, { transaction: trx }))
      .rejects.toMatchObject({ code: 'SQLITE_BUSY_SNAPSHOT' });
    await driver.rollback(trx);
    expect(await writer.findOne(TABLE, { where: { id: 'r1' } })).toMatchObject({ id: 'r1', status: 'active' });
  }, 60_000);

  it('rollback journal: the other connection\'s write is refused busy, and the transaction\'s delete stands', async () => {
    await open('delete');
    const trx = await driver.beginTransaction();
    const matched = await driver.find(TABLE, { where: { status: 'pending' }, fields: ['id'] }, { transaction: trx, lockRows: true });
    expect(matched.map((r) => r.id)).toEqual(['r1']);

    // Waits out the busy timeout against the reader's lock, then fails.
    try {
      await expect(writer.update(TABLE, 'r1', { status: 'active' })).rejects.toMatchObject({ code: 'SQLITE_BUSY' });
      expect(await driver.deleteMany(TABLE, { object: TABLE, where: { id: { $in: ['r1'] } } } as any, { transaction: trx })).toBe(1);
    } catch (e) {
      await driver.rollback(trx);
      throw e;
    }
    await driver.commit(trx);
    expect(await writer.findOne(TABLE, { where: { id: 'r1' } })).toBeNull();
  }, 60_000);
});
