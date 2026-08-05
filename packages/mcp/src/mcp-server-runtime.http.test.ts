// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';

/** Records every bridge call so tests can assert principal-bound delegation. */
function makeBridge(): McpDataBridge & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    async listObjects() {
      calls.push(['listObjects']);
      return [
        { name: 'task', label: 'Task', fieldCount: 4 },
        { name: 'sys_user', label: 'User', fieldCount: 9 },
      ];
    },
    async describeObject(name: string) {
      calls.push(['describeObject', name]);
      if (name === 'task') return { name: 'task', fields: [{ name: 'title', type: 'text' }] };
      return null;
    },
    async query(object: string, opts: any) {
      calls.push(['query', object, opts]);
      return { object, records: [{ id: '1', title: 'a' }], total: 1 };
    },
    async get(object: string, id: string) {
      calls.push(['get', object, id]);
      return { id, title: 'a' };
    },
    async create(object: string, data: any) {
      calls.push(['create', object, data]);
      return { object, id: 'new1', record: data };
    },
    async update(object: string, id: string, data: any) {
      calls.push(['update', object, id, data]);
      return { object, id, record: data };
    },
    async remove(object: string, id: string) {
      calls.push(['remove', object, id]);
      // [#5581] `success`, not `deleted` — this double stands in for
      // `callData('delete', …)`, whose two paths now both answer the spec's
      // `DeleteDataResponse` shape. No assertion here reads the key; it is
      // kept honest so the next reader does not copy a shape the producer
      // stopped returning.
      return { object, id, success: true };
    },
  };
}

function mcpRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
}

async function call(runtime: MCPServerRuntime, body: unknown, bridge?: McpDataBridge) {
  const res = await runtime.handleHttpRequest(mcpRequest(body), { bridge, parsedBody: body });
  const json = res.status === 202 ? null : await res.json();
  return { status: res.status, json };
}

const INIT = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
};

describe('MCPServerRuntime.handleHttpRequest (Streamable HTTP)', () => {
  let runtime: MCPServerRuntime;
  let bridge: ReturnType<typeof makeBridge>;

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    bridge = makeBridge();
  });

  it('handles initialize and reports server info', async () => {
    const { status, json } = await call(runtime, INIT, bridge);
    expect(status).toBe(200);
    expect(json.result.serverInfo.name).toBe('objectstack-test');
    expect(json.result.capabilities.tools).toBeDefined();
  });

  it('lists the object-CRUD tools', async () => {
    const { json } = await call(runtime, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, bridge);
    const names = json.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(
      [
        'create_record',
        'delete_record',
        'describe_object',
        'get_record',
        'list_objects',
        'query_records',
        'update_record',
        'validate_expression',
      ].sort(),
    );
  });

  it('marks delete_record destructive and query_records read-only', async () => {
    const { json } = await call(runtime, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, bridge);
    const byName = Object.fromEntries(json.result.tools.map((t: any) => [t.name, t]));
    expect(byName.delete_record.annotations.destructiveHint).toBe(true);
    expect(byName.query_records.annotations.readOnlyHint).toBe(true);
  });

  it('exposes no tools (no tools capability) when no bridge is provided', async () => {
    // Without a bridge, no tools are registered, so the SDK never wires the
    // tools/list handler — the request resolves to a JSON-RPC error, not a
    // tool list. The dispatcher always supplies a bridge in practice.
    const { json } = await call(runtime, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(json.result).toBeUndefined();
    expect(json.error).toBeDefined();
  });

  it('list_objects filters out system objects by default', async () => {
    const { json } = await call(
      runtime,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_objects', arguments: {} } },
      bridge,
    );
    const payload = JSON.parse(json.result.content[0].text);
    expect(payload.objects.map((o: any) => o.name)).toEqual(['task']);
    expect(bridge.calls).toContainEqual(['listObjects']);
  });

  it('query_records delegates to the bridge with filter + capped limit', async () => {
    const { json } = await call(
      runtime,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'query_records', arguments: { objectName: 'task', where: { status: 'open' }, limit: 5 } },
      },
      bridge,
    );
    expect(json.result.isError).toBeFalsy();
    const queryCall = bridge.calls.find((c) => c[0] === 'query');
    expect(queryCall[1]).toBe('task');
    expect(queryCall[2].where).toEqual({ status: 'open' });
    expect(queryCall[2].limit).toBe(5);
  });

  it('rejects system objects on object-scoped tools (fail-closed)', async () => {
    const { json } = await call(
      runtime,
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'describe_object', arguments: { objectName: 'sys_user' } },
      },
      bridge,
    );
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/system object/i);
    // The bridge must never be consulted for a blocked system object.
    expect(bridge.calls.find((c) => c[0] === 'describeObject')).toBeUndefined();
  });

  it('create_record delegates to the bridge', async () => {
    await call(
      runtime,
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'create_record', arguments: { objectName: 'task', data: { title: 'x' } } },
      },
      bridge,
    );
    expect(bridge.calls).toContainEqual(['create', 'task', { title: 'x' }]);
  });

  it('delete_record delegates to the bridge', async () => {
    await call(
      runtime,
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'delete_record', arguments: { objectName: 'task', recordId: '1' } },
      },
      bridge,
    );
    expect(bridge.calls).toContainEqual(['remove', 'task', '1']);
  });

  it('returns 406 when the client does not accept both JSON and SSE', async () => {
    const req = new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(INIT),
    });
    const res = await runtime.handleHttpRequest(req, { bridge, parsedBody: INIT });
    expect(res.status).toBe(406);
  });

  it('surfaces bridge errors as tool errors, not thrown across the wire', async () => {
    const failing: McpDataBridge = {
      ...bridge,
      async query() {
        throw new Error('RLS: not permitted');
      },
    };
    const { status, json } = await call(
      runtime,
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'query_records', arguments: { objectName: 'task' } },
      },
      failing,
    );
    expect(status).toBe(200);
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toContain('RLS: not permitted');
  });
});

describe('aggregate_records (GROUP BY aggregation tool)', () => {
  let runtime: MCPServerRuntime;

  /** Bridge WITH the optional aggregate seam implemented. */
  function makeAggBridge(rows: unknown[] = [{ status: 'open', n: 2 }]) {
    const base = makeBridge();
    const calls = base.calls;
    return {
      ...base,
      calls,
      async aggregate(object: string, opts: any) {
        calls.push(['aggregate', object, opts]);
        return rows;
      },
    };
  }

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
  });

  it('registers only when the bridge implements aggregate (graceful degradation)', async () => {
    const without = await call(runtime, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, makeBridge());
    expect(without.json.result.tools.map((t: any) => t.name)).not.toContain('aggregate_records');

    const runtime2 = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    const withAgg = await call(runtime2, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, makeAggBridge());
    const byName = Object.fromEntries(withAgg.json.result.tools.map((t: any) => [t.name, t]));
    expect(byName.aggregate_records).toBeDefined();
    expect(byName.aggregate_records.annotations.readOnlyHint).toBe(true);
  });

  it('delegates groupBy/aggregations/where to the bridge and returns rows', async () => {
    const bridge = makeAggBridge([{ status: 'open', n: 2 }, { status: 'done', n: 5 }]);
    const { json } = await call(
      runtime,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'aggregate_records',
          arguments: {
            objectName: 'task',
            groupBy: ['status', { field: 'created_at', dateGranularity: 'month' }],
            aggregations: [{ function: 'count', alias: 'n' }],
            where: { active: true },
          },
        },
      },
      bridge,
    );
    expect(json.result.isError).toBeFalsy();
    const payload = JSON.parse(json.result.content[0].text);
    expect(payload.rows).toHaveLength(2);
    expect(payload.totalGroups).toBe(2);
    expect(payload.truncated).toBeUndefined();
    const aggCall = bridge.calls.find((c: any[]) => c[0] === 'aggregate');
    expect(aggCall[1]).toBe('task');
    expect(aggCall[2].groupBy).toEqual(['status', { field: 'created_at', dateGranularity: 'month' }]);
    expect(aggCall[2].aggregations).toEqual([{ function: 'count', alias: 'n' }]);
    expect(aggCall[2].where).toEqual({ active: true });
  });

  it('rejects system objects fail-closed without consulting the bridge', async () => {
    const bridge = makeAggBridge();
    const { json } = await call(
      runtime,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'aggregate_records',
          arguments: {
            objectName: 'sys_user',
            aggregations: [{ function: 'count', alias: 'n' }],
          },
        },
      },
      bridge,
    );
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/system object/i);
    expect(bridge.calls.find((c: any[]) => c[0] === 'aggregate')).toBeUndefined();
  });

  it('rejects an empty aggregations array (schema min(1))', async () => {
    const bridge = makeAggBridge();
    const { json } = await call(
      runtime,
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'aggregate_records',
          arguments: { objectName: 'task', aggregations: [] },
        },
      },
      bridge,
    );
    // Zod input validation fails before the handler runs — surfaced as a
    // tool error or JSON-RPC error depending on SDK version; both are fine,
    // the invariant is that the bridge is never reached.
    expect(json.result?.isError === true || json.error != null).toBe(true);
    expect(bridge.calls.find((c: any[]) => c[0] === 'aggregate')).toBeUndefined();
  });

  it('caps the returned group rows at the query limit with a truncated flag', async () => {
    const manyGroups = Array.from({ length: 60 }, (_, i) => ({ k: `g${i}`, n: i }));
    const bridge = makeAggBridge(manyGroups);
    const { json } = await call(
      runtime,
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'aggregate_records',
          arguments: {
            objectName: 'task',
            groupBy: ['k'],
            aggregations: [{ function: 'count', alias: 'n' }],
          },
        },
      },
      bridge,
    );
    const payload = JSON.parse(json.result.content[0].text);
    expect(payload.rows).toHaveLength(50); // DEFAULT_MAX_LIMIT
    expect(payload.totalGroups).toBe(60);
    expect(payload.truncated).toBe(true);
  });

  it('surfaces bridge errors (e.g. FLS denial) as tool errors', async () => {
    const bridge = makeAggBridge();
    bridge.aggregate = async () => {
      throw new Error('[Security] Field read denied: not permitted to aggregate [salary]');
    };
    const { json } = await call(
      runtime,
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'aggregate_records',
          arguments: {
            objectName: 'employee',
            aggregations: [{ function: 'sum', field: 'salary', alias: 'total' }],
          },
        },
      },
      bridge,
    );
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toContain('Field read denied');
  });
});
