// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14079] A text operator over a column whose STORED value is never text, on
 * this package's three SQL compilers — `read-scope-sql.ts` (the RLS read
 * scope), `NativeSQLStrategy.buildFilterClause` (the query's own `where`) and
 * the `ObjectQLStrategy` echo of that statement.
 *
 * ## The contract
 *
 * `FILTER_TEXT_CASES`' `score` rows (the maintainer's 2026-09-05 ruling): a
 * stored value that is not a string never satisfies a positive text operator
 * and always satisfies `$notContains`. The JS faces read that off the value; a
 * SQL compiler cannot, so it reads the DECLARED type through
 * `DatasetScopedStrategyContext.declaredFieldType` and compiles the contract's
 * constant (`1 = 0` / `1 = 1`) for a column in `NON_TEXT_STORED_VALUE_TYPES`.
 *
 * ## What is measured, and where
 *
 * The compiled TEXT is asserted for all three compilers (that is what a
 * Postgres server would have refused — SQLSTATE 42883 on `real ~~ text` — and
 * what this container cannot run against one). The ROWS are asserted on sql.js,
 * a real SQLite engine, over a REAL column: that is the cell where a `LIKE`
 * COERCED the number in the storage class's spelling (`5` renders `'5.0'`, so
 * `$endsWith: '0'` matched all nine rows), which is the wrong answer the
 * table's rows are built to make visible. The shared table drives the native
 * compiler directly, so this face is held to the same standard as the drivers.
 *
 * ## What is deliberately NOT changed
 *
 * A host that wires no `declaredFieldType` gets the `LIKE` it always got —
 * "cannot answer, do not block" — and a comparand the contract refuses is
 * refused BEFORE the constant is considered, on every compiler.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import { FILTER_TEXT_CASES, FILTER_TEXT_ROWS, NON_TEXT_STORED_VALUE_TYPES } from '@objectstack/spec/data';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import type { DatasetScopedStrategyContext } from '../strategies/types.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import { isNonTextDeclaredType, nonTextColumnResolver, textOperatorPolarity } from '../non-text-column.js';

const ALIAS = 't';
const ALL_IDS = FILTER_TEXT_ROWS.map((r) => r.id);

/** The declared types the host would hand the service: `score` is a number, everything else text. */
const DECLARED: Record<string, string> = { id: 'text', name: 'text', score: 'number', flag: 'boolean' };
const declaredFieldType = (_object: string, field: string): string | undefined => DECLARED[field];
const nonText = (field: string): boolean => isNonTextDeclaredType(declaredFieldType('rows', field));

const CUBE: Cube = {
  name: 'texts',
  title: 'Texts',
  sql: 'rows',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    name: { name: 'name', label: 'Name', type: 'string', sql: 'name' },
    score: { name: 'score', label: 'Score', type: 'number', sql: 'score' },
  },
  public: false,
} as unknown as Cube;

const query = (where: unknown): AnalyticsQuery =>
  ({ cube: 'texts', measures: ['total'], dimensions: ['id'], timezone: 'UTC', where }) as AnalyticsQuery;

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

/** The five rows the shared table declares over its non-string column. */
const NON_STRING_ROWS = FILTER_TEXT_CASES.filter(
  (c): c is Extract<typeof c, { expected: readonly string[] }> =>
    c.expectRejection !== true && Object.keys(c.filter)[0] === 'score',
);

describe('[#14079] the shared classifier', () => {
  it('reads NON_TEXT_STORED_VALUE_TYPES — the numeric and boolean classes, never the temporal ones', () => {
    for (const t of ['number', 'currency', 'percent', 'rating', 'slider', 'progress', 'summary', 'boolean', 'toggle']) {
      expect(NON_TEXT_STORED_VALUE_TYPES.has(t), t).toBe(true);
      expect(isNonTextDeclaredType(t), t).toBe(true);
    }
    for (const t of ['text', 'textarea', 'email', 'select', 'lookup', 'json', 'date', 'datetime', 'time']) {
      expect(isNonTextDeclaredType(t), t).toBe(false);
    }
    // Unknown is NOT non-text: a column the host cannot classify keeps its LIKE.
    expect(isNonTextDeclaredType(undefined)).toBe(false);
    expect(isNonTextDeclaredType(null)).toBe(false);
  });

  it('knows both spellings of every text operator and no other operator', () => {
    for (const op of ['$contains', '$startsWith', '$endsWith', '$icontains', '$like', '$ilike', 'contains', 'startsWith', 'endsWith', 'icontains']) {
      expect(textOperatorPolarity(op), op).toBe('positive');
    }
    expect(textOperatorPolarity('$notContains')).toBe('negative');
    expect(textOperatorPolarity('notContains')).toBe('negative');
    for (const op of ['$eq', '$gt', '$in', '$null', 'equals', 'in', 'set']) expect(textOperatorPolarity(op), op).toBeNull();
  });

  it('answers undefined for a context that wired no hook, so every compiler keeps its LIKE', () => {
    expect(nonTextColumnResolver({} as DatasetScopedStrategyContext, 'rows')).toBeUndefined();
    const resolver = nonTextColumnResolver({ declaredFieldType } as DatasetScopedStrategyContext, 'rows')!;
    expect(resolver('score')).toBe(true);
    expect(resolver('name')).toBe(false);
    expect(resolver('unknown_column')).toBe(false);
  });
});

describe('[#14079] read-scope-sql compiles the contract\'s constant for a declared non-text column', () => {
  const compile = (filter: FilterCondition) => compileScopedFilterToSql(filter, ALIAS, { nonTextColumn: nonText });

  it('the positive operators compile to 1 = 0 and bind NOTHING', () => {
    for (const op of ['$contains', '$startsWith', '$endsWith', '$icontains'] as const) {
      const out = compile({ score: { [op]: '5' } } as FilterCondition);
      expect(out.sql, op).toBe('1 = 0');
      expect(out.params, op).toEqual([]);
    }
  });

  it('$notContains compiles to 1 = 1 — the exact complement, NULL rows included', () => {
    expect(compile({ score: { $notContains: '5' } } as FilterCondition)).toEqual({ sql: '1 = 1', params: [] });
  });

  it('composes with the NULL-safe $not rewrite: the negation of the constant is total', () => {
    // `nullSafeNegationOperand` guards the leaf first, then the constant
    // replaces the LIKE: TRUE for every row, what the JS faces answer for
    // `!contains` on a number; its mirror is FALSE for every row.
    expect(compile({ $not: { score: { $contains: '5' } } } as FilterCondition).sql)
      .toBe('NOT (("t"."score" IS NOT NULL AND 1 = 0))');
    expect(compile({ $not: { score: { $notContains: '5' } } } as FilterCondition).sql)
      .toBe('NOT ((("t"."score" IS NULL OR 1 = 1)))');
  });

  it('a text column beside it is untouched, and params stay aligned with the LIKE that IS bound', () => {
    const out = compile({ name: { $contains: 'x' }, score: { $contains: '5' } } as FilterCondition);
    expect(out.sql).toBe('"t"."name" LIKE ? ESCAPE ? AND 1 = 0');
    expect(out.params).toEqual(['%x%', '\\']);
  });

  it('without the option, or when the column is text, the LIKE is byte-identical to before', () => {
    expect(compileScopedFilterToSql({ score: { $contains: '5' } } as FilterCondition, ALIAS))
      .toEqual({ sql: '"t"."score" LIKE ? ESCAPE ?', params: ['%5%', '\\'] });
    expect(compile({ name: { $notContains: '5' } } as FilterCondition).sql)
      .toBe('("t"."name" IS NULL OR "t"."name" NOT LIKE ? ESCAPE ?)');
  });

  it('a comparand the contract refuses is refused AHEAD of the constant', () => {
    // `assertRenderableText` runs first on every LIKE arm: an object comparand
    // over the numeric column is still the same fail-closed refusal it always
    // was, never laundered into a constant.
    expect(() => compile({ score: { $contains: { $field: 'name' } } } as unknown as FilterCondition)).toThrow();
    expect(() => compile({ score: { $contains: {} } } as unknown as FilterCondition)).toThrow();
  });
});

describe('[#14079] the two strategies, on a real SQLite engine over a REAL column', () => {
  let db: any;
  /** `ctx` for the raw-SQL strategy, with the declared-type hook a host wires. */
  let nativeCtx: DatasetScopedStrategyContext;
  /** The same ctx without the hook — the "cannot answer" host. */
  let unawareCtx: DatasetScopedStrategyContext;
  let echoCtx: DatasetScopedStrategyContext;

  const run = (sql: string, params: unknown[]): { rows: Record<string, unknown>[]; ids: string[] } => {
    const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
    stmt.bind(params as any[]);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return { rows, ids: rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b)) };
  };

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
    db = new SQL.Database();
    db.run(`CREATE TABLE "rows" ("id" TEXT PRIMARY KEY, "name" TEXT, "score" REAL);`);
    const insert = db.prepare(`INSERT INTO "rows" ("id","name","score") VALUES (?,?,?)`);
    for (const r of FILTER_TEXT_ROWS) insert.run([r.id, r.name, r.score]);
    insert.free();

    const base = {
      getCube: (name: string) => (name === 'texts' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => run(sql, params).rows,
    };
    unawareCtx = { ...base } as DatasetScopedStrategyContext;
    nativeCtx = { ...base, declaredFieldType } as DatasetScopedStrategyContext;
    echoCtx = { getCube: base.getCube, queryCapabilities: base.queryCapabilities, declaredFieldType } as DatasetScopedStrategyContext;
  });

  afterAll(() => {
    db?.close();
  });

  const executedIds = async (where: unknown, ctx: DatasetScopedStrategyContext): Promise<string[]> => {
    const { sql, params } = await new NativeSQLStrategy().generateSql(query(where), ctx);
    return run(sql, params).ids;
  };

  it('the fixture is stored as REAL — the storage class whose text rendering is the coercion tell', () => {
    const { rows } = run('SELECT "id", typeof("score") AS t, CAST("score" AS TEXT) AS s FROM "rows" ORDER BY "id"', []);
    expect(rows.map((r) => r.t)).toEqual(Array(9).fill('real'));
    // `5` renders `'5.0'` here: a coercing `LIKE '%0'` would match every row.
    expect(rows[0].s).toBe('5.0');
  });

  it('the shared table\'s five non-string rows, executed through NativeSQLStrategy', async () => {
    expect(NON_STRING_ROWS.length).toBe(5);
    for (const c of NON_STRING_ROWS) {
      expect(await executedIds(c.filter, nativeCtx), c.name).toEqual([...c.expected]);
    }
  });

  it('the coercion the rows are built to catch really is what an unaware host answers on REAL', async () => {
    // The premise of the pin, stated as the wrong answer: without the declared
    // type the compiler emits `LIKE`, SQLite coerces `5` to `'5.0'`, and the
    // storage class decides the row set — all nine for `$endsWith: '0'`.
    expect(await executedIds({ score: { $endsWith: '0' } }, unawareCtx)).toEqual(ALL_IDS);
    expect(await executedIds({ score: { $contains: '5' } }, unawareCtx)).toEqual(['1', '2', '4', '6', '7', '8', '9']);
    expect(await executedIds({ score: { $notContains: '5' } }, unawareCtx)).toEqual(['3', '5']);
  });

  it('the compiled text is the constant, and the echo prints the same statement the native compiler runs', async () => {
    for (const [where, fragment] of [
      [{ score: { $contains: '5' } }, '1 = 0'],
      [{ score: { $icontains: '5' } }, '1 = 0'],
      [{ score: { $startsWith: '5' } }, '1 = 0'],
      [{ score: { $notContains: '5' } }, '1 = 1'],
    ] as const) {
      const native = await new NativeSQLStrategy().generateSql(query(where), nativeCtx);
      const echo = await new ObjectQLStrategy().generateSql(query(where), echoCtx);
      expect(native.sql, JSON.stringify(where)).toContain(fragment);
      expect(native.sql, JSON.stringify(where)).not.toMatch(/LIKE/);
      expect(native.params, JSON.stringify(where)).toEqual([]);
      expect(echo.sql, `echo of ${JSON.stringify(where)}`).toContain(fragment);
      expect(echo.sql, `echo of ${JSON.stringify(where)}`).not.toMatch(/LIKE/);
      expect(echo.params, `echo of ${JSON.stringify(where)}`).toEqual([]);
    }
    // The text column beside it still compiles its LIKE on both.
    const native = await new NativeSQLStrategy().generateSql(query({ name: { $contains: 'acme' } }), nativeCtx);
    expect(native.sql).toMatch(/LIKE/);
    expect(native.params).toEqual(['%acme%', '\\']);
  });

  it('$not over the constant composes: every row for !contains, no row for !notContains', async () => {
    expect(await executedIds({ $not: { score: { $contains: '5' } } }, nativeCtx)).toEqual(ALL_IDS);
    expect(await executedIds({ $not: { score: { $notContains: '5' } } }, nativeCtx)).toEqual([]);
    // The constant is one disjunct among ordinary ones: the text column's own
    // LIKE still decides the rest. (`a.b`, not `acme`: this compiler emits a
    // plain `LIKE`, which folds ASCII case on SQLite — a known property of
    // this face, not this card's subject — so the control must not turn on case.)
    expect(await executedIds({ $or: [{ score: { $contains: '5' } }, { name: { $contains: 'a.b' } }] }, nativeCtx)).toEqual(['9']);
  });

  it('the read scope takes the same rule through the same hook', async () => {
    const scoped = {
      ...nativeCtx,
      getReadScope: (object: string) => (object === 'rows' ? ({ score: { $notContains: '5' } } as FilterCondition) : null),
    } as DatasetScopedStrategyContext;
    const { sql, params } = await new NativeSQLStrategy().generateSql(query(undefined), scoped);
    expect(sql).toContain('1 = 1');
    expect(sql).not.toMatch(/LIKE/);
    expect(run(sql, params).ids).toEqual(ALL_IDS);
    const positive = { ...scoped, getReadScope: () => ({ score: { $contains: '5' } } as FilterCondition) } as DatasetScopedStrategyContext;
    const out = await new NativeSQLStrategy().generateSql(query(undefined), positive);
    expect(out.sql).toContain('1 = 0');
    expect(run(out.sql, out.params).ids).toEqual([]);
  });
});
