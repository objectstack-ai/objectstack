// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for the analytics raw-SQL strategy,
 * executed against a real SQLite engine (`sql.js`, pure WASM).
 *
 * The cases come from `@objectstack/spec/data`, so this backend now stands
 * beside `driver-sql`, `driver-memory`, `formula`'s `matchesFilterCondition`
 * and `read-scope-sql` under one standard — see `filter-logic-conformance.ts`
 * for why that standard exists (#3774).
 *
 * ## Why this consumer arrives late, and what it proves
 *
 * The analytics strategies could not have passed this table before: their
 * normalizer produced a flat ARRAY, which cannot carry a disjunction, so an
 * author's `{$or: […]}` was skipped outright and the compiled WHERE simply
 * did not contain it. That is not "unsupported" — a missing predicate WIDENS
 * the query, returning rows the author excluded, and it is invisible to a
 * test that asserts the emitted SQL string (the SQL stays valid, just
 * broader). Every case below whose filter carries a combinator fails against
 * the pre-tree normalizer, most of them by returning the entire fixture.
 *
 * The read-scope compiler in this same package (`read-scope-sql.ts`) has
 * always compiled the full tree, and is already a consumer of this table —
 * so the package contained one correct implementation and one lossy one, for
 * the same filter shape, with nothing holding them to each other. It does
 * now.
 *
 * ## Why `sql.js` and not `better-sqlite3`
 *
 * Same reason as `read-scope-sql-conformance.test.ts`: the native binding is
 * loadable only by the exact Node ABI it was built for and aborts the vitest
 * worker on CI's Node, taking the file's cases silently with it. `sql.js` is
 * the pure-WASM engine `driver-sql` itself falls back to.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';

/**
 * Dimension ids match the fixture's column names so the shared cases apply
 * unchanged. `id` is selected and grouped by, which makes the result rows the
 * matched row ids.
 */
const CUBE: Cube = {
  name: 'logic',
  title: 'Logic',
  sql: 't',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: Object.fromEntries(
    ['id', 'a', 'b', 'c', 'owner', 'status', 'parent_object', 'parent_id'].map((n) => [
      n,
      { name: n, label: n, type: 'string', sql: n },
    ]),
  ),
  public: false,
} as unknown as Cube;

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

describe('NativeSQLStrategy — filter logic conformance', () => {
  let db: any;
  let ctx: StrategyContext;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    db.run(`
      CREATE TABLE "t" (
        "id" TEXT PRIMARY KEY,
        "a" TEXT, "b" TEXT, "c" TEXT,
        "owner" TEXT, "status" TEXT,
        "parent_object" TEXT, "parent_id" TEXT
      );
    `);
    const insert = db.prepare(
      `INSERT INTO "t" ("id","a","b","c","owner","status","parent_object","parent_id")
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    for (const r of FILTER_LOGIC_ROWS) {
      insert.run([r.id, r.a, r.b, r.c, r.owner, r.status, r.parent_object, r.parent_id]);
    }
    insert.free();

    ctx = {
      getCube: (name: string) => (name === 'logic' ? CUBE : undefined),
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

  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, async () => {
      const result = await new NativeSQLStrategy().execute(
        {
          cube: 'logic',
          measures: ['total'],
          dimensions: ['id'],
          where: c.filter,
        } as AnalyticsQuery,
        ctx,
      );
      const got = result.rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));
      expect(got, c.note).toEqual(c.expected);
    });
  }
});
