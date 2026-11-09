// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * On PostgreSQL, an index the schema sync adds to a table that already exists
 * is built CONCURRENTLY (#31901).
 *
 * A plain `CREATE INDEX` holds a SHARE lock for the whole build, so every
 * write to the table waits for it (measured on PostgreSQL 16 at 1M rows: an
 * INSERT waited 537 to 777 ms; with CONCURRENTLY, about 1.2 ms). The seat's
 * ruling on the card fixes the rest:
 *
 *   - a UNIQUE index is probed for duplicates BEFORE its DDL, because a
 *     concurrent build over duplicates fails only at the end and leaves an
 *     INVALID index;
 *   - an INVALID index the driver manages is dropped and built again by the
 *     next sync, and the sync after that does nothing;
 *   - the build arms `lock_timeout` at the driver's DDL lock-wait bound. On a
 *     timeout boot logs and carries on, and `os migrate apply` refuses;
 *   - the first timeout opens a window of one bound in which every other
 *     concurrent build defers without waiting, so one long transaction costs
 *     one wait, not one wait per index. The window closes itself when the
 *     bound has passed, and an operator's run (`flushDeferredSchemaDdl`,
 *     `applyMigrationEntries`) closes it at entry and waits for itself;
 *   - CONTROL: a table the sync creates, and every other dialect, keep the
 *     plain path byte for byte.
 *
 * The blocking pins use a real lock, never a timing guess: an open transaction
 * that wrote a row to the table holds ROW EXCLUSIVE. A plain build's SHARE
 * request queues behind it, and every later INSERT queues behind THAT request.
 * A concurrent build takes SHARE UPDATE EXCLUSIVE, which no INSERT waits for.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { SqlDriver, expectedIndexes } from '../src/index.js';
import { declareDialectCell, dialectCell, MYSQL_CELL, PG_CELL, type DialectCell } from './live-dialect-matrix.testkit.js';

const JOB = 'os31901_job';
const TASK = 'os31901_task';
const ROWS = 200;
const LOCK_WAIT_REFUSAL = Symbol.for('objectstack.driver-sql.deferredDdlLockWaitRefusal');

const objectOf = (name: string, indexes: any[] = []) => ({
  name,
  tenancy: { enabled: false },
  // A bounded `maxLength`, so a column MySQL is asked to key is stored as varchar.
  fields: { code: { type: 'text', maxLength: 100 }, stage: { type: 'text', maxLength: 100 } },
  indexes,
});

/** The name the driver gives a declared index, read from the composition the sync itself uses. */
const nameOf = (table: string, declared: { fields: string[]; unique?: boolean }): string => {
  const obj = objectOf(table, [declared]);
  const [entry] = expectedIndexes({
    table,
    fields: obj.fields,
    tenantField: null,
    declaredIndexes: obj.indexes,
    physicalColumns: new Set(['id', 'code', 'stage']),
  });
  return entry.name;
};

const BY_STAGE = { fields: ['stage'] };
const BY_CODE = { fields: ['code'] };
const UNIQUE_CODE = { fields: ['code'], unique: true };

type Logged = { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

function newDriver(cell: DialectCell, extra: Record<string, unknown> = {}): { driver: SqlDriver; knex: Knex; ddl: string[]; log: Logged } {
  const driver = new SqlDriver({ ...(cell.config() as any), ...extra });
  const log: Logged = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
  (driver as any).logger = log;
  const knex = (driver as any).knex as Knex;
  const ddl: string[] = [];
  knex.on('query', (q: any) => {
    if (/^\s*(create|alter|drop)\b/i.test(q.sql)) ddl.push(q.sql);
  });
  return { driver, knex, ddl, log };
}

async function seed(knex: Knex, table: string, codes: (i: number) => string = (i) => `c${i}`): Promise<void> {
  const rows = Array.from({ length: ROWS }, (_, i) => ({ id: `${table}_${i}`, code: codes(i), stage: `s${i % 7}` }));
  await knex.batchInsert(table, rows, 100);
}

const logged = (fn: ReturnType<typeof vi.fn>): string => fn.mock.calls.map((c) => String(c[0])).join('\n');

function declarePostgresPins(cell: DialectCell): void {
  describe(`existing-table index backfill builds concurrently — ${cell.label} (#31901)`, () => {
    let driver: SqlDriver;
    let knex: Knex;
    let ddl: string[];
    let log: Logged;
    let other: Knex;

    const indexState = async (name: string): Promise<{ valid: boolean } | null> => {
      const res = await other.raw(
        `select i.indisvalid as valid from pg_index i join pg_class c on c.oid = i.indexrelid
          where c.relname = ? and c.relnamespace = current_schema()::regnamespace`,
        [name],
      );
      return res.rows.length ? { valid: res.rows[0].valid } : null;
    };
    const hasConstraint = async (table: string, name: string): Promise<boolean> =>
      (await other.raw(`select 1 from pg_constraint where conname = ? and conrelid = ?::regclass`, [name, table])).rows
        .length > 0;
    const concurrentCreates = () => ddl.filter((s) => /create (unique )?index concurrently/i.test(s));

    beforeEach(async () => {
      ({ driver, knex, ddl, log } = newDriver(cell));
      other = knexFactory(cell.config() as any);
      for (const t of [JOB, TASK]) await other.raw(`drop table if exists ?? cascade`, [t]);
    });

    afterEach(async () => {
      for (const t of [JOB, TASK]) await other.raw(`drop table if exists ?? cascade`, [t]).catch(() => {});
      await other.destroy();
      await driver.disconnect();
    });

    it('a write to the table is not blocked while the index builds', async () => {
      await driver.initObjects([objectOf(JOB) as any]);
      await seed(knex, JOB);

      // An open transaction that wrote to the table: the build has to wait for it.
      const writer = await other.transaction();
      const blocker = knexFactory(cell.config() as any);
      try {
        await writer(JOB).insert({ id: 'held', code: 'held', stage: 'held' });
        const sync = driver.initObjects([objectOf(JOB, [BY_STAGE]) as any]);
        // Until the build is parked on a lock, the write below proves nothing.
        for (let i = 0; i < 100; i++) {
          const res = await blocker.raw(
            `select count(*)::int as n from pg_stat_activity
              where wait_event_type = 'Lock' and query ilike 'create%index%' and datname = current_database()`,
          );
          if (res.rows[0].n > 0) break;
          await new Promise((r) => setTimeout(r, 50));
        }

        const started = Date.now();
        await blocker.transaction(async (trx) => {
          await trx.raw(`set local statement_timeout = '3s'`);
          await trx(JOB).insert({ id: 'during-build', code: 'x', stage: 'x' });
        });
        expect(Date.now() - started).toBeLessThan(2000);

        await writer.commit();
        await sync;
      } finally {
        if (!writer.isCompleted()) await writer.rollback().catch(() => {});
        await blocker.destroy();
      }
      expect(concurrentCreates()).toHaveLength(1);
      expect(await indexState(nameOf(JOB, BY_STAGE))).toEqual({ valid: true });
    });

    it('a UNIQUE index over duplicate rows sends no DDL and leaves nothing INVALID', async () => {
      await driver.initObjects([objectOf(JOB) as any]);
      await seed(knex, JOB, (i) => (i < 2 ? 'dup' : `c${i}`));

      ddl.length = 0;
      await driver.initObjects([objectOf(JOB, [UNIQUE_CODE]) as any]);

      expect(ddl.filter((s) => /create unique index/i.test(s))).toEqual([]);
      expect(await indexState(nameOf(JOB, UNIQUE_CODE))).toBeNull();
      expect(logged(log.error)).toContain(`cannot create unique index '${nameOf(JOB, UNIQUE_CODE)}'`);
      expect(logged(log.error)).toContain('(code="dup") × 2 rows');
    });

    it('an INVALID index is dropped and built again by the next sync; the sync after that does nothing', async () => {
      const name = nameOf(JOB, UNIQUE_CODE);
      await driver.initObjects([objectOf(JOB) as any]);
      await seed(knex, JOB, (i) => (i < 2 ? 'dup' : `c${i}`));
      // What a concurrent build that failed leaves behind.
      await expect(other.raw(`create unique index concurrently ?? on ?? (code)`, [name, JOB])).rejects.toThrow();
      expect(await indexState(name)).toEqual({ valid: false });
      await other(JOB).where({ id: `${JOB}_1` }).delete();

      ddl.length = 0;
      await driver.initObjects([objectOf(JOB, [UNIQUE_CODE]) as any]);
      expect(logged(log.warn)).toContain(`dropping INVALID index '${name}'`);
      expect(ddl.some((s) => /^drop index concurrently if exists/i.test(s))).toBe(true);
      expect(await indexState(name)).toEqual({ valid: true });
      // Same catalog state as the plain path: knex's unique() is a constraint on PostgreSQL.
      expect(await hasConstraint(JOB, name)).toBe(true);

      ddl.length = 0;
      await driver.initObjects([objectOf(JOB, [UNIQUE_CODE]) as any]);
      expect(ddl).toEqual([]);
    });

    describe('an older transaction holds the build', () => {
      let reader: Knex.Transaction | undefined;
      let readerKnex: Knex;

      beforeEach(async () => {
        await driver.initObjects([objectOf(JOB) as any, objectOf(TASK) as any]);
        (driver as any).concurrentIndexState.lockWaitMs = 1500;
        // A snapshot older than the build, taken on ANOTHER table: CONCURRENTLY
        // waits for it all the same.
        readerKnex = knexFactory(cell.config() as any);
        reader = await readerKnex.transaction({ isolationLevel: 'repeatable read' });
        await reader.raw(`select count(*) from ??`, [TASK]);
        ddl.length = 0;
      });

      afterEach(async () => {
        if (reader && !reader.isCompleted()) await reader.rollback().catch(() => {});
        await readerKnex.destroy();
      });

      it('boot waits once, defers both missing indexes, and the next sync builds them', async () => {
        const started = Date.now();
        await driver.initObjects([objectOf(JOB, [BY_STAGE]) as any]);
        await driver.initObjects([objectOf(TASK, [BY_CODE]) as any]);
        const elapsed = Date.now() - started;

        // One wait for the whole sync, not one per index.
        expect(concurrentCreates()).toHaveLength(1);
        expect(elapsed).toBeGreaterThanOrEqual(1400);
        expect(elapsed).toBeLessThan(2900);
        const errors = logged(log.error);
        expect(errors).toContain(`index '${nameOf(JOB, BY_STAGE)}' on "${JOB}" was NOT built: the concurrent build timed out`);
        expect(errors).toContain(`index '${nameOf(TASK, BY_CODE)}' on "${TASK}" was NOT built in this sync`);
        expect(await indexState(nameOf(JOB, BY_STAGE))).toEqual({ valid: false });
        expect(await indexState(nameOf(TASK, BY_CODE))).toBeNull();

        await reader!.commit();
        const next = newDriver(cell);
        try {
          await next.driver.initObjects([objectOf(JOB, [BY_STAGE]) as any, objectOf(TASK, [BY_CODE]) as any]);
          expect(await indexState(nameOf(JOB, BY_STAGE))).toEqual({ valid: true });
          expect(await indexState(nameOf(TASK, BY_CODE))).toEqual({ valid: true });
          next.ddl.length = 0;
          await next.driver.initObjects([objectOf(JOB, [BY_STAGE]) as any, objectOf(TASK, [BY_CODE]) as any]);
          expect(next.ddl).toEqual([]);
        } finally {
          await next.driver.disconnect();
        }
      }, 20_000);

      it("under autoMigrate: 'safe', the boot's own drift reconcile keeps the window: still one wait", async () => {
        // The reconcile applies a missing index as a safe drift entry after
        // each object's sync. It must not close the window the way an
        // operator's run does, or every object would wait the bound again.
        const auto = newDriver(cell, { autoMigrate: 'safe' });
        try {
          (auto.driver as any).concurrentIndexState.lockWaitMs = 1500;
          const started = Date.now();
          await auto.driver.initObjects([objectOf(JOB, [BY_STAGE]) as any]);
          await auto.driver.initObjects([objectOf(TASK, [BY_CODE]) as any]);
          const elapsed = Date.now() - started;

          expect(auto.ddl.filter((s) => /create (unique )?index concurrently/i.test(s))).toHaveLength(1);
          expect(elapsed).toBeLessThan(2900);
          expect(logged(auto.log.error)).toContain(`index '${nameOf(TASK, BY_CODE)}' on "${TASK}" was NOT built in this sync`);
        } finally {
          await auto.driver.disconnect();
        }
      }, 20_000);

      it('after the window has passed, the next sync in the same process builds again', async () => {
        await driver.initObjects([objectOf(JOB, [BY_STAGE]) as any]);
        expect(concurrentCreates()).toHaveLength(1);
        expect(await indexState(nameOf(JOB, BY_STAGE))).toEqual({ valid: false });

        await reader!.commit();
        // The window is one bound (1.5 s here) from the timeout: let it pass.
        await new Promise((resolve) => setTimeout(resolve, 1700));
        ddl.length = 0;
        await driver.initObjects([objectOf(JOB, [BY_STAGE]) as any, objectOf(TASK, [BY_CODE]) as any]);

        // Same driver, no restart: both are built, the INVALID one dropped first.
        expect(ddl.some((s) => /^drop index concurrently if exists/i.test(s) && s.includes(nameOf(JOB, BY_STAGE)))).toBe(true);
        expect(concurrentCreates()).toHaveLength(2);
        expect(await indexState(nameOf(JOB, BY_STAGE))).toEqual({ valid: true });
        expect(await indexState(nameOf(TASK, BY_CODE))).toEqual({ valid: true });
      }, 20_000);

      it('an operator run (applyMigrationEntries) does not inherit the window, and waits for itself', async () => {
        await driver.initObjects([objectOf(JOB, [BY_STAGE]) as any]);
        expect(concurrentCreates()).toHaveLength(1);

        // Inside the window, the drift entry for the other table's missing index.
        const entries = await (driver as any).detectTableDrift(TASK, objectOf(TASK).fields, [BY_CODE]);
        expect(entries.map((e: any) => e.op.type)).toContain('create_index');
        const started = Date.now();
        await driver.applyMigrationEntries(entries);
        const elapsed = Date.now() - started;

        // It waited the bound itself instead of deferring at once.
        expect(concurrentCreates()).toHaveLength(2);
        expect(elapsed).toBeGreaterThanOrEqual(1400);
        expect(logged(log.error)).toContain(`index '${nameOf(TASK, BY_CODE)}' on "${TASK}" was NOT built: the concurrent build timed out`);
      }, 20_000);

      it('os migrate apply refuses with the lock-wait refusal instead of reporting success', async () => {
        // A boot timeout first, so the flush starts inside an open window: it
        // must still wait for itself (the refusal's cause is the 55P03 of its own
        // wait), not refuse on the window an earlier sync opened.
        await driver.initObjects([objectOf(TASK, [BY_CODE]) as any]);
        expect(concurrentCreates()).toHaveLength(1);
        driver.setDeferredDdl(true);
        await driver.initObjects([objectOf(JOB, [BY_STAGE]) as any]);
        const err: any = await driver.flushDeferredSchemaDdl().then(
          () => null,
          (e) => e,
        );
        expect(concurrentCreates()).toHaveLength(2);
        expect(err).not.toBeNull();
        expect(err.code).toBe('DATABASE_ERROR');
        expect(err.status).toBe(500);
        expect(err[LOCK_WAIT_REFUSAL]).toBe(true);
        expect(err.message).toContain(`Migration of table '${JOB}' timed out after 1.5s waiting for a PostgreSQL lock`);
        expect((err.cause as any)?.code ?? (err.cause as any)?.cause?.code).toBe('55P03');
      }, 20_000);
    });

    it('CONTROL: a table the sync creates keeps the plain path', async () => {
      await driver.initObjects([objectOf(JOB, [BY_STAGE, UNIQUE_CODE]) as any]);
      const indexDdl = ddl.filter((s) => /index|constraint/i.test(s));
      expect(indexDdl.some((s) => /concurrently/i.test(s))).toBe(false);
      expect(indexDdl).toContain(`create index "${nameOf(JOB, BY_STAGE)}" on "${JOB}" ("stage")`);
      expect(indexDdl).toContain(`alter table "${JOB}" add constraint "${nameOf(JOB, UNIQUE_CODE)}" unique ("code")`);
    });
  });
}

/**
 * CONTROL: on every other dialect the existing-table path sends the statement
 * it always sent.
 */
const CONTROL_DDL = {
  sqlite: `create index \`${nameOf(JOB, BY_STAGE)}\` on \`${JOB}\` (\`stage\`)`,
  mysql: `alter table \`${JOB}\` add index \`${nameOf(JOB, BY_STAGE)}\`(\`stage\`)`,
};

function declarePlainDialectControl(cell: DialectCell): void {
  describe(`existing-table index backfill is unchanged — ${cell.label} (#31901)`, () => {
    let driver: SqlDriver;
    let ddl: string[];

    beforeEach(async () => {
      ({ driver, ddl } = newDriver(cell));
      await driver.execute(`drop table if exists ${JOB}`).catch(() => {});
    });

    afterEach(async () => {
      await driver.execute(`drop table if exists ${JOB}`).catch(() => {});
      await driver.disconnect();
    });

    it('builds the missing index with the plain statement', async () => {
      // The table an earlier release built without this index. Created WITH it
      // and the index dropped, so MySQL has already chosen a keyable column type.
      await driver.initObjects([objectOf(JOB, [BY_STAGE]) as any]);
      await driver.execute(
        cell.id === 'mysql' ? `drop index ${nameOf(JOB, BY_STAGE)} on ${JOB}` : `drop index ${nameOf(JOB, BY_STAGE)}`,
      );
      ddl.length = 0;
      await driver.initObjects([objectOf(JOB, [BY_STAGE]) as any]);
      expect(ddl).toEqual([CONTROL_DDL[cell.id as 'sqlite' | 'mysql']]);
    });
  });
}

declareDialectCell(PG_CELL, 'existing-table concurrent index backfill (#31901)', declarePostgresPins);
declareDialectCell(dialectCell('sqlite'), 'existing-table index backfill control (#31901)', declarePlainDialectControl);
declareDialectCell(MYSQL_CELL, 'existing-table index backfill control (#31901)', declarePlainDialectControl);
