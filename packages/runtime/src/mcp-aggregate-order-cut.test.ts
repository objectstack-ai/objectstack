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
 * key ascending; the declared option order `aggregate_records` sends for a
 * `limit` with no `orderBy` (a rank on a select key), taken by the statement's
 * CASE before the cut, NULL last, with the true number of groups; an order
 * key naming no column of the aggregated row refused
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
    stage: { name: 'stage', label: 'Stage', type: 'select', options: [{ value: 'open' }, { value: 'won' }, { value: 'lost' }] },
  },
};
/** Each customer's stage, in an order that is neither declared nor alphabetical; every fourth has none. */
const STAGE_OF = (i: number) => ['lost', 'won', null, 'open'][i % 4];
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
      await driver.create(OBJECT, { id: `${customer}-a`, customer, amount: i * 10, stage: STAGE_OF(i) });
      await driver.create(OBJECT, { id: `${customer}-b`, customer, amount: 5, stage: STAGE_OF(i) });
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
      totalGroups: CUSTOMERS,
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
    expect(answer.totalGroups).toBe(CUSTOMERS);
  });

  it('a declared order (a rank on a group key) reaches the statement: the listed groups first, in their order', async () => {
    statements.length = 0;
    const answer = await bridge.aggregateGroups(OBJECT, {
      ...REVENUE,
      orderBy: [{ field: 'customer', order: 'asc', rank: ['c03', 'c01', 'c02'] }],
      limit: 3,
    });
    expect(answer.rows.map((r: any) => r.customer)).toEqual(['c03', 'c01', 'c02']);
    expect(answer.totalGroups).toBe(CUSTOMERS);
    const ran = statements.filter((s) => /group by/i.test(s));
    expect(ran[0]).toMatch(/order by case [^ ]+ when \? then 0 when \? then 1 when \? then 2 else 3 end asc/i);
  });

  it('the declared option order a limit-only aggregate_records call sends: declared groups first, NULL last, the cut after it, the true total', async () => {
    // The order key `aggregate_records` derives for a `limit` with no
    // `orderBy` over a select group key (`@objectstack/mcp`, pinned there).
    const declared = { field: 'stage', order: 'asc' as const, rank: ['open', 'won', 'lost'] };
    const COUNT = { groupBy: ['stage'], aggregations: [{ function: 'count' as const, alias: 'n' }] };
    statements.length = 0;
    const cut = await bridge.aggregateGroups(OBJECT, { ...COUNT, orderBy: [declared], limit: 2 });
    expect(cut).toEqual({ rows: [{ stage: 'open', n: 34 }, { stage: 'won', n: 36 }], totalGroups: 4 });
    const ran = statements.filter((s) => /group by/i.test(s));
    expect(ran, statements.join('\n')).toHaveLength(1);
    expect(ran[0]).toMatch(/order by case [^ ]+ when \? then 0 when \? then 1 when \? then 2 else 3 end asc/i);
    expect(ran[0]).toMatch(/limit \?/i);
    const all = await bridge.aggregateGroups(OBJECT, { ...COUNT, orderBy: [declared], limit: 10 });
    expect(all.rows.map((r: any) => r.stage)).toEqual(['open', 'won', 'lost', null]);
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
    expect(rows[0]).not.toHaveProperty('__os_total_groups');
  });
});
