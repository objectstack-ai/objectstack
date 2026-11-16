// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15942 / #16293] The `run_action` door carried the confirmation member —
 * and the ADR-0112 refusal that member existed to satisfy.
 *
 * [#34209] RETIRED (maintainer ruling 6909355256). Since the hand-off (#33690)
 * the member confirmed nothing, so it is no longer declared: the closed input
 * refuses a call that carries it, and the tool forwards no member to the
 * bridge. The pins below that asserted the member was advertised, forwarded
 * and satisfied the gate are FLIPPED to assert the opposite; the strip story
 * that follows is why the closed shape, and not a silent drop, is the answer.
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
 * `examples/app-todo/test/mcp-actions.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpActionBridge } from './mcp-http-tools.js';

/** The action the double treats as author-gated. */
const GATED = 'archive_account';

/**
 * A bridge that reproduces the runtime door's OBSERVABLE answer for a gated
 * action on a host with no pending-confirmation service: it refuses the gated
 * action whatever the request carries, throwing the `code` / `status` /
 * `details` envelope the runtime produces (#33690).
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
      if (name === GATED) {
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
              reason: 'no_confirmation_service',
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

  it('[#34209] no longer advertises the member on the tool schema, and the shape is closed', async () => {
    const json = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const runAction = json.result.tools.find((t: any) => t.name === 'run_action');
    const props = runAction.inputSchema.properties;
    // Control: the pre-existing members are still advertised, so the missing
    // `confirm` below is a real absence and not an empty read.
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['actionName', 'objectName', 'recordId', 'params']),
    );
    expect(Object.keys(props)).not.toContain(AI_ACTION_CONFIRMATION_MEMBER);
    expect(runAction.inputSchema.additionalProperties).toBe(false);
  });

  it('relays a gated refusal with its code, status and details, and forwards no member', async () => {
    const json = await call(toolsCall(2, 'run_action', { actionName: GATED, recordId: 'a1' }));
    expect(json.result.isError).toBe(true);
    const envelope = JSON.parse(json.result.content[0].text);
    expect(envelope.error.code).toBe('ACTION_CONFIRMATION_REQUIRED');
    expect(envelope.error.status).toBe(428);
    // The machine-readable half survives the tool unflattened.
    expect(envelope.error.details).toEqual({
      actionName: GATED,
      objectName: 'account',
      confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
      reason: 'no_confirmation_service',
    });
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0][1]).not.toHaveProperty(AI_ACTION_CONFIRMATION_MEMBER);
  });

  it('[#34209] REFUSES a retry carrying `confirm: true` at the input: the bridge never sees it', async () => {
    const json = await call(
      toolsCall(3, 'run_action', { actionName: GATED, recordId: 'a1', [AI_ACTION_CONFIRMATION_MEMBER]: true }),
    );
    // Flipped: before the retirement this call reached the bridge with the
    // member set. Now the closed shape refuses it before dispatch.
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toContain(`\`${AI_ACTION_CONFIRMATION_MEMBER}\``);
    expect(bridge.calls).toHaveLength(0);
  });

  it('forwards exactly `objectName`, `recordId` and `params`, and no member', async () => {
    await call(
      toolsCall(4, 'run_action', {
        actionName: 'other_action',
        objectName: 'account',
        recordId: 'a1',
        params: { reason: 'dupe' },
      }),
    );
    expect(bridge.calls[0][1]).toStrictEqual({
      objectName: 'account',
      recordId: 'a1',
      params: { reason: 'dupe' },
    });
  });

  it('a truthy string is refused at the input too, never passed on', async () => {
    const json = await call(
      toolsCall(5, 'run_action', { actionName: GATED, recordId: 'a1', [AI_ACTION_CONFIRMATION_MEMBER]: 'true' }),
    );
    expect(json.result.isError).toBe(true);
    expect(bridge.calls).toHaveLength(0);
  });

  // [#31271] An uncoded bridge failure answers what `POST /api/v1/actions`
  // answers it (`actionsDoorAnswerOf`): that door's 400 rejection, with the
  // failure's own sentence and no `details`.
  it('answers an UNCODED bridge failure as the /actions door does: 400 VALIDATION_ERROR, its own sentence', async () => {
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
    expect(JSON.parse(json.result.content[0].text)).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'handler exploded', status: 400 },
    });
  });
});
