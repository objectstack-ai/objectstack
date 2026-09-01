// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13854] `SqlDriver.bulkUpdate` is a sequential `for`-`await` over individual
 * `update()` calls. Each of those autocommitted its own row, so a batch refused
 * partway through left every row processed BEFORE the refusal permanently
 * committed — the caller got an exception and the database held a state nobody
 * declared. `driver-turso` reaches the same door through `super.bulkUpdate`,
 * which is why the pin lives here, on the parent.
 *
 * ## What makes this file a measurement rather than a green suite
 *
 * §1 and §4 each assert three things, and only the THIRD one is this card:
 *
 *   1. the batch refuses (passes on the broken code too);
 *   2. the call throws (passes on the broken code too);
 *   3. ⭐ the EARLIER row is unchanged **in the database** — read back through a
 *      bare knex query against the physical table rather than from the return
 *      value, because the return value of a throwing call is not evidence about
 *      storage, and the driver's own read path is not an independent witness.
 *
 * Reverse verification (direction predicted before running): restoring `main`'s
 * body — the bare loop, no transaction — leaves assertions 1 and 2 green and
 * turns assertion 3 red in §1 and §4, with the received value being the
 * committed post-image (`'first-updated'` where `'first'` is asserted). §2, §3,
 * §5 and §6 stay green in both directions: they pin what must NOT change.
 *
 * ## Which refusal, and why not the obvious one
 *
 * ⚠️ A missing id does NOT refuse on this door: `update()` issues an UPDATE
 * matching zero rows and returns `null`, which `bulkUpdate` skips
 * (`if (updated)`). A pin built on one would measure nothing — it never throws.
 * §6 pins that skip, since the card must not change it. The refusal used here is
 * the database's own: a `unique: 'global'` string column, and a later row in the
 * batch assigned a value a THIRD row already holds. Measured on better-sqlite3
 * as `SQLITE_CONSTRAINT_UNIQUE` / `UNIQUE constraint failed: account.code`; the
 * assertion accepts the Postgres and MySQL spellings too, the vocabulary this
 * package's other constraint tests assert on.
 *
 * `unique: 'global'` rather than `unique: true` on purpose: it materializes a
 * single-column index on every tenancy posture (ADR-0120 D1), so the refusal
 * this file depends on cannot be re-scoped by a change to the tenancy composite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/** These fixtures are not tenant-scoped; the audit warning is not under test. */
const OPTS = { bypassTenantAudit: true } as any;

describe('SqlDriver.bulkUpdate atomicity (#13854)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    } as any);
    await driver.initObjects([
      {
        name: 'account',
        fields: {
          code: { type: 'string', unique: 'global' },
          name: { type: 'string' },
        },
      },
    ] as any);
    await driver.create('account', { id: 'a', code: 'A-1', name: 'first' }, OPTS);
    await driver.create('account', { id: 'b', code: 'B-1', name: 'second' }, OPTS);
    await driver.create('account', { id: 'c', code: 'C-1', name: 'third' }, OPTS);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  /**
   * Read a row straight from the physical table, bypassing the driver's read
   * path entirely — the independent witness assertion 3 needs.
   */
  const stored = async (id: string): Promise<Record<string, any> | undefined> =>
    (driver as any).knex('account').where('id', id).first();

  /**
   * A batch whose SECOND entry collides with row `c`'s code. The first entry is
   * a perfectly good update, and on `main` it committed.
   */
  const COLLIDING_BATCH = [
    { id: 'a', data: { name: 'first-updated' } },
    { id: 'b', data: { code: 'C-1' } },
  ];

  it('§1 rolls the whole batch back when a LATER row refuses (no caller transaction)', async () => {
    // 1 + 2 — the batch refuses and the call throws. Both pass on `main` too.
    await expect(driver.bulkUpdate('account', COLLIDING_BATCH, OPTS)).rejects.toThrow(
      /UNIQUE constraint failed|duplicate key value|ER_DUP_ENTRY/,
    );

    // 3 ⭐ — the entire card. The earlier row was applied and then undone.
    expect((await stored('a'))?.name).toBe('first');

    // The refused row itself, and the row it collided with, are also untouched.
    expect((await stored('b'))?.code).toBe('B-1');
    expect((await stored('c'))?.code).toBe('C-1');
  });

  it('§2 leaves rows outside the batch alone', async () => {
    await expect(driver.bulkUpdate('account', COLLIDING_BATCH, OPTS)).rejects.toThrow();
    expect((await stored('c'))?.name).toBe('third');
  });

  it('§3 still commits every row when the batch succeeds', async () => {
    const results = await driver.bulkUpdate(
      'account',
      [
        { id: 'a', data: { name: 'first-updated' } },
        { id: 'b', data: { name: 'second-updated' } },
      ],
      OPTS,
    );

    expect(results).toHaveLength(2);
    expect((await stored('a'))?.name).toBe('first-updated');
    expect((await stored('b'))?.name).toBe('second-updated');
  });

  /**
   * The boundary the card's dispatch flagged as the likeliest surprise: a caller
   * can already own a transaction (`beginTransaction()` is public API, exercised
   * by `sql-driver-multiwrite-tx.test.ts`), and SQLite's pool hands out exactly
   * ONE connection — so the wrapper must ride the caller's transaction rather
   * than ask `this.knex` for a second connection, which would dead-lock.
   *
   * It rides it as a knex NESTED transaction (a `SAVEPOINT`), so the batch is
   * undone as a unit while the caller's own earlier write inside the same
   * transaction survives and the transaction stays usable. Joining WITHOUT the
   * savepoint would leave the caller who catches the refusal and commits anyway
   * holding exactly the partial batch this card is about.
   */
  it('§4 undoes the batch inside a caller transaction, leaving that transaction usable', async () => {
    const trx = await driver.beginTransaction();

    // The caller's OWN write, before the batch. It must survive the batch's
    // rollback — the savepoint undoes the batch, not the caller's work.
    await driver.update('account', 'c', { name: 'caller-own-write' }, { ...OPTS, transaction: trx });

    await expect(
      driver.bulkUpdate('account', COLLIDING_BATCH, { ...OPTS, transaction: trx }),
    ).rejects.toThrow(/UNIQUE constraint failed|duplicate key value|ER_DUP_ENTRY/);

    // The transaction survived the refusal, so the caller can still commit it.
    await driver.commit(trx);

    // 3 ⭐ — the batch's earlier row is undone…
    expect((await stored('a'))?.name).toBe('first');
    expect((await stored('b'))?.code).toBe('B-1');
    // …and the caller's own write, which the batch never touched, is committed.
    expect((await stored('c'))?.name).toBe('caller-own-write');
  });

  it('§5 issues nothing for an empty batch', async () => {
    await expect(driver.bulkUpdate('account', [], OPTS)).resolves.toEqual([]);
  });

  it('§6 still skips a missing id rather than refusing the batch', async () => {
    // The convention #13435 deferred to, unchanged: no throw, no placeholder in
    // the returned array, and the real row is updated.
    const results = await driver.bulkUpdate(
      'account',
      [
        { id: 'a', data: { name: 'first-updated' } },
        { id: 'no-such-row', data: { name: 'ignored' } },
      ],
      OPTS,
    );

    expect(results).toHaveLength(1);
    expect((await stored('a'))?.name).toBe('first-updated');
  });
});
