// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20544] The draft preview (`preview-evaluator.ts`) adds `sum` / `avg` with
 * `@objectstack/core`'s `compensatedSum`, so a drafted chart reads the double
 * the published chart reads on SQLite.
 *
 * Measured on the base (`d2820876f`): over `0.1`, `0.2` and `0.3` the preview
 * answered `0.6000000000000001` / `0.20000000000000004` where the live face —
 * `NativeSQLStrategy`'s SQL on a real SQLite (sql.js), which adds with
 * Kahan-Babuska-Neumaier compensation since 3.43 — answered `0.6` /
 * `0.19999999999999998`; over `1e16, 1, -1e16` it answered `0` / `0` against
 * `1` / `0.3333333333333333`.
 *
 * ## The instrument — the differential #16203 built
 *
 * One dataset, one row set, two `AnalyticsService` instances differing in
 * exactly one key (`draftRowsResolver`), so a difference between the two
 * responses is one the preview evaluator caused. Every group is a control
 * or a case; the two controls (two addends, integers) answer the same double
 * under either fold, so a preview that stopped adding cannot pass on them by
 * coincidence either.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

/** group → its values, and SQLite's `sum` / `avg` over them (#20489's readings). */
const GROUPS: Record<string, { values: number[]; s: number; a: number }> = {
  card: { values: [0.1, 0.2, 0.3], s: 0.6, a: 0.19999999999999998 },
  cancel: { values: [1e16, 1, -1e16], s: 1, a: 0.3333333333333333 },
  two: { values: [0.1, 0.2], s: 0.30000000000000004, a: 0.15000000000000002 },
  ints: { values: [1, 2, 3, 40, 500], s: 546, a: 109.2 },
};

const ROWS: Record<string, unknown>[] = Object.entries(GROUPS).flatMap(([g, { values }], gi) =>
  values.map((amt, i) => ({ id: `${gi}-${i}`, grp: g, amt })),
);

const DATASET = DatasetSchema.parse({
  name: 'ledger_ds',
  label: 'Ledger',
  object: 'ledger',
  dimensions: [{ name: 'grp', field: 'grp', type: 'string', label: 'Group' }],
  measures: [
    { name: 'sum_amt', aggregate: 'sum', field: 'amt' },
    { name: 'avg_amt', aggregate: 'avg', field: 'amt' },
  ],
});

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

function svc(preview: boolean) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_object: string, sql: string, params: unknown[]) => runSql(sql, params),
    ...(preview ? { draftRowsResolver: async () => ROWS.map((r) => ({ ...r })) } : {}),
  });
}

async function grid(preview: boolean): Promise<Record<string, { s: unknown; a: unknown }>> {
  const result = await svc(preview).queryDataset(
    DATASET,
    { dimensions: ['grp'], measures: ['sum_amt', 'avg_amt'] },
    undefined,
    preview ? { previewDrafts: true } : undefined,
  );
  return Object.fromEntries(result.rows.map((r) => [String(r.grp), { s: r.sum_amt, a: r.avg_amt }]));
}

const expected = Object.fromEntries(Object.entries(GROUPS).map(([g, { s, a }]) => [g, { s, a }]));

beforeAll(async () => {
  const mod: any = await import('sql.js');
  const initSqlJs = mod.default ?? mod;
  const locateFile = await locateWasm();
  const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
  db = new SQL.Database();
  db.run(`CREATE TABLE "ledger" ("id" TEXT PRIMARY KEY, "grp" TEXT, "amt" REAL);`);
  const insert = db.prepare(`INSERT INTO "ledger" ("id","grp","amt") VALUES (?,?,?)`);
  for (const r of ROWS) insert.run([r.id, r.grp, r.amt] as any[]);
  insert.free();
});

afterAll(() => db?.close());

describe('[#20544] draft preview — sum / avg read the published double', () => {
  it("the live face is the standard: SQLite answers the card's 0.6 and the cancellation's 1", async () => {
    expect(await grid(false)).toStrictEqual(expected);
  });

  it('the preview answers the same double in every group — the card, the cancellation and both controls', async () => {
    const live = await grid(false);
    const preview = await grid(true);
    expect(preview).toStrictEqual(expected);
    expect(preview).toStrictEqual(live);
  });

  it("so the card's exact comparison holds on the draft: s === 0.6", async () => {
    expect((await grid(true)).card.s === 0.6).toBe(true);
  });
});
