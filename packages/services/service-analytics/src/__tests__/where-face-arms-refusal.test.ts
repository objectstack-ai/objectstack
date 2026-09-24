// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20010] The analytics `where` door runs EVERY arm of the shared
 * comparand-shape face on the object spelling, not only the equality arm.
 *
 * `assertListComparandShapes` (`@objectstack/spec/data`) is "the one place that
 * decides whether `$in` / `$nin` / `$between` received a list at all, for every
 * driver", and it carries the carve-outs ruled onto that door:
 *
 * - 2026-08-31 (#13357): "A `null` member of `$in` / `$nin`, and a `null`
 *   `$between` endpoint (#13495's shape), are refused at this door";
 * - 2026-09-01 (#14080): "A `null` comparand of `$gt` / `$gte` / `$lt` /
 *   `$lte` … refused at this door, same envelope, so the divergent cells are
 *   constructively unreachable";
 * - 2026-09-20 (#19071): "`''` and `undefined` are refused, naming the blank
 *   side (MIN / MAX and the index)".
 *
 * This door met the face for the `FilterArray` spelling only (inside
 * `parseFilterAST`), and PR #20008 carried the equality arm alone to the object
 * spelling. Measured over a real engine before this change (recorded on the
 * branch, `a508dddc2c`), the object spelling of each arm compiled while its
 * `FilterArray` spelling was refused `INVALID_FILTER` / 400:
 *
 *   | object `where`                        | before                                         |
 *   |---|---|
 *   | `{ stage: { $in: ['won', null] } }`   | `stage IN ('won', NULL)`: d1; the draft preview served d1, d4 |
 *   | `{ stage: { $nin: ['won', null] } }`  | `stage IS NULL OR stage NOT IN (…)`: d4 only    |
 *   | `{ amt: { $lt: null } }`              | `amt < NULL`: no row; the draft preview served d1, d2, d3, d5 |
 *   | `{ amt: { $between: [null, 5] } }`    | `amt >= NULL AND amt <= 5`; the engine path refused it as `$gte` |
 *   | `{ amt: { $between: ['', 5] } }`      | `amt >= '' AND amt <= 5`; the engine path ACCEPTED it |
 *   | `{ stage: { $in: 'won' } }`           | laundered to `stage IN ('won')`: d1          |
 *   | `{ stage: { $nin: 'won' } }`          | laundered to a list: d2, d3, d4, d5          |
 *
 * Seven blocks: every arm refused at every depth; one condition, one wording
 * (object spelling = `FilterArray` spelling = the face, byte for byte); what
 * is diagnosed first; the arm this card does NOT move (`$ne`, waiting on
 * #19886) held to the face's own answer; the neighbouring shapes that compile
 * exactly as before; the four faces over a real engine; a stored dataset
 * through the service doors.
 *
 * Every refusal asserts the ADR-0112 envelope (`code` + `status`); a bare
 * `toThrow()` would be satisfied by any uncoded error.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { assertListComparandShapes, type Cube } from '@objectstack/spec/data';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';
import { AnalyticsService } from '../analytics-service.js';

interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

const tree = (where: unknown) => normalizeAnalyticsFilterTree({ where } as never);

function refusalOf(run: () => unknown): Refusal {
  let out: unknown;
  try {
    out = run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, but it answered ${JSON.stringify(out)}`);
}

function expectEnvelope(err: Refusal): void {
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
}

/** The face's own refusal of `node`, read straight from `@objectstack/spec`. */
function faceSays(node: unknown): string {
  return refusalOf(() => assertListComparandShapes(node)).message;
}

/** The face's opening sentence for each arm. */
const NULL_MEMBER = (op: string, f: string) => `Operator "${op}" on field "${f}" does not accept null as a list member`;
const NULL_ORDERING = (op: string, f: string) => `Operator "${op}" on field "${f}" does not accept a null comparand`;
const NULL_BOUND = (f: string) => `Operator "$between" on field "${f}" requires two non-null bounds`;
const BLANK_BOUND = (f: string) => `Operator "$between" on field "${f}" requires two non-blank bounds`;
const NON_LIST = (op: string, f: string) => `Operator "${op}" on field "${f}" requires an ARRAY of values`;
const MALFORMED_RANGE = (f: string) => `Operator "$between" on field "${f}" requires a [min, max] value array`;
const FIELD_BOUND = (f: string) => `Operator "$between" on field "${f}" does not accept a { "$field": … } reference as an endpoint`;

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20010] every arm of the shared comparand-shape face refuses the object spelling', () => {
  const CASES: Array<[string, unknown, string, string]> = [
    // 2026-08-31 — a null list member.
    ['a null $in member', { stage: { $in: ['won', null] } }, NULL_MEMBER('$in', 'stage'), 'where.stage.$in[1]'],
    ['$in: [null]', { stage: { $in: [null] } }, NULL_MEMBER('$in', 'stage'), 'where.stage.$in[0]'],
    ['a null $nin member', { stage: { $nin: ['won', null] } }, NULL_MEMBER('$nin', 'stage'), 'where.stage.$nin[1]'],
    // 2026-09-01 — a null ordering comparand, all four slots.
    ['$gt: null', { amt: { $gt: null } }, NULL_ORDERING('$gt', 'amt'), 'where.amt.$gt'],
    ['$gte: null', { amt: { $gte: null } }, NULL_ORDERING('$gte', 'amt'), 'where.amt.$gte'],
    ['$lt: null', { amt: { $lt: null } }, NULL_ORDERING('$lt', 'amt'), 'where.amt.$lt'],
    ['$lte: null', { amt: { $lte: null } }, NULL_ORDERING('$lte', 'amt'), 'where.amt.$lte'],
    // 2026-08-31 — a null $between endpoint, either side.
    ['a null $between MIN', { amt: { $between: [null, 5] } }, NULL_BOUND('amt'), 'where.amt.$between[0]'],
    ['a null $between MAX', { amt: { $between: [1, null] } }, NULL_BOUND('amt'), 'where.amt.$between[1]'],
    // 2026-09-20 — a blank $between endpoint: the empty string and undefined.
    ['an empty-string $between MIN', { amt: { $between: ['', 5] } }, BLANK_BOUND('amt'), 'where.amt.$between[0]'],
    ['an empty-string $between MAX', { amt: { $between: [1, ''] } }, BLANK_BOUND('amt'), 'where.amt.$between[1]'],
    ['an undefined $between MIN', { amt: { $between: [undefined, 5] } }, BLANK_BOUND('amt'), 'where.amt.$between[0]'],
    // #5869's rule, on the face since #9228 — a list operator given no list.
    ['a scalar $in', { stage: { $in: 'won' } }, NON_LIST('$in', 'stage'), 'where.stage.$in'],
    ['a scalar $nin', { stage: { $nin: 'won' } }, NON_LIST('$nin', 'stage'), 'where.stage.$nin'],
    ['$in: null', { stage: { $in: null } }, NON_LIST('$in', 'stage'), 'where.stage.$in'],
    ['a one-bound $between', { amt: { $between: [1] } }, MALFORMED_RANGE('amt'), 'where.amt.$between'],
    ['a scalar $between', { amt: { $between: 5 } }, MALFORMED_RANGE('amt'), 'where.amt.$between'],
    // 2026-08-11 (#7596), on the face since #19377 — a { $field } endpoint.
    ['a { $field } $between endpoint', { amt: { $between: [{ $field: 'id' }, 5] } }, FIELD_BOUND('amt'), 'where.amt.$between[0]'],
    // Depth: the face's own traversal.
    ['under $and', { $and: [{ id: 'd3' }, { amt: { $gt: null } }] }, NULL_ORDERING('$gt', 'amt'), 'where.$and[1].amt.$gt'],
    ['under $or', { $or: [{ id: 'd3' }, { stage: { $in: ['won', null] } }] }, NULL_MEMBER('$in', 'stage'), 'where.$or[1].stage.$in[1]'],
    ['under $not', { $not: { amt: { $lt: null } } }, NULL_ORDERING('$lt', 'amt'), 'where.$not.amt.$lt'],
    ['under $not over $or', { $not: { $or: [{ id: 'd3' }, { stage: { $nin: 'won' } }] } }, NON_LIST('$nin', 'stage'), 'where.$not.$or[1].stage.$nin'],
    ['beside a legal operator', { amt: { $gte: 1, $lte: null } }, NULL_ORDERING('$lte', 'amt'), 'where.amt.$lte'],
    // One step past the face: a nested relation compiles to its dotted member.
    ['inside a nested relation', { acct: { amt: { $gt: null } } }, NULL_ORDERING('$gt', 'amt'), 'where.acct.amt.$gt'],
    ['a dotted member', { 'acct.amt': { $between: ['', 5] } }, BLANK_BOUND('acct.amt'), 'where.acct.amt.$between[0]'],
  ];

  for (const [name, where, opening, path] of CASES) {
    it(`${name}: INVALID_FILTER / 400, the face's refusal at ${path}`, () => {
      const err = refusalOf(() => tree(where));
      expectEnvelope(err);
      expect(err.message.startsWith(opening)).toBe(true);
      expect(err.message).toContain(`${path}`);
      // The face's closing sentence: the query did not run.
      expect(err.message).toContain('The filter was NOT applied');
    });
  }
});

describe('[#20010] one condition, one wording — the object spelling, the FilterArray spelling and the face agree byte for byte', () => {
  const PAIRS: Array<[string, unknown, unknown]> = [
    ['a null $in member', { stage: { $in: ['won', null] } }, ['stage', 'in', ['won', null]]],
    ['a null $nin member', { stage: { $nin: ['won', null] } }, ['stage', 'not_in', ['won', null]]],
    ['$gt: null', { amt: { $gt: null } }, ['amt', '>', null]],
    ['$gte: null', { amt: { $gte: null } }, ['amt', '>=', null]],
    ['$lt: null', { amt: { $lt: null } }, ['amt', 'before', null]],
    ['$lte: null', { amt: { $lte: null } }, ['amt', '<=', null]],
    ['a null $between endpoint', { amt: { $between: [null, 5] } }, ['amt', 'between', [null, 5]]],
    ['an empty-string $between endpoint', { amt: { $between: ['', 5] } }, ['amt', 'between', ['', 5]]],
    ['an undefined $between endpoint', { amt: { $between: [undefined, 5] } }, ['amt', 'between', [undefined, 5]]],
    ['a { $field } $between endpoint', { amt: { $between: [1, { $field: 'id' }] } }, ['amt', 'between', [1, { $field: 'id' }]]],
    ['a one-bound $between', { amt: { $between: [1] } }, ['amt', 'between', [1]]],
    ['a scalar $in', { stage: { $in: 'won' } }, ['stage', 'in', 'won']],
    ['a scalar $nin', { stage: { $nin: 'won' } }, ['stage', 'nin', 'won']],
    ['under $and', { $and: [{ id: 'd3' }, { amt: { $gt: null } }] }, ['and', ['id', '=', 'd3'], ['amt', '>', null]]],
    ['under $or', { $or: [{ id: 'd3' }, { stage: { $in: ['won', null] } }] }, ['or', ['id', '=', 'd3'], ['stage', 'in', ['won', null]]]],
    ['a dotted member', { 'acct.amt': { $gt: null } }, ['acct.amt', '>', null]],
  ];

  for (const [name, object, array] of PAIRS) {
    it(name, () => {
      const face = faceSays(object);
      const objectErr = refusalOf(() => tree(object));
      const arrayErr = refusalOf(() => tree(array));
      expectEnvelope(objectErr);
      expectEnvelope(arrayErr);
      expect(objectErr.message).toBe(face);
      expect(arrayErr.message).toBe(face);
    });
  }

  it('the explicit `$not` spelling reads as the face reads it', () => {
    const where = { $not: { amt: { $between: [null, 5] } } };
    expect(refusalOf(() => tree(where)).message).toBe(faceSays(where));
  });
});

describe('[#20010] what is diagnosed first', () => {
  const IMPLICIT = (f: string) => `The implicit-equality comparand on field "${f}" requires a single comparable value`;

  it('the equality-slot list first, as #19888 ordered it — even when another refused entry comes earlier', () => {
    const err = refusalOf(() => tree({ stage: { $in: ['won', null] }, id: ['d1', 'd2'] }));
    expectEnvelope(err);
    expect(err.message.startsWith(IMPLICIT('id'))).toBe(true);
  });

  it('then the face, before this door\'s own member gates (#6386 undefined, #6444 mixed wrapper, #5240 empty wrapper)', () => {
    // A null member beside an undefined one: the face's sentence, not #6386's.
    const a = refusalOf(() => tree({ stage: { $in: [null, undefined] } }));
    expect(a.message.startsWith(NULL_MEMBER('$in', 'stage'))).toBe(true);
    expect(a.message).not.toContain('is undefined');
    // A null ordering comparand beside a non-$ sibling: the face's, not #6444's.
    const b = refusalOf(() => tree({ amt: { $gt: null, nested: 'x' } }));
    expect(b.message.startsWith(NULL_ORDERING('$gt', 'amt'))).toBe(true);
    expect(b.message).not.toContain('mixes $-operator keys');
  });

  it('CONTROL: an `undefined` outside a `$between` endpoint keeps #6386\'s own sentence — the TYPE face is not run here', () => {
    for (const [where, path] of [
      [{ amt: { $gt: undefined } }, '"amt".$gt'],
      [{ stage: { $in: [undefined] } }, '"stage".$in[0]'],
      [{ stage: undefined }, '"stage"'],
    ] as const) {
      const err = refusalOf(() => tree(where));
      expectEnvelope(err);
      expect(err.message).toContain(`comparand at ${path} is undefined`);
    }
  });
});

describe('[#20010] `$ne` with a list is the face\'s to judge, and this door answers what the face answers', () => {
  // #19886 stage 2 puts the `$ne` refusal on the shared face. Until then the
  // face accepts it and this card does not move it; the day the face refuses
  // it, this door refuses it too, with no change here. Held as PARITY with the
  // face so the test does not pin the #19886 defect in either direction.
  for (const where of [
    { stage: { $ne: ['won', 'lost'] } },
    { $not: { stage: { $ne: ['won'] } } },
  ]) {
    it(JSON.stringify(where), () => {
      let face: string | undefined;
      try {
        assertListComparandShapes(where);
      } catch (e) {
        face = (e as Error).message;
      }
      let door: string | undefined;
      try {
        tree(where);
      } catch (e) {
        door = (e as Error).message;
      }
      expect(door).toBe(face);
    });
  }
});

describe('[#20010] the neighbouring shapes compile exactly as before', () => {
  const leaf = (member: string, operator: string, values: unknown[]) => ({ kind: 'leaf', member, operator, values });
  const ACCEPTED: Array<[string, unknown, unknown]> = [
    ['a list under $in', { stage: { $in: ['won', 'lost'] } }, leaf('stage', 'in', ['won', 'lost'])],
    ['falsy $in members are values, not blanks', { stage: { $in: [0, '', false] } }, leaf('stage', 'in', [0, '', false])],
    ['the empty $in — the FALSE constant', { stage: { $in: [] } }, { kind: 'const', value: false }],
    ['the empty $nin — the TRUE constant', { stage: { $nin: [] } }, { kind: 'const', value: true }],
    ['a scalar ordering comparand', { amt: { $gt: 5 } }, leaf('amt', 'gt', [5])],
    ['a { $field } in an ordering slot (served on the engine path)', { amt: { $gt: { $field: 'id' } } }, leaf('amt', 'gt', [{ $field: 'id' }])],
    ['the implicit null — the has-no-value predicate', { stage: null }, leaf('stage', 'notSet', [])],
    ['$eq: null — the same predicate', { stage: { $eq: null } }, leaf('stage', 'notSet', [])],
    ['$ne: null — has a value', { stage: { $ne: null } }, leaf('stage', 'set', [])],
    ["$contains: null — LIKE '%null%' (#5526)", { stage: { $contains: null } }, leaf('stage', 'contains', [null])],
    ['a nested-relation scalar', { acct: { amt: 5 } }, leaf('acct.amt', 'equals', [5])],
  ];

  for (const [name, where, expected] of ACCEPTED) {
    it(name, () => {
      expect(tree(where)).toEqual(expected);
    });
  }

  const between = (lo: unknown, hi: unknown) => ({
    kind: 'and',
    children: [leaf('amt', 'gte', [lo]), leaf('amt', 'lte', [hi])],
  });

  for (const [name, bounds] of [
    ['numbers', [1, 5]],
    ['zero to zero — falsy endpoints are endpoints', [0, 0]],
    ["ISO strings ('0' / '9' are values)", ['0', '9']],
    // The face does not trim: a whitespace-only endpoint passes the schema door
    // too (the 2026-09-20 ruling's own scope).
    ['a whitespace-only endpoint', [' ', 'M']],
  ] as const) {
    it(`$between keeps its two bounds: ${name}`, () => {
      expect(tree({ amt: { $between: bounds } })).toEqual(between(bounds[0], bounds[1]));
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const OBJECT = 'deal';
const ROWS = [
  { id: 'd1', amt: 1, stage: 'won' },
  { id: 'd2', amt: 5, stage: 'lost' },
  { id: 'd3', amt: 10, stage: 'open' },
  { id: 'd4', amt: null, stage: null },
  { id: 'd5', amt: 3, stage: '' },
];
const CUBE: Cube = {
  name: 'deals',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    [['id', 'string'], ['amt', 'number'], ['stage', 'string']].map(([n, t]) => [n, { name: n, label: n, type: t, sql: n }]),
  ),
  public: false,
} as unknown as Cube;

describe('[#20010] every analytics face refuses before anything runs (real engine)', () => {
  let driver: SqliteWasmDriver;
  let statements = 0;
  let aggregates = 0;

  const runRawSql = async (sql: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
    statements++;
    const result = await driver.execute(sql.replace(/\$\d+/g, '?'), params);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
      return (result as { rows: Record<string, unknown>[] }).rows;
    }
    return [];
  };

  const ctxFor = (nativeSql: boolean): StrategyContext =>
    ({
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql, objectqlAggregate: !nativeSql, inMemory: false }),
      getReadScope: () => undefined,
      executeRawSql: (_object: string, sql: string, params: unknown[]) => runRawSql(sql, params),
      // The engine path: a probe `engine.aggregate` that serves the rows its
      // `$in` filter names, so the CONTROL below is a real answer.
      executeAggregate: async (_object: string, opts: { filter?: Record<string, unknown> }) => {
        aggregates++;
        const f = opts.filter ?? {};
        const inList = (f.stage as { $in?: unknown[] } | undefined)?.$in;
        return ROWS.filter((r) => (inList ? inList.includes(r.stage) : true)).map((r) => ({ id: r.id, n: 1 }));
      },
      sqlDialect: () => 'sqlite',
    }) as unknown as StrategyContext;

  const q = (where: unknown) => ({ cube: 'deals', dimensions: ['id'], measures: ['n'], where }) as unknown as AnalyticsQuery;
  const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();

  const FACES: Array<[string, (where: unknown) => Promise<string[]>]> = [
    ['native execute', async (where) => ids((await new NativeSQLStrategy().execute(q(where), ctxFor(true))).rows)],
    ['/analytics/sql echo', async (where) => {
      const { sql, params } = await new ObjectQLStrategy().generateSql(q(where), ctxFor(false));
      return ids(await runRawSql(sql, params));
    }],
    ['ObjectQL engine path', async (where) => ids((await new ObjectQLStrategy().execute(q(where), ctxFor(false))).rows)],
    ['draft preview', async (where) => ids(evaluateAnalyticsQueryOverRows(q(where), CUBE, ROWS.map((r) => ({ ...r }))).rows)],
  ];

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      {
        name: OBJECT,
        fields: {
          id: { type: 'text', name: 'id' },
          amt: { type: 'number', name: 'amt' },
          stage: { type: 'text', name: 'stage' },
        },
      } as never,
    ]);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('CONTROL: no where serves every row, and a legal $in serves exactly the named rows', async () => {
    // Without this, the refusals below could pass on a harness that serves nothing.
    for (const [face, run] of FACES) {
      expect(await run(undefined), `${face}: no where`).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
      expect(await run({ stage: { $in: ['won', 'lost'] } }), `${face}: $in`).toEqual(['d1', 'd2']);
    }
  });

  for (const [name, where, opening] of [
    ['a null $in member', { stage: { $in: ['won', null] } }, NULL_MEMBER('$in', 'stage')],
    ['a null $nin member', { stage: { $nin: ['won', null] } }, NULL_MEMBER('$nin', 'stage')],
    ['$gt: null', { amt: { $gt: null } }, NULL_ORDERING('$gt', 'amt')],
    ['$lt: null', { amt: { $lt: null } }, NULL_ORDERING('$lt', 'amt')],
    ['a null $between endpoint', { amt: { $between: [null, 5] } }, NULL_BOUND('amt')],
    ['an empty-string $between endpoint', { amt: { $between: ['', 5] } }, BLANK_BOUND('amt')],
    ['a scalar $in', { stage: { $in: 'won' } }, NON_LIST('$in', 'stage')],
    ['a scalar $nin', { stage: { $nin: 'won' } }, NON_LIST('$nin', 'stage')],
  ] as const) {
    for (const [face, run] of FACES) {
      it(`${face}: ${name} is refused, and nothing reaches the engine`, async () => {
        statements = 0;
        aggregates = 0;
        let err: Refusal | undefined;
        let served: string[] | undefined;
        try {
          served = await run(where);
        } catch (e) {
          err = e as Refusal;
        }
        expect(served, `${face}: expected a refusal, got rows`).toBeUndefined();
        expectEnvelope(err as Refusal);
        expect((err as Refusal).message.startsWith(opening)).toBe(true);
        expect(statements).toBe(0);
        expect(aggregates).toBe(0);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20010] a STORED dataset carrying one of the shapes is refused on every service door', () => {
  // Built without the shape and then given it, so this file pins the RUNTIME
  // answer and not whether the authoring schema admits the shape.
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

  function service(preview: boolean) {
    const calls = { aggregate: 0, raw: 0 };
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => {
        calls.aggregate++;
        return [{ stage: 'won', deal_count: 1 }];
      },
      executeRawSql: async () => {
        calls.raw++;
        return [];
      },
      ...(preview ? { draftRowsResolver: async () => ROWS.map((r) => ({ ...r })) } : {}),
    });
    return { svc, calls };
  }

  const DOORS: Array<[string, (ds: Dataset) => Promise<unknown>]> = [
    ['queryDataset (the dashboard door)', (ds) => service(false).svc.queryDataset!(ds, { measures: ['deal_count'], dimensions: ['stage'] })],
    ['queryDataset over a pending seed draft (the draft preview)', (ds) => service(true).svc.queryDataset!(ds, { measures: ['deal_count'], dimensions: ['stage'] }, undefined, { previewDrafts: true })],
  ];

  const STORED: Array<[string, (f: unknown) => Dataset, unknown, string]> = [
    ['the dataset scope filter, a null $in member', withScope, { stage: { $in: ['won', null] } }, NULL_MEMBER('$in', 'stage')],
    ['a measure filter, a scalar $nin', withMeasureFilter, { stage: { $nin: 'lost' } }, NON_LIST('$nin', 'stage')],
  ];

  for (const [label, filterOf, where, opening] of STORED) {
    for (const [door, run] of DOORS) {
      it(`${door}: ${label} → INVALID_FILTER / 400`, async () => {
        let err: Refusal | undefined;
        try {
          await run(filterOf(where));
        } catch (e) {
          err = e as Refusal;
        }
        expectEnvelope(err as Refusal);
        expect((err as Refusal).message.startsWith(opening)).toBe(true);
      });
    }
  }

  it('the registered cube on the ObjectQL door refuses before engine.aggregate runs', async () => {
    const { svc, calls } = service(false);
    svc.registerDataset(withScope({ stage: { $in: ['won', null] } }));
    let err: Refusal | undefined;
    try {
      await svc.query({ cube: 'deal_metrics', measures: ['deal_count'] } as AnalyticsQuery);
    } catch (e) {
      err = e as Refusal;
    }
    expectEnvelope(err as Refusal);
    expect(calls.aggregate).toBe(0);
  });

  it('CONTROL: the same dataset with the prescribed spelling answers on the dashboard door', async () => {
    // The face's own prescription for "one of […] OR has no value".
    const { svc, calls } = service(false);
    const result = (await svc.queryDataset!(
      withScope({ $or: [{ stage: { $in: ['won'] } }, { stage: { $null: true } }] }),
      { measures: ['deal_count'], dimensions: ['stage'] },
    )) as { rows: unknown[] };
    expect(result.rows.length).toBeGreaterThan(0);
    expect(calls.aggregate).toBeGreaterThan(0);
  });
});
