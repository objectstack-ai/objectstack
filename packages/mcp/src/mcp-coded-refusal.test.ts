// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23509] A thrown CODED refusal reaches an MCP client with its code, from
 * every catch that renders one. A throw with no code renders exactly as before.
 *
 * ## What was open
 *
 * The data tools' catches and `list_actions`' returned
 * `errorResult(messageOf(err))`, and the record resource wrote
 * `{ error: message }`. So a refusal whose producer threw the ADR-0112 envelope
 * reached the client as its sentence alone. That covers a held owner's key
 * (`MFA_REQUIRED`, ruling C′ item 1: refused "with the same code" at every
 * seam), `RECORD_NOT_FOUND`, and the exposure and permission refusals.
 * `errorResultFromThrown` already rendered the code for `run_action` and
 * `resume_run` (#15942); the other catches never used it.
 *
 * ## What is pinned here
 *
 *  - The HTTP `/mcp` face, through `handleHttpRequest` and the real Streamable
 *    HTTP transport. Every tool's catch, each driven by its own bridge member,
 *    renders the real `recordNotFoundError` (the value `protocol.getData`
 *    throws when `get_record` misses on this face) as
 *    `{ error: { code, message, status } }` with `isError`. The table is held
 *    equal to the registered tool list, so a tool added later needs a row.
 *  - The same catches render a code-less throw as its bare message,
 *    byte-identical to `errorResult(messageOf(err))`. Nothing is invented for it.
 *  - [#23528] The HTTP bridge's exposure gate (`@objectstack/runtime`'s
 *    `refuseUnexposedDataAction`, which `callData` asks first) used to be such
 *    a throw, `{ statusCode, message }` with no `code`. It now throws the data
 *    door's coded refusal, and renders as one. The producer side is pinned in
 *    runtime's `action-execution-addressed-exposure-refusal.test.ts`.
 *  - The data tools and `list_actions` WITHHOLD `details`. Measured on `/mcp`,
 *    a `PERMISSION_DENIED` carries the caller's `positions` and
 *    `permissionSets` there, which the runtime dispatcher drops from the wire.
 *    `errorResultWithCode` says why.
 *  - The record resource adds `code` / `status` beside the unchanged `error`
 *    sentence and withholds `details` the same way. A code-less throw answers
 *    `{ error }` byte-identically.
 *
 * The stdio face's pins live beside the fixtures that already drive it over a
 * real `StdioServerTransport`. `MFA_REQUIRED` is pinned in
 * `stdio-api-key-account-posture.pin.test.ts`. The exposure refusals, on both
 * the tool and the resource, are pinned in
 * `plugin.record-resource-exposure.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { recordNotFoundError } from '@objectstack/core';
import { actionsDoorAnswerOf, mapDataError } from '@objectstack/types';
import type { IMetadataService } from '@objectstack/spec/contracts';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpActionBridge, McpDataBridge } from './mcp-http-tools.js';

type Bridge = McpDataBridge & McpActionBridge & Required<Pick<McpDataBridge, 'aggregate'>>;

/** Every member answers benignly, so a refusal comes only from the member a row names. */
function benignBridge(): Bridge {
  return {
    async listObjects() { return [{ name: 'task', label: 'Task', fieldCount: 1 }]; },
    async describeObject() { return { name: 'task', fields: [{ name: 'title', type: 'text' }] }; },
    async query(object) { return { object, records: [], total: 0 }; },
    async get(_object, id) { return { id }; },
    async create(object, data) { return { object, id: 'n1', record: data }; },
    async update(object, id, data) { return { object, id, record: data }; },
    async remove(object, id) { return { object, id, success: true }; },
    async aggregate() { return []; },
    async listActions() { return []; },
    async runAction(name) { return { ok: true, action: name }; },
    async resumeRun(runId) { return { ok: true, runId }; },
  };
}

interface Site {
  tool: string;
  args: Record<string, unknown>;
  /** The bridge member whose throw this tool's catch renders. */
  member: keyof Bridge;
  /**
   * `run_action` / `resume_run` render through `errorResultFromThrown`, which
   * carries `details`. That is #15942's contract, and it is not this card's to
   * change. The `details` pin below covers every other row.
   */
  actionDoor?: true;
  /**
   * [#31218] A record data tool: a code-less throw renders the `/data` door's
   * answer (`dataDoorErrorResult`), not its bare message.
   */
  dataDoor?: true;
  /**
   * [#31272] A metadata tool or `list_actions`: a throw the `/meta` door
   * answers as a server fault renders that door's answer
   * (`metaDoorErrorResult`), not its raw text.
   */
  metaDoor?: true;
}

/** Every tool `wireBridgeTools` registers for {@link benignBridge}, each with the member it calls first. */
const SITES: readonly Site[] = [
  { tool: 'list_objects', args: {}, member: 'listObjects', metaDoor: true },
  { tool: 'describe_object', args: { objectName: 'task' }, member: 'describeObject', metaDoor: true },
  {
    tool: 'validate_expression',
    args: { objectName: 'task', expression: 'record.title' },
    member: 'describeObject',
    metaDoor: true,
  },
  { tool: 'query_records', args: { objectName: 'task' }, member: 'query', dataDoor: true },
  {
    tool: 'aggregate_records',
    args: { objectName: 'task', aggregations: [{ function: 'count', alias: 'n' }] },
    member: 'aggregate',
    dataDoor: true,
  },
  { tool: 'get_record', args: { objectName: 'task', recordId: 't9' }, member: 'get', dataDoor: true },
  { tool: 'create_record', args: { objectName: 'task', data: { title: 'x' } }, member: 'create', dataDoor: true },
  {
    tool: 'update_record',
    args: { objectName: 'task', recordId: 't9', data: { title: 'x' } },
    member: 'update',
    dataDoor: true,
  },
  // `confirm: true` passes the confirmation gate, so the call reaches `remove`.
  { tool: 'delete_record', args: { objectName: 'task', recordId: 't9', confirm: true }, member: 'remove', dataDoor: true },
  // [#30891] The selection read is the member a bulk delete calls first; a
  // refusal there refuses the whole call, rendered as the data tools render it.
  { tool: 'delete_records', args: { objectName: 'task', where: {}, confirm: true }, member: 'query' },
  { tool: 'list_actions', args: {}, member: 'listActions', metaDoor: true },
  { tool: 'run_action', args: { actionName: 'complete' }, member: 'runAction', actionDoor: true },
  { tool: 'resume_run', args: { runId: 'r1' }, member: 'resumeRun', actionDoor: true },
];

/**
 * The security gate's denial as it reached `/mcp` when measured on the
 * showcase stack: the caller's authorization topology rides in `details`. The
 * runtime dispatcher drops these `details` from the wire.
 */
function securityGateDenial(): Error {
  return Object.assign(
    new Error('You do not have permission to perform this action. Contact your administrator if you need access.'),
    {
      code: 'PERMISSION_DENIED',
      status: 403,
      details: {
        operation: 'delete',
        object: 'showcase_private_note',
        positions: ['org_member', 'everyone'],
        permissionSets: ['showcase_member_default', 'member_default'],
      },
    },
  );
}

function bridgeThrowing(member: keyof Bridge, thrown: unknown): Bridge {
  const bridge = benignBridge();
  (bridge as unknown as Record<string, unknown>)[member] = async () => {
    throw thrown;
  };
  return bridge;
}

let nextId = 1;
async function rpcOverHttp(bridge: Bridge, method: string, params?: Record<string, unknown>) {
  const body = { jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) };
  const runtime = new MCPServerRuntime({ name: 'pin', version: '0.0.0' });
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge, parsedBody: body },
  );
  expect(res.status, `${method}: the HTTP transport itself answered ${res.status}`).toBe(200);
  const json = (await res.json()) as { result?: any; error?: unknown };
  expect(json.error, `${method}: JSON-RPC error ${JSON.stringify(json.error)}`).toBeUndefined();
  return json.result;
}

async function callTool(site: Site, thrown: unknown) {
  return rpcOverHttp(bridgeThrowing(site.member, thrown), 'tools/call', { name: site.tool, arguments: site.args });
}

describe('MCP tools over HTTP /mcp: a coded refusal carries its code (#23509)', () => {
  it('the table names every registered tool, so a tool added later needs a row here', async () => {
    const listed = await rpcOverHttp(benignBridge(), 'tools/list');
    const names = (listed.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(SITES.map((s) => s.tool).sort());
  });

  for (const site of SITES) {
    it(`${site.tool}: RECORD_NOT_FOUND from ${String(site.member)} answers code, message and status`, async () => {
      const result = await callTool(site, recordNotFoundError('task', 't9'));
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(JSON.parse(result.content[0].text)).toEqual({
        error: { code: 'RECORD_NOT_FOUND', message: 'Record t9 not found in task', status: 404 },
      });
    });

    if (site.dataDoor || site.metaDoor) {
      // [#31218] The record data tools answer the `/data` door's classification
      // of a code-less throw, and [#31272] the metadata tools and `list_actions`
      // the `/meta` door's answer to a fault; both doors answer this one
      // `500 INTERNAL_ERROR` and withhold its message. The cases live in the
      // #31218 and #31272 blocks below.
      it(`${site.tool}: a code-less throw from ${String(site.member)} answers the door's 500, its message withheld`, async () => {
        const result = await callTool(site, new Error('engine exploded'));
        expect(result.isError).toBe(true);
        expect(JSON.parse(result.content[0].text)).toEqual({
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 },
        });
      });
    } else if (site.actionDoor) {
      // [#31271] `run_action` / `resume_run` answer a code-less throw as the
      // `/api/v1/actions` door does (`actionsDoorAnswerOf`): a plain `Error`
      // is that door's rejection, `400 VALIDATION_ERROR` with its own
      // sentence. The cases live in the #31271 block below.
      it(`${site.tool}: a code-less throw from ${String(site.member)} answers the /actions door's 400 rejection`, async () => {
        const result = await callTool(site, new Error('engine exploded'));
        expect(result.isError).toBe(true);
        expect(JSON.parse(result.content[0].text)).toEqual({
          error: { code: 'VALIDATION_ERROR', message: 'engine exploded', status: 400 },
        });
      });
    } else {
      it(`${site.tool}: a code-less throw from ${String(site.member)} answers its bare message, as before`, async () => {
        const result = await callTool(site, new Error('engine exploded'));
        expect(result).toEqual({ content: [{ type: 'text', text: 'engine exploded' }], isError: true });
      });
    }

    if (!site.actionDoor) {
      it(`${site.tool}: a PERMISSION_DENIED answers code, message and status, and WITHHOLDS its details`, async () => {
        const result = await callTool(site, securityGateDenial());
        expect(result.isError).toBe(true);
        expect(JSON.parse(result.content[0].text)).toEqual({
          error: {
            code: 'PERMISSION_DENIED',
            message: 'You do not have permission to perform this action. Contact your administrator if you need access.',
            status: 403,
          },
        });
        expect(result.content[0].text).not.toContain('permissionSets');
      });
    }
  }

  // One site is enough below: every catch renders through the one reader.
  const query = SITES.find((s) => s.tool === 'query_records')!;
  // [#31218] …for the code-less throws, one site that is not a record data
  // tool: those classify a code-less throw as the `/data` door does. [#31272]
  // Nor a metadata tool or `list_actions`, which answer a fault as `/meta`
  // does: `delete_records`' outer catch renders through the one reader alone.
  const deleteRecords = SITES.find((s) => s.tool === 'delete_records')!;

  // [#23528] Moved to the coded rendering. This row pinned the gate's old
  // `{ statusCode: 404, message }` as its bare message. The gate now throws
  // an `Error` carrying the data door's `code` and `status`, the addressed
  // object as `object`, and `allowed` on a 405; the thrown values below are
  // that shape, with the gate's own messages.
  it('the HTTP bridge exposure gate\'s 404 answers OBJECT_API_DISABLED with its status', async () => {
    const thrown = Object.assign(new Error('object is not exposed via the API'), {
      code: 'OBJECT_API_DISABLED',
      status: 404,
      object: 'task',
    });
    const result = await callTool(query, thrown);
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: { code: 'OBJECT_API_DISABLED', message: 'object is not exposed via the API', status: 404 },
    });
  });

  it('the HTTP bridge exposure gate\'s 405 answers OBJECT_API_METHOD_NOT_ALLOWED with its status', async () => {
    const thrown = Object.assign(new Error("API operation 'list' is not allowed for this object"), {
      code: 'OBJECT_API_METHOD_NOT_ALLOWED',
      status: 405,
      object: 'task',
      allowed: ['get'],
    });
    const result = await callTool(query, thrown);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: { code: 'OBJECT_API_METHOD_NOT_ALLOWED', message: "API operation 'list' is not allowed for this object", status: 405 },
    });
  });

  it('an empty or non-string `code`, or a thrown string, is not a code', async () => {
    for (const thrown of [
      Object.assign(new Error('empty code'), { code: '', status: 403 }),
      Object.assign(new Error('numeric code'), { code: 403, status: 403 }),
      'a thrown string',
    ]) {
      const text = thrown instanceof Error ? thrown.message : String(thrown);
      expect(await callTool(deleteRecords, thrown), text).toEqual({ content: [{ type: 'text', text }], isError: true });
    }
  });

  it('omits a `status` that is not a number', async () => {
    const statusless = Object.assign(new Error('no status here'), { code: 'PERMISSION_DENIED', status: '403' });
    expect(JSON.parse((await callTool(query, statusless)).content[0].text)).toEqual({
      error: { code: 'PERMISSION_DENIED', message: 'no status here' },
    });
  });
});

/**
 * [#31218] The record data tools classify a CODE-LESS throw as the
 * `/api/v1/data` door does: through that door's own `mapDataError`
 * (`@objectstack/types`), so the two doors give one answer for one throw.
 *
 * Each case asserts the literal wire answer AND that it equals the door's
 * (`mapDataError` on the same throw), so the pin cannot pass by both sides
 * agreeing on something nobody wrote down, nor by the door moving alone.
 */
describe('the record data tools: a code-less throw answers what the /data door answers (#31218)', () => {
  const DATA_SITES = SITES.filter((s) => s.dataDoor);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The shape `runtime/src/sandbox/quickjs-runner.ts` throws for a hook body's own `throw`, as measured on the card. */
  function sandboxAbort(inner: string, extra: Record<string, unknown> = {}): Error {
    const err = new Error(`hook 'demoleave_leave_request_guard' threw: Error: ${inner}`);
    err.name = 'SandboxError';
    return Object.assign(err, { innerMessage: inner }, extra);
  }

  /** The tool's answer, parsed, after asserting it is a tool error. */
  async function errorOf(site: Site, thrown: unknown): Promise<{ text: string; error: Record<string, unknown> }> {
    const result = await callTool(site, thrown);
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = String(result.content[0].text);
    return { text, error: JSON.parse(text).error };
  }

  /** The `/data` door's answer to the same throw, in the tool's envelope spelling. */
  function doorAnswer(thrown: unknown): Record<string, unknown> {
    const door = mapDataError(thrown, 'task');
    return {
      ...(typeof door.body.code === 'string' ? { code: door.body.code } : {}),
      message: door.body.error,
      status: door.status,
    };
  }

  it('the six record data tools are the rows this block drives', () => {
    expect(DATA_SITES.map((s) => s.tool).sort()).toEqual(
      ['aggregate_records', 'create_record', 'delete_record', 'get_record', 'query_records', 'update_record'],
    );
  });

  for (const site of DATA_SITES) {
    it(`${site.tool}: an undeclared sandboxed hook abort answers HOOK_ABORTED with the inner sentence, no wrapper, no hook name`, async () => {
      const thrown = sandboxAbort('Not enough annual leave remaining');
      const { text, error } = await errorOf(site, thrown);
      expect(error).toEqual({ code: 'HOOK_ABORTED', message: 'Not enough annual leave remaining', status: 400 });
      expect(error).toEqual(doorAnswer(thrown));
      expect(text).not.toContain('demoleave_leave_request_guard');
      expect(text).not.toContain('threw');
    });
  }

  const update = DATA_SITES.find((s) => s.tool === 'update_record')!;

  it('an abort whose SandboxError instance was lost (the wrapper text alone) answers HOOK_ABORTED too, as the door does', async () => {
    const thrown = new Error("hook 'demoleave_leave_request_guard' threw: Error: Not enough annual leave remaining");
    const { text, error } = await errorOf(update, thrown);
    expect(error).toEqual({ code: 'HOOK_ABORTED', message: 'Not enough annual leave remaining', status: 400 });
    expect(error).toEqual(doorAnswer(thrown));
    expect(text).not.toContain('demoleave_leave_request_guard');
  });

  it('an abort that declared a 4xx status and no code keeps that status, with HOOK_ABORTED', async () => {
    const thrown = sandboxAbort('Closed.', { status: 422 });
    const { error } = await errorOf(update, thrown);
    expect(error).toEqual({ code: 'HOOK_ABORTED', message: 'Closed.', status: 422 });
    expect(error).toEqual(doorAnswer(thrown));
  });

  it('a 4xx refusal is not logged as a server fault', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await errorOf(update, sandboxAbort('Not enough annual leave remaining'));
    expect(log).not.toHaveBeenCalled();
  });

  it("a code hook's bare throw answers 500 INTERNAL_ERROR, its message withheld from the agent and logged once for the operator", async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = new Error('Not enough annual leave remaining (code hook)');
    const { text, error } = await errorOf(update, thrown);
    expect(error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 });
    expect(error).toEqual(doorAnswer(thrown));
    expect(text).not.toContain('code hook');
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line).toMatch(/^\[5xx\] 500 tools\/call update_record task — /);
    expect(line).toContain('Not enough annual leave remaining (code hook)');
  });

  it('a sandboxed body that CRASHED is a fault, not an abort: 500 INTERNAL_ERROR, no wrapper', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = sandboxAbort('TypeError: not a function');
    const { text, error } = await errorOf(update, thrown);
    expect(error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 });
    expect(error).toEqual(doorAnswer(thrown));
    expect(text).not.toContain('demoleave_leave_request_guard');
  });

  it("the runtime's `{ statusCode: 503, message }` (no data service) answers 503 with no code and its prose withheld", async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = { statusCode: 503, message: 'Data service not available' };
    const { text, error } = await errorOf(update, thrown);
    expect(error).toEqual({ message: 'Internal server error', status: 503 });
    expect(error).toEqual(doorAnswer(thrown));
    expect(text).not.toContain('Data service not available');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('a throw that declared a 4xx and no code answers that status and its own sentence, with no code invented', async () => {
    const thrown = { statusCode: 400, message: 'aggregate requires at least one aggregation' };
    const { error } = await errorOf(update, thrown);
    expect(error).toEqual({ message: 'aggregate requires at least one aggregation', status: 400 });
    expect(error).toEqual(doorAnswer(thrown));
  });

  it('CONTROL: a coded refusal renders exactly as the coded reader renders it, whatever the door would say', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const site of DATA_SITES) {
      const thrown = Object.assign(new Error('Record is locked'), { code: 'RECORD_LOCKED', status: 409 });
      const { error } = await errorOf(site, thrown);
      expect(error, site.tool).toEqual({ code: 'RECORD_LOCKED', message: 'Record is locked', status: 409 });
    }
    expect(log).not.toHaveBeenCalled();
  });

  it('CONTROL: the tools that are neither record data tools nor action tools still answer a code-less throw with its bare message', async () => {
    for (const site of SITES.filter((s) => !s.dataDoor && !s.actionDoor)) {
      const result = await callTool(site, sandboxAbort('Not enough annual leave remaining'));
      expect(result, site.tool).toEqual({
        content: [{ type: 'text', text: "hook 'demoleave_leave_request_guard' threw: Error: Not enough annual leave remaining" }],
        isError: true,
      });
    }
  });
});

/**
 * [#31246] A CODED sandboxed refusal. A QuickJS hook (or action) body that runs
 * `throw Object.assign(new Error(SENTENCE), { code: 'RECORD_LOCKED', status: 409 })`
 * leaves the runner as this `SandboxError` (measured on the real
 * `QuickJSScriptRunner`): `.message` is the `hook '<name>' threw: Error: …`
 * debug wrapper, `.innerMessage` the sentence the author addressed to the
 * caller, `code` and `status` as declared.
 */
const SANDBOX_SENTENCE = 'A finished invoice cannot be changed.';
const SANDBOX_WRAPPER = `hook 'demo_invoice_guard' threw: Error: ${SANDBOX_SENTENCE}`;
function codedSandboxRefusal(): Error {
  return Object.assign(new Error(SANDBOX_WRAPPER), {
    name: 'SandboxError',
    innerMessage: SANDBOX_SENTENCE,
    code: 'RECORD_LOCKED',
    status: 409,
  });
}

/**
 * [#31246] Every tool renders a coded sandboxed refusal as the body's own
 * sentence beside its code and status. `thrownRefusalEnvelope` read `.message`,
 * so each answered the wrapper, the hook's internal name included, where
 * `/api/v1/data` answers the inner sentence. It now reads the sentence through
 * `sandboxBusinessMessage` (`@objectstack/types`), the read that door makes.
 */
describe('every tool: a coded sandboxed refusal answers the body\'s sentence, never the wrapper naming the hook (#31246)', () => {
  for (const site of SITES) {
    it(`${site.tool}: RECORD_LOCKED, the inner sentence and 409; the hook name is absent`, async () => {
      const thrown = codedSandboxRefusal();
      const result = await callTool(site, thrown);
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(JSON.parse(result.content[0].text)).toEqual({
        error: { code: 'RECORD_LOCKED', message: SANDBOX_SENTENCE, status: 409 },
      });
      // The answer the data door gives the same throw.
      const door = mapDataError(thrown, 'task');
      expect([door.body.code, door.body.error, door.status]).toEqual(['RECORD_LOCKED', SANDBOX_SENTENCE, 409]);
      expect(result.content[0].text).not.toContain('demo_invoice_guard');
      expect(result.content[0].text).not.toContain('threw');
    });
  }

  // CONTROL: a READ of the field the sandbox populated, never a strip of the
  // wrapper's prose. A coded refusal that is not a sandbox's renders byte for
  // byte as before, even when its own sentence reads like the wrapper.
  it('CONTROL: a coded non-sandbox refusal renders its own message byte for byte, wrapper-like prose included', async () => {
    const query = SITES.find((s) => s.tool === 'query_records')!;
    for (const thrown of [
      Object.assign(new Error('The period is closed.'), { code: 'RECORD_LOCKED', status: 409 }),
      Object.assign(new Error(SANDBOX_WRAPPER), { code: 'RECORD_LOCKED', status: 409 }),
      Object.assign(new Error(SANDBOX_WRAPPER), { name: 'SandboxError', innerMessage: '', code: 'RECORD_LOCKED', status: 409 }),
    ]) {
      expect(await callTool(query, thrown), thrown.message).toEqual({
        content: [{
          type: 'text',
          text: JSON.stringify({ error: { code: 'RECORD_LOCKED', message: thrown.message, status: 409 } }, null, 2),
        }],
        isError: true,
      });
    }
  });
});

describe('the record resource: a coded refusal adds its code beside the unchanged sentence (#23509)', () => {
  const URI = 'objectstack://objects/task/records/t1';

  /** Read the record resource of a server whose reader throws `thrown`; answers the raw body text. */
  async function readRefused(thrown: unknown, uri: string = URI): Promise<string> {
    const runtime = new MCPServerRuntime({ name: 'pin', version: '0.0.0' });
    const metadata = {
      listObjects: vi.fn(async () => []),
      getObject: vi.fn(async () => null),
    } as unknown as IMetadataService;
    runtime.bridgeResources(metadata, async () => {
      throw thrown;
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await runtime.server.connect(serverSide);
    const client = new Client({ name: 'pin', version: '0.0.0' });
    await client.connect(clientSide);
    try {
      const read = await client.readResource({ uri });
      expect(read.contents).toHaveLength(1);
      expect(read.contents[0]!.uri).toBe(uri);
      return String((read.contents[0] as { text?: unknown }).text);
    } finally {
      await client.close();
    }
  }

  it('MFA_REQUIRED / 403: `code` and `status` beside `error`, which stays the sentence', async () => {
    const message = 'Multi-factor authentication is required. Please set up an authenticator app to continue.';
    const body = JSON.parse(await readRefused(Object.assign(new Error(message), { code: 'MFA_REQUIRED', status: 403 })));
    expect(body).toEqual({ error: message, code: 'MFA_REQUIRED', status: 403 });
    // The discriminator a resource client already uses to tell a refusal from a row.
    expect(typeof body.error).toBe('string');
  });

  it('a PERMISSION_DENIED answers code and status and WITHHOLDS its details', async () => {
    const denial = securityGateDenial();
    expect(JSON.parse(await readRefused(denial))).toEqual({
      error: denial.message,
      code: 'PERMISSION_DENIED',
      status: 403,
    });
  });

  it('carries no `status` when the refusal has none', async () => {
    const thrown = Object.assign(new Error('Field read denied: salary'), { code: 'PERMISSION_DENIED' });
    expect(JSON.parse(await readRefused(thrown))).toEqual({
      error: 'Field read denied: salary',
      code: 'PERMISSION_DENIED',
    });
  });

  it('[#31246] a coded sandboxed refusal: `error` is the inner sentence, beside its code and status', async () => {
    const text = await readRefused(codedSandboxRefusal());
    expect(JSON.parse(text)).toEqual({ error: SANDBOX_SENTENCE, code: 'RECORD_LOCKED', status: 409 });
    expect(text).not.toContain('demo_invoice_guard');
  });

  it('[#31246] CONTROL: a coded non-sandbox refusal keeps its own sentence, wrapper-like prose included', async () => {
    expect(await readRefused(Object.assign(new Error(SANDBOX_WRAPPER), { code: 'RECORD_LOCKED', status: 409 }))).toBe(
      JSON.stringify({ error: SANDBOX_WRAPPER, code: 'RECORD_LOCKED', status: 409 }),
    );
  });

  it('[#31269] a coded sandboxed CRASH answers what the same crash with no code answers; its code and status are not served', async () => {
    const crash = (extra: Record<string, unknown> = {}) => Object.assign(
      new Error("hook 'demo_crash_guard' threw: TypeError: boom"),
      { name: 'SandboxError', innerMessage: 'TypeError: boom' },
      extra,
    );
    const coded = await readRefused(crash({ code: 'RECORD_LOCKED', status: 409 }));
    expect(coded).toBe(await readRefused(crash()));
    expect(coded).not.toContain('RECORD_LOCKED');
  });

  /**
   * [#31270] A code-less throw answers what the record data tools answer since
   * #31218: the `/api/v1/data` door's answer (`mapDataError`, the GET by-id
   * door), in this resource's `{ error, code, status }` members. It used to
   * answer `{ error }` with the thrown message, so a sandboxed hook's abort
   * reached the client as the runner's wrapper naming the hook and a fault's
   * own text reached it verbatim.
   */
  describe('a code-less throw answers the /data door\'s answer (#31270)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** The `SandboxError` the QuickJS runner raises for a hook body's throw (measured on the real runner). */
    const sandboxed = (inner: string, extra: Record<string, unknown> = {}) => Object.assign(
      new Error(`hook 'demo_resource_guard' threw: ${inner}`),
      { name: 'SandboxError', innerMessage: inner.replace(/^Error: /, '') },
      extra,
    );

    /** The door's answer to `thrown`, in this resource's member order. */
    function doorBody(thrown: unknown): Record<string, unknown> {
      const door = mapDataError(thrown, 'task');
      return {
        error: door.body.error,
        ...(typeof door.body.code === 'string' ? { code: door.body.code } : {}),
        status: door.status,
      };
    }

    it('an undeclared sandboxed hook abort: HOOK_ABORTED, the inner sentence, 400; no hook name', async () => {
      const thrown = sandboxed('Error: Not enough leave');
      const text = await readRefused(thrown);
      expect(JSON.parse(text)).toEqual({ error: 'Not enough leave', code: 'HOOK_ABORTED', status: 400 });
      expect(JSON.parse(text)).toEqual(doorBody(thrown));
      expect(text).not.toContain('demo_resource_guard');
      expect(text).not.toContain('threw');
    });

    it('a bare Error: the sanitised 500, its message withheld and logged once for the operator', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const thrown = new Error('socket hang up');
      const text = await readRefused(thrown);
      expect(text).toBe(JSON.stringify({ error: 'Internal server error', code: 'INTERNAL_ERROR', status: 500 }));
      expect(JSON.parse(text)).toEqual(doorBody(thrown));
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]![0]);
      expect(line).toMatch(/^\[5xx\] 500 resources\/read objectstack:\/\/objects\/task\/records\/t1 — /);
      expect(line).toContain('socket hang up');
    });

    it('a sandboxed body that CRASHED, with or without a declared code: the sanitised 500, no hook name, no native text', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      for (const thrown of [sandboxed('TypeError: boom'), sandboxed('TypeError: boom', { code: 'RECORD_LOCKED', status: 409 })]) {
        const text = await readRefused(thrown);
        expect(text, thrown.message).toBe(JSON.stringify({ error: 'Internal server error', code: 'INTERNAL_ERROR', status: 500 }));
        expect(text).not.toContain('demo_resource_guard');
        expect(text).not.toContain('TypeError');
      }
    });

    it('a thrown string and an empty `code` are no code: the door\'s answer', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      for (const thrown of ['a thrown string', Object.assign(new Error('empty code'), { code: '' })]) {
        expect(JSON.parse(await readRefused(thrown)), String(thrown)).toEqual(doorBody(thrown));
      }
    });

    it('CONTROL: a coded sandboxed refusal keeps the #31246 answer, and a coded non-sandbox refusal its own; neither is logged', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(JSON.parse(await readRefused(sandboxed('Error: Locked.', { code: 'RECORD_LOCKED', status: 409 })))).toEqual(
        { error: 'Locked.', code: 'RECORD_LOCKED', status: 409 },
      );
      expect(await readRefused(Object.assign(new Error('The period is closed.'), { code: 'RECORD_LOCKED', status: 409 }))).toBe(
        JSON.stringify({ error: 'The period is closed.', code: 'RECORD_LOCKED', status: 409 }),
      );
      expect(log).not.toHaveBeenCalled();
    });
  });
  /**
   * [#31273] A driver's own string code answers the door's server fault here
   * too, through the same predicate the record data tools ask (their block,
   * below, says why). The #31270 hand-off's `SQLITE_BUSY` row.
   */
  describe('a driver\'s own string code answers the /data door\'s server fault (#31273)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('SQLITE_BUSY: 500 DATABASE_ERROR \'Internal data error\', the driver text withheld and logged once', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const thrown = sqliteBusy();
      const text = await readRefused(thrown);
      expect(text).toBe(JSON.stringify({ error: 'Internal data error', code: 'DATABASE_ERROR', status: 500 }));
      const door = mapDataError(thrown, 'task');
      expect(JSON.parse(text)).toEqual({ error: door.body.error, code: door.body.code, status: door.status });
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]![0]);
      expect(line).toMatch(/^\[5xx\] 500 resources\/read objectstack:\/\/objects\/task\/records\/t1 — /);
      expect(line).toContain('SQLITE_BUSY: database is locked');
    });

    it('CONTROL: a code the door refuses with no status keeps its coded answer, unlogged', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(JSON.parse(await readRefused(Object.assign(new Error('Field read denied: salary'), { code: 'PERMISSION_DENIED' }))))
        .toEqual({ error: 'Field read denied: salary', code: 'PERMISSION_DENIED' });
      expect(log).not.toHaveBeenCalled();
    });
  });

  /**
   * [#31341] A coded throw that DECLARES a 5xx answers the door's answer here
   * too, through the same predicate the record data tools ask (their block,
   * below, says why). This row was #31273's CONTROL, which pinned the
   * producer's sentence served.
   */
  describe('a declared 5xx answers the /data door\'s answer, its sentence withheld unless it is a refusal (#31341)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('SERVICE_UNAVAILABLE / 503: code and status kept, the sentence withheld and logged once', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const thrown = ledgerClosing();
      const text = await readRefused(thrown);
      expect(text).toBe(JSON.stringify({ error: 'Internal server error', code: 'SERVICE_UNAVAILABLE', status: 503 }));
      const door = mapDataError(thrown, 'task');
      expect(JSON.parse(text)).toEqual({ error: door.body.error, code: door.body.code, status: door.status });
      const lines = [...error.mock.calls, ...warn.mock.calls].map((call) => String(call[0]));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[5xx\] 503 resources\/read objectstack:\/\/objects\/task\/records\/t1 — /);
      expect(lines[0]).toContain('The ledger is closing.');
    });

    it('a declared 503 that marks itself `refusal: true` keeps its sentence, as the door serves it', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const thrown = ledgerClosing({ refusal: true });
      const text = await readRefused(thrown);
      expect(text).toBe(JSON.stringify({ error: 'The ledger is closing.', code: 'SERVICE_UNAVAILABLE', status: 503 }));
      const door = mapDataError(thrown, 'task');
      expect(JSON.parse(text)).toEqual({ error: door.body.error, code: door.body.code, status: door.status });
    });
  });

  /**
   * [#31373] The door's `declaredCode` and `userMessage` ride the resource's
   * door answer too, after `status`, each omitted when the door serves none.
   * The `VENDOR_DOWN` row reads a fresh record URI so its operator line is the
   * first capability-absence report on that route.
   */
  describe('the door\'s declaredCode and userMessage ride the door answer (#31373)', () => {
    const VENDOR_URI = 'objectstack://objects/vendor_task/records/t1';

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** The door's answer to `thrown`, in this resource's member order. */
    function doorBody(thrown: unknown): Record<string, unknown> {
      const door = mapDataError(thrown, 'task');
      return {
        error: door.body.error,
        ...(typeof door.body.code === 'string' ? { code: door.body.code } : {}),
        status: door.status,
        ...(door.body.declaredCode !== undefined ? { declaredCode: door.body.declaredCode } : {}),
        ...(door.body.userMessage !== undefined ? { userMessage: door.body.userMessage } : {}),
      };
    }

    it('an unregistered code with a declared 5xx: the closed code and its declaredCode, the sentence withheld and logged once', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const thrown = vendorDown();
      const text = await readRefused(thrown, VENDOR_URI);
      expect(text).toBe(JSON.stringify({ error: 'Internal server error', code: 'SERVICE_UNAVAILABLE', status: 503, declaredCode: 'VENDOR_DOWN' }));
      expect(JSON.parse(text)).toEqual(doorBody(thrown));
      const lines = [...error.mock.calls, ...warn.mock.calls].map((call) => String(call[0]));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[5xx\] 503 resources\/read objectstack:\/\/objects\/vendor_task\/records\/t1 — /);
      expect(lines[0]).toContain('The vendor is down.');
    });

    it('a userMessage rides after declaredCode, and on a code-less fault after status', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const coded = vendorDown({ userMessage: 'Payments are paused for a minute.' });
      expect(await readRefused(coded)).toBe(JSON.stringify({
        error: 'Internal server error', code: 'SERVICE_UNAVAILABLE', status: 503, declaredCode: 'VENDOR_DOWN', userMessage: 'Payments are paused for a minute.',
      }));
      expect(JSON.parse(await readRefused(coded))).toEqual(doorBody(coded));
      const fault = Object.assign(new Error('socket hang up'), { userMessage: 'Please retry in a moment.' });
      expect(await readRefused(fault)).toBe(JSON.stringify({
        error: 'Internal server error', code: 'INTERNAL_ERROR', status: 500, userMessage: 'Please retry in a moment.',
      }));
      expect(JSON.parse(await readRefused(fault))).toEqual(doorBody(fault));
    });

    it('CONTROL: a registered code with a declared 5xx carries no declaredCode', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await readRefused(ledgerClosing())).toBe(
        JSON.stringify({ error: 'Internal server error', code: 'SERVICE_UNAVAILABLE', status: 503 }),
      );
    });
  });
});

/**
 * [#31269] A sandboxed body that CRASHED while declaring a code (a hook body's
 * `throw Object.assign(new TypeError('boom'), { code: 'RECORD_LOCKED', status: 409 })`)
 * is a fault, not a refusal. The doors classify it first (`isSandboxCrash`,
 * `@objectstack/types`) and answer `500 INTERNAL_ERROR`; MCP's coded path read
 * the declared code and status and the runner's wrapper, so an agent saw the
 * hook's name and the native error text at a business status.
 *
 * `thrownRefusalEnvelope` now asks that same predicate, so a coded crash is no
 * coded refusal and each face renders it as it renders the same crash with no
 * code: the record data tools answer the `/data` door's fault, every other
 * face its own uncoded rendering (those faces' code-less renderings are
 * #31270–#31272's, and this card does not touch them).
 */
describe('a coded sandboxed CRASH is a fault on every face, never a refusal at its declared status (#31269)', () => {
  const CRASH_TEXT = "hook 'demo_crash_guard' threw: TypeError: boom";

  /** The `SandboxError` the QuickJS runner raises for the crash above (measured on the real runner). */
  function crash(extra: Record<string, unknown> = {}): Error {
    return Object.assign(new Error(CRASH_TEXT), { name: 'SandboxError', innerMessage: 'TypeError: boom' }, extra);
  }
  const codedCrash = () => crash({ code: 'RECORD_LOCKED', status: 409 });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const site of SITES.filter((s) => s.dataDoor)) {
    it(`${site.tool}: 500 INTERNAL_ERROR, the /data door's answer, logged once; no hook name, no native text`, async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const thrown = codedCrash();
      const result = await callTool(site, thrown);
      expect(result.isError).toBe(true);
      const error = JSON.parse(result.content[0].text).error;
      expect(error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 });
      const door = mapDataError(thrown, 'task');
      expect(error).toEqual({ code: door.body.code, message: door.body.error, status: door.status });
      expect(result.content[0].text).not.toContain('demo_crash_guard');
      expect(result.content[0].text).not.toContain('TypeError');
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0])).toMatch(new RegExp(`^\\[5xx\\] 500 tools/call ${site.tool} task — `));
    });
  }

  for (const site of SITES.filter((s) => !s.dataDoor)) {
    it(`${site.tool}: answers what it answers for the same crash with no code; its declared code and status are not served`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const coded = await callTool(site, codedCrash());
      expect(coded).toEqual(await callTool(site, crash()));
      expect(coded.content[0].text).not.toContain('RECORD_LOCKED');
      expect(coded.content[0].text).not.toContain('409');
    });
  }

  // CONTROL: a coded sandboxed REFUSAL keeps the #31246 answer on every face.
  it('CONTROL: a coded sandboxed refusal keeps its code, inner sentence and status', async () => {
    const refusal = crash({ innerMessage: 'Locked.', code: 'RECORD_LOCKED', status: 409 });
    for (const site of SITES) {
      expect(JSON.parse((await callTool(site, refusal)).content[0].text), site.tool).toEqual({
        error: { code: 'RECORD_LOCKED', message: 'Locked.', status: 409 },
      });
    }
  });
});

/**
 * [#31271] `run_action` / `resume_run` answer a throw as the `/api/v1/actions`
 * door answers it: through that door's own reader, `actionsDoorAnswerOf`
 * (`@objectstack/types`), never a copy. Each row asserts the literal answer
 * AND its equality with the reader's on a fresh copy of the same throw, so the
 * pin cannot pass by the two agreeing on something nobody wrote down.
 *
 * These tools used to answer a code-less sandboxed body abort with the
 * runner's `KIND 'NAME' threw: …` wrapper naming the body, a bare `Error` with
 * its bare text and no code, a driver string code as `{ code: SQLITE_BUSY }`
 * with no status, and a sandboxed crash (coded or not) with the wrapper and
 * the native error text.
 *
 * ⚠️ `SQLITE_BUSY` answers what `/actions` answers, `400 VALIDATION_ERROR` with
 * `declaredCode`; `/api/v1/data` answers the same throw `500 DATABASE_ERROR`.
 * That REST-side difference is not this card's.
 */
describe('run_action / resume_run: a throw answers what the /actions door answers (#31271)', () => {
  const ACTION_SITES = SITES.filter((s) => s.actionDoor);
  const BODY_WRAPPER = "action 'demo_leave_body' threw: Error: Not enough annual leave remaining";
  const CRASH_WRAPPER = "action 'demo_leave_body' threw: TypeError: boom";

  const CASES: ReadonlyArray<{ name: string; thrown: () => unknown; answer: Record<string, unknown>; logs: number }> = [
    {
      name: 'a code-less sandboxed body abort: 400 HOOK_ABORTED with the inner sentence',
      thrown: () => Object.assign(new Error(BODY_WRAPPER), { name: 'SandboxError', innerMessage: 'Not enough annual leave remaining' }),
      answer: { code: 'HOOK_ABORTED', message: 'Not enough annual leave remaining', status: 400 },
      logs: 1,
    },
    {
      name: 'a bare Error: the door\'s 400 rejection, VALIDATION_ERROR with its own sentence',
      thrown: () => new Error('socket hang up'),
      answer: { code: 'VALIDATION_ERROR', message: 'socket hang up', status: 400 },
      logs: 0,
    },
    {
      name: 'a driver string code: 400 VALIDATION_ERROR, SQLITE_BUSY demoted to declaredCode',
      thrown: () => Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' }),
      answer: { code: 'VALIDATION_ERROR', message: 'SQLITE_BUSY: database is locked', status: 400, declaredCode: 'SQLITE_BUSY' },
      logs: 0,
    },
    {
      name: 'a sandboxed CRASH with no code: 500 INTERNAL_ERROR, the generic sentence',
      thrown: () => Object.assign(new Error(CRASH_WRAPPER), { name: 'SandboxError', innerMessage: 'TypeError: boom' }),
      answer: { code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 },
      logs: 1,
    },
    {
      name: 'a sandboxed CRASH that declared a code and status: the same fault; neither is served',
      thrown: () => Object.assign(new Error(CRASH_WRAPPER), {
        name: 'SandboxError', innerMessage: 'TypeError: boom', code: 'RECORD_LOCKED', status: 409,
      }),
      answer: { code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 },
      logs: 1,
    },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the two action tools are the rows this block drives', () => {
    expect(ACTION_SITES.map((s) => s.tool).sort()).toEqual(['resume_run', 'run_action']);
  });

  for (const site of ACTION_SITES) {
    for (const c of CASES) {
      it(`${site.tool}: ${c.name}`, async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const result = await callTool(site, c.thrown());
        expect(result.isError).toBe(true);
        expect(result.content).toHaveLength(1);
        const text = String(result.content[0].text);
        const { error } = JSON.parse(text);
        expect(error).toEqual(c.answer);
        // The door's reader, on a fresh copy of the same throw.
        const door = actionsDoorAnswerOf(c.thrown());
        expect(error).toEqual({
          code: door.code,
          message: door.message,
          status: door.status,
          ...(door.declaredCode !== undefined ? { declaredCode: door.declaredCode } : {}),
        });
        expect(text).not.toContain('demo_leave_body');
        expect(text).not.toContain('TypeError');
        // The wrapper and the fault line reach the operator, as the door prints them.
        expect(log).toHaveBeenCalledTimes(c.logs);
      });
    }

    it(`${site.tool}: an app's own unregistered code crosses as the status-derived closed code, its spelling in declaredCode`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const thrown = () => Object.assign(new Error('No leave days left this year.'), { code: 'LEAVE_EXHAUSTED', status: 409 });
      const { error } = JSON.parse((await callTool(site, thrown())).content[0].text);
      expect(error).toEqual({
        code: 'RESOURCE_CONFLICT', message: 'No leave days left this year.', status: 409, declaredCode: 'LEAVE_EXHAUSTED',
      });
      const door = actionsDoorAnswerOf(thrown());
      expect([door.code, door.declaredCode, door.status]).toEqual([error.code, error.declaredCode, error.status]);
    });

    it(`${site.tool}: a fault carries no thrown details; a refusal still does`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const details = { host: 'db-primary.internal', pool: 'writer' };
      for (const fault of [
        Object.assign(new Error('pool exhausted'), { status: 503, details }),
        Object.assign(new Error(CRASH_WRAPPER), { name: 'SandboxError', innerMessage: 'TypeError: boom', details }),
      ]) {
        const result = await callTool(site, fault);
        const { error } = JSON.parse(result.content[0].text);
        expect(error.status).toBeGreaterThanOrEqual(500);
        expect(error).not.toHaveProperty('details');
        expect(result.content[0].text).not.toContain('db-primary.internal');
      }
      const refusal = Object.assign(new Error('Confirm first.'), { code: 'ACTION_CONFIRMATION_REQUIRED', status: 428, details });
      expect(JSON.parse((await callTool(site, refusal)).content[0].text).error).toEqual({
        code: 'ACTION_CONFIRMATION_REQUIRED', message: 'Confirm first.', status: 428, details,
      });
    });

    it(`${site.tool}: CONTROL: a coded sandboxed refusal keeps the #31246 answer (code, inner sentence, status)`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await callTool(site, codedSandboxRefusal());
      expect(JSON.parse(result.content[0].text)).toEqual({
        error: { code: 'RECORD_LOCKED', message: SANDBOX_SENTENCE, status: 409 },
      });
    });
  }
});

/**
 * [#31272] The metadata tools (`list_objects`, `describe_object`,
 * `validate_expression`) and `list_actions` answer a FAULT as the `/meta` door
 * does. Their catches rendered every code-less throw as its raw text and every
 * string `code` as a refusal, so a bridge member that faulted handed the agent
 * `socket hang up`, or `{ code: SQLITE_BUSY, message: <driver text> }`, where
 * the `/meta` read doors (`handleRouteError`, `@objectstack/rest`) answer
 * `500 INTERNAL_ERROR 'Internal server error'` and `500 DATABASE_ERROR
 * 'Internal data error'` and log the fault for the operator.
 *
 * Those doors call `handleRouteError` with no object, and for a fault it
 * answers `mapDataError`'s classification (`@objectstack/types`), the reader
 * these tools now ask; measured on both, one throw at a time, for every shape
 * below. Each case asserts the literal wire answer AND its equality with that
 * reader's answer, so neither side can move alone.
 */
describe('the metadata tools and list_actions: a fault answers what the /meta door answers (#31272)', () => {
  const META_SITES = SITES.filter((s) => s.metaDoor);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The `/meta` read door's answer to the same throw (no object, as those doors call it), in the tool's spelling. */
  function metaDoorAnswer(thrown: unknown): Record<string, unknown> {
    const door = mapDataError(thrown);
    return {
      ...(typeof door.body.code === 'string' ? { code: door.body.code } : {}),
      message: door.body.error,
      status: door.status,
    };
  }

  /** The tool's answer, parsed, after asserting it is a tool error. */
  async function errorOf(site: Site, thrown: unknown): Promise<{ text: string; error: Record<string, unknown> }> {
    const result = await callTool(site, thrown);
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = String(result.content[0].text);
    return { text, error: JSON.parse(text).error };
  }

  /** What the one `[5xx]` log line names as the request: the tool, and the object it read when it names one. */
  const LOGGED_PATH: Record<string, string> = {
    list_objects: 'list_objects',
    describe_object: 'describe_object task',
    validate_expression: 'validate_expression task',
    list_actions: 'list_actions',
  };

  it('the four tools are the rows this block drives', () => {
    expect(META_SITES.map((s) => s.tool).sort()).toEqual(
      ['describe_object', 'list_actions', 'list_objects', 'validate_expression'],
    );
  });

  for (const site of META_SITES) {
    it(`${site.tool}: a bare Error answers 500 INTERNAL_ERROR, its text withheld from the agent and logged once`, async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const thrown = new Error('socket hang up');
      const { text, error } = await errorOf(site, thrown);
      expect(error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 });
      expect(error).toEqual(metaDoorAnswer(thrown));
      expect(text).not.toContain('socket hang up');
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]![0]);
      expect(line.startsWith(`[5xx] 500 tools/call ${LOGGED_PATH[site.tool]} — `), line).toBe(true);
      expect(line).toContain('socket hang up');
    });

    it(`${site.tool}: a driver string code answers 500 DATABASE_ERROR, never the driver's code or text, logged once`, async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const thrown = Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' });
      const { text, error } = await errorOf(site, thrown);
      expect(error).toEqual({ code: 'DATABASE_ERROR', message: 'Internal data error', status: 500 });
      expect(error).toEqual(metaDoorAnswer(thrown));
      expect(text).not.toContain('SQLITE_BUSY');
      expect(text).not.toContain('database is locked');
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0])).toContain('SQLITE_BUSY: database is locked');
    });

    it(`${site.tool}: CONTROL: a declared refusal keeps its code and sentence, and is not logged`, async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const locked = Object.assign(new Error('Record is locked'), { code: 'RECORD_LOCKED', status: 409 });
      expect((await errorOf(site, locked)).error).toEqual({ code: 'RECORD_LOCKED', message: 'Record is locked', status: 409 });
      // A registered code with no status: the door answers it as the refusal it is (403), so it stays one.
      const denied = Object.assign(new Error('Field read denied: salary'), { code: 'PERMISSION_DENIED' });
      expect((await errorOf(site, denied)).error).toEqual({ code: 'PERMISSION_DENIED', message: 'Field read denied: salary' });
      expect(log).not.toHaveBeenCalled();
    });
  }

  // The object-schema reads' own declared 503 (ADR-0106 D6 tier 3, thrown by
  // both bridges' `fieldVisibilityRefusal`). The `/meta` object read answers
  // it through `sendFieldVisibilityFault` as a declared server fault: its code
  // and status, its prose withheld (#5437). These tools now answer the same.
  it('FIELD_VISIBILITY_UNRESOLVED / 503 keeps its code and status; its sentence is withheld, as /meta withholds it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const thrown = Object.assign(
      new Error("Field visibility for object 'task' could not be evaluated; the object schema is not being served."),
      { code: 'FIELD_VISIBILITY_UNRESOLVED', status: 503 },
    );
    for (const site of META_SITES.filter((s) => s.tool !== 'list_actions')) {
      const { error } = await errorOf(site, thrown);
      expect(error, site.tool).toEqual({ code: 'FIELD_VISIBILITY_UNRESOLVED', message: 'Internal server error', status: 503 });
      expect(error, site.tool).toEqual(metaDoorAnswer(thrown));
    }
  });

  // [#31373] The record data faces now serve the `/data` door's `declaredCode`
  // and `userMessage` off the reader these tools share. This card does not
  // move these tools' answer: the closed code, sentence and status only.
  it('CONTROL: an unregistered code with a declared 5xx and a userMessage keeps these tools\' answer (#31373)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const thrown = Object.assign(new Error('The vendor is down.'), {
      code: 'VENDOR_DOWN', status: 503, userMessage: 'Payments are paused for a minute.',
    });
    for (const site of META_SITES) {
      const { error } = await errorOf(site, thrown);
      expect(error, site.tool).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Internal server error', status: 503 });
    }
  });
});

/**
 * [#31273] A driver's own string code (`SQLITE_BUSY`, `ECONNRESET`, `40P01`)
 * rides `.code` with no HTTP status. The `/api/v1/data` door answers it as a
 * server fault (`mapDataError`, `@objectstack/types`): `500 DATABASE_ERROR`
 * `Internal data error` when its text names the store, the driver text and
 * errno withheld and logged once. The record data tools read the coded path
 * first, so an agent got `{ code: 'SQLITE_BUSY', message: 'SQLITE_BUSY:
 * database is locked' }` with no status.
 *
 * A coded throw is now a coded refusal on these faces unless the door answers
 * it as a server fault whose status the producer did not declare
 * (`serverFaultProvenance` `'undeclared'`, `@objectstack/types`, the ruling of
 * 2026-08-27 on #12509: the discriminator is the status channel, never the
 * code's spelling). Then the face answers the door's fault.
 *
 * [#31341] A coded throw that DECLARES a 5xx is a server fault at the door
 * too, so the faces now answer it the same way: the door's code and status,
 * its sentence withheld unless the throw marks itself `refusal: true`. Its
 * rows close this block; they replaced #31273's CONTROL for a declared 5xx.
 *
 * Only the record data tools, `delete_records`' selection read and the record
 * resource (its rows are below). `run_action` / `resume_run` and the metadata
 * tools answer a driver code through their own doors' readers (#31271,
 * #31272), so this block does not pin them.
 */
function sqliteBusy(): Error {
  return Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' });
}

/** [#31341] A producer's coded throw that declares a 5xx, with its own sentence. */
function ledgerClosing(extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error('The ledger is closing.'), { code: 'SERVICE_UNAVAILABLE', status: 503 }, extra);
}

/** [#31373] An app's own, unregistered code with a declared 5xx, with its own sentence. */
function vendorDown(extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error('The vendor is down.'), { code: 'VENDOR_DOWN', status: 503 }, extra);
}

describe('the record data tools: a driver\'s own string code is the /data door\'s server fault, not a coded refusal (#31273)', () => {
  const FACES = SITES.filter((s) => s.dataDoor || s.tool === 'delete_records');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The tool's answer, parsed, after asserting it is a tool error. */
  async function errorOf(site: Site, thrown: unknown): Promise<{ text: string; error: Record<string, unknown> }> {
    const result = await callTool(site, thrown);
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = String(result.content[0].text);
    return { text, error: JSON.parse(text).error };
  }

  /** The `/data` door's answer to the same throw, in the tool's envelope spelling. */
  function doorAnswer(thrown: unknown): Record<string, unknown> {
    const door = mapDataError(thrown, 'task');
    return { code: door.body.code, message: door.body.error, status: door.status };
  }

  it('the faces are the six record data tools and delete_records\' selection read', () => {
    expect(FACES.map((s) => s.tool).sort()).toEqual([
      'aggregate_records', 'create_record', 'delete_record', 'delete_records', 'get_record', 'query_records', 'update_record',
    ]);
  });

  for (const site of FACES) {
    it(`${site.tool}: SQLITE_BUSY answers 500 DATABASE_ERROR 'Internal data error', the driver text withheld and logged once`, async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const thrown = sqliteBusy();
      const { text, error } = await errorOf(site, thrown);
      expect(error).toEqual({ code: 'DATABASE_ERROR', message: 'Internal data error', status: 500 });
      expect(error).toEqual(doorAnswer(thrown));
      expect(text).not.toContain('SQLITE_BUSY');
      expect(text).not.toContain('database is locked');
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]![0]);
      expect(line).toMatch(new RegExp(`^\\[5xx\\] 500 tools/call ${site.tool} task — `));
      expect(line).toContain('SQLITE_BUSY: database is locked');
    });
  }

  const update = FACES.find((s) => s.tool === 'update_record')!;

  it('a driver errno whose text names no store (ECONNRESET) answers the door\'s 500 INTERNAL_ERROR, its code withheld', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const { text, error } = await errorOf(update, thrown);
    expect(error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 });
    expect(error).toEqual(doorAnswer(thrown));
    expect(text).not.toContain('ECONNRESET');
  });

  // The ruling's stated cost (`serverFaultProvenance`'s docblock): a producer
  // that spells a code but declares no status loses that code on a 5xx, at the
  // door and now here. It keeps it by declaring the status it means.
  it('a code with no declared status that the door answers as a fault: the door\'s 500, the code not served', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = Object.assign(new Error('Locked.'), { code: 'RECORD_LOCKED' });
    const { error } = await errorOf(update, thrown);
    expect(error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 });
    expect(error).toEqual(doorAnswer(thrown));
  });

  it('CONTROL: a declared ObjectStack code and a coded sandboxed refusal keep their coded answers on every face, unlogged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const site of FACES) {
      expect((await errorOf(site, Object.assign(new Error('Locked.'), { code: 'RECORD_LOCKED', status: 409 }))).error, site.tool)
        .toEqual({ code: 'RECORD_LOCKED', message: 'Locked.', status: 409 });
      expect((await errorOf(site, codedSandboxRefusal())).error, site.tool)
        .toEqual({ code: 'RECORD_LOCKED', message: SANDBOX_SENTENCE, status: 409 });
    }
    expect(log).not.toHaveBeenCalled();
  });

  it('CONTROL: a code the door answers as a refusal with no declared status (PERMISSION_DENIED, 403 at the door) keeps its coded answer', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const site of FACES) {
      expect((await errorOf(site, Object.assign(new Error('Field read denied: salary'), { code: 'PERMISSION_DENIED' }))).error, site.tool)
        .toEqual({ code: 'PERMISSION_DENIED', message: 'Field read denied: salary' });
    }
    expect(log).not.toHaveBeenCalled();
  });

  /**
   * [#31341] A 5xx the producer DECLARED is a server fault at the door too:
   * `mapDataError` keeps its code and status and withholds its sentence
   * (`Internal server error`) unless the throw marks itself `refusal: true`
   * (`declaredRefusalMessage`, `@objectstack/types`). These faces read the
   * coded path first, so they served the producer's sentence verbatim. This
   * row was #31273's CONTROL, which pinned that sentence served; it moved.
   */
  for (const site of FACES) {
    it(`${site.tool}: a declared 5xx keeps its code and status, its sentence withheld and logged once (#31341)`, async () => {
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const thrown = ledgerClosing();
      const { text, error } = await errorOf(site, thrown);
      expect(error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Internal server error', status: 503 });
      expect(error).toEqual(doorAnswer(thrown));
      expect(text).not.toContain('The ledger is closing.');
      const lines = [...errorLog.mock.calls, ...warnLog.mock.calls].map((call) => String(call[0]));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(new RegExp(`^\\[5xx\\] 503 tools/call ${site.tool} task — `));
      expect(lines[0]).toContain('The ledger is closing.');
    });
  }

  it('a declared 5xx that marks itself `refusal: true` keeps its sentence on every face, as the door serves it (#31341)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const thrown = ledgerClosing({ refusal: true });
    for (const site of FACES) {
      const { error } = await errorOf(site, thrown);
      expect(error, site.tool).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'The ledger is closing.', status: 503 });
      expect(error, site.tool).toEqual(doorAnswer(thrown));
    }
  });

  /**
   * [#31373] The door demotes an unregistered code with a declared 5xx to the
   * status's closed code and keeps the producer's spelling in `declaredCode`;
   * it rides a producer's `userMessage` onto whatever it answers. These faces
   * render the door's answer, so they serve both members, read off the same
   * answer (`dataDoorAnswerOf`), in `run_action`'s order (#31271): `code`,
   * `message`, `status`, `declaredCode`, `userMessage`, each omitted when the
   * door serves none. Since #31341 the `VENDOR_DOWN` row answered the closed
   * code alone; it moved. The rows read a fresh object, `vendor_task`, so
   * the operator line is the first `SERVICE_UNAVAILABLE` capability-absence
   * report on its route (`logServerFault` reports that family once per route
   * per process, as at the door).
   */
  const onVendorTask = (site: Site): Site => ({ ...site, args: { ...site.args, objectName: 'vendor_task' } });

  /** The `/data` door's answer to `thrown`, with the members it serves beside the code. */
  function doorWire(thrown: unknown): Record<string, unknown> {
    const door = mapDataError(thrown, 'task');
    return {
      ...doorAnswer(thrown),
      ...(door.body.declaredCode !== undefined ? { declaredCode: door.body.declaredCode } : {}),
      ...(door.body.userMessage !== undefined ? { userMessage: door.body.userMessage } : {}),
    };
  }

  for (const site of FACES) {
    it(`${site.tool}: an unregistered code with a declared 5xx answers the closed code and its declaredCode, the sentence withheld and logged once (#31373)`, async () => {
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const thrown = vendorDown();
      const { text, error } = await errorOf(onVendorTask(site), thrown);
      expect(error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Internal server error', status: 503, declaredCode: 'VENDOR_DOWN' });
      expect(Object.keys(error)).toEqual(['code', 'message', 'status', 'declaredCode']);
      expect(error).toEqual(doorWire(thrown));
      expect(text).not.toContain('The vendor is down.');
      const lines = [...errorLog.mock.calls, ...warnLog.mock.calls].map((call) => String(call[0]));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(new RegExp(`^\\[5xx\\] 503 tools/call ${site.tool} vendor_task — `));
      expect(lines[0]).toContain('The vendor is down.');
    });
  }

  it('a declared 5xx carrying a userMessage serves it after declaredCode on every face, as the door does (#31373)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const thrown = vendorDown({ userMessage: 'Payments are paused for a minute.' });
    for (const site of FACES) {
      const { error } = await errorOf(site, thrown);
      expect(error, site.tool).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Internal server error',
        status: 503,
        declaredCode: 'VENDOR_DOWN',
        userMessage: 'Payments are paused for a minute.',
      });
      expect(Object.keys(error), site.tool).toEqual(['code', 'message', 'status', 'declaredCode', 'userMessage']);
      expect(error, site.tool).toEqual(doorWire(thrown));
    }
  });

  // A code-less throw reaches the door's answer on the six tools (#31218);
  // `delete_records`' catch keeps its own rendering for one (#31246).
  it('a code-less throw carrying a userMessage serves it on the six record data tools, as the door does (#31373)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fault = Object.assign(new Error('socket hang up'), { userMessage: 'Please retry in a moment.' });
    const abort = Object.assign(new Error("hook 'demo_leave_guard' threw: Error: Not enough leave"), {
      name: 'SandboxError',
      innerMessage: 'Not enough leave',
      userMessage: 'Your leave balance is too low.',
    });
    for (const site of FACES.filter((s) => s.tool !== 'delete_records')) {
      const faulted = (await errorOf(site, fault)).error;
      expect(faulted, site.tool).toEqual({
        code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500, userMessage: 'Please retry in a moment.',
      });
      expect(faulted, site.tool).toEqual(doorWire(fault));
      const aborted = (await errorOf(site, abort)).error;
      expect(aborted, site.tool).toEqual({
        code: 'HOOK_ABORTED', message: 'Not enough leave', status: 400, userMessage: 'Your leave balance is too low.',
      });
      expect(aborted, site.tool).toEqual(doorWire(abort));
    }
  });

  it('CONTROL: a registered code with a declared 5xx carries no declaredCode on any face (#31373)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const site of FACES) {
      const { error } = await errorOf(site, ledgerClosing());
      expect(error, site.tool).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Internal server error', status: 503 });
      expect('declaredCode' in error, site.tool).toBe(false);
      expect('userMessage' in error, site.tool).toBe(false);
    }
  });
});
