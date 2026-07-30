// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal conformance for the analytics raw-SQL strategy (ADR-0053 D-A3),
 * executed against a real SQLite engine (`sql.js`, pure WASM).
 *
 * The cases come from `@objectstack/spec/data` so this backend, the three
 * drivers, the draft preview and `formula`'s write-side `check` evaluator are
 * all held to one standard — see `temporal-conformance.ts` for the four
 * divergences that standard exists to prevent.
 *
 * ## Why this surface needed its own consumer
 *
 * `NativeSQLStrategy` is the surface #3650 broke — the dashboard window was
 * dropped and the chart drew all history — and it is the one listed in the
 * matrix's own backend table that had no consumer. It is also the only backend
 * that hand-compiles SQL text rather than delegating to a driver's compiler, so
 * "the other backends are green" says nothing about it.
 *
 * Every other suite for this strategy (`native-sql-datetime-filter.test.ts`,
 * `native-sql-datetime-filter-column.test.ts`) asserts the emitted SQL string.
 * That is a different question, with a lower ceiling: a string assertion checks
 * the compiler emits what its author wrote down, and a dropped predicate is
 * invisible to it — the SQL is still valid, just wider. This file asserts ROW
 * IDS, which is what D-A3 demanded and what catches a predicate that silently
 * went missing. (It found one: see the `$between` note in
 * `filter-normalizer.ts`.)
 *
 * ## Storage form
 *
 * Rows are seeded in the canonical post-#3912 form — UTC ISO text for the
 * `datetime` column, bare `YYYY-MM-DD` for the `date` one — which is the state
 * a backfilled deployment is in, and the state in which the driver's
 * `temporalFilterValue` / `temporalFilterColumnSql` hooks are identities. The
 * context therefore omits them, exercising the same "absent = identity" path a
 * Postgres deployment takes (ADR-0053 D-A2). The un-backfilled mixed column is
 * a different axis, covered where the driver truth lives:
 * `native-sql-datetime-filter-column.test.ts` for the emitted normalisation and
 * `driver-sql`'s own legacy sweep for row results.
 *
 * ## Why `sql.js` and not `better-sqlite3`
 *
 * Same reason as `read-scope-sql-conformance.test.ts`: the native binding is
 * loadable only by the exact Node ABI it was built for and aborts the vitest
 * worker on CI's Node, taking the whole file's cases silently with it. `sql.js`
 * is the pure-WASM engine `driver-sql` itself falls back to.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TEMPORAL_CASES, TEMPORAL_NOW, TEMPORAL_ROWS } from '@objectstack/spec/data';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';
import { resolveFilterTokens } from '@objectstack/core';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';

/**
 * Dimension ids match the fixture's property names (`at` / `on`) so the shared
 * cases apply unchanged, while the COLUMNS are deliberately different
 * (`happened_at` / `happened_on`) — that is what proves the strategy resolved
 * the real column rather than echoing the member name.
 */
const CUBE: Cube = {
  name: 'conformance',
  title: 'Conformance',
  sql: 'conformance',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    at: { name: 'at', label: 'At', type: 'time', sql: 'happened_at' },
    on: { name: 'on', label: 'On', type: 'time', sql: 'happened_on' },
  },
  public: false,
} as unknown as Cube;

const resolveTokens = <T,>(filter: T): T =>
  resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

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

describe('NativeSQLStrategy — temporal conformance', () => {
  let db: any;
  let ctx: StrategyContext;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    db.run(`
      CREATE TABLE "conformance" (
        "id" TEXT PRIMARY KEY,
        "happened_at" TEXT,
        "happened_on" TEXT,
        "why" TEXT
      );
    `);
    const insert = db.prepare(
      `INSERT INTO "conformance" ("id","happened_at","happened_on","why") VALUES (?,?,?,?)`,
    );
    for (const r of TEMPORAL_ROWS) insert.run([r.id, r.at, r.on, r.why]);
    insert.free();

    ctx = {
      getCube: (name: string) => (name === 'conformance' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      // The strategy binds `$1`-style placeholders in ascending order, each
      // pushed immediately before it is referenced, so a positional rewrite to
      // SQLite's `?` preserves the pairing.
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
        const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
        stmt.bind(params as any[]);
        const out: Record<string, unknown>[] = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        stmt.free();
        return out;
      },
    } as StrategyContext;
  });

  afterAll(() => {
    db?.close();
  });

  /** Group by `id` so the result rows ARE the matched row ids. */
  const idsFor = async (query: Omit<AnalyticsQuery, 'cube' | 'measures' | 'dimensions'>) => {
    const result = await new NativeSQLStrategy().execute(
      { cube: 'conformance', measures: ['total'], dimensions: ['id'], ...query } as AnalyticsQuery,
      ctx,
    );
    return result.rows.map((r) => String(r.id)).sort();
  };

  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      expect(await idsFor({ where: c.filter }), c.note).toEqual([...c.expected].sort());
    });

    // The D-A3 token axis (#4081): the same case spelled in relative tokens,
    // resolved at the pinned instant, must reach the same rows.
    if (c.tokenFilter) {
      it(`${c.name} — via relative tokens`, async () => {
        expect(await idsFor({ where: resolveTokens(c.tokenFilter) }), c.note).toEqual(
          [...c.expected].sort(),
        );
      });
    }

    // The dashboard-window path — the shape #3650 dropped entirely. No
    // granularity, or `canHandle` correctly declines to the ObjectQL strategy.
    if (c.dateRange) {
      it(`${c.name} — via timeDimensions.dateRange`, async () => {
        expect(
          await idsFor({ timeDimensions: [{ dimension: c.field, dateRange: resolveTokens(c.dateRange) }] }),
          c.note,
        ).toEqual([...c.expected].sort());
      });
    }
  }
});
