// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20068] Both analytics doors refuse the two `$icontains` comparands
 * `FILTER_TEXT_CASES` declares REFUSED, on every face, each in its own envelope.
 *
 * `@objectstack/spec/data` declares two REJECTION rows for `$icontains`: an EMPTY
 * comparand and a NON-STRING one, each `code: 'INVALID_FILTER'`,
 * `mustMention: ['$icontains']`. It publishes the discrimination as
 * `isRefusedTextComparand` and the reason half as `textComparandRefusalReason`
 * ("the CONTRACT half only — the envelope is each face's own"). The spec's parse
 * door and `driver-sql` refuse both rows. This package never asked. Measured on
 * a real sql.js engine before the fix (recorded on the branch as `fe47363cd9`),
 * rows a1 'Acme Corp', a2 'ACME ltd', a3 'beta', a4 NULL, a5 '':
 *
 *   | cell | where: native / echo / service | read scope: native / echo | read scope: ObjectQL face |
 *   |---|---|---|---|
 *   | `$icontains: ''` | a1 a2 a3 a5, every non-NULL row | a1 a2 a3 a5 | `INVALID_FILTER` / 400 from the driver, the policy's field and comparand in the message |
 *   | `$icontains: 42` / `true` / `null` | no row, bound as text | no row | the same 400 |
 *   | `$not` over `$icontains: ''` | a4 only | a4 only | the same 400 |
 *
 * The envelopes, each face's own:
 *
 * - the `where` door (caller-authored): `INVALID_FILTER` / 400, the message
 *   kept, naming `$icontains` and seating the published reason;
 * - the read scope (policy): `READ_SCOPE_COMPILE_FAILED` / 500 with the message
 *   withheld (#5367, re-affirmed as #7598 Q2 = A), on all three faces.
 *
 * ⛔ No widening by analogy: `$contains` / `$startsWith` / `$endsWith` /
 * `$notContains` with `''` answer exactly as before (the last block).
 *
 * Every refusal asserts the ADR-0112 envelope (`code` + `status`); a bare
 * `toThrow()` would be satisfied by any uncoded error.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQL } from '@objectstack/objectql';
import { textComparandRefusalReason, type Cube, type FilterCondition } from '@objectstack/spec/data';
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

const OBJECT = 'acct';
const ROWS = [
  { id: 'a1', name: 'Acme Corp', amt: 1 },
  { id: 'a2', name: 'ACME ltd', amt: 5 },
  { id: 'a3', name: 'beta', amt: 10 },
  { id: 'a4', name: null, amt: null },
  { id: 'a5', name: '', amt: 3 },
];
const ALL = ['a1', 'a2', 'a3', 'a4', 'a5'];
const NON_NULL_NAME = ['a1', 'a2', 'a3', 'a5'];
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

/** The two declared REJECTION shapes, plus the other non-strings a JS caller can hand in. */
const REFUSED_COMPARANDS: Array<[string, unknown]> = [
  ["''", ''],
  ['42', 42],
  ['true', true],
  ['null', null],
  ['a Date', new Date('2026-01-01T00:00:00.000Z')],
];

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

async function asyncRefusalOf(run: () => Promise<unknown>): Promise<Refusal> {
  let out: unknown;
  try {
    out = await run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, but it answered ${JSON.stringify(out)}`);
}

/** The `where` door's envelope, carrying the published reason and the arriving spelling. */
function expectWhereRefusal(err: Refusal, field: string, comparand: unknown): void {
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
  expect(err.message).toContain('$icontains');
  expect(err.message).toContain(textComparandRefusalReason(field, '$icontains', comparand));
}

/** The read scope's envelope: a declared server fault whose prose never leaves the server. */
function expectWithheldScopeRefusal(err: Refusal, label: string): void {
  expect(err, label).toBeInstanceOf(Error);
  expect(err.code, label).toBe('READ_SCOPE_COMPILE_FAILED');
  expect(err.status, label).toBe(500);
  expect(serverFaultProvenance(resolveThrownHttpError(err, 500)), label).toBe('declared');
  expect(declaredRefusalMessage(err), label).toBeUndefined();
  // For the operator's log, which is the message's only destination.
  expect(err.message, label).toContain('$icontains');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20068] the `where` door refuses the two rows, both spellings, in the published words', () => {
  for (const [label, comparand] of REFUSED_COMPARANDS) {
    it(`$icontains: ${label} — object spelling`, () => {
      expectWhereRefusal(refusalOf(() => tree({ name: { $icontains: comparand } })), 'name', comparand);
    });
  }

  it('the FilterArray spelling is lowered to `$icontains` first, and refused the same way', () => {
    for (const comparand of ['', 42]) {
      const arrayErr = refusalOf(() => tree(['name', 'icontains', comparand]));
      expectWhereRefusal(arrayErr, 'name', comparand);
      expect(arrayErr.message).toBe(refusalOf(() => tree({ name: { $icontains: comparand } })).message);
    }
  });

  it('in every position: under $not, in an $or beside a TRUE arm, and on a nested relation', () => {
    expectWhereRefusal(refusalOf(() => tree({ $not: { name: { $icontains: '' } } })), 'name', '');
    expectWhereRefusal(refusalOf(() => tree({ $or: [{}, { name: { $icontains: '' } }] })), 'name', '');
    expectWhereRefusal(refusalOf(() => tree({ acct: { name: { $icontains: '' } } })), 'acct.name', '');
  });

  it('existing refusals keep their sentence: an array and an object are not re-diagnosed', () => {
    const array = refusalOf(() => tree({ name: { $icontains: ['a', 'b'] } }));
    expect(array.code).toBe('INVALID_FILTER');
    expect(array.message).toContain('an array');
    const object = refusalOf(() => tree({ name: { $icontains: { a: 1 } } }));
    expect(object.code).toBe('INVALID_FILTER');
    expect(object.message.startsWith('Filter comparand at where.name.$icontains is a plain object')).toBe(true);
  });

  it('CONTROL: a non-empty string still compiles, whatever its case or content', () => {
    for (const comparand of ['acme', 'ACME', ' ', '%', '_']) {
      expect(tree({ name: { $icontains: comparand } })).toEqual({
        kind: 'leaf', member: 'name', operator: 'icontains', values: [comparand],
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20068] every analytics face over a real engine: refused before anything runs, and the control served', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let scope: unknown;
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
  const executeAggregate = async (objectName: string, options: Record<string, any>) => {
    aggregates++;
    return (await engine.aggregate(objectName, {
      where: options.filter,
      groupBy: options.groupBy,
      aggregations: options.aggregations?.map((a: any) => ({ function: a.method, field: a.field, alias: a.alias })),
      context: options.context,
    } as never)) as Record<string, unknown>[];
  };
  const ctxFor = (nativeSql: boolean): StrategyContext =>
    ({
      getCube: (name: string) => (name === 'accts' ? CUBE : undefined),
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
    ({ cube: 'accts', dimensions: ['id'], measures: ['n'], ...(where === undefined ? {} : { where }) }) as unknown as AnalyticsQuery;
  const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();

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

  // ── The caller's `where` ──────────────────────────────────────────────────

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

  it('CONTROL: the fixture is served, and a non-empty comparand gets its rows', async () => {
    scope = undefined;
    for (const [face, run] of WHERE_FACES) {
      expect(await run(undefined), `${face}: no where`).toEqual(ALL);
    }
    // [#20098] Every face, the ObjectQL ones included: they were left out of
    // this row while `convertFilter` had no `icontains` arm.
    for (const [face, run] of WHERE_FACES) {
      expect(await run({ name: { $icontains: 'acme' } }), `${face}: $icontains 'acme'`).toEqual(['a1', 'a2']);
    }
  });

  for (const where of [{ name: { $icontains: '' } }, { name: { $icontains: 42 } }, { $not: { name: { $icontains: '' } } }]) {
    for (const [face, run] of WHERE_FACES) {
      it(`${face}: ${JSON.stringify(where)} → INVALID_FILTER / 400, nothing reaches the database or the engine`, async () => {
        scope = undefined;
        statements = 0;
        aggregates = 0;
        const err = await asyncRefusalOf(() => run(where));
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain('$icontains');
        expect(statements).toBe(0);
        expect(aggregates).toBe(0);
      });
    }
  }

  it('the draft preview refuses the same filter in the same envelope (its own sentence: it evaluates no $icontains)', () => {
    const err = refusalOf(() => evaluateAnalyticsQueryOverRows(q({ name: { $icontains: '' } }), CUBE, ROWS.map((r) => ({ ...r }))));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('$icontains');
  });

  it('a refused comparand is refused over a NON-TEXT column too, ahead of the 2026-09-05 constant', async () => {
    scope = undefined;
    // CONTROL: an accepted comparand over the number column is the contract's
    // FALSE constant (no row), not a refusal.
    expect(await WHERE_FACES[0][1]({ amt: { $icontains: 'x' } })).toEqual([]);
    const err = await asyncRefusalOf(() => WHERE_FACES[0][1]({ amt: { $icontains: '' } }));
    expectWhereRefusal(err, 'amt', '');
  });

  // ── The read scope ────────────────────────────────────────────────────────

  const SCOPE_FACES: Array<[string, () => Promise<string[]>]> = [
    ['native execute (applyReadScope)', async () => ids((await new NativeSQLStrategy().execute(q(), ctxFor(true))).rows)],
    ['/analytics/sql echo', async () => {
      const { sql, params } = await new ObjectQLStrategy().generateSql(q(), ctxFor(false));
      return ids(await runRawSql(sql, params));
    }],
    ['ObjectQL execute (withReadScope)', async () => ids((await new ObjectQLStrategy().execute(q(), ctxFor(false))).rows)],
    ['AnalyticsService.query (native)', async () => ids((await service(true).query(q())).rows as never)],
    ['AnalyticsService.query (ObjectQL)', async () => ids((await service(false).query(q())).rows as never)],
  ];

  const REFUSED_SCOPES: unknown[] = [
    { name: { $icontains: '' } },
    { name: { $icontains: 42 } },
    { name: { $icontains: null } },
    { $not: { name: { $icontains: '' } } },
    { $or: [{ id: 'a3' }, { name: { $icontains: '' } }] },
    { $and: [{ amt: { $gt: 0 } }, { name: { $icontains: true } }] },
  ];

  for (const refusedScope of REFUSED_SCOPES) {
    it(`read scope ${JSON.stringify(refusedScope)} is refused on every face, withheld, before any statement`, async () => {
      scope = refusedScope;
      for (const [face, run] of SCOPE_FACES) {
        statements = 0;
        aggregates = 0;
        expectWithheldScopeRefusal(await asyncRefusalOf(run), face);
        expect(statements, `${face}: statements`).toBe(0);
        expect(aggregates, `${face}: engine calls`).toBe(0);
      }
      scope = undefined;
    });
  }

  it('CONTROL: a well-formed $icontains scope is served, the same rows on every face', async () => {
    scope = { name: { $icontains: 'acme' } };
    for (const [face, run] of SCOPE_FACES) {
      expect(await run(), face).toEqual(['a1', 'a2']);
    }
    scope = undefined;
  });

  it('⛔ no widening by analogy: `$contains: \'\'` serves every non-NULL row on every face, as measured before', async () => {
    scope = undefined;
    for (const [face, run] of WHERE_FACES) {
      expect(await run({ name: { $contains: '' } }), `where, ${face}`).toEqual(NON_NULL_NAME);
    }
    scope = { name: { $contains: '' } };
    for (const [face, run] of SCOPE_FACES) {
      expect(await run(), `read scope, ${face}`).toEqual(NON_NULL_NAME);
    }
    scope = undefined;
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20068] `compileScopedFilterToSql` — the public export', () => {
  const compile = (s: unknown, options = {}) => compileScopedFilterToSql(s as FilterCondition, OBJECT, options);

  it('refuses the two rows in the module envelope, seating the published reason', () => {
    for (const [label, comparand] of REFUSED_COMPARANDS) {
      const err = refusalOf(() => compile({ name: { $icontains: comparand } }));
      expectWithheldScopeRefusal(err, label);
      expect(err.message, label).toContain(textComparandRefusalReason('name', '$icontains', comparand));
    }
  });

  it('refuses at the $icontains arm, while lowering: a scope refused twice is answered for the text comparand', () => {
    // The null `$in` member is refused by the shared faces, which run AFTER the
    // lowering; the text comparand is the lowering's own refusal, so it answers.
    const err = refusalOf(() => compile({ name: { $icontains: '' }, id: { $in: ['a1', null] } }));
    expectWithheldScopeRefusal(err, 'doubly refused');
    expect(err.message).toContain(textComparandRefusalReason('name', '$icontains', ''));
  });

  it('refuses over a declared non-text column too, ahead of the constant that column otherwise gets', () => {
    const nonText = { nonTextColumn: (f: string) => f === 'amt', dialect: 'sqlite' };
    // CONTROL: the constant still answers an accepted comparand.
    expect(compile({ amt: { $icontains: 'x' } }, nonText)).toEqual({ sql: '1 = 0', params: [] });
    expectWithheldScopeRefusal(refusalOf(() => compile({ amt: { $icontains: '' } }, nonText)), 'non-text');
  });

  it('an object comparand keeps its #5234 sentence', () => {
    const err = refusalOf(() => compile({ name: { $icontains: { a: 1 } } }));
    expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err.message).toContain('matches against the TEXT of a pattern');
  });

  it('CONTROL: a non-empty comparand compiles to the bound predicate it always did', () => {
    const { sql, params } = compile({ name: { $icontains: 'acme' } }, { dialect: 'sqlite' });
    expect(sql).toContain('lower(');
    expect(params).toEqual(['acme']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20068] a STORED dataset carrying the refused comparand is refused on the service doors', () => {
  const BASE = DatasetSchema.parse({
    name: 'acct_metrics',
    label: 'Acct Metrics',
    object: OBJECT,
    dimensions: [{ name: 'name', label: 'Name', field: 'name', type: 'string' }],
    measures: [{ name: 'acct_count', label: 'Accounts', aggregate: 'count' }],
  }) as Dataset;
  // A stored row is JSON; it can carry the empty string past a schema that
  // predates the parse-door rule.
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
    ['the dataset scope filter', withScope({ name: { $icontains: '' } })],
    ['a measure filter', withMeasureFilter({ name: { $icontains: '' } })],
  ] as const) {
    it(`queryDataset: ${label} → INVALID_FILTER / 400, no statement`, async () => {
      const { s, calls } = svc();
      const err = await asyncRefusalOf(() => s.queryDataset!(dataset, { measures: ['acct_count'], dimensions: ['name'] }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('$icontains');
      expect(calls.raw).toBe(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20068] ⛔ no widening by analogy — the case-exact family keeps its answer to an empty comparand', () => {
  const SIBLINGS = ['$contains', '$notContains', '$startsWith', '$endsWith'] as const;
  const CUBE_OP: Record<(typeof SIBLINGS)[number], string> = {
    $contains: 'contains', $notContains: 'notContains', $startsWith: 'startsWith', $endsWith: 'endsWith',
  };

  it('the `where` door still compiles each of them with an empty comparand', () => {
    for (const op of SIBLINGS) {
      const node = tree({ name: { [op]: '' } }) as { kind: string; children?: unknown[]; operator?: string };
      // `$notContains` is NULL-safe (#5298), so it wraps its leaf in an `or`.
      const leaf = node.kind === 'or' ? (node.children as Array<{ operator: string }>)[1] : node;
      expect(leaf, op).toMatchObject({ operator: CUBE_OP[op], values: [''] });
    }
  });

  it('the read scope still compiles each of them with an empty comparand', () => {
    // Compiled, not refused: each binds its (dialect-shaped) pattern. The row
    // result of `$contains: ''` is pinned on every face in the block above.
    for (const op of SIBLINGS) {
      const { sql, params } = compileScopedFilterToSql({ name: { [op]: '' } } as FilterCondition, OBJECT, { dialect: 'sqlite' });
      expect(sql, op).toContain('"acct"."name"');
      expect(params.length, op).toBeGreaterThan(0);
    }
  });
});
