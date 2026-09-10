// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16218 — the draft-preview evaluator's `count` over a FIELD counted ROWS.
 *
 * `aggregate()` (`preview-evaluator.ts`) opened with
 *
 *   ```ts
 *   if (metricType === 'count' || field === '*') return rows.length;
 *   ```
 *
 * so a dataset measure `{ aggregate: 'count', field: 'payer' }` — which
 * `dataset-compiler` lowers to the cube metric `{ type: 'count', sql: 'payer' }`
 * — had its declared FIELD carried in and then never read. The preview answered
 * the row count, nulls included. Every SQL face lowers that same measure to
 * `COUNT("payer")`, which is defined over NON-NULL values:
 *
 *   `native-sql-strategy.ts` AGGREGATE_SQL (#10298)
 *   `'count': (col) => (col === '*' ? 'COUNT(*)' : \`COUNT(${col})\`)`
 *
 * ⇒ a drafted chart showed a different number than the published one, silently,
 * and the number it showed was the one `count(*)` gives — so the author's
 * choice to count a SPECIFIC column had no effect at all on the preview path.
 *
 * ## The instrument — the same differential #16203 built, not a preview-only pin
 *
 * One dataset, one row set, two `AnalyticsService` instances differing in
 * exactly one config key (`draftRowsResolver`), so a difference between the two
 * responses is a difference the preview evaluator caused. The LIVE half is not a
 * model of an engine: it is `NativeSQLStrategy`'s generated SQL executed on a
 * real SQLite (sql.js) whose table is seeded from {@link ROWS} — the same rows
 * the resolver hands the preview. ⭐ A preview-only assertion would have passed
 * while the divergence stayed; the differential IS the acceptance shape.
 *
 * ## The fixture is built so the collapse cannot pass by coincidence
 *
 * The shared conformance fixture (`AGGREGATION_CASES`,
 * `packages/spec/src/data/aggregation-conformance.ts`) is built so that
 * `count(*)`, `count(field)` and `count_distinct(field)` are three DIFFERENT
 * numbers, precisely so a face that collapses one into another cannot pass by
 * coincidence. {@link ROWS} keeps that property per group:
 *
 * | group    | rows | count(*) | count(payer) | count_distinct(payer) |
 * |:---------|-----:|---------:|-------------:|----------------------:|
 * | `travel` |    3 |        3 |            2 |                     1 |
 * | `meals`  |    2 |        2 |            1 |                     1 |
 * | `void`   |    2 |        2 |            0 |                     0 |
 *
 * `travel` is 3 / 2 / 1 — three different numbers on one group. `meals` is the
 * card's measured cell verbatim (LIVE 1, PREVIEW 2). `void` is the arm where NO
 * row carries a value.
 *
 * ⭐ `void` answers **0, not null**, and that is a ruling rather than a
 * preference: `COUNT(col)` over no non-null values is `0`, and the spec agrees
 * from its own side — `emptyGroupValueFor` (`@objectstack/spec/data`) returns
 * `0` for `count` and `count_distinct` because "counting no rows is `0` … those
 * are measured facts, not missing data", reserving `undefined` for the
 * `avg`/`min`/`max` that genuinely have nothing to answer. ⛔ Reaching for a
 * null here would be the wrong answer AND would blur into #16219's territory.
 *
 * ⛔ Both `count(*)` spellings keep the ROW count. The compiler writes
 * `sql: m.field ?? '*'`, so the star IS the "no field declared" spelling —
 * `count` with no `field` and `count` with `field: '*'` are one cube metric and
 * both must still count rows, nulls included.
 *
 * ⛔ NOT touched here: `avg` over a group with no numeric values (#16219, same
 * function, held behind this card), and `sum`/`avg` over a temporal operand
 * (#16099). Neither arm is edited by this change.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';

// ── one fixture, two paths ──────────────────────────────────────────────────

/**
 * `payer` is the nullable, duplicate-bearing column. Per group it makes
 * `count(*)`, `count(payer)` and `count_distinct(payer)` land on the three
 * different numbers tabulated in this file's header.
 */
const ROWS: Record<string, unknown>[] = [
  { id: '1', category: 'travel', payer: 'ann' },
  { id: '2', category: 'travel', payer: 'ann' },
  { id: '3', category: 'travel', payer: null },
  // ⭐ the card's measured cell, verbatim: LIVE 1, PREVIEW 2.
  { id: '4', category: 'meals', payer: 'bob' },
  { id: '5', category: 'meals', payer: null },
  // the group where NO row carries a value — `COUNT(col)` answers 0, not null.
  { id: '6', category: 'void', payer: null },
  { id: '7', category: 'void', payer: null },
];

const DATASET = DatasetSchema.parse({
  name: 'expense_ds',
  label: 'Expense',
  object: 'expense',
  dimensions: [
    { name: 'category', field: 'category', type: 'string', label: 'Category' },
  ],
  measures: [
    // control — `count` with NO field: the compiler writes `sql: '*'`.
    { name: 'row_count', aggregate: 'count' },
    // control — the SAME thing spelled explicitly by the author. `field` is
    // `z.string().optional()` on `DatasetMeasureSchema`, so this is authorable,
    // and `assertDeclared` lets it through (no relationship path in `*`).
    { name: 'star_count', aggregate: 'count', field: '*' },
    // ⭐ the card's measure.
    { name: 'payer_count', aggregate: 'count', field: 'payer' },
    // control — the arm #16203 restored; it must still answer a cardinality.
    { name: 'distinct_payers', aggregate: 'count_distinct', field: 'payer' },
  ],
});

const MEASURES = ['row_count', 'star_count', 'payer_count', 'distinct_payers'];

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
  db.run(`CREATE TABLE "expense" ("id" TEXT PRIMARY KEY, "category" TEXT, "payer" TEXT);`);
  const insert = db.prepare(`INSERT INTO "expense" ("id","category","payer") VALUES (?,?,?)`);
  for (const r of ROWS) insert.run([r.id, r.category, r.payer] as any[]);
  insert.free();
});

afterAll(() => db?.close());

describe('#16218 — `count` over a declared FIELD counts its non-null values, on both faces', () => {
  it("the card's measured cell: `meals` answers 1 on live and answered 2 on preview", async () => {
    const live = await grid(false);
    const preview = await grid(true);
    // The live half — `COUNT("payer")` on a real SQLite — is the standard.
    expect(live.meals.payer_count).toBe(1);
    // Pre-fix the preview answered 2 here: the row count, nulls included.
    expect(preview.meals.payer_count).toBe(1);
    // ⭐ and the differential itself: the two faces agree on the same rows.
    expect(preview.meals.payer_count).toBe(live.meals.payer_count);
  });

  it('every group agrees across the differential, not just the measured one', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    for (const group of ['travel', 'meals', 'void']) {
      for (const measure of MEASURES) {
        expect(
          preview[group][measure],
          `preview ${group}.${measure} must equal live`,
        ).toBe(live[group][measure]);
      }
    }
  });

  it('a count stays NUMERIC — counting nullable text is still counting', async () => {
    const preview = await grid(true);
    expect(typeof preview.travel.payer_count).toBe('number');
    expect(typeof preview.void.payer_count).toBe('number');
  });
});

describe('#16218 — the controls that must not move', () => {
  it('count(*), count(field) and count_distinct(field) stay THREE different numbers', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    for (const face of [live, preview]) {
      // `travel`: 3 rows, 2 non-null payers, 1 distinct payer.
      expect(face.travel.row_count).toBe(3);
      expect(face.travel.payer_count).toBe(2);
      expect(face.travel.distinct_payers).toBe(1);
      // Three different numbers on one group — a fix that made any two agree
      // would have replaced one collapse with another.
      const three = [face.travel.row_count, face.travel.payer_count, face.travel.distinct_payers];
      expect(new Set(three).size).toBe(3);
    }
  });

  it('`count` with NO field still answers the ROW count, nulls included', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    expect(preview.travel.row_count).toBe(3);
    expect(preview.meals.row_count).toBe(2);
    expect(preview.void.row_count).toBe(2); // every payer null — still 2 ROWS
    expect(preview.travel.row_count).toBe(live.travel.row_count);
    expect(preview.void.row_count).toBe(live.void.row_count);
  });

  it("`count` with an explicit `field: '*'` is the same thing — still the ROW count", async () => {
    const live = await grid(false);
    const preview = await grid(true);
    // `dataset-compiler` writes `sql: m.field ?? '*'`, so the star IS the
    // "no field declared" spelling; the two measures are one cube metric.
    expect(preview.void.star_count).toBe(2);
    expect(preview.void.star_count).toBe(preview.void.row_count);
    expect(preview.void.star_count).toBe(live.void.star_count);
    expect(preview.meals.star_count).toBe(2);
    expect(preview.meals.star_count).toBe(live.meals.star_count);
  });

  it('`count_distinct` still answers what #16203 gave it — a cardinality, nulls excluded', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    expect(preview.travel.distinct_payers).toBe(1); // 'ann' twice + a null
    expect(preview.meals.distinct_payers).toBe(1);
    expect(preview.void.distinct_payers).toBe(0);
    expect(preview.travel.distinct_payers).toBe(live.travel.distinct_payers);
    expect(preview.void.distinct_payers).toBe(live.void.distinct_payers);
  });
});

describe('#16218 — a group where NO row carries a value answers 0, never null', () => {
  it('the `void` group: 0 on both faces, and a number rather than a null', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    // `COUNT(col)` over no non-null values is 0, and `emptyGroupValueFor`
    // (`@objectstack/spec/data`) rules the same from the other side: `count` and
    // `count_distinct` answer the identity `0` because counting nothing is a
    // measured fact, while `avg`/`min`/`max` over nothing stay null.
    expect(live.void.payer_count).toBe(0);
    expect(preview.void.payer_count).toBe(0);
    expect(preview.void.payer_count).not.toBeNull();
    expect(preview.void.payer_count).toBe(live.void.payer_count);
  });

  it('over ZERO rows the single overall group still counts 0, both spellings', () => {
    const CUBE = {
      name: 'e', sql: 'expense',
      dimensions: {},
      measures: {
        rows: { name: 'rows', type: 'count', sql: '*' },
        payers: { name: 'payers', type: 'count', sql: 'payer' },
      },
    } as unknown as Cube;
    const r = evaluateAnalyticsQueryOverRows({ measures: ['rows', 'payers'], dimensions: [] }, CUBE, []);
    expect(r.rows).toEqual([{ rows: 0, payers: 0 }]);
  });

  it('a field ABSENT from every row counts 0, exactly like a null-valued one', () => {
    const CUBE = {
      name: 'e', sql: 'expense',
      dimensions: { category: { name: 'category', type: 'string', sql: 'category' } },
      measures: { payers: { name: 'payers', type: 'count', sql: 'payer' } },
    } as unknown as Cube;
    // `undefined` (key never written) and `null` are one population to
    // `COUNT(col)`: neither is a value.
    const r = evaluateAnalyticsQueryOverRows(
      { measures: ['payers'], dimensions: ['category'] },
      CUBE,
      [{ category: 'x' }, { category: 'x', payer: null }],
    );
    expect(r.rows).toEqual([{ category: 'x', payers: 0 }]);
  });
});
