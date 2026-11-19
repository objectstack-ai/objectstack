/**
 * [#34886] `aggregate_records` grouped by a path through relations — the
 * card's `purchase_order.requisition.requester.department.name`, four hops
 * from a purchase-order line — over the HTTP MCP bridge (`buildMcpBridge`,
 * `domains/mcp.ts`), the real `ObjectQL` engine and a real SQLite database.
 *
 * `groupBy` groups by the columns of the aggregated object itself: the REST
 * query door refuses a dotted entry at ingress ("a related record's column
 * cannot be a grouping target"), but the MCP bridge reaches `engine.aggregate`
 * through `callData`, past that door. Measured on `origin/main` `b3247ddbdc`
 * with `SqlDriver` on SQLite, before the engine door below: a path of one or
 * two hops reached the database and came back as the driver's missing-column
 * backstop (`INVALID_FIELD` / 400, advising a schema sync); three or four hops
 * came back `DATABASE_ERROR` / 500, which an agent cannot read as "change the
 * approach".
 *
 * Pinned: the engine refuses a relation path in `groupBy` at any depth with
 * `INVALID_FIELD` / 400, naming the path at its position, before the driver
 * runs any statement — on both bridge members `aggregate_records` calls (the
 * uncut aggregate and the ordered-and-cut one), in both `groupBy` forms. The
 * same arm refuses every other dotted name the object does not declare: a path
 * into a stored value (`address.city` on a json field) and the object's own
 * name as a qualifier, each worded without relation hops.
 * CONTROL: grouping by the relation field itself (the supported depth) is
 * served by the database. The tool's rendering of a 4xx refusal (code, status
 * and message kept) is pinned in `@objectstack/mcp`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The bridge's module graph reaches a dynamic `import('@objectstack/metadata')`;
// paid here, at collection, never inside a clocked case.
import '@objectstack/metadata';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { buildMcpBridge } from './domains/mcp.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

const lookup = (name: string, reference: string) => ({ name, label: name, type: 'lookup', reference });
const text = (name: string) => ({ name, label: name, type: 'text' });

const OBJECTS = [
  { name: 'rp_department', label: 'Department', fields: { name: text('name') } },
  { name: 'rp_requester', label: 'Requester', fields: { name: text('name'), department: lookup('department', 'rp_department') } },
  { name: 'rp_requisition', label: 'Requisition', fields: { name: text('name'), requester: lookup('requester', 'rp_requester') } },
  { name: 'rp_purchase_order', label: 'Purchase order', fields: { name: text('name'), requisition: lookup('requisition', 'rp_requisition') } },
  {
    name: 'rp_po_line',
    label: 'Purchase order line',
    fields: {
      amount: { name: 'amount', label: 'Amount', type: 'number' },
      purchase_order: lookup('purchase_order', 'rp_purchase_order'),
      address: { name: 'address', label: 'Address', type: 'json' },
    },
  },
];
const LINE = 'rp_po_line';
const FOUR_HOPS = 'purchase_order.requisition.requester.department.name';
const SUM = [{ function: 'sum' as const, field: 'amount', alias: 'total' }];

async function caught(run: () => Promise<unknown>): Promise<any> {
  return run().then(() => expect.fail('expected the aggregate to be refused, but it answered'), (e: unknown) => e);
}

describe('[#34886] aggregate_records grouped by a relation path, over a real SQLite database', () => {
  let driver: SqlDriver;
  let bridge: any;
  const statements: string[] = [];

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects(OBJECTS as never);
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const def of OBJECTS) engine.registry.registerObject(def as any);
    await driver.create('rp_department', { id: 'd1', name: 'Ops' });
    await driver.create('rp_requester', { id: 'u1', name: 'Ann', department: 'd1' });
    await driver.create('rp_requisition', { id: 'r1', name: 'R-1', requester: 'u1' });
    await driver.create('rp_purchase_order', { id: 'po1', name: 'PO-1', requisition: 'r1' });
    await driver.create('rp_purchase_order', { id: 'po2', name: 'PO-2', requisition: 'r1' });
    await driver.create(LINE, { id: 'l1', amount: 10, purchase_order: 'po1', address: { city: 'Oslo' } });
    await driver.create(LINE, { id: 'l2', amount: 5, purchase_order: 'po1', address: { city: 'Oslo' } });
    await driver.create(LINE, { id: 'l3', amount: 7, purchase_order: 'po2', address: { city: 'Bergen' } });
    (driver as unknown as { knex: { on: Function } }).knex.on('query', (q: { sql: string }) => { statements.push(q.sql); });
    const deps = {
      resolveService: async (_ctx: unknown, name: string) => (name === 'objectql' ? engine : undefined),
      getObjectQL: async () => engine,
    };
    const context = { request: {}, executionContext: { isSystem: true } } as unknown as HttpProtocolContext;
    bridge = buildMcpBridge(deps as any, context) as any;
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  const grouped = () => statements.filter((s) => /group by/i.test(s));

  it.each([
    ['four hops (the card)', FOUR_HOPS],
    ['three hops', 'purchase_order.requisition.requester.name'],
    ['one hop', 'purchase_order.name'],
  ])('%s: refused INVALID_FIELD / 400 naming the path, and no statement reaches the database', async (_label, path) => {
    statements.length = 0;
    const err = await caught(() => bridge.aggregate(LINE, { groupBy: [path], aggregations: SUM }));
    expect({ code: err?.code, status: err?.status, field: err?.field, path: err?.path })
      .toEqual({ code: 'INVALID_FIELD', status: 400, field: path, path: 'groupBy.0' });
    expect(String(err.message)).toContain(path);
    expect(statements, statements.join('\n')).toHaveLength(0);
  });

  // [#34886] The arm refuses ANY dotted name the object does not declare, not
  // only a relation path; for a head that is no relation the words name no hops.
  it.each([
    ['a path into a stored value (a json head)', 'address.city'],
    ["the object's own name as a qualifier (no field by that name)", `${LINE}.amount`],
  ])('%s: refused INVALID_FIELD / 400 at groupBy.0, worded without relation hops, and no statement runs', async (_label, path) => {
    statements.length = 0;
    const err = await caught(() => bridge.aggregate(LINE, { groupBy: [path], aggregations: SUM }));
    expect({ code: err?.code, status: err?.status, field: err?.field, path: err?.path })
      .toEqual({ code: 'INVALID_FIELD', status: 400, field: path, path: 'groupBy.0' });
    expect(String(err.message)).toContain(path);
    expect(String(err.message)).not.toMatch(/relation hop/);
    expect(statements, statements.join('\n')).toHaveLength(0);
  });

  it('the object form is refused at its field position, after a plain key it keeps', async () => {
    statements.length = 0;
    const err = await caught(() => bridge.aggregate(LINE, { groupBy: ['purchase_order', { field: FOUR_HOPS }], aggregations: SUM }));
    expect({ code: err?.code, status: err?.status, field: err?.field, path: err?.path })
      .toEqual({ code: 'INVALID_FIELD', status: 400, field: FOUR_HOPS, path: 'groupBy.1.field' });
    expect(statements, statements.join('\n')).toHaveLength(0);
  });

  it('the ordered and cut member (an orderBy or a limit) is refused the same way', async () => {
    statements.length = 0;
    const err = await caught(() => bridge.aggregateGroups(LINE, {
      groupBy: [FOUR_HOPS], aggregations: SUM, orderBy: [{ field: 'total', order: 'desc' }], limit: 5,
    }));
    expect({ code: err?.code, status: err?.status, field: err?.field, path: err?.path })
      .toEqual({ code: 'INVALID_FIELD', status: 400, field: FOUR_HOPS, path: 'groupBy.0' });
    expect(statements, statements.join('\n')).toHaveLength(0);
  });

  it('CONTROL — grouping by the relation field itself is answered by the database', async () => {
    statements.length = 0;
    const rows = await bridge.aggregate(LINE, { groupBy: ['purchase_order'], aggregations: SUM });
    expect([...rows].sort((a: any, b: any) => String(a.purchase_order).localeCompare(String(b.purchase_order))))
      .toEqual([{ purchase_order: 'po1', total: 15 }, { purchase_order: 'po2', total: 7 }]);
    expect(grouped(), statements.join('\n')).toHaveLength(1);
  });
});
