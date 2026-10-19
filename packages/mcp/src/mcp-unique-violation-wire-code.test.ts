// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23701] An MCP tool call that repeats a unique value answers the ruled wire
 * spelling, `UNIQUE_VIOLATION`, not the engine's in-process `DUPLICATE_RECORD`.
 *
 * Maintainer ruling (2026-09-03, recorded in commit 65846bc46): one wire
 * spelling on every route, `UNIQUE_VIOLATION`; the row reports it too.
 *
 * ## What was wrong
 *
 * `thrownRefusalEnvelope` is the one reader both tool writers
 * (`errorResultWithCode` for the data tools, `errorResultFromThrown` for
 * `run_action` and `resume_run`) and the record resource share. It relayed the
 * thrown `code` verbatim, so the engine's `DuplicateRecordError` reached an MCP
 * client as `DUPLICATE_RECORD`. Measured before the fix, on a real
 * `MCPServerRuntime` behind the runtime dispatcher's `/mcp` route over a real
 * ObjectQL + SQLite engine: `create_record`, `update_record`, and `run_action`
 * (a handler's write and a declarative update) each answered
 * `{"error":{"code":"DUPLICATE_RECORD",…,"status":409}}` with `isError`.
 *
 * ## What is pinned here
 *
 * The HTTP `/mcp` face, through `handleHttpRequest` and the real Streamable
 * HTTP transport, with a bridge double whose member throws a value shaped
 * like the engine's class (`name`, `code`, `status`, `httpStatus`, `object`,
 * `field`, its in-process `developerMessage`, a driver error on `cause`). This
 * package composes no engine.
 *
 *  - Each tool whose call can repeat a unique value answers `UNIQUE_VIOLATION`
 *    with `status` 409. The envelope's keys are unchanged: `code`, `message`,
 *    `status`. Neither the in-process spelling nor the driver's text appears.
 *  - The record resource, the reader's other consumer, answers the same code.
 *  - CONTROL: a producer that merely SPEAKS `DUPLICATE_RECORD` (a hook or a
 *    handler throwing the registered code without being the engine's class)
 *    keeps its own code. That is the ruling's own exception.
 *  - CONTROL: the class name with another code, and the engine's other 409
 *    (`DELETE_RESTRICTED`), keep their codes.
 *
 * Codes and key presence are asserted, never wording.
 */

import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { IMetadataService } from '@objectstack/spec/contracts';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpActionBridge, McpDataBridge } from './mcp-http-tools.js';

type Bridge = McpDataBridge & McpActionBridge;

/** What the driver said. It must never reach the client. */
const DRIVER_TEXT = "UNIQUE constraint failed: index 'uniq_udoc_organization_id_email'";

/** A value shaped like `@objectstack/objectql`'s `DuplicateRecordError`. */
function engineDuplicate(): Error {
  return Object.assign(
    new Error("Duplicate record refused on 'udoc': a unique constraint on 'email' already holds this value. No record was written."),
    {
      name: 'DuplicateRecordError',
      code: 'DUPLICATE_RECORD',
      status: 409,
      httpStatus: 409,
      object: 'udoc',
      field: 'email',
      developerMessage: "Over the HTTP API this refusal is reported as UNIQUE_VIOLATION; inside the engine the thrown class carries code === 'DUPLICATE_RECORD'.",
      cause: Object.assign(new Error(DRIVER_TEXT), { code: 'SQLITE_CONSTRAINT_UNIQUE' }),
    },
  );
}

/** A hook or handler that speaks the registered code without being the engine's class. */
function spokenDuplicate(): Error {
  return Object.assign(new Error('That address is already on file'), { code: 'DUPLICATE_RECORD', status: 409 });
}

/** A value shaped like the engine's referential-integrity refusal: another engine 409. */
function engineDeleteRestricted(): Error {
  return Object.assign(new Error('This Parent is still referenced by 1 Child record(s).'), {
    code: 'DELETE_RESTRICTED',
    status: 409,
    developerMessage: 'Cannot delete uparent (p1): 1 dependent uchild record(s) reference it via parent.',
  });
}

function benignBridge(): Bridge {
  return {
    async listObjects() { return [{ name: 'udoc', label: 'Unique doc', fieldCount: 3 }]; },
    async describeObject() { return { name: 'udoc', fields: [{ name: 'email', type: 'text' }] }; },
    async query(object) { return { object, records: [], total: 0 }; },
    async get(_object, id) { return { id }; },
    async create(object, data) { return { object, id: 'n1', record: data }; },
    async update(object, id, data) { return { object, id, record: data }; },
    async remove(object, id) { return { object, id, success: true }; },
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
}

const CREATE: Site = { tool: 'create_record', args: { objectName: 'udoc', data: { email: 'taken@example.com' } }, member: 'create' };
const UPDATE: Site = {
  tool: 'update_record',
  args: { objectName: 'udoc', recordId: 'r2', data: { email: 'taken@example.com' } },
  member: 'update',
};
const DELETE: Site = { tool: 'delete_record', args: { objectName: 'udoc', recordId: 'r2' }, member: 'remove' };
const RUN_ACTION: Site = { tool: 'run_action', args: { actionName: 'add_duplicate', objectName: 'udoc' }, member: 'runAction' };
const RESUME_RUN: Site = { tool: 'resume_run', args: { runId: 'run_1', values: { email: 'taken@example.com' } }, member: 'resumeRun' };

let nextId = 1;
async function callTool(site: Site, thrown: unknown) {
  const bridge = benignBridge();
  (bridge as unknown as Record<string, unknown>)[site.member] = async () => {
    throw thrown;
  };
  const body = {
    jsonrpc: '2.0',
    id: nextId++,
    method: 'tools/call',
    params: { name: site.tool, arguments: site.args },
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
  expect(res.status, `${site.tool}: the HTTP transport itself answered ${res.status}`).toBe(200);
  const json = (await res.json()) as { result?: any; error?: unknown };
  expect(json.error, `${site.tool}: JSON-RPC error ${JSON.stringify(json.error)}`).toBeUndefined();
  const result = json.result;
  expect(result.isError, `${site.tool}: not a tool error`).toBe(true);
  expect(result.content).toHaveLength(1);
  const text = String(result.content[0].text);
  return { text, error: (JSON.parse(text) as { error: Record<string, unknown> }).error };
}

describe('[#23701] an MCP tool call repeating a unique value answers UNIQUE_VIOLATION', () => {
  for (const site of [CREATE, UPDATE, RUN_ACTION, RESUME_RUN]) {
    it(`${site.tool}: the engine's class answers UNIQUE_VIOLATION / 409, with the envelope's own keys`, async () => {
      const { text, error } = await callTool(site, engineDuplicate());

      expect(error.code).toBe('UNIQUE_VIOLATION');
      expect(error.status).toBe(409);
      expect(typeof error.message).toBe('string');
      // The envelope's shape does not move: no context slot is invented.
      expect(Object.keys(error).sort()).toEqual(['code', 'message', 'status']);
      // The in-process spelling does not cross, and neither does the driver's text.
      expect(text).not.toContain('DUPLICATE_RECORD');
      expect(text).not.toContain(DRIVER_TEXT);
    });
  }

  for (const site of [CREATE, RUN_ACTION]) {
    it(`CONTROL ${site.tool}: a producer that merely speaks DUPLICATE_RECORD keeps its own code`, async () => {
      const { error } = await callTool(site, spokenDuplicate());

      expect(error.code).toBe('DUPLICATE_RECORD');
      expect(error.status).toBe(409);
      expect(Object.keys(error).sort()).toEqual(['code', 'message', 'status']);
    });
  }

  it('CONTROL: the class name with another registered code keeps that code', async () => {
    const renamed = Object.assign(engineDuplicate(), { code: 'CONCURRENT_UPDATE' });
    const { error } = await callTool(UPDATE, renamed);

    expect(error.code).toBe('CONCURRENT_UPDATE');
    expect(error.status).toBe(409);
  });

  for (const site of [DELETE, RUN_ACTION]) {
    it(`CONTROL ${site.tool}: the engine's other 409, DELETE_RESTRICTED, keeps its code and keys`, async () => {
      const { error } = await callTool(site, engineDeleteRestricted());

      expect(error.code).toBe('DELETE_RESTRICTED');
      expect(error.status).toBe(409);
      expect(Object.keys(error).sort()).toEqual(['code', 'message', 'status']);
    });
  }
});

describe('[#23701] the record resource, the reader\'s other consumer, answers the same code', () => {
  const URI = 'objectstack://objects/udoc/records/r1';

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
      return String((read.contents[0] as { text?: unknown }).text);
    } finally {
      await client.close();
    }
  }

  it('the engine\'s class: `code` UNIQUE_VIOLATION and `status` 409 beside the `error` sentence', async () => {
    const text = await readRefused(engineDuplicate());
    const body = JSON.parse(text);

    expect(body.code).toBe('UNIQUE_VIOLATION');
    expect(body.status).toBe(409);
    expect(typeof body.error).toBe('string');
    expect(Object.keys(body).sort()).toEqual(['code', 'error', 'status']);
    expect(text).not.toContain('DUPLICATE_RECORD');
  });

  it('CONTROL: a producer that merely speaks DUPLICATE_RECORD keeps its own code', async () => {
    const body = JSON.parse(await readRefused(spokenDuplicate()));

    expect(body.code).toBe('DUPLICATE_RECORD');
    expect(body.status).toBe(409);
  });
});
