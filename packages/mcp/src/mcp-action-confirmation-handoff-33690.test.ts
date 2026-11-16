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
 *    (`428 ACTION_CONFIRMATION_REQUIRED`) with `details.reason`;
 *  - [#34209] the `confirm` member is RETIRED from both tools (maintainer
 *    ruling 6909355256): a call carrying it, `true` or `false`, on any action,
 *    gated or not, is refused by the tool's closed input with the same
 *    unknown-key refusal any undeclared key gets, and the bridge is never
 *    called. The pins that accepted it (#33690) are flipped below.
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
  it('run_action: each call answers pending_confirmation with its own pending id, never an error', async () => {
    const bridge = makeBridge('service');
    for (let i = 1; i <= 3; i++) {
      const json = await call(bridge, toolsCall(i, 'run_action', { actionName: GATED, recordId: 'a1' }));
      expect(json.result.isError).toBeFalsy();
      expect(JSON.parse(json.result.content[0].text)).toEqual(pendingOf(i));
    }
    // [#34209] The tool forwards no confirmation member at all.
    for (const [, , input] of bridge.calls) expect(input).not.toHaveProperty(AI_ACTION_CONFIRMATION_MEMBER);
  });

  it('resume_run: the hand-off is relayed the same way', async () => {
    const bridge = makeBridge('service');
    const json = await call(bridge, toolsCall(1, 'resume_run', { runId: 'run_1', values: { reason: 'x' } }));
    expect(json.result.isError).toBeFalsy();
    expect(JSON.parse(json.result.content[0].text)).toEqual(pendingOf(1));
    // Exactly the values: no confirmation member, not even an `undefined` one.
    expect(bridge.calls[0]).toStrictEqual(['resumeRun', 'run_1', { values: { reason: 'x' } }]);
  });

  it('no service: the refusal keeps the registered envelope and carries details.reason', async () => {
    for (const [tool, args] of [
      ['run_action', { actionName: GATED, recordId: 'a1' }],
      ['resume_run', { runId: 'run_1' }],
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
});

/**
 * [#34209] The retired member. Both tools answer a call that carries it with
 * the closed input's unknown-key refusal: the SAME shape an undeclared key such
 * as `bogus` gets (a tool error naming the key, no ADR-0112 code of its own),
 * before the bridge is reached. The ruling: refused outright, on every action,
 * including one that declares no confirmation, whatever value it carries.
 */
describe('[#34209] run_action and resume_run refuse the retired confirm member outright', () => {
  /** The refusal's leading statement: everything before the key list. */
  const statementOf = (text: string) => text.slice(0, text.indexOf('`'));

  const CASES = [
    ['run_action', { actionName: GATED, recordId: 'a1' }],
    // An action that declares no confirmation: refused all the same.
    ['run_action', { actionName: 'touch_account', recordId: 'a1' }],
    ['resume_run', { runId: 'run_1', values: { reason: 'x' } }],
  ] as const;

  it('refuses the member with true and with false, on a gated and an ungated action, and never calls the bridge', async () => {
    for (const [tool, args] of CASES) {
      for (const value of [true, false]) {
        const bridge = makeBridge('service');
        const json = await call(bridge, toolsCall(1, tool, { ...args, [AI_ACTION_CONFIRMATION_MEMBER]: value }));
        const label = `${tool} ${JSON.stringify(args)} confirm=${value}`;
        expect(json.result?.isError, label).toBe(true);
        const text: string = json.result.content.map((c: any) => c.text).join('\n');
        expect(text, label).toContain(`\`${AI_ACTION_CONFIRMATION_MEMBER}\``);
        // The prescription rides the refusal: the person confirms, in the app.
        expect(text, label).toContain('in the app');
        expect(bridge.calls, label).toEqual([]);
      }
    }
  });

  it('is the unknown-key refusal every undeclared key gets: same statement, no code of its own', async () => {
    for (const [tool, args] of CASES) {
      const member = await call(makeBridge('service'), toolsCall(1, tool, { ...args, [AI_ACTION_CONFIRMATION_MEMBER]: true }));
      const unknown = await call(makeBridge('service'), toolsCall(1, tool, { ...args, bogus: true }));
      const memberText: string = member.result.content[0].text;
      const unknownText: string = unknown.result.content[0].text;
      expect(unknown.result.isError, tool).toBe(true);
      expect(statementOf(memberText), tool).toBe(statementOf(unknownText));
      expect(statementOf(memberText).length, `${tool}: the statement read empty`).toBeGreaterThan(10);
      // Not an ADR-0112 envelope: no second code is minted for the member.
      expect(memberText, tool).not.toContain('ACTION_CONFIRMATION_REQUIRED","status"');
      expect(() => JSON.parse(memberText), tool).toThrow();
    }
  });

  it('neither tool advertises the member, and both stay closed against it', async () => {
    const json = await call(makeBridge('service'), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    for (const name of ['run_action', 'resume_run']) {
      const tool = json.result.tools.find((t: any) => t.name === name);
      // Control: the tool is listed with its real members, so the absence below is real.
      expect(Object.keys(tool?.inputSchema.properties ?? {}).length, name).toBeGreaterThan(0);
      expect(tool.inputSchema.properties, name).not.toHaveProperty(AI_ACTION_CONFIRMATION_MEMBER);
      expect(tool.inputSchema.additionalProperties, name).toBe(false);
    }
  });

  it('CONTROL: the delete tools keep the member, so the retirement is these two tools only', async () => {
    const json = await call(makeBridge('service'), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const del = json.result.tools.find((t: any) => t.name === 'delete_record');
    expect(del?.inputSchema.properties?.[AI_ACTION_CONFIRMATION_MEMBER]?.type).toBe('boolean');
  });
});
