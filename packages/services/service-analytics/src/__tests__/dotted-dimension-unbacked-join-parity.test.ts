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
 * - CONTROL: a backed dotted dimension still serves on every face (the live
 *   strategies the same groups); a dotted spelling that resolves to a declared
 *   dimension (`<object>.region`) still serves; an undeclared plain dimension
 *   (`bogus`, #28201) keeps its own refusal; a `runtimeFilter` member through an
 *   unbacked path keeps the native strategy's `DATASET_INVALID`.
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

  it("CONTROL: a backed 'account.name' serves on every face, the same groups on both live strategies", async () => {
    const expected = [{ key: 'Acme', total: 130 }, { key: 'Globex', total: 50 }];
    for (const face of ['native', 'objectql'] as const) {
      const result = await ask(face, BACKED, { dimensions: ['account.name'], measures: ['total'] });
      expect(groupsOf(result.rows, 'account.name'), face).toEqual(expected);
    }
    // The preview serves it (it is not refused); its seed rows carry no join.
    const preview = await ask('preview', BACKED, { dimensions: ['account.name'], measures: ['total'] });
    expect(Array.isArray(preview.rows)).toBe(true);
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

  it("CONTROL: a runtimeFilter member through an unbacked path keeps the native strategy's DATASET_INVALID", async () => {
    const err = await refusalOf(
      ask('native', UNBACKED, { dimensions: ['region'], measures: ['total'], runtimeFilter: { 'account.name': 'Acme' } }),
    );
    expect(err.code, err.message).toBe('DATASET_INVALID');
    expect(err.status).toBe(400);
  });
});
