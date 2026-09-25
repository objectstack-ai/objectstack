// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20098] The ObjectQL strategy serves `$icontains`: it hands the engine the
 * canonical `$icontains`, and the engine and driver apply the ASCII-only fold.
 *
 * `ObjectQLStrategy.convertFilter` translates each normalized leaf into the
 * operand the engine's `FilterCondition` expects. The normalizer emits an
 * `icontains` leaf for `$icontains` (and for the `FilterArray` `icontains`,
 * lowered to `$icontains` first), and `convertFilter` had no arm for it. Every
 * `$icontains` fell to the catch-all. Measured at base `7c1039b388` over a real
 * `ObjectQL` engine and a real `SqliteWasmDriver`, with the rows below:
 *
 *   | cell | engine direct | ObjectQL execute / service | native execute, echo |
 *   |---|---|---|---|
 *   | `$icontains: 'acme'` | a1 a2 | bare `Error`, no `code`, no `status` | a1 a2 |
 *   | `$icontains: 'CAFÉ'` | a6 | bare `Error` | a6 |
 *   | `$not` over `$icontains: 'acme'` | a3 a4 a5 a6 a7 | bare `Error` | a3 a4 a5 a6 a7 |
 *   | `FilterArray` `['name','icontains','acme']` | a1 a2 | bare `Error` | a1 a2 |
 *
 * Through `POST /api/v1/analytics/query` with an ObjectQL-served datasource the
 * valid `'acme'` answered `500 INTERNAL_ERROR`, and `engine.aggregate` was never
 * called.
 *
 * The arm now passes the operator through in the shape its four text siblings
 * use. ⛔ It does not fold, and it does not use `$regex` (#5557). The fold
 * belongs to the engine and the driver, as on every other face. So this file
 * asserts ROW IDS on every face against the engine answering the same filter
 * directly. The `'CAFÉ'` / `'café'` pair is the #4706 Q1 = A boundary: a local
 * fold that lower-cases the comparand would answer `'café'` for `'CAFÉ'`, which
 * the contract excludes.
 *
 * The empty and non-string comparands PR #20096 refuses stay refused before
 * this arm is reached. Their pins live in
 * `icontains-text-comparand-refusal.test.ts` and are unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQL } from '@objectstack/objectql';
import { FILTER_OPERATORS, LOGICAL_OPERATORS, type Cube, type FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { collectFilterLeaves, normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import type { DatasetScope } from '../strategies/types.js';
import { AnalyticsService } from '../analytics-service.js';

const OBJECT = 'acct';
/**
 * The #20068 rows, plus the non-ASCII pair the ASCII-only boundary turns on:
 * `a6` / `a7` differ ONLY in the case of a letter the fold must not touch.
 */
const ROWS = [
  { id: 'a1', name: 'Acme Corp', amt: 1 },
  { id: 'a2', name: 'ACME ltd', amt: 5 },
  { id: 'a3', name: 'beta', amt: 10 },
  { id: 'a4', name: null, amt: null },
  { id: 'a5', name: '', amt: 3 },
  { id: 'a6', name: 'CAFÉ', amt: 7 },
  { id: 'a7', name: 'café', amt: 9 },
];
const FIELDS: Record<string, { type: string; name: string }> = {
  id: { type: 'text', name: 'id' },
  name: { type: 'text', name: 'name' },
  amt: { type: 'number', name: 'amt' },
};
const CUBE: Cube = {
  name: 'accts',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    [['id', 'string'], ['name', 'string'], ['amt', 'number']].map(([n, t]) => [n, { name: n, label: n, type: t, sql: n }]),
  ),
  public: false,
} as unknown as Cube;
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } } as never;

const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();

describe('[#20098] `$icontains` on the ObjectQL strategy, over a real engine', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  /** Every `filter` the strategy handed `engine.aggregate`, in call order. */
  let engineFilters: unknown[] = [];
  let datasetScope: DatasetScope | undefined;

  const runRawSql = async (sql: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
    const result = await driver.execute(sql.replace(/\$\d+/g, '?'), params);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
      return (result as { rows: Record<string, unknown>[] }).rows;
    }
    return [];
  };
  const executeAggregate = async (objectName: string, options: Record<string, any>) => {
    engineFilters.push(options.filter);
    return (await engine.aggregate(objectName, {
      where: options.filter,
      groupBy: options.groupBy,
      aggregations: options.aggregations?.map((a: any) => ({
        function: a.method, field: a.field, alias: a.alias, ...(a.filter ? { filter: a.filter } : {}),
      })),
      context: options.context,
    } as never)) as Record<string, unknown>[];
  };
  const ctxFor = (nativeSql: boolean): StrategyContext =>
    ({
      getCube: (name: string) => (name === 'accts' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql, objectqlAggregate: !nativeSql, inMemory: false }),
      executeRawSql: (_object: string, sql: string, params: unknown[]) => runRawSql(sql, params),
      executeAggregate,
      getDatasetScope: () => datasetScope,
      declaredFieldType: (_object: string, field: string) => FIELDS[field]?.type,
      sqlDialect: () => 'sqlite',
    }) as unknown as StrategyContext;
  const service = (nativeSql: boolean) =>
    new AnalyticsService({
      cubes: [CUBE],
      logger: quiet,
      queryCapabilities: () => ({ nativeSql, objectqlAggregate: !nativeSql, inMemory: false }),
      executeRawSql: (_object: string, sql: string, params: unknown[]) => runRawSql(sql, params),
      executeAggregate: executeAggregate as never,
      sqlDialect: () => 'sqlite',
    });
  const q = (where?: unknown, extra: Partial<AnalyticsQuery> = {}) =>
    ({
      cube: 'accts', dimensions: ['id'], measures: ['n'],
      ...(where === undefined ? {} : { where }),
      ...extra,
    }) as unknown as AnalyticsQuery;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    await driver.initObjects([{ name: OBJECT, fields: FIELDS } as never]);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
    engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: OBJECT, label: 'Acct', fields: FIELDS } as never);
  });
  afterAll(async () => {
    await driver?.disconnect?.();
  });

  /**
   * The engine answering the filter itself: the reference every analytics face
   * must agree with. A `FilterArray` case is referenced by the object spelling
   * `parseFilterAST` lowers it to.
   */
  const engineIds = async (where: unknown) => ids((await engine.find(OBJECT, { where } as never)) as never);

  const FACES: Array<[string, (where: unknown) => Promise<string[]>]> = [
    ['ObjectQLStrategy.execute', async (w) => ids((await new ObjectQLStrategy().execute(q(w), ctxFor(false))).rows)],
    ['AnalyticsService.query (ObjectQL)', async (w) => ids((await service(false).query(q(w))).rows as never)],
    ['native execute', async (w) => ids((await new NativeSQLStrategy().execute(q(w), ctxFor(true))).rows)],
    ['AnalyticsService.query (native)', async (w) => ids((await service(true).query(q(w))).rows as never)],
  ];

  const CASES: Array<{ name: string; where: unknown; reference: FilterCondition; expected: string[] }> = [
    {
      name: "'acme' — the fold runs on the COLUMN",
      where: { name: { $icontains: 'acme' } },
      reference: { name: { $icontains: 'acme' } },
      expected: ['a1', 'a2'],
    },
    {
      name: "'ACME' — and on the comparand",
      where: { name: { $icontains: 'ACME' } },
      reference: { name: { $icontains: 'ACME' } },
      expected: ['a1', 'a2'],
    },
    {
      name: "'CAFÉ' — ASCII-only (#4706 Q1 = A): É is not folded, so 'café' is NOT matched",
      where: { name: { $icontains: 'CAFÉ' } },
      reference: { name: { $icontains: 'CAFÉ' } },
      expected: ['a6'],
    },
    {
      name: "'café' — the mirror: 'CAFÉ' is NOT matched",
      where: { name: { $icontains: 'café' } },
      reference: { name: { $icontains: 'café' } },
      expected: ['a7'],
    },
    {
      name: "$not over 'acme' — the matches are excluded, the NULL and '' rows kept",
      where: { $not: { name: { $icontains: 'acme' } } },
      reference: { $not: { name: { $icontains: 'acme' } } },
      expected: ['a3', 'a4', 'a5', 'a6', 'a7'],
    },
    {
      name: "the FilterArray spelling ['name', 'icontains', 'acme']",
      where: ['name', 'icontains', 'acme'],
      reference: { name: { $icontains: 'acme' } },
      expected: ['a1', 'a2'],
    },
  ];

  for (const c of CASES) {
    it(`${c.name}: every face answers the engine's own rows`, async () => {
      // The reference first, so a wrong expectation is caught against the
      // engine rather than written into every face below.
      expect(await engineIds(c.reference), 'engine.find').toEqual(c.expected);
      for (const [face, run] of FACES) {
        expect(await run(c.where), face).toEqual(c.expected);
      }
    });
  }

  it('the engine receives the canonical `$icontains` with the comparand VERBATIM — no local fold, no `$regex`', async () => {
    for (const comparand of ['acme', 'ACME', 'CAFÉ']) {
      engineFilters = [];
      await new ObjectQLStrategy().execute(q({ name: { $icontains: comparand } }), ctxFor(false));
      expect(engineFilters, comparand).toEqual([{ name: { $icontains: comparand } }]);
    }
  });

  it('a compiled dataset\'s scope and a measure filter reach the same arm', async () => {
    // Both are lowered by `filterNodeToCondition`, the path the `where` shares,
    // so neither needs an arm of its own — this pins that they serve too.
    datasetScope = { filter: { name: { $icontains: 'acme' } } };
    try {
      expect(ids((await new ObjectQLStrategy().execute(q(), ctxFor(false))).rows), 'dataset scope').toEqual(['a1', 'a2']);
      expect(ids((await new NativeSQLStrategy().execute(q(), ctxFor(true))).rows), 'dataset scope, native').toEqual(['a1', 'a2']);

      datasetScope = { measureFilters: { n: { name: { $icontains: 'ACME' } } } };
      const count = async (strategy: ObjectQLStrategy | NativeSQLStrategy, nativeSql: boolean) =>
        Number((await strategy.execute(q(undefined, { dimensions: [] }), ctxFor(nativeSql))).rows[0]?.n);
      expect(await count(new ObjectQLStrategy(), false), 'measure filter').toBe(2);
      expect(await count(new NativeSQLStrategy(), true), 'measure filter, native').toBe(2);
    } finally {
      datasetScope = undefined;
    }
  });

  // ── The vocabulary, derived rather than listed ─────────────────────────────

  /**
   * One sample per authorable operator, so the next operator the normalizer
   * learns without an arm here fails in this block rather than as a 500.
   */
  const SAMPLES: Record<string, FilterCondition> = {
    $eq: { name: { $eq: 'beta' } },
    $ne: { name: { $ne: 'beta' } },
    $gt: { amt: { $gt: 5 } },
    $gte: { amt: { $gte: 5 } },
    $lt: { amt: { $lt: 5 } },
    $lte: { amt: { $lte: 5 } },
    $in: { name: { $in: ['beta', 'café'] } },
    $nin: { name: { $nin: ['beta'] } },
    $between: { amt: { $between: [3, 7] } },
    $contains: { name: { $contains: 'cme' } },
    $notContains: { name: { $notContains: 'cme' } },
    $startsWith: { name: { $startsWith: 'A' } },
    $endsWith: { name: { $endsWith: 'ltd' } },
    $icontains: { name: { $icontains: 'acme' } },
    $null: { name: { $null: true } },
    $exists: { name: { $exists: true } },
  };

  it('the sample table covers every operator `FILTER_OPERATORS` declares', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...FILTER_OPERATORS].sort());
  });

  for (const op of FILTER_OPERATORS) {
    it(`${op}: the ObjectQL strategy answers the engine's rows, through canonical operators only`, async () => {
      const where = SAMPLES[op];
      const expected = await engineIds(where);
      // A non-trivial reference: neither every row (a dropped predicate) nor,
      // for these samples, no row at all.
      expect(expected.length, `${op} reference`).toBeGreaterThan(0);
      expect(expected.length, `${op} reference`).toBeLessThan(ROWS.length);
      engineFilters = [];
      expect(ids((await new ObjectQLStrategy().execute(q(where), ctxFor(false))).rows), op).toEqual(expected);
      expect(ids((await new NativeSQLStrategy().execute(q(where), ctxFor(true))).rows), `${op}, native`).toEqual(expected);
      // Every operator key the engine received is one the contract declares.
      const declared = new Set<string>([...FILTER_OPERATORS, ...LOGICAL_OPERATORS]);
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
          if (key.startsWith('$')) expect(declared.has(key), `${op} → engine received ${key}`).toBe(true);
          walk(value);
        }
      };
      walk(engineFilters);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20098] the catch-all is untouched', () => {
  /**
   * Reached through the private translator on purpose, as
   * `objectql-echo-operator-coverage.test.ts` reaches the echo's: the public
   * door refuses an operator outside the normalizer's table with a 400 before
   * a leaf exists, so an arrival here means the normalizer and this translator
   * drifted apart — the exact shape of #20098 — and the exit must stay loud.
   */
  const convert = (operator: string, values: unknown[]) =>
    (new ObjectQLStrategy() as unknown as { convertFilter(o: string, v: unknown[]): unknown }).convertFilter(operator, values);

  it('CONTROL: an operator the normalizer never emits still throws, naming it', () => {
    let thrown: unknown;
    try {
      convert('sortOf', ['w']);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('"sortOf"');
  });

  it('every leaf operator the normalizer emits for the declared vocabulary is translated, none thrown', () => {
    const emitted = new Set<string>();
    const samples: FilterCondition[] = [
      { f: { $eq: 1 } }, { f: { $ne: 1 } }, { f: { $gt: 1 } }, { f: { $gte: 1 } }, { f: { $lt: 1 } },
      { f: { $lte: 1 } }, { f: { $in: ['x'] } }, { f: { $nin: ['x'] } }, { f: { $between: [1, 2] } },
      { f: { $contains: 'x' } }, { f: { $notContains: 'x' } }, { f: { $startsWith: 'x' } },
      { f: { $endsWith: 'x' } }, { f: { $icontains: 'x' } }, { f: { $null: true } }, { f: { $null: false } },
      { f: { $exists: true } }, { f: { $exists: false } }, { f: null } as unknown as FilterCondition, { f: 'x' },
    ];
    for (const where of samples) {
      for (const leaf of collectFilterLeaves(normalizeAnalyticsFilterTree({ where } as never))) {
        emitted.add(leaf.operator);
        expect(() => convert(leaf.operator, leaf.values), `${JSON.stringify(where)} → ${leaf.operator}`).not.toThrow();
      }
    }
    expect(emitted.has('icontains')).toBe(true);
  });
});
