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
 * statement's own count of the groups before the cut (`groupCount`) and
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
      return { rows: ordered.slice(0, opts.limit), groupCount: groups.length };
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
    expect(body.groupCount).toBe(120);
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
    expect(body.groupCount).toBe(120);
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
    bridge.aggregateGroups = async () => ({ rows: [{ customer: 'a', revenue: 1 }], groupCount: 1 });
    const { body } = await call(bridge, { orderBy: [{ field: 'revenue', order: 'desc' }], limit: 5 });
    expect(body).toEqual({ rows: [{ customer: 'a', revenue: 1 }], groupCount: 1, totalGroups: 1 });
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

  it('CONTROL — no order and no limit: the uncut path as before, now with groupCount beside totalGroups', async () => {
    const bridge = makeCutBridge();
    const { body } = await call(bridge, {});
    expect(body).toEqual({ rows: [{ n: 2, all: 5 }], groupCount: 1, totalGroups: 1 });
    expect(bridge.cuts).toEqual([]);
    expect(bridge.calls).toHaveLength(1);
  });

  it('tools/list declares orderBy and limit on aggregate_records', async () => {
    const bridge = makeCutBridge();
    const listed = await rpc(runtime, bridge, 'tools/list');
    const tool = listed.result.tools.find((t: any) => t.name === 'aggregate_records');
    expect(Object.keys(tool.inputSchema.properties)).toEqual(expect.arrayContaining(['orderBy', 'limit']));
    expect(tool.inputSchema.properties.limit.maximum).toBe(CAP);
    expect(tool.description).toMatch(/groupCount/);
  });
});
