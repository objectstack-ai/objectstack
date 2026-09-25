// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19888] The analytics `where` door refuses a LIST in the equality slot, the
 * way the shared comparand-shape face does, on every analytics face.
 *
 * Ruling 乙 on #19757 (record 5793368540): 「an array in the implicit-equality
 * slot is refused at the shared face, for every driver at once」. This door met
 * that face only for the `FilterArray` spelling (inside `parseFilterAST`). The
 * object spelling went straight to the normalizer, which read it three ways —
 * measured on a real engine before the fix, and recorded on this branch:
 *
 *   | `where`                        | before                                   |
 *   |---|---|
 *   | `{ stage: ['won', 'lost'] }`   | `stage IN (won, lost)`; the engine path got `{ stage: { $in } }` |
 *   | `{ stage: { $eq: ['won', 'lost'] } }` | `stage = 'won'`, `'lost'` dropped in silence |
 *   | `{ stage: { $eq: [] } }`       | no predicate at all: EVERY row           |
 *   | `{ stage: [] }`                | the FALSE constant                       |
 *   | `['stage', '=', ['won', 'lost']]` | refused INVALID_FILTER / 400 (the face) |
 *
 * Now every row answers like the last one: `assertNoListInEqualitySlot` hands
 * each list to the face's equality arm in `lowerAnalyticsWhere`, and the draft
 * preview runs the same gate.
 *
 * Seven blocks: the `$eq` spelling at every depth; the implicit spelling at
 * every depth; one condition, one wording (the object spelling, the array
 * spelling and the face itself say the same bytes); a list is diagnosed as the
 * list; the neighbouring shapes that must compile exactly as before; the four
 * faces over a real engine; and a stored dataset through the service doors.
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

/** The face's two opening sentences — implicit and `$eq` — and its `$in` remedy. */
const IMPLICIT = (field: string) => `The implicit-equality comparand on field "${field}" requires a single comparable value`;
const EQ = (field: string) => `Operator "$eq" on field "${field}" requires a single comparable value`;
const REMEDY = 'For "one of these values" use {"$in": […]}';

// ─────────────────────────────────────────────────────────────────────────────

describe('[#19888] a list under $eq is refused, never compiled', () => {
  const CASES: Array<[string, unknown, string]> = [
    ['two members', { stage: { $eq: ['won', 'lost'] } }, 'where.stage.$eq'],
    ['one member', { stage: { $eq: ['won'] } }, 'where.stage.$eq'],
    // The widening direction: this compiled to NO predicate — every row.
    ['the empty list', { stage: { $eq: [] } }, 'where.stage.$eq'],
    ['beside another operator, listed first', { stage: { $eq: ['won'], $ne: 'open' } }, 'where.stage.$eq'],
    ['beside another operator, listed last', { stage: { $ne: 'open', $eq: ['won'] } }, 'where.stage.$eq'],
    ['under $and', { $and: [{ id: 'd3' }, { stage: { $eq: ['won'] } }] }, 'where.$and[1].stage.$eq'],
    ['under $or', { $or: [{ id: 'd3' }, { stage: { $eq: ['won'] } }] }, 'where.$or[1].stage.$eq'],
    ['under $not', { $not: { stage: { $eq: ['won', 'lost'] } } }, 'where.$not.stage.$eq'],
    ['under $not over $or', { $not: { $or: [{ id: 'd3' }, { stage: { $eq: ['won'] } }] } }, 'where.$not.$or[1].stage.$eq'],
  ];

  for (const [name, where, path] of CASES) {
    it(`${name}: INVALID_FILTER / 400, the face's $eq refusal at ${path}, naming $in`, () => {
      const err = refusalOf(() => tree(where));
      expectEnvelope(err);
      expect(err.message.startsWith(EQ('stage'))).toBe(true);
      expect(err.message).toContain(`at ${path}.`);
      expect(err.message).toContain(REMEDY);
    });
  }
});

describe('[#19888] the implicit spelling — `{ f: [...] }` — is refused, never read as IN', () => {
  const CASES: Array<[string, unknown, string, string]> = [
    ['two members', { stage: ['won', 'lost'] }, 'stage', 'where.stage'],
    ['one member', { stage: ['won'] }, 'stage', 'where.stage'],
    // The face refuses the empty list too: only `$in: []` / `$nin: []` are
    // declared predicates. It used to compile to the FALSE constant.
    ['the empty list', { stage: [] }, 'stage', 'where.stage'],
    ['under $and', { $and: [{ id: 'd3' }, { stage: ['won'] }] }, 'stage', 'where.$and[1].stage'],
    ['under $or', { $or: [{ id: 'd3' }, { stage: ['won'] }] }, 'stage', 'where.$or[1].stage'],
    ['under $not', { $not: { stage: ['won', 'lost'] } }, 'stage', 'where.$not.stage'],
    // A nested relation compiles to the dotted member `acct.region`, whose
    // equality slot the list sits in (the face itself does not descend here).
    ['inside a nested relation', { acct: { region: ['NA', 'EU'] } }, 'region', 'where.acct.region'],
  ];

  for (const [name, where, field, path] of CASES) {
    it(`${name}: INVALID_FILTER / 400, the face's implicit refusal at ${path}, naming $in`, () => {
      const err = refusalOf(() => tree(where));
      expectEnvelope(err);
      expect(err.message.startsWith(IMPLICIT(field))).toBe(true);
      expect(err.message).toContain(`at ${path}.`);
      expect(err.message).toContain(REMEDY);
    });
  }
});

describe('[#19888] one condition, one wording — the object spelling, the array spelling and the face agree byte for byte', () => {
  /** The face's own refusal of `node`, read straight from `@objectstack/spec`. */
  function faceSays(node: unknown): string {
    return refusalOf(() => assertListComparandShapes(node)).message;
  }

  const PAIRS: Array<[string, unknown, unknown[]]> = [
    ['top level, implicit', { stage: ['won', 'lost'] }, ['stage', '=', ['won', 'lost']]],
    ['under $and, implicit', { $and: [{ id: 'd3' }, { stage: ['won'] }] }, ['and', ['id', '=', 'd3'], ['stage', 'equals', ['won']]]],
    ['under $or, implicit', { $or: [{ id: 'd3' }, { stage: ['won'] }] }, ['or', ['id', '=', 'd3'], ['stage', '==', ['won']]]],
  ];

  for (const [name, object, array] of PAIRS) {
    it(name, () => {
      const face = faceSays(object);
      expect(refusalOf(() => tree(object)).message).toBe(face);
      expect(refusalOf(() => tree(array)).message).toBe(face);
    });
  }

  it('the explicit $eq spelling reads as the face reads it', () => {
    const where = { $not: { stage: { $eq: ['won', 'lost'] } } };
    expect(refusalOf(() => tree(where)).message).toBe(faceSays(where));
  });
});

describe('[#19888] a list is diagnosed as the list, not by one of its members', () => {
  // The member gates — #6386's undefined comparand, #6444's mixed wrapper, the
  // shape gate's field reference — would otherwise answer first and send the
  // author to the wrong repair. Same order as the face and read-scope-sql.
  const CASES: Array<[string, unknown, (f: string) => string]> = [
    ['an undefined member of the implicit list', { d: [1, undefined] }, IMPLICIT],
    ['an undefined member under $eq', { d: { $eq: [undefined] } }, EQ],
    ['a field reference under $eq', { d: { $eq: [{ $field: 'other' }] } }, EQ],
    ['a mixed wrapper whose operator is a $eq list', { d: { $eq: ['a'], nested: 'x' } }, EQ],
  ];

  for (const [name, where, opening] of CASES) {
    it(name, () => {
      const err = refusalOf(() => tree(where));
      expectEnvelope(err);
      expect(err.message.startsWith(opening('d'))).toBe(true);
      expect(err.message).not.toMatch(/is undefined|mixes \$-operator keys/);
    });
  }
});

describe('[#19888] the neighbouring shapes compile exactly as before', () => {
  const leaf = (member: string, operator: string, values: unknown[]) => ({ kind: 'leaf', member, operator, values });
  const at = new Date('2026-01-01T00:00:00.000Z');
  const ACCEPTED: Array<[string, unknown, unknown]> = [
    ['the implicit scalar', { stage: 'won' }, leaf('stage', 'equals', ['won'])],
    ['a scalar under $eq', { stage: { $eq: 'won' } }, leaf('stage', 'equals', ['won'])],
    ['a Date under $eq', { created: { $eq: at } }, leaf('created', 'equals', [at])],
    ['the implicit null — the has-no-value predicate', { stage: null }, leaf('stage', 'notSet', [])],
    ['null under $eq — the same predicate', { stage: { $eq: null } }, leaf('stage', 'notSet', [])],
    ['a list under $in — the prescribed remedy', { stage: { $in: ['won', 'lost'] } }, leaf('stage', 'in', ['won', 'lost'])],
    ['the empty $in — the FALSE constant', { stage: { $in: [] } }, { kind: 'const', value: false }],
    ['the empty $nin — the TRUE constant', { stage: { $nin: [] } }, { kind: 'const', value: true }],
    ['a nested-relation scalar', { acct: { region: 'NA' } }, leaf('acct.region', 'equals', ['NA'])],
    ['a field reference under $eq (served on the engine path)', { amount: { $eq: { $field: 'budget' } } }, leaf('amount', 'equals', [{ $field: 'budget' }])],
  ];

  for (const [name, where, expected] of ACCEPTED) {
    it(name, () => {
      expect(tree(where)).toEqual(expected);
    });
  }

  it('$between keeps its two-element list', () => {
    expect(tree({ amount: { $between: [1, 5] } })).toEqual({
      kind: 'and',
      children: [leaf('amount', 'gte', [1]), leaf('amount', 'lte', [5])],
    });
  });

  it('$ne with a list is not judged by this gate (not ruling 乙’s)', () => {
    expect(() => tree({ stage: { $ne: ['won'] } })).not.toThrow(/requires a single comparable value/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const OBJECT = 'deal';
const ROWS = [
  { id: 'd1', stage: 'won' },
  { id: 'd2', stage: 'lost' },
  { id: 'd3', stage: 'open' },
  { id: 'd4', stage: null },
  // What the draft preview's string comparison used to match for the list.
  { id: 'd5', stage: 'won,lost' },
];
const CUBE: Cube = {
  name: 'deals',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    ['id', 'stage'].map((n) => [n, { name: n, label: n, type: 'string', sql: n }]),
  ),
  public: false,
} as unknown as Cube;

describe('[#19888] every analytics face refuses before anything runs (real engine)', () => {
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
      // `$in` / equality filter names, so the CONTROL below is a real answer.
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
        fields: { id: { type: 'text', name: 'id' }, stage: { type: 'text', name: 'stage' } },
      } as never,
    ]);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('CONTROL: no where serves every row, and the prescribed $in serves exactly the named rows', async () => {
    // Without this, the refusals below could pass on a harness that serves nothing.
    for (const [face, run] of FACES) {
      expect(await run(undefined), `${face}: no where`).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
      expect(await run({ stage: { $in: ['won', 'lost'] } }), `${face}: $in`).toEqual(['d1', 'd2']);
    }
  });

  for (const [name, where] of [
    ['the implicit list', { stage: ['won', 'lost'] }],
    ['a list under $eq', { stage: { $eq: ['won', 'lost'] } }],
    ['the empty list under $eq', { stage: { $eq: [] } }],
    ['the implicit list, negated', { $not: { stage: ['won', 'lost'] } }],
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
        expect((err as Refusal).message).toContain(REMEDY);
        expect(statements).toBe(0);
        expect(aggregates).toBe(0);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#19888] a STORED dataset carrying the shape is refused on every service door', () => {
  // Built without the list and then given it, so this file pins the RUNTIME
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

  const STORED: Array<[string, (f: unknown) => Dataset, unknown]> = [
    ['the dataset scope filter, implicit', withScope, { stage: ['won', 'lost'] }],
    ['a measure filter, $eq', withMeasureFilter, { stage: { $eq: ['won', 'lost'] } }],
  ];

  for (const [label, filterOf, where] of STORED) {
    for (const [door, run] of DOORS) {
      it(`${door}: ${label} → INVALID_FILTER / 400`, async () => {
        let err: Refusal | undefined;
        try {
          await run(filterOf(where));
        } catch (e) {
          err = e as Refusal;
        }
        expectEnvelope(err as Refusal);
        expect((err as Refusal).message).toContain(REMEDY);
      });
    }
  }

  it('the registered cube on the ObjectQL door refuses before engine.aggregate runs', async () => {
    const { svc, calls } = service(false);
    svc.registerDataset(withScope({ stage: ['won', 'lost'] }));
    let err: Refusal | undefined;
    try {
      await svc.query({ cube: 'deal_metrics', measures: ['deal_count'] } as AnalyticsQuery);
    } catch (e) {
      err = e as Refusal;
    }
    expectEnvelope(err as Refusal);
    expect(calls.aggregate).toBe(0);
  });

  it('CONTROL: the same dataset with the prescribed $in answers on the dashboard door', async () => {
    const { svc, calls } = service(false);
    const result = (await svc.queryDataset!(withScope({ stage: { $in: ['won', 'lost'] } }), {
      measures: ['deal_count'],
      dimensions: ['stage'],
    })) as { rows: unknown[] };
    expect(result.rows.length).toBeGreaterThan(0);
    expect(calls.aggregate).toBeGreaterThan(0);
  });
});
