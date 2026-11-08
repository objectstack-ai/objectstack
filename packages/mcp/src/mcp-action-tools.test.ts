// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpActionBridge } from './mcp-http-tools.js';

/**
 * A combined data+action bridge that records calls, so tests can assert that
 * the action tools delegate (principal-bound) to the runtime bridge — the same
 * shape `buildMcpBridge` produces. Object methods are stubbed minimally so the
 * object tools still register alongside the action tools.
 */
function makeBridge(): McpDataBridge & McpActionBridge & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    // ── object surface (minimal) ──
    async listObjects() {
      return [{ name: 'todo_task', label: 'Task', fieldCount: 3 }];
    },
    async describeObject() {
      return null;
    },
    async query() {
      return { records: [] };
    },
    async get() {
      return null;
    },
    async create() {
      return {};
    },
    async update() {
      return {};
    },
    async remove() {
      return {};
    },
    // ── action surface ──
    async listActions() {
      calls.push(['listActions']);
      return [
        {
          name: 'complete_task',
          objectName: 'todo_task',
          label: 'Mark Complete',
          description: 'Mark a todo task as complete.',
          type: 'script',
          requiresRecord: true,
          requiresConfirmation: false,
          params: [],
        },
        {
          name: 'delete_completed',
          objectName: 'todo_task',
          label: 'Delete Completed',
          description: 'Delete every completed task.',
          type: 'script',
          requiresRecord: false,
          requiresConfirmation: true,
        },
        {
          // An action on a system object — must be hidden by default.
          name: 'rotate_key',
          objectName: 'sys_api_key',
          label: 'Rotate',
          type: 'script',
          requiresRecord: true,
          requiresConfirmation: true,
        },
      ];
    },
    async runAction(name: string, input: any) {
      calls.push(['runAction', name, input]);
      if (name === 'forbidden') {
        throw new Error("Action 'forbidden' requires capability [manage_platform] — caller is missing [manage_platform]");
      }
      return {
        ok: true,
        action: name,
        objectName: input?.objectName ?? 'todo_task',
        ...(input?.recordId ? { recordId: input.recordId } : {}),
        result: { status: 'completed' },
      };
    },
  };
}

/** An object-only bridge (no action methods) — the pre-existing CRUD shape. */
function makeObjectOnlyBridge(): McpDataBridge {
  return {
    async listObjects() {
      return [{ name: 'todo_task', label: 'Task', fieldCount: 3 }];
    },
    async describeObject() {
      return null;
    },
    async query() {
      return {};
    },
    async get() {
      return null;
    },
    async create() {
      return {};
    },
    async update() {
      return {};
    },
    async remove() {
      return {};
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

async function call(runtime: MCPServerRuntime, body: unknown, bridge?: any) {
  const res = await runtime.handleHttpRequest(mcpRequest(body), { bridge, parsedBody: body });
  const json = res.status === 202 ? null : await res.json();
  return { status: res.status, json };
}

const toolsCall = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});

describe('MCP action tools (list_actions / run_action)', () => {
  let runtime: MCPServerRuntime;
  let bridge: ReturnType<typeof makeBridge>;

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    bridge = makeBridge();
  });

  it('registers list_actions and run_action alongside the object tools', async () => {
    const { json } = await call(runtime, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, bridge);
    const names = json.result.tools.map((t: any) => t.name);
    expect(names).toContain('list_actions');
    expect(names).toContain('run_action');
    // Object tools remain present and unchanged.
    expect(names).toContain('query_records');
    expect(names).toContain('delete_record');
  });

  it('does NOT register action tools when the bridge has no action methods', async () => {
    const { json } = await call(
      runtime,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      makeObjectOnlyBridge(),
    );
    const names = json.result.tools.map((t: any) => t.name);
    expect(names).not.toContain('list_actions');
    expect(names).not.toContain('run_action');
    // …but the object tools are still there (graceful degradation).
    expect(names).toContain('query_records');
  });

  it('marks run_action destructive and list_actions read-only', async () => {
    const { json } = await call(runtime, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, bridge);
    const byName = Object.fromEntries(json.result.tools.map((t: any) => [t.name, t]));
    expect(byName.run_action.annotations.destructiveHint).toBe(true);
    expect(byName.run_action.annotations.readOnlyHint).toBe(false);
    expect(byName.list_actions.annotations.readOnlyHint).toBe(true);
  });

  it('list_actions returns the caller-visible actions and hides system-object actions', async () => {
    const { json } = await call(runtime, toolsCall(2, 'list_actions', {}), bridge);
    const payload = JSON.parse(json.result.content[0].text);
    const names = payload.actions.map((a: any) => a.name);
    expect(names).toEqual(['complete_task', 'delete_completed']); // rotate_key (sys_api_key) hidden
    expect(payload.totalCount).toBe(2);
    expect(bridge.calls).toContainEqual(['listActions']);
  });

  it('run_action delegates to the bridge with name, recordId and params', async () => {
    const { json } = await call(
      runtime,
      toolsCall(3, 'run_action', { actionName: 'complete_task', recordId: 't1', params: { note: 'done' } }),
      bridge,
    );
    expect(json.result.isError).toBeFalsy();
    const runCall = bridge.calls.find((c) => c[0] === 'runAction');
    expect(runCall[1]).toBe('complete_task');
    expect(runCall[2]).toEqual({ objectName: undefined, recordId: 't1', params: { note: 'done' } });
    const payload = JSON.parse(json.result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.result).toEqual({ status: 'completed' });
  });

  it('run_action requires an actionName', async () => {
    const { json } = await call(runtime, toolsCall(4, 'run_action', { actionName: '' }), bridge);
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/actionName is required/i);
    expect(bridge.calls.find((c) => c[0] === 'runAction')).toBeUndefined();
  });

  it('run_action rejects system-object actions fail-closed (never reaches the bridge)', async () => {
    const { json } = await call(
      runtime,
      toolsCall(5, 'run_action', { actionName: 'rotate_key', objectName: 'sys_api_key', recordId: 'k1' }),
      bridge,
    );
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/system object/i);
    expect(bridge.calls.find((c) => c[0] === 'runAction')).toBeUndefined();
  });

  it('surfaces a permission denial from the bridge as a tool error, not a thrown wire error', async () => {
    const { status, json } = await call(
      runtime,
      toolsCall(6, 'run_action', { actionName: 'forbidden', recordId: 't1' }),
      bridge,
    );
    expect(status).toBe(200);
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/requires capability/i);
  });

  // [#31272] A fault answers what the `/meta` door answers: its text is
  // withheld from the agent and logged for the operator.
  it('surfaces list_actions bridge errors as tool errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = {
      ...bridge,
      async listActions() {
        throw new Error('metadata unavailable');
      },
    };
    try {
      const { status, json } = await call(runtime, toolsCall(7, 'list_actions', {}), failing);
      expect(status).toBe(200);
      expect(json.result.isError).toBe(true);
      expect(JSON.parse(json.result.content[0].text)).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 },
      });
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0])).toContain('metadata unavailable');
    } finally {
      log.mockRestore();
    }
  });
});
