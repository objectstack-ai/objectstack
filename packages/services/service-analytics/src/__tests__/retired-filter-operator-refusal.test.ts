// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28945] A RETIRED filter operator (`$regex`, `$options`) in an analytics
 * `where` / `runtimeFilter` is refused with the retirement's prescription, on
 * every face, in the `where` door's envelope (`INVALID_FILTER` / 400).
 *
 * The D3 retirement entry `filter-regex-options-retired` promises the two keys
 * are refused everywhere naming the replacement, and the data door says it:
 * "… is RETIRED … Write "$icontains" instead", then
 * `RETIRED_FILTER_OPERATORS[op].why` verbatim. This door gave the same
 * envelope with a generic "Unsupported filter operator … Supported: …" list
 * (measured on the showcase before the fix). The prescription now comes from
 * the same table, built the way the data door's faces build it, by one pass
 * every analytics face runs.
 *
 * Controls: `$icontains` is served; an unknown, never-declared operator keeps
 * the generic list (and the draft preview its own sentence for it); a
 * `FilterArray` spelling still refuses a retired name at `isFilterAST`.
 *
 * Every refusal asserts the ADR-0112 envelope (`code` + `status`); a bare
 * `toThrow()` would be satisfied by any uncoded error.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQL } from '@objectstack/objectql';
import { markFilterSubtreeProvenance, RETIRED_FILTER_OPERATORS, type Cube, type FilterCondition } from '@objectstack/spec/data';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { normalizeAnalyticsFilterTree, NO_DATETIME_COLUMNS } from '../strategies/filter-normalizer.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';
import { AnalyticsService } from '../analytics-service.js';

interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

const OBJECT = 'acct';
const ROWS = [
  { id: 'a1', name: 'Acme Corp', amt: 1 },
  { id: 'a2', name: 'ACME ltd', amt: 5 },
  { id: 'a3', name: 'beta', amt: 10 },
];
const ALL = ['a1', 'a2', 'a3'];
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
    [['id', 'string'], ['name', 'string'], ['amt', 'number']].map(([n, t]) => [n, { label: n, type: t, sql: n }]),
  ),
  public: true,
} as unknown as Cube;
/** What a client reads of a refusal: `CLIENT_MESSAGE_MAX` in `@objectstack/types` (module-private there). */
const CLIENT_MESSAGE_MAX = 500;
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } } as never;

const tree = (where: unknown) => normalizeAnalyticsFilterTree({ where } as never, NO_DATETIME_COLUMNS);

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

/** The retirement's answer: the envelope, the replacement, and the table's prescription verbatim. */
function expectRetiredRefusal(err: Refusal, op: '$regex' | '$options', field: string): void {
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
  expect(err.message.startsWith(`[analytics] Filter operator "${op}" on field "${field}" is RETIRED`)).toBe(true);
  expect(err.message).toContain(`Write "${RETIRED_FILTER_OPERATORS[op].to}" instead.`);
  expect(err.message).toContain(RETIRED_FILTER_OPERATORS[op].why);
  expect(err.message).not.toContain('Unsupported filter operator');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('[#28945] the `where` door answers a retired operator with the retirement prescription', () => {
  it('$regex and a dangling $options, each naming $icontains', () => {
    expectRetiredRefusal(refusalOf(() => tree({ name: { $regex: 'acme' } })), '$regex', 'name');
    expectRetiredRefusal(refusalOf(() => tree({ name: { $options: 'i' } })), '$options', 'name');
  });

  it('{ $regex, $options } is ONE mistake: the first key answers and names the other', () => {
    const err = refusalOf(() => tree({ name: { $regex: '^acme', $options: 'i' } }));
    expectRetiredRefusal(err, '$regex', 'name');
    expect(err.message).toContain('also carries the retired "$options"');
  });

  it('in every position: under $not, in an $or beside a TRUE arm, in an $and, and on a dotted member', () => {
    expectRetiredRefusal(refusalOf(() => tree({ $not: { name: { $regex: 'a' } } })), '$regex', 'name');
    expectRetiredRefusal(refusalOf(() => tree({ $or: [{}, { name: { $regex: 'a' } }] })), '$regex', 'name');
    expectRetiredRefusal(refusalOf(() => tree({ $and: [{ amt: 1 }, { name: { $options: 'i' } }] })), '$options', 'name');
    expectRetiredRefusal(refusalOf(() => tree({ 'acct.name': { $regex: 'a' } })), '$regex', 'acct.name');
  });

  it('everything the author must write sits inside the 500 characters a client reads', () => {
    // [#27098] The table's `why` is ordered for this budget; the lead-in must not spend it.
    const regex = refusalOf(() => tree({ $or: [{ id: 'a1' }, { opportunity_name: { $regex: 'a' } }] })).message;
    for (const text of ['Write "$icontains" instead.', '`$contains` for a case-sensitive one', 'match in application code']) {
      expect(regex.indexOf(text), text).toBeGreaterThan(0);
      expect(regex.indexOf(text) + text.length, text).toBeLessThanOrEqual(CLIENT_MESSAGE_MAX);
    }
    const options = refusalOf(() => tree({ opportunity_name: { $options: 'i' } })).message;
    for (const text of ['Delete `$options`', 'write `$icontains` for the case-insensitive match']) {
      expect(options.indexOf(text), text).toBeGreaterThan(0);
      expect(options.indexOf(text) + text.length, text).toBeLessThanOrEqual(CLIENT_MESSAGE_MAX);
    }
  });

  it('a defect an earlier pass judges is still answered first (no existing refusal moves)', () => {
    // The comparand-TYPE face judges a plain-object comparand in every position.
    const err = refusalOf(() => tree({ amt: { $eq: { a: 1 } }, name: { $regex: 'a' } }));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).not.toContain('RETIRED');
  });

  it('CONTROL: an unknown operator keeps the generic list', () => {
    const err = refusalOf(() => tree({ name: { $sounds_like: 'acme' } }));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('Unsupported filter operator "$sounds_like" on "name"');
    expect(err.message).not.toContain('RETIRED');
  });

  it('CONTROL: the FilterArray spelling still refuses a retired name at isFilterAST, as before', () => {
    const err = refusalOf(() => tree(['name', 'regex', 'acme']));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
  });

  it('CONTROL: $icontains compiles to its leaf', () => {
    expect(tree({ name: { $icontains: 'acme' } })).toEqual({
      kind: 'leaf', member: 'name', operator: 'icontains', values: ['acme'],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#28945] every analytics face over a real engine: one answer, before anything runs', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
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
      getReadScope: () => undefined,
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
      getReadScope: () => undefined,
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

  const FACES: Array<[string, (where: unknown) => Promise<string[]>]> = [
    ['native execute', async (w) => ids((await new NativeSQLStrategy().execute(q(w), ctxFor(true))).rows)],
    ['/analytics/sql echo', async (w) => {
      const { sql, params } = await new ObjectQLStrategy().generateSql(q(w), ctxFor(false));
      return ids(await runRawSql(sql, params));
    }],
    ['ObjectQL engine path', async (w) => ids((await new ObjectQLStrategy().execute(q(w), ctxFor(false))).rows)],
    ['AnalyticsService.query (native)', async (w) => ids((await service(true).query(q(w))).rows as never)],
    ['AnalyticsService.query (ObjectQL)', async (w) => ids((await service(false).query(q(w))).rows as never)],
    ['AnalyticsService.generateSql (ObjectQL)', async (w) => {
      const { sql, params } = await service(false).generateSql(q(w));
      return ids(await runRawSql(sql, params));
    }],
    ['draft preview', async (w) => ids(evaluateAnalyticsQueryOverRows(q(w), CUBE, ROWS.map((r) => ({ ...r }))).rows as never)],
  ];

  it('CONTROL: the fixture is served, and $icontains gets its rows on every face', async () => {
    for (const [face, run] of FACES) {
      expect(await run(undefined), `${face}: no where`).toEqual(ALL);
    }
    for (const [face, run] of FACES.filter(([face]) => face !== 'draft preview')) {
      expect(await run({ name: { $icontains: 'acme' } }), `${face}: $icontains 'acme'`).toEqual(['a1', 'a2']);
    }
  });

  for (const where of [{ name: { $regex: 'acme' } }, { name: { $options: 'i' } }, { $not: { name: { $regex: '^acme', $options: 'i' } } }]) {
    it(`${JSON.stringify(where)}: every face gives the door's sentence, and nothing reaches the database or the engine`, async () => {
      const expected = refusalOf(() => tree(where)).message;
      for (const [face, run] of FACES) {
        statements = 0;
        aggregates = 0;
        const err = await asyncRefusalOf(() => run(where));
        expect(err.code, face).toBe('INVALID_FILTER');
        expect(err.status, face).toBe(400);
        expect(err.message, face).toBe(expected);
        expect(statements, `${face}: statements`).toBe(0);
        expect(aggregates, `${face}: engine calls`).toBe(0);
      }
    });
  }

  it('CONTROL: the draft preview keeps its OWN sentence for an unknown operator', async () => {
    const err = await asyncRefusalOf(() => FACES[FACES.length - 1][1]({ name: { $sounds_like: 'a' } }));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain('is not evaluated by the draft-data preview');
  });

  it('the prescription is the data door\'s: the engine refuses the same key with the same tail', async () => {
    // The SQL driver shows a `where` refusal's own words only for a subtree
    // marked as the caller's, as a deployment's SecurityPlugin marks the
    // caller's verbatim `where` (#7929/#8220).
    const where = markFilterSubtreeProvenance({ name: { $regex: 'acme' } }, 'author');
    const door = await asyncRefusalOf(() => engine.find(OBJECT, { where } as never));
    expect(door.code).toBe('INVALID_FILTER');
    expect(door.status).toBe(400);
    const tail = (message: string) => message.slice(message.indexOf(' Write "'));
    expect(door.message).toContain(' Write "$icontains" instead.');
    expect(tail(refusalOf(() => tree({ name: { $regex: 'acme' } })).message)).toBe(tail(door.message));
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#28945] the dataset door: a stored or runtime filter carrying a retired key', () => {
  const BASE = DatasetSchema.parse({
    name: 'acct_metrics',
    label: 'Acct Metrics',
    object: OBJECT,
    dimensions: [{ name: 'name', label: 'Name', field: 'name', type: 'string' }],
    measures: [{ name: 'acct_count', label: 'Accounts', aggregate: 'count' }],
  }) as Dataset;
  const withScope = (filter: unknown): Dataset => ({ ...BASE, filter } as Dataset);
  const withMeasureFilter = (filter: unknown): Dataset =>
    ({ ...BASE, measures: [{ ...BASE.measures[0], filter }] } as Dataset);

  function svc(extra: Record<string, unknown> = {}) {
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
      ...extra,
    });
    return { s, calls };
  }

  it('queryDataset: runtimeFilter { name: { $regex } } → the retirement prescription, no statement', async () => {
    const { s, calls } = svc();
    const err = await asyncRefusalOf(() =>
      s.queryDataset!(BASE, { measures: ['acct_count'], dimensions: ['name'], runtimeFilter: { name: { $regex: 'acme' } } as FilterCondition }),
    );
    expectRetiredRefusal(err, '$regex', 'name');
    expect(calls.raw).toBe(0);
    expect(calls.aggregate).toBe(0);
  });

  it('queryDataset with previewDrafts: the same answer from the draft preview', async () => {
    const { s } = svc({ draftRowsResolver: vi.fn(async () => ROWS.map((r) => ({ ...r }))) });
    const err = await asyncRefusalOf(() =>
      s.queryDataset!(
        BASE,
        { measures: ['acct_count'], dimensions: ['name'], runtimeFilter: { name: { $options: 'i' } } as FilterCondition },
        undefined,
        { previewDrafts: true },
      ),
    );
    expectRetiredRefusal(err, '$options', 'name');
  });

  for (const [label, dataset] of [
    ['the dataset scope filter', withScope({ name: { $regex: 'acme' } })],
    ['a measure filter', withMeasureFilter({ name: { $regex: 'acme' } })],
  ] as const) {
    it(`queryDataset: ${label} → the retirement prescription, no statement`, async () => {
      const { s, calls } = svc();
      const err = await asyncRefusalOf(() => s.queryDataset!(dataset, { measures: ['acct_count'], dimensions: ['name'] }));
      expectRetiredRefusal(err, '$regex', 'name');
      expect(calls.raw).toBe(0);
    });
  }
});
