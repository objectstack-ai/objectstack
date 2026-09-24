// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MCP `resume_run`, tool half (#15705): the tool's shape on the wire.
 *
 * `run_action` on a screen flow answers `status: 'paused'` with a `runId` and a
 * `screen`. Before this tool, nothing on the MCP surface could submit that
 * screen, so the run stayed parked. `resume_run` is the verb that submits it.
 * Who may resume what is the bridge's decision, pinned on the runtime bridge in
 * `@objectstack/runtime` (`mcp-resume-run.test.ts`). This file pins what this
 * package owns:
 *
 *  - the tool is registered exactly where it can work: beside `run_action`,
 *    when the bridge implements `resumeRun`, under the `actions:execute` scope;
 *  - `tools/list` declares its closed input schema, and `run_action`'s
 *    description names it only where it is registered;
 *  - the call reaches the bridge with exactly `{ values, confirm }`;
 *  - a coded refusal keeps its ADR-0112 envelope on the way back.
 *
 * The unknown-key refusal is swept with every other tool in
 * `mcp-http-tools.unknown-argument-keys.test.ts`, and the stdio transport's
 * listing is pinned in `mcp-stdio-tools.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpActionBridge } from './mcp-http-tools.js';

function makeBridge(resumeRun?: McpActionBridge['resumeRun']): McpDataBridge & McpActionBridge {
  return {
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async listActions() { return []; },
    async runAction() { return { ok: true }; },
    ...(resumeRun ? { resumeRun } : {}),
  };
}

let nextId = 1;

async function rpc(bridge: unknown, method: string, params?: unknown, grantedScopes?: string[]) {
  const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  const body = { jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) };
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge: bridge as any, parsedBody: body, ...(grantedScopes ? { toolOptions: { grantedScopes } } : {}) },
  );
  return (await res.json()) as any;
}

async function listTools(bridge: unknown, grantedScopes?: string[]): Promise<Record<string, any>> {
  const json = await rpc(bridge, 'tools/list', undefined, grantedScopes);
  return Object.fromEntries((json.result?.tools ?? []).map((t: any) => [t.name, t]));
}

describe('MCP resume_run — where it is registered', () => {
  it('is registered beside run_action when the bridge implements resumeRun, and not otherwise', async () => {
    const withResume = await listTools(makeBridge(vi.fn()));
    expect(withResume.run_action).toBeDefined();
    expect(withResume.resume_run).toBeDefined();

    const withoutResume = await listTools(makeBridge());
    expect(withoutResume.run_action).toBeDefined();
    expect(withoutResume.resume_run).toBeUndefined();
  });

  it('belongs to the actions:execute family: granted with it, absent without it', async () => {
    const bridge = makeBridge(vi.fn());
    expect((await listTools(bridge, ['actions:execute'])).resume_run).toBeDefined();
    const readOnly = await listTools(bridge, ['data:read']);
    expect(readOnly.resume_run).toBeUndefined();
    expect(readOnly.run_action).toBeUndefined();
  });

  it('run_action\'s description names resume_run only where resume_run is registered', async () => {
    expect((await listTools(makeBridge(vi.fn()))).run_action.description).toContain('resume_run');
    expect((await listTools(makeBridge())).run_action.description).not.toContain('resume_run');
  });
});

describe('MCP resume_run — its declared shape', () => {
  it('declares runId (required), values and confirm, closed against anything else', async () => {
    const tool = (await listTools(makeBridge(vi.fn()))).resume_run;
    expect(tool.inputSchema.required).toEqual(['runId']);
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(['confirm', 'runId', 'values']);
    expect(tool.inputSchema.properties.values.type).toBe('object');
    expect(tool.inputSchema.properties.confirm.type).toBe('boolean');
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  it('carries run_action\'s annotations: the rest of the flow runs here', async () => {
    const tool = (await listTools(makeBridge(vi.fn()))).resume_run;
    expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  });
});

describe('MCP resume_run — the call', () => {
  it('reaches the bridge with exactly the runId, the values and the confirmation', async () => {
    const resumeRun = vi.fn(async () => ({ ok: true, result: { status: 'completed' } }));
    const json = await rpc(makeBridge(resumeRun), 'tools/call', {
      name: 'resume_run',
      arguments: { runId: 'run_1', values: { subject: 'Call back', dueDate: '2026-10-01' }, confirm: true },
    });
    expect(json.result.isError).toBeFalsy();
    expect(resumeRun).toHaveBeenCalledTimes(1);
    expect(resumeRun).toHaveBeenCalledWith('run_1', {
      values: { subject: 'Call back', dueDate: '2026-10-01' },
      confirm: true,
    });
  });

  it('returns the bridge\'s answer unchanged, so a run paused on its next screen reads as paused', async () => {
    const answer = {
      ok: true,
      action: 'followup_wizard',
      objectName: 'crm_lead',
      recordId: 'lead_1',
      result: { success: true, status: 'paused', runId: 'run_1', screen: { nodeId: 'screen_2', fields: [] } },
    };
    const json = await rpc(makeBridge(vi.fn(async () => answer)), 'tools/call', {
      name: 'resume_run',
      arguments: { runId: 'run_1', values: { subject: 'x' } },
    });
    expect(JSON.parse(json.result.content[0].text)).toEqual(answer);
  });

  it('refuses an empty runId before the bridge is reached', async () => {
    const resumeRun = vi.fn();
    const json = await rpc(makeBridge(resumeRun), 'tools/call', { name: 'resume_run', arguments: { runId: '' } });
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/runId is required/);
    expect(resumeRun).not.toHaveBeenCalled();
  });

  it('keeps a coded refusal\'s ADR-0112 envelope — code, status and details — as a tool error', async () => {
    const refusal = Object.assign(new Error("Action 'close_lead' declares ai.requiresConfirmation: true"), {
      code: 'ACTION_CONFIRMATION_REQUIRED',
      status: 428,
      details: { actionName: 'close_lead', confirmationMember: 'confirm' },
    });
    const json = await rpc(makeBridge(vi.fn(async () => { throw refusal; })), 'tools/call', {
      name: 'resume_run',
      arguments: { runId: 'run_1', values: {} },
    });
    expect(json.result.isError).toBe(true);
    expect(JSON.parse(json.result.content[0].text)).toEqual({
      error: {
        code: 'ACTION_CONFIRMATION_REQUIRED',
        message: "Action 'close_lead' declares ai.requiresConfirmation: true",
        status: 428,
        details: { actionName: 'close_lead', confirmationMember: 'confirm' },
      },
    });
  });
});
