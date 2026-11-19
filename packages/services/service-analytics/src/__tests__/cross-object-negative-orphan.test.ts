// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cross-object leaf (`'order.status'`, and through two hops) never selects a
 * detail row that has no parent — on the native SQL strategy as on the engine path and
 * the `/data` nested-relation filter — outside `$not`, for every operator pinned
 * below, `$nin: []` included (#34384). One native answer still selects one and
 * is not pinned here: under `$not`, a condition a missing value does not
 * satisfy (`{ $not: { 'order.status': 'open' } }`, `$null: false`; the engine
 * refuses the shape).
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
 * Measured on `origin/main` `5a755791a9` with this fixture (two orphans: `l7`
 * with an empty relation, `l8` naming a parent that is gone), before the
 * change, as `count / sum(amount)`:
 *
 * | `where` on `order.status`        | native, before | engine and `/data` (and native, now) |
 * |:--|:--|:--|
 * | `$ne 'open'`, `$nin ['open']`, `$notContains 'pe'` | 6 / 6600 | 4 / 600 |
 * | `$null: true`, `$eq: null`, `$empty: true`, `$exists: false` | 3 / 6300 | 1 / 300 |
 * | `$ne 'cancelled'`                                   | 5 / 6302 | 3 / 302 |
 * | two hops, `order.customer.tier $ne 'gold'`          | 6 / 6600 | 3 / 300 |
 * | two hops, `order.customer.tier $null: true`         | 3 / 6300 | 0 / 0   |
 *
 * `$eq 'cancelled'` agreed before and after (3 / 300): a positive comparison is
 * UNKNOWN on a NULL, so it never selected an orphan.
 * A measure's own `filter` (`$ne 'open'`: 6 / 6600 before, 4 / 600 now) and the
 * dataset's own `filter` (`$null: true`: 3 / 6300 before, 1 / 300 now) go
 * through the same compile and moved the same way.
 *
 * ## What holds now
 *
 * A joined leaf that a NULL column satisfies (`notSet`, `empty`, `notContains`)
 * is evaluated on an existing parent: the native compile conjoins the last
 * hop's `"ALIAS"."id" = "ALIAS"."id"` to it: TRUE for an existing parent and
 * UNKNOWN for an orphan, so a `$not` cannot flip it. Every other leaf is UNKNOWN on a NULL
 * and its statement does not move. A parent that exists
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

const CUSTOMER = 'os33792_customer';
const ORDER = 'os33792_order';
const LINE = 'os33792_line';

const CUSTOMERS = [
  { id: 'c1', tier: 'gold' },
  { id: 'c2', tier: 'silver' },
] as const;
const ORDERS = [
  { id: 'o1', status: 'open', customer: 'c1' },
  { id: 'o2', status: 'cancelled', customer: 'c2' },
  { id: 'o3' }, // exists, with no status and no customer: `$ne` selects its lines (#5298)
  { id: 'o9', status: 'cancelled' }, // removed after its line is written, leaving `l8` naming no record
] as const;
const LINES = [
  { id: 'l1', amount: 1, order: 'o1' },
  { id: 'l2', amount: 1, order: 'o1' },
  { id: 'l3', amount: 100, order: 'o2' },
  { id: 'l4', amount: 100, order: 'o2' },
  { id: 'l5', amount: 100, order: 'o2' },
  { id: 'l6', amount: 300, order: 'o3' },
  { id: 'l7', amount: 1000 }, // an orphan: no parent
  { id: 'l8', amount: 5000, order: 'o9' }, // an orphan: its parent is removed below, behind the engine
] as const;

const DATASET = DatasetSchema.parse({
  name: 'os33792_lines',
  label: 'Lines',
  object: LINE,
  include: ['order', 'order.customer'],
  dimensions: [{ name: 'amount', field: 'amount', type: 'number' }],
  measures: [
    { name: 'line_count', aggregate: 'count' },
    { name: 'total', aggregate: 'sum', field: 'amount' },
  ],
});

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Face = 'native' | 'objectql';

describe('a cross-object leaf never selects an orphan detail row, on the native strategy as on the engine', () => {
  let engine: ObjectQL;
  const services: Partial<Record<Face, AnalyticsService>> = {};

  const totals = async (face: Face, where: Record<string, unknown>) => {
    const res = await services[face]!.queryDataset(DATASET, { measures: ['line_count', 'total'], runtimeFilter: where } as never);
    const [row] = res.rows as Array<Record<string, unknown>>;
    return { n: Number(row?.line_count ?? 0), total: Number(row?.total ?? 0) };
  };
  const dataIds = async (where: Record<string, unknown>) =>
    ((await engine.find(LINE, { where } as never)) as Array<{ id: string }>).map((r) => r.id).sort();

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: CUSTOMER,
      label: 'Customer',
      fields: { tier: { name: 'tier', type: 'text' } },
    } as never);
    engine.registry.registerObject({
      name: ORDER,
      label: 'Order',
      fields: {
        status: { name: 'status', type: 'text' },
        customer: { name: 'customer', type: 'lookup', reference: CUSTOMER },
      },
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
    for (const row of CUSTOMERS) await engine.insert(CUSTOMER, { ...row } as never);
    for (const row of ORDERS) await engine.insert(ORDER, { ...row } as never);
    for (const row of LINES) await engine.insert(LINE, { ...row } as never);
    // A reference the engine would refuse to write, reached the way a stored row
    // reaches it: the parent goes away underneath (an import, a direct write).
    expect(await driver.delete(ORDER, 'o9')).toBeTruthy();

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
    ['$eq null', { 'order.status': { $eq: null } }, { order: { status: { $eq: null } } }, ['l6']],
    ['$empty true', { 'order.status': { $empty: true } }, { order: { status: { $empty: true } } }, ['l6']],
    ['$exists false', { 'order.status': { $exists: false } }, { order: { status: { $exists: false } } }, ['l6']],
    ["$ne 'cancelled'", { 'order.status': { $ne: 'cancelled' } }, { order: { status: { $ne: 'cancelled' } } }, ['l1', 'l2', 'l6']],
    // An empty `$nin` excludes no value, so it selects every line whose order exists, and no orphan.
    ['$nin []', { 'order.status': { $nin: [] } }, { order: { status: { $nin: [] } } }, ['l1', 'l2', 'l3', 'l4', 'l5', 'l6']],
    // A positive operator never selected an orphan: the comparison is UNKNOWN on a NULL. Unchanged.
    ["$eq 'cancelled'", { 'order.status': { $eq: 'cancelled' } }, { order: { status: { $eq: 'cancelled' } } }, ['l3', 'l4', 'l5']],
  ];
  const sumOf = (ids: string[]) => LINES.filter((l) => ids.includes(l.id)).reduce((s, l) => s + l.amount, 0);

  for (const [label, where, nested, expected] of CASES) {
    it(`order.status ${label}: native, engine and /data select the same lines, the orphan not among them`, async () => {
      expect(await dataIds(nested), '/data').toEqual(expected);
      const want = { n: expected.length, total: sumOf(expected) };
      for (const face of ['native', 'objectql'] as const) {
        expect.soft(await totals(face, where), face).toEqual(want);
      }
    });
  }

  // Two hops: the leaf is evaluated on the record the LAST hop reaches, so a line
  // whose order has no customer is not selected either (`l6`, on `o3`).
  const TWO_HOP: Array<[string, Record<string, unknown>, Record<string, unknown>, string[]]> = [
    ["$ne 'gold'", { 'order.customer.tier': { $ne: 'gold' } }, { order: { customer: { tier: { $ne: 'gold' } } } }, ['l3', 'l4', 'l5']],
    ['$null true', { 'order.customer.tier': { $null: true } }, { order: { customer: { tier: { $null: true } } } }, []],
    ['$nin []', { 'order.customer.tier': { $nin: [] } }, { order: { customer: { tier: { $nin: [] } } } }, ['l1', 'l2', 'l3', 'l4', 'l5']],
  ];
  for (const [label, where, nested, expected] of TWO_HOP) {
    it(`order.customer.tier ${label}: native, engine and /data select the same lines`, async () => {
      expect(await dataIds(nested), '/data').toEqual(expected);
      const want = { n: expected.length, total: sumOf(expected) };
      for (const face of ['native', 'objectql'] as const) {
        expect.soft(await totals(face, where), face).toEqual(want);
      }
    });
  }

  it('the native statement over the inferred cube evaluates the joined leaf on an existing parent', async () => {
    // A cube query with no time bucket, served natively: the statement, and its answer.
    const query = { cube: LINE, measures: ['count'], where: { 'order.status': { $ne: 'open' } } };
    const { sql } = await services.native!.generateSql(query as never);
    const res = await services.native!.query(query as never);
    expect(sql).toContain('LEFT JOIN "os33792_order" "order" ON');
    // The lowering's NULL-safe escape is evaluated on an existing parent; the
    // comparison, UNKNOWN on a NULL, is left as it was.
    expect(sql).toContain('(("order"."status" IS NULL AND "order"."id" = "order"."id") OR "order"."status" != $1)');
    expect(Number((res.rows as Array<Record<string, unknown>>)[0]?.count)).toBe(4);

    // Two hops: the key of the last hop's join alias.
    const twoHop = await services.native!.generateSql({
      cube: LINE,
      measures: ['count'],
      where: { 'order.customer.tier': { $ne: 'gold' } },
    } as never);
    expect(twoHop.sql).toContain('"order__customer"."tier" IS NULL AND "order__customer"."id" = "order__customer"."id"');

    // A positive leaf takes no conjunct: its statement is the one it always was.
    const positive = await services.native!.generateSql({ cube: LINE, measures: ['count'], where: { 'order.status': 'open' } } as never);
    expect(positive.sql).toMatch(/ WHERE "order"\."status" = \$1$/);
  });

  it('an author keeps the rows with an empty relation by naming the base relation field, which reads no join', async () => {
    const where = { $or: [{ 'order.status': { $ne: 'open' } }, { order: { $null: true } }] };
    const expected = ['l3', 'l4', 'l5', 'l6', 'l7'];
    expect(await dataIds({ $or: [{ order: { status: { $ne: 'open' } } }, { order: { $null: true } }] }), '/data').toEqual(expected);
    for (const face of ['native', 'objectql'] as const) {
      expect.soft(await totals(face, where), face).toEqual({ n: expected.length, total: sumOf(expected) });
    }
  });

  // Under `$not` the native answer is the one it was before the conjunct existed:
  // the lowering hands a `$not` operand the same `notSet` / `empty` /
  // `notContains` leaves, and a conjunct that were FALSE for an orphan would let
  // the `NOT` select it. The engine path refuses a related-field condition under
  // `$not` (`negated`), so this is the native face alone, held to its own answer
  // on `origin/main` `5a755791a9`.
  const NEGATED: Array<[string, Record<string, unknown>, string[]]> = [
    ['$not $null true', { $not: { 'order.status': { $null: true } } }, ['l1', 'l2', 'l3', 'l4', 'l5']],
    ['$not $eq null', { $not: { 'order.status': { $eq: null } } }, ['l1', 'l2', 'l3', 'l4', 'l5']],
    ['$not $empty true', { $not: { 'order.status': { $empty: true } } }, ['l1', 'l2', 'l3', 'l4', 'l5']],
    ["$not $notContains 'pe'", { $not: { 'order.status': { $notContains: 'pe' } } }, ['l1', 'l2']],
    ["$not $ne 'open'", { $not: { 'order.status': { $ne: 'open' } } }, ['l1', 'l2']],
    // Inside a combinator under the `NOT`: an orphan's leaf never decides the branch.
    ['$not $or [$null true, amount > 2000]', { $not: { $or: [{ 'order.status': { $null: true } }, { amount: { $gt: 2000 } }] } }, ['l1', 'l2', 'l3', 'l4', 'l5']],
    // …and where main's answer DOES select an orphan (`l8`: its `amount` sinks the `$and`), it still does.
    ['$not $and [$null true, amount < 2000]', { $not: { $and: [{ 'order.status': { $null: true } }, { amount: { $lt: 2000 } }] } }, ['l1', 'l2', 'l3', 'l4', 'l5', 'l8']],
    // Two hops, the last hop's key.
    ['$not two-hop $null true', { $not: { 'order.customer.tier': { $null: true } } }, ['l1', 'l2', 'l3', 'l4', 'l5']],
    // An empty `$nin` negated: no line, before and now.
    ['$not $nin []', { $not: { 'order.status': { $nin: [] } } }, []],
  ];
  for (const [label, where, expected] of NEGATED) {
    it(`native, ${label}: the answer it gave before the conjunct`, async () => {
      expect(await totals('native', where)).toEqual({ n: expected.length, total: sumOf(expected) });
    });
  }

  // The same compile serves the two other filter positions of a dataset: a
  // measure's own `filter` (the conditional aggregate) and the dataset's own
  // `filter`. Both moved with `where` (native, before: 6 / 6600 and 3 / 6300).
  // The engine path refuses a related field in a measure's `filter`, so that
  // position is the native face alone.
  it("a measure's own filter leaves the orphan out of its conditional aggregate (native)", async () => {
    const notOpen = { 'order.status': { $ne: 'open' } };
    const scoped = DatasetSchema.parse({
      ...DATASET,
      name: 'os33792_lines_measure_filter',
      measures: [
        { name: 'line_count', aggregate: 'count', filter: notOpen },
        { name: 'total', aggregate: 'sum', field: 'amount', filter: notOpen },
      ],
    });
    const res = await services.native!.queryDataset(scoped, { measures: ['line_count', 'total'] } as never);
    const [row] = res.rows as Array<Record<string, unknown>>;
    const expected = ['l3', 'l4', 'l5', 'l6'];
    expect({ n: Number(row?.line_count), total: Number(row?.total) }).toEqual({ n: expected.length, total: sumOf(expected) });
  });

  it("the dataset's own filter leaves the orphan out, native and engine alike", async () => {
    const scoped = DatasetSchema.parse({ ...DATASET, name: 'os33792_lines_dataset_filter', filter: { 'order.status': { $null: true } } });
    for (const face of ['native', 'objectql'] as const) {
      const res = await services[face]!.queryDataset(scoped, { measures: ['line_count', 'total'] } as never);
      const [row] = res.rows as Array<Record<string, unknown>>;
      expect.soft({ n: Number(row?.line_count ?? 0), total: Number(row?.total ?? 0) }, face).toEqual({ n: 1, total: sumOf(['l6']) });
    }
  });

  it('native: `$not` over `$null: true` answers what `$null: false` answers', async () => {
    expect(await totals('native', { $not: { 'order.status': { $null: true } } }))
      .toEqual(await totals('native', { 'order.status': { $null: false } }));
  });

  // Two `$not`s over a leaf a NULL satisfies cancel: the conjunct makes the
  // leaf UNKNOWN for an orphan, and `NOT (NOT UNKNOWN)` is UNKNOWN, so the
  // answer is the un-negated leaf's. On `origin/main` `5a755791a9`, before the
  // conjunct, the inner `NOT` was FALSE for an orphan and the outer one TRUE,
  // so both orphans were selected (3 / 6300). The engine path refuses the shape
  // (`negated`), so this is the native face alone.
  it('native: `$not` over `$not` over `$null: true` answers what `$null: true` answers', async () => {
    const twice = await totals('native', { $not: { $not: { 'order.status': { $null: true } } } });
    expect(twice).toEqual({ n: 1, total: sumOf(['l6']) });
    expect(twice).toEqual(await totals('native', { 'order.status': { $null: true } }));
  });

  // [#34384] `$nin: []` lowers to the NULL escape around a constant TRUE. On a
  // joined member that TRUE is evaluated on an existing parent too, as every
  // other leaf a NULL satisfies is; on a base column it stays the constant.
  it('native: an empty `$nin` on a joined member is the last hop key, on a base column the constant TRUE', async () => {
    const joined = await services.native!.generateSql({ cube: LINE, measures: ['count'], where: { 'order.status': { $nin: [] } } } as never);
    expect(joined.sql).toContain('LEFT JOIN "os33792_order" "order" ON');
    expect(joined.sql).toContain('(("order"."status" IS NULL AND "order"."id" = "order"."id") OR "order"."id" = "order"."id")');
    expect(joined.sql).not.toContain('1 = 1');

    const twoHop = await services.native!.generateSql({ cube: LINE, measures: ['count'], where: { 'order.customer.tier': { $nin: [] } } } as never);
    expect(twoHop.sql).toContain('OR "order__customer"."id" = "order__customer"."id")');

    const base = await services.native!.generateSql({ cube: LINE, measures: ['count'], where: { amount: { $nin: [] } } } as never);
    expect(base.sql).not.toContain('JOIN');
    expect(base.sql).toContain('1 = 1');
  });

  it("an empty `$nin` in a measure's own filter: native leaves the orphan out, the engine refuses it as every related field there", async () => {
    const scoped = DatasetSchema.parse({
      ...DATASET,
      name: 'os34384_lines_measure_filter_empty_nin',
      measures: [
        { name: 'line_count', aggregate: 'count', filter: { 'order.status': { $nin: [] } } },
        { name: 'total', aggregate: 'sum', field: 'amount' },
      ],
    });
    const res = await services.native!.queryDataset(scoped, { measures: ['line_count'] } as never);
    const [row] = res.rows as Array<Record<string, unknown>>;
    expect(Number(row?.line_count)).toBe(6);
    await expect(services.objectql!.queryDataset(scoped, { measures: ['line_count'] } as never))
      .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400 });
  });

  it("an empty `$nin` in the dataset's own filter leaves the orphan out, native and engine alike", async () => {
    const scoped = DatasetSchema.parse({ ...DATASET, name: 'os34384_lines_dataset_filter_empty_nin', filter: { 'order.status': { $nin: [] } } });
    const expected = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
    for (const face of ['native', 'objectql'] as const) {
      const res = await services[face]!.queryDataset(scoped, { measures: ['line_count', 'total'] } as never);
      const [row] = res.rows as Array<Record<string, unknown>>;
      expect.soft({ n: Number(row?.line_count ?? 0), total: Number(row?.total ?? 0) }, face).toEqual({ n: expected.length, total: sumOf(expected) });
    }
  });
});
