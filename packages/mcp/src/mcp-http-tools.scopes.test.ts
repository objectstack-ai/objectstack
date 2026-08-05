// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * OAuth tool-family scope gating (#2698).
 *
 * `grantedScopes` narrows which tool families REGISTER on the per-request
 * server: `data:read` → list/describe/query/get, `data:write` →
 * create/update/delete, `actions:execute` → list_actions/run_action.
 * A tool outside the grant is absent from tools/list AND rejected on
 * tools/call (unknown tool) — enforcement at dispatch, fail-closed.
 * `grantedScopes: undefined` (API-key / session provenance) keeps the full
 * surface — the regression guard for the unchanged headless track.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_ACTIONS,
} from '@objectstack/spec/ai';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpActionBridge, McpDataBridge } from './mcp-http-tools.js';

const READ_TOOLS = ['list_objects', 'describe_object', 'validate_expression', 'query_records', 'get_record', 'aggregate_records'];
const WRITE_TOOLS = ['create_record', 'update_record', 'delete_record'];
const ACTION_TOOLS = ['list_actions', 'run_action'];

function makeBridge(): McpDataBridge & McpActionBridge & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    async listObjects() { calls.push(['listObjects']); return [{ name: 'task', label: 'Task' }]; },
    async describeObject(name: string) { calls.push(['describeObject', name]); return { name }; },
    async query(object: string, opts: any) { calls.push(['query', object, opts]); return { object, records: [] }; },
    async get(object: string, id: string) { calls.push(['get', object, id]); return { id }; },
    async aggregate(object: string, opts: any) { calls.push(['aggregate', object, opts]); return []; },
    async create(object: string, data: any) { calls.push(['create', object, data]); return { object, id: 'n1' }; },
    async update(object: string, id: string, data: any) { calls.push(['update', object, id, data]); return { object, id }; },
    // [#5581] `success`, not `deleted` — mirrors what `callData('delete', …)`
    // now returns on BOTH of its paths (the spec's `DeleteDataResponse`).
    async remove(object: string, id: string) { calls.push(['remove', object, id]); return { object, id, success: true }; },
    async listActions() { calls.push(['listActions']); return [{ name: 'complete_task', objectName: 'task' }]; },
    async runAction(name: string, input: any) { calls.push(['runAction', name, input]); return { ok: true }; },
  };
}

async function call(runtime: MCPServerRuntime, bridge: any, grantedScopes: string[] | undefined, body: unknown) {
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, {
    bridge,
    parsedBody: body,
    ...(grantedScopes ? { toolOptions: { grantedScopes } } : {}),
  });
  return { status: res.status, json: res.status === 202 ? null : await res.json() };
}

async function listTools(runtime: MCPServerRuntime, bridge: any, grantedScopes?: string[]) {
  const { json } = await call(runtime, bridge, grantedScopes, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  return (json.result?.tools ?? []).map((t: any) => t.name).sort();
}

describe('MCP OAuth scope → tool-family gating', () => {
  let runtime: MCPServerRuntime;
  let bridge: ReturnType<typeof makeBridge>;

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    bridge = makeBridge();
  });

  it('undefined grantedScopes (API key / session) keeps the FULL tool surface', async () => {
    const names = await listTools(runtime, bridge, undefined);
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS, ...ACTION_TOOLS].sort());
  });

  it('data:read alone exposes only the read family', async () => {
    const names = await listTools(runtime, bridge, [MCP_OAUTH_SCOPE_DATA_READ]);
    expect(names).toEqual([...READ_TOOLS].sort());
  });

  it('data:write alone exposes only the write family', async () => {
    const names = await listTools(runtime, bridge, [MCP_OAUTH_SCOPE_DATA_WRITE]);
    expect(names).toEqual([...WRITE_TOOLS].sort());
  });

  it('actions:execute alone exposes only the action family', async () => {
    const names = await listTools(runtime, bridge, [MCP_OAUTH_SCOPE_ACTIONS]);
    expect(names).toEqual([...ACTION_TOOLS].sort());
  });

  it('all three scopes expose the full surface; unknown extras are ignored', async () => {
    const names = await listTools(runtime, bridge, [
      'openid',
      MCP_OAUTH_SCOPE_DATA_READ,
      MCP_OAUTH_SCOPE_DATA_WRITE,
      MCP_OAUTH_SCOPE_ACTIONS,
    ]);
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS, ...ACTION_TOOLS].sort());
  });

  it('an empty grant registers nothing (fail-closed)', async () => {
    const { json } = await call(runtime, bridge, [], { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    // No tools registered → the SDK never wires tools/list at all.
    expect(json.result).toBeUndefined();
    expect(json.error).toBeDefined();
  });

  it('calling a write tool with a read-only grant is rejected WITHOUT touching the bridge', async () => {
    const { json } = await call(runtime, bridge, [MCP_OAUTH_SCOPE_DATA_READ], {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'create_record', arguments: { objectName: 'task', data: { title: 'x' } } },
    });
    // Unregistered tool → JSON-RPC/tool error, never a successful result.
    const failed = Boolean(json.error) || json.result?.isError === true;
    expect(failed).toBe(true);
    expect(bridge.calls.find((c: any[]) => c[0] === 'create')).toBeUndefined();
  });

  it('a granted read tool still works alongside a denied write family', async () => {
    const { json } = await call(runtime, bridge, [MCP_OAUTH_SCOPE_DATA_READ], {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'query_records', arguments: { objectName: 'task' } },
    });
    expect(json.result.isError).toBeFalsy();
    expect(bridge.calls.find((c: any[]) => c[0] === 'query')).toBeDefined();
  });

  it('run_action with only data scopes is rejected without touching the bridge', async () => {
    const { json } = await call(
      runtime,
      bridge,
      [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_DATA_WRITE],
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'run_action', arguments: { actionName: 'complete_task' } },
      },
    );
    const failed = Boolean(json.error) || json.result?.isError === true;
    expect(failed).toBe(true);
    expect(bridge.calls.find((c: any[]) => c[0] === 'runAction')).toBeUndefined();
  });
});
