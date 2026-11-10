// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28258] A dimension spelled through a relationship path the dataset does not
 * declare in its `include`, through `queryDataset` on the native strategy, the
 * ObjectQL strategy and the draft preview, on real SQLite.
 *
 * ## What these pins hold
 *
 * - A selected dimension whose relationship path the dataset does not back is
 *   refused `INVALID_FIELD` / 400 on every face, with one message naming the
 *   member and the path. Before, the native strategy refused it
 *   `DATASET_INVALID` (its join allowlist), the ObjectQL strategy refused
 *   `<object>.bogus` `INVALID_FIELD` from the driver and SERVED a real lookup
 *   (`account.name`) by joining it anyway, and the draft preview served one
 *   `null` group.
 * - A multi-hop spelling is judged hop by hop: with only `account` included,
 *   `account.owner.name` is refused naming `account.owner`.
 * - CONTROL: a backed dotted dimension still serves on both live strategies
 *   (the same groups), and the draft preview refuses it with its own refusal
 *   (#28555, `dotted-path-preview-parity.test.ts`); a dotted spelling that
 *   resolves to a declared dimension (`<object>.region`) still serves; an
 *   undeclared plain dimension (`bogus`, #28201) keeps its own refusal. A
 *   `runtimeFilter` member through an unbacked path is refused by the same
 *   gate since #28557 (pinned in that file too).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os28258_deal';
const ACCOUNT = 'os28258_account';
const PERSON = 'os28258_person';

const PEOPLE = [{ id: 'p1', name: 'Ada' }] as const;
const ACCOUNTS = [
  { id: 'a1', name: 'Acme', owner: 'p1' },
  { id: 'a2', name: 'Globex', owner: 'p1' },
] as const;
const ROWS = [
  { id: 'd1', region: 'amer', amount: 100, account: 'a1' },
  { id: 'd2', region: 'amer', amount: 50, account: 'a2' },
  { id: 'd3', region: 'emea', amount: 30, account: 'a1' },
] as const;

const shape = {
  label: 'Deals',
  object: OBJECT,
  dimensions: [{ name: 'region', field: 'region', type: 'string' }],
  measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
};
/** Declares no relationship at all. */
const UNBACKED = DatasetSchema.parse({ name: 'os28258_deals', ...shape });
/** Declares `account`, and nothing past it. */
const BACKED = DatasetSchema.parse({ name: 'os28258_deals_by_account', include: ['account'], ...shape });

type Face = 'native' | 'objectql' | 'preview';
const FACES: readonly Face[] = ['native', 'objectql', 'preview'];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Refusal = Error & { code?: string; status?: number; param?: string; field?: string; member?: string; cube?: string };
type Selection = { dimensions?: string[]; measures: string[]; runtimeFilter?: Record<string, unknown> };

const refusalOf = (p: Promise<unknown>): Promise<Refusal> =>
  p.then<never, Refusal>(
    () => {
      throw new Error('expected a refusal, but the query resolved');
    },
    (e) => e as Refusal,
  );

/** A `'protocol'` service answering one pending seed draft, which routes `previewDrafts` onto the preview path. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os28258_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

describe('[#28258] a dotted dimension through a relationship path the dataset does not back', () => {
  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

  const ask = (face: Face, dataset: typeof UNBACKED, selection: Selection) =>
    services[face === 'preview' ? 'objectql' : face]!.queryDataset(
      dataset,
      { ...selection } as never,
      undefined,
      face === 'preview' ? { previewDrafts: true } : undefined,
    );

  const groupsOf = (rows: unknown, dimension: string) =>
    (rows as Array<Record<string, unknown>>)
      .map((r) => ({ key: r[dimension], total: Number(r.total) }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({ name: PERSON, label: 'Person', fields: { name: { name: 'name', type: 'text' } } } as never);
    engine.registry.registerObject({
      name: ACCOUNT,
      label: 'Account',
      fields: {
        name: { name: 'name', type: 'text' },
        owner: { name: 'owner', type: 'lookup', reference: PERSON },
      },
    } as never);
    engine.registry.registerObject({
      name: OBJECT,
      label: 'Deal',
      fields: {
        region: { name: 'region', type: 'text' },
        amount: { name: 'amount', type: 'number' },
        account: { name: 'account', type: 'lookup', reference: ACCOUNT },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    for (const row of PEOPLE) await engine.insert(PERSON, { ...row } as never);
    for (const row of ACCOUNTS) await engine.insert(ACCOUNT, { ...row } as never);
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

  for (const [label, dataset, member, path] of [
    ["'os28258_deal.bogus' (the object's own name as a hop)", UNBACKED, 'os28258_deal.bogus', 'os28258_deal'],
    ["'account.name' (a real lookup the dataset does not include)", UNBACKED, 'account.name', 'account'],
    ["'account.owner.name' (one hop past the included 'account')", BACKED, 'account.owner.name', 'account.owner'],
  ] as const) {
    it(`refuses ${label} INVALID_FIELD / 400 with one message on every face`, async () => {
      const refusals = await Promise.all(
        FACES.map((face) => refusalOf(ask(face, dataset, { dimensions: [member], measures: ['total'] }))),
      );
      for (const [i, err] of refusals.entries()) {
        expect(err.code, `${FACES[i]}: ${err.message}`).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.param).toBe('dimensions');
        expect(err.member).toBe(member);
        expect(err.cube).toBe(dataset.name);
        expect(err.message).toContain(`Dimension '${member}' on cube '${dataset.name}' traverses relationship path '${path}'`);
      }
      const [native, objectql, preview] = refusals;
      expect(objectql.message).toBe(native.message);
      expect(preview.message).toBe(native.message);
    });
  }

  it("refuses an unbacked dotted dimension beside a declared one with one message on every face", async () => {
    const refusals = await Promise.all(
      FACES.map((face) => refusalOf(ask(face, UNBACKED, { dimensions: ['region', 'account.name'], measures: ['total'] }))),
    );
    for (const err of refusals) {
      expect(err.code, err.message).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.member).toBe('account.name');
    }
    expect(refusals[1].message).toBe(refusals[0].message);
    expect(refusals[2].message).toBe(refusals[0].message);
  });

  it("CONTROL: a backed 'account.name' serves on both live strategies, the same groups", async () => {
    const expected = [{ key: 'Acme', total: 130 }, { key: 'Globex', total: 50 }];
    for (const face of ['native', 'objectql'] as const) {
      const result = await ask(face, BACKED, { dimensions: ['account.name'], measures: ['total'] });
      expect(groupsOf(result.rows, 'account.name'), face).toEqual(expected);
    }
    // [#28555] The preview joins nothing, so it refuses the backed path with
    // its own refusal rather than this gate's (which judges only unbacked ones).
    const err = await refusalOf(ask('preview', BACKED, { dimensions: ['account.name'], measures: ['total'] }));
    expect(err.code, err.message).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
    expect(err.message).not.toContain('which the dataset does not declare');
  });

  it("CONTROL: '<object>.region', which resolves to the declared 'region', still serves on every face", async () => {
    const expected = [{ key: 'amer', total: 150 }, { key: 'emea', total: 30 }];
    for (const face of ['native', 'objectql'] as const) {
      const result = await ask(face, UNBACKED, { dimensions: ['os28258_deal.region'], measures: ['total'] });
      expect(groupsOf(result.rows, 'os28258_deal.region'), face).toEqual(expected);
    }
    const preview = await ask('preview', UNBACKED, { dimensions: ['os28258_deal.region'], measures: ['total'] });
    expect(Array.isArray(preview.rows)).toBe(true);
  });

  it("CONTROL: an undeclared plain 'bogus' (#28201) keeps its own refusal on every face", async () => {
    const refusals = await Promise.all(
      FACES.map((face) => refusalOf(ask(face, UNBACKED, { dimensions: ['bogus'], measures: ['total'] }))),
    );
    for (const err of refusals) {
      expect(err.code, err.message).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.field).toBe('bogus');
      expect(err.message).toContain("Dimension 'bogus' on cube 'os28258_deals' groups by field 'bogus'");
    }
  });

  it("CONTROL: a measure mistake beside an unbacked dotted dimension is answered about the measure on every face", async () => {
    const refusals = await Promise.all(
      FACES.map((face) => refusalOf(ask(face, UNBACKED, { dimensions: ['account.name'], measures: ['nope'] }))),
    );
    for (const err of refusals) {
      expect(err.code, err.message).toBe('INVALID_FIELD');
      expect(err.param).toBe('measures');
    }
    expect(refusals[2].message).toBe(refusals[0].message);
  });

  it("[#28557] a runtimeFilter member through an unbacked path is refused by the same gate, param 'where'", async () => {
    const err = await refusalOf(
      ask('native', UNBACKED, { dimensions: ['region'], measures: ['total'], runtimeFilter: { 'account.name': 'Acme' } }),
    );
    expect(err.code, err.message).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
    expect(err.param).toBe('where');
    expect(err.member).toBe('account.name');
  });
});

/**
 * [#31842] A dotted FILTER member whose tail names a declared member, on both
 * live strategies, through a compiled dataset (`queryDataset`) and a
 * hand-authored cube (`query`), on real SQLite.
 *
 * The deal declares its own `region`; `vendor` is a lookup to an object with
 * NO `region`, `supplier` a lookup to one that has it. Before, a dotted member
 * named a declared key by its tail alone, whatever its first segment, so
 * `vendor.region` and `supplier.region` both filtered the deal's OWN `region`
 * on both strategies (and through the gate, which read the same lookup), and a
 * flat key over a base column (`vendor_region` over `region`) answered
 * `vendor.region` the same way. Now a dotted member names a declared key only
 * verbatim, behind the cube's own qualifier (`<dataset>.region`,
 * `<object>.region`), or through a flat key over the same relationship path;
 * anything else is a relationship path, which the include gate judges or the
 * traversal tier joins.
 */
describe('[#31842] a dotted filter member whose tail names a declared member', () => {
  const DEAL = 'os31842_deal';
  const VENDOR = 'os31842_vendor';
  const SUPPLIER = 'os31842_supplier';
  const dealShape = {
    label: 'Deals',
    object: DEAL,
    dimensions: [{ name: 'region', field: 'region', type: 'string' }],
    measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
  };
  /** Declares no relationship. */
  const NO_INCLUDE = DatasetSchema.parse({ name: 'os31842_deals', ...dealShape });
  /** Declares both relationships. */
  const INCLUDES = DatasetSchema.parse({ name: 'os31842_deals_inc', include: ['vendor', 'supplier'], ...dealShape });
  /** A flat key over a BASE column: it names the deal's own `region`, never a related one. */
  const FLAT_BASE = DatasetSchema.parse({
    name: 'os31842_deals_flat',
    ...dealShape,
    dimensions: [{ name: 'vendor_region', field: 'region', type: 'string' }],
  });
  /** A flat key over the RELATED column: it names `supplier.region`, so that spelling still answers it. */
  const FLAT_RELATED = DatasetSchema.parse({
    name: 'os31842_deals_flat_rel',
    include: ['supplier'],
    ...dealShape,
    dimensions: [...dealShape.dimensions, { name: 'supplier_region', field: 'supplier.region', type: 'string' }],
  });
  /** A hand-authored cube over the deal, named for the object. */
  const CUBE = {
    name: DEAL,
    sql: DEAL,
    dimensions: { region: { sql: 'region', type: 'string' } },
    measures: { count: { type: 'count', sql: '*' } },
  };

  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};
  const LIVE = ['native', 'objectql'] as const;

  const filterDataset = (face: (typeof LIVE)[number], dataset: typeof NO_INCLUDE, runtimeFilter: Record<string, unknown>, dimension = 'region') =>
    services[face]!.queryDataset(dataset, { dimensions: [dimension], measures: ['total'], runtimeFilter } as never);
  const filterCube = (face: (typeof LIVE)[number], where: Record<string, unknown>) =>
    services[face]!.query({ cube: DEAL, dimensions: [`${DEAL}.region`], measures: [`${DEAL}.count`], where } as never);
  const rowsOf = (rows: unknown) =>
    (rows as Array<Record<string, unknown>>)
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v : Number(v)])))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({ name: VENDOR, label: 'Vendor', fields: { name: { name: 'name', type: 'text' } } } as never);
    engine.registry.registerObject({
      name: SUPPLIER,
      label: 'Supplier',
      fields: { name: { name: 'name', type: 'text' }, region: { name: 'region', type: 'text' } },
    } as never);
    engine.registry.registerObject({
      name: DEAL,
      label: 'Deal',
      fields: {
        region: { name: 'region', type: 'text' },
        amount: { name: 'amount', type: 'number' },
        vendor: { name: 'vendor', type: 'lookup', reference: VENDOR },
        supplier: { name: 'supplier', type: 'lookup', reference: SUPPLIER },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    await engine.insert(VENDOR, { id: 'v1', name: 'Initech' } as never);
    await engine.insert(SUPPLIER, { id: 's1', name: 'Hooli', region: 'apac' } as never);
    await engine.insert(SUPPLIER, { id: 's2', name: 'Umbrella', region: 'emea' } as never);
    // The deal's OWN region and its supplier's region disagree on every row,
    // so which column a filter read shows in the answer.
    for (const row of [
      { id: 'd1', region: 'emea', amount: 1, vendor: 'v1', supplier: 's1' },
      { id: 'd2', region: 'emea', amount: 10, vendor: 'v1', supplier: 's1' },
      { id: 'd3', region: 'amer', amount: 100, vendor: 'v1', supplier: 's2' },
    ]) await engine.insert(DEAL, row as never);

    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      const provided: Record<string, unknown> = { data: engine };
      await new AnalyticsServicePlugin({ cubes: [CUBE], ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
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

  it("refuses 'vendor.region' through no include on both strategies, instead of filtering the deal's own region", async () => {
    for (const face of LIVE) {
      const err = await refusalOf(filterDataset(face, NO_INCLUDE, { 'vendor.region': 'emea' }));
      expect(err.code, `${face}: ${err.message}`).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.param).toBe('where');
      expect(err.member).toBe('vendor.region');
      expect(err.message).toContain("traverses relationship path 'vendor'");
    }
  });

  it("refuses 'vendor.region' through a declared include to an object with no 'region' on both strategies", async () => {
    for (const face of LIVE) {
      const err = await refusalOf(filterDataset(face, INCLUDES, { 'vendor.region': 'emea' }));
      expect(err.code, `${face}: ${err.message}`).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.param).toBe('where');
      expect(err.member).toBe('vendor.region');
    }
  });

  it("filters the RELATED 'supplier.region' through a declared include, never the deal's own region", async () => {
    // Native joins the supplier: d1 and d2 point at the APAC supplier.
    const native = await filterDataset('native', INCLUDES, { 'supplier.region': 'apac' });
    expect(rowsOf(native.rows)).toEqual([{ region: 'emea', total: 11 }]);
    // The engine-aggregate face cannot join, and says so for this member as it
    // does for every related filter.
    const err = await refusalOf(filterDataset('objectql', INCLUDES, { 'supplier.region': 'apac' }));
    expect(err.code, err.message).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
    expect(err.param).toBe('where');
    expect(err.member).toBe('supplier.region');
  });

  it("CONTROL: '<dataset>.region' and '<object>.region' still filter the deal's own region on both strategies", async () => {
    for (const face of LIVE) {
      for (const member of [`${NO_INCLUDE.name}.region`, `${DEAL}.region`]) {
        const result = await filterDataset(face, NO_INCLUDE, { [member]: 'emea' });
        expect(rowsOf(result.rows), `${face} ${member}`).toEqual([{ region: 'emea', total: 11 }]);
      }
    }
  });

  it("refuses 'vendor.region' beside a flat key 'vendor_region' over the BASE column on both strategies", async () => {
    for (const face of LIVE) {
      const err = await refusalOf(filterDataset(face, FLAT_BASE, { 'vendor.region': 'emea' }, 'vendor_region'));
      expect(err.code, `${face}: ${err.message}`).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.member).toBe('vendor.region');
      expect(err.message).toContain("traverses relationship path 'vendor'");
    }
  });

  it("a flat key 'supplier_region' over the related 'supplier.region' answers that spelling with the related column", async () => {
    const result = await filterDataset('native', FLAT_RELATED, { 'supplier.region': 'apac' });
    expect(rowsOf(result.rows)).toEqual([{ region: 'emea', total: 11 }]);
  });

  it("a hand-authored cube: 'supplier.region' joins the supplier on the native strategy, and the engine face refuses 'vendor.region'", async () => {
    const native = await filterCube('native', { 'supplier.region': 'apac' });
    expect(rowsOf(native.rows)).toEqual([{ [`${DEAL}.region`]: 'emea', [`${DEAL}.count`]: 2 }]);
    const err = await refusalOf(filterCube('objectql', { 'vendor.region': 'emea' }));
    expect(err.code, err.message).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
    expect(err.param).toBe('where');
    expect(err.member).toBe('vendor.region');
  });

  it("CONTROL: a hand-authored cube still filters '<cube>.region' as the deal's own region on both strategies", async () => {
    for (const face of LIVE) {
      const result = await filterCube(face, { [`${DEAL}.region`]: 'emea' });
      expect(rowsOf(result.rows), face).toEqual([{ [`${DEAL}.region`]: 'emea', [`${DEAL}.count`]: 2 }]);
    }
  });
});

/**
 * [#31880] A declared MEASURE behind the cube's own qualifier in a filter
 * (`<dataset>.total`, `<cube>.total`, `<object>.total`), on both live
 * strategies and the draft preview, through a compiled dataset and a
 * hand-authored cube, on real SQLite.
 *
 * The where gate always read such a member as the measure (its `'any'` lookup
 * consults both bags before any traversal), but both strategies asked the
 * dimension lookup first, and that lookup turns every dotted member naming no
 * declared dimension into a relationship traversal. So the qualified spelling
 * compiled as a join through a hop named for the cube: native refused
 * `DATASET_INVALID` ("join … is not backed") on a dataset and answered a 500
 * from a self-join on a hand-authored cube; the engine face refused it as a
 * cross-object filter or handed the engine a column the object lacks. Bare
 * `total` filtered the measure's column, row by row (`WHERE amount > ?`).
 * Now a filter member resolves against the declared dimensions, then the
 * declared measures, before the traversal tier, so every qualified spelling
 * compiles exactly as `total` does: the same statement, the same rows.
 */
describe('[#31880] a declared measure behind the cube\'s own qualifier in a filter', () => {
  const DEAL = 'os31880_deal';
  const VENDOR = 'os31880_vendor';
  const DATASET = DatasetSchema.parse({
    name: 'os31880_deals',
    label: 'Deals',
    object: DEAL,
    dimensions: [{ name: 'region', field: 'region', type: 'string' }],
    measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
  });
  /** A hand-authored cube over the deal, named apart from the object. */
  const CUBE = {
    name: 'os31880_cube',
    sql: DEAL,
    dimensions: { region: { sql: 'region', type: 'string' } },
    measures: { count: { type: 'count', sql: '*' }, total: { type: 'sum', sql: 'amount' } },
  };
  const ROWS = [
    { id: 'd1', region: 'emea', amount: 1, vendor: 'v1' },
    { id: 'd2', region: 'emea', amount: 10, vendor: 'v1' },
    { id: 'd3', region: 'amer', amount: 100, vendor: 'v1' },
  ];
  /** `total > 5` keeps d2 and d3 when it reads the measure's column row by row. */
  const OVER_FIVE = { $gt: 5 };

  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};
  /** Every statement (native) and engine aggregate (ObjectQL face) a query sends. */
  const sent: string[] = [];
  const LIVE = ['native', 'objectql'] as const;

  const seedProtocol = {
    getMetaItems: async () => [{ name: 'os31880_seed', object: DEAL }],
    getMetaItem: async () => ({ item: { records: ROWS } }),
  };
  const filterDataset = (face: Face, member: string) =>
    services[face === 'preview' ? 'objectql' : face]!.queryDataset(
      DATASET,
      { dimensions: ['region'], measures: ['total'], runtimeFilter: { [member]: OVER_FIVE } } as never,
      undefined,
      face === 'preview' ? { previewDrafts: true } : undefined,
    );
  const filterCube = (face: (typeof LIVE)[number], member: string) =>
    services[face]!.query({
      cube: CUBE.name,
      dimensions: [`${CUBE.name}.region`],
      measures: [`${CUBE.name}.total`],
      where: { [member]: OVER_FIVE },
    } as never);
  /** The rows a query answers and what it sent, in one comparable value. */
  const answerOf = async (run: () => Promise<{ rows: unknown }>) => {
    sent.length = 0;
    const result = await run();
    const rows = (result.rows as Array<Record<string, unknown>>)
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v : Number(v)])))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { rows, sent: [...sent] };
  };

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({ name: VENDOR, label: 'Vendor', fields: { name: { name: 'name', type: 'text' } } } as never);
    engine.registry.registerObject({
      name: DEAL,
      label: 'Deal',
      fields: {
        region: { name: 'region', type: 'text' },
        amount: { name: 'amount', type: 'number' },
        vendor: { name: 'vendor', type: 'lookup', reference: VENDOR },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    await engine.insert(VENDOR, { id: 'v1', name: 'Initech' } as never);
    for (const row of ROWS) await engine.insert(DEAL, { ...row } as never);

    const record = engine as unknown as Record<'execute' | 'aggregate', (...args: unknown[]) => Promise<unknown>>;
    for (const method of ['execute', 'aggregate'] as const) {
      const original = record[method].bind(engine);
      record[method] = async (...args: unknown[]) => {
        sent.push(`${method} ${JSON.stringify(args.slice(0, 2))}`);
        return original(...args);
      };
    }

    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      const provided: Record<string, unknown> = { data: engine, protocol: seedProtocol };
      await new AnalyticsServicePlugin({ cubes: [CUBE], ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
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

  it("'<dataset>.total' and '<object>.total' in a runtimeFilter answer exactly what 'total' answers, on both strategies", async () => {
    for (const face of LIVE) {
      const bare = await answerOf(() => filterDataset(face, 'total'));
      expect(bare.rows, face).toEqual([{ region: 'amer', total: 100 }, { region: 'emea', total: 10 }]);
      for (const member of [`${DATASET.name}.total`, `${DEAL}.total`]) {
        expect(await answerOf(() => filterDataset(face, member)), `${face} ${member}`).toEqual(bare);
      }
    }
  });

  it("a hand-authored cube: '<cube>.total' and '<object>.total' in a where answer exactly what 'total' answers, on both strategies", async () => {
    for (const face of LIVE) {
      const bare = await answerOf(() => filterCube(face, 'total'));
      expect(bare.rows, face).toEqual([
        { [`${CUBE.name}.region`]: 'amer', [`${CUBE.name}.total`]: 100 },
        { [`${CUBE.name}.region`]: 'emea', [`${CUBE.name}.total`]: 10 },
      ]);
      for (const member of [`${CUBE.name}.total`, `${DEAL}.total`]) {
        expect(await answerOf(() => filterCube(face, member)), `${face} ${member}`).toEqual(bare);
      }
    }
  });

  it("the draft preview answers '<dataset>.total' in a runtimeFilter exactly as it answers 'total'", async () => {
    const bare = await answerOf(() => filterDataset('preview', 'total'));
    expect(bare.rows).toEqual([{ region: 'amer', total: 100 }, { region: 'emea', total: 10 }]);
    expect(await answerOf(() => filterDataset('preview', `${DATASET.name}.total`))).toEqual(bare);
  });

  it("CONTROL: 'vendor.total', whose first segment is not the cube's own, stays a relationship path on both strategies", async () => {
    for (const face of LIVE) {
      const err = await refusalOf(filterDataset(face, 'vendor.total'));
      expect(err.code, `${face}: ${err.message}`).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.param).toBe('where');
      expect(err.member).toBe('vendor.total');
      expect(err.message).toContain("traverses relationship path 'vendor'");
    }
    // The hand-authored cube has no include gate: the engine face refuses it as
    // the cross-object filter it is, never reading the cube's own 'total'.
    const err = await refusalOf(filterCube('objectql', 'vendor.total'));
    expect(err.code, err.message).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
    expect(err.member).toBe('vendor.total');
  });
});

/**
 * [#31881] A dotted member naming a column its related object does not have,
 * on a HAND-AUTHORED cube (`query`), on both live strategies, on real SQLite.
 *
 * The deal's `vendor` is a lookup to an object with no `region`, its
 * `supplier` a lookup to one that has it. Before, the native strategy joined
 * the vendor and handed the database `vendor.nope` / `vendor.region`, which it
 * refused: `DATABASE_ERROR` / 500 as a `where` leaf, a dimension and a
 * windowed time dimension. A compiled dataset refused the same input
 * `INVALID_FIELD` / 400 through `assertRelationshipColumnsExist`; the cube path
 * never asked it (it stood down with no `include` allowlist). Now the cube path
 * asks the same gate, so both strategies answer the dataset path's sentence,
 * naming the member and the related object, before either compiles.
 */
describe('[#31881] a hand-authored cube member naming a column its related object lacks', () => {
  const DEAL = 'os31881_deal';
  const VENDOR = 'os31881_vendor';
  const SUPPLIER = 'os31881_supplier';
  /** A hand-authored cube over the deal, named apart from the object; no allowlist. */
  const CUBE = {
    name: 'os31881_cube',
    sql: DEAL,
    dimensions: { region: { sql: 'region', type: 'string' } },
    measures: { count: { type: 'count', sql: '*' } },
  };
  /** The same deal as a compiled dataset including both lookups: the path whose answer the cube now shares. */
  const DATASET = DatasetSchema.parse({
    name: 'os31881_deals',
    label: 'Deals',
    object: DEAL,
    include: ['vendor', 'supplier'],
    dimensions: [{ name: 'region', field: 'region', type: 'string' }],
    measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
  });
  const MISSING = [
    ['vendor.nope', 'nope'],
    ['vendor.region', 'region'],
  ] as const;

  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};
  const LIVE = ['native', 'objectql'] as const;

  /** The member in each request position that reaches a join on the native strategy. */
  const positions = (member: string) =>
    [
      ['where', { dimensions: [`${CUBE.name}.region`], where: { [member]: 'x' } }],
      ['dimensions', { dimensions: [member] }],
      ['timeDimensions', { timeDimensions: [{ dimension: member, dateRange: ['2026-01-01', '2026-12-31'] }] }],
    ] as const;
  const askCube = (face: (typeof LIVE)[number], shape: Record<string, unknown>) =>
    services[face]!.query({ cube: CUBE.name, measures: [`${CUBE.name}.count`], ...shape } as never);
  const rowsOf = (rows: unknown) =>
    (rows as Array<Record<string, unknown>>)
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v : Number(v)])))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({ name: VENDOR, label: 'Vendor', fields: { name: { name: 'name', type: 'text' } } } as never);
    engine.registry.registerObject({
      name: SUPPLIER,
      label: 'Supplier',
      fields: { name: { name: 'name', type: 'text' }, region: { name: 'region', type: 'text' } },
    } as never);
    engine.registry.registerObject({
      name: DEAL,
      label: 'Deal',
      fields: {
        region: { name: 'region', type: 'text' },
        amount: { name: 'amount', type: 'number' },
        vendor: { name: 'vendor', type: 'lookup', reference: VENDOR },
        supplier: { name: 'supplier', type: 'lookup', reference: SUPPLIER },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    await engine.insert(VENDOR, { id: 'v1', name: 'Initech' } as never);
    await engine.insert(SUPPLIER, { id: 's1', name: 'Hooli', region: 'apac' } as never);
    await engine.insert(SUPPLIER, { id: 's2', name: 'Umbrella', region: 'emea' } as never);
    // The deal's OWN region and its supplier's region disagree on every row.
    for (const row of [
      { id: 'd1', region: 'emea', amount: 1, vendor: 'v1', supplier: 's1' },
      { id: 'd2', region: 'emea', amount: 10, vendor: 'v1', supplier: 's1' },
      { id: 'd3', region: 'amer', amount: 100, vendor: 'v1', supplier: 's2' },
    ]) await engine.insert(DEAL, row as never);

    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      const provided: Record<string, unknown> = { data: engine };
      await new AnalyticsServicePlugin({ cubes: [CUBE], ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
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

  it("refuses 'vendor.nope' and 'vendor.region' INVALID_FIELD / 400 on the native strategy, as a where leaf, a dimension and a time dimension", async () => {
    for (const [member, field] of MISSING) {
      for (const [param, shape] of positions(member)) {
        const err = await refusalOf(askCube('native', shape)) as Refusal & { object?: string };
        expect(err.code, `${param} ${member}: ${err.message}`).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.param).toBe(param);
        expect(err.member).toBe(member);
        expect(err.field).toBe(field);
        expect(err.object).toBe(VENDOR);
      }
    }
  });

  it("answers the compiled dataset path's own sentence, on both strategies", async () => {
    for (const face of LIVE) {
      for (const [member] of MISSING) {
        const cube = await refusalOf(askCube(face, { dimensions: [`${CUBE.name}.region`], where: { [member]: 'x' } }));
        const dataset = await refusalOf(
          services[face]!.queryDataset(DATASET, { dimensions: ['region'], measures: ['total'], runtimeFilter: { [member]: 'x' } } as never),
        );
        expect(cube.code, `${face} ${member}: ${cube.message}`).toBe('INVALID_FIELD');
        expect(cube.message).toBe(dataset.message.replace(`cube '${DATASET.name}'`, `cube '${CUBE.name}'`));
        expect(cube.message).toContain(`through relationship path 'vendor', which object '${VENDOR}' does not have`);
      }
    }
  });

  it("CONTROL: the related 'supplier.region' still joins and filters on the native strategy", async () => {
    const filtered = await askCube('native', { dimensions: [`${CUBE.name}.region`], where: { 'supplier.region': 'apac' } });
    expect(rowsOf(filtered.rows)).toEqual([{ [`${CUBE.name}.region`]: 'emea', [`${CUBE.name}.count`]: 2 }]);
    const grouped = await askCube('native', { dimensions: ['supplier.region'] });
    expect(rowsOf(grouped.rows)).toEqual([
      { 'supplier.region': 'apac', [`${CUBE.name}.count`]: 2 },
      { 'supplier.region': 'emea', [`${CUBE.name}.count`]: 1 },
    ]);
  });
});

/**
 * [#31944] A dotted member whose relationship hop names no field of the object
 * it leaves, on a HAND-AUTHORED cube (`query`), on both live strategies, on
 * real SQLite.
 *
 * The deal has no field `nope`. Before, the hop resolver's alias tier named an
 * object `nope` the field probe cannot answer for, so the related-column gate
 * (#28558, asked on a cube since #31881) stood down, and the native strategy
 * joined a table `nope` and answered `DATABASE_ERROR` / 500 as a `where` leaf,
 * a dimension and a windowed time dimension. The engine-aggregate strategy
 * answered three different 400 sentences (its cross-object filter refusal, the
 * engine's groupBy guard, its cross-object bucket refusal). Now the cube path
 * refuses the hop `INVALID_FIELD` / 400 before either strategy compiles, naming
 * the member and the hop, so both strategies answer one sentence. A compiled
 * dataset's answer is unchanged: its `include` gate refuses the path first.
 */
describe('[#31944] a hand-authored cube member whose relationship hop the object does not have', () => {
  const DEAL = 'os31944_deal';
  const SUPPLIER = 'os31944_supplier';
  /** A hand-authored cube over the deal, named apart from the object; no joins, no allowlist. */
  const CUBE = {
    name: 'os31944_cube',
    sql: DEAL,
    dimensions: { region: { sql: 'region', type: 'string' } },
    measures: { count: { type: 'count', sql: '*' } },
  };
  /** The same deal as a compiled dataset including the one lookup: its `include` gate answers first. */
  const DATASET = DatasetSchema.parse({
    name: 'os31944_deals',
    label: 'Deals',
    object: DEAL,
    include: ['supplier'],
    dimensions: [{ name: 'region', field: 'region', type: 'string' }],
    measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
  });
  /** The member, the hop it names that the object it leaves lacks, and that object. */
  const UNKNOWN = [
    ['nope.region', 'nope', DEAL],
    ['supplier.nope.region', 'nope', SUPPLIER],
  ] as const;

  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};
  const LIVE = ['native', 'objectql'] as const;

  /** The member in each request position that reaches a join on the native strategy. */
  const positions = (member: string) =>
    [
      ['where', { dimensions: [`${CUBE.name}.region`], where: { [member]: 'x' } }],
      ['dimensions', { dimensions: [member] }],
      ['timeDimensions', { timeDimensions: [{ dimension: member, dateRange: ['2026-01-01', '2026-12-31'] }] }],
    ] as const;
  const askCube = (face: (typeof LIVE)[number], shape: Record<string, unknown>) =>
    services[face]!.query({ cube: CUBE.name, measures: [`${CUBE.name}.count`], ...shape } as never);
  const rowsOf = (rows: unknown) =>
    (rows as Array<Record<string, unknown>>)
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v : Number(v)])))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: SUPPLIER,
      label: 'Supplier',
      fields: { name: { name: 'name', type: 'text' }, region: { name: 'region', type: 'text' } },
    } as never);
    engine.registry.registerObject({
      name: DEAL,
      label: 'Deal',
      fields: {
        region: { name: 'region', type: 'text' },
        amount: { name: 'amount', type: 'number' },
        supplier: { name: 'supplier', type: 'lookup', reference: SUPPLIER },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    await engine.insert(SUPPLIER, { id: 's1', name: 'Hooli', region: 'apac' } as never);
    await engine.insert(SUPPLIER, { id: 's2', name: 'Umbrella', region: 'emea' } as never);
    // The deal's OWN region and its supplier's region disagree on every row.
    for (const row of [
      { id: 'd1', region: 'emea', amount: 1, supplier: 's1' },
      { id: 'd2', region: 'emea', amount: 10, supplier: 's1' },
      { id: 'd3', region: 'amer', amount: 100, supplier: 's2' },
    ]) await engine.insert(DEAL, row as never);

    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      const provided: Record<string, unknown> = { data: engine };
      await new AnalyticsServicePlugin({ cubes: [CUBE], ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
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

  it("refuses 'nope.region' and 'supplier.nope.region' INVALID_FIELD / 400 on the native strategy, as a where leaf, a dimension and a time dimension", async () => {
    for (const [member, hop, object] of UNKNOWN) {
      for (const [param, shape] of positions(member)) {
        const err = await refusalOf(askCube('native', shape)) as Refusal & { object?: string };
        expect(err.code, `${param} ${member}: ${err.message}`).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.param).toBe(param);
        expect(err.member).toBe(member);
        expect(err.field).toBe(hop);
        expect(err.object).toBe(object);
      }
    }
  });

  it('the engine-aggregate strategy answers the same sentence in every position', async () => {
    for (const [member] of UNKNOWN) {
      for (const [param, shape] of positions(member)) {
        const native = await refusalOf(askCube('native', shape));
        const objectql = await refusalOf(askCube('objectql', shape));
        expect(objectql.code, `${param} ${member}: ${objectql.message}`).toBe('INVALID_FIELD');
        expect(objectql.status).toBe(400);
        expect(objectql.message).toBe(native.message);
      }
    }
  });

  it("CONTROL: a compiled dataset keeps its own `include` refusal for 'nope.region', on both strategies", async () => {
    for (const face of LIVE) {
      const err = await refusalOf(
        services[face]!.queryDataset(DATASET, { dimensions: ['region'], measures: ['total'], runtimeFilter: { 'nope.region': 'x' } } as never),
      );
      expect(err.code, `${face}: ${err.message}`).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.message).toContain("traverses relationship path 'nope', which the dataset does not declare in its `include`");
    }
  });

  it("CONTROL: the declared 'supplier.region' still joins, filters and groups on the native strategy", async () => {
    const filtered = await askCube('native', { dimensions: [`${CUBE.name}.region`], where: { 'supplier.region': 'apac' } });
    expect(rowsOf(filtered.rows)).toEqual([{ [`${CUBE.name}.region`]: 'emea', [`${CUBE.name}.count`]: 2 }]);
    const grouped = await askCube('native', { dimensions: ['supplier.region'] });
    expect(rowsOf(grouped.rows)).toEqual([
      { 'supplier.region': 'apac', [`${CUBE.name}.count`]: 2 },
      { 'supplier.region': 'emea', [`${CUBE.name}.count`]: 1 },
    ]);
    const engineGrouped = await askCube('objectql', { dimensions: ['supplier.region'] });
    expect(rowsOf(engineGrouped.rows)).toEqual(rowsOf(grouped.rows));
  });
});
