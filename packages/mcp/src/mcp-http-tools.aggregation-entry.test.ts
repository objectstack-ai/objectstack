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
