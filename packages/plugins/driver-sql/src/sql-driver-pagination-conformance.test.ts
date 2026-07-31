// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deterministic paged reads for the SQL driver (objectui#3106,
 * objectstack#4363) — the contract on `IDataDriver.find`, checked against the
 * shared cases in `@objectstack/spec/data` so this driver, `driver-memory` and
 * `driver-mongodb` answer one standard.
 *
 * Two halves, because either alone would be reassuring and wrong:
 *
 *  1. **The property** — walk each case page by page and assert the pages
 *     partition the collection. This is what a user experiences, and it is what
 *     a future driver has to satisfy however it chooses to.
 *
 *  2. **The clause** — assert the SQL that actually reached the database
 *     carries the ordering. The property test cannot be trusted on its own
 *     *here*: SQLite over a twelve-row table hands back both ties and wholly
 *     unordered rows in rowid order every time, so the partition check passes
 *     with or without the fix. It is a real check on MongoDB (where the
 *     reshuffle is documented and observable) and a regression lock on the
 *     memory driver; on SQL it would pass the day someone deletes the feature.
 *     The emitted-SQL assertion is the half that fails then.
 *
 * That asymmetry is the point rather than an apology for it: the property is
 * the contract, and the clause is how this backend happens to keep it.
 *
 * The second half reads the statement off knex's `query` event during a real
 * `find()` rather than recompiling one the way the driver would have. That
 * distinction is load-bearing: a test that rebuilds the ORDER BY itself asserts
 * only that the helper works, and stays green on the day `find()` stops calling
 * it — which is precisely the day this file exists for.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PAGINATION_ALL_IDS,
  PAGINATION_CASES,
  PAGINATION_ROWS,
  PAGINATION_UNORDERED_CASES,
} from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';

/**
 * Records the SQL of every statement this driver sends, so a test can assert
 * what `find()` really emitted rather than what it ought to have.
 */
class InspectableSqlDriver extends SqlDriver {
  readonly statements: string[] = [];

  captureStatements(): void {
    this.knex.on('query', (data: { sql?: string }) => {
      if (typeof data?.sql === 'string') this.statements.push(data.sql);
    });
  }

  /** The SQL of the single statement issued while running `run`. */
  async sqlOf(run: () => Promise<unknown>): Promise<string> {
    const from = this.statements.length;
    await run();
    const issued = this.statements.slice(from);
    expect(issued, 'expected exactly one statement').toHaveLength(1);
    return issued[0]!;
  }
}

describe('SqlDriver — paged reads are a partition of the result set (objectui#3106)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await driver.initObjects([
      {
        name: 'ticket',
        fields: {
          status: { type: 'string' },
          rank: { type: 'integer' },
          name: { type: 'string' },
        },
      },
    ]);

    for (const row of PAGINATION_ROWS) {
      await driver.create('ticket', { ...row }, { bypassTenantAudit: true });
    }
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  for (const testCase of PAGINATION_CASES) {
    it(`visits every row exactly once — ${testCase.name}`, async () => {
      const seen: string[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find(
          'ticket',
          { orderBy: [...testCase.orderBy], limit: testCase.pageSize, offset } as any,
          { bypassTenantAudit: true } as any,
        );
        seen.push(...page.map((r) => String(r.id)));
      }

      expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
      expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
      expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });

    it(`orders pages consistently with the requested sort — ${testCase.name}`, async () => {
      const paged: Array<Record<string, unknown>> = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find(
          'ticket',
          { orderBy: [...testCase.orderBy], limit: testCase.pageSize, offset } as any,
          { bypassTenantAudit: true } as any,
        );
        paged.push(...page);
      }

      // Concatenating the pages must reproduce the same order an unpaged read
      // of the whole set gives — that the page boundaries are invisible is the
      // user-facing half of the guarantee.
      const whole = await driver.find(
        'ticket',
        { orderBy: [...testCase.orderBy] } as any,
        { bypassTenantAudit: true } as any,
      );
      expect(paged.map((r) => r.id)).toEqual(whole.map((r) => r.id));
    });
  }

  for (const testCase of PAGINATION_UNORDERED_CASES) {
    it(`visits every row exactly once with NO orderBy at all — ${testCase.name}`, async () => {
      const seen: string[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find(
          'ticket',
          { limit: testCase.pageSize, offset } as any,
          { bypassTenantAudit: true } as any,
        );
        seen.push(...page.map((r) => String(r.id)));
      }

      expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
      expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
      expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });

    it(`walks an unsorted read in id order — ${testCase.name}`, async () => {
      const paged: string[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find(
          'ticket',
          { limit: testCase.pageSize, offset } as any,
          { bypassTenantAudit: true } as any,
        );
        paged.push(...page.map((r) => String(r.id)));
      }

      // The fixture's ids are shuffled relative to insertion order, so id order
      // is visibly an order this driver chose rather than the one the table
      // would have handed back anyway.
      expect(paged).toEqual([...PAGINATION_ALL_IDS].sort());
    });
  }

  it('leaves an UNPAGED unordered read alone — no sort is imposed on a caller who asked for none', async () => {
    // The carve-out (objectstack#4363): with no `limit`/`offset` the caller
    // receives the whole matching set, so no slice can be wrong, and an imposed
    // ORDER BY would only change plan selection. The order below is SQLite's
    // own answer, not one this driver asked for — which the shuffled fixture
    // ids make visible.
    const rows = await driver.find('ticket', {} as any, { bypassTenantAudit: true } as any);
    expect(rows.map((r) => r.id)).toEqual(PAGINATION_ROWS.map((r) => r.id));
  });
});

describe('SqlDriver — the ORDER BY that reaches the database', () => {
  let driver: InspectableSqlDriver;

  beforeEach(async () => {
    driver = new InspectableSqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      { name: 'ticket', fields: { status: { type: 'string' }, rank: { type: 'integer' } } },
    ]);
    driver.captureStatements();
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  const sqlOfFind = (query: Record<string, unknown>) =>
    driver.sqlOf(() => driver.find('ticket', query as any, { bypassTenantAudit: true } as any));

  it('appends `id` after a non-unique sort key', async () => {
    const sql = await sqlOfFind({ orderBy: [{ field: 'status', order: 'asc' }] });
    expect(sql).toMatch(/order by .*`status` asc, .*`id` asc/i);
  });

  it('appends `id` in the LAST key\'s direction, so one index pass can serve it', async () => {
    const sql = await sqlOfFind({
      orderBy: [
        { field: 'status', order: 'asc' },
        { field: 'rank', order: 'desc' },
      ],
    });
    expect(sql).toMatch(/order by .*`status` asc, .*`rank` desc, .*`id` desc/i);
  });

  it('does not repeat `id` when the caller already sorted by it', async () => {
    const sql = await sqlOfFind({ orderBy: [{ field: 'id', order: 'desc' }], limit: 5, offset: 5 });
    expect(sql.match(/`id`/g) ?? []).toHaveLength(1);
  });

  it('orders a paged read by `id` when the caller sent no orderBy (objectstack#4363)', async () => {
    expect(await sqlOfFind({ limit: 5, offset: 5 })).toMatch(/order by .*`id` asc/i);
  });

  it('counts `limit` alone as paged — page one must agree with pages two onward', async () => {
    // A list view's first request is routinely `limit=50` with no offset at
    // all. Ordering only the offset-carrying pages would cut page one from a
    // different arrangement than the rest of the walk: the defect intact,
    // wearing a fix.
    expect(await sqlOfFind({ limit: 5 })).toMatch(/order by .*`id` asc/i);
    expect(await sqlOfFind({ offset: 5 })).toMatch(/order by .*`id` asc/i);
    expect(await sqlOfFind({ orderBy: [], limit: 5 })).toMatch(/order by .*`id` asc/i);
  });

  it('emits no ORDER BY for an unpaged read with no orderBy', async () => {
    expect(await sqlOfFind({})).not.toMatch(/order by/i);
    expect(await sqlOfFind({ where: { status: 'open' } })).not.toMatch(/order by/i);
    expect(await sqlOfFind({ orderBy: [] })).not.toMatch(/order by/i);
  });

  it('leaves `findOne` unordered — its `limit: 1` is not page one of a walk', async () => {
    // `findOne` promises *a* matching record, not a position in a sequence, so
    // there is no partition to keep. Reading its `limit: 1` as a page would
    // impose `ORDER BY id LIMIT 1` on the hottest read in the system, which is
    // the shape that makes a planner abandon the predicate's own index: on a
    // 2M-row Postgres table `WHERE owner_id = ? LIMIT 1` measured 0.08 ms
    // unordered and 7.8 ms with `ORDER BY id`. `MongoDBDriver.findOne` has
    // never sorted either — this keeps the two drivers saying the same thing.
    const sql = await driver.sqlOf(() =>
      driver.findOne('ticket', { where: { status: 'open' } } as any, {
        bypassTenantAudit: true,
      } as any),
    );
    expect(sql).not.toMatch(/order by/i);
    expect(sql).toMatch(/limit/i);
  });

  it('still honors an orderBy the caller gave findOne, tie-breaker and all', async () => {
    const sql = await driver.sqlOf(() =>
      driver.findOne('ticket', { orderBy: [{ field: 'status', order: 'desc' }] } as any, {
        bypassTenantAudit: true,
      } as any),
    );
    expect(sql).toMatch(/order by .*`status` desc, .*`id` desc/i);
  });

  it('adds nothing for an object this driver did not create', () => {
    // A federated table (ADR-0015) may have no `id` column at all. Sorting by a
    // column that isn't there raises an unknown-column error, which the #3821
    // ladder answers by retrying with NO ORDER BY — so a guess here would cost
    // the caller their whole sort to fix a reshuffle among ties. It costs even
    // more on the unsorted paged read: there is no requested sort to fall back
    // to, so a wrong guess turns a reshuffle into a failed read.
    expect(driver['paginationTieBreaker']('some_remote_table')).toBeNull();
    expect(driver['orderKeysFor']('some_remote_table', { limit: 5, offset: 5 } as any)).toEqual([]);
  });

  it('says so, once, when it cannot keep the guarantee on a table it did not create', () => {
    // Behavior is unchanged for these tables — the statement goes out exactly
    // as before. What changes is that the gap is announced instead of being
    // left for a user counting records to find, which is the same reason the
    // rule exists at all.
    const warn = vi.spyOn(driver['logger'], 'warn').mockImplementation(() => {});
    try {
      driver['orderKeysFor']('some_remote_table', { limit: 5, offset: 5 } as any);
      driver['orderKeysFor']('some_remote_table', { limit: 5, offset: 10 } as any);
      expect(warn, 'once per object, not per query').toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0]![0];
      expect(message, 'names the object').toContain('some_remote_table');
      expect(message, 'names the consequence').toMatch(/NOT deterministic/);
      expect(message, 'names a remedy').toMatch(/orderBy/);

      // A managed table keeps the guarantee, so it must stay quiet.
      driver['orderKeysFor']('ticket', { limit: 5, offset: 5 } as any);
      // So must an unpaged read, and a sorted one: neither is the silent case.
      driver['orderKeysFor']('some_remote_table', {} as any);
      driver['orderKeysFor'](
        'some_remote_table',
        { orderBy: [{ field: 'status', order: 'asc' }], limit: 5 } as any,
      );
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
