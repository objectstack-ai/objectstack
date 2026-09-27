// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20040, applying #5347 / #5369] The analytics `where` door refuses a
 * non-boolean `$null` / `$exists` flag, before any lowering, in its own
 * `INVALID_FILTER` / 400 envelope, on every face.
 *
 * `FieldOperatorsSchema` declares both flags `z.boolean()`. The #5347 / #5369
 * rulings refuse a non-boolean one in every position and on every backend,
 * because the backends read it in OPPOSITE directions: `driver-sql` refuses it
 * (`nonBooleanNullComparandError` / `nonBooleanExistsComparandError`), and so
 * does this package's read-scope compiler since #6387. This door read the flag
 * by IDENTITY (`=== true` for `$null`, `=== false` for `$exists`), so every
 * other value lowered to `set`.
 *
 * Measured on `origin/main` `8d76c2d38c` before the fix (a real sql.js engine,
 * rows r1 'won', r2 NULL, r3 'lost', field `stage`; the HTTP legs were
 * throwaway harnesses over a real `AnalyticsService`, read and measured only):
 *
 *   | `{ stage: { FLAG: V } }`, any position | native / echo (run) / ObjectQL engine path / `AnalyticsService.query` | draft preview | HTTP `POST /api/v1/analytics/query`, `/analytics/dataset/query` |
 *   |---|---|---|---|
 *   | `V` = `'x'`, `'false'`, `'true'`, `0`, `1`, `null`, `[true]`, `{ $field: 'id' }`, a `Date`, `2n` | `set`: r1 r3 (IS NOT NULL); the engine received `{ stage: { $ne: null } }` | 400, "not evaluated" (the preview evaluates no flag at all) | 200, r1 r3 |
 *   | `V` = `{ a: 1 }` / `undefined` | 400, the shared comparand-TYPE face | the same | 400 (the plain object) |
 *   | `V` = `true` / `false` (control) | the contract's IS NULL / IS NOT NULL | 400, "not evaluated" | 200 |
 *
 * Under `$not` each coerced cell negated to r2, so `{ $not: { stage: { $null:
 * 'true' } } }` served the NULL row the author excluded. The positions measured
 * were the top level, `$and`, `$or`, `$not` and `$not` beside `$ne` (the #5146
 * rewrite's classifiers read the flag too). `$null: null` and `$exists: null`
 * are reachable: the `undefined` gate (#6386) skips both flags by name, and the
 * type face accepts `null`. The `FilterArray` spelling carries no flag value:
 * `is_null` / `is_not_null` lower to a hard-coded boolean by operator NAME, and
 * `$null` / `exists` as an array operator is refused as not a filter.
 *
 * Every refusal asserts the ADR-0112 envelope (`code` + `status`); a bare
 * `toThrow()` would be satisfied by any uncoded error.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQL } from '@objectstack/objectql';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';
import { declaredRefusalMessage, resolveThrownHttpError, serverFaultProvenance } from '@objectstack/types';

import { normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';
import { AnalyticsService } from '../analytics-service.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

const OBJECT = 'deal';
const ROWS = [
  { id: 'r1', stage: 'won', amt: 1 },
  { id: 'r2', stage: null, amt: 2 },
  { id: 'r3', stage: 'lost', amt: 3 },
];
const FIELDS: Record<string, { type: string; name: string }> = {
  id: { type: 'text', name: 'id' },
  stage: { type: 'text', name: 'stage' },
  amt: { type: 'number', name: 'amt' },
};
const CUBE: Cube = {
  name: 'deals',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    [['id', 'string'], ['stage', 'string'], ['amt', 'number']].map(([n, t]) => [n, { name: n, label: n, type: t, sql: n }]),
  ),
  public: false,
} as unknown as Cube;
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } } as never;

const FLAGS = ['$null', '$exists'] as const;

/** Every non-boolean the type face lets through, as measured before the fix. */
const NON_BOOLEAN: Array<[string, unknown]> = [
  ["'x'", 'x'],
  ["'false'", 'false'],
  ["'true'", 'true'],
  ['0', 0],
  ['1', 1],
  ['null', null],
  ['[true]', [true]],
  ['{ $field }', { $field: 'id' }],
  ['a Date', new Date('2026-01-01T00:00:00.000Z')],
  ['2n', 2n],
];

const tree = (where: unknown) => normalizeAnalyticsFilterTree({ where } as never);

function refusalOf(run: () => unknown): Refusal {
  let out: unknown;
  try {
    out = run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, but it answered ${JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))}`);
}

async function asyncRefusalOf(run: () => Promise<unknown>): Promise<Refusal> {
  let out: unknown;
  try {
    out = await run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, but it answered ${JSON.stringify(out)}`);
}

/**
 * The door's envelope, naming the operator, the field and the path. The kind
 * marker ("requires a boolean comparand") is what tells this refusal apart from
 * the type face's, which names the same path.
 */
function expectFlagRefusal(err: Refusal, op: string, field: string, path: string): void {
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
  expect(err.message).toContain(`"${op}"`);
  expect(err.message).toContain(`field "${field}"`);
  expect(err.message).toContain(`at ${path}.`);
  expect(err.message).toContain('requires a boolean comparand');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20040] the `where` door refuses every non-boolean flag, in every position', () => {
  for (const op of FLAGS) {
    for (const [label, value] of NON_BOOLEAN) {
      it(`${op}: ${label}`, () => {
        expectFlagRefusal(refusalOf(() => tree({ stage: { [op]: value } })), op, 'stage', `where.stage.${op}`);
      });
    }
  }

  it('under $and, in a $or beside a TRUE arm, under $not, and deeper', () => {
    expectFlagRefusal(refusalOf(() => tree({ $and: [{ stage: { $null: 'x' } }] })), '$null', 'stage', 'where.$and[0].stage.$null');
    // A TRUE arm absorbs the `$or` once built; the gate runs before any node exists.
    expectFlagRefusal(refusalOf(() => tree({ $or: [{}, { stage: { $exists: 0 } }] })), '$exists', 'stage', 'where.$or[1].stage.$exists');
    expectFlagRefusal(refusalOf(() => tree({ $not: { stage: { $null: 'true' } } })), '$null', 'stage', 'where.$not.stage.$null');
    expectFlagRefusal(
      refusalOf(() => tree({ $and: [{ $not: { $or: [{ id: 'r1' }, { stage: { $exists: null } }] } }] })),
      '$exists', 'stage', 'where.$and[0].$not.$or[1].stage.$exists',
    );
  });

  it('beside another operator under $not, where the #5146 rewrite classifies the flag', () => {
    expectFlagRefusal(refusalOf(() => tree({ $not: { stage: { $null: 'x', $ne: 'lost' } } })), '$null', 'stage', 'where.$not.stage.$null');
    expectFlagRefusal(refusalOf(() => tree({ $not: { stage: { $ne: 'lost', $exists: 'false' } } })), '$exists', 'stage', 'where.$not.stage.$exists');
  });

  it('on a nested relation, at the path the shared faces give it', () => {
    expectFlagRefusal(refusalOf(() => tree({ acct: { stage: { $null: 'x' } } })), '$null', 'stage', 'where.acct.stage.$null');
  });

  it('names what arrived, so the author can see which value was not a boolean', () => {
    expect(refusalOf(() => tree({ stage: { $null: 'false' } })).message).toContain('a string ("false")');
    expect(refusalOf(() => tree({ stage: { $exists: 0 } })).message).toContain('a number (0)');
    expect(refusalOf(() => tree({ stage: { $null: null } })).message).toContain('Received null at');
  });

  it('the FilterArray spelling carries no flag value: its null predicates keep their hard-coded boolean', () => {
    // CONTROL: the third member is filler; direction comes from the operator NAME.
    expect(tree(['stage', 'is_null', 'x'])).toEqual({ kind: 'leaf', member: 'stage', operator: 'notSet', values: [] });
    expect(tree(['stage', 'is_not_null', 0])).toEqual({ kind: 'leaf', member: 'stage', operator: 'set', values: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20040] existing refusals keep their order and their sentence', () => {
  it('an undefined or off-set flag is still the shared type face\'s, in its words', () => {
    for (const op of FLAGS) {
      const undef = refusalOf(() => tree({ stage: { [op]: undefined } }));
      expect(undef.code, op).toBe('INVALID_FILTER');
      expect(undef.message.startsWith(`Filter comparand at where.stage.${op} is undefined.`), op).toBe(true);
      const object = refusalOf(() => tree({ stage: { [op]: { a: 1 } } }));
      expect(object.code, op).toBe('INVALID_FILTER');
      expect(object.message.startsWith(`Filter comparand at where.stage.${op} is a plain object`), op).toBe(true);
      const huge = refusalOf(() => tree({ stage: { [op]: 2n ** 60n } }));
      expect(huge.code, op).toBe('INVALID_FILTER');
      expect(huge.message.startsWith(`Filter comparand at where.stage.${op} is the bigint`), op).toBe(true);
    }
  });

  it('a shape or type defect elsewhere in the same where is answered first, as the faces order it', () => {
    const shape = refusalOf(() => tree({ amt: { $in: 'x' }, stage: { $null: 'x' } }));
    expect(shape.code).toBe('INVALID_FILTER');
    expect(shape.message).not.toContain('requires a boolean comparand');
    expect(shape.message).toContain('$in');
    const type = refusalOf(() => tree({ stage: { $null: 'x' }, amt: { $ne: { a: 1 } } }));
    expect(type.code).toBe('INVALID_FILTER');
    expect(type.message.startsWith('Filter comparand at where.amt.$ne is a plain object')).toBe(true);
  });

  it('a defect only the lowering diagnoses is answered AFTER the flag (measured precedence, same envelope)', () => {
    // A mixed `$` / non-`$` wrapper (#6444) and an operator outside the
    // vocabulary are `fieldLeaves`' refusals; the flag gate runs before any
    // node is built, so a `where` carrying both is answered with the flag.
    expectFlagRefusal(refusalOf(() => tree({ stage: { $null: 'x', nested: 1 } })), '$null', 'stage', 'where.stage.$null');
    expectFlagRefusal(refusalOf(() => tree({ stage: { $wat: 1, $exists: 'x' } })), '$exists', 'stage', 'where.stage.$exists');
    // CONTROL: with a BOOLEAN flag the same wrappers keep their own sentences.
    expect(refusalOf(() => tree({ stage: { $null: true, nested: 1 } })).message).toContain('mixes $-operator keys');
    expect(refusalOf(() => tree({ stage: { $wat: 1, $exists: true } })).message).toContain('Unsupported filter operator "$wat"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The boolean controls, BYTE FOR BYTE: the compiled tree, the executed SQL and
 * its params, the echoed SQL and its params, and the `where` the engine
 * receives — each literal captured from `origin/main` `8d76c2d38c` before the
 * fix. `$null: true` and `$exists: false` are one predicate (IS NULL), and
 * `$null: false` and `$exists: true` the other (IS NOT NULL), so each pair
 * shares one family of literals.
 */
const SELECT = 'SELECT id AS "id", COUNT(*) AS "n" FROM "deal" WHERE ';
const TAIL = ' GROUP BY id';
const notSet = { kind: 'leaf', member: 'stage', operator: 'notSet', values: [] };
const set = { kind: 'leaf', member: 'stage', operator: 'set', values: [] };
const neLost = { kind: 'or', children: [notSet, { kind: 'leaf', member: 'stage', operator: 'notEquals', values: ['lost'] }] };

interface ControlFamily {
  tree: unknown;
  sql: string;
  params: unknown[];
  engine: unknown;
  rows: string[];
}
const IS_NULL: Record<'top' | 'not' | 'notNe', ControlFamily> = {
  top: { tree: notSet, sql: `${SELECT}stage IS NULL${TAIL}`, params: [], engine: { stage: null }, rows: ['r2'] },
  not: {
    tree: { kind: 'not', child: notSet },
    sql: `${SELECT}NOT (stage IS NULL)${TAIL}`,
    params: [],
    engine: { $and: [{ $not: { stage: null } }] },
    rows: ['r1', 'r3'],
  },
  notNe: {
    tree: { kind: 'not', child: { kind: 'or', children: [notSet, { kind: 'and', children: [notSet, neLost] }] } },
    sql: `${SELECT}NOT ((stage IS NULL OR (stage IS NULL AND (stage IS NULL OR stage != $1))))${TAIL}`,
    params: ['lost'],
    engine: { $and: [{ $not: { $or: [{ stage: null }, { stage: null, $and: [{ $or: [{ stage: null }, { stage: { $ne: 'lost' } }] }] }] } }] },
    rows: ['r1', 'r3'],
  },
};
const IS_NOT_NULL: Record<'top' | 'not' | 'notNe', ControlFamily> = {
  top: { tree: set, sql: `${SELECT}stage IS NOT NULL${TAIL}`, params: [], engine: { stage: { $ne: null } }, rows: ['r1', 'r3'] },
  not: {
    tree: { kind: 'not', child: set },
    sql: `${SELECT}NOT (stage IS NOT NULL)${TAIL}`,
    params: [],
    engine: { $and: [{ $not: { stage: { $ne: null } } }] },
    rows: ['r2'],
  },
  notNe: {
    tree: { kind: 'not', child: { kind: 'and', children: [set, { kind: 'and', children: [set, neLost] }] } },
    sql: `${SELECT}NOT ((stage IS NOT NULL AND (stage IS NOT NULL AND (stage IS NULL OR stage != $1))))${TAIL}`,
    params: ['lost'],
    engine: { $and: [{ $not: { stage: { $ne: null }, $and: [{ stage: { $ne: null } }, { $or: [{ stage: null }, { stage: { $ne: 'lost' } }] }] } }] },
    rows: ['r2', 'r3'],
  },
};
const CONTROLS: Array<[string, boolean, Record<'top' | 'not' | 'notNe', ControlFamily>]> = [
  ['$null', true, IS_NULL],
  ['$exists', false, IS_NULL],
  ['$null', false, IS_NOT_NULL],
  ['$exists', true, IS_NOT_NULL],
];

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20040] every analytics face over a real engine', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let scope: unknown;
  let statements: Array<{ sql: string; params: unknown[] }> = [];
  let engineWheres: unknown[] = [];

  const runRawSql = async (sql: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
    statements.push({ sql, params });
    const result = await driver.execute(sql.replace(/\$\d+/g, '?'), params);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
      return (result as { rows: Record<string, unknown>[] }).rows;
    }
    return [];
  };
  const executeAggregate = async (objectName: string, options: Record<string, any>) => {
    engineWheres.push(options.filter);
    return (await engine.aggregate(objectName, {
      where: options.filter,
      groupBy: options.groupBy,
      aggregations: options.aggregations?.map((a: any) => ({ function: a.method, field: a.field, alias: a.alias })),
      context: options.context,
    } as never)) as Record<string, unknown>[];
  };
  const ctxFor = (nativeSql: boolean): StrategyContext =>
    ({
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql, objectqlAggregate: !nativeSql, inMemory: false }),
      getReadScope: () => scope as FilterCondition | undefined,
      executeRawSql: (_object: string, sql: string, params: unknown[]) => runRawSql(sql, params),
      executeAggregate,
      declaredFieldType: (_object: string, field: string) => FIELDS[field]?.type,
      sqlDialect: () => 'sqlite',
    }) as unknown as StrategyContext;
  const service = (nativeSql: boolean) =>
    new AnalyticsService({
      cubes: [CUBE],
      logger: quiet,
      queryCapabilities: () => ({ nativeSql, objectqlAggregate: !nativeSql, inMemory: false }),
      getReadScope: () => scope as FilterCondition | undefined,
      executeRawSql: (_object: string, sql: string, params: unknown[]) => runRawSql(sql, params),
      executeAggregate: executeAggregate as never,
      sqlDialect: () => 'sqlite',
    });
  const q = (where?: unknown) =>
    ({ cube: 'deals', dimensions: ['id'], measures: ['n'], ...(where === undefined ? {} : { where }) }) as unknown as AnalyticsQuery;
  const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();
  const reset = () => {
    statements = [];
    engineWheres = [];
  };

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    await driver.initObjects([{ name: OBJECT, fields: FIELDS } as never]);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
    engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: OBJECT, label: 'Deal', fields: FIELDS } as never);
  });
  afterAll(async () => {
    await driver?.disconnect?.();
  });

  const WHERE_FACES: Array<[string, (where: unknown) => Promise<string[]>]> = [
    ['native execute', async (w) => ids((await new NativeSQLStrategy().execute(q(w), ctxFor(true))).rows)],
    ['/analytics/sql echo', async (w) => {
      const { sql, params } = await new ObjectQLStrategy().generateSql(q(w), ctxFor(false));
      return ids(await runRawSql(sql, params));
    }],
    ['ObjectQL engine path', async (w) => ids((await new ObjectQLStrategy().execute(q(w), ctxFor(false))).rows)],
    ['AnalyticsService.query (native)', async (w) => ids((await service(true).query(q(w))).rows as never)],
    ['AnalyticsService.query (ObjectQL)', async (w) => ids((await service(false).query(q(w))).rows as never)],
  ];

  const REFUSED_WHERES: Array<[unknown, string, string]> = [
    [{ stage: { $null: 'x' } }, '$null', 'where.stage.$null'],
    [{ stage: { $exists: 'false' } }, '$exists', 'where.stage.$exists'],
    [{ stage: { $null: null } }, '$null', 'where.stage.$null'],
    [{ $not: { stage: { $null: 'true' } } }, '$null', 'where.$not.stage.$null'],
    [{ $or: [{ id: 'r1' }, { stage: { $exists: 0 } }] }, '$exists', 'where.$or[1].stage.$exists'],
  ];

  for (const [where, op, path] of REFUSED_WHERES) {
    for (const [face, run] of WHERE_FACES) {
      it(`${face}: ${JSON.stringify(where)} is refused 400, and nothing reaches the database or the engine`, async () => {
        scope = undefined;
        reset();
        expectFlagRefusal(await asyncRefusalOf(() => run(where)), op, 'stage', path);
        expect(statements).toEqual([]);
        expect(engineWheres).toEqual([]);
      });
    }
  }

  it('the draft preview answers the same filter with the same refusal, byte for byte', () => {
    for (const [where, op, path] of REFUSED_WHERES) {
      const preview = refusalOf(() => evaluateAnalyticsQueryOverRows(q(where), CUBE, ROWS.map((r) => ({ ...r }))));
      expectFlagRefusal(preview, op, 'stage', path);
      expect(preview.message).toBe(refusalOf(() => tree(where)).message);
    }
  });

  for (const [op, flag, family] of CONTROLS) {
    it(`CONTROL ${op}: ${flag} — the tree, both SQL statements and the engine where are unchanged, and the rows served`, async () => {
      scope = undefined;
      const shapes: Array<['top' | 'not' | 'notNe', unknown]> = [
        ['top', { stage: { [op]: flag } }],
        ['not', { $not: { stage: { [op]: flag } } }],
        ['notNe', { $not: { stage: { [op]: flag, $ne: 'lost' } } }],
      ];
      for (const [shape, where] of shapes) {
        const want = family[shape];
        expect(tree(where), `${shape}: tree`).toEqual(want.tree);
        reset();
        expect(await WHERE_FACES[0][1](where), `${shape}: native rows`).toEqual(want.rows);
        expect(statements, `${shape}: native SQL`).toEqual([{ sql: want.sql, params: want.params }]);
        const echo = await new ObjectQLStrategy().generateSql(q(where), ctxFor(false));
        expect(echo, `${shape}: echo SQL`).toEqual({ sql: want.sql, params: want.params });
        reset();
        expect(await WHERE_FACES[2][1](where), `${shape}: engine rows`).toEqual(want.rows);
        expect(engineWheres, `${shape}: engine where`).toEqual([want.engine]);
      }
    });
  }

  // ── The read scope keeps its own answer (another door; not moved) ────────

  const SCOPE_FACES: Array<[string, () => Promise<string[]>]> = [
    ['native execute (applyReadScope)', async () => ids((await new NativeSQLStrategy().execute(q(), ctxFor(true))).rows)],
    ['/analytics/sql echo', async () => {
      const { sql, params } = await new ObjectQLStrategy().generateSql(q(), ctxFor(false));
      return ids(await runRawSql(sql, params));
    }],
    ['AnalyticsService.query (native)', async () => ids((await service(true).query(q())).rows as never)],
  ];

  it('a read scope carrying a non-boolean flag is refused in the read-scope envelope, withheld, as before', async () => {
    for (const scopeFilter of [{ stage: { $null: 'SCOPE_SECRET' } }, { stage: { $exists: 'SCOPE_SECRET' } }]) {
      scope = scopeFilter;
      for (const [face, run] of SCOPE_FACES) {
        reset();
        const err = await asyncRefusalOf(run);
        expect(err.code, face).toBe('READ_SCOPE_COMPILE_FAILED');
        expect(err.status, face).toBe(500);
        expect(serverFaultProvenance(resolveThrownHttpError(err, 500)), face).toBe('declared');
        expect(declaredRefusalMessage(err), face).toBeUndefined();
        // The operator's log carries the read-scope compiler's own sentence, not this door's.
        expect(err.message, face).toContain('[read-scope-sql]');
        expect(err.message, face).not.toContain('requires a boolean comparand');
        expect(statements, face).toEqual([]);
      }
    }
    scope = undefined;
  });

  it('…and on the ObjectQL face the driver answers it, with the policy content withheld, as before', async () => {
    scope = { stage: { $null: 'SCOPE_SECRET' } };
    reset();
    const err = await asyncRefusalOf(() => WHERE_FACES[2][1](undefined));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).not.toContain('SCOPE_SECRET');
    expect(err.message).not.toContain('requires a boolean comparand (true or false). Received');
    scope = undefined;
  });

  it('compileScopedFilterToSql, the public export, keeps its own refusal', () => {
    const err = refusalOf(() => compileScopedFilterToSql({ stage: { $null: 'x' } } as never, OBJECT, {}));
    expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err.status).toBe(500);
    expect(err.message).toContain('[read-scope-sql] comparand for "$null"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20040] a STORED dataset carrying a non-boolean flag is refused on the service doors', () => {
  const BASE = DatasetSchema.parse({
    name: 'deal_metrics',
    label: 'Deal Metrics',
    object: OBJECT,
    dimensions: [{ name: 'stage', label: 'Stage', field: 'stage', type: 'string' }],
    measures: [{ name: 'deal_count', label: 'Deals', aggregate: 'count' }],
  }) as Dataset;
  const withScope = (filter: unknown): Dataset => ({ ...BASE, filter } as Dataset);
  const withMeasureFilter = (filter: unknown): Dataset =>
    ({ ...BASE, measures: [{ ...BASE.measures[0], filter }] } as Dataset);

  function svc() {
    const calls = { aggregate: 0, raw: 0 };
    const s = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => {
        calls.raw++;
        return [];
      },
      executeAggregate: async () => {
        calls.aggregate++;
        return [];
      },
    });
    return { s, calls };
  }

  for (const [label, dataset] of [
    ['the dataset scope filter', withScope({ stage: { $null: 'x' } })],
    ['a measure filter', withMeasureFilter({ stage: { $exists: 'false' } })],
  ] as const) {
    it(`queryDataset: ${label} → INVALID_FILTER / 400, no statement`, async () => {
      const { s, calls } = svc();
      const err = await asyncRefusalOf(() => s.queryDataset!(dataset, { measures: ['deal_count'], dimensions: ['stage'] }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('requires a boolean comparand');
      expect(calls.raw).toBe(0);
      expect(calls.aggregate).toBe(0);
    });
  }
});
