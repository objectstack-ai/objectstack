// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27681] The action tools' `sys_*` filter yields PER ACTION to the author's
 * AI opt-in, which the bridge attests as `aiExposed` (ADR-0011).
 *
 * Maintainer ruling 6513869839 (letter B): a `sys_*` action is reachable over
 * MCP only when the action itself declares `ai: { exposed: true, description }`.
 * This package never sees a declaration, so before the ruling its fail-closed
 * filter (`allowSystemObjects`, default false) hid and refused EVERY action on
 * a `sys_*` object by name. It now lets one through exactly when the bridge's
 * listing attests the opt-in — at `list_actions` AND at `run_action`, so an
 * agent that lists sees exactly what it may run — and stays closed for a bridge
 * that attests nothing. `allowSystemObjects` keeps its meaning and gains no
 * reach (ruling parameter 1).
 *
 * Driven through `MCPServerRuntime.handleHttpRequest` over JSON-RPC, the path
 * an external client hits. The bridge is a double; the runtime half (the
 * bridge that reads the declaration, and the gates behind the flag) is pinned
 * in `packages/runtime/src/mcp-system-object-action-exposure.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpActionBridge, McpActionSummary } from './mcp-http-tools.js';

const SYS = 'sys_user';

/** The bridge attests the author's opt-in on this one. */
const EXPOSED: McpActionSummary = { name: 'ban_user', objectName: SYS, type: 'api', requiresRecord: true, aiExposed: true };
/** A `sys_*` entry the bridge listed WITHOUT attesting the opt-in. */
const UNATTESTED: McpActionSummary = { name: 'unban_user', objectName: SYS, type: 'api', requiresRecord: true };
/** Control: an ordinary object's action, untouched by this change. */
const APP: McpActionSummary = { name: 'complete_task', objectName: 'todo_task', type: 'script', requiresRecord: true };

function makeBridge(listing: McpActionSummary[]): McpDataBridge & McpActionBridge & { runs: string[] } {
  const runs: string[] = [];
  return {
    runs,
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async listActions() { return listing; },
    async runAction(name: string) {
      runs.push(name);
      return { ok: true, action: name };
    },
  };
}

const toolsCall = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
});

async function call(bridge: ReturnType<typeof makeBridge>, body: unknown, allowSystemObjects?: boolean) {
  const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, {
    bridge,
    parsedBody: body,
    ...(allowSystemObjects !== undefined ? { toolOptions: { allowSystemObjects } } : {}),
  });
  return (await res.json()) as any;
}

const listedNames = async (bridge: ReturnType<typeof makeBridge>, allowSystemObjects?: boolean) => {
  const json = await call(bridge, toolsCall(1, 'list_actions', {}), allowSystemObjects);
  expect(json.result.isError, JSON.stringify(json.result)).toBeFalsy();
  return (JSON.parse(json.result.content[0].text).actions as McpActionSummary[]).map((a) => a.name);
};

describe('[#27681] list_actions: a sys_* action is listed exactly when the bridge attests its opt-in', () => {
  it('lists the attested sys_* action and hides the unattested one', async () => {
    const names = await listedNames(makeBridge([EXPOSED, UNATTESTED, APP]));
    expect(names).toEqual(['ban_user', 'complete_task']);
  });

  it('a bridge that attests nothing keeps every sys_* action hidden, as before', async () => {
    const { aiExposed: _dropped, ...unattested } = EXPOSED;
    expect(await listedNames(makeBridge([unattested, APP]))).toEqual(['complete_task']);
  });

  it('`allowSystemObjects: true` keeps its meaning: the tool layer lists every entry the bridge serves', async () => {
    expect(await listedNames(makeBridge([EXPOSED, UNATTESTED, APP]), true)).toEqual(['ban_user', 'unban_user', 'complete_task']);
  });
});

describe('[#27681] run_action: a sys_* action runs only where list_actions lists it', () => {
  it('REFUSES the unattested sys_* action before the bridge runs anything', async () => {
    const bridge = makeBridge([EXPOSED, UNATTESTED]);
    const json = await call(bridge, toolsCall(2, 'run_action', { actionName: 'unban_user', objectName: SYS, recordId: 'u1' }));
    expect(json.result.isError).toBe(true);
    expect(String(json.result.content[0].text)).toMatch(/system object "sys_user" is not exposed via MCP/);
    expect(bridge.runs).toEqual([]);
  });

  it('REFUSES a sys_* action the bridge does not list at all (not exposed, or not permitted for this caller)', async () => {
    const bridge = makeBridge([APP]);
    const json = await call(bridge, toolsCall(3, 'run_action', { actionName: 'ban_user', objectName: SYS, recordId: 'u1' }));
    expect(json.result.isError).toBe(true);
    expect(bridge.runs).toEqual([]);
  });

  it('a same-named attested action on ANOTHER object does not admit this one', async () => {
    const bridge = makeBridge([{ ...EXPOSED, objectName: 'sys_member' }]);
    const json = await call(bridge, toolsCall(4, 'run_action', { actionName: 'ban_user', objectName: SYS, recordId: 'u1' }));
    expect(json.result.isError).toBe(true);
    expect(bridge.runs).toEqual([]);
  });

  it('ADMITS the attested sys_* action and hands it to the bridge, whose gates decide the rest', async () => {
    const bridge = makeBridge([EXPOSED, UNATTESTED]);
    const json = await call(bridge, toolsCall(5, 'run_action', { actionName: 'ban_user', objectName: SYS, recordId: 'u1' }));
    expect(json.result.isError, JSON.stringify(json.result)).toBeFalsy();
    expect(bridge.runs).toEqual(['ban_user']);
  });

  it('CONTROL — an ordinary object\'s action is not screened against the listing', async () => {
    const bridge = makeBridge([]);
    const json = await call(bridge, toolsCall(6, 'run_action', { actionName: 'complete_task', objectName: 'todo_task', recordId: 't1' }));
    expect(json.result.isError).toBeFalsy();
    expect(bridge.runs).toEqual(['complete_task']);
  });
});
