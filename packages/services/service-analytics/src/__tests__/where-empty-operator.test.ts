// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20445] The analytics `where` face answers `$empty` by the field's DECLARED
 * type.
 *
 * `lowerAnalyticsWhere` / `normalizeAnalyticsFilterTree` used to pass `$empty`
 * through and then refuse it as an unsupported operator (`INVALID_FILTER` /
 * 400). It now lowers to a valueless `empty` / `notEmpty` leaf, and each
 * consumer of the tree answers it where the field's declaration is known:
 *
 * - `NativeSQLStrategy` — the statement that EXECUTES — expands the host's
 *   declared value shape through the spec (`expandEmptyOperator`) and compiles
 *   the row. Executed here on real SQLite (`sql.js`).
 * - the `ObjectQLStrategy` echo (`/analytics/sql`) renders the same predicate,
 *   run here on the same database, so it returns the same rows.
 * - the `ObjectQLStrategy` execute path hands `{ $empty }` to the ENGINE, whose
 *   arm is the engine lane's; pinned here as the condition handed over, not as
 *   the rows the engine returns.
 *
 * The ruled table (#20311): text-like = null or `''`; multi-value = null or
 * `[]`; every other type = null only; `$empty: false` is the complement.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, ValueShapeFieldDef } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import type { DatasetScopedStrategyContext } from '../strategies/types.js';

const TABLE = 't';

const SHAPES: Record<string, ValueShapeFieldDef> = {
  id: { type: 'text' },
  name: { type: 'text' },
  tags: { type: 'tags' },
  owners: { type: 'lookup', multiple: true },
  stage: { type: 'select' },
  amount: { type: 'number' },
};

/** The same five stored states `read-scope-empty-operator.test.ts` measures. */
const ROWS = [
  { id: 'n', name: null, tags: null, owners: null, stage: null, amount: null },
  { id: 's', name: '', tags: '', owners: '', stage: '', amount: 0 },
  { id: 'l', name: '[]', tags: '[]', owners: '[]', stage: '[]', amount: 7 },
  { id: 'o', name: 'o', tags: '{}', owners: '"u1"', stage: 'lost', amount: -1 },
  { id: 'v', name: 'acme', tags: '["a"]', owners: '["u1","u2"]', stage: 'won', amount: 5 },
];
const ALL = ROWS.map((r) => r.id).sort();
const complement = (ids: string[]): string[] => ALL.filter((id) => !ids.includes(id));

const EMPTY: Record<string, string[]> = {
  name: ['n', 's'],
  tags: ['l', 'n'],
  owners: ['l', 'n'],
  stage: ['n'],
  amount: ['n'],
};

const CUBE: Cube = {
  name: 'empties',
  title: 'Empties',
  sql: TABLE,
  measures: { total: { label: 'Total', type: 'count', sql: '*' } },
  dimensions: Object.fromEntries(
    Object.keys(SHAPES).map((n) => [n, { label: n, type: 'string', sql: n }]),
  ),
  public: true,
} as unknown as Cube;

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

interface CodedError extends Error {
  code?: unknown;
  status?: unknown;
}

async function refusalOf(fn: () => unknown): Promise<CodedError> {
  try {
    await fn();
  } catch (e) {
    return e as CodedError;
  }
  throw new Error('expected a refusal, and the filter was served');
}

const query = (where: unknown): AnalyticsQuery =>
  ({ cube: 'empties', measures: ['total'], dimensions: ['id'], timezone: 'UTC', where }) as AnalyticsQuery;

describe('[#20445] normalizeAnalyticsFilterTree — `$empty` lowers to its own valueless leaf', () => {
  it('$empty: true → an `empty` leaf, $empty: false → `notEmpty`', () => {
    expect(normalizeAnalyticsFilterTree({ where: { name: { $empty: true } } })).toEqual({
      kind: 'leaf', member: 'name', operator: 'empty', values: [],
    });
    expect(normalizeAnalyticsFilterTree({ where: { name: { $empty: false } } })).toEqual({
      kind: 'leaf', member: 'name', operator: 'notEmpty', values: [],
    });
  });

  it('under $not the leaf takes no NULL guard: the arm is total on every consumer', () => {
    expect(normalizeAnalyticsFilterTree({ where: { $not: { name: { $empty: true } } } })).toEqual({
      kind: 'not', child: { kind: 'leaf', member: 'name', operator: 'empty', values: [] },
    });
  });

  for (const flag of ['true', 0, null, [true], new Date(0)]) {
    it(`a non-boolean flag (${String(flag)}) is refused INVALID_FILTER / 400, with the null flags`, async () => {
      const err = await refusalOf(() => normalizeAnalyticsFilterTree({ where: { name: { $empty: flag } } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('Operator "$empty" on field "name" requires a boolean comparand');
    });
  }
});

describe('[#20445] the `where` face on SQLite — native execute, and the ObjectQL echo run on the same rows', () => {
  let db: any;
  let nativeCtx: StrategyContext;
  let objectqlCtx: StrategyContext;
  const handed: Array<Record<string, unknown> | undefined> = [];

  const runSql = (sql: string, params: unknown[]): string[] => {
    const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
    stmt.bind(params as any[]);
    const out: string[] = [];
    while (stmt.step()) out.push(String(stmt.getAsObject().id));
    stmt.free();
    return out.sort((x, y) => x.localeCompare(y));
  };

  const nativeIds = async (where: unknown): Promise<string[]> => {
    const result = await new NativeSQLStrategy().execute(query(where), nativeCtx);
    return result.rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));
  };

  const echoIds = async (where: unknown): Promise<string[]> => {
    const { sql, params } = await new ObjectQLStrategy().generateSql(query(where), objectqlCtx);
    return runSql(sql, params);
  };

  /** Both SQL faces, which must agree row for row. */
  const ids = async (where: unknown): Promise<string[]> => {
    const native = await nativeIds(where);
    expect(await echoIds(where), 'the ObjectQL echo returns what native executes').toEqual(native);
    return native;
  };

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
    db = new SQL.Database();
    db.run(`CREATE TABLE "t" ("id" TEXT PRIMARY KEY, "name" TEXT, "tags" TEXT, "owners" TEXT, "stage" TEXT, "amount" REAL);`);
    const insert = db.prepare(`INSERT INTO "t" ("id","name","tags","owners","stage","amount") VALUES (?,?,?,?,?,?)`);
    for (const r of ROWS) insert.run([r.id, r.name, r.tags, r.owners, r.stage, r.amount]);
    insert.free();

    const hooks: Partial<DatasetScopedStrategyContext> = {
      getCube: (name: string) => (name === 'empties' ? CUBE : undefined),
      declaredValueShape: (object: string, field: string) => (object === TABLE ? SHAPES[field] : undefined),
      sqlDialect: () => 'sqlite',
    };
    nativeCtx = {
      ...hooks,
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
        const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
        stmt.bind(params as any[]);
        const out: Record<string, unknown>[] = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        stmt.free();
        return out;
      },
    } as StrategyContext;
    objectqlCtx = {
      ...hooks,
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (_object: string, options: { filter?: Record<string, unknown> }) => {
        handed.push(options.filter);
        return [];
      },
    } as StrategyContext;
  });

  afterAll(() => {
    db?.close();
  });

  for (const [field, expected] of Object.entries(EMPTY)) {
    it(`${field} (${SHAPES[field].type}${SHAPES[field].multiple ? ', multiple' : ''}): $empty: true → ${expected.join(',')}`, async () => {
      expect(await ids({ [field]: { $empty: true } })).toEqual(expected);
    });
    it(`${field}: $empty: false is the exact complement`, async () => {
      expect(await ids({ [field]: { $empty: false } })).toEqual(complement(expected));
    });
  }

  it('the null-only row does NOT count the empty string: a select holding "" is not empty', async () => {
    expect(await ids({ stage: { $empty: true } })).not.toContain('s');
    expect(await ids({ stage: { $empty: false } })).toContain('s');
  });

  it('on a multi-value column, "" and a non-list JSON value are values, not the empty list', async () => {
    const got = await ids({ tags: { $empty: true } });
    expect(got).not.toContain('s');
    expect(got).not.toContain('o');
  });

  describe('nested under $and / $or / $not', () => {
    it('$not over $empty is its complement', async () => {
      expect(await ids({ $not: { name: { $empty: true } } })).toEqual(complement(EMPTY.name));
      expect(await ids({ $not: { owners: { $empty: false } } })).toEqual(EMPTY.owners);
    });

    it('$and of two $empty: false', async () => {
      expect(await ids({ $and: [{ tags: { $empty: false } }, { name: { $empty: false } }] })).toEqual(['o', 'v']);
    });

    it('$or of two $empty: true', async () => {
      expect(await ids({ $or: [{ stage: { $empty: true } }, { tags: { $empty: true } }] })).toEqual(['l', 'n']);
    });

    it('$not over an $or of $empty', async () => {
      expect(await ids({ $not: { $or: [{ name: { $empty: true } }, { owners: { $empty: true } }] } })).toEqual(['o', 'v']);
    });

    it('beside another operator on the same field', async () => {
      expect(await ids({ name: { $empty: false, $ne: 'acme' } })).toEqual(['l', 'o']);
      expect(await ids({ $not: { name: { $empty: false, $ne: 'acme' } } })).toEqual(['n', 's', 'v']);
    });
  });

  describe('the ObjectQL execute path hands the canonical operator to the engine', () => {
    it('$empty: true / false arrive as `{ $empty }`, never expanded into $null / $eq fragments', async () => {
      handed.length = 0;
      await new ObjectQLStrategy().execute(query({ tags: { $empty: true } }), objectqlCtx);
      await new ObjectQLStrategy().execute(query({ name: { $empty: false } }), objectqlCtx);
      await new ObjectQLStrategy().execute(query({ $not: { stage: { $empty: true } } }), objectqlCtx);
      expect(handed).toEqual([
        { tags: { $empty: true } },
        { name: { $empty: false } },
        { $and: [{ $not: { stage: { $empty: true } } }] },
      ]);
    });
  });

  describe('refusals — INVALID_FILTER / 400, the where door’s envelope', () => {
    const expectCallerFault = (err: CodedError) => {
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    };

    it('a host with no declared value shape: refused on both SQL faces, never guessed', async () => {
      const bare = (ctx: StrategyContext) => ({ ...ctx, declaredValueShape: undefined }) as StrategyContext;
      const native = await refusalOf(() => new NativeSQLStrategy().execute(query({ name: { $empty: true } }), bare(nativeCtx)));
      expectCallerFault(native);
      expect(native.message).toContain('could not name the declaration of field "name" of "t"');
      expectCallerFault(await refusalOf(() => new ObjectQLStrategy().generateSql(query({ name: { $empty: true } }), bare(objectqlCtx))));
    });

    it('a multi-value field on the unknown dialect: refused; the other rows still compile there', async () => {
      const noDialect = { ...nativeCtx, sqlDialect: undefined } as StrategyContext;
      const err = await refusalOf(() => new NativeSQLStrategy().execute(query({ owners: { $empty: true } }), noDialect));
      expectCallerFault(err);
      expect(err.message).toContain('dialect of this datasource is not known');
      const result = await new NativeSQLStrategy().execute(query({ name: { $empty: true }, amount: { $empty: false } }), noDialect);
      expect(result.rows.map((r) => String(r.id)).sort()).toEqual(['s']);
    });
  });
});
