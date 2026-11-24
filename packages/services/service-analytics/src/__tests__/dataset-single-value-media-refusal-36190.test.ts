// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36190] The dataset query door refuses a scalar comparison on a
 * SINGLE-VALUE media column the storing driver keeps as JSON — the second
 * JSON-column class, outside #36168's `multiple` population.
 *
 * Before, a single-value `image` / `file` field on a deployment still inside
 * the ADR-0104 dual-encoding window stored the JSON string `"file_1"`, which
 * no declaration names as JSON-stored: `{ pic: 'file_1' }` and
 * `{ pic: { $in: ['file_1'] } }` compiled `pic = 'file_1'` on the native
 * dataset face and answered `200` with a count of `0`, `$ne` answered `200`
 * with every row, and the draft preview answered its own counts (1 and 3,
 * matching the bare id it drafts). `POST /api/v1/data/:object/query` refuses
 * the same filter `400` `INVALID_FILTER`, and so does this door's ObjectQL
 * strategy, which hands the leaf to the engine and `driver-sql`.
 *
 * Driven through `queryDataset` on the production composition, as #36168's
 * suite is: a real `AnalyticsServicePlugin` over a real engine and `SqlDriver`
 * (SQLite), whose media columns have not moved, so the driver answers
 * `'single-value-media'` for both fields.
 *
 * What these pins hold:
 * - `=` (explicit and implicit), `$in` and `$ne` on an `image` field and on a
 *   `file` field: refused on the native face, the ObjectQL face and the draft
 *   preview, code AND status, naming the field and prescribing the
 *   media-column move (NOT `$contains`, which answers no rows on this class);
 * - one message across faces where they name one spelling — as #36168's suite
 *   pins it: the equality pair is the one asymmetry, because the ObjectQL
 *   face's leaf reaches `driver-sql` as the BARE spelling (`{ "pic": value }`)
 *   while the native compile and the preview name it `$eq`;
 * - CONTROL: the same operators on a scalar `text` column are answered with
 *   the right count on every face — the refusal reads the column's storage
 *   class, not the operator;
 * - CONTROL: the words differ from the `multi-value-or-json` class's, so a
 *   reader of either is given the repair that works on their column.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { jsonColumnOperatorRefusalText } from '@objectstack/core';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os36190_item';

/** Four rows, one holding the media value the card's filters name. */
const ROWS = [
  { id: 'r1', label: 'a', pic: 'file_1', doc: 'file_1' },
  { id: 'r2', label: 'b', pic: 'file_2', doc: 'file_2' },
  { id: 'r3', label: 'c', pic: null, doc: null },
  { id: 'r4', label: 'd', pic: null, doc: null },
] as const;

const DATASET = DatasetSchema.parse({
  name: 'os36190_items',
  label: 'Items',
  object: OBJECT,
  dimensions: [{ name: 'label', field: 'label', type: 'string' }],
  measures: [{ name: 'cnt', aggregate: 'count' }],
}) as Dataset;

type Face = 'native' | 'objectql' | 'preview';
const FACES: readonly Face[] = ['native', 'objectql', 'preview'];

/** The single-value media fields: the two `MULTI_CAPABLE_TYPES` members of the file family, declared scalar. */
const MEDIA_FIELDS = ['pic', 'doc'] as const;

/** A `'protocol'` service answering one pending seed draft of the same rows, which routes `previewDrafts` onto the draft preview. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os36190_seed', object: OBJECT }],
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

/**
 * The filters the native and ObjectQL faces hand the driver in one spelling, so
 * both print one message. The equality pair is absent: see the header.
 */
const SAME_SPELLING_ON_LIVE_FACES = new Set(['$in', '$ne']);

/** The refused filters: the card's `=` / `$in` / `$ne` set, explicit and implicit. */
const REFUSED: Array<[string, (f: string) => Record<string, unknown>]> = [
  ['$eq', (f) => ({ [f]: { $eq: 'file_1' } })],
  ['implicit equality', (f) => ({ [f]: 'file_1' })],
  ['$in', (f) => ({ [f]: { $in: ['file_1'] } })],
  ['$ne', (f) => ({ [f]: { $ne: 'file_1' } })],
];

/**
 * The production composition, once per suite: a real engine over a real
 * `SqlDriver` (SQLite, `driverConfig` added to its config), the fixture rows,
 * and an `AnalyticsServicePlugin` per strategy face. The draft preview rides
 * the ObjectQL face's service with `previewDrafts`.
 */
async function composeFaces(driverConfig: Record<string, unknown> = {}): Promise<{
  engine: ObjectQL;
  services: Record<'native' | 'objectql', AnalyticsService>;
}> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, ...driverConfig } as never);
  const engine = new ObjectQL({ logger: quiet } as never);
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registry.registerObject({
    name: OBJECT,
    label: 'Item',
    fields: {
      label: { name: 'label', type: 'text' },
      pic: { name: 'pic', type: 'image' },
      doc: { name: 'doc', type: 'file' },
    },
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine as never);
  for (const row of ROWS) await engine.insert(OBJECT, { ...row } as never);

  const services = {} as Record<'native' | 'objectql', AnalyticsService>;
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
  return { engine, services };
}

describe('[#36190] the dataset door refuses a scalar comparison on a single-value media column', () => {
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
    // The media class's repair, not the membership one: `$contains` finds no
    // member in a single JSON string.
    expect(err.message, label).not.toContain('"$contains"');
  };

  beforeAll(async () => {
    const composed = await composeFaces();
    engine = composed.engine;
    Object.assign(services, composed.services);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('CONTROL: the fixture is served unfiltered on every face', async () => {
    for (const face of FACES) expect(await countOf(face), face).toBe(4);
  });

  it('CONTROL: the storing driver reads both media columns as the single-value media class', () => {
    const classOf = (driver: { jsonColumnFieldClass(t: string, f: string): unknown }) =>
      MEDIA_FIELDS.map((f) => driver.jsonColumnFieldClass(OBJECT, f));
    expect(classOf(engine.getDriverForObject(OBJECT) as never)).toEqual(['single-value-media', 'single-value-media']);
  });

  for (const field of MEDIA_FIELDS) {
    for (const [label, filterOf] of REFUSED) {
      it(`${field}: ${label} → 400 INVALID_FILTER naming the field, on every face`, async () => {
        const [native, objectql, preview] = await Promise.all(
          FACES.map((face) => refusalOf(ask(face, filterOf(field)))),
        );
        expectRefusal(native, field, `native ${label}`);
        expectRefusal(objectql, field, `objectql ${label}`);
        expectRefusal(preview, field, `preview ${label}`);
        if (SAME_SPELLING_ON_LIVE_FACES.has(label)) expect(native.message, label).toBe(objectql.message);
        expect(preview.message, label).toBe(native.message);
      });
    }
  }

  it("the dataset's own `filter` is refused alike, in the same words on every face", async () => {
    const scoped = { ...DATASET, filter: { pic: { $in: ['file_1'] } } } as Dataset;
    const [native, objectql, preview] = await Promise.all(FACES.map((face) => refusalOf(ask(face, undefined, scoped))));
    expectRefusal(native, 'pic', 'native');
    expectRefusal(objectql, 'pic', 'objectql');
    expectRefusal(preview, 'pic', 'preview');
    expect(native.message).toBe(objectql.message);
    expect(preview.message).toBe(native.message);
    // …and the dataset's own `filter` names `$in` on every face, so the three
    // messages above are the SAME sentence, not three spellings of one rule.
  });

  it('the words are the media class\'s, which differ from the multi-value class\'s', async () => {
    const err = await refusalOf(ask('native', { pic: { $in: ['file_1'] } }));
    expect(err.message).toContain(jsonColumnOperatorRefusalText('pic', '$in', false, 'single-value-media').diagnostic);
    expect(err.message).not.toContain(jsonColumnOperatorRefusalText('pic', '$in', false, 'multi-value-or-json').diagnostic);
  });

  it('CONTROL: the same operators on a scalar column are answered, with the right count', async () => {
    const expected: Array<[Record<string, unknown>, number]> = [
      [{ label: { $eq: 'a' } }, 1],
      [{ label: 'a' }, 1],
      [{ label: { $in: ['a', 'b'] } }, 2],
      [{ label: { $ne: 'a' } }, 3],
    ];
    for (const face of FACES) {
      for (const [filter, count] of expected) {
        expect(await countOf(face, filter), `${face} ${JSON.stringify(filter)}`).toBe(count);
      }
    }
  });

  it('CONTROL: a presence predicate on the media column is still answered', async () => {
    for (const face of FACES) {
      expect(await countOf(face, { pic: { $null: true } }), face).toBe(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('[#36190] CONTROL: a deployment whose media columns have moved is not refused, and answers', () => {
  // The refusal reads the storing driver's class, never the declared type: once
  // the media columns hold the bare id (`fileColumnsMoved: true`), the column
  // is comparable and every face answers it. Reading `image` / `file` instead
  // would refuse here and take a working capability away.
  let engine: ObjectQL;
  let services: Record<'native' | 'objectql', AnalyticsService>;

  const countOf = async (face: Face, runtimeFilter: Record<string, unknown>): Promise<number> => {
    const result = (await services[face === 'preview' ? 'objectql' : face].queryDataset(
      DATASET,
      { measures: ['cnt'], runtimeFilter } as never,
      undefined,
      face === 'preview' ? { previewDrafts: true } : undefined,
    )) as { rows: Array<Record<string, unknown>> };
    return Number(result.rows[0]?.cnt ?? 0);
  };

  beforeAll(async () => {
    ({ engine, services } = await composeFaces({ fileColumnsMoved: true }));
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the storing driver reads neither media column as JSON', () => {
    const driver = engine.getDriverForObject(OBJECT) as unknown as { jsonColumnFieldClass(t: string, f: string): unknown };
    expect(MEDIA_FIELDS.map((f) => driver.jsonColumnFieldClass(OBJECT, f))).toEqual([undefined, undefined]);
  });

  for (const field of MEDIA_FIELDS) {
    it(`${field}: equality and $in answer the one matching row on every face`, async () => {
      for (const face of FACES) {
        for (const filter of [{ [field]: 'file_1' }, { [field]: { $eq: 'file_1' } }, { [field]: { $in: ['file_1'] } }]) {
          expect(await countOf(face, filter), `${face} ${JSON.stringify(filter)}`).toBe(1);
        }
      }
    });
  }
});
