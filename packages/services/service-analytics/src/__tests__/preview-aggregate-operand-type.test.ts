// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16203 — the draft-preview evaluator assumed every measure is numeric and
 * every dimension is a string.
 *
 * `evaluateAnalyticsQueryOverRows` (`preview-evaluator.ts`) produces its result
 * BEFORE any descriptor pass runs, so neither symptom is reachable from an
 * enrichment step:
 *
 *   (a) `aggregate()` coerced every operand with `Number()` and dropped the
 *       non-finite ones, so `min`/`max` over a NON-NUMERIC field answered `0`
 *       — a different, wrong VALUE for the same query, with no refusal and no
 *       warning;
 *   (b) the `fields` it minted typed EVERY dimension column `'string'`, so a
 *       time dimension was `'string'` on preview and `'time'` on live.
 *
 * ## The instrument
 *
 * One dataset, one row set, two `AnalyticsService` instances differing in
 * exactly one config key — `draftRowsResolver` — so a difference between the
 * two responses is a difference the preview evaluator caused. The LIVE half is
 * not a model of an engine: it is `NativeSQLStrategy`'s generated SQL executed
 * on a real SQLite (sql.js) whose table is seeded from {@link ROWS}, the same
 * rows the resolver hands the preview. `date` is stored as TEXT, which is this
 * platform's canonical storage form for it (ADR-0053 D-B).
 *
 * ## Per aggregate — the whole closed vocabulary, no member left unconsidered
 *
 * `AggregationFunction` (`spec/data/query.zod.ts`) is CLOSED, so this table has
 * a finite answer, and the sibling ruling for the DESCRIPTOR half of the same
 * question (`measure-result-type.ts`, #15768/#16101) answers it the same way:
 *
 * | aggregate        | preview answers                                        |
 * |:-----------------|:-------------------------------------------------------|
 * | `count`          | a row count — numeric, unchanged                        |
 * | `count_distinct` | a cardinality — numeric; the arm was UNREACHABLE (the   |
 * |                  | switch spelled it `countDistinct`, a word no producer   |
 * |                  | mints) so it fell to the numeric `default` and answered |
 * |                  | a SUM / a row count instead                             |
 * | `sum`            | numeric, unchanged                                      |
 * | `avg`            | numeric, unchanged                                      |
 * | `min` / `max`    | the winning operand IN ITS OWN TYPE — the fix           |
 *
 * ⛔ `sum`/`avg` over a TEMPORAL operand is deliberately left exactly as it is:
 * there is no defined answer (the two faces below do not agree on one either),
 * and #16099 is the open card for REFUSING an incoherent aggregate/field-type
 * pair. Inventing a semantic here would pre-empt that ruling; the case below
 * pins today's behaviour so the ruling lands visibly.
 *
 * ⛔ Derived measures are not touched: `computeDerived` (`dataset-executor.ts`)
 * coerces every operand with `Number()` and answers `null` when one is not
 * finite. This change does not reach that function — it changes what the
 * function READS, and the case below measures which way that goes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';

// ── one fixture, two paths ──────────────────────────────────────────────────

/**
 * `payer` is the nullable, duplicate-bearing column (the `AGGREGATION_ROWS`
 * shape): `travel` holds two distinct payers over three rows, `meals` one over
 * two, with a null — so `count(*)`, `count_distinct(payer)` and a per-group
 * answer are three different numbers and a face that collapsed one into
 * another cannot pass by coincidence.
 */
const ROWS: Record<string, unknown>[] = [
  { id: '1', category: 'travel', payer: 'ann', amount: 1200, spent_on: '2026-05-03' },
  { id: '2', category: 'travel', payer: 'ann', amount: 800, spent_on: '2026-05-12' },
  { id: '3', category: 'travel', payer: 'bob', amount: 500, spent_on: '2026-04-21' },
  { id: '4', category: 'meals', payer: 'bob', amount: 60, spent_on: '2026-06-01' },
  { id: '5', category: 'meals', payer: null, amount: 140, spent_on: '2026-06-02' },
];

const DATASET = DatasetSchema.parse({
  name: 'expense_ds',
  label: 'Expense',
  object: 'expense',
  dimensions: [
    { name: 'category', field: 'category', type: 'string', label: 'Category' },
    // No `dateGranularity`: the raw column groups on both faces, so the only
    // thing that can differ about this column is how it is DESCRIBED.
    { name: 'spent_on', field: 'spent_on', type: 'date', label: 'Spent On' },
  ],
  measures: [
    { name: 'expense_count', aggregate: 'count' },
    { name: 'distinct_payers', aggregate: 'count_distinct', field: 'payer' },
    { name: 'total_amount', aggregate: 'sum', field: 'amount' },
    { name: 'avg_amount', aggregate: 'avg', field: 'amount' },
    { name: 'min_amount', aggregate: 'min', field: 'amount' },
    { name: 'max_amount', aggregate: 'max', field: 'amount' },
    // ⭐ the card's measured pair: `'2026-05-12'` live, `0` on preview.
    { name: 'latest_spend', aggregate: 'max', field: 'spent_on' },
    { name: 'earliest_spend', aggregate: 'min', field: 'spent_on' },
    // the TEXT population (#16098's population, on the preview path).
    { name: 'first_payer', aggregate: 'min', field: 'payer' },
    { name: 'last_payer', aggregate: 'max', field: 'payer' },
    // ⛔ #16099 owns this pair — pinned as-is, not fixed.
    { name: 'sum_spent_on', aggregate: 'sum', field: 'spent_on' },
    { name: 'avg_spent_on', aggregate: 'avg', field: 'spent_on' },
    // derived: one over numeric operands, one over a temporal `max`.
    { name: 'amount_per_expense', derived: { op: 'ratio', of: ['total_amount', 'expense_count'] } },
    { name: 'latest_per_expense', derived: { op: 'ratio', of: ['latest_spend', 'expense_count'] } },
  ],
});

const MEASURES = [
  'expense_count', 'distinct_payers', 'total_amount', 'avg_amount', 'min_amount', 'max_amount',
  'latest_spend', 'earliest_spend', 'first_payer', 'last_payer',
  'sum_spent_on', 'avg_spent_on', 'amount_per_expense', 'latest_per_expense',
];

let db: any;

const runSql = (sql: string, params: unknown[]): Record<string, unknown>[] => {
  const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
  stmt.bind(params as any[]);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
};

async function locateWasm(): Promise<((file: string) => string) | undefined> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('sql.js/package.json');
    const { dirname, join } = await import('node:path');
    return (file: string) => join(dirname(pkgJsonPath), 'dist', file);
  } catch {
    return undefined;
  }
}

/**
 * The two services differ in ONE key. Everything else — the dataset, the rows,
 * the capabilities, the SQL engine behind `executeRawSql` — is shared.
 */
function svc(preview: boolean) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_object: string, sql: string, params: unknown[]) => runSql(sql, params),
    ...(preview ? { draftRowsResolver: async () => ROWS } : {}),
  });
}

type Grid = { byCategory: Record<string, Record<string, unknown>>; fields: Record<string, { name: string; type: string }> };

async function grid(preview: boolean, dimensions: string[] = ['category']): Promise<Grid> {
  const result = await svc(preview).queryDataset(
    DATASET,
    { dimensions, measures: MEASURES },
    undefined,
    preview ? { previewDrafts: true } : undefined,
  );
  return {
    byCategory: Object.fromEntries(result.rows.map((r) => [String(r[dimensions[0]]), r])),
    fields: Object.fromEntries(result.fields.map((f) => [f.name, f as { name: string; type: string }])),
  };
}

beforeAll(async () => {
  const mod: any = await import('sql.js');
  const initSqlJs = mod.default ?? mod;
  const locateFile = await locateWasm();
  const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
  db = new SQL.Database();
  db.run(`CREATE TABLE "expense" ("id" TEXT PRIMARY KEY, "category" TEXT, "payer" TEXT, "amount" REAL, "spent_on" TEXT);`);
  const insert = db.prepare(`INSERT INTO "expense" ("id","category","payer","amount","spent_on") VALUES (?,?,?,?,?)`);
  for (const r of ROWS) insert.run([r.id, r.category, r.payer, r.amount, r.spent_on] as any[]);
  insert.free();
});

afterAll(() => db?.close());

describe('#16203 (a) — a `min`/`max` over a non-numeric field is a VALUE of that field\'s type', () => {
  it('the temporal pair the card measured: the same answer on both paths', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    // Pre-fix: preview answered 0 for both of these on both groups.
    expect(preview.byCategory.travel.latest_spend).toBe('2026-05-12');
    expect(preview.byCategory.travel.earliest_spend).toBe('2026-04-21');
    expect(preview.byCategory.meals.latest_spend).toBe('2026-06-02');
    // …and the live path, executed on a real SQLite over the same rows, agrees.
    expect(preview.byCategory.travel.latest_spend).toBe(live.byCategory.travel.latest_spend);
    expect(preview.byCategory.travel.earliest_spend).toBe(live.byCategory.travel.earliest_spend);
    expect(preview.byCategory.meals.latest_spend).toBe(live.byCategory.meals.latest_spend);
  });

  it('the TEXT population too — the same defect over a `text`/`select`/`lookup` operand', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    expect(preview.byCategory.travel.first_payer).toBe('ann');
    expect(preview.byCategory.travel.last_payer).toBe('bob');
    expect(preview.byCategory.travel.first_payer).toBe(live.byCategory.travel.first_payer);
    expect(preview.byCategory.travel.last_payer).toBe(live.byCategory.travel.last_payer);
  });

  it('a NUMERIC operand is untouched — still a number, still the same number', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    expect(preview.byCategory.travel.min_amount).toBe(500);
    expect(preview.byCategory.travel.max_amount).toBe(1200);
    expect(typeof preview.byCategory.travel.min_amount).toBe('number');
    expect(preview.byCategory.travel.min_amount).toBe(live.byCategory.travel.min_amount);
    expect(preview.byCategory.travel.max_amount).toBe(live.byCategory.travel.max_amount);
  });

  it('a group whose operand is null throughout answers null, never 0 (`emptyGroupValueFor`)', () => {
    const CUBE = {
      name: 'e', sql: 'expense',
      dimensions: { category: { name: 'category', type: 'string', sql: 'category' } },
      measures: { latest: { name: 'latest', type: 'max', sql: 'spent_on' } },
    } as unknown as Cube;
    const r = evaluateAnalyticsQueryOverRows(
      { measures: ['latest'], dimensions: ['category'] },
      CUBE,
      [{ category: 'x', spent_on: null }, { category: 'x' }],
    );
    // `aggregation-policy.emptyGroupValueFor` rules `min`/`max` over nothing
    // NULL — "there is nothing to minimise" — never the `0` that reads as a
    // real measurement.
    expect(r.rows).toEqual([{ category: 'x', latest: null }]);
  });

  it('a `Date` operand (the mongo storage form) comes back as the Date, ordered as an instant', () => {
    const CUBE = {
      name: 'e', sql: 'expense',
      dimensions: {},
      measures: { latest: { name: 'latest', type: 'max', sql: 'at' } },
    } as unknown as Cube;
    const early = new Date('2026-05-03T00:00:00.000Z');
    const late = new Date('2026-07-27T00:00:00.000Z');
    const r = evaluateAnalyticsQueryOverRows({ measures: ['latest'], dimensions: [] }, CUBE, [
      { at: early }, { at: late },
    ]);
    // `String(new Date())` sorts AFTER every '2026-…' string, which is why the
    // ordering goes through `compare`'s instant arm rather than String().
    expect(r.rows[0].latest).toBe(late);
  });
});

describe('#16203 — the rest of the closed vocabulary, answered rather than assumed', () => {
  it('`count` — a row count, numeric, both paths', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    expect(preview.byCategory.travel.expense_count).toBe(3);
    expect(preview.byCategory.meals.expense_count).toBe(2);
    expect(preview.byCategory.travel.expense_count).toBe(live.byCategory.travel.expense_count);
  });

  it('`count_distinct` — a cardinality, nulls excluded; the arm used to be unreachable', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    // Pre-fix the switch spelled this `countDistinct`, which no producer mints
    // (`dataset-compiler` copies the spec's `count_distinct` through), so the
    // measure fell to the numeric `default` and answered a SUM of the payer
    // strings' coercions — i.e. the row count — instead of the cardinality.
    expect(preview.byCategory.travel.distinct_payers).toBe(2);
    expect(preview.byCategory.meals.distinct_payers).toBe(1);
    expect(preview.byCategory.travel.distinct_payers).toBe(live.byCategory.travel.distinct_payers);
    expect(preview.byCategory.meals.distinct_payers).toBe(live.byCategory.meals.distinct_payers);
  });

  it('`sum` / `avg` over a NUMERIC operand — untouched', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    expect(preview.byCategory.travel.total_amount).toBe(2500);
    expect(preview.byCategory.travel.avg_amount).toBeCloseTo(2500 / 3, 10);
    expect(preview.byCategory.travel.total_amount).toBe(live.byCategory.travel.total_amount);
    expect(preview.byCategory.travel.avg_amount).toBe(live.byCategory.travel.avg_amount);
  });

  it('⛔ `sum` / `avg` over a TEMPORAL operand is left EXACTLY as it was — #16099 owns it', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    // What the code does today, stated rather than defended: the preview drops
    // every non-finite operand, so the sum of a date column is the identity `0`
    // and its average is `0` as well.
    expect(preview.byCategory.travel.sum_spent_on).toBe(0);
    expect(preview.byCategory.travel.avg_spent_on).toBe(0);
    // The live face answers a DIFFERENT number (SQLite applies numeric affinity
    // to the TEXT column and sums the leading years). Neither number is a date,
    // and no layer refuses the pair — which is #16099, not this card. The
    // inequality is asserted rather than the dialect's exact figure, so this
    // stays a statement about the MISSING REFUSAL rather than a pin on SQLite.
    expect(live.byCategory.travel.sum_spent_on).not.toBe(preview.byCategory.travel.sum_spent_on);
  });

  it('derived measures — this change does not reach `computeDerived`, it changes what it reads', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    // A derived ratio over numeric operands is unaffected on either path.
    expect(preview.byCategory.travel.amount_per_expense).toBeCloseTo(2500 / 3, 10);
    expect(preview.byCategory.travel.amount_per_expense).toBe(live.byCategory.travel.amount_per_expense);
    // A derived ratio whose operand is a temporal `max` is `null` — `num()` in
    // `computeDerived` answers null for a non-finite operand, and a missing
    // operand makes the whole ratio null. Pre-fix the preview handed it the
    // spurious `0` and it computed `0` there while the live path said null.
    expect(preview.byCategory.travel.latest_per_expense).toBeNull();
    expect(preview.byCategory.travel.latest_per_expense).toBe(live.byCategory.travel.latest_per_expense);
  });
});

describe('#16203 (b) — a dimension column is described by its OWN type, not always `string`', () => {
  it('a time dimension is `time` on preview, the same word the live producer mints', async () => {
    const live = await grid(false, ['spent_on']);
    const preview = await grid(true, ['spent_on']);
    expect(preview.fields.spent_on.type).toBe('time');
    expect(preview.fields.spent_on.type).toBe(live.fields.spent_on.type);
  });

  it('a string dimension keeps `string`, and a measure column keeps the `number` its producer mints', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    expect(preview.fields.category.type).toBe('string');
    expect(preview.fields.category.type).toBe(live.fields.category.type);
    // ⛔ Deliberately NOT corrected here: a MEASURE column's type is minted
    // `number` by every producer in the platform and corrected at the
    // descriptor pass by `measureResultType` (#15768/#16101). Putting a second
    // copy of that rule in the evaluator would be two implementations of one
    // rule, free to drift — and the live producer beside it does the same.
    expect(preview.fields.latest_spend.type).toBe('number');
    expect(preview.fields.latest_spend.type).toBe(live.fields.latest_spend.type);
  });
});
