// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Undeclared argument keys on an MCP tool are REFUSED, not stripped (#16913).
 *
 * THE DEFECT, as reported twice from two different spikes. `query_records`
 * answered `{"objectName":"crm_opportunity","sort":"-amount","limit":3}` with
 * `200` and rows in seed order, and
 * `{"objectName":"crm_opportunity","filters":[["name","contains","Meridian"]]}`
 * with `200` and the FULL 16-row set. No error, no warning, nothing in the
 * payload that distinguishes either from a real answer. The declared spellings
 * are `orderBy` and `where`; `sort`, `filters` and `filter` were never declared
 * and were silently discarded before the handler ran.
 *
 * The mechanism is zod's `.strip` default, reached through the SDK: a raw shape
 * handed to `registerTool` is wrapped with `objectFromShape()`, and
 * `validateToolInput()` parses the arguments against that wrap — so the handler
 * destructures a payload the undeclared keys have already been removed from and
 * cannot report what it never saw. `run_action`'s confirmation member carries
 * the same finding in its own docblock ("Under zod an undeclared key is
 * DROPPED, not rejected").
 *
 * WHY THAT IS WORSE THAN AN ERROR, and why it is this file that pins it: the
 * consumer of these tools is an AI agent. A human who asked for a sort and got
 * seed order eventually notices; an agent reads a successful response and
 * reports "the top N opportunities by amount". The failure is bidirectional and
 * invisible in both directions — a dropped `orderBy` answers a DIFFERENTLY
 * ORDERED set, a dropped `where` answers a WIDER one.
 *
 * THE SWEEP IS PART OF THE PIN. Triage's ruling was that one tool with two
 * postures is evidence there was never a rule, so the posture is asserted over
 * the tools `tools/list` actually advertises — not over a hand-written list.
 * A tool added without closing its shape fails `refuses an undeclared key`
 * here, which is the only place that rule can be enforced by construction.
 *
 * CONTROLS. Every refusal case is paired with the same call minus the
 * undeclared key, asserted to SUCCEED and to reach the bridge with exactly the
 * arguments it declared. A refusal pin alone would stay green if the tool
 * simply stopped working, and "still 200" is precisely what the defect looked
 * like.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpActionBridge, McpDataBridge } from './mcp-http-tools.js';

interface StubBridge extends McpDataBridge, McpActionBridge {
  calls: any[];
}

function makeBridge(): StubBridge {
  const calls: any[] = [];
  return {
    calls,
    async listObjects() { calls.push(['listObjects']); return [{ name: 'crm_opportunity', label: 'Opportunity' }]; },
    async describeObject(name: string) { calls.push(['describeObject', name]); return { name, fields: [{ name: 'amount', type: 'number' }] }; },
    async query(object: string, opts: any) { calls.push(['query', object, opts]); return { object, records: [] }; },
    async get(object: string, id: string) { calls.push(['get', object, id]); return { id }; },
    async aggregate(object: string, opts: any) { calls.push(['aggregate', object, opts]); return []; },
    async create(object: string, data: any) { calls.push(['create', object, data]); return { object, id: 'n1' }; },
    async update(object: string, id: string, data: any) { calls.push(['update', object, id, data]); return { object, id }; },
    async remove(object: string, id: string) { calls.push(['remove', object, id]); return { object, id, success: true }; },
    async listActions() { calls.push(['listActions']); return [{ name: 'complete_task', objectName: 'crm_opportunity' }]; },
    async runAction(name: string, input: any) { calls.push(['runAction', name, input]); return { ok: true }; },
  };
}

let nextId = 100;

async function rpc(runtime: MCPServerRuntime, bridge: StubBridge, method: string, params?: unknown) {
  const body = { jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) };
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, { bridge, parsedBody: body });
  return (await res.json()) as any;
}

async function callTool(runtime: MCPServerRuntime, bridge: StubBridge, name: string, args: unknown) {
  const json = await rpc(runtime, bridge, 'tools/call', { name, arguments: args });
  const text = json.result?.content?.map((c: any) => c.text).join('\n') ?? json.error?.message ?? '';
  return {
    // A tool error arrives as `result.isError`; a protocol error as `error`.
    // Either is a refusal — what must never happen is a plain successful result.
    refused: json.result?.isError === true || Boolean(json.error),
    text: String(text),
    json,
  };
}

/**
 * The minimum VALID arguments for every tool the surface advertises, keyed by
 * tool name. The sweep below fails if `tools/list` grows a name this table does
 * not carry, so a tool cannot be added without someone deciding its posture.
 */
const VALID_ARGS: Record<string, Record<string, unknown>> = {
  list_objects: {},
  describe_object: { objectName: 'crm_opportunity' },
  validate_expression: { objectName: 'crm_opportunity', expression: 'record.amount' },
  query_records: { objectName: 'crm_opportunity' },
  aggregate_records: { objectName: 'crm_opportunity', aggregations: [{ function: 'count', alias: 'n' }] },
  get_record: { objectName: 'crm_opportunity', recordId: 'r1' },
  create_record: { objectName: 'crm_opportunity', data: { name: 'x' } },
  update_record: { objectName: 'crm_opportunity', recordId: 'r1', data: { name: 'x' } },
  delete_record: { objectName: 'crm_opportunity', recordId: 'r1' },
  list_actions: {},
  run_action: { actionName: 'complete_task' },
};

describe('MCP tool arguments — undeclared keys are refused (#16913)', () => {
  let runtime: MCPServerRuntime;
  let bridge: StubBridge;

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    bridge = makeBridge();
  });

  // ── The two reported repros ────────────────────────────────────────────────

  it('the reported `sort` call is refused, and names `orderBy` as the spelling to send', async () => {
    const { refused, text } = await callTool(runtime, bridge, 'query_records', {
      objectName: 'crm_opportunity',
      sort: '-amount',
      limit: 3,
    });
    expect(refused).toBe(true);
    expect(text).toContain('sort');
    expect(text).toContain('orderBy');
    // The refusal is the whole answer: nothing ran, so no rows in seed order
    // can be mistaken for "the top 3 by amount".
    expect(bridge.calls.find((c: any[]) => c[0] === 'query')).toBeUndefined();
  });

  it('the reported `filters` call is refused, and names `where` as the spelling to send', async () => {
    const { refused, text } = await callTool(runtime, bridge, 'query_records', {
      objectName: 'crm_opportunity',
      filters: [['name', 'contains', 'Meridian']],
    });
    expect(refused).toBe(true);
    expect(text).toContain('filters');
    expect(text).toContain('where');
    expect(bridge.calls.find((c: any[]) => c[0] === 'query')).toBeUndefined();
  });

  it('the reported `filter` call is refused, and names `where` as the spelling to send', async () => {
    const { refused, text } = await callTool(runtime, bridge, 'query_records', {
      objectName: 'crm_opportunity',
      filter: "name contains 'Meridian'",
    });
    expect(refused).toBe(true);
    expect(text).toContain('filter');
    expect(text).toContain('where');
    expect(bridge.calls.find((c: any[]) => c[0] === 'query')).toBeUndefined();
  });

  // ── The preservation half: the declared spellings still work, unchanged ────

  it('the DECLARED spellings still reach the bridge with exactly the arguments sent', async () => {
    const { refused } = await callTool(runtime, bridge, 'query_records', {
      objectName: 'crm_opportunity',
      where: { status: 'open' },
      fields: ['name', 'amount'],
      orderBy: [{ field: 'amount', order: 'desc' }],
      limit: 3,
      offset: 6,
    });
    expect(refused).toBe(false);
    const call = bridge.calls.find((c: any[]) => c[0] === 'query');
    expect(call).toBeDefined();
    expect(call[1]).toBe('crm_opportunity');
    expect(call[2]).toMatchObject({
      where: { status: 'open' },
      fields: ['name', 'amount'],
      orderBy: [{ field: 'amount', order: 'desc' }],
      limit: 3,
      offset: 6,
    });
  });

  it('an argument-less tool still accepts an empty argument object', async () => {
    // The control for the closure: `{}` is a valid payload for a shape that
    // declares nothing, and closing the shape must not turn it into a refusal.
    const { refused } = await callTool(runtime, bridge, 'list_objects', {});
    expect(refused).toBe(false);
    expect(bridge.calls.find((c: any[]) => c[0] === 'listObjects')).toBeDefined();
  });

  // ── The sweep: every advertised tool holds the same posture ────────────────

  it('advertises the eleven tools this sweep covers', async () => {
    const json = await rpc(runtime, bridge, 'tools/list');
    const names = (json.result?.tools ?? []).map((t: any) => t.name).sort();
    expect(names).toEqual(Object.keys(VALID_ARGS).sort());
    expect(names).toHaveLength(11);
  });

  it('every advertised tool ACCEPTS its declared arguments (the sweep control)', async () => {
    const json = await rpc(runtime, bridge, 'tools/list');
    const names: string[] = (json.result?.tools ?? []).map((t: any) => t.name);
    const failures: string[] = [];
    for (const name of names) {
      const { refused, text } = await callTool(runtime, bridge, name, VALID_ARGS[name]);
      if (refused) failures.push(`${name}: ${text}`);
    }
    expect(failures).toEqual([]);
  });

  it('every advertised tool REFUSES an undeclared key, without touching the bridge', async () => {
    const json = await rpc(runtime, bridge, 'tools/list');
    const names: string[] = (json.result?.tools ?? []).map((t: any) => t.name);
    const accepted: string[] = [];
    for (const name of names) {
      const before = bridge.calls.length;
      const { refused, text } = await callTool(runtime, bridge, name, {
        ...VALID_ARGS[name],
        // A spelling no surface in this repo declares, so a match would be a
        // finding in itself rather than a coincidence.
        zzUndeclaredProbeKey: 'x',
      });
      if (!refused) accepted.push(name);
      // Refused means refused before execution — the bridge is untouched.
      else if (bridge.calls.length !== before) accepted.push(`${name} (refused but reached the bridge: ${text})`);
    }
    expect(accepted).toEqual([]);
  });

  it('the refusal echoes the offending key back, on every tool', async () => {
    const json = await rpc(runtime, bridge, 'tools/list');
    const names: string[] = (json.result?.tools ?? []).map((t: any) => t.name);
    const silent: string[] = [];
    for (const name of names) {
      const { text } = await callTool(runtime, bridge, name, {
        ...VALID_ARGS[name],
        zzUndeclaredProbeKey: 'x',
      });
      if (!text.includes('zzUndeclaredProbeKey')) silent.push(`${name}: ${text}`);
    }
    expect(silent).toEqual([]);
  });

  it('`tools/list` DECLARES the closed set, so an agent can read it off the schema', async () => {
    // Triage: "Refusing narrows what the tool accepts ⇒ declare it." The
    // narrowing is only discoverable if the advertised JSON Schema says so.
    const json = await rpc(runtime, bridge, 'tools/list');
    const open = (json.result?.tools ?? [])
      .filter((t: any) => t.inputSchema?.additionalProperties !== false)
      .map((t: any) => t.name);
    expect(open).toEqual([]);
  });
});
