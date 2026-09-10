// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15683] A text operator over a column whose DECLARED type is TEMPORAL —
 * the SQL half of the maintainer's 2026-09-05 ruling, executed on every
 * dialect this driver speaks and compiled for the ones it cannot execute.
 *
 * ## The cell this closes
 *
 * One filter, `{ d: { $contains: '2026' } }`, over a `Field.date` column
 * holding `2026-01-05`, answered three ways across the SQL family and a
 * fourth on the JS faces:
 *
 * | face | answer | mechanism |
 * |:--|:--|:--|
 * | SQLite (this driver, `sqlite-wasm`, turso local) | the row | the column stores canonical ISO TEXT (ADR-0053), so `GLOB '*2026*'` matched it |
 * | live PostgreSQL 16.13 | `DATABASE_ERROR` 500 | `operator does not exist: date ~~ unknown` (SQLSTATE 42883) |
 * | MySQL | NOT MEASURED | reads as coercion via `CAST(col AS BINARY) LIKE` |
 * | `driver-memory` / `formula` / `having` | whatever was STORED | those faces type-gate on the VALUE and hold no schema |
 *
 * The maintainer ruled (a): 「a text operator over a column whose DECLARED type
 * is temporal is type-gated exactly like the numeric and boolean classes; the
 * SQLite ISO-text match is not a contract」. So the positive operators compile
 * to the FALSE constant, `$notContains` to the TRUE constant, Postgres's 500
 * becomes that declared answer, and the ISO-substring match is RETIRED —
 * "records in 2026" is a range query.
 *
 * ## Why this file is not rows in `FILTER_TEXT_CASES`
 *
 * That table is keyed on the STORED value — its non-string column is
 * deliberately a number and not a date, because "a date's stored form is a
 * dialect question this table does not rule on" (its own `FilterTextRow`
 * docblock). Enrolling a temporal column there would assert one stored form
 * across all five drivers that import it, which is the stored-form guarantee
 * the ruling refused option (b) for. The temporal half is decidable only on
 * the DECLARED-type faces, so it is pinned on each of them against its own
 * registry — here, for `driver-sql` and everything that inherits its compiler.
 *
 * ## Which cells executed
 *
 *   - **sqlite** — always, embedded. This is the cell that carried the retired
 *     behaviour, so it is the one whose rows are the reverse-verification
 *     witness: before the gate, `$contains: '2026'` answered every row.
 *   - **live postgres / live mysql** — run when provisioned, reported as a
 *     named SKIP otherwise (never a silent pass), exactly like the sibling
 *     matrices. ⚠️ MySQL was NOT MEASURED when this landed: no server was
 *     provisionable, so its cell rests on the compiled-shape block below —
 *     which is a shape reading, never a pass and never a fail for execution.
 *
 * @see NON_TEXT_STORED_VALUE_TYPES — the spec set the ruling extended.
 * @see SqlDriver.isNonTextColumn — the predicate the registries answer.
 * @see https://github.com/objectstack-ai/objectstack/issues/15683 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/14079 (the numeric/boolean row it extends)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { NON_TEXT_STORED_VALUE_TYPES } from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import {
  DIALECT_CELLS,
  declareUnprovisionedCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/** Issue-prefixed: the live cells share one database with every other suite here. */
const TEMPORAL_OBJECT = 'os15683_temporal_text';

/** Diagnostics-only; it never changes which rows a read touches. */
const BYPASS: DriverOptions = { bypassTenantAudit: true };

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * The fixture. Every value is chosen so a COERCING backend answers a VISIBLY
 * non-empty set: each `on_day` and `at_instant` renders with `2026` in it and
 * each `at_clock` with a `:`, so a gate that silently fails to fire returns
 * rows rather than the same empty list a working gate returns.
 */
const TEMPORAL_ROWS = [
  { id: '1', label: 'alpha 2026', on_day: '2026-01-05', at_instant: '2026-01-05T10:20:30.000Z', at_clock: '10:20:30' },
  { id: '2', label: 'beta 2027', on_day: '2027-06-30', at_instant: '2027-06-30T23:59:00.000Z', at_clock: '23:59:00' },
  { id: '3', label: 'gamma 2026', on_day: '2026-12-31', at_instant: '2026-12-31T00:00:00.000Z', at_clock: '00:00:00' },
] as const;

/** The three temporal columns, with a comparand a coercing backend WOULD match. */
const TEMPORAL_PROBES: ReadonlyArray<{ field: string; declared: string; hit: string }> = [
  { field: 'on_day', declared: 'date', hit: '2026' },
  { field: 'at_instant', declared: 'datetime', hit: '2026' },
  { field: 'at_clock', declared: 'time', hit: ':' },
];

const POSITIVE_OPERATORS = ['$contains', '$startsWith', '$endsWith', '$icontains', '$like', '$ilike'] as const;

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, '[#15683] the temporal text-operator gate');
    continue;
  }
  declareTemporalGateSweep(cell);
}

function declareTemporalGateSweep(cell: DialectCell): void {
  describe(`[#15683] SqlDriver — a text operator over a temporal column (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: Knex;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = driver.getKnex();
      await knexInstance.schema.dropTableIfExists(TEMPORAL_OBJECT);
      await driver.initObjects([{
        name: TEMPORAL_OBJECT,
        fields: {
          label: { type: 'string' },
          on_day: { type: 'date' },
          at_instant: { type: 'datetime' },
          at_clock: { type: 'time' },
        },
      }]);
      for (const row of TEMPORAL_ROWS) await driver.create(TEMPORAL_OBJECT, { ...row }, BYPASS);
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(TEMPORAL_OBJECT).catch(() => {});
      await driver?.disconnect?.();
    });

    const ids = async (where: FilterCondition): Promise<string[]> => {
      const rows = await driver.find(TEMPORAL_OBJECT, { where }, BYPASS);
      return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
    };

    /**
     * The fixture control. If the rows did not land, every positive case below
     * would answer `[]` for a reason that has nothing to do with the gate —
     * the classic vacuous green.
     */
    it('stored all three rows — the premise of every empty answer below', async () => {
      const rows = await driver.find(TEMPORAL_OBJECT, {}, BYPASS);
      expect(rows.map((r) => String(r.id)).sort()).toEqual(['1', '2', '3']);
    });

    /**
     * The retired behaviour, named at the place it lived. On SQLite the stored
     * value of a temporal column IS canonical ISO text (ADR-0053), which is why
     * `GLOB '*2026*'` used to match — the fact the ruling calls "not a
     * contract". Asserting it here keeps the pin honest: the gate is what makes
     * the answer empty, not an absence of matchable text.
     */
    if (cell.id === 'sqlite') {
      it('SQLite really does store ISO TEXT — so the empty answers below are the GATE, not a missing substring', async () => {
        const probe = await knexInstance.raw(
          `select typeof(on_day) as t_day, typeof(at_instant) as t_instant, on_day as raw_day from ${TEMPORAL_OBJECT} where id = '1'`,
        ) as Array<Record<string, unknown>>;
        const row = (Array.isArray(probe) ? probe[0] : (probe as { rows?: Array<Record<string, unknown>> }).rows?.[0])!;
        expect(row.t_day).toBe('text');
        expect(row.t_instant).toBe('text');
        expect(String(row.raw_day)).toContain('2026');
      });
    }

    for (const probe of TEMPORAL_PROBES) {
      it(`every positive text operator over ${probe.field} (${probe.declared}) answers NO row`, async () => {
        for (const op of POSITIVE_OPERATORS) {
          expect(await ids({ [probe.field]: { [op]: probe.hit } } as FilterCondition), `${op} over ${probe.field}`)
            .toEqual([]);
        }
      });

      it(`$notContains over ${probe.field} (${probe.declared}) answers EVERY row — complementarity holds`, async () => {
        expect(await ids({ [probe.field]: { $notContains: probe.hit } } as FilterCondition))
          .toEqual(['1', '2', '3']);
      });
    }

    it('the text column beside them is UNTOUCHED — the gate is per-column, not per-table', async () => {
      expect(await ids({ label: { $contains: '2026' } })).toEqual(['1', '3']);
      expect(await ids({ label: { $notContains: '2026' } })).toEqual(['2']);
    });

    /**
     * The prescription the ruling names in place of the retired match. If this
     * went red the ruling would have taken a capability away without leaving
     * one, which is a different (and worse) change than the one that was made.
     */
    it('the RANGE operators still answer "records in 2026" — what the retired match is replaced by', async () => {
      expect(await ids({ on_day: { $gte: '2026-01-01', $lt: '2027-01-01' } })).toEqual(['1', '3']);
      expect(await ids({ at_instant: { $gte: '2026-01-01T00:00:00.000Z', $lt: '2027-01-01T00:00:00.000Z' } }))
        .toEqual(['1', '3']);
    });
  });
}

/**
 * The construct each dialect compiles to, decided WITHOUT a server — the only
 * layer that can say anything at all about the MySQL cell, and deliberately
 * about the SHAPE (which constant, whether any pattern operator survives)
 * rather than about exact whitespace.
 */
describe('[#15683] the per-dialect construct, compiled', () => {
  class CompilerProbeDriver extends SqlDriver {
    compileWhere(where: FilterCondition): string {
      const builder: Knex.QueryBuilder = this.getKnex()(TEMPORAL_OBJECT);
      this.applyFilters(builder, where);
      return builder.toString();
    }

    /**
     * `registerExternalObject` is the same registration `initObjects` performs
     * after its DDL, so the pg and mysql probes know the declared types the way
     * a live driver would — with no server to send anything to.
     */
    declareTemporal(): this {
      this.registerExternalObject({
        name: TEMPORAL_OBJECT,
        fields: {
          label: { type: 'string' },
          on_day: { type: 'date' },
          at_instant: { type: 'datetime' },
          at_clock: { type: 'time' },
        },
      });
      return this;
    }
  }

  const DIALECTS: Array<[string, SqlDriverConfig]> = [
    ['sqlite', { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }],
    ['postgres', { client: 'pg', connection: { host: '127.0.0.1' } }],
    ['mysql', { client: 'mysql2', connection: { host: '127.0.0.1' } }],
  ];
  const typed = (config: SqlDriverConfig) => new CompilerProbeDriver(config).declareTemporal();

  for (const [label, config] of DIALECTS) {
    it(`${label}: every temporal column compiles the positive operators to FALSE and $notContains to TRUE`, () => {
      const d = typed(config);
      for (const probe of TEMPORAL_PROBES) {
        for (const op of POSITIVE_OPERATORS) {
          const sql = d.compileWhere({ [probe.field]: { [op]: probe.hit } } as FilterCondition);
          expect(sql, `${op} over ${probe.field}`).toMatch(/where 1 = 0/);
          // No pattern operator, and no temporal presentation wrapper either:
          // the gate runs BEFORE both emitters, so nothing is built over the
          // column at all.
          expect(sql, `${op} over ${probe.field}`).not.toMatch(/LIKE|GLOB|lower\(|translate\(|CAST\(|strftime|datetime\(/);
        }
        const not = d.compileWhere({ [probe.field]: { $notContains: probe.hit } } as FilterCondition);
        expect(not, `$notContains over ${probe.field}`).toMatch(/where 1 = 1/);
        expect(not, `$notContains over ${probe.field}`).not.toMatch(/LIKE|GLOB|IS NULL/);
      }
      // …and the text column beside them still compiles a real pattern match.
      expect(d.compileWhere({ label: { $contains: '2026' } })).toMatch(/LIKE|GLOB/);
    });
  }

  it('composes with the NULL-safe $not rewrite: NOT over the constant is total', () => {
    const d = typed(DIALECTS[1][1]);
    const notContains = d.compileWhere({ $not: { on_day: { $contains: '2026' } } });
    expect(notContains).toMatch(/not \(.*is not null.*1 = 0/);
    expect(notContains).not.toMatch(/LIKE/);
    const notNotContains = d.compileWhere({ $not: { on_day: { $notContains: '2026' } } });
    expect(notNotContains).toMatch(/not \(.*is null.*1 = 1/);
  });

  it('a comparand the contract refuses is STILL refused ahead of the constant', () => {
    const d = typed(DIALECTS[0][1]);
    for (const where of [
      { on_day: { $icontains: '' } },
      { on_day: { $icontains: 42 } },
      { at_instant: { $like: 'a\\' } },
      { at_clock: { $contains: { $field: 'label' } } },
    ]) {
      const err = (() => { try { d.compileWhere(where as never); return null; } catch (e) { return e as WireBearingError; } })();
      expect(err, JSON.stringify(where)).toBeInstanceOf(Error);
      expect(err!.code, JSON.stringify(where)).toBe('INVALID_FILTER');
      expect(err!.status, JSON.stringify(where)).toBe(400);
    }
  });

  it('a table this driver was never told about keeps the pattern match — the gate fires only on a KNOWN class', () => {
    const d = new CompilerProbeDriver(DIALECTS[1][1]);
    expect(d.compileWhere({ on_day: { $contains: '2026' } })).toMatch(/LIKE/);
  });

  it('the NON-temporal comparison operators over the same columns are untouched', () => {
    const d = typed(DIALECTS[0][1]);
    for (const op of ['$eq', '$gte', '$lt', '$between'] as const) {
      const value = op === '$between' ? ['2026-01-01', '2026-12-31'] : '2026-01-01';
      const sql = d.compileWhere({ on_day: { [op]: value } } as FilterCondition);
      expect(sql, op).not.toMatch(/1 = 0|1 = 1/);
    }
  });
});

/**
 * The spec set this driver's registries mirror. Read here rather than assumed:
 * if the ruling were ever reverted in `packages/spec` alone, the rows above
 * would keep passing against a driver that had quietly become the only face
 * still gating temporal columns.
 */
describe('[#15683] the declared-type set the registries mirror', () => {
  it('carries the three temporal classes beside the numeric and boolean ones', () => {
    for (const t of ['date', 'datetime', 'time', 'number', 'boolean']) {
      expect(NON_TEXT_STORED_VALUE_TYPES.has(t), t).toBe(true);
    }
    for (const t of ['text', 'select', 'lookup']) {
      expect(NON_TEXT_STORED_VALUE_TYPES.has(t), t).toBe(false);
    }
  });
});
