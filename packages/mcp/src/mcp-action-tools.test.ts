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

// [ADR-0150 D2/D5/D6] An action is addressed by (namespace, name): the listing
// names each row's namespace and derived face, a face two actions derive is
// refused once naming both (neither row is dropped), and `run_action` forwards
// the exact qualifier only when the caller gives one.
describe('MCP action tools: namespace and face (ADR-0150)', () => {
  let runtime: MCPServerRuntime;
  // The wire answer, read as the JSON-RPC envelope it is.
  const callJson = async (body: unknown, bridge: unknown): Promise<any> => (await call(runtime, body, bridge)).json;

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
  });

  function pairBridge(rows: any[]) {
    const bridge = makeBridge();
    return Object.assign(bridge, {
      async listActions() {
        bridge.calls.push(['listActions']);
        return rows;
      },
    });
  }

  const digest = (namespace: string) => ({
    name: 'send_digest',
    objectName: 'global',
    namespace,
    face: `${namespace}-send_digest`,
    label: 'Send digest',
    type: 'script',
    requiresRecord: false,
    requiresConfirmation: false,
  });

  it('list_actions lists both holders of one name, each with its namespace and face', async () => {
    const bridge = pairBridge([digest('crm'), digest('hr')]);
    const json = await callJson(toolsCall(1, 'list_actions', {}), bridge);
    const payload = JSON.parse(json.result.content[0].text);
    expect(payload.actions.map((a: any) => [a.namespace, a.face])).toEqual([
      ['crm', 'crm-send_digest'],
      ['hr', 'hr-send_digest'],
    ]);
    expect(payload.totalCount).toBe(2);
    expect(payload).not.toHaveProperty('refusedFaces');
  });

  it('a face two actions derive is refused once, naming both, and neither row is dropped', async () => {
    const twin = (namespace: string) => ({ ...digest(namespace), face: 'shared-face' });
    const bridge = pairBridge([twin('crm'), twin('hr'), digest('ops')]);
    const json = await callJson(toolsCall(2, 'list_actions', {}), bridge);
    const payload = JSON.parse(json.result.content[0].text);
    expect(payload.totalCount).toBe(3);
    expect(payload.actions.map((a: any) => a.namespace)).toEqual(['crm', 'hr', 'ops']);
    expect(payload.actions.map((a: any) => a.face)).toEqual([undefined, undefined, 'ops-send_digest']);
    expect(payload.refusedFaces).toHaveLength(1);
    expect(payload.refusedFaces[0].face).toBe('shared-face');
    expect(payload.refusedFaces[0].reason).toContain('namespace "crm"');
    expect(payload.refusedFaces[0].reason).toContain('namespace "hr"');
  });

  it('run_action forwards namespace to the bridge when given', async () => {
    const bridge = makeBridge();
    const json = await callJson(toolsCall(3, 'run_action', { actionName: 'send_digest', namespace: 'hr' }), bridge);
    expect(json.result.isError).toBeFalsy();
    const runCall = bridge.calls.find((c) => c[0] === 'runAction');
    expect(runCall[1]).toBe('send_digest');
    expect(runCall[2].namespace).toBe('hr');
  });

  it('CONTROL: run_action without namespace reaches the bridge with no namespace key', async () => {
    const bridge = makeBridge();
    await call(runtime, toolsCall(4, 'run_action', { actionName: 'complete_task', recordId: 't1' }), bridge);
    const runCall = bridge.calls.find((c) => c[0] === 'runAction');
    expect(Object.keys(runCall[2])).not.toContain('namespace');
  });

  it('a bridge refusal of a bare two-holder name reaches the caller as a coded tool error', async () => {
    const bridge = Object.assign(makeBridge(), {
      async runAction() {
        throw Object.assign(
          new Error('The name "send_digest" is held by 2 packages: "com.crm" and "com.hr".'),
          { code: 'RESOURCE_CONFLICT', status: 409 },
        );
      },
    });
    const json = await callJson(toolsCall(5, 'run_action', { actionName: 'send_digest' }), bridge);
    expect(json.result.isError).toBe(true);
    const text = json.result.content[0].text;
    expect(text).toContain('RESOURCE_CONFLICT');
    expect(text).toContain('com.crm');
    expect(text).toContain('com.hr');
  });
});

// [ADR-0150 D6] One name bound to several objects lists one row per binding,
// each with its own face (the platform binds `invite_user` to four identity
// objects, one of them record-scoped). `run_action` takes a listed face as
// `actionName` and runs that one binding by its address, read back against the
// caller's own listing; the bare name stays ambiguous.
describe('MCP action tools: run_action takes a listed face (ADR-0150 D6)', () => {
  let runtime: MCPServerRuntime;

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
  });

  const invite = (objectName: string, requiresRecord = false) => ({
    name: 'invite_user',
    objectName,
    namespace: 'sys',
    face: `${objectName}-invite_user`,
    label: 'Invite User',
    type: 'api',
    requiresRecord,
    requiresConfirmation: false,
    aiExposed: true,
  });

  /** The runtime's answers, modelled: a bare name four objects bind is refused as ambiguous. */
  function faceBridge() {
    const bridge = makeBridge();
    return Object.assign(bridge, {
      async listActions() {
        bridge.calls.push(['listActions']);
        return [
          invite('sys_user'),
          invite('sys_organization', true),
          invite('sys_member'),
          invite('sys_invitation'),
          // Not exposed to AI on a system object: the listing withholds it.
          { name: 'rotate_key', objectName: 'sys_api_key', namespace: 'sys', face: 'sys_api_key-rotate_key',
            label: 'Rotate', type: 'script', requiresRecord: true, requiresConfirmation: true },
          { name: 'complete_task', objectName: 'todo_task', namespace: 'todo', face: 'todo_task-complete_task',
            label: 'Mark Complete', type: 'script', requiresRecord: true, requiresConfirmation: false },
        ];
      },
      async runAction(name: string, input: any) {
        bridge.calls.push(['runAction', name, input]);
        if (name === 'invite_user' && !input?.objectName) {
          throw Object.assign(
            new Error("Action 'invite_user' exists on multiple objects (sys_user, sys_organization, sys_member, "
              + 'sys_invitation); pass objectName to disambiguate'),
            { code: 'VALIDATION_ERROR', status: 400 },
          );
        }
        return { ok: true, action: name, objectName: input?.objectName ?? 'todo_task', result: { status: 'done' } };
      },
    });
  }

  const run = async (bridge: any, args: Record<string, unknown>) => {
    const { json } = await call(runtime, toolsCall(1, 'run_action', args), bridge);
    const text: string = json.result.content[0].text;
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { text }; }
    return { isError: json.result.isError === true, payload, text };
  };
  const runCalls = (bridge: any) => bridge.calls.filter((c: any[]) => c[0] === 'runAction');

  it('list_actions hands each binding of one name its own face', async () => {
    const { json } = await call(runtime, toolsCall(1, 'list_actions', {}), faceBridge());
    const payload = JSON.parse(json.result.content[0].text);
    const invites = payload.actions.filter((a: any) => a.name === 'invite_user');
    expect(invites.map((a: any) => a.face)).toEqual([
      'sys_user-invite_user', 'sys_organization-invite_user', 'sys_member-invite_user', 'sys_invitation-invite_user',
    ]);
  });

  it('a listed face runs its one binding: the bridge receives the name, objectName and namespace', async () => {
    const bridge = faceBridge();
    const r = await run(bridge, { actionName: 'sys_member-invite_user', params: { email: 'a@example.com', role: 'member' } });
    expect(r.isError, r.text).toBe(false);
    expect(r.payload).toMatchObject({ ok: true, action: 'invite_user', objectName: 'sys_member' });
    const calls = runCalls(bridge);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe('invite_user');
    expect(calls[0][2]).toMatchObject({
      objectName: 'sys_member', namespace: 'sys', params: { email: 'a@example.com', role: 'member' },
    });
  });

  it('the record-scoped twin\'s face runs that binding with its record id', async () => {
    const bridge = faceBridge();
    const r = await run(bridge, {
      actionName: 'sys_organization-invite_user', recordId: 'org_1', params: { email: 'a@example.com', role: 'member' },
    });
    expect(r.isError, r.text).toBe(false);
    const calls = runCalls(bridge);
    expect(calls[0][1]).toBe('invite_user');
    expect(calls[0][2]).toMatchObject({ objectName: 'sys_organization', namespace: 'sys', recordId: 'org_1' });
  });

  it('a face no listed row carries is not found, and nothing runs', async () => {
    const bridge = faceBridge();
    const r = await run(bridge, { actionName: 'sys_team-invite_user' });
    expect(r.isError).toBe(true);
    expect(r.payload.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(runCalls(bridge)).toHaveLength(0);
  });

  it('the face of an action the caller is not shown is not found, and nothing runs', async () => {
    const bridge = faceBridge();
    const r = await run(bridge, { actionName: 'sys_api_key-rotate_key', recordId: 'k1' });
    expect(r.isError).toBe(true);
    expect(r.payload.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(runCalls(bridge)).toHaveLength(0);
  });

  it('a face the listing refuses as shared is not found, naming why', async () => {
    const bridge = faceBridge();
    const twin = (objectName: string) => ({ ...invite(objectName), face: 'shared-face' });
    Object.assign(bridge, {
      async listActions() {
        return [twin('sys_user'), twin('sys_member')];
      },
    });
    const r = await run(bridge, { actionName: 'shared-face' });
    expect(r.isError).toBe(true);
    expect(r.payload.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(r.payload.error.message).toContain('sys_member');
    expect(runCalls(bridge)).toHaveLength(0);
  });

  it('a face with a disagreeing objectName or namespace is refused, and nothing runs', async () => {
    const bridge = faceBridge();
    for (const extra of [{ objectName: 'sys_user' }, { namespace: 'crm' }]) {
      const r = await run(bridge, { actionName: 'sys_member-invite_user', ...extra });
      expect(r.isError).toBe(true);
      expect(r.payload.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    }
    expect(runCalls(bridge)).toHaveLength(0);
  });

  it('a face with its own objectName and namespace runs as the face alone', async () => {
    const bridge = faceBridge();
    const r = await run(bridge, { actionName: 'sys_member-invite_user', objectName: 'sys_member', namespace: 'sys' });
    expect(r.isError, r.text).toBe(false);
    expect(runCalls(bridge)[0][2]).toMatchObject({ objectName: 'sys_member', namespace: 'sys' });
  });

  it('CONTROL: a name with objectName reaches the bridge as before, with no namespace key', async () => {
    const bridge = faceBridge();
    const r = await run(bridge, { actionName: 'invite_user', objectName: 'sys_member', params: { email: 'a@example.com' } });
    expect(r.isError, r.text).toBe(false);
    const calls = runCalls(bridge);
    expect(calls[0][1]).toBe('invite_user');
    expect(calls[0][2].objectName).toBe('sys_member');
    expect(Object.keys(calls[0][2])).not.toContain('namespace');
  });

  it('CONTROL: a unique bare name reaches the bridge as before, never read against the listing', async () => {
    const bridge = faceBridge();
    const r = await run(bridge, { actionName: 'complete_task', recordId: 't1' });
    expect(r.isError, r.text).toBe(false);
    expect(bridge.calls.some((c: any[]) => c[0] === 'listActions')).toBe(false);
    const calls = runCalls(bridge);
    expect(calls[0][1]).toBe('complete_task');
    expect(calls[0][2].objectName).toBeUndefined();
    expect(Object.keys(calls[0][2])).not.toContain('namespace');
  });

  it('CONTROL: an ambiguous bare name still answers the runtime\'s refusal', async () => {
    const bridge = faceBridge();
    const r = await run(bridge, { actionName: 'invite_user', params: { email: 'a@example.com' } });
    expect(r.isError).toBe(true);
    expect(r.payload.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(r.payload.error.message).toContain('exists on multiple objects');
    expect(runCalls(bridge)[0][2].objectName).toBeUndefined();
  });
});
