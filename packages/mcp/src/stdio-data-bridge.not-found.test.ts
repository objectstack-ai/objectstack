// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Commit 4810dd628 — the stdio bridge's by-id write seams must throw the repo's ONE
 * not-found envelope (`recordNotFoundError`, `@objectstack/core`), not a
 * locally minted `Error`.
 *
 * The HTTP bridge routes its data verbs through `callData`, which throws
 * `recordNotFoundError` — `code: 'RECORD_NOT_FOUND'`, `status: 404`
 * (`packages/core/src/utils/record-not-found.ts`, #4435/#5138/#7867). The
 * stdio bridge minted its own bare `Error` for the identical miss, so a
 * stdio caller got a message with no machine-readable code and nothing that
 * maps to 404 — the same operation, two different envelopes depending on
 * which transport served it.
 *
 * Both by-id write seams are covered — `update()` and `remove()` — asserting
 * on `code` AND `status`, not merely that something threw: an assertion that
 * only checks for a thrown error would have passed against the bare `Error`
 * this card exists to remove.
 */

import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { recordNotFoundError } from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

/** An engine that resolves NO row for any id — every by-id write is a miss. */
function makeEmptyEngine() {
  return {
    find: vi.fn(async () => []),
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => 0),
    aggregate: vi.fn(async () => [{ n: 0 }]),
  };
}

/** An object definition with no exposure restriction, so the miss is what refuses. */
function makeMetadata() {
  return {
    listObjects: vi.fn(async () => [{ name: 'task', label: 'Task', fields: {} }]),
    getObject: vi.fn(async () => ({ name: 'task', label: 'Task', enable: { apiEnabled: true } })),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => true),
    getRegisteredTypes: vi.fn(async () => ['object']),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

const PRINCIPAL = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;

function makeBridge() {
  const engine = makeEmptyEngine();
  const metadataService = makeMetadata();
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: metadataService as unknown as IMetadataService,
    resolvePrincipal: async () => PRINCIPAL,
  });
  return { bridge, engine, metadataService };
}

/** A rejection's payload, narrowed once so callers never juggle `unknown`. */
type NotFoundEnvelope = Error & { code?: string; status?: number };

/**
 * The rejection `run` throws, typed — or `null` if it resolved. One explicit
 * cast, shared, rather than `.catch((e) => e)` at each call site: that idiom
 * infers the settled value as `unknown` here (TResult from an `any`-typed
 * catch parameter widens to `unknown`), which is a second, unrelated way to
 * fail `tsc` — this repo's TEST_DEBT ledger already carries 53 raw errors for
 * `packages/mcp` from the *other* half of that idiom (`await res.json()`),
 * and a fix for this card must not add a fourth without narrowing it.
 */
async function catchError(run: () => Promise<unknown>): Promise<NotFoundEnvelope | null> {
  return (await run().then(
    () => null,
    (e: unknown) => e,
  )) as NotFoundEnvelope | null;
}

/**
 * Assert a not-found refusal by its ENVELOPE, not by the fact that something
 * threw — a bare `Error` also satisfies `.toThrow()`, which is exactly the
 * defect this card removes.
 */
async function expectRecordNotFound(run: () => Promise<unknown>): Promise<void> {
  const err = await catchError(run);
  expect(err, 'the call resolved — no not-found refusal was raised').toBeTruthy();
  expect(err!.code).toBe('RECORD_NOT_FOUND');
  expect(err!.status).toBe(404);
}

describe('#8422 stdio bridge by-id writes throw the shared not-found envelope', () => {
  it('update() on a missing id throws RECORD_NOT_FOUND / 404', async () => {
    const { bridge, engine } = makeBridge();

    await expectRecordNotFound(() => bridge.update('task', 'ghost', { title: 'x' }));
    // Refused before the write dispatched — the same existence-before-mutation
    // property the HTTP path (`callData`) holds.
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('remove() on a missing id throws RECORD_NOT_FOUND / 404', async () => {
    const { bridge, engine } = makeBridge();

    await expectRecordNotFound(() => bridge.remove('task', 'ghost'));
    expect(engine.delete).not.toHaveBeenCalled();
  });

  it('both seams throw the SAME envelope shape — one declaration, not two', async () => {
    const { bridge } = makeBridge();

    const updateErr = await catchError(() => bridge.update('task', 'ghost', { title: 'x' }));
    const removeErr = await catchError(() => bridge.remove('task', 'ghost'));

    expect(updateErr?.code).toBe(removeErr?.code);
    expect(updateErr?.status).toBe(removeErr?.status);
    expect(updateErr?.code).toBe('RECORD_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// The tool door: `get_record` over the long-lived server stdio attaches
// ---------------------------------------------------------------------------

/**
 * One row, `secret1`, that only its owner reads: the engine double answers the
 * row to `owner` and nothing to anyone else, which is what the security
 * middleware's row filter does to a by-id read the caller may not see. So for
 * {@link PRINCIPAL} `secret1` is HIDDEN and `ghost` is MISSING, and the two
 * reach the bridge as the same empty read.
 */
function makeRowFilteringEngine() {
  const row = { id: 'secret1', title: 'owner only' };
  const visibleTo = (opts?: { context?: { userId?: string } }) => opts?.context?.userId === 'owner';
  return {
    find: vi.fn(async (_object: string, query?: { where?: { id?: unknown } }, opts?: { context?: { userId?: string } }) =>
      query?.where?.id === row.id && visibleTo(opts) ? [row] : []),
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => 0),
    aggregate: vi.fn(async () => [{ n: 0 }]),
  };
}

function stdioBridgeAs(principal: ExecutionContext) {
  const engine = makeRowFilteringEngine();
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: makeMetadata() as unknown as IMetadataService,
    resolvePrincipal: async () => principal,
  });
  return { bridge, engine };
}

/** A `tools/call` on the long-lived server (`runtime.server`, the one `start()` attaches stdio to). */
async function callOnLongLivedServer(bridge: McpDataBridge, name: string, args: Record<string, unknown>) {
  const runtime = new MCPServerRuntime({ name: 'pin', version: '0.0.0' });
  runtime.bridgeDataTools(bridge);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await runtime.server.connect(serverSide);
  const client = new Client({ name: 'pin', version: '0.0.0' });
  await client.connect(clientSide);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
}

/**
 * The HTTP `/mcp` door's answer to the same call: its bridge's `get` reaches
 * `protocol.getData` through `callData`, which throws `recordNotFoundError`
 * for an id that names no row the caller may read (pinned as the HTTP face's
 * answer in `mcp-coded-refusal.test.ts`). Driven through `handleHttpRequest`,
 * the real Streamable HTTP transport, so the two answers compared below come
 * from the two doors' own tool registrations.
 */
async function getRecordOverHttp(objectName: string, recordId: string) {
  const bridge: McpDataBridge = {
    async listObjects() { return [{ name: 'task', label: 'Task', fieldCount: 0 }]; },
    async describeObject() { return null; },
    async query(object) { return { object, records: [], total: 0 }; },
    async get(object, id) { throw recordNotFoundError(object, id); },
    async create(object, data) { return { object, id: 'n1', record: data }; },
    async update(object, id, data) { return { object, id, record: data }; },
    async remove(object, id) { return { object, id, success: true }; },
  };
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_record', arguments: { objectName, recordId } } };
  const res = await new MCPServerRuntime({ name: 'pin', version: '0.0.0' }).handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge, parsedBody: body },
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: unknown }).result;
}

/** The coded envelope `get_record` answers a miss with, as both doors put it on the wire. */
function notFoundWire(object: string, id: string) {
  return { error: { code: 'RECORD_NOT_FOUND', message: `Record ${id} not found in ${object}`, status: 404 } };
}

describe('stdio get_record answers a missing or hidden id with the coded RECORD_NOT_FOUND / 404', () => {
  it('a MISSING id: isError, and the text is the coded envelope, not a bare sentence', async () => {
    const { bridge } = stdioBridgeAs(PRINCIPAL);
    const result = (await callOnLongLivedServer(bridge, 'get_record', { objectName: 'task', recordId: 'ghost' })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toEqual(notFoundWire('task', 'ghost'));
  });

  it('a HIDDEN id answers the same envelope as a missing one: no existence oracle', async () => {
    const { bridge, engine } = stdioBridgeAs(PRINCIPAL);
    const hidden = (await callOnLongLivedServer(bridge, 'get_record', { objectName: 'task', recordId: 'secret1' })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(hidden.isError).toBe(true);
    expect(JSON.parse(hidden.content[0]!.text)).toEqual(notFoundWire('task', 'secret1'));
    // The read ran as the caller, so the row filter is what hid it.
    expect(engine.find).toHaveBeenCalledWith('task', expect.objectContaining({ where: { id: 'secret1' } }), { context: PRINCIPAL });
  });

  it('CONTROL: the hidden row is served to its owner, so the refusal above is the row filter, not a missing row', async () => {
    const { bridge } = stdioBridgeAs({ userId: 'owner', isSystem: false } as unknown as ExecutionContext);
    const served = (await callOnLongLivedServer(bridge, 'get_record', { objectName: 'task', recordId: 'secret1' })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(served.isError).toBeFalsy();
    expect(JSON.parse(served.content[0]!.text)).toEqual({ id: 'secret1', title: 'owner only' });
  });

  it('PARITY: the stdio answer equals the HTTP /mcp answer for the same call, byte for byte', async () => {
    for (const recordId of ['ghost', 'secret1']) {
      const { bridge } = stdioBridgeAs(PRINCIPAL);
      const overStdio = await callOnLongLivedServer(bridge, 'get_record', { objectName: 'task', recordId });
      const overHttp = await getRecordOverHttp('task', recordId);
      expect(overStdio, `get_record ${recordId}`).toEqual(overHttp);
    }
  });

  it('update_record and delete_record on the same ids answer the same coded envelope (already coded, held here)', async () => {
    for (const recordId of ['ghost', 'secret1']) {
      const { bridge } = stdioBridgeAs(PRINCIPAL);
      const updated = (await callOnLongLivedServer(bridge, 'update_record', {
        objectName: 'task',
        recordId,
        data: { title: 'x' },
      })) as { isError?: boolean; content: Array<{ text: string }> };
      expect(updated.isError).toBe(true);
      expect(JSON.parse(updated.content[0]!.text)).toEqual(notFoundWire('task', recordId));
      const deleted = (await callOnLongLivedServer(bridge, 'delete_record', {
        objectName: 'task',
        recordId,
        confirm: true,
      })) as { isError?: boolean; content: Array<{ text: string }> };
      expect(deleted.isError).toBe(true);
      expect(JSON.parse(deleted.content[0]!.text)).toEqual(notFoundWire('task', recordId));
    }
  });
});
