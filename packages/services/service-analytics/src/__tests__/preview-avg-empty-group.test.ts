// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16219 — the draft-preview evaluator answered `0` for an `avg` over a group
 * with no numeric values, where the live path answers `null`.
 *
 * `emptyGroupValueFor` (`packages/spec/src/data/aggregation-policy.ts`) is the
 * platform's own ruling on the question and reads as if written for this line:
 *
 * > Counting no rows is `0` and summing them is `0`: those are measured facts,
 * > not missing data. Averaging, minimising or maximising no rows is undefined
 * > — there is nothing to average — and must stay null rather than be flattened
 * > to a zero that reads as a real measurement.
 *
 * The harm is not "a wrong number" in the ordinary sense: `0` is a PLAUSIBLE
 * average, indistinguishable from one somebody measured, so a drafted chart
 * showed a reading nobody took and the reader had nothing to tell it apart by.
 *
 * ## ⭐ The card attributed this to `: 0`. Measured, that is not where it comes from
 *
 * The card and the dispatch both name the fallback as the whole defect:
 *
 *   ```ts
 *   case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
 *   ```
 *
 * But the operand list one line above is
 *
 *   ```ts
 *   const nums = rows.map((r) => Number(r[field])).filter((n) => Number.isFinite(n));
 *   ```
 *
 * and `Number(null)` is `0`, which `Number.isFinite` accepts. So for the card's
 * measured cell — `amount` NULL in every `meals` row, the key present — `nums`
 * is `[0, 0]`, `nums.length` is 2, and the ternary takes its TRUE branch: the
 * `0` the preview reported was an average OF the nulls, divided by a count that
 * included them. The `: 0` fallback never ran on that cell at all.
 *
 * ⇒ the defect has two limbs, and closing either one alone leaves the card's
 * measured divergence open:
 *
 *   1. **NULL operands are not operands.** Every SQL face aggregates over
 *      non-null values — `AVG(col)` is defined that way in every dialect — and
 *      this file already agrees with itself twice over: `extremumOf` skips
 *      `v == null`, and #16218's `count` arm counts `r[field] != null`.
 *   2. **With no operands left the answer is the platform's, not this file's.**
 *      `emptyGroupValueFor` returns the identity `0` where counting/summing
 *      nothing is a measured fact and `undefined` where there is nothing to
 *      answer; `undefined` is spelled `null` on this wire.
 *
 * Limb 1 is what makes {@link ROWS}`.travel` a live control rather than a
 * decoration: its average diverged too, `(10 + 20 + 0) / 3 = 10` against the
 * live `AVG` of 15, on a group that is not empty at all.
 *
 * ## The instrument — the differential #16203 built and #16218 reused
 *
 * One dataset, one row set, two `AnalyticsService` instances differing in
 * exactly one config key (`draftRowsResolver`), so a difference between the two
 * responses is a difference the preview evaluator caused. The LIVE half is not
 * a model of an engine: it is `NativeSQLStrategy`'s generated SQL executed on a
 * real SQLite (sql.js) whose table is seeded from {@link ROWS} — the same rows
 * the resolver hands the preview. ⭐ A preview-only assertion would pass while
 * the divergence stayed; the differential IS the acceptance shape.
 *
 * ## The controls, each for its own reason
 *
 * | control                          | must answer | whose ruling                   |
 * |:---------------------------------|:------------|:-------------------------------|
 * | `sum` over the all-null group    | `0`         | the identity; `fillEmptyGroups` writes it deliberately (#4708) |
 * | `count(field)` over that group   | `0`         | #16218, landed hours before this card |
 * | `min`/`max` over that group      | `null`      | #16203 already moved them off the same idiom |
 * | `avg` over a group WITH values   | the mean    | the arm being edited must keep working |
 *
 * ⛔ A fix that makes every empty group `null` breaks the first two; one that
 * makes none `null` did nothing. The four together are what distinguish reading
 * a policy from flipping a flag.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';

// ── one fixture, two paths ──────────────────────────────────────────────────

/**
 * `amount` is the nullable numeric column.
 *
 * | group    | rows | count(amount) | sum | avg | min | max |
 * |:---------|-----:|--------------:|----:|----:|----:|----:|
 * | `travel` |    3 |             2 |  30 |  15 |  10 |  20 |
 * | `meals`  |    2 |             0 |   0 |null |null |null |
 *
 * `travel`'s six answers are six different numbers, so a face that collapses
 * any aggregate into another cannot pass here by coincidence — and its third
 * row is NULL, which is what makes it discriminate limb 1 (a face that counts
 * nulls as zeros answers 10, not 15).
 *
 * `meals` is the card's measured cell verbatim: `amount` NULL in every row.
 */
const ROWS: Record<string, unknown>[] = [
  { id: '1', category: 'travel', amount: 10 },
  { id: '2', category: 'travel', amount: 20 },
  { id: '3', category: 'travel', amount: null },
  // ⭐ the card's measured cell: LIVE avg null / sum 0, PREVIEW avg 0 / sum 0.
  { id: '4', category: 'meals', amount: null },
  { id: '5', category: 'meals', amount: null },
];

const DATASET = DatasetSchema.parse({
  name: 'expense_ds',
  label: 'Expense',
  object: 'expense',
  dimensions: [
    { name: 'category', field: 'category', type: 'string', label: 'Category' },
  ],
  measures: [
    // ⭐ the card's measure.
    { name: 'avg_amount', aggregate: 'avg', field: 'amount' },
    // control — the ruled IDENTITY. `0` here is correct and must stay.
    { name: 'sum_amount', aggregate: 'sum', field: 'amount' },
    // control — #16218, landed hours before this card, in this same function.
    { name: 'amount_count', aggregate: 'count', field: 'amount' },
    // control — `count` with no field still counts ROWS, nulls included.
    { name: 'row_count', aggregate: 'count' },
    // controls — #16203 already moved these two; they must not move again.
    { name: 'min_amount', aggregate: 'min', field: 'amount' },
    { name: 'max_amount', aggregate: 'max', field: 'amount' },
  ],
});

const MEASURES = [
  'avg_amount', 'sum_amount', 'amount_count', 'row_count', 'min_amount', 'max_amount',
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

type Grid = Record<string, Record<string, unknown>>;

async function grid(preview: boolean): Promise<Grid> {
  const result = await svc(preview).queryDataset(
    DATASET,
    { dimensions: ['category'], measures: MEASURES },
    undefined,
    preview ? { previewDrafts: true } : undefined,
  );
  return Object.fromEntries(result.rows.map((r) => [String(r.category), r]));
}

beforeAll(async () => {
  const mod: any = await import('sql.js');
  const initSqlJs = mod.default ?? mod;
  const locateFile = await locateWasm();
  const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
  db = new SQL.Database();
  db.run(`CREATE TABLE "expense" ("id" TEXT PRIMARY KEY, "category" TEXT, "amount" REAL);`);
  const insert = db.prepare(`INSERT INTO "expense" ("id","category","amount") VALUES (?,?,?)`);
  for (const r of ROWS) insert.run([r.id, r.category, r.amount] as any[]);
  insert.free();
});

afterAll(() => db?.close());

describe('#16219 — `avg` over a group with no numeric values answers null on both faces', () => {
  it("the card's measured cell: `meals` answers null on live and answered 0 on preview", async () => {
    const live = await grid(false);
    const preview = await grid(true);
    // The live half — `AVG("amount")` on a real SQLite — is the standard.
    expect(live.meals.avg_amount).toBeNull();
    // Pre-fix the preview answered 0 here: an average OF the nulls, `Number(null)`
    // being 0, divided by a count that included them.
    expect(preview.meals.avg_amount).toBeNull();
    // ⭐ and the differential itself: the two faces agree on the same rows.
    expect(preview.meals.avg_amount).toBe(live.meals.avg_amount);
  });

  it('every group agrees across the differential, not just the measured one', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    for (const group of ['travel', 'meals']) {
      for (const measure of MEASURES) {
        expect(
          preview[group][measure],
          `preview ${group}.${measure} must equal live`,
        ).toBe(live[group][measure]);
      }
    }
  });

  it('a NULL is not a zero operand: `travel` averages 15, not 10', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    // (10 + 20) / 2, over the two rows that carry a value. Counting the third
    // row's NULL as an operand gives (10 + 20 + 0) / 3 = 10 — which is what the
    // preview answered, on a group that is not empty at all.
    expect(live.travel.avg_amount).toBe(15);
    expect(preview.travel.avg_amount).toBe(15);
    expect(preview.travel.avg_amount).not.toBe(10);
  });
});

describe('#16219 — the controls that must not move', () => {
  it('`sum` over the all-null group still answers the ruled identity 0', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    // `emptyGroupValueFor` rules summing nothing `0` — a measured fact, not
    // missing data — and `fillEmptyGroups` writes it onto the live row
    // deliberately (#4708). A fix that nulled every empty group breaks this.
    expect(live.meals.sum_amount).toBe(0);
    expect(preview.meals.sum_amount).toBe(0);
    expect(preview.meals.sum_amount).not.toBeNull();
    // and it still totals correctly where there ARE values.
    expect(preview.travel.sum_amount).toBe(30);
    expect(preview.travel.sum_amount).toBe(live.travel.sum_amount);
  });

  it('`count` over the all-null group still answers 0 — #16218 landed that hours ago', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    expect(live.meals.amount_count).toBe(0);
    expect(preview.meals.amount_count).toBe(0);
    expect(preview.meals.amount_count).not.toBeNull();
    // the fieldless spelling still counts ROWS, nulls included.
    expect(preview.meals.row_count).toBe(2);
    expect(preview.travel.amount_count).toBe(2);
    expect(preview.travel.row_count).toBe(3);
  });

  it('`min`/`max` still answer null — #16203 already moved them off the same idiom', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    expect(live.meals.min_amount).toBeNull();
    expect(preview.meals.min_amount).toBeNull();
    expect(live.meals.max_amount).toBeNull();
    expect(preview.meals.max_amount).toBeNull();
    // and they still pick the winning operand where there are values.
    expect(preview.travel.min_amount).toBe(10);
    expect(preview.travel.max_amount).toBe(20);
  });

  it("`travel`'s six answers stay six different numbers", async () => {
    const preview = await grid(true);
    const six = [
      preview.travel.avg_amount, preview.travel.sum_amount, preview.travel.amount_count,
      preview.travel.row_count, preview.travel.min_amount, preview.travel.max_amount,
    ];
    // 15 / 30 / 2 / 3 / 10 / 20 — a fix that made any two agree would have
    // replaced one collapse with another.
    expect(six).toEqual([15, 30, 2, 3, 10, 20]);
    expect(new Set(six).size).toBe(6);
  });
});

describe('#16219 — the empty-operand answer is READ from the policy, not restated', () => {
  it('over ZERO rows the single overall group averages null while count/sum stay 0', () => {
    const CUBE = {
      name: 'e', sql: 'expense',
      dimensions: {},
      measures: {
        avg_amount: { name: 'avg_amount', type: 'avg', sql: 'amount' },
        sum_amount: { name: 'sum_amount', type: 'sum', sql: 'amount' },
        rows: { name: 'rows', type: 'count', sql: '*' },
      },
    } as unknown as Cube;
    // This is the branch the card named — reachable only where NO row carries a
    // parseable operand — and it must answer what `emptyGroupValueFor` rules:
    // `undefined` for `avg` (spelled `null` on this wire), `0` for `sum`/`count`.
    const r = evaluateAnalyticsQueryOverRows(
      { measures: ['avg_amount', 'sum_amount', 'rows'], dimensions: [] },
      CUBE,
      [],
    );
    expect(r.rows).toEqual([{ avg_amount: null, sum_amount: 0, rows: 0 }]);
  });

  it('a field ABSENT from every row averages null, exactly like a null-valued one', () => {
    const CUBE = {
      name: 'e', sql: 'expense',
      dimensions: { category: { name: 'category', type: 'string', sql: 'category' } },
      measures: { avg_amount: { name: 'avg_amount', type: 'avg', sql: 'amount' } },
    } as unknown as Cube;
    // `undefined` (key never written) and `null` are one population to `AVG`:
    // neither is a value. Before the fix these two rows answered 0 by different
    // routes — `NaN` filtered out on one, coerced to `0` on the other.
    const r = evaluateAnalyticsQueryOverRows(
      { measures: ['avg_amount'], dimensions: ['category'] },
      CUBE,
      [{ category: 'x' }, { category: 'x', amount: null }],
    );
    expect(r.rows).toEqual([{ category: 'x', avg_amount: null }]);
  });

  it('a single numeric operand still averages to itself', () => {
    const CUBE = {
      name: 'e', sql: 'expense',
      dimensions: { category: { name: 'category', type: 'string', sql: 'category' } },
      measures: { avg_amount: { name: 'avg_amount', type: 'avg', sql: 'amount' } },
    } as unknown as Cube;
    const r = evaluateAnalyticsQueryOverRows(
      { measures: ['avg_amount'], dimensions: ['category'] },
      CUBE,
      [{ category: 'x', amount: 7 }, { category: 'x', amount: null }],
    );
    expect(r.rows).toEqual([{ category: 'x', avg_amount: 7 }]);
  });
});
