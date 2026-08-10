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
 *     carries the ordering. On the embedded cell the property test cannot be
 *     trusted on its own: SQLite over a twelve-row table hands back both ties
 *     and wholly unordered rows in rowid order every time, so the partition
 *     check passes with or without the fix. The emitted-SQL assertion is the
 *     half that fails then.
 *
 * That asymmetry is the point rather than an apology for it: the property is
 * the contract, and the clause is how this backend happens to keep it.
 *
 * The second half reads the statement off knex's `query` event during a real
 * `find()` rather than recompiling one the way the driver would have. That
 * distinction is load-bearing: a test that rebuilds the ORDER BY itself asserts
 * only that the helper works, and stays green on the day `find()` stops calling
 * it — which is precisely the day this file exists for.
 *
 * # The DRIVER axis (#4714, ADR-0053 D-A3)
 *
 * D-A3 declares the matrix over `driver {SQLite, Postgres at minimum}`. Both
 * describes above used to hard-code `client: 'better-sqlite3'`, so the shared
 * `PAGINATION_CASES` / `PAGINATION_UNORDERED_CASES` only ever ran on the one
 * backend whose head note (above) says the property half proves nothing there.
 * That is the asymmetry stated as a permanent excuse rather than as the local
 * fact it is: on a real server the partition check is the half with teeth,
 * because a plan that reshuffles ties across two statements is what objectui#3106
 * was actually reported as.
 *
 * So both halves now run once per cell of `DIALECT_CELLS` — SQLite always, live
 * Postgres and MySQL when `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are
 * provisioned — over the SAME cases, asserting the SAME row-id sets cell for
 * cell. A cell nobody provisioned is a named skip, and a red under
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1` (`declareUnprovisionedCell`): a matrix that
 * silently found zero live cells must not report OK (#4646). No new CI job — the
 * `Temporal Conformance (live PG + MySQL)` workflow already runs this whole
 * package against both servers.
 *
 * Two things this file deliberately does NOT do:
 *
 *   - **No server-timezone axis.** D-B3's three-way skew guard belongs to the
 *     temporal matrix, whose answers a zone can move; nothing here compares an
 *     instant, so requiring a non-UTC server would only manufacture reds that
 *     say nothing about pagination.
 *   - **No tie-breaking added to the fixture to keep a dialect green.** The
 *     shared rows repeat their sort keys on purpose; a live cell that goes red
 *     over them is the finding this axis exists to surface, not a case to
 *     soften. (`@objectstack/spec/data` is consumed here, never edited.)
 *
 * Honest limit of the live cells: twelve rows is one seq scan, so a server MAY
 * hand ties back in a steady order anyway and pass without the tie-breaker.
 * The clause half — now also per dialect — is what stays sharp in that case.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  PAGINATION_ALL_IDS,
  PAGINATION_CASES,
  PAGINATION_ROWS,
  PAGINATION_UNORDERED_CASES,
  PAGINATION_ZERO_LIMIT_CASES,
} from '@objectstack/spec/data';
import type { QueryAST } from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';
import {
  DIALECT_CELLS,
  declareUnprovisionedCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/**
 * One table per sweep, issue-prefixed: the live cells share a database with
 * every other suite in this package (and with each other's runs), so a name
 * collision would show up as a pagination failure in whichever suite lost the
 * race.
 */
const PAGED_TABLE = 'os4714_pagination';
const CLAUSE_TABLE = 'os4714_pagination_clause';

/**
 * How each dialect spells a quoted identifier — knex's own quoting, which is
 * what the emitted SQL carries. The clause assertions match on the quoted form
 * rather than a bare word so `id` cannot be satisfied by an unrelated
 * substring, exactly as they did when this file was SQLite-only.
 */
const IDENTIFIER_QUOTE: Record<DialectCell['id'], string> = {
  sqlite: '`',
  pg: '"',
  mysql: '`',
};

/** `/order by .*"status" asc,.*"id" asc/i` for the cell's quoting. */
function orderedBy(cell: DialectCell, ...keys: Array<[string, 'asc' | 'desc']>): RegExp {
  const q = IDENTIFIER_QUOTE[cell.id];
  return new RegExp(`order by ${keys.map(([f, d]) => `.*${q}${f}${q} ${d}`).join(',')}`, 'i');
}

/** Live cells reuse one database, so every sweep starts from a dropped table. */
async function freshTable(
  driver: SqlDriver,
  shape: { name: string; fields: Record<string, { type: string }> },
): Promise<void> {
  await driver.execute(`drop table if exists ${shape.name}`).catch(() => {});
  await driver.initObjects([shape as any]);
}

async function dropTable(driver: SqlDriver | undefined, table: string): Promise<void> {
  await driver?.execute(`drop table if exists ${table}`).catch(() => {});
}

const ticketShape = (name: string) => ({
  name,
  fields: {
    status: { type: 'string' },
    rank: { type: 'integer' },
    name: { type: 'string' },
  },
});

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

  /**
   * The SQL of the single statement `run` issued **against `table`**.
   *
   * Scoped to the table rather than "the only statement of the run" because a
   * live cell's connection is pooled and a dialect may introspect on first use;
   * neither is the statement under test. Two statements against the same table
   * still fail here, which is the assertion's actual job.
   */
  async sqlOf(table: string, run: () => Promise<unknown>): Promise<string> {
    const from = this.statements.length;
    await run();
    const issued = this.statements.slice(from).filter((sql) => sql.includes(table));
    expect(issued, `expected exactly one statement against ${table}`).toHaveLength(1);
    return issued[0]!;
  }
}

// ── The driver axis ─────────────────────────────────────────────────────────

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, 'paged-read conformance');
    continue;
  }
  declarePartitionSweep(cell);
  declareClauseSweep(cell);
}

// ── Half 1: the property, over the shared cases ─────────────────────────────

function declarePartitionSweep(cell: DialectCell): void {
  describe(`SqlDriver — paged reads are a partition of the result set (objectui#3106) (${cell.label})`, () => {
    let driver: SqlDriver;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await freshTable(driver, ticketShape(PAGED_TABLE));

      for (const row of PAGINATION_ROWS) {
        await driver.create(PAGED_TABLE, { ...row }, { bypassTenantAudit: true });
      }
    });

    afterAll(async () => {
      await dropTable(driver, PAGED_TABLE);
      await driver?.disconnect?.();
    });

    const walk = async (query: Omit<QueryAST, 'object'>, pageSize: number) => {
      const paged: Array<Record<string, unknown>> = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += pageSize) {
        const page = await driver.find(
          PAGED_TABLE,
          { ...query, limit: pageSize, offset },
          { bypassTenantAudit: true },
        );
        paged.push(...page);
      }
      return paged;
    };

    for (const testCase of PAGINATION_CASES) {
      it(`visits every row exactly once — ${testCase.name}`, async () => {
        const seen = (await walk({ orderBy: [...testCase.orderBy] }, testCase.pageSize)).map((r) =>
          String(r.id),
        );

        expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
        expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
        expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
      });

      it(`orders pages consistently with the requested sort — ${testCase.name}`, async () => {
        const paged = await walk({ orderBy: [...testCase.orderBy] }, testCase.pageSize);

        // Concatenating the pages must reproduce the same order an unpaged read
        // of the whole set gives — that the page boundaries are invisible is the
        // user-facing half of the guarantee.
        const whole = await driver.find(
          PAGED_TABLE,
          { orderBy: [...testCase.orderBy] },
          { bypassTenantAudit: true },
        );
        expect(paged.map((r) => r.id)).toEqual(whole.map((r) => r.id));
      });
    }

    for (const testCase of PAGINATION_UNORDERED_CASES) {
      it(`visits every row exactly once with NO orderBy at all — ${testCase.name}`, async () => {
        const seen = (await walk({}, testCase.pageSize)).map((r) => String(r.id));

        expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
        expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
        expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
      });

      it(`walks an unsorted read in id order — ${testCase.name}`, async () => {
        const paged = (await walk({}, testCase.pageSize)).map((r) => String(r.id));

        // The fixture's ids are shuffled relative to insertion order, so id order
        // is visibly an order this driver chose rather than the one the table
        // would have handed back anyway.
        expect(paged).toEqual([...PAGINATION_ALL_IDS].sort());
      });
    }

    it('leaves an UNPAGED unordered read alone — no sort is imposed on a caller who asked for none', async () => {
      // The carve-out (objectstack#4363): with no `limit`/`offset` the caller
      // receives the whole matching set, so no slice can be wrong, and an
      // imposed ORDER BY would only change plan selection.
      const rows = await driver.find(
        PAGED_TABLE,
        {},
        { bypassTenantAudit: true },
      );
      expect([...rows.map((r) => String(r.id))].sort()).toEqual([...PAGINATION_ALL_IDS].sort());

      // WHICH order those rows arrive in is the dialect's own answer, and the
      // one thing #4363 promises about this shape is that the driver adds
      // nothing to it — so only the embedded cell, whose plan is fixed, pins the
      // exact sequence (insertion order, visibly not the shuffled ids' order).
      // MySQL hands back InnoDB primary-key order and Postgres its heap order;
      // pinning either would assert the server's plan as if it were our
      // contract. The contract half — that no ORDER BY was emitted at all — is
      // asserted per dialect in the clause sweep below.
      if (!cell.live) {
        expect(rows.map((r) => r.id)).toEqual(PAGINATION_ROWS.map((r) => r.id));
      }
    });

    /**
     * `limit: 0` means "return no records" (#6485/#6577). `findRows()` has
     * always compiled `limit` on presence, so this cell is green on arrival —
     * which is the point of pinning it: two sibling doors in this same file
     * compiled it on TRUTHINESS until #6577, and returned the whole table for a
     * query that asked for none. Run per dialect because `LIMIT 0` is the one
     * bound value a server is free to treat as a special case.
     */
    describe('`limit: 0` returns no records', () => {
      for (const testCase of PAGINATION_ZERO_LIMIT_CASES) {
        it(testCase.name, async () => {
          const rows = await driver.find(
            PAGED_TABLE,
            { ...testCase.query },
            { bypassTenantAudit: true },
          );
          expect(rows).toHaveLength(testCase.expectedRowCount);
        });
      }
    });
  });
}

// ── Half 2: the ORDER BY that reaches the database ──────────────────────────

function declareClauseSweep(cell: DialectCell): void {
  describe(`SqlDriver — the ORDER BY that reaches the database (${cell.label})`, () => {
    let driver: InspectableSqlDriver;

    beforeAll(async () => {
      driver = new InspectableSqlDriver(cell.config());
      await freshTable(driver, {
        name: CLAUSE_TABLE,
        fields: { status: { type: 'string' }, rank: { type: 'integer' } },
      });
      // One warm-up read before the recorder is installed: a live dialect may
      // introspect on first use, and that statement is not the one under test.
      await driver.find(CLAUSE_TABLE, {}, { bypassTenantAudit: true });
      driver.captureStatements();
    });

    afterAll(async () => {
      await dropTable(driver, CLAUSE_TABLE);
      await driver?.disconnect?.();
    });

    const sqlOfFind = (query: Omit<QueryAST, 'object'>) =>
      driver.sqlOf(CLAUSE_TABLE, () =>
        driver.find(CLAUSE_TABLE, { ...query }, { bypassTenantAudit: true }),
      );

    it('appends `id` after a non-unique sort key', async () => {
      const sql = await sqlOfFind({ orderBy: [{ field: 'status', order: 'asc' }] });
      expect(sql).toMatch(orderedBy(cell, ['status', 'asc'], ['id', 'asc']));
    });

    it("appends `id` in the LAST key's direction, so one index pass can serve it", async () => {
      const sql = await sqlOfFind({
        orderBy: [
          { field: 'status', order: 'asc' },
          { field: 'rank', order: 'desc' },
        ],
      });
      expect(sql).toMatch(orderedBy(cell, ['status', 'asc'], ['rank', 'desc'], ['id', 'desc']));
    });

    it('does not repeat `id` when the caller already sorted by it', async () => {
      const sql = await sqlOfFind({ orderBy: [{ field: 'id', order: 'desc' }], limit: 5, offset: 5 });
      const q = IDENTIFIER_QUOTE[cell.id];
      expect(sql.match(new RegExp(`${q}id${q}`, 'g')) ?? []).toHaveLength(1);
    });

    it('orders a paged read by `id` when the caller sent no orderBy (objectstack#4363)', async () => {
      expect(await sqlOfFind({ limit: 5, offset: 5 })).toMatch(orderedBy(cell, ['id', 'asc']));
    });

    it('counts `limit` alone as paged — page one must agree with pages two onward', async () => {
      // A list view's first request is routinely `limit=50` with no offset at
      // all. Ordering only the offset-carrying pages would cut page one from a
      // different arrangement than the rest of the walk: the defect intact,
      // wearing a fix.
      expect(await sqlOfFind({ limit: 5 })).toMatch(orderedBy(cell, ['id', 'asc']));
      expect(await sqlOfFind({ offset: 5 })).toMatch(orderedBy(cell, ['id', 'asc']));
      expect(await sqlOfFind({ orderBy: [], limit: 5 })).toMatch(orderedBy(cell, ['id', 'asc']));
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
      const sql = await driver.sqlOf(CLAUSE_TABLE, () =>
        driver.findOne(
          CLAUSE_TABLE,
          { where: { status: 'open' } },
          { bypassTenantAudit: true },
        ),
      );
      expect(sql).not.toMatch(/order by/i);
      expect(sql).toMatch(/limit/i);
    });

    it('still honors an orderBy the caller gave findOne, tie-breaker and all', async () => {
      const sql = await driver.sqlOf(CLAUSE_TABLE, () =>
        driver.findOne(
          CLAUSE_TABLE,
          { orderBy: [{ field: 'status', order: 'desc' }] },
          { bypassTenantAudit: true },
        ),
      );
      expect(sql).toMatch(orderedBy(cell, ['status', 'desc'], ['id', 'desc']));
    });

    it('adds nothing for an object this driver did not create', () => {
      // A federated table (ADR-0015) may have no `id` column at all. Sorting by a
      // column that isn't there raises an unknown-column error, which the #3821
      // ladder answers by retrying with NO ORDER BY — so a guess here would cost
      // the caller their whole sort to fix a reshuffle among ties. It costs even
      // more on the unsorted paged read: there is no requested sort to fall back
      // to, so a wrong guess turns a reshuffle into a failed read.
      expect(driver['paginationTieBreaker']('some_remote_table')).toBeNull();
      expect(
        driver['orderKeysFor']('some_remote_table', {
          limit: 5,
          offset: 5,
        }),
      ).toEqual([]);
    });

    it('says so, once, when it cannot keep the guarantee on a table it did not create', () => {
      // Behavior is unchanged for these tables — the statement goes out exactly
      // as before. What changes is that the gap is announced instead of being
      // left for a user counting records to find, which is the same reason the
      // rule exists at all.
      //
      // Its own object name, because "once" is counted per object for the LIFE
      // of the driver and this sweep shares one driver across its tests (a live
      // cell cannot afford a fresh connection per assertion). Reusing the name
      // the test above already paged would measure that suite's leftovers.
      const remote = 'warned_remote_table';
      const warn = vi.spyOn(driver['logger'], 'warn').mockImplementation(() => {});
      try {
        driver['orderKeysFor'](remote, { limit: 5, offset: 5 });
        driver['orderKeysFor'](remote, { limit: 5, offset: 10 });
        expect(warn, 'once per object, not per query').toHaveBeenCalledTimes(1);
        const message = warn.mock.calls[0]![0];
        expect(message, 'names the object').toContain(remote);
        expect(message, 'names the consequence').toMatch(/NOT deterministic/);
        expect(message, 'names a remedy').toMatch(/orderBy/);

        // A managed table keeps the guarantee, so it must stay quiet.
        driver['orderKeysFor'](CLAUSE_TABLE, { limit: 5, offset: 5 });
        // So must an unpaged read, and a sorted one: neither is the silent case.
        driver['orderKeysFor'](remote, {});
        driver['orderKeysFor'](remote, {
          orderBy: [{ field: 'status', order: 'asc' }],
          limit: 5,
        });
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });
  });
}
