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
 *    byte-identical to `errorResult(messageOf(err))`. That includes the value
 *    the HTTP bridge's exposure gate throws today, `{ statusCode, message }`
 *    with no `code`. Nothing is invented for it.
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

import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { recordNotFoundError } from '@objectstack/core';
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
}

/** Every tool `wireBridgeTools` registers for {@link benignBridge}, each with the member it calls first. */
const SITES: readonly Site[] = [
  { tool: 'list_objects', args: {}, member: 'listObjects' },
  { tool: 'describe_object', args: { objectName: 'task' }, member: 'describeObject' },
  { tool: 'validate_expression', args: { objectName: 'task', expression: 'record.title' }, member: 'describeObject' },
  { tool: 'query_records', args: { objectName: 'task' }, member: 'query' },
  {
    tool: 'aggregate_records',
    args: { objectName: 'task', aggregations: [{ function: 'count', alias: 'n' }] },
    member: 'aggregate',
  },
  { tool: 'get_record', args: { objectName: 'task', recordId: 't9' }, member: 'get' },
  { tool: 'create_record', args: { objectName: 'task', data: { title: 'x' } }, member: 'create' },
  { tool: 'update_record', args: { objectName: 'task', recordId: 't9', data: { title: 'x' } }, member: 'update' },
  { tool: 'delete_record', args: { objectName: 'task', recordId: 't9' }, member: 'remove' },
  { tool: 'list_actions', args: {}, member: 'listActions' },
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

    it(`${site.tool}: a code-less throw from ${String(site.member)} answers its bare message, as before`, async () => {
      const result = await callTool(site, new Error('engine exploded'));
      expect(result).toEqual({ content: [{ type: 'text', text: 'engine exploded' }], isError: true });
    });

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

  it('the HTTP bridge exposure gate\'s `{ statusCode, message }` (no `code`) answers its bare message: nothing is invented', async () => {
    const thrown = { statusCode: 404, message: "Object 'task' is not exposed via the API" };
    expect(await callTool(query, thrown)).toEqual({
      content: [{ type: 'text', text: "Object 'task' is not exposed via the API" }],
      isError: true,
    });
  });

  it('an empty or non-string `code`, or a thrown string, is not a code', async () => {
    for (const thrown of [
      Object.assign(new Error('empty code'), { code: '', status: 403 }),
      Object.assign(new Error('numeric code'), { code: 403, status: 403 }),
      'a thrown string',
    ]) {
      const text = thrown instanceof Error ? thrown.message : String(thrown);
      expect(await callTool(query, thrown), text).toEqual({ content: [{ type: 'text', text }], isError: true });
    }
  });

  it('omits a `status` that is not a number', async () => {
    const statusless = Object.assign(new Error('no status here'), { code: 'PERMISSION_DENIED', status: '403' });
    expect(JSON.parse((await callTool(query, statusless)).content[0].text)).toEqual({
      error: { code: 'PERMISSION_DENIED', message: 'no status here' },
    });
  });
});

describe('the record resource: a coded refusal adds its code beside the unchanged sentence (#23509)', () => {
  const URI = 'objectstack://objects/task/records/t1';

  /** Read the record resource of a server whose reader throws `thrown`; answers the raw body text. */
  async function readRefused(thrown: unknown): Promise<string> {
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
      const read = await client.readResource({ uri: URI });
      expect(read.contents).toHaveLength(1);
      expect(read.contents[0]!.uri).toBe(URI);
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

  it('a code-less throw answers `{ error }` byte-identically', async () => {
    expect(await readRefused(new Error('engine exploded'))).toBe(JSON.stringify({ error: 'engine exploded' }));
    expect(await readRefused('a thrown string')).toBe(JSON.stringify({ error: 'a thrown string' }));
    expect(await readRefused(Object.assign(new Error('empty code'), { code: '' }))).toBe(
      JSON.stringify({ error: 'empty code' }),
    );
  });
});
