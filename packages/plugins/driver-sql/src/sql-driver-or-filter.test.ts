// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for the SQL compiler, on real engines.
 *
 * The shared cases come from `@objectstack/spec/data` so this backend,
 * `driver-memory`, `formula`'s `matchesFilterCondition` and `read-scope-sql`
 * are all held to one standard — see `filter-logic-conformance.ts` for why that
 * standard exists (#3774). Adding a case there adds it to all four at once.
 *
 * This file is the one that was actually failing: `applyFilterCondition` passed
 * `logicalOp='or'` down into each `$or` branch's recursive call, so the branch's
 * own contents were joined with `orWhere` too — `{$or:[{a,b}]}` compiled to
 * `a = ? OR b = ?`, and `{$or:[{d:{$gte:X,$lt:Y}}]}` to `d >= ? OR d < ?`, which
 * matches every row. Every such miscompile widens the result set.
 *
 * The SQL-specific cases below the conformance sweep cover ground the shared
 * table deliberately leaves out: a real DATE-typed column, and columns whose
 * values are not the shared fixture's plain strings.
 *
 * # The DRIVER axis (#4714, ADR-0053 D-A3)
 *
 * D-A3 declares the matrix over `driver {SQLite, Postgres at minimum}`. This
 * suite used to hard-code `client: 'better-sqlite3'` — its describe was even
 * named `(SQLite)` — so what it proved was that ONE engine executes the
 * compiled predicate as the table says, while `where`-clause grouping and
 * three-valued logic are precisely where dialects are free to differ. A
 * compiler bug that only Postgres or MySQL can see had nothing to fail.
 *
 * So the sweep runs once per cell of `DIALECT_CELLS` — SQLite always, live
 * Postgres and MySQL when `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are
 * provisioned — over the SAME `FILTER_LOGIC_CASES`, asserting the SAME row-id
 * sets cell for cell. A cell nobody provisioned is a named skip, and a red under
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1` (`declareUnprovisionedCell`): a matrix that
 * silently found zero live cells must not report OK (#4646). No new CI job — the
 * `Temporal Conformance (live PG + MySQL)` workflow already runs this whole
 * package against both servers.
 *
 * The shared cases are consumed here, never edited: if a live cell goes red the
 * finding is that dialect's compile, not the case. (Nothing here is temporal, so
 * the D-B3 server-timezone axis does not apply — requiring a non-UTC server
 * would only manufacture reds that say nothing about `$or`.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';
import {
  DIALECT_CELLS,
  declareUnprovisionedCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/**
 * Issue-prefixed table names: the live cells share one database with every
 * other suite in this package (and with each other's runs), so the bare `t` /
 * `task` this suite used while it was SQLite-only would be a collision waiting
 * to be read as a conformance failure.
 */
const FILTER_TABLE = 'os4714_filter_logic';
const DATE_WINDOW_TABLE = 'os4714_filter_logic_windows';

// ── The driver axis ─────────────────────────────────────────────────────────

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, 'filter-logic conformance');
    continue;
  }
  declareFilterLogicSweep(cell);
}

function declareFilterLogicSweep(cell: DialectCell): void {
  describe(`SqlDriver filter logic conformance (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: any;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = (driver as any).knex;

      // Live cells reuse one database, so the sweep starts from a dropped table.
      await knexInstance.schema.dropTableIfExists(FILTER_TABLE);
      await knexInstance.schema.createTable(FILTER_TABLE, (t: any) => {
        t.string('id').primary();
        t.string('a');
        t.string('b');
        t.string('c');
        t.string('owner');
        t.string('status');
        t.string('parent_object');
        t.string('parent_id');
      });
      await knexInstance(FILTER_TABLE).insert([...FILTER_LOGIC_ROWS]);
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(FILTER_TABLE).catch(() => {});
      await driver?.disconnect?.();
    });

    describe('shared conformance cases', () => {
      for (const c of FILTER_LOGIC_CASES) {
        it(c.name, async () => {
          const rows = await driver.find(FILTER_TABLE, { object: FILTER_TABLE, where: c.filter });
          const got = rows
            .map((r: any) => String(r.id))
            .sort((x: string, y: string) => x.localeCompare(y));
          expect(got, c.note).toEqual(c.expected);
        });
      }
    });

    /**
     * The abutting-window pattern the automation skill docs recommend and the CLI
     * flow linter blesses (`lint-flow-patterns`): each tier is one field carrying
     * two operators. "Windows tile the timeline so each record matches exactly one
     * tier" only holds if those operators AND — under the old compile every tier
     * degenerated to `d >= lo OR d < hi`, i.e. matched every row.
     *
     * The shared table pins this shape on plain strings; this pins it on a real
     * date column, where value coercion also runs — and now on each dialect's own
     * DATE type, which is where a bare `YYYY-MM-DD` comparand stops being one
     * agreed thing (the D-B2 divergence, measured on PG @ Asia/Shanghai).
     */
    describe('multi-operator date windows inside $or', () => {
      beforeAll(async () => {
        await knexInstance.schema.dropTableIfExists(DATE_WINDOW_TABLE);
        await knexInstance.schema.createTable(DATE_WINDOW_TABLE, (t: any) => {
          t.string('id').primary();
          t.date('end_date');
        });
        await knexInstance(DATE_WINDOW_TABLE).insert([
          { id: 'd07', end_date: '2026-08-07' },
          { id: 'd15', end_date: '2026-08-15' },
          { id: 'd30', end_date: '2026-08-30' },
          { id: 'd60', end_date: '2026-09-29' },
        ]);
      });

      afterAll(async () => {
        await knexInstance?.schema.dropTableIfExists(DATE_WINDOW_TABLE).catch(() => {});
      });

      it('matches only the rows inside the abutting windows', async () => {
        const rows = await driver.find(DATE_WINDOW_TABLE, {
          object: DATE_WINDOW_TABLE,
          where: {
            $or: [
              { end_date: { $gte: '2026-08-07', $lt: '2026-08-08' } },
              { end_date: { $gte: '2026-08-30', $lt: '2026-08-31' } },
            ],
          },
        });
        expect(rows.map((r: any) => r.id).sort()).toEqual(['d07', 'd30']);
      });

      it('keeps a window AND-ed with a sibling key in the same branch', async () => {
        const rows = await driver.find(DATE_WINDOW_TABLE, {
          object: DATE_WINDOW_TABLE,
          where: {
            $or: [
              { id: 'nope' },
              { end_date: { $gte: '2026-08-07', $lt: '2026-08-31' }, id: 'd15' },
            ],
          },
        });
        expect(rows.map((r: any) => r.id)).toEqual(['d15']);
      });
    });
  });
}
