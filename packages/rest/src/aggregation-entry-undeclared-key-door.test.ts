// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28609] An aggregation entry is closed at the producer: a key
 * `AggregationNodeSchema` does not declare is refused by name, on the door a
 * caller actually uses — `POST /api/v1/data/:object/query` → `RestServer` →
 * `ObjectStackProtocolImplementation.findData` → `ObjectQL.aggregate` → a real
 * sqlite `SqlDriver` (the harness `aggregation-filter-where-doors.test.ts`
 * boots).
 *
 * Measured on the base through this door: an entry carrying `bogusKey` (or
 * `where`, meant as the entry's own `filter`) answered `200` with the
 * unfiltered counts, because the node was a plain `z.object` and zod's
 * `.strip` default deleted the key before anyone read it. The MCP tool
 * `aggregate_records` had refused the same entry by name since #28550, so one
 * entry shape got two verdicts depending on the door. Now the node itself is a
 * `strictObject`: REST, the runtime dispatcher's twin (both parse
 * `FindDataRequestSchema`) and MCP (which takes the node as its entry) read
 * the one refusal, word for word.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { AggregationNodeSchema } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'ledger_order';

const LEDGER_ORDER = {
  name: OBJECT,
  label: 'Ledger Order',
  fields: {
    customer_id: { name: 'customer_id', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

const ROWS = [
  { id: 'o1', customer_id: 'c1', amount: 100 },
  { id: 'o2', customer_id: 'c1', amount: 400 },
  { id: 'o3', customer_id: 'c2', amount: 900 },
  { id: 'o4', customer_id: 'c2', amount: 300 },
  { id: 'o5', customer_id: 'c2', amount: 50 },
];

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

async function boot() {
  const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(LEDGER_ORDER as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  await engine.insert(OBJECT, ROWS as any);

  const calls = { aggregate: 0, find: 0 };
  const find = driver.find.bind(driver);
  const aggregate = driver.aggregate.bind(driver);
  driver.find = (o: string, ...rest: unknown[]) => { if (o === OBJECT) calls.find += 1; return find(o, ...rest); };
  driver.aggregate = (o: string, ...rest: unknown[]) => { if (o === OBJECT) calls.aggregate += 1; return aggregate(o, ...rest); };

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
  expect(route).toBeDefined();
  const post = async (body: Record<string, unknown>) => {
    const res = makeRes();
    await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)) } as any, res);
    return res;
  };
  return { post, calls };
}

/** The refusal the spec node itself prints for one entry — the words every door shares. */
function nodeRefusal(entry: Record<string, unknown>): string {
  const parsed = AggregationNodeSchema.safeParse(entry);
  expect(parsed.success, 'the spec node refuses this entry').toBe(false);
  return parsed.error!.issues[0]!.message;
}

const grouped = (entry: Record<string, unknown>) => ({
  groupBy: ['customer_id'],
  aggregations: [{ function: 'count', alias: 'n' }, entry],
});

describe('[#28609] POST /data/:object/query — an aggregation entry refuses an undeclared key by name', () => {
  const REFUSED: ReadonlyArray<readonly [string, Record<string, unknown>, string, string | undefined]> = [
    ['a slip (`bogusKey`)', { function: 'sum', field: 'amount', alias: 's', bogusKey: true }, 'bogusKey', undefined],
    ['`where` meant as the entry\'s own `filter`', { function: 'count', alias: 'm', where: { amount: { $gt: 100 } } }, 'where', 'filter'],
    ['`as` meant as `alias`', { function: 'sum', field: 'amount', alias: 's', as: 'total' }, 'as', 'alias'],
  ];

  for (const [name, entry, key, canonical] of REFUSED) {
    it(`${name}: 400 VALIDATION_FAILED naming the key, before any read`, async () => {
      const { post, calls } = await boot();
      const res = await post(grouped(entry));
      expect(res._status).toBe(400);
      expect(res._json.code).toBe('VALIDATION_FAILED');
      expect(calls).toEqual({ aggregate: 0, find: 0 });
      const fields = res._json.fields as Array<{ field: string; message: string }>;
      expect(fields.map((f) => f.field)).toContain('query.aggregations.1');
      const message = fields.find((f) => f.field === 'query.aggregations.1')!.message;
      // The spec node's own words — the sentence MCP's `aggregate_records` relays too.
      expect(message).toBe(nodeRefusal(entry));
      expect(message.split('\n')[0]).toContain(`\`${key}\``);
      if (canonical) expect(message).toContain(`\`${key}\` → \`${canonical}\``);
    });
  }

  it('CONTROL — the retired `distinct` keeps its tombstone sentence, not the generic refusal', async () => {
    const { post, calls } = await boot();
    const entry = { function: 'sum', field: 'amount', alias: 's', distinct: true };
    const res = await post(grouped(entry));
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('VALIDATION_FAILED');
    expect(calls).toEqual({ aggregate: 0, find: 0 });
    const fields = res._json.fields as Array<{ field: string; message: string }>;
    const tombstone = fields.find((f) => f.field === 'query.aggregations.1.distinct');
    expect(tombstone?.message.split(' — ')[0]).toBe('`query.aggregations[].distinct` was removed in @objectstack/spec 17 (ADR-0049)');
    expect(fields.some((f) => f.message.startsWith('Unrecognized key'))).toBe(false);
  });

  it('CONTROL — entries with only declared members answer as before, filtered and unfiltered', async () => {
    const { post, calls } = await boot();
    const res = await post({
      groupBy: ['customer_id'],
      aggregations: [
        { function: 'count', alias: 'n' },
        { function: 'sum', field: 'amount', alias: 's' },
        { function: 'count', alias: 'big', filter: { amount: { $gt: 100 } } },
      ],
      orderBy: [{ field: 'customer_id', order: 'asc' }],
    });
    expect(res._status ?? 200).toBe(200);
    const rows = (res._json.records ?? res._json.data) as Array<Record<string, unknown>>;
    const byCustomer = Object.fromEntries(rows.map((r) => [r.customer_id, { n: Number(r.n), s: Number(r.s), big: Number(r.big) }]));
    expect(byCustomer).toEqual({ c1: { n: 2, s: 500, big: 1 }, c2: { n: 3, s: 1250, big: 2 } });
    expect(calls.aggregate + calls.find).toBeGreaterThan(0);
  });
});
