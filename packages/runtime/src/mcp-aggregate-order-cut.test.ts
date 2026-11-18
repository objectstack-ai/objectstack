/**
 * [aggregate order and cut] End to end over a real SQLite database: the HTTP
 * MCP bridge's `aggregateGroups` (`buildMcpBridge`, `domains/mcp.ts`) — the
 * member `aggregate_records` calls for an `orderBy` / `limit` — reaches the
 * real `ObjectQL` engine and the real `SqlDriver` through `callData`'s
 * aggregate arm, and the order, the cut and the group count are the
 * database's own statement.
 *
 * Pinned: a top five over more customers than the tool's row cap answers
 * exactly five, in order, with the true number of groups; an order by a group
 * key ascending; an order key naming no column of the aggregated row refused
 * `INVALID_SORT` with the columns named; `aggregate` with no order answers as
 * before; and the statement the driver ran carries the ORDER BY, the LIMIT and
 * `count(*) over ()` — so a sort in the application cannot pass. The tool's
 * half (the probe group, `truncated`, the rendering) is pinned in
 * `@objectstack/mcp` (`mcp-http-tools.aggregation-entry.test.ts`), which this
 * package does not depend on.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The bridge's module graph reaches a dynamic `import('@objectstack/metadata')`;
// paid here, at collection, never inside a clocked case.
import '@objectstack/metadata';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { buildMcpBridge } from './domains/mcp.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

const OBJECT = 'oc_e2e_order';
const DEF = {
  name: OBJECT,
  label: 'Order',
  fields: {
    customer: { name: 'customer', label: 'Customer', type: 'text' },
    amount: { name: 'amount', label: 'Amount', type: 'number' },
  },
};
/** More customers than the tool's row cap (50): `cNN` totals `NN * 10 + 5`. */
const CUSTOMERS = 70;
const REVENUE = { groupBy: ['customer'], aggregations: [{ function: 'sum' as const, field: 'amount', alias: 'revenue' }] };

describe('[aggregate order and cut] the HTTP MCP bridge over a real SQLite database', () => {
  let driver: SqlDriver;
  let engine: ObjectQL;
  let bridge: any;
  const statements: string[] = [];

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([DEF] as never);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(DEF as any);
    for (let i = 0; i < CUSTOMERS; i++) {
      const customer = `c${String(i).padStart(2, '0')}`;
      await driver.create(OBJECT, { id: `${customer}-a`, customer, amount: i * 10 });
      await driver.create(OBJECT, { id: `${customer}-b`, customer, amount: 5 });
    }
    (driver as unknown as { knex: { on: Function } }).knex.on('query', (q: { sql: string }) => { statements.push(q.sql); });
    const deps = {
      resolveService: async (_ctx: unknown, name: string) => (name === 'objectql' ? engine : undefined),
      getObjectQL: async () => engine,
    };
    const context = { request: {}, executionContext: { isSystem: true } } as unknown as HttpProtocolContext;
    bridge = buildMcpBridge(deps as any, context);
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('top five by revenue over more customers than the cap: exactly five, in order, with the true number of groups', async () => {
    statements.length = 0;
    const answer = await bridge.aggregateGroups(OBJECT, { ...REVENUE, orderBy: [{ field: 'revenue', order: 'desc' }], limit: 5 });
    expect(answer).toEqual({
      rows: [
        { customer: 'c69', revenue: 695 },
        { customer: 'c68', revenue: 685 },
        { customer: 'c67', revenue: 675 },
        { customer: 'c66', revenue: 665 },
        { customer: 'c65', revenue: 655 },
      ],
      groupCount: CUSTOMERS,
    });
    // One statement: grouped, counted, ordered and cut in the database.
    const ran = statements.filter((s) => /group by/i.test(s));
    expect(ran, statements.join('\n')).toHaveLength(1);
    expect(ran[0]).toMatch(/count\(\*\) over \(\)/i);
    expect(ran[0]).toMatch(/order by coalesce\([^)]*revenue[^)]*, 0\) desc/i);
    expect(ran[0]).toMatch(/limit \?/i);
  });

  it('ordered by a group key, ascending', async () => {
    const answer = await bridge.aggregateGroups(OBJECT, { ...REVENUE, orderBy: [{ field: 'customer', order: 'asc' }], limit: 3 });
    expect(answer.rows.map((r: any) => r.customer)).toEqual(['c00', 'c01', 'c02']);
    expect(answer.groupCount).toBe(CUSTOMERS);
  });

  it('a declared order (a rank on a group key) reaches the statement: the listed groups first, in their order', async () => {
    statements.length = 0;
    const answer = await bridge.aggregateGroups(OBJECT, {
      ...REVENUE,
      orderBy: [{ field: 'customer', order: 'asc', rank: ['c03', 'c01', 'c02'] }],
      limit: 3,
    });
    expect(answer.rows.map((r: any) => r.customer)).toEqual(['c03', 'c01', 'c02']);
    expect(answer.groupCount).toBe(CUSTOMERS);
    const ran = statements.filter((s) => /group by/i.test(s));
    expect(ran[0]).toMatch(/order by case [^ ]+ when \? then 0 when \? then 1 when \? then 2 else 3 end asc/i);
  });

  it('an order key naming no column of the aggregated row is refused INVALID_SORT, naming the columns', async () => {
    const err: any = await bridge.aggregateGroups(OBJECT, { ...REVENUE, orderBy: [{ field: 'amount', order: 'desc' }], limit: 5 })
      .then(() => undefined, (e: unknown) => e);
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_SORT', status: 400 });
    expect(err.message).toContain('customer, revenue');
  });

  it('CONTROL — aggregate with no order answers every group as before, with no count column', async () => {
    const rows = await bridge.aggregate(OBJECT, REVENUE);
    expect(rows).toHaveLength(CUSTOMERS);
    expect(rows[0]).not.toHaveProperty('__os_group_count');
  });
});
