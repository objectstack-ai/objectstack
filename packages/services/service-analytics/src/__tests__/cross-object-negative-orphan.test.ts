// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A one-hop cross-object leaf (`'order.status'`) never selects a detail row
 * that has no parent — on the native SQL strategy as on the engine path and
 * the `/data` nested-relation filter — whatever the operator.
 *
 * ## What was wrong
 *
 * The shared lowering (`lowerFilterCondition`, rule 3) makes a negative leaf
 * NULL-safe as structure: `{ 'order.status': { $ne: 'open' } }` arrives as
 * `$or: [{ 'order.status': { $null: true } }, { 'order.status': { $ne: 'open' } }]`.
 * The native strategy reads a dotted member through a `LEFT JOIN`, and for a
 * detail row with no parent every joined column is NULL, so the escape arm
 * `"order"."status" IS NULL` was TRUE for the orphan and it was counted. The
 * engine path reads the parent first and keeps the rows whose relation field
 * names one of the parents that match (`cross-object-where.ts`: "no parent
 * never matches, whatever the operator"), so the same widget answered a
 * different total once a time bucket routed it to the engine.
 *
 * Measured on `origin/main` `5a755791a9` with this fixture, before the change:
 *
 * | `where`                               | native  | engine | `/data` |
 * |:--|:--|:--|:--|
 * | `order.status $ne 'open'`             | 5 / 1600 | 4 / 600 | 4 |
 * | `order.status $nin ['open']`          | 5 / 1600 | 4 / 600 | 4 |
 * | `order.status $notContains 'pe'`      | 5 / 1600 | 4 / 600 | 4 |
 * | `order.status $null true`             | 2 / 1100 | 1 / 100 | 1 |
 *
 * ## What holds now
 *
 * A leaf on a joined column is evaluated on an existing parent: the native
 * compile conjoins `"<hop alias>"."id" IS NOT NULL` to it. A parent that exists
 * with a NULL `status` still satisfies `$ne` (the #5298 ruling, unchanged), and
 * an author who wants the orphans says so on the base relation field
 * (`{ order: { $null: true } }`), which reads no join.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const ORDER = 'os33792_order';
const LINE = 'os33792_line';

const ORDERS = [
  { id: 'o1', status: 'open' },
  { id: 'o2', status: 'cancelled' },
  { id: 'o3' }, // exists, with no status: `$ne` selects its lines (#5298)
] as const;
const LINES = [
  { id: 'l1', amount: 1, order: 'o1' },
  { id: 'l2', amount: 1, order: 'o1' },
  { id: 'l3', amount: 100, order: 'o2' },
  { id: 'l4', amount: 100, order: 'o2' },
  { id: 'l5', amount: 100, order: 'o2' },
  { id: 'l6', amount: 300, order: 'o3' },
  { id: 'l7', amount: 1000 }, // the orphan: no parent
] as const;

const DATASET = DatasetSchema.parse({
  name: 'os33792_lines',
  label: 'Lines',
  object: LINE,
  include: ['order'],
  dimensions: [{ name: 'amount', field: 'amount', type: 'number' }],
  measures: [
    { name: 'n', aggregate: 'count' },
    { name: 'total', aggregate: 'sum', field: 'amount' },
  ],
});

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Face = 'native' | 'objectql';

describe('a one-hop cross-object leaf never selects an orphan detail row, on the native strategy as on the engine', () => {
  let engine: ObjectQL;
  const services: Partial<Record<Face, AnalyticsService>> = {};

  const totals = async (face: Face, where: Record<string, unknown>) => {
    const res = await services[face]!.queryDataset(DATASET, { measures: ['n', 'total'], runtimeFilter: where } as never);
    const [row] = res.rows as Array<Record<string, unknown>>;
    return { n: Number(row?.n ?? 0), total: Number(row?.total ?? 0), sql: (res as { sql?: string }).sql };
  };
  const dataIds = async (where: Record<string, unknown>) =>
    ((await engine.find(LINE, { where } as never)) as Array<{ id: string }>).map((r) => r.id).sort();

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: ORDER,
      label: 'Order',
      fields: { status: { name: 'status', type: 'text' } },
    } as never);
    engine.registry.registerObject({
      name: LINE,
      label: 'Line',
      fields: {
        amount: { name: 'amount', type: 'number' },
        order: { name: 'order', type: 'lookup', reference: ORDER },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    for (const row of ORDERS) await engine.insert(ORDER, { ...row } as never);
    for (const row of LINES) await engine.insert(LINE, { ...row } as never);

    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      const provided: Record<string, unknown> = { data: engine };
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

  // [where, the nested-relation spelling `/data` serves, the lines each answer selects]
  const CASES: Array<[string, Record<string, unknown>, Record<string, unknown>, string[]]> = [
    ["$ne 'open'", { 'order.status': { $ne: 'open' } }, { order: { status: { $ne: 'open' } } }, ['l3', 'l4', 'l5', 'l6']],
    ["$nin ['open']", { 'order.status': { $nin: ['open'] } }, { order: { status: { $nin: ['open'] } } }, ['l3', 'l4', 'l5', 'l6']],
    ["$notContains 'pe'", { 'order.status': { $notContains: 'pe' } }, { order: { status: { $notContains: 'pe' } } }, ['l3', 'l4', 'l5', 'l6']],
    ['$null true', { 'order.status': { $null: true } }, { order: { status: { $null: true } } }, ['l6']],
    ["$ne 'cancelled'", { 'order.status': { $ne: 'cancelled' } }, { order: { status: { $ne: 'cancelled' } } }, ['l1', 'l2', 'l6']],
  ];
  const sumOf = (ids: string[]) => LINES.filter((l) => ids.includes(l.id)).reduce((s, l) => s + l.amount, 0);

  for (const [label, where, nested, expected] of CASES) {
    it(`order.status ${label}: native, engine and /data select the same lines, the orphan not among them`, async () => {
      expect(await dataIds(nested), '/data').toEqual(expected);
      const want = { n: expected.length, total: sumOf(expected) };
      for (const face of ['native', 'objectql'] as const) {
        const got = await totals(face, where);
        expect({ n: got.n, total: got.total }, `${face}${got.sql ? `: ${got.sql}` : ''}`).toEqual(want);
      }
    });
  }

  it('the native statement evaluates the joined leaf on an existing parent', async () => {
    const { sql } = await services.native!.generateSql({
      cube: DATASET.name,
      measures: ['n'],
      where: { 'order.status': { $ne: 'open' } },
    } as never).catch(async () => (await totals('native', { 'order.status': { $ne: 'open' } })) as { sql: string });
    expect(sql).toContain('LEFT JOIN "os33792_order" "order" ON');
    expect(sql).toContain('"order"."id" IS NOT NULL AND "order"."status" IS NULL');
  });

  it('CONTROL: an author keeps the orphans by naming the base relation field, which reads no join', async () => {
    const where = { $or: [{ 'order.status': { $ne: 'open' } }, { order: { $null: true } }] };
    const expected = ['l3', 'l4', 'l5', 'l6', 'l7'];
    for (const face of ['native', 'objectql'] as const) {
      expect(await totals(face, where), face).toMatchObject({ n: expected.length, total: sumOf(expected) });
    }
  });
});
