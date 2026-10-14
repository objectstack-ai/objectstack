// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23529] `run_action` and `resume_run` WITHHOLD a permission refusal's
 * `details`, as the data tools do (#23509) and as the runtime dispatcher does
 * (the ruling on #7450).
 *
 * ## What was open
 *
 * The security gate's `PERMISSION_DENIED` carries the caller's `positions` and
 * `permissionSets` in `details`. Those are server-side diagnostics: the
 * dispatcher drops them from the wire, the REST actions door answers through
 * the closed `details` list of `resolveThrownHttpError`, and the data tools
 * render through `errorResultWithCode`, which never reads `details`. The two
 * action tools rendered through `errorResultFromThrown`, which spread a thrown
 * refusal's `details` verbatim into a tool result. The tool result rides a
 * JSON-RPC 200, so the dispatcher's withholding never saw it.
 *
 * The reachable producer, read from source: a declarative update action
 * (`operation: 'update'`) writes as the caller. A caller who may read the row
 * but not update the object passes the subject load and meets the gate's
 * write-side refusal, and nothing between the gate and this package catches
 * it. A host script handler that rethrows a caller-scope refusal surfaces the
 * same way.
 *
 * ## What is pinned here
 *
 *  - The HTTP `/mcp` face, through `handleHttpRequest` and the real Streamable
 *    HTTP transport, as `mcp-coded-refusal.test.ts` drives it. The bridge is a
 *    double, because this package does not depend on `@objectstack/runtime`:
 *    it lets the caller read the subject row and refuses the declarative
 *    update with the gate's `PermissionDeniedError` shape.
 *  - The refusal answers `code` `PERMISSION_DENIED` and status 403, and the
 *    caller's position and permission-set NAMES appear nowhere in the HTTP
 *    response body: not under `details`, not anywhere else. A key-presence
 *    check would pass a renderer that moved the names to another key.
 *  - `resume_run` renders through the same function. No caller-scope write of
 *    its own reaches it today (it re-reads the subject through the not-found
 *    door), so its row pins the renderer, not a measured producer.
 *  - The control: on the same two tools, `ACTION_CONFIRMATION_REQUIRED` still
 *    serves its `details` (#15942). So the withholding is keyed on the
 *    refusal's code, and the `details` channel is shown to be live.
 */

import { describe, it, expect } from 'vitest';

import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpActionBridge, McpDataBridge } from './mcp-http-tools.js';

type Bridge = McpDataBridge & McpActionBridge;

const OBJECT = 'crm_case';
const RECORD_ID = 'case_1';
/** A declarative update action: `operation: 'update'` writes the patch as the caller. */
const ACTION = 'close_case';
const RUN_ID = 'run_1';

/** Distinctive names, so a hit in the response body can only be a disclosure. */
const POSITIONS = ['pin23529_position_case_reader', 'pin23529_position_everyone'];
const PERMISSION_SETS = ['pin23529_set_case_read_only', 'pin23529_set_member_default'];

const DENIAL_MESSAGE =
  'You do not have permission to perform this action. Contact your administrator if you need access.';

/**
 * The security gate's write-side refusal, in the shape `PermissionDeniedError`
 * gives it: the localized sentence, `code`, both status spellings, the
 * diagnostics in `details`, and the operator's sentence as a SIBLING of
 * `details`.
 */
function writeSideDenial(): Error {
  const err = Object.assign(new Error(DENIAL_MESSAGE), {
    code: 'PERMISSION_DENIED',
    status: 403,
    statusCode: 403,
    details: { operation: 'update', object: OBJECT, positions: POSITIONS, permissionSets: PERMISSION_SETS },
    developerMessage:
      `[Security] Access denied: operation 'update' on object '${OBJECT}' `
      + `is not permitted for positions [${POSITIONS.join(', ')}]`,
  });
  err.name = 'PermissionDeniedError';
  return err;
}

/** The runtime's confirmation refusal (#15942): its `details` are the retry contract. */
function confirmationRefusal(): Error {
  return Object.assign(
    new Error(`Action '${ACTION}' on '${OBJECT}' declares ai.requiresConfirmation: true — nothing was run.`),
    {
      code: 'ACTION_CONFIRMATION_REQUIRED',
      status: 428,
      details: { actionName: ACTION, objectName: OBJECT, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER },
    },
  );
}

/**
 * A caller who may READ the subject row and may not UPDATE the object. The
 * subject read answers the row; the declarative update (and the run it would
 * resume) is refused by the gate with `thrown`.
 */
function readerBridge(thrown: () => Error): Bridge {
  return {
    async listObjects() { return [{ name: OBJECT, label: 'Case', fieldCount: 1 }]; },
    async describeObject() { return { name: OBJECT, fields: [{ name: 'status', type: 'text' }] }; },
    async query() { return { object: OBJECT, records: [], total: 0 }; },
    async get(_object, id) { return { id, status: 'open' }; },
    async create() { return {}; },
    async update() { throw thrown(); },
    async remove() { return {}; },
    async listActions() {
      return [{ name: ACTION, objectName: OBJECT, type: 'script', requiresRecord: true, requiresConfirmation: false }];
    },
    async runAction() { throw thrown(); },
    async resumeRun() { throw thrown(); },
  };
}

let nextId = 1;

/** One `tools/call` over the real HTTP transport; answers the raw body text and the parsed tool result. */
async function callOverHttp(bridge: Bridge, name: string, args: Record<string, unknown>) {
  const body = { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } };
  const runtime = new MCPServerRuntime({ name: 'pin', version: '0.0.0' });
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge, parsedBody: body },
  );
  expect(res.status, `${name}: the HTTP transport itself answered ${res.status}`).toBe(200);
  const raw = await res.text();
  const json = JSON.parse(raw) as { result?: any; error?: unknown };
  expect(json.error, `${name}: JSON-RPC error ${JSON.stringify(json.error)}`).toBeUndefined();
  return { raw, result: json.result };
}

const DOORS = [
  { tool: 'run_action', args: { actionName: ACTION, objectName: OBJECT, recordId: RECORD_ID } },
  { tool: 'resume_run', args: { runId: RUN_ID, values: {} } },
] as const;

describe('run_action / resume_run over HTTP /mcp: a permission refusal withholds its details (#23529)', () => {
  it('control: the caller may read the subject row', async () => {
    const { result } = await callOverHttp(readerBridge(writeSideDenial), 'get_record', {
      objectName: OBJECT,
      recordId: RECORD_ID,
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual({ id: RECORD_ID, status: 'open' });
  });

  for (const door of DOORS) {
    it(`${door.tool}: PERMISSION_DENIED answers code, message and status, and the caller's grants appear nowhere`, async () => {
      const { raw, result } = await callOverHttp(readerBridge(writeSideDenial), door.tool, door.args);

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(JSON.parse(result.content[0].text)).toEqual({
        error: { code: 'PERMISSION_DENIED', message: DENIAL_MESSAGE, status: 403 },
      });
      // Every name, against the whole HTTP response body, not one key.
      for (const name of [...POSITIONS, ...PERMISSION_SETS]) {
        expect(raw, `${door.tool}: '${name}' reached the wire`).not.toContain(name);
      }
    });

    it(`${door.tool}: control — ACTION_CONFIRMATION_REQUIRED still serves its retry details (#15942)`, async () => {
      const { result } = await callOverHttp(readerBridge(confirmationRefusal), door.tool, door.args);

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual({
        error: {
          code: 'ACTION_CONFIRMATION_REQUIRED',
          message: `Action '${ACTION}' on '${OBJECT}' declares ai.requiresConfirmation: true — nothing was run.`,
          status: 428,
          details: { actionName: ACTION, objectName: OBJECT, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER },
        },
      });
    });
  }
});
