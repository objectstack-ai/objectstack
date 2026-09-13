// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15942 / #16293] The `run_action` door carries the confirmation member —
 * and the ADR-0112 refusal that member exists to satisfy.
 *
 * ## Why this file drives the REAL door
 *
 * The gate itself lives in `@objectstack/runtime`
 * (`actionConfirmationRefusal`), and a test that calls `invokeBusinessAction`
 * directly is blind to the thing that decides whether the feature works at
 * all: THE MEMBER NEVER REACHED IT. Measured on this tree before the change,
 * with a client sending `{ actionName, recordId, confirm: true }` through a
 * real JSON-RPC `tools/call`, the bridge received `{ recordId: 'r1' }` —
 * `confirm` was stripped twice over:
 *
 *   1. the SDK wraps the raw `inputSchema` shape via `objectFromShape`, and
 *      under zod a plain object DROPS unknown keys — no error, no reject;
 *   2. the handler then forwarded only `{ objectName, recordId, params }`.
 *
 * `recordId` surviving the same round trip is the lit control on that reading:
 * the transport works, and only the undeclared member was lost. So enforcing
 * the gate WITHOUT this door change would have made every action declaring
 * `ai.requiresConfirmation: true` permanently un-invokable over MCP — refused,
 * retried with the member, stripped, refused again — which is strictly worse
 * than the silent no-gate it replaced. That is what this file pins.
 *
 * It drives `MCPServerRuntime.handleHttpRequest` over JSON-RPC — the same code
 * path an external MCP client hits, both strip layers included — rather than
 * calling `registerActionTools`' handler directly, which would see neither.
 *
 * The bridge here is a double: it stands in for the runtime gate so this
 * package can assert the DOOR's half (schema, forward, envelope) without
 * depending on `@objectstack/runtime`, which deliberately does not depend back.
 * The gate's own predicate is pinned in
 * `packages/runtime/src/action-confirmation-gate.test.ts`, and the two halves
 * are driven together, against a real engine, in
 * `examples/app-todo/test/mcp-actions.e2e.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpActionBridge } from './mcp-http-tools.js';

/** The action the double treats as author-gated. */
const GATED = 'archive_account';

/**
 * A bridge that reproduces the runtime gate's OBSERVABLE contract: it refuses
 * the gated action unless the request carries the member as boolean `true`,
 * throwing the same `code` / `status` / `details` envelope
 * `actionConfirmationRefusal` produces.
 */
function makeBridge(): McpDataBridge & McpActionBridge & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    async listObjects() {
      return [];
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
    async listActions() {
      return [
        { name: GATED, objectName: 'account', type: 'script', requiresRecord: true, requiresConfirmation: true },
      ];
    },
    async runAction(name: string, input: any) {
      calls.push([name, input]);
      if (name === GATED && input?.[AI_ACTION_CONFIRMATION_MEMBER] !== true) {
        throw Object.assign(
          new Error(
            `Action '${GATED}' on 'account' declares ai.requiresConfirmation: true — nothing was run.`,
          ),
          {
            code: 'ACTION_CONFIRMATION_REQUIRED',
            status: 428,
            details: {
              actionName: GATED,
              objectName: 'account',
              confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
            },
          },
        );
      }
      return { ok: true, action: name, objectName: 'account', result: { archived: true } };
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

describe('run_action carries the confirmation member through the real MCP door (#15942)', () => {
  let runtime: MCPServerRuntime;
  let bridge: ReturnType<typeof makeBridge>;

  const call = async (body: unknown) => {
    const res = await runtime.handleHttpRequest(mcpRequest(body), { bridge, parsedBody: body });
    return (await res.json()) as any;
  };

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    bridge = makeBridge();
  });

  it('advertises the member on the tool schema, so a model can DISCOVER the retry', async () => {
    const json = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const runAction = json.result.tools.find((t: any) => t.name === 'run_action');
    const props = runAction.inputSchema.properties;
    // Control: the pre-existing members are still advertised, so a missing
    // `confirm` below would be a real absence and not an empty read.
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['actionName', 'objectName', 'recordId', 'params']),
    );
    expect(Object.keys(props)).toContain(AI_ACTION_CONFIRMATION_MEMBER);
    expect(props[AI_ACTION_CONFIRMATION_MEMBER].type).toBe('boolean');
  });

  it('REFUSES a gated action with no member — code, status and the retry details', async () => {
    const json = await call(toolsCall(2, 'run_action', { actionName: GATED, recordId: 'a1' }));
    expect(json.result.isError).toBe(true);
    const envelope = JSON.parse(json.result.content[0].text);
    expect(envelope.error.code).toBe('ACTION_CONFIRMATION_REQUIRED');
    expect(envelope.error.status).toBe(428);
    // The machine-readable half: a refused agent rebuilds the retry from this
    // WITHOUT re-parsing the message prose.
    expect(envelope.error.details).toEqual({
      actionName: GATED,
      objectName: 'account',
      confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
    });
    // …and the door really did forward a request with no confirmation.
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0][1][AI_ACTION_CONFIRMATION_MEMBER]).toBeUndefined();
  });

  it('SUCCEEDS on the retry — the member survives both strip layers', async () => {
    const json = await call(
      toolsCall(3, 'run_action', { actionName: GATED, recordId: 'a1', [AI_ACTION_CONFIRMATION_MEMBER]: true }),
    );
    // The assertion the whole card turns on: before this change the member was
    // dropped here and this call was refused exactly like the one above.
    expect(bridge.calls[0][1][AI_ACTION_CONFIRMATION_MEMBER]).toBe(true);
    expect(json.result.isError).toBeFalsy();
    expect(JSON.parse(json.result.content[0].text)).toMatchObject({ ok: true, result: { archived: true } });
  });

  it('forwards `recordId` and `params` unchanged beside the member', async () => {
    await call(
      toolsCall(4, 'run_action', {
        actionName: GATED,
        objectName: 'account',
        recordId: 'a1',
        params: { reason: 'dupe' },
        [AI_ACTION_CONFIRMATION_MEMBER]: true,
      }),
    );
    expect(bridge.calls[0][1]).toEqual({
      objectName: 'account',
      recordId: 'a1',
      params: { reason: 'dupe' },
      [AI_ACTION_CONFIRMATION_MEMBER]: true,
    });
  });

  it('is a CLOSED boolean — a truthy string is refused by the door, not passed on', async () => {
    const json = await call(
      toolsCall(5, 'run_action', { actionName: GATED, recordId: 'a1', [AI_ACTION_CONFIRMATION_MEMBER]: 'true' }),
    );
    expect(json.result.isError).toBe(true);
    // A transport artefact must never read as an attestation, and the wrong
    // failure here would be it reaching the bridge as a truthy value.
    expect(bridge.calls).toHaveLength(0);
  });

  it('leaves an UNCODED bridge failure as a plain message (the envelope widens, it narrows nothing)', async () => {
    const failing = {
      ...bridge,
      async runAction() {
        throw new Error('handler exploded');
      },
    };
    const body = toolsCall(6, 'run_action', { actionName: 'other', recordId: 'x' });
    const res = await runtime.handleHttpRequest(mcpRequest(body), { bridge: failing, parsedBody: body });
    const json: any = await res.json();
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toBe('handler exploded');
  });
});
