// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31608 — on MySQL 8, the first CONCURRENT autonumber inserts into a COLD
 * object issued DUPLICATE numbers. The MySQL twin of #8269
 * (`sql-driver-autonumber-cold-race.test.ts`), which is the Postgres one.
 *
 * ## The mechanism, measured on `mysql:8.0` (InnoDB, REPEATABLE READ)
 *
 * The cold seed was speculative: `SELECT … FOR UPDATE` on the missing counter
 * row, then an INSERT. A locking read of a missing key takes a next-key lock
 * on the gap (`lock_mode X` on the supremum record); gap locks are compatible
 * with each other, so every cold writer held one, and each INSERT then waited
 * on the others' for its insert intention: `ER_LOCK_DEADLOCK` on the INSERT.
 * InnoDB rolls the victim's WHOLE transaction back, not to the savepoint
 * (`ROLLBACK TO SAVEPOINT` then answers `ER_SP_DOES_NOT_EXIST`), and the
 * session drops to autocommit. The recovery statements ran on regardless, so
 * the `FOR UPDATE` lock ended with its own statement and every victim read
 * the winner's counter and wrote the same value back: a lost update. Before
 * the fix, 5 rounds of 16 cold writers gave 7-8 duplicates in 4 rounds on one
 * driver, and 8-10 duplicates in every round on two drivers, with 2-6 surfaced
 * `ER_LOCK_DEADLOCK` create errors.
 *
 * Postgres never had this shape (a deadlock there aborts the savepoint only,
 * which `attemptWithoutPoisoning` recovers), and SQLite serialises writers, so
 * a live MySQL server is the only place the duplicate can be seen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { declareDialectCell, dialectCell, MYSQL_CELL, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os31608_cold_race';
const SEQUENCES_TABLE = '_objectstack_sequences';

const SHAPE = {
  name: TABLE,
  fields: {
    organization_id: { type: 'string' },
    code: { type: 'autonumber', format: 'TK-{0000}' },
    name: { type: 'string' },
  },
} as any;

/** The band a cold counter must issue: 1..n, each once. */
const band = (n: number) => Array.from({ length: n }, (_, i) => `TK-${String(i + 1).padStart(4, '0')}`);

/** A server-shaped MySQL deadlock: the two fields `rollsBackWholeTransaction` reads. */
const deadlock = () => Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });

async function makeCold(driver: SqlDriver): Promise<void> {
  const knex = (driver as any).knex;
  await knex.schema.dropTableIfExists(TABLE);
  if (await knex.schema.hasTable(SEQUENCES_TABLE)) await knex(SEQUENCES_TABLE).where('object', TABLE).del();
  await driver.initObjects([SHAPE]);
}

async function counterOf(driver: SqlDriver): Promise<number[]> {
  const rows = await (driver as any).knex(SEQUENCES_TABLE).where('object', TABLE).select('last_value');
  return rows.map((r: any) => Number(r.last_value));
}

declareDialectCell(MYSQL_CELL, 'autonumber cold concurrent race (#31608)', (cell: DialectCell) => {
  describe(`sql-driver — autonumber cold concurrent race (${cell.label}) [#31608]`, () => {
    const ROUNDS = 3;
    const WRITERS = 16;
    let drivers: SqlDriver[];

    beforeEach(() => {
      // Two driver instances = two connection pools, the in-container stand-in
      // for two server processes writing to one database.
      drivers = [new SqlDriver(cell.config()), new SqlDriver(cell.config())];
    });

    afterEach(async () => {
      await (drivers[0] as any).knex.schema.dropTableIfExists(TABLE).catch(() => {});
      await Promise.all(drivers.map((d) => d.disconnect()));
    });

    const burst = async (pick: (i: number) => SqlDriver, inCallerTransaction = false) => {
      for (let round = 0; round < ROUNDS; round++) {
        await makeCold(drivers[0]);
        await drivers[1].initObjects([SHAPE]);
        const settled = await Promise.allSettled(
          Array.from({ length: WRITERS }, (_, i) => {
            const d = pick(i);
            const row = { organization_id: 'os31608_org', name: `w${i}` };
            return inCallerTransaction
              ? (d as any).knex.transaction((trx: any) => d.create(TABLE, row, { transaction: trx } as any))
              : d.create(TABLE, row);
          }),
        );
        // Every writer succeeds: no deadlock is surfaced to a create the
        // driver could have completed.
        expect(settled.filter((s) => s.status === 'rejected').map((s: any) => s.reason?.code ?? String(s.reason))).toEqual([]);
        // 1..16, each once — unfixed, the band repeats TK-0002 (and others).
        expect(settled.map((s: any) => s.value.code).sort(), `round ${round}`).toEqual(band(WRITERS));
        expect(await counterOf(drivers[0])).toEqual([WRITERS]);
      }
    };

    it('issues 1..N once each on one driver, 16 cold writers', async () => {
      await burst(() => drivers[0]);
    });

    it('issues 1..N once each across two drivers (two pools), 16 cold writers', async () => {
      await burst((i) => drivers[i % 2]);
    });

    it('issues 1..N once each when every writer runs in its own caller transaction', async () => {
      await burst((i) => drivers[i % 2], true);
    });

    it('refuses with the server deadlock, and writes nothing, when a deadlock rolls back the caller transaction', async () => {
      // A REAL deadlock, built deterministically: the caller holds a lock the
      // other transaction wants, while the other holds the counter row the
      // caller's issue wants. The other transaction is made the heavier one
      // (it has written rows) so InnoDB picks the caller as the victim.
      const [driver] = drivers;
      const knex = (driver as any).knex;
      await makeCold(driver);
      await driver.create(TABLE, { organization_id: 'os31608_org', name: 'warm' }); // TK-0001, counter row exists
      const LOCKS = 'os31608_lock_probe';
      await knex.schema.dropTableIfExists(LOCKS);
      await knex.schema.createTable(LOCKS, (t: any) => {
        t.string('k').primary();
      });
      await knex(LOCKS).insert({ k: 'held-by-caller' });
      try {
        const other = await knex.transaction();
        let caller: any;
        try {
          await other(LOCKS).insert(Array.from({ length: 20 }, (_, i) => ({ k: `weight-${i}` })));
          await other(SEQUENCES_TABLE).where('object', TABLE).forUpdate().select('last_value');
          caller = await knex.transaction();
          await caller(LOCKS).where('k', 'held-by-caller').forUpdate().first();
          // Blocks on the counter row the other transaction holds.
          const issuing = driver.create(TABLE, { organization_id: 'os31608_org', name: 'victim' }, { transaction: caller } as any);
          issuing.catch(() => {});
          await new Promise((r) => setTimeout(r, 300));
          // Closes the cycle; InnoDB rolls the caller back. (`.then` sends it:
          // a knex builder is lazy until something awaits it.)
          const closing = other(LOCKS).where('k', 'held-by-caller').forUpdate().first().then(() => 'granted', (e: any) => e?.code);
          // The other side was not the victim: it got the lock once the
          // caller's transaction was gone. Ending it frees the counter row, so
          // nothing stops an issue that went on regardless from completing.
          expect(await closing).toBe('granted');
          await other.rollback();
          // The server's own error reaches the caller. Unfixed, the issue went
          // on in autocommit instead and the create SUCCEEDED, outside the
          // caller's rolled-back transaction.
          await expect(issuing).rejects.toMatchObject({ code: 'ER_LOCK_DEADLOCK' });
        } finally {
          await other.rollback().catch(() => {});
          await caller?.rollback().catch(() => {});
        }
        // Nothing autocommitted behind the caller's back: no row, no number.
        expect((await knex(TABLE).select('code')).map((r: any) => r.code)).toEqual(['TK-0001']);
        expect(await counterOf(driver)).toEqual([1]);
      } finally {
        await knex.schema.dropTableIfExists(LOCKS);
      }
    });
  });
});

// The retry contract, pinned on the embedded cell so it runs on every PR. A
// SQLite server never raises `ER_LOCK_DEADLOCK`, so the server's answer is
// injected at the cold-seed scan — the first statement of a cold issue.
describe('sql-driver — autonumber issue after a whole-transaction rollback (sqlite, injected) [#31608]', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([SHAPE]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await driver.disconnect();
  });

  const failScan = (times: number, error: () => unknown) => {
    const real = (driver as any).scanMaxNumericTail.bind(driver);
    let calls = 0;
    const spy = vi.spyOn(driver as any, 'scanMaxNumericTail').mockImplementation(async (...a: unknown[]) => {
      calls++;
      if (calls <= times) throw error();
      return real(...a);
    });
    return spy;
  };

  it('retries the WHOLE issue when the driver owns the transaction, and issues the number once', async () => {
    const spy = failScan(1, deadlock);
    const row = await driver.create(TABLE, { organization_id: 'os31608_org', name: 'a' });
    expect(row.code).toBe('TK-0001');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await counterOf(driver)).toEqual([1]);
  });

  it('gives up with the server error after a bounded number of whole-issue attempts', async () => {
    const spy = failScan(Infinity, deadlock);
    await expect(driver.create(TABLE, { organization_id: 'os31608_org', name: 'a' })).rejects.toMatchObject({ code: 'ER_LOCK_DEADLOCK' });
    expect(spy).toHaveBeenCalledTimes(5);
    expect(await counterOf(driver)).toEqual([]);
  });

  it('never retries inside a caller transaction: the caller gets the server error, once', async () => {
    const spy = failScan(1, deadlock);
    const knex = (driver as any).knex;
    await expect(
      knex.transaction((trx: any) => driver.create(TABLE, { organization_id: 'os31608_org', name: 'a' }, { transaction: trx } as any)),
    ).rejects.toMatchObject({ code: 'ER_LOCK_DEADLOCK' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await counterOf(driver)).toEqual([]);
  });

  it('does not retry an error that leaves the transaction alive', async () => {
    const spy = failScan(1, () => Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 }));
    await expect(driver.create(TABLE, { organization_id: 'os31608_org', name: 'a' })).rejects.toMatchObject({ code: 'ER_LOCK_WAIT_TIMEOUT' });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
