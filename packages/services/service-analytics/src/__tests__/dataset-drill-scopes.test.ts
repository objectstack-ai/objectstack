// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30526] A dataset answer carries each selected measure's drill scope
 * (`AnalyticsResult.drillScopes`), so a drill on a number lists the records
 * that number counted, not the records of its bucket.
 *
 * MEASURED on `origin/main` `c23eafa8`, before the change: a dataset number is
 * computed under the dataset's own `filter` AND the measure's own `filter` AND
 * the selection's `runtimeFilter` (`DatasetExecutor.executeSelection` and
 * `runMeasurePass`), while the answer's drill sidecars described the bucket
 * only. The host holds the runtime filter and nothing else, so a drill on the
 * showcase's `paid_count` (`aggregate: 'count', filter: { status: 'paid' }`,
 * `examples/app-showcase/src/ui/datasets/revenue-pulse.dataset.ts`) listed
 * every invoice of the bucket.
 *
 * The unit half drives `queryDataset` over a mocked engine aggregate and reads
 * the scope beside what the engine was handed. The real-engine half (SQLite
 * through the plugin's own composition, both strategies) runs each row's drill
 * as a host composes it, bucket AND runtime filter AND scope, through the
 * engine's own `find`, and counts what it lists against the number.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsResultResponseSchema } from '@objectstack/spec/api';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsResult } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { measureDrillScopes, namesRelationshipPath } from '../drill-scope.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const CTX = { tenantId: 'org_A', userId: 'usr_7' } as ExecutionContext;

/**
 * The showcase's invoice dataset (`ShowcaseInvoiceDataset`), measure for
 * measure: a count over rows, a sum over a field, the filtered `paid_count`
 * and the derived `paid_rate` over it.
 */
const SHOWCASE_MEASURES = [
  { name: 'invoice_count', label: 'Invoices', aggregate: 'count' },
  { name: 'subtotal_sum', label: 'Subtotal', aggregate: 'sum', field: 'total', format: '0,0' },
  { name: 'paid_count', label: 'Paid Invoices', aggregate: 'count', filter: { status: 'paid' } },
  { name: 'paid_rate', label: 'Paid Rate', derived: { op: 'ratio', of: ['paid_count', 'invoice_count'] }, format: '0.0%' },
];

function invoiceDataset(extra: Record<string, unknown> = {}, measures: unknown[] = SHOWCASE_MEASURES) {
  return DatasetSchema.parse({
    name: 'showcase_invoice_metrics',
    label: 'Invoice Metrics',
    object: 'showcase_invoice',
    dimensions: [
      { name: 'status', label: 'Status', field: 'status', type: 'string' },
      { name: 'region', label: 'Region', field: 'region', type: 'string' },
    ],
    measures,
    ...extra,
  });
}

/** The ObjectQL face over fixed rows, recording every engine aggregate's filter. */
function mockedService(rows: Array<Record<string, unknown>>, seen: unknown[] = []) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, opts: { filter?: unknown }) => { seen.push(opts.filter); return rows; },
  });
}

const ROWS = [{ region: 'emea', invoice_count: 3, subtotal_sum: 30, paid_count: 2 }];
const ALL = ['invoice_count', 'subtotal_sum', 'paid_count', 'paid_rate'];

describe('[#30526] the dataset answer carries each measure\'s drill scope', () => {
  it('measure filter only — the showcase shape: paid_count drills by its filter, the sum by its column holding a value, the derived rate not at all', async () => {
    const answer: AnalyticsResult = await mockedService(ROWS).queryDataset(
      invoiceDataset(), { dimensions: ['region'], measures: ALL }, CTX,
    );
    expect(answer.drillScopes).toEqual({
      invoice_count: {},
      subtotal_sum: { total: { $null: false } },
      paid_count: { status: 'paid' },
    });
    expect('paid_rate' in answer.drillScopes!).toBe(false);
  });

  it('dataset filter only, and both: the dataset filter is in every scope, conjoined with the measure\'s own', async () => {
    const answer = await mockedService(ROWS).queryDataset(
      invoiceDataset({ filter: { kind: 'sale' } }), { dimensions: ['region'], measures: ALL }, CTX,
    );
    expect(answer.drillScopes).toEqual({
      invoice_count: { kind: 'sale' },
      subtotal_sum: { $and: [{ kind: 'sale' }, { total: { $null: false } }] },
      paid_count: { $and: [{ kind: 'sale' }, { status: 'paid' }] },
    });
  });

  it('a count over a field drills the records where it is set', async () => {
    const answer = await mockedService([{ region: 'emea', totalled: 2 }]).queryDataset(
      invoiceDataset({}, [{ name: 'totalled', aggregate: 'count', field: 'total' }]),
      { dimensions: ['region'], measures: ['totalled'] },
      CTX,
    );
    expect(answer.drillScopes).toEqual({ totalled: { total: { $null: false } } });
  });

  it('keeps the nested-relation form and a same-record $field reference as written', async () => {
    const answer = await mockedService(ROWS).queryDataset(
      invoiceDataset({}, [
        { name: 'gold_nested', aggregate: 'count', filter: { account: { tier: 'gold' } } },
        { name: 'over_floor', aggregate: 'count', filter: { total: { $gt: { $field: 'floor' } } } },
      ]),
      { dimensions: ['region'], measures: ['gold_nested', 'over_floor'] },
      CTX,
    );
    expect(answer.drillScopes).toEqual({
      gold_nested: { account: { tier: 'gold' } },
      over_floor: { total: { $gt: { $field: 'floor' } } },
    });
  });

  it('tokens are resolved as the query resolved them, and the engine was handed the same value', async () => {
    const seen: unknown[] = [];
    const answer = await mockedService([{ region: 'emea', mine: 1 }], seen).queryDataset(
      invoiceDataset({}, [{ name: 'mine', aggregate: 'count', filter: { owner: '{current_user_id}' } }]),
      { dimensions: ['region'], measures: ['mine'] },
      CTX,
    );
    expect(answer.drillScopes).toEqual({ mine: { owner: 'usr_7' } });
    expect(JSON.stringify(seen)).toContain('"usr_7"');
    expect(JSON.stringify(seen)).not.toContain('current_user_id');
  });

  it('keys by the selection\'s spelling: a cube-qualified measure carries its own filter', async () => {
    const answer = await mockedService([{ region: 'emea', 'showcase_invoice_metrics.paid_count': 2 }]).queryDataset(
      invoiceDataset(), { dimensions: ['region'], measures: ['showcase_invoice_metrics.paid_count'] }, CTX,
    );
    expect(answer.drillScopes).toEqual({ 'showcase_invoice_metrics.paid_count': { status: 'paid' } });
  });

  it('a dimensionless KPI answer carries it; an answer with no rows does not', async () => {
    const kpi = await mockedService([{ paid_count: 2 }]).queryDataset(invoiceDataset(), { measures: ['paid_count'] }, CTX);
    expect(kpi.drillScopes).toEqual({ paid_count: { status: 'paid' } });

    const empty = await mockedService([]).queryDataset(invoiceDataset(), { dimensions: ['region'], measures: ['paid_count'] }, CTX);
    expect(empty.rows).toEqual([]);
    expect('drillScopes' in empty).toBe(false);
  });

  it('a scope is the answer\'s own copy: composing into it leaves the dataset definition untouched', async () => {
    const dataset = invoiceDataset({ filter: { kind: 'sale' } });
    const svc = mockedService(ROWS);
    const first = await svc.queryDataset(dataset, { dimensions: ['region'], measures: ['paid_count'] }, CTX);
    (first.drillScopes!.paid_count as { $and: unknown[] }).$and.push({ region: 'emea' });
    ((first.drillScopes!.paid_count as { $and: Array<Record<string, unknown>> }).$and[0]).kind = 'refund';
    expect(dataset.filter).toEqual({ kind: 'sale' });
    expect(dataset.measures.find((m) => m.name === 'paid_count')!.filter).toEqual({ status: 'paid' });
    const second = await svc.queryDataset(dataset, { dimensions: ['region'], measures: ['paid_count'] }, CTX);
    expect(second.drillScopes).toEqual({ paid_count: { $and: [{ kind: 'sale' }, { status: 'paid' }] } });
  });

  it('the wire shape: the spec\'s answer schema keeps every scope the service answers, byte for byte', async () => {
    const answer = await mockedService(ROWS).queryDataset(
      invoiceDataset({ filter: { kind: 'sale' } }), { dimensions: ['region'], measures: ALL }, CTX,
    );
    const wire = JSON.parse(JSON.stringify(answer));
    const parsed = AnalyticsResultResponseSchema.parse({ success: true, data: wire });
    expect(parsed.data.drillScopes).toEqual(wire.drillScopes);
    expect(Object.keys(parsed.data.drillScopes!)).toEqual(['invoice_count', 'subtotal_sum', 'paid_count']);
  });
});

describe('[#30526] the scope walk', () => {
  it('reads a dotted key or a dotted $field reference anywhere as a relationship path, and a dotted string comparand as data', () => {
    expect(namesRelationshipPath({ 'account.tier': 'gold' })).toBe(true);
    expect(namesRelationshipPath({ $and: [{ status: 'paid' }, { $or: [{ 'owner.region': 'NA' }] }] })).toBe(true);
    expect(namesRelationshipPath({ $not: { total: { $lt: { $field: 'account.floor', addDays: 1 } } } })).toBe(true);
    expect(namesRelationshipPath({ due: { $lte: { $field: 'due_on', addDays: { $field: 'duty.grace_days' } } } })).toBe(true);
    expect(namesRelationshipPath({ account: { 'owner.name': 'x' } })).toBe(true);
    expect(namesRelationshipPath({ email: 'a.b@example.com', host: { $in: ['x.example.com'] } })).toBe(false);
    expect(namesRelationshipPath({ account: { tier: 'gold' } })).toBe(false);
  });

  it('leaves out a measure no source answers, and one whose filter is not a condition object', () => {
    const scopes = measureDrillScopes({
      measures: ['ghost', 'listed', 'counted', 'counted'],
      filter: undefined,
      measureFilterOf: (m) => (m === 'listed' ? ([['status', '=', 'paid']] as never) : undefined),
      sourceOf: (m) => (m === 'ghost' ? undefined : { kind: 'rows' }),
    });
    expect(scopes).toEqual({ counted: {} });
  });
});

// ── The real engine: a drill lists exactly what the number counted ────────────

const OBJECT = 'invoice_30526';
const ACCOUNT = 'account_30526';
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

/**
 * Invoices across two regions: sales and refunds (the dataset's own filter
 * keeps sales), paid and open (`paid_count`'s filter), with and without a
 * total (a sum and a count over `total` skip the empty ones).
 */
const D = (day: number) => `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`;

const INVOICES: Array<{
  id: string; region: string; kind: string; status: string; channel: string; total: number | null; account: string | null;
  issued_at?: string; paid_at?: string;
}> = [
  { id: 'i1', region: 'emea', kind: 'sale', status: 'paid', channel: 'web', total: 10, account: 'a1', issued_at: D(1), paid_at: D(4) },
  { id: 'i2', region: 'emea', kind: 'sale', status: 'paid', channel: 'store', total: null, account: 'a2', issued_at: D(2) },
  { id: 'i3', region: 'emea', kind: 'sale', status: 'open', channel: 'web', total: 5, account: 'a1' },
  { id: 'i4', region: 'emea', kind: 'refund', status: 'paid', channel: 'web', total: 7, account: 'a1' },
  { id: 'i5', region: 'apac', kind: 'sale', status: 'paid', channel: 'web', total: 20, account: 'a1', issued_at: D(3), paid_at: D(13) },
  { id: 'i6', region: 'apac', kind: 'sale', status: 'open', channel: 'web', total: null, account: null },
  { id: 'i7', region: 'apac', kind: 'refund', status: 'open', channel: 'store', total: 3, account: 'a2' },
  { id: 'i8', region: 'apac', kind: 'sale', status: 'paid', channel: 'store', total: 4, account: 'a2', issued_at: D(5), paid_at: D(7) },
];

const invoices = DatasetSchema.parse({
  name: 'invoices_30526', label: 'Invoices', object: OBJECT, include: [],
  filter: { kind: 'sale' },
  dimensions: [{ name: 'region', field: 'region', type: 'string' }],
  measures: [
    { name: 'invoice_count', aggregate: 'count' },
    { name: 'paid_count', aggregate: 'count', filter: { status: 'paid' } },
    { name: 'totalled_count', aggregate: 'count', field: 'total' },
    { name: 'subtotal_sum', aggregate: 'sum', field: 'total' },
    { name: 'paid_rate', derived: { op: 'ratio', of: ['paid_count', 'invoice_count'] } },
  ],
});

describe('[#30526] on a real engine, a drill composed with the scope lists exactly what the number counted', () => {
  let engine: ObjectQL;
  const faces: Record<'native' | 'objectql', AnalyticsService> = {} as never;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: ACCOUNT,
      label: 'Account',
      fields: { tier: { name: 'tier', type: 'text' } },
    } as never);
    engine.registry.registerObject({
      name: OBJECT,
      label: 'Invoice',
      fields: {
        region: { name: 'region', type: 'text' },
        kind: { name: 'kind', type: 'text' },
        status: { name: 'status', type: 'text' },
        channel: { name: 'channel', type: 'text' },
        total: { name: 'total', type: 'number' },
        account: { name: 'account', type: 'lookup', reference: ACCOUNT },
        issued_at: { name: 'issued_at', type: 'datetime' },
        paid_at: { name: 'paid_at', type: 'datetime' },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    await engine.insert(ACCOUNT, { id: 'a1', tier: 'gold' } as never);
    await engine.insert(ACCOUNT, { id: 'a2', tier: 'silver' } as never);
    for (const inv of INVOICES) await engine.insert(OBJECT, { ...inv } as never);
    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      await new AnalyticsServicePlugin({ ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
        getService: (name: string) => (name === 'data' ? engine : registered[name]),
        registerService: (name: string, svc: unknown) => { registered[name] = svc; },
        replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
        hook: () => {},
        logger: quiet,
      } as never);
      faces[face] = registered.analytics as AnalyticsService;
    }
  });
  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  /** What the drill on row `i` × `measure` lists: bucket AND runtime filter AND scope, as a host composes it. */
  async function drilled(answer: AnalyticsResult, i: number, measure: string, runtimeFilter?: Record<string, unknown>) {
    const bucket: Record<string, unknown> = {};
    for (const [dim, field] of Object.entries(answer.dimensionFields ?? {})) bucket[field] = answer.drillRawRows![i][dim];
    const where = { $and: [bucket, ...(runtimeFilter ? [runtimeFilter] : []), answer.drillScopes![measure]] };
    return (await engine.find(OBJECT, { where, fields: ['id', 'total', 'issued_at', 'paid_at'] } as never)) as Array<{
      id: string; total: number | null; issued_at: string | null; paid_at: string | null;
    }>;
  }

  for (const face of ['native', 'objectql'] as const) {
    for (const runtimeFilter of [undefined, { channel: 'web' }]) {
      it(`${face} face${runtimeFilter ? ', under a widget filter' : ''}: every count lists as many records as it says, and the sum adds up`, async () => {
        const answer = await faces[face].queryDataset(
          invoices,
          { dimensions: ['region'], measures: ['invoice_count', 'paid_count', 'totalled_count', 'subtotal_sum', 'paid_rate'], ...(runtimeFilter ? { runtimeFilter } : {}) },
          CTX,
        );
        expect(answer.rows.length).toBe(2);
        expect(Object.keys(answer.drillScopes!).sort()).toEqual(['invoice_count', 'paid_count', 'subtotal_sum', 'totalled_count']);
        for (const [i, row] of answer.rows.entries()) {
          for (const m of ['invoice_count', 'paid_count', 'totalled_count']) {
            expect((await drilled(answer, i, m, runtimeFilter)).length, `${row.region} ${m}`).toBe(Number(row[m]));
          }
          const summed = (await drilled(answer, i, 'subtotal_sum', runtimeFilter)).reduce((s, r) => s + Number(r.total), 0);
          expect(summed, `${row.region} subtotal_sum`).toBe(Number(row.subtotal_sum));
        }
      });
    }
  }

  it('CONTROL the bucket and the widget filter alone list more than paid_count counts — the gap the scope closes', async () => {
    const answer = await faces.native.queryDataset(invoices, { dimensions: ['region'], measures: ['paid_count'] }, CTX);
    const emea = answer.rows.findIndex((r) => r.region === 'emea');
    const bucketOnly = (await engine.find(OBJECT, { where: { region: 'emea' }, fields: ['id'] } as never)) as unknown[];
    expect(Number(answer.rows[emea].paid_count)).toBe(2);
    expect(bucketOnly.length).toBe(4);
    expect((await drilled(answer, emea, 'paid_count')).map((r) => r.id).sort()).toEqual(['i1', 'i2']);
  });

  it('a duration measure (native face, SQLite) drills the records with both instants set, and their mean is the number', async () => {
    const timed = DatasetSchema.parse({
      ...invoices,
      name: 'invoices_timed_30526',
      measures: [{ name: 'days_to_pay', aggregate: 'avg', duration: { from: 'issued_at', to: 'paid_at', unit: 'days' }, filter: { status: 'paid' } }],
    });
    const answer = await faces.native.queryDataset(timed, { dimensions: ['region'], measures: ['days_to_pay'] }, CTX);
    expect(answer.drillScopes).toEqual({
      days_to_pay: { $and: [{ kind: 'sale' }, { status: 'paid' }, { issued_at: { $null: false } }, { paid_at: { $null: false } }] },
    });
    for (const [i, row] of answer.rows.entries()) {
      const listed = await drilled(answer, i, 'days_to_pay');
      const days = listed.map((r) => (Date.parse(String(r.paid_at)) - Date.parse(String(r.issued_at))) / 86_400_000);
      expect(days.reduce((s, d) => s + d, 0) / days.length, String(row.region)).toBeCloseTo(Number(row.days_to_pay), 9);
    }
  });

  it('a nested-relation DATASET filter keeps its scope, and the record list serves it: the drill lists what the number counted', async () => {
    const nested = DatasetSchema.parse({
      ...invoices,
      name: 'invoices_nested_30526',
      filter: { account: { tier: 'gold' } },
      measures: [{ name: 'invoice_count', aggregate: 'count' }, { name: 'paid_count', aggregate: 'count', filter: { status: 'paid' } }],
    });
    for (const face of ['native', 'objectql'] as const) {
      const answer = await faces[face].queryDataset(nested, { dimensions: ['region'], measures: ['invoice_count', 'paid_count'] }, CTX);
      expect(answer.drillScopes, face).toEqual({
        invoice_count: { account: { tier: 'gold' } },
        paid_count: { $and: [{ account: { tier: 'gold' } }, { status: 'paid' }] },
      });
      for (const [i, row] of answer.rows.entries()) {
        for (const m of ['invoice_count', 'paid_count']) {
          expect((await drilled(answer, i, m)).length, `${face} ${row.region} ${m}`).toBe(Number(row[m]));
        }
      }
    }
  });

  it('a relationship path in a measure\'s or the dataset\'s filter (native face, which joins it) leaves that scope out', async () => {
    const joined = DatasetSchema.parse({
      ...invoices,
      name: 'invoices_joined_30526',
      include: ['account'],
      measures: [
        { name: 'invoice_count', aggregate: 'count' },
        { name: 'gold_dotted', aggregate: 'count', filter: { 'account.tier': 'gold' } },
      ],
    });
    const answer = await faces.native.queryDataset(joined, { dimensions: ['region'], measures: ['invoice_count', 'gold_dotted'] }, CTX);
    expect(answer.rows.map((r) => [r.region, Number(r.gold_dotted)]).sort()).toEqual([['apac', 1], ['emea', 2]]);
    expect(answer.drillScopes).toEqual({ invoice_count: { kind: 'sale' } });

    const scoped = DatasetSchema.parse({ ...joined, name: 'invoices_joined_scope_30526', filter: { 'account.tier': 'gold' } });
    const whole = await faces.native.queryDataset(scoped, { dimensions: ['region'], measures: ['invoice_count'] }, CTX);
    expect(whole.rows.length).toBe(2);
    expect(whole.drillScopes).toEqual({});
  });

  it('CONTROL the record list refuses a relationship path as a filter key, which is why such a scope is left out', async () => {
    const err = await engine.find(OBJECT, { where: { 'account.tier': 'gold' } } as never).then(() => null, (e: { code?: string; status?: number }) => e);
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_FIELD', status: 400 });
  });
});
