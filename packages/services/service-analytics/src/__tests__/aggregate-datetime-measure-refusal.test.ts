// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16737 — an aggregate a `Field.datetime` measure cannot carry is REFUSED at
 * compile time, and `derived` can no longer be handed its output.
 *
 * ## The shape, re-driven here rather than quoted
 *
 * `{ aggregate: 'avg', field: 'submitted_at' }` over a `Field.datetime`
 * compiled to `AVG(submitted_at)` and reached the backend. What came back was
 * decided by the dialect, not by the data — and the SQLite half is the
 * dangerous one, because it SUCCEEDS:
 *
 * ```
 * -- better-sqlite3, and re-driven live in the first suite below via sql.js
 * select typeof(submitted_at), submitted_at from clm_contract limit 1;
 *   text|2026-05-19T00:00:00.000Z          -- ONE canonical storage form (#3912)
 * select avg(submitted_at) from clm_contract;
 *   2025.5                                 -- text->numeric coercion: the average YEAR
 *
 * -- PostgreSQL 16.13, measured on this card
 * select avg(submitted_at) from t;
 *   ERROR:  function avg(timestamp with time zone) does not exist   -- SQLSTATE 42883
 * ```
 *
 * ⭐ **The danger is the shape, not the magnitude.** `2025.5` fed to
 * `derived: { op: 'difference', of: [avg_a, avg_b] }` renders as `-0.85` on a
 * tile labelled "average cycle time delta" — indistinguishable from a correct
 * answer. Which half is dialect-specific: the SILENT half is SQLite's (a
 * text→numeric coercion no other dialect performs on a temporal column); the
 * MEANINGLESS half is not — there is no backend on which the mean of a set of
 * instants is a duration.
 *
 * ## Why a refusal and not a definition
 *
 * The director ruling (decision batch #59, 2026-09-06, on #16099) settled it as
 * a contract rather than an implementation choice: ONE compatibility table in
 * `@objectstack/spec` (`AGGREGATE_FIELD_TYPE_COMPATIBILITY`, #16353), consumed
 * by two refusal legs. This file pins the COMPILE leg. ⛔ Nothing here restates
 * the table's rows — the pairs asserted below are read from the shipped table,
 * so a row changed upstream changes these expectations with it rather than
 * leaving a second, drifting account of the contract.
 *
 * ## ⚠️ The compile leg lands SCOPED, and #16099 has since moved where the line sits
 *
 * The verdict is the table's; what is scoped is which PAIRS the gate judges.
 * #16737 landed that scope as the TEMPORAL source-field class and said why:
 * executing every row would refuse `min` / `max` over the STRING classes —
 * typed `'string'` by `measureResultType` (#15768) and pinned end to end in
 * `measure-result-type.test.ts` — which this platform answers on purpose, and
 * which are ruled to be AMENDED into the table rather than executed (#17513).
 *
 * **#16099 has since re-cut that scope along the AGGREGATE instead**, and the
 * two boundary cases at the foot of this file are where the move is visible:
 * the gate now judges the DERIVING aggregates (`sum` / `avg`) over EVERY field
 * type, and does not judge `min` / `max` at all. So `sum` × `text` — which this
 * file pinned as compiling, and predicted in writing would go red when the gate
 * widened — is now refused, while `min` × `text` still compiles and keeps its
 * row's ruling intact. The BOOLEAN rows were never a collision in either
 * scope: #16685 was ruled A and #16750 added `boolean` / `toggle` to the
 * `sum` / `avg` / `min` / `max` rows (maintainer ruling #11152 — booleans
 * aggregate as numbers on every backend), so the table ACCEPTS them and nothing
 * refuses them anywhere. The non-temporal deriving population is pinned in
 * `aggregate-nontemporal-measure-refusal.test.ts`; this file keeps the temporal
 * population and the boundary.
 *
 * ## Dissolution verification — direction predicted BEFORE running
 *
 * Deleting the `assertAggregateFieldTypeCompatible` call in
 * `dataset-compiler.ts`'s measure loop must turn the REFUSAL cases red in the
 * ordinary direction: each asserts the ADR-0112 envelope (`code` + `status`),
 * the offending pair in the message, AND that nothing reached the driver
 * (`sqls` empty) — with the gate gone the compile succeeds, SQL IS emitted, so
 * no case can pass vacuously. Every NEGATIVE control (numeric `avg`, the
 * datetime DIMENSION, `min`/`max`/`count` over a datetime, the three
 * cannot-answer tiers) is predicted to stay GREEN in both directions: none of
 * them reaches the refusing branch.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  isAggregateCompatibleWithFieldType,
} from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

// ─────────────────────────────────────────────────────────────────────────────
// The storage reality, re-driven — not quoted from the card (#16737 item 1)
// ─────────────────────────────────────────────────────────────────────────────

/** Point sql.js at the `.wasm` shipped inside its own package (Node-safe). */
async function locateWasm(): Promise<((file: string) => string) | undefined> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('sql.js/package.json');
    const { dirname, join } = await import('node:path');
    const dir = dirname(pkgJsonPath);
    return (file: string) => join(dir, 'dist', file);
  } catch {
    return undefined;
  }
}

describe('#16737 — what SQLite actually does with an aggregate over a datetime column', () => {
  let db: any;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
    db = new SQL.Database();
    // The CANONICAL storage form a `Field.datetime` column holds on SQLite
    // since #3912 — `YYYY-MM-DDTHH:MM:SS.sssZ` text, one form for every write
    // path. `cycle_days` is the numeric control.
    db.run(`CREATE TABLE "clm_contract" ("id" TEXT PRIMARY KEY, "submitted_at" TEXT, "cycle_days" REAL);`);
    const insert = db.prepare(`INSERT INTO "clm_contract" VALUES (?,?,?)`);
    insert.run(['c1', '2026-05-19T00:00:00.000Z', 30]);
    insert.run(['c2', '2025-01-19T00:00:00.000Z', 10]);
    insert.free();
  });

  afterAll(() => db?.close());

  const scalar = (sql: string): unknown => {
    const stmt = db.prepare(sql);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return Object.values(row)[0];
  };

  it('stores the canonical UTC TEXT form — not an INTEGER epoch', () => {
    expect(scalar(`select typeof(submitted_at) from clm_contract limit 1`)).toBe('text');
    expect(scalar(`select submitted_at from clm_contract where id = 'c1'`))
      .toBe('2026-05-19T00:00:00.000Z');
  });

  it('⭐ AVG over that column returns the average YEAR, silently', () => {
    // This is the defect, driven rather than recalled: SQLite coerces the text
    // to a number by reading its leading digits, so the "average submission
    // time" of 2026-05 and 2025-01 is the mean of 2026 and 2025.
    const avg = scalar(`select avg(submitted_at) from clm_contract`);
    expect(typeof avg).toBe('number');
    expect(avg).toBeCloseTo(2025.5, 10);
    // …and the difference of two such numbers is the "clean plausible number"
    // the card names: nothing about `0.5` says it is a difference of years.
    expect(Number(avg) - 2025).toBeCloseTo(0.5, 10);
  });

  it('a genuine numeric column averages correctly — the control that keeps the above meaningful', () => {
    expect(scalar(`select avg(cycle_days) from clm_contract`)).toBe(20);
  });

  it('min/max over the same column return real instants — which is why they stay accepted', () => {
    expect(scalar(`select min(submitted_at) from clm_contract`)).toBe('2025-01-19T00:00:00.000Z');
    expect(scalar(`select max(submitted_at) from clm_contract`)).toBe('2026-05-19T00:00:00.000Z');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The refusal, through the real service
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_TYPES: Record<string, string> = {
  submitted_at: 'datetime',
  approved_at: 'datetime',
  close_date: 'date',
  shift_start: 'time',
  cycle_days: 'number',
  amount: 'currency',
  note: 'text',
};

/**
 * A service wired the way a host wires it: `sourceFieldMeta` answers the
 * declared type, and every emitted statement is recorded so a refusal can be
 * shown to have happened BEFORE the driver — the assertion that stops a case
 * from passing on a query that merely returned nothing.
 */
function makeService(rows: Array<Record<string, unknown>> = [], opts?: { noFieldMeta?: boolean }) {
  const sqls: string[] = [];
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_object: string, sql: string) => {
      sqls.push(sql);
      return rows;
    },
    ...(opts?.noFieldMeta
      ? {}
      : { sourceFieldMeta: (_o: string, f: string) => (FIELD_TYPES[f] ? { type: FIELD_TYPES[f] } : undefined) }),
  });
  return { svc, sqls };
}

/**
 * The ObjectQL profile, for the two DIMENSION controls. `NativeSQLStrategy`
 * declines any query carrying a `granularity`, so a date-BUCKETED dimension is
 * served by the driver-independent path on every driver — which is exactly the
 * shape a "new contracts by month" chart takes, and therefore the shape the
 * dimension controls have to exercise.
 */
function makeBucketService(rows: Array<Record<string, unknown>> = []) {
  const calls: unknown[] = [];
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (...args: unknown[]) => {
      calls.push(args);
      return rows;
    },
    sourceFieldMeta: (_o: string, f: string) => (FIELD_TYPES[f] ? { type: FIELD_TYPES[f] } : undefined),
  } as never);
  return { svc, calls };
}

const dataset = (measures: unknown[], dimensions: unknown[] = [{ name: 'status', field: 'status', type: 'string' }]) =>
  DatasetSchema.parse({
    name: 'contract_cycle',
    label: 'Contract cycle',
    object: 'clm_contract',
    include: [],
    dimensions,
    measures,
  });

/** The ADR-0112 envelope a caller-shaped dataset refusal must carry. */
async function refusalOf(fn: () => Promise<unknown>): Promise<Error & { code?: string; status?: number }> {
  try {
    await fn();
  } catch (e) {
    return e as Error & { code?: string; status?: number };
  }
  throw new Error('expected a refusal, none was thrown');
}

describe('#16737 — the compile leg refuses an aggregate the field type cannot carry', () => {
  it('the contract this executes says so: `avg` × `datetime` is not an accepted pair', () => {
    // Read from the shipped table rather than restated — if the ruling changes
    // this row, this file changes with it instead of contradicting it.
    expect(isAggregateCompatibleWithFieldType('avg', 'datetime')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('sum', 'datetime')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('avg', 'number')).toBe(true);
    expect(isAggregateCompatibleWithFieldType('min', 'datetime')).toBe(true);
    expect(AGGREGATE_FIELD_TYPE_COMPATIBILITY.avg).not.toContain('datetime');
  });

  it('⭐ AVG over a datetime measure is refused — 400 DATASET_INVALID, before any SQL', async () => {
    const { svc, sqls } = makeService();
    const err = await refusalOf(() =>
      svc.queryDataset(
        dataset([{ name: 'avg_submitted', aggregate: 'avg', field: 'submitted_at', label: 'Avg submitted' }]),
        { dimensions: ['status'], measures: ['avg_submitted'] },
      ),
    );
    expect(err.code).toBe('DATASET_INVALID');
    expect(err.status).toBe(400);
    expect(err.message).toContain('avg_submitted');
    expect(err.message).toContain('submitted_at');
    expect(err.message).toContain('datetime');
    // The refusal is a COMPILE-time verdict: the driver was never asked.
    expect(sqls).toEqual([]);
  });

  it('SUM over a datetime measure is refused on the same envelope', async () => {
    const { svc, sqls } = makeService();
    const err = await refusalOf(() =>
      svc.queryDataset(
        dataset([{ name: 'sum_submitted', aggregate: 'sum', field: 'submitted_at' }]),
        { dimensions: ['status'], measures: ['sum_submitted'] },
      ),
    );
    expect(err.code).toBe('DATASET_INVALID');
    expect(err.status).toBe(400);
    expect(sqls).toEqual([]);
  });

  it('a `date` field is refused for the same reason — the table, not a datetime special case', async () => {
    const { svc } = makeService();
    const err = await refusalOf(() =>
      svc.queryDataset(
        dataset([{ name: 'avg_close', aggregate: 'avg', field: 'close_date' }]),
        { dimensions: ['status'], measures: ['avg_close'] },
      ),
    );
    expect(err.code).toBe('DATASET_INVALID');
    expect(err.message).toContain('date');
  });

  it('the message names the accepted set, read off the table rather than hand-written', async () => {
    const { svc } = makeService();
    const err = await refusalOf(() =>
      svc.queryDataset(
        dataset([{ name: 'avg_submitted', aggregate: 'avg', field: 'submitted_at' }]),
        { dimensions: ['status'], measures: ['avg_submitted'] },
      ),
    );
    for (const accepted of AGGREGATE_FIELD_TYPE_COMPATIBILITY.avg) {
      expect(err.message).toContain(accepted);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `derived` compounding — the half that made the nonsense presentable (item 4)
// ─────────────────────────────────────────────────────────────────────────────

describe('#16737 — `derived` can no longer be handed a refused aggregate', () => {
  const derivedDataset = () =>
    dataset([
      { name: 'avg_a', aggregate: 'avg', field: 'submitted_at' },
      { name: 'avg_b', aggregate: 'avg', field: 'approved_at' },
      { name: 'cycle_delta', label: 'Average cycle time delta', derived: { op: 'difference', of: ['avg_a', 'avg_b'] } },
    ]);

  it('⭐ selecting ONLY the derived measure is refused — the operands are pulled in, so hiding them does not help', async () => {
    // This is the filer's exact shape: the two averages are never named by the
    // selection, only the difference is. Before this card that difference came
    // back as `-0.849999999999909` and rendered.
    const { svc, sqls } = makeService();
    const err = await refusalOf(() =>
      svc.queryDataset(derivedDataset(), { dimensions: ['status'], measures: ['cycle_delta'] }),
    );
    expect(err.code).toBe('DATASET_INVALID');
    expect(err.status).toBe(400);
    // Named by the OPERAND that is wrong, not by the derived measure — the
    // author fixes `avg_a`, and `cycle_delta` is not itself malformed.
    expect(err.message).toContain('avg_a');
    expect(err.message).toContain('submitted_at');
    expect(sqls).toEqual([]);
  });

  it('and refused identically when the operands ARE selected', async () => {
    const { svc, sqls } = makeService();
    const err = await refusalOf(() =>
      svc.queryDataset(derivedDataset(), { dimensions: ['status'], measures: ['avg_a', 'avg_b', 'cycle_delta'] }),
    );
    expect(err.code).toBe('DATASET_INVALID');
    expect(sqls).toEqual([]);
  });

  it('a derived measure over NUMERIC operands is untouched — the refusal is about the operand, not about `derived`', async () => {
    const { svc } = makeService([{ status: 'open', fast: 10, slow: 30 }]);
    const result: any = await svc.queryDataset(
      dataset([
        { name: 'fast', aggregate: 'avg', field: 'cycle_days' },
        { name: 'slow', aggregate: 'avg', field: 'amount' },
        { name: 'gap', derived: { op: 'difference', of: ['fast', 'slow'] } },
      ]),
      { dimensions: ['status'], measures: ['gap'] },
    );
    expect(result.rows[0].gap).toBe(-20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Negative controls (item 6) — what this card must NOT have touched
// ─────────────────────────────────────────────────────────────────────────────

describe('#16737 negative controls — aggregation only, and only the incoherent pairs', () => {
  it('AVG over a genuine numeric measure still works end to end', async () => {
    const { svc, sqls } = makeService([{ status: 'open', avg_cycle: 20 }]);
    const result: any = await svc.queryDataset(
      dataset([{ name: 'avg_cycle', aggregate: 'avg', field: 'cycle_days' }]),
      { dimensions: ['status'], measures: ['avg_cycle'] },
    );
    expect(result.rows).toEqual([{ status: 'open', avg_cycle: 20 }]);
    expect(sqls.length).toBe(1);
    expect(sqls[0]).toContain('AVG');
  });

  it('AVG over a `currency` measure still works — the numeric class, not just `number`', async () => {
    const { svc } = makeService([{ status: 'open', avg_amount: 500 }]);
    const result: any = await svc.queryDataset(
      dataset([{ name: 'avg_amount', aggregate: 'avg', field: 'amount' }]),
      { dimensions: ['status'], measures: ['avg_amount'] },
    );
    expect(result.rows[0].avg_amount).toBe(500);
  });

  it('⭐ a `datetime` used as a DIMENSION is untouched — grouping', async () => {
    const { svc, calls } = makeBucketService([{ submitted: '2026-05', row_count: 3 }]);
    const result: any = await svc.queryDataset(
      dataset(
        [{ name: 'row_count', aggregate: 'count' }],
        [{ name: 'submitted', field: 'submitted_at', type: 'date', dateGranularity: 'month' }],
      ),
      { dimensions: ['submitted'], measures: ['row_count'] },
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].row_count).toBe(3);
    // The grouping reached the engine keyed on the DATETIME column with its
    // month bucket — the dimension path, untouched by this card's refusal.
    expect(calls.length).toBe(1);
    expect(JSON.stringify(calls[0])).toContain('submitted_at');
    expect(JSON.stringify(calls[0])).toContain('month');
  });

  it('⭐ a `datetime` used as a DIMENSION is untouched — date-range filtering', async () => {
    const { svc, calls } = makeBucketService([{ submitted: '2026-05', row_count: 3 }]);
    const result: any = await svc.queryDataset(
      dataset(
        [{ name: 'row_count', aggregate: 'count' }],
        [{ name: 'submitted', field: 'submitted_at', type: 'date', dateGranularity: 'month' }],
      ),
      {
        dimensions: ['submitted'],
        measures: ['row_count'],
        timeDimensions: [{ dimension: 'submitted', dateRange: ['2026-01-01', '2026-12-31'] }],
      },
    );
    expect(result.rows.length).toBe(1);
    // The window reached the engine as a resolved bound on the datetime column
    // — the dimension path this card must not have touched.
    expect(JSON.stringify(calls[0])).toContain('2026-01-01');
  });

  it('MIN and MAX over a datetime are still accepted — they return a value of the field’s own type', async () => {
    const { svc, sqls } = makeService([
      { status: 'open', first_submitted: '2025-01-19T00:00:00.000Z', last_submitted: '2026-05-19T00:00:00.000Z' },
    ]);
    const result: any = await svc.queryDataset(
      dataset([
        { name: 'first_submitted', aggregate: 'min', field: 'submitted_at' },
        { name: 'last_submitted', aggregate: 'max', field: 'submitted_at' },
      ]),
      { dimensions: ['status'], measures: ['first_submitted', 'last_submitted'] },
    );
    expect(result.rows[0].first_submitted).toBe('2025-01-19T00:00:00.000Z');
    expect(sqls.length).toBe(1);
  });

  it('COUNT over a datetime is still accepted — counting instants is still counting', async () => {
    const { svc } = makeService([{ status: 'open', submitted_count: 2 }]);
    const result: any = await svc.queryDataset(
      dataset([{ name: 'submitted_count', aggregate: 'count', field: 'submitted_at' }]),
      { dimensions: ['status'], measures: ['submitted_count'] },
    );
    expect(result.rows[0].submitted_count).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "Cannot answer, do not block" — the three tiers this gate stands down on
// ─────────────────────────────────────────────────────────────────────────────

describe('#16737 — the gate stands down rather than guessing', () => {
  it('no `sourceFieldMeta` wired (no data engine) → the pair is not judged', async () => {
    const { svc, sqls } = makeService([{ status: 'open', avg_submitted: 2025.5 }], { noFieldMeta: true });
    const result: any = await svc.queryDataset(
      dataset([{ name: 'avg_submitted', aggregate: 'avg', field: 'submitted_at' }]),
      { dimensions: ['status'], measures: ['avg_submitted'] },
    );
    expect(result.rows.length).toBe(1);
    expect(sqls.length).toBe(1);
  });

  it('a field the hook cannot resolve → not judged', async () => {
    const { svc } = makeService([{ status: 'open', avg_mystery: 1 }]);
    const result: any = await svc.queryDataset(
      dataset([{ name: 'avg_mystery', aggregate: 'avg', field: 'mystery_column' }]),
      { dimensions: ['status'], measures: ['avg_mystery'] },
    );
    expect(result.rows.length).toBe(1);
  });

  it('a RELATIONSHIP-PATH field → not judged, because the hook answers about the base object', async () => {
    // `account.submitted_at` is a column on `account`, not on `clm_contract`.
    // Judging it from `sourceFieldMeta('clm_contract', …)` would be answering
    // about a different column that happens to share a name.
    const { svc } = makeService([{ status: 'open', avg_acct: 1 }]);
    const rel = DatasetSchema.parse({
      name: 'contract_cycle_rel',
      label: 'Contract cycle',
      object: 'clm_contract',
      include: ['account'],
      dimensions: [{ name: 'status', field: 'status', type: 'string' }],
      measures: [{ name: 'avg_acct', aggregate: 'avg', field: 'account.submitted_at' }],
    });
    const result: any = await svc.queryDataset(rel, { dimensions: ['status'], measures: ['avg_acct'] });
    expect(result.rows.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The scope boundary, pinned — so it cannot widen (or narrow) unnoticed
// ─────────────────────────────────────────────────────────────────────────────

describe('#16737 — the compile leg is SCOPED, on purpose; #16099 moved where the line sits', () => {
  it('a `min` over a TEXT field still compiles here — WHATEVER the table says about that pair', async () => {
    // ⚠️ Not an endorsement of the pair, and ⛔ deliberately NOT a pin on the
    // table's verdict for it. `min` × `text` is the row ruled C — the table is
    // to be AMENDED to accept it, tracked as **#17513** — so asserting today's
    // `false` here would make this file go red when that ruling lands, and
    // would make a test of this card the thing standing in the way of a
    // decision this card does not own. What this case owns is one fact, true on
    // either side of that amendment: a `min` / `max` measure is not judged by
    // this gate, so the measure compiles and reaches the driver. #16099 widened
    // the gate to every field type, but only for the DERIVING aggregates, and
    // `min` / `max` stayed outside it precisely so this row keeps its ruling.
    const { svc, sqls } = makeService([{ status: 'open', first_note: 'Archive the backlog' }]);
    const result: any = await svc.queryDataset(
      dataset([{ name: 'first_note', aggregate: 'min', field: 'note' }]),
      { dimensions: ['status'], measures: ['first_note'] },
    );
    expect(result.rows[0].first_note).toBe('Archive the backlog');
    // Not vacuous: the gate refuses BEFORE any SQL, so a widened gate would
    // leave `sqls` empty and this assertion is what would catch it.
    expect(sqls.length).toBe(1);
  });

  it('⭐ a `sum` over a TEXT field is now REFUSED — the boundary #16099 moved, replacing this pin', async () => {
    // ⚠️ This case asserted the OPPOSITE until #16099, and the branch it pinned
    // is the one that card removed: it read "`sum` × `text` stays a pair the
    // TABLE refuses and this GATE does not act on", and predicted in writing
    // that "if the gate ever widened past the temporal class, this case goes
    // red". It did, and it did — driven, not assumed. So the pin is replaced
    // rather than deleted or relaxed: the same pair, through the same door,
    // asserting the answer the platform now gives. The fuller population lives
    // in `aggregate-nontemporal-measure-refusal.test.ts`; what this case keeps
    // owning is the BOUNDARY — this is the row that moved, beside the `min`
    // row above that did not.
    expect(isAggregateCompatibleWithFieldType('sum', 'text')).toBe(false);
    const { svc, sqls } = makeService([{ status: 'open', note_sum: 0 }]);
    const err = await refusalOf(() =>
      svc.queryDataset(
        dataset([{ name: 'note_sum', aggregate: 'sum', field: 'note' }]),
        { dimensions: ['status'], measures: ['note_sum'] },
      ),
    );
    expect(err.code).toBe('DATASET_INVALID');
    expect(err.status).toBe(400);
    expect(err.message).toContain('note_sum');
    expect(err.message).toContain('text');
    // Not vacuous in the other direction either: the refusal happens BEFORE any
    // statement is emitted, which is what makes it a rejected DECLARATION
    // rather than a query that happened to return nothing.
    expect(sqls.length).toBe(0);
  });

  it('every temporal member IS judged — not just the one type the card named', async () => {
    for (const [field, label] of [['submitted_at', 'datetime'], ['close_date', 'date'], ['shift_start', 'time']] as const) {
      const { svc } = makeService();
      const err = await refusalOf(() =>
        svc.queryDataset(
          dataset([{ name: 'avg_temporal', aggregate: 'avg', field }]),
          { dimensions: ['status'], measures: ['avg_temporal'] },
        ),
      );
      expect(err.code, `avg over a ${label} field`).toBe('DATASET_INVALID');
    }
  });
});
