// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36168] The dataset query door refuses a scalar comparison or text operator
 * on a declared multi-valued or JSON-stored field, the way the data door does:
 * `INVALID_FILTER` / 400, naming the field and prescribing `$contains`.
 *
 * Before, the native SQL strategy compiled `{ tags: { $in: ['a'] } }` as
 * `tags IN ('a')` against the stored serialization `["a","b"]` and answered
 * 200 with a count of 0, and the draft preview matched the drafted list
 * against the scalar and answered the same; the ObjectQL strategy, which hands
 * the leaf to the engine and `driver-sql`, refused it.
 *
 * Driven through `queryDataset` on the production composition: a real
 * `AnalyticsServicePlugin` over a real engine and `SqlDriver` (SQLite), which
 * wires the declared value shape and the dialect from the data engine. Three
 * faces: the native strategy (the plugin's default capabilities), the
 * ObjectQL strategy, and the draft preview (`previewDrafts`, one pending seed
 * draft of the same rows).
 *
 * A second suite drives `NativeSQLStrategy` itself: it refuses on every named
 * dialect at compile time, and on a dialect the host cannot name it DECLINES
 * the query, so a non-SQL datasource keeps its engine's answer.
 *
 * What these pins hold:
 * - every operator of `JSON_COLUMN_INCOMPATIBLE_OPERATORS` the door accepts,
 *   implicit equality, and `$between`, on a `tags` field and on a
 *   `select` declared `multiple: true`, in `runtimeFilter`, under `$not` and
 *   `$or`, in the dataset's own `filter` and in a measure's `filter`: refused
 *   on every face, code AND status, the field named, `$contains` prescribed
 *   (the preview refuses the text family as unevaluable on every column, and
 *   the ObjectQL face's per-aggregation `filter` withholds the field);
 * - one message across faces, where they name one spelling;
 * - CONTROL: the same operators on a scalar column, and `$contains` /
 *   `$notContains` / `$null` on the JSON column, are answered with the right
 *   count on every face that evaluates them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';
import type { Cube, ValueShapeFieldDef } from '@objectstack/spec/data';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os36168_item';

const ROWS = [
  { id: 'r1', label: 'a', tags: ['a', 'b'], picks: ['a', 'b'] },
  { id: 'r2', label: 'b', tags: ['b'], picks: ['b'] },
  { id: 'r3', label: 'c', tags: ['c'], picks: ['c'] },
  { id: 'r4', label: null, tags: null, picks: null },
] as const;

const DATASET = DatasetSchema.parse({
  name: 'os36168_items',
  label: 'Items',
  object: OBJECT,
  dimensions: [{ name: 'label', field: 'label', type: 'string' }],
  measures: [{ name: 'cnt', aggregate: 'count' }],
}) as Dataset;

type Face = 'native' | 'objectql' | 'preview';
const FACES: readonly Face[] = ['native', 'objectql', 'preview'];

/** A `'protocol'` service answering one pending seed draft of the same rows, which routes `previewDrafts` onto the draft preview. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os36168_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Refusal = Error & { code?: string; status?: number };

const refusalOf = (p: Promise<unknown>): Promise<Refusal> =>
  p.then<never, Refusal>(
    (out) => {
      throw new Error(`expected a refusal, but the query answered ${JSON.stringify(out)}`);
    },
    (e) => e as Refusal,
  );

/** The JSON-stored fields: an inherently multi-value type and a `multiple: true` declaration. */
const JSON_FIELDS = ['tags', 'picks'] as const;

/**
 * The refused filters, as a function of the field. The card's pair (`=` and
 * `$in`), the rest of the equality family, one ordering, `$between`, and the
 * text family that has no membership reading.
 */
const REFUSED: Array<[string, (f: string) => Record<string, unknown>]> = [
  ['$eq', (f) => ({ [f]: { $eq: 'a' } })],
  ['implicit equality', (f) => ({ [f]: 'a' })],
  ['$in', (f) => ({ [f]: { $in: ['a'] } })],
  ['$ne', (f) => ({ [f]: { $ne: 'a' } })],
  ['$nin', (f) => ({ [f]: { $nin: ['a'] } })],
  ['$gt', (f) => ({ [f]: { $gt: 'a' } })],
  ['$lte', (f) => ({ [f]: { $lte: 'b' } })],
  ['$between', (f) => ({ [f]: { $between: ['a', 'b'] } })],
  ['$startsWith', (f) => ({ [f]: { $startsWith: 'a' } })],
  ['$endsWith', (f) => ({ [f]: { $endsWith: 'a' } })],
  ['$icontains', (f) => ({ [f]: { $icontains: 'A' } })],
  ['$in under $not', (f) => ({ $not: { [f]: { $in: ['a'] } } })],
  ['$in in an $or beside a scalar arm', (f) => ({ $or: [{ label: 'c' }, { [f]: { $in: ['a'] } }] })],
];

/** The filters the native and ObjectQL faces hand the driver in one spelling, so both print one message. */
const SAME_SPELLING_ON_LIVE_FACES = new Set(['$in', '$ne', '$nin', '$gt', '$lte', '$startsWith', '$endsWith', '$icontains']);
/**
 * The text family the draft preview does not evaluate on any column: it refuses
 * it `INVALID_FILTER` / 400 as an unevaluable operator, ahead of this refusal.
 */
const PREVIEW_UNEVALUATED = new Set(['$startsWith', '$endsWith', '$icontains', '$notContains']);
/** …and the filters the draft preview names as the native face names them. */
const SAME_SPELLING_ON_PREVIEW = new Set(
  [...SAME_SPELLING_ON_LIVE_FACES, '$eq', 'implicit equality'].filter((label) => !PREVIEW_UNEVALUATED.has(label)),
);
/** Whether `face` answers `filter`: the preview answers no operator it does not evaluate. */
const evaluatedOn = (face: string, filter: Record<string, unknown>): boolean =>
  face !== 'preview' || ![...PREVIEW_UNEVALUATED].some((op) => JSON.stringify(filter).includes(`"${op}"`));

describe('[#36168] the dataset door refuses a scalar comparison on a JSON column, on every face', () => {
  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

  const ask = (face: Face, runtimeFilter?: Record<string, unknown>, dataset: Dataset = DATASET) =>
    services[face === 'preview' ? 'objectql' : face]!.queryDataset(
      dataset,
      { measures: ['cnt'], ...(runtimeFilter ? { runtimeFilter } : {}) } as never,
      undefined,
      face === 'preview' ? { previewDrafts: true } : undefined,
    );

  const countOf = async (face: Face, runtimeFilter?: Record<string, unknown>): Promise<number> => {
    const result = (await ask(face, runtimeFilter)) as { rows: Array<Record<string, unknown>> };
    return Number(result.rows[0]?.cnt ?? 0);
  };

  const expectRefusal = (err: Refusal, field: string, label: string): void => {
    expect(err, label).toBeInstanceOf(Error);
    expect(err.code, `${label}: ${err.message}`).toBe('INVALID_FILTER');
    expect(err.status, label).toBe(400);
    expect(err.message, label).toContain(`"${field}"`);
    expect(err.message, label).toContain('"$contains"');
  };

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: OBJECT,
      label: 'Item',
      fields: {
        label: { name: 'label', type: 'text' },
        tags: { name: 'tags', type: 'tags' },
        picks: {
          name: 'picks',
          type: 'select',
          multiple: true,
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
            { label: 'C', value: 'c' },
          ],
        },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    for (const row of ROWS) await engine.insert(OBJECT, { ...row } as never);

    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      const provided: Record<string, unknown> = { data: engine, protocol: pendingSeedProtocol };
      await new AnalyticsServicePlugin({ ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
        getService: (name: string) => provided[name] ?? registered[name],
        registerService: (name: string, svc: unknown) => { registered[name] = svc; },
        replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
        hook: () => {},
        logger: quiet,
      } as never);
      services[face] = registered.analytics as AnalyticsService;
    }
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('CONTROL: the fixture is served unfiltered on every face', async () => {
    for (const face of FACES) expect(await countOf(face), face).toBe(4);
  });

  for (const field of JSON_FIELDS) {
    for (const [label, filterOf] of REFUSED) {
      it(`${field}: ${label} → 400 INVALID_FILTER naming the field, on every face`, async () => {
        const [native, objectql, preview] = await Promise.all(
          FACES.map((face) => refusalOf(ask(face, filterOf(field)))),
        );
        expectRefusal(native, field, `native ${label}`);
        expectRefusal(objectql, field, `objectql ${label}`);
        if (PREVIEW_UNEVALUATED.has(label)) {
          expect(preview.code, preview.message).toBe('INVALID_FILTER');
          expect(preview.status).toBe(400);
        } else {
          expectRefusal(preview, field, `preview ${label}`);
        }
        if (SAME_SPELLING_ON_LIVE_FACES.has(label)) expect(native.message).toBe(objectql.message);
        if (SAME_SPELLING_ON_PREVIEW.has(label)) expect(preview.message).toBe(native.message);
      });
    }
  }

  it("the dataset's own `filter` is refused alike, in the same words on every face", async () => {
    const scoped = { ...DATASET, filter: { tags: { $in: ['a'] } } } as Dataset;
    const [native, objectql, preview] = await Promise.all(FACES.map((face) => refusalOf(ask(face, undefined, scoped))));
    expectRefusal(native, 'tags', 'native');
    expectRefusal(objectql, 'tags', 'objectql');
    expectRefusal(preview, 'tags', 'preview');
    expect(native.message).toBe(objectql.message);
    expect(preview.message).toBe(native.message);
  });

  it("a measure's own `filter` is refused on every face", async () => {
    // The ObjectQL face hands a measure filter to the engine's per-aggregation
    // `filter`, which withholds the field from its message (it cannot tell
    // whose predicate it holds); the native face names it, as it does for the
    // dataset's own `filter` and as the ObjectQL face does there.
    const measured = { ...DATASET, measures: [{ ...DATASET.measures[0], filter: { tags: { $in: ['a'] } } }] } as Dataset;
    const [native, objectql, preview] = await Promise.all(FACES.map((face) => refusalOf(ask(face, undefined, measured))));
    expectRefusal(native, 'tags', 'native');
    expectRefusal(preview, 'tags', 'preview');
    expect(objectql.code, objectql.message).toBe('INVALID_FILTER');
    expect(objectql.status).toBe(400);
  });

  it('CONTROL: the same operators on a scalar column are answered, with the right count', async () => {
    const expected: Array<[Record<string, unknown>, number]> = [
      [{ label: { $eq: 'a' } }, 1],
      [{ label: 'a' }, 1],
      [{ label: { $in: ['a', 'b'] } }, 2],
      [{ label: { $ne: 'a' } }, 3],
      [{ label: { $nin: ['a'] } }, 3],
      [{ label: { $gt: 'a' } }, 2],
      [{ label: { $between: ['a', 'b'] } }, 2],
      [{ label: { $startsWith: 'a' } }, 1],
    ];
    for (const face of FACES) {
      for (const [filter, count] of expected) {
        if (!evaluatedOn(face, filter)) continue;
        expect(await countOf(face, filter), `${face} ${JSON.stringify(filter)}`).toBe(count);
      }
    }
  });

  it('CONTROL: membership and presence on the JSON column are answered, with the right count', async () => {
    for (const field of JSON_FIELDS) {
      const expected: Array<[Record<string, unknown>, number]> = [
        [{ [field]: { $contains: 'a' } }, 1],
        [{ [field]: { $contains: 'b' } }, 2],
        [{ $or: [{ [field]: { $contains: 'a' } }, { [field]: { $contains: 'c' } }] }, 2],
        [{ [field]: { $notContains: 'a' } }, 3],
        [{ [field]: { $null: true } }, 1],
      ];
      for (const face of FACES) {
        for (const [filter, count] of expected) {
          if (!evaluatedOn(face, filter)) continue;
          expect(await countOf(face, filter), `${face} ${JSON.stringify(filter)}`).toBe(count);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#36168] NativeSQLStrategy: refused on every named dialect, declined on an unknown one', () => {
  const CUBE = {
    name: OBJECT,
    title: 'Items',
    sql: OBJECT,
    measures: { cnt: { label: 'Count', type: 'count', sql: '*' } },
    dimensions: { label: { label: 'Label', type: 'string', sql: 'label' } },
    public: true,
  } as unknown as Cube;
  const SHAPES: Record<string, ValueShapeFieldDef> = {
    label: { type: 'text' },
    tags: { type: 'tags' },
    picks: { type: 'select', multiple: true },
  };
  const query = (where: unknown): AnalyticsQuery => ({ cube: OBJECT, measures: ['cnt'], where }) as AnalyticsQuery;
  const ctxFor = (dialect?: string): StrategyContext =>
    ({
      getCube: (name: string) => (name === OBJECT ? CUBE : undefined),
      declaredValueShape: (object: string, field: string) => (object === OBJECT ? SHAPES[field] : undefined),
      ...(dialect ? { sqlDialect: () => dialect } : {}),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [],
    }) as unknown as StrategyContext;

  for (const dialect of ['sqlite', 'postgres', 'mysql', 'mssql']) {
    it(`${dialect}: \$in and implicit equality on a JSON column are refused at compile, and a scalar column compiles`, async () => {
      const strategy = new NativeSQLStrategy();
      for (const where of [{ tags: { $in: ['a'] } }, { picks: 'a' }]) {
        expect(strategy.canHandle(query(where), ctxFor(dialect))).toBe(true);
        const err = await refusalOf(strategy.generateSql(query(where), ctxFor(dialect)));
        expect(err.code, err.message).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
      }
      const { sql } = await strategy.generateSql(query({ label: { $in: ['a'] } }), ctxFor(dialect));
      expect(sql).toMatch(/label"?\]? IN \(/);
    });
  }

  it('unknown dialect: declined, so the engine answers; a scalar column is not declined', () => {
    const strategy = new NativeSQLStrategy();
    for (const where of [{ tags: { $in: ['a'] } }, { picks: 'a' }, { $not: { tags: { $gt: 'a' } } }]) {
      expect(strategy.canHandle(query(where), ctxFor()), JSON.stringify(where)).toBe(false);
    }
    expect(strategy.canHandle(query({ label: { $in: ['a'] } }), ctxFor())).toBe(true);
    expect(strategy.canHandle(query({ tags: { $contains: 'a' } }), ctxFor('sqlite'))).toBe(true);
  });

  it('unknown dialect through the service: the engine bridge is asked, the raw-SQL bridge never', async () => {
    let raw = 0;
    let aggregates = 0;
    const svc = new AnalyticsService({
      cubes: [CUBE],
      logger: quiet,
      sourceFieldMeta: (object: string, field: string) => (object === OBJECT ? SHAPES[field] : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async () => {
        raw += 1;
        const err = new Error('this driver does not support SQL execution') as Error & { code: string };
        err.code = 'RAW_SQL_UNSUPPORTED';
        throw err;
      },
      executeAggregate: async () => {
        aggregates += 1;
        return [];
      },
    } as never);
    await svc.query(query({ tags: { $in: ['a'] } }));
    expect({ raw, aggregates }).toEqual({ raw: 0, aggregates: 1 });
  });
});
