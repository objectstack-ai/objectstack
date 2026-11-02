// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28856] The MCP `run_action` tool answers an action whose write the engine
 * STORED but whose parent roll-up it could not recompute with the action's
 * own answer — never the refusal, which told an agent the action failed and
 * invited it to run the action again, repeating every side effect.
 *
 * ## The defect, measured on `origin/main` (`3b920f6d`) before this file
 *
 * The runtime bridge's `runAction` threw the engine's `ERR_SUMMARY_RECOMPUTE`
 * refusal and the tool rendered it as an `isError` result. The runtime now
 * composes the action's `run_action` answer and attaches it to the refusal
 * through #28781's carrier (`invokeBusinessAction`, pinned by
 * `packages/runtime/src/action-declarative-update-stale-summary.test.ts`);
 * this file pins the tool's half: it relays that answer.
 *
 * ## What is pinned (over the HTTP `/mcp` transport)
 *
 * - the attached answer is the tool's result, not an error;
 * - a refusal before the write keeps its existing rendering, `details` and all;
 * - a stale refusal with NO answer attached (an action kind whose result the
 *   runtime cannot compose, #28861) still answers its error;
 * - the stale column is logged once, at `error`.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';
import { withEarnedAnswer } from '@objectstack/types';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpActionBridge, McpDataBridge } from './mcp-http-tools.js';

type Bridge = McpDataBridge & McpActionBridge;

const OBJECT = 'stl_case';
const RECORD_ID = 'case_1';
const ACTION = 'close_case';

/** objectql's `SummaryRecomputeError`, as a write's caller reads it: by `code`, carrying `written`. */
function staleRefusal(): Error {
  return Object.assign(new Error('Roll-up summary recompute failed after retries for 1 parent record(s); the triggering records WERE written.'), {
    code: 'ERR_SUMMARY_RECOMPUTE',
    written: { id: RECORD_ID },
    failures: [{ childObject: OBJECT, parentObject: 'stl_account', parentId: 'a1', field: 'open_cases', error: new Error('sum over text') }],
  });
}

/** The runtime's answer for a declarative update action (`invokeBusinessAction`). */
const ANSWER = {
  ok: true,
  action: ACTION,
  objectName: OBJECT,
  recordId: RECORD_ID,
  result: { operation: 'update', object: OBJECT, id: RECORD_ID, record: { id: RECORD_ID, status: 'closed' } },
};

function bridgeThrowing(thrown: () => Error): Bridge {
  return {
    async listObjects() { return [{ name: OBJECT, label: 'Case', fieldCount: 1 }]; },
    async describeObject() { return { name: OBJECT, fields: [{ name: 'status', type: 'text' }] }; },
    async query() { return { object: OBJECT, records: [], total: 0 }; },
    async get(_object, id) { return { id, status: 'open' }; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async listActions() {
      return [{ name: ACTION, objectName: OBJECT, type: 'script', requiresRecord: true, requiresConfirmation: false }];
    },
    async runAction() { throw thrown(); },
    async resumeRun() { return {}; },
  };
}

let nextId = 1;
async function runAction(bridge: Bridge) {
  const body = {
    jsonrpc: '2.0', id: nextId++, method: 'tools/call',
    params: { name: 'run_action', arguments: { actionName: ACTION, objectName: OBJECT, recordId: RECORD_ID } },
  };
  const runtime = new MCPServerRuntime({ name: 'pin', version: '0.0.0' });
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge, parsedBody: body },
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { result?: any; error?: unknown };
  expect(json.error, JSON.stringify(json.error)).toBeUndefined();
  return json.result as { content: Array<{ text: string }>; isError?: boolean };
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeAll(() => { errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { errorLog.mockRestore(); });

describe('[#28856] MCP run_action answers an action whose write landed under a failing roll-up as the action it is', () => {
  it('relays the answer the runtime attached to the refusal', async () => {
    const result = await runAction(bridgeThrowing(() => withEarnedAnswer(staleRefusal() as any, ANSWER)));
    expect(result.isError, result.content[0]?.text).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual(ANSWER);
  });

  it('a refusal before the write keeps its rendering, details included', async () => {
    const result = await runAction(bridgeThrowing(() => Object.assign(
      new Error(`Action '${ACTION}' on '${OBJECT}' declares ai.requiresConfirmation: true — nothing was run.`),
      { code: 'ACTION_CONFIRMATION_REQUIRED', status: 428, details: { actionName: ACTION, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER } },
    )));
    expect(result.isError).toBe(true);
    const { error } = JSON.parse(result.content[0]!.text);
    expect(error).toMatchObject({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428, details: { actionName: ACTION } });
  });

  it('a stale refusal with no answer attached still answers its error', async () => {
    const result = await runAction(bridgeThrowing(staleRefusal));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text).error.code).toBe('ERR_SUMMARY_RECOMPUTE');
  });

  it('the stale column is logged once, at error', () => {
    const lines = errorLog.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('could not be recomputed'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"stl_account.open_cases"');
  });
});
