// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33690] The `run_action` and `resume_run` tools relay the amended
 * confirmation contract's two answers through the real MCP door
 * (`MCPServerRuntime.handleHttpRequest`, JSON-RPC `tools/call`):
 *
 *  - a hand-off (`ActionConfirmationPending`, `status: 'pending_confirmation'`)
 *    is the call's SUCCESSFUL answer: not an error result, the pending id and
 *    message intact, so an agent tells its person where to approve;
 *  - the `no_confirmation_service` refusal keeps the registered envelope
 *    (`428 ACTION_CONFIRMATION_REQUIRED`) with `details.reason`.
 *
 * The bridge is a double standing in for the runtime door, whose hand-off is
 * pinned in `packages/runtime/src/action-confirmation-handoff-33690.test.ts`;
 * this package asserts the tool's half (relay, envelope) without depending on
 * `@objectstack/runtime`, which deliberately does not depend back.
 */

import { describe, it, expect } from 'vitest';

import { AI_ACTION_CONFIRMATION_MEMBER, type ActionConfirmationPending } from '@objectstack/spec/contracts';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpActionBridge } from './mcp-http-tools.js';

const GATED = 'archive_account';

const pendingOf = (n: number): ActionConfirmationPending => ({
  status: 'pending_confirmation',
  pendingId: `pa_${n}`,
  message: `Action '${GATED}' on 'account' declares ai.requiresConfirmation: true, so a person confirms it. Pending confirmation: pa_${n}.`,
  actionName: GATED,
  objectName: 'account',
});

const NO_SERVICE = () => Object.assign(
  new Error(`Action '${GATED}' on 'account' declares ai.requiresConfirmation: true, so a person confirms it — nothing was run.`),
  {
    code: 'ACTION_CONFIRMATION_REQUIRED',
    status: 428,
    details: { actionName: GATED, objectName: 'account', confirmationMember: AI_ACTION_CONFIRMATION_MEMBER, reason: 'no_confirmation_service' },
  },
);

function makeBridge(mode: 'service' | 'none'): McpDataBridge & McpActionBridge & { calls: any[] } {
  const calls: any[] = [];
  let n = 0;
  const answer = async () => {
    if (mode === 'none') throw NO_SERVICE();
    return pendingOf(++n);
  };
  return {
    calls,
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async listActions() {
      return [{ name: GATED, objectName: 'account', type: 'script', requiresRecord: true, requiresConfirmation: true }];
    },
    async runAction(name: string, input: any) {
      calls.push(['runAction', name, input]);
      return answer();
    },
    async resumeRun(runId: string, input: any) {
      calls.push(['resumeRun', runId, input]);
      return answer();
    },
  };
}

function mcpRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
}

const toolsCall = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
});

async function call(bridge: McpDataBridge & McpActionBridge, body: unknown): Promise<any> {
  const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
  const res = await runtime.handleHttpRequest(mcpRequest(body), { bridge, parsedBody: body });
  return res.json();
}

describe('[#33690] run_action and resume_run relay a hand-off as the call\'s successful answer', () => {
  it('run_action: each confirm: true call answers pending_confirmation with its own pending id, never an error', async () => {
    const bridge = makeBridge('service');
    for (let i = 1; i <= 3; i++) {
      const json = await call(bridge, toolsCall(i, 'run_action', { actionName: GATED, recordId: 'a1', [AI_ACTION_CONFIRMATION_MEMBER]: true }));
      expect(json.result.isError).toBeFalsy();
      expect(JSON.parse(json.result.content[0].text)).toEqual(pendingOf(i));
    }
  });

  it('resume_run: the hand-off is relayed the same way', async () => {
    const bridge = makeBridge('service');
    const json = await call(bridge, toolsCall(1, 'resume_run', { runId: 'run_1', values: { reason: 'x' }, [AI_ACTION_CONFIRMATION_MEMBER]: true }));
    expect(json.result.isError).toBeFalsy();
    expect(JSON.parse(json.result.content[0].text)).toEqual(pendingOf(1));
    expect(bridge.calls[0]).toEqual(['resumeRun', 'run_1', { values: { reason: 'x' }, [AI_ACTION_CONFIRMATION_MEMBER]: true }]);
  });

  it('no service: the refusal keeps the registered envelope and carries details.reason', async () => {
    for (const [tool, args] of [
      ['run_action', { actionName: GATED, recordId: 'a1', [AI_ACTION_CONFIRMATION_MEMBER]: true }],
      ['resume_run', { runId: 'run_1', [AI_ACTION_CONFIRMATION_MEMBER]: true }],
    ] as const) {
      const json = await call(makeBridge('none'), toolsCall(1, tool, args));
      expect(json.result.isError, tool).toBe(true);
      const envelope = JSON.parse(json.result.content[0].text);
      expect({ code: envelope.error.code, status: envelope.error.status }, tool).toEqual({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
      expect(envelope.error.details, tool).toEqual({
        actionName: GATED, objectName: 'account', confirmationMember: AI_ACTION_CONFIRMATION_MEMBER, reason: 'no_confirmation_service',
      });
    }
  });

  it('the member stays accepted on both tools, so a call carrying it is not refused for it', async () => {
    const json = await call(makeBridge('service'), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    for (const name of ['run_action', 'resume_run']) {
      const tool = json.result.tools.find((t: any) => t.name === name);
      expect(tool?.inputSchema.properties[AI_ACTION_CONFIRMATION_MEMBER]?.type, name).toBe('boolean');
    }
  });
});
