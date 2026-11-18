// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `aggregate_records`: each aggregation entry carries its `filter` to the
 * engine and refuses an undeclared key by name (#28550).
 *
 * THE DEFECT. The entry was a plain `z.object({ function, field, alias })`, so
 * zod's `.strip` default deleted a per-aggregation `filter` before the handler
 * ran. `{ function: 'count', alias: 'n', filter: { status: 'active' } }` beside
 * an unfiltered `count` answered the same number twice (5 and 5 on the stock
 * showcase), while the REST query door answered 2 and 5 for the same body. An
 * unknown entry key (`bogusKey`) was dropped the same way. The top-level
 * closure (#16913) never reached inside the array.
 *
 * WHAT IS PINNED HERE, at the tool layer over a recording bridge: the entry's
 * `filter` reaches the bridge byte-for-byte (the bridge hands `aggregations` to
 * `engine.aggregate`, which applies it, so nothing in this package evaluates
 * it); a malformed filter gets the engine node's own refusal at the door; an
 * undeclared entry key is refused by name before the bridge is asked; and the
 * advertised JSON Schema declares both facts. The MCP-equals-REST answer over a
 * real engine, and the field-permission refusal, are pinned end to end in
 * `packages/qa/dogfood/test/showcase-mcp-aggregate-filter.dogfood.test.ts`.
 *
 * CONTROLS. Entries without a filter reach the bridge exactly as before, and
 * the top-level unknown-key posture is unchanged.
 *
 * [#28609] The entry is now the spec's `AggregationNodeSchema` itself, closed at
 * the producer, instead of this tool's own closed copy of its members. So a
 * refused entry reads here in the very words the REST query door prints for
 * the same body (`packages/rest/src/aggregation-entry-undeclared-key-door.test.ts`
 * pins that half against the same spec message), and the retired `distinct`
 * answers its tombstone sentence on both doors. `tools/list` declares
 * `distinct` as a schema nothing satisfies (`not: {}`), with the removal text.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { AggregationNodeSchema } from '@objectstack/spec/data';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';

interface RecordingBridge extends McpDataBridge {
  calls: any[];
}

function makeBridge(): RecordingBridge {
  const calls: any[] = [];
  return {
    calls,
    async listObjects() { return [{ name: 'showcase_project' }]; },
    async describeObject(name: string) { return { name, fields: [] }; },
    async query(object: string) { return { object, records: [] }; },
    async get() { return null; },
    async create(object: string) { return { object, id: 'n1' }; },
    async update(object: string, id: string) { return { object, id }; },
    async remove(object: string, id: string) { return { object, id, success: true }; },
    async aggregate(object: string, opts: any) {
      calls.push([object, opts]);
      return [{ n: 2, all: 5 }];
    },
  };
}

let nextId = 1;

/** The refusal the spec node prints for one entry — the words the REST door answers too. */
function nodeRefusal(entry: Record<string, unknown>): string {
  const parsed = AggregationNodeSchema.safeParse(entry);
  expect(parsed.success, 'the spec node refuses this entry').toBe(false);
  return parsed.error!.issues[0]!.message;
}

async function rpc(runtime: MCPServerRuntime, bridge: RecordingBridge, method: string, params?: unknown) {
  const body = { jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) };
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, { bridge, parsedBody: body });
  return (await res.json()) as any;
}

async function aggregate(runtime: MCPServerRuntime, bridge: RecordingBridge, args: Record<string, unknown>) {
  const json = await rpc(runtime, bridge, 'tools/call', { name: 'aggregate_records', arguments: args });
  const text = json.result?.content?.map((c: any) => c.text).join('\n') ?? json.error?.message ?? '';
  return { refused: json.result?.isError === true || Boolean(json.error), text: String(text) };
}

describe('aggregate_records — the aggregation entry (#28550)', () => {
  let runtime: MCPServerRuntime;
  let bridge: RecordingBridge;

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    bridge = makeBridge();
  });

  it('the reported call: an entry `filter` reaches the bridge unchanged, beside an unfiltered sibling', async () => {
    const aggregations = [
      { function: 'count', alias: 'n', filter: { status: 'active' } },
      { function: 'count', alias: 'all' },
    ];
    const { refused, text } = await aggregate(runtime, bridge, { objectName: 'showcase_project', aggregations });
    expect(refused, text).toBe(false);
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0][0]).toBe('showcase_project');
    // Exactly what was sent: the filter on the first entry, none on the second.
    expect(bridge.calls[0][1].aggregations).toEqual(aggregations);
  });

  it('an operator filter reaches the bridge as sent', async () => {
    const aggregations = [
      { function: 'sum', field: 'budget', alias: 'big', filter: { budget: { $gte: 1000 }, status: { $in: ['active', 'planning'] } } },
    ];
    const { refused, text } = await aggregate(runtime, bridge, {
      objectName: 'showcase_project',
      aggregations,
      groupBy: ['status'],
      where: { owner: 'u1' },
    });
    expect(refused, text).toBe(false);
    expect(bridge.calls[0][1]).toMatchObject({ aggregations, groupBy: ['status'], where: { owner: 'u1' } });
  });

  it('CONTROL — entries without a filter reach the bridge exactly as before', async () => {
    const aggregations = [
      { function: 'count', alias: 'n' },
      { function: 'sum', field: 'budget', alias: 'total' },
    ];
    const { refused, text } = await aggregate(runtime, bridge, { objectName: 'showcase_project', aggregations });
    expect(refused, text).toBe(false);
    expect(bridge.calls[0][1].aggregations).toEqual(aggregations);
  });

  it('an undeclared entry key is refused by name, and the bridge is never asked', async () => {
    const { refused, text } = await aggregate(runtime, bridge, {
      objectName: 'showcase_project',
      aggregations: [{ function: 'count', alias: 'n', bogusKey: 1 }],
    });
    expect(refused).toBe(true);
    expect(text).toContain('bogusKey');
    // [#28609] The spec node's own sentence, the one REST prints for this entry.
    expect(text).toContain(nodeRefusal({ function: 'count', alias: 'n', bogusKey: 1 }));
    expect(bridge.calls).toHaveLength(0);
  });

  it('an entry `where` is refused, and the refusal names `filter` as the spelling to send', async () => {
    const { refused, text } = await aggregate(runtime, bridge, {
      objectName: 'showcase_project',
      aggregations: [{ function: 'count', alias: 'n', where: { status: 'active' } }],
    });
    expect(refused).toBe(true);
    expect(text).toContain('where');
    expect(text).toContain('filter');
    expect(text).toContain(nodeRefusal({ function: 'count', alias: 'n', where: { status: 'active' } }));
    expect(bridge.calls).toHaveLength(0);
  });

  it('the retired `distinct` entry key is refused with its tombstone sentence, as on REST', async () => {
    const { refused, text } = await aggregate(runtime, bridge, {
      objectName: 'showcase_project',
      aggregations: [{ function: 'sum', field: 'budget', alias: 's', distinct: true }],
    });
    expect(refused).toBe(true);
    expect(text).toContain('`query.aggregations[].distinct` was removed in @objectstack/spec 17 (ADR-0049)');
    expect(text).not.toContain('Unrecognized key');
    expect(bridge.calls).toHaveLength(0);
  });

  it('a filter that is not a filter object is refused at the door by the engine node\'s own shape', async () => {
    for (const filter of ["status = 'active'", ['status', '=', 'active'], 7]) {
      const { refused } = await aggregate(runtime, bridge, {
        objectName: 'showcase_project',
        aggregations: [{ function: 'count', alias: 'n', filter }],
      });
      expect(refused, JSON.stringify(filter)).toBe(true);
    }
    expect(bridge.calls).toHaveLength(0);
  });

  it('CONTROL — an undeclared TOP-LEVEL key is still refused, naming the declared spelling', async () => {
    const { refused, text } = await aggregate(runtime, bridge, {
      objectName: 'showcase_project',
      metrics: [{ function: 'count', alias: 'n' }],
    });
    expect(refused).toBe(true);
    expect(text).toContain('metrics');
    expect(text).toContain('aggregations');
    expect(bridge.calls).toHaveLength(0);
  });

  it('`tools/list` advertises the entry as closed, with `filter` declared and `distinct` unsatisfiable', async () => {
    const json = await rpc(runtime, bridge, 'tools/list');
    const tool = (json.result?.tools ?? []).find((t: any) => t.name === 'aggregate_records');
    expect(tool).toBeDefined();
    const entry = tool.inputSchema?.properties?.aggregations?.items;
    expect(entry?.additionalProperties).toBe(false);
    expect(Object.keys(entry?.properties ?? {}).sort()).toEqual(['alias', 'distinct', 'field', 'filter', 'function']);
    // [#28609] The tombstone: declared so the refusal carries its prescription,
    // and advertised as a schema no value satisfies.
    expect(entry?.properties?.distinct?.not).toEqual({});
    expect(entry?.properties?.distinct?.description).toMatch(/^\[REMOVED\] /);
    expect(entry?.required).toEqual(expect.arrayContaining(['function', 'alias']));
  });
});

/**
 * [aggregate order and cut] A ranking question ("the top five customers by
 * revenue") over more groups than the row cap: the tool hands the bridge's
 * `aggregateGroups` the order and the cut plus one probe group, serves exactly
 * the groups asked for in the order the bridge answered, and states the
 * statement's own count of the groups before the cut (`totalGroups`) and
 * whether more existed (`truncated`). It never sorts or slices an uncut list:
 * a bridge without `aggregateGroups` is refused, and the uncut path is not
 * asked. The engine and driver halves are pinned in `@objectstack/objectql`
 * (`aggregate-order-cut.test.ts`) and `@objectstack/driver-sql`
 * (`sql-driver-aggregate-order-cut.test.ts`); the stdio bridge in
 * `stdio-data-bridge.aggregate-order-cut.test.ts`; over a real SQLite database
 * through the HTTP bridge in `@objectstack/runtime`
 * (`mcp-aggregate-order-cut.test.ts`).
 */
describe('aggregate_records — ordered, cut and counted groups', () => {
  const CAP = 50;
  /** 120 customers, more than the cap: the bridge answers in its own (database) order. */
  const groups = Array.from({ length: 120 }, (_, i) => ({ customer: `c${String(119 - i).padStart(3, '0')}`, revenue: (119 - i) * 10 }));

  function makeCutBridge() {
    const bridge = makeBridge() as RecordingBridge & { cuts: any[] };
    bridge.cuts = [];
    bridge.aggregateGroups = async (object: string, opts: any) => {
      bridge.cuts.push([object, opts]);
      const ordered = opts.orderBy[0]?.field === 'customer' && opts.orderBy[0]?.order === 'asc' ? [...groups].reverse() : groups;
      return { rows: ordered.slice(0, opts.limit), totalGroups: groups.length };
    };
    return bridge;
  }

  let runtime: MCPServerRuntime;
  beforeEach(() => { runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' }); });

  const call = async (bridge: RecordingBridge, args: Record<string, unknown>) => {
    const res = await aggregate(runtime, bridge, { objectName: 'showcase_project', aggregations: [{ function: 'sum', field: 'amount', alias: 'revenue' }], groupBy: ['customer'], ...args });
    return { ...res, body: res.refused ? undefined : JSON.parse(res.text) };
  };

  it('top five by a measure over more groups than the cap: exactly five, in order, with the total number of groups', async () => {
    const bridge = makeCutBridge();
    const { refused, text, body } = await call(bridge, { orderBy: [{ field: 'revenue', order: 'desc' }], limit: 5 });
    expect(refused, text).toBe(false);
    expect(body.rows.map((r: any) => r.customer)).toEqual(['c119', 'c118', 'c117', 'c116', 'c115']);
    expect(body.totalGroups).toBe(120);
    expect(body.truncated).toBe(true);
    // The order and the cut went to the bridge — one probe group past the limit — and the uncut path was never asked.
    expect(bridge.cuts).toHaveLength(1);
    expect(bridge.cuts[0][1]).toMatchObject({ orderBy: [{ field: 'revenue', order: 'desc' }], limit: 6, groupBy: ['customer'] });
    expect(bridge.calls).toEqual([]);
  });

  it('ordered by a group key, ascending', async () => {
    const bridge = makeCutBridge();
    const { body } = await call(bridge, { orderBy: [{ field: 'customer', order: 'asc' }], limit: 3 });
    expect(body.rows.map((r: any) => r.customer)).toEqual(['c000', 'c001', 'c002']);
    expect(body.totalGroups).toBe(120);
  });

  it('an order with no limit is cut at the cap, and says so', async () => {
    const bridge = makeCutBridge();
    const { body } = await call(bridge, { orderBy: [{ field: 'revenue', order: 'desc' }] });
    expect(body.rows).toHaveLength(CAP);
    expect(body.truncated).toBe(true);
    expect(bridge.cuts[0][1].limit).toBe(CAP + 1);
  });

  it('a cut that drops nothing carries no truncated flag', async () => {
    const bridge = makeBridge() as RecordingBridge;
    bridge.aggregateGroups = async () => ({ rows: [{ customer: 'a', revenue: 1 }], totalGroups: 1 });
    const { body } = await call(bridge, { orderBy: [{ field: 'revenue', order: 'desc' }], limit: 5 });
    expect(body).toEqual({ rows: [{ customer: 'a', revenue: 1 }], totalGroups: 1 });
  });

  it('the engine\'s refusal of an order key (INVALID_SORT, naming the columns) reaches the caller as its envelope', async () => {
    const bridge = makeBridge() as RecordingBridge;
    bridge.aggregateGroups = async () => {
      throw Object.assign(new Error("aggregate('showcase_project') ordered or cut by group: `orderBy[0]` names 'amount', which is not a column of the aggregated row. … which here are: customer, revenue. The query was NOT run and nothing was read."), {
        code: 'INVALID_SORT', status: 400, httpStatus: 400,
      });
    };
    const { refused, text } = await call(bridge, { orderBy: [{ field: 'amount', order: 'desc' }], limit: 5 });
    expect(refused).toBe(true);
    const { error } = JSON.parse(text);
    expect({ code: error.code, status: error.status }).toEqual({ code: 'INVALID_SORT', status: 400 });
    expect(error.message).toContain('customer, revenue');
  });

  it('a bridge that cannot order and cut groups refuses (NOT_IMPLEMENTED), and never sorts an uncut list', async () => {
    const bridge = makeBridge();
    const { refused, text } = await call(bridge, { orderBy: [{ field: 'revenue', order: 'desc' }], limit: 5 });
    expect(refused).toBe(true);
    expect(JSON.parse(text).error).toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 });
    expect(bridge.calls).toEqual([]);
  });

  it('a limit past the cap, a sort spelling and a malformed order are refused at the door', async () => {
    const bridge = makeCutBridge();
    expect((await call(bridge, { limit: CAP + 1 })).refused).toBe(true);
    const sort = await call(bridge, { sort: [{ field: 'revenue', order: 'desc' }] });
    expect(sort.refused).toBe(true);
    expect(sort.text).toContain('orderBy');
    expect((await call(bridge, { orderBy: [{ field: 'revenue', order: 'down' }] })).refused).toBe(true);
    expect(bridge.cuts).toEqual([]);
  });

  it('CONTROL — no order and no limit: the uncut path as before, totalGroups and no second spelling of it', async () => {
    const bridge = makeCutBridge();
    const { body } = await call(bridge, {});
    expect(body).toEqual({ rows: [{ n: 2, all: 5 }], totalGroups: 1 });
    expect(bridge.cuts).toEqual([]);
    expect(bridge.calls).toHaveLength(1);
  });

  it('tools/list declares orderBy and limit on aggregate_records', async () => {
    const bridge = makeCutBridge();
    const listed = await rpc(runtime, bridge, 'tools/list');
    const tool = listed.result.tools.find((t: any) => t.name === 'aggregate_records');
    expect(Object.keys(tool.inputSchema.properties)).toEqual(expect.arrayContaining(['orderBy', 'limit']));
    expect(tool.inputSchema.properties.limit.maximum).toBe(CAP);
    expect(tool.description).toMatch(/totalGroups says how many groups existed before the cut/);
    expect(tool.description).not.toMatch(/groupCount/);
  });
});

/**
 * [#35138] Two facts `aggregate_records` reads off the object as the caller
 * is served it (`servedObjectDefinitionOf`): groups keyed by a select field
 * come back in the option order the field declares, sorted before the cap so
 * the cap keeps the first declared groups; and an amount column over a
 * `fixed`-currency field names its currency in `currencies`, by alias.
 *
 * CONTROLS. A group key that is not a select field keeps the driver's order; a
 * field the served schema does not show is neither ordered nor named; a
 * `count`, a non-currency measure, a `record`-mode and a `dynamic`-mode amount
 * carry no currency; a bridge without the member answers as before.
 */
describe('aggregate_records — select groups in declared option order, a fixed amount names its currency (#35138)', () => {
  const STAGES = ['prospect', 'qualified', 'won', 'lost'];
  const served = {
    name: 'deal',
    fields: {
      stage: { type: 'select', options: STAGES.map((value) => ({ value, label: value.toUpperCase() })) },
      priority: { type: 'radio', options: [{ value: 'high' }, { value: 'low' }] },
      region: { type: 'text' },
      amount: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } },
      local_amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
      tenant_amount: { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
      seats: { type: 'number' },
      currency_code: { type: 'text' },
      many: { type: 'select', options: Array.from({ length: 60 }, (_, i) => ({ value: `o${String(i).padStart(2, '0')}` })) },
    },
  };

  function servedBridge(rows: unknown[], def: Record<string, unknown> | null = served): RecordingBridge & { schemaReads: number } {
    const bridge = makeBridge() as RecordingBridge & { schemaReads: number };
    bridge.schemaReads = 0;
    bridge.aggregate = async (object: string, opts: any) => {
      bridge.calls.push([object, opts]);
      return rows;
    };
    bridge.servedObjectDefinitionOf = async () => {
      bridge.schemaReads++;
      return def;
    };
    return bridge;
  }

  async function answer(bridge: RecordingBridge, args: Record<string, unknown>) {
    const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    const { refused, text } = await aggregate(runtime, bridge, { objectName: 'deal', ...args });
    expect(refused, text).toBe(false);
    return JSON.parse(text) as { rows: Array<Record<string, unknown>>; totalGroups: number; truncated?: true; currencies?: Record<string, string> };
  }

  it('groups of a select field come back in the declared option order, a value no option declares last', async () => {
    const bridge = servedBridge([
      { stage: 'lost', n: 1 }, { stage: null, n: 9 }, { stage: 'won', n: 2 }, { stage: 'prospect', n: 3 }, { stage: 'qualified', n: 4 },
    ]);
    const out = await answer(bridge, { aggregations: [{ function: 'count', alias: 'n' }], groupBy: ['stage'] });
    expect(out.rows.map((r) => r.stage)).toEqual(['prospect', 'qualified', 'won', 'lost', null]);
    expect(out.totalGroups).toBe(5);
  });

  it('the order is read by the group key\'s alias, and a second select key orders within the first', async () => {
    const bridge = servedBridge([
      { s: 'won', priority: 'low', n: 1 }, { s: 'prospect', priority: 'low', n: 2 },
      { s: 'won', priority: 'high', n: 3 }, { s: 'prospect', priority: 'high', n: 4 },
    ]);
    const out = await answer(bridge, {
      aggregations: [{ function: 'count', alias: 'n' }],
      groupBy: [{ field: 'stage', alias: 's' }, 'priority'],
    });
    expect(out.rows.map((r) => r.n)).toEqual([4, 2, 3, 1]);
  });

  it('the order is taken before the cap, so the cap keeps the first declared groups', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ many: `o${String(59 - i).padStart(2, '0')}`, n: i }));
    const out = await answer(servedBridge(rows), { aggregations: [{ function: 'count', alias: 'n' }], groupBy: ['many'] });
    expect(out.rows).toHaveLength(50);
    expect(out.rows[0]!.many).toBe('o00');
    expect(out.rows[49]!.many).toBe('o49');
    expect(out.truncated).toBe(true);
    expect(out.totalGroups).toBe(60);
  });

  it('CONTROL — a group key that is not a select field keeps the driver\'s order, and so do the keys after it', async () => {
    const driverOrder = [
      { region: 'west', stage: 'won', n: 1 }, { region: 'east', stage: 'prospect', n: 2 }, { region: 'east', stage: 'won', n: 3 },
    ];
    const out = await answer(servedBridge(driverOrder), {
      aggregations: [{ function: 'count', alias: 'n' }],
      groupBy: ['region', 'stage'],
    });
    expect(out.rows.map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it('CONTROL — a select field the served schema does not show is not ordered by its options', async () => {
    const { stage: _withheld, ...rest } = served.fields;
    const bridge = servedBridge([{ stage: 'lost', n: 1 }, { stage: 'prospect', n: 2 }], { name: 'deal', fields: rest });
    const out = await answer(bridge, { aggregations: [{ function: 'count', alias: 'n' }], groupBy: ['stage'] });
    expect(out.rows.map((r) => r.stage)).toEqual(['lost', 'prospect']);
  });

  it('an amount over a fixed-currency field names its currency, by the column alias', async () => {
    const bridge = servedBridge([{ stage: 'won', total: 1200, mean: 600 }]);
    const out = await answer(bridge, {
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'total' },
        { function: 'avg', field: 'amount', alias: 'mean' },
      ],
      groupBy: ['stage'],
    });
    expect(out.currencies).toEqual({ total: 'USD', mean: 'USD' });
  });

  it('CONTROL — a count, a non-currency measure, a record-mode and a dynamic-mode amount carry no currency', async () => {
    const bridge = servedBridge([{ currency_code: 'EUR', n: 2, k: 2, seats_sum: 5, local: 30, tenant: 40 }]);
    const out = await answer(bridge, {
      aggregations: [
        { function: 'count', alias: 'n' },
        { function: 'count_distinct', field: 'amount', alias: 'k' },
        { function: 'sum', field: 'seats', alias: 'seats_sum' },
        { function: 'sum', field: 'local_amount', alias: 'local' },
        { function: 'sum', field: 'tenant_amount', alias: 'tenant' },
      ],
      groupBy: ['currency_code'],
    });
    expect(out).not.toHaveProperty('currencies');
  });

  it('CONTROL — a fixed-currency field the served schema does not show names no currency', async () => {
    const { amount: _withheld, ...rest } = served.fields;
    const bridge = servedBridge([{ total: 1 }], { name: 'deal', fields: rest });
    const out = await answer(bridge, { aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }] });
    expect(out).not.toHaveProperty('currencies');
  });

  it('CONTROL — a bridge without the served definition, or one that throws, answers as before', async () => {
    const driverOrder = [{ stage: 'lost', total: 1 }, { stage: 'won', total: 2 }];
    const args = { aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }], groupBy: ['stage'] };
    const bare = servedBridge(driverOrder);
    delete bare.servedObjectDefinitionOf;
    const throwing = servedBridge(driverOrder);
    throwing.servedObjectDefinitionOf = async () => { throw new Error('metadata outage'); };
    for (const bridge of [bare, throwing]) {
      const out = await answer(bridge, args);
      expect(out).toEqual({ rows: driverOrder, totalGroups: 2 });
    }
  });

  it('a call with no group key and no amount column does not read the served schema', async () => {
    const bridge = servedBridge([{ n: 3 }]);
    const out = await answer(bridge, { aggregations: [{ function: 'count', alias: 'n' }] });
    expect(out).toEqual({ rows: [{ n: 3 }], totalGroups: 1 });
    expect(bridge.schemaReads).toBe(0);
  });
});

/**
 * [aggregate order and cut × declared option order] The two rules meet on the
 * order-and-cut path. A call with a `limit` and no `orderBy` hands the
 * database the declared option order of its leading select keys, each as an
 * order key's `rank`, so the order is taken before the cut and the cut keeps
 * the first declared groups; the rule is the uncut path's own
 * (`declaredOptionRank`), read once. An `orderBy` the caller sent reaches the
 * bridge unchanged and overrides the option order. A fixed-currency amount
 * names its currency on the cut result too. No served result carries a second
 * spelling of `totalGroups`.
 *
 * The rank's push-down into the statement (a CASE in the ORDER BY) is pinned
 * in `@objectstack/driver-sql` (`sql-driver-aggregate-order-cut.test.ts`) and
 * over a real SQLite database in `@objectstack/runtime`
 * (`mcp-aggregate-order-cut.test.ts`); its passage through the real engine to
 * the driver in `stdio-data-bridge.aggregate-order-cut.test.ts`.
 */
describe('aggregate_records — the declared option order on the order-and-cut path', () => {
  const STAGES = ['prospect', 'qualified', 'won', 'lost'];
  const served = {
    name: 'deal',
    fields: {
      stage: { type: 'select', options: STAGES.map((value) => ({ value })) },
      priority: { type: 'radio', options: [{ value: 'high' }, { value: 'low' }] },
      region: { type: 'text' },
      amount: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } },
      wide: { type: 'select', options: Array.from({ length: 501 }, (_, i) => ({ value: `w${i}` })) },
    },
  };
  /** Five stages in the order a database answers them with no order of its own. */
  const DRIVER_ORDER = [
    { stage: 'lost', n: 1 }, { stage: null, n: 9 }, { stage: 'won', n: 2 }, { stage: 'prospect', n: 3 }, { stage: 'qualified', n: 4 },
  ];

  /** A database that honours the leading key's rank (an unlisted value last) and otherwise answers in its own order. */
  function cutBridge(def: Record<string, unknown> | null = served) {
    const bridge = makeBridge() as RecordingBridge & { cuts: any[] };
    bridge.cuts = [];
    bridge.servedObjectDefinitionOf = async () => def;
    bridge.aggregateGroups = async (object: string, opts: any) => {
      bridge.cuts.push([object, opts]);
      const key = opts.orderBy[0];
      const at = (v: unknown) => (key.rank.indexOf(v) < 0 ? key.rank.length : key.rank.indexOf(v));
      const ordered = key?.rank ? [...DRIVER_ORDER].sort((a: any, b: any) => at(a[key.field]) - at(b[key.field])) : DRIVER_ORDER;
      return { rows: ordered.slice(0, opts.limit), totalGroups: DRIVER_ORDER.length };
    };
    return bridge;
  }

  async function answer(bridge: RecordingBridge, args: Record<string, unknown>) {
    const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    const { refused, text } = await aggregate(runtime, bridge, { objectName: 'deal', aggregations: [{ function: 'count', alias: 'n' }], ...args });
    expect(refused, text).toBe(false);
    const body = JSON.parse(text);
    expect(body).not.toHaveProperty('groupCount');
    return body as { rows: Array<Record<string, unknown>>; totalGroups: number; truncated?: true; currencies?: Record<string, string> };
  }

  it('a limit with no orderBy: the database is handed the declared option order, and the cut keeps the first declared groups', async () => {
    const bridge = cutBridge();
    const out = await answer(bridge, { groupBy: ['stage'], limit: 2 });
    expect(bridge.cuts).toHaveLength(1);
    expect(bridge.cuts[0][1].orderBy).toEqual([{ field: 'stage', order: 'asc', rank: STAGES }]);
    expect(bridge.cuts[0][1].limit).toBe(3);
    expect(out.rows.map((r) => r.stage)).toEqual(['prospect', 'qualified']);
    // The database's count of the groups before the cut.
    expect(out.totalGroups).toBe(5);
    expect(out.truncated).toBe(true);
    // The uncut path was never asked, and nothing was sorted here.
    expect(bridge.calls).toEqual([]);
  });

  it('the rank is read by the group key\'s alias for each leading select key, and the first key that is not one ends the reading', async () => {
    const bridge = cutBridge();
    await answer(bridge, { groupBy: [{ field: 'stage', alias: 's' }, 'priority', 'region', 'stage'], limit: 5 });
    expect(bridge.cuts[0][1].orderBy).toEqual([
      { field: 's', order: 'asc', rank: STAGES },
      { field: 'priority', order: 'asc', rank: ['high', 'low'] },
    ]);
    await answer(bridge, { groupBy: ['region', 'stage'], limit: 5 });
    expect(bridge.cuts[1][1].orderBy).toEqual([]);
  });

  it('a declared list longer than the engine ranks ends the reading at its key, rather than send a rank the engine refuses', async () => {
    const bridge = cutBridge();
    await answer(bridge, { groupBy: ['stage', 'wide'], limit: 5 });
    expect(bridge.cuts[0][1].orderBy).toEqual([{ field: 'stage', order: 'asc', rank: STAGES }]);
  });

  it('CONTROL — an explicit orderBy overrides the option order: it reaches the bridge unchanged, with no rank', async () => {
    const bridge = cutBridge();
    const out = await answer(bridge, { groupBy: ['stage'], orderBy: [{ field: 'n', order: 'desc' }], limit: 5 });
    expect(bridge.cuts[0][1].orderBy).toEqual([{ field: 'n', order: 'desc' }]);
    expect(out.rows.map((r) => r.stage)).toEqual(['lost', null, 'won', 'prospect', 'qualified']);
    const byStage = cutBridge();
    await answer(byStage, { groupBy: ['stage'], orderBy: [{ field: 'stage', order: 'desc' }], limit: 5 });
    expect(byStage.cuts[0][1].orderBy).toEqual([{ field: 'stage', order: 'desc' }]);
  });

  it('an amount over a fixed-currency field names its currency on the cut result too', async () => {
    const bridge = cutBridge();
    const out = await answer(bridge, {
      groupBy: ['stage'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }, { function: 'count', alias: 'n' }],
      orderBy: [{ field: 'total', order: 'desc' }],
      limit: 5,
    });
    expect(out.currencies).toEqual({ total: 'USD' });
  });

  it('CONTROL — a count names no currency, and a bridge without the served definition cuts in the database\'s own order, as before', async () => {
    const counted = await answer(cutBridge(), { groupBy: ['stage'], limit: 5 });
    expect(counted).not.toHaveProperty('currencies');
    const bare = cutBridge();
    delete bare.servedObjectDefinitionOf;
    const out = await answer(bare, { groupBy: ['stage'], limit: 5 });
    expect(bare.cuts[0][1].orderBy).toEqual([]);
    expect(out).toEqual({ rows: DRIVER_ORDER, totalGroups: 5 });
  });
});
