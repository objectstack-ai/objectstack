// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8266 — the ADR-0101 record RESOURCE honours the ADR-0049 exposure
 * declaration the `get_record` TOOL already honours.
 *
 * The defect: #8083 (PR #8265) gated the six object-CRUD verbs, which all flow
 * through `createStdioDataBridge`. The record resource does not use that bridge
 * — its reader is a separate closure built inline in `plugin.ts` that calls
 * `ql.find` directly and is handed to `bridgeResources`. So one object
 * declaring `enable.apiEnabled: false` was refused by `get_record` and STILL
 * READABLE at `objectstack://objects/{objectName}/records/{recordId}` — same
 * transport, same key, same declaration, two answers.
 *
 * **What leaks is the author's DECLARATION, not the data guard.** The gate is a
 * surface-area control by `api-exposure.ts`'s own ADR note; this read passed the
 * engine's CRUD/FLS/RLS through `ql.find` with the key's `ExecutionContext`
 * before this change and after it. Every case below asserts an EXPOSURE
 * verdict, never a data-authorization one.
 *
 * ## Why these tests drive both paths through ONE plugin boot
 *
 * The acceptance shape is a parity claim — "one declaration, both read paths,
 * same verdict" — and a parity claim is only worth what its two halves share.
 * Asserting the resource in isolation would go green on a build where the tool
 * had silently stopped gating too. So each case below boots the REAL
 * `MCPServerPlugin` once, against ONE fake metadata service holding ONE
 * declaration, and drives BOTH reads down a real `StdioServerTransport`:
 * `resources/read` on the record URI and `tools/call get_record`. The verdicts
 * are then asserted against each other, not against two hand-written literals.
 *
 * ## Why the ablation case is not optional
 *
 * The failure mode this file is most exposed to is a parity assertion that
 * passes because BOTH paths refuse for some unrelated reason (an unresolvable
 * principal, a metadata outage, a typo'd object name) — the gate could be
 * absent entirely and the file would stay green. So `the gate is what refuses`
 * below re-runs the identical boot with the identical fixture and the ONLY
 * difference being the declaration, and requires both paths to SERVE the row.
 * A refusal that does not move when the declaration moves is not this gate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IMetadataService } from '@objectstack/spec/contracts';

import type { MCPServerRuntime } from './mcp-server-runtime.js';
import { MCPServerPlugin } from './plugin.js';
import { enforceApiExposure, GATED_ACTIONS, type McpExposureError } from './stdio-data-bridge.js';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

// ---------------------------------------------------------------------------
// A real stdio client: newline-delimited JSON-RPC over the transport's pipes
// ---------------------------------------------------------------------------

interface JsonRpcFrame {
  jsonrpc: string;
  id?: number;
  result?: any;
  error?: { code: number; message: string };
}

interface StdioSession {
  rpc(method: string, params?: unknown): Promise<JsonRpcFrame>;
  notify(method: string, params?: unknown): void;
  close(): Promise<void>;
}

/**
 * Attach a real `StdioServerTransport` to `server` and talk JSON-RPC to it —
 * the same harness shape `mcp-stdio-tools.test.ts` uses, and for the same
 * reason: the resource surface and the tool surface are only comparable on the
 * wire a desktop MCP host actually speaks. Fed `PassThrough` pipes instead of
 * `process.stdin`/`stdout` so the frames are readable without spawning.
 */
async function openStdio(server: McpServer): Promise<StdioSession> {
  const serverStdin = new PassThrough();
  const serverStdout = new PassThrough();
  const transport = new StdioServerTransport(serverStdin, serverStdout);
  await server.connect(transport);

  let nextId = 1;
  let buffered = '';
  const waiting = new Map<number, (frame: JsonRpcFrame) => void>();

  serverStdout.on('data', (chunk: Buffer | string) => {
    buffered += String(chunk);
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      if (!line) continue;
      let frame: JsonRpcFrame;
      try {
        frame = JSON.parse(line) as JsonRpcFrame;
      } catch {
        continue; // a host printing to stdout — not a frame (see #7915)
      }
      const resolve = typeof frame.id === 'number' ? waiting.get(frame.id) : undefined;
      if (resolve && typeof frame.id === 'number') {
        waiting.delete(frame.id);
        resolve(frame);
      }
    }
  });

  return {
    rpc(method, params) {
      const id = nextId++;
      return new Promise<JsonRpcFrame>((resolve, reject) => {
        const giveUp = setTimeout(
          () => reject(new Error(`stdio: no answer to "${method}" (id ${id}) within 5s`)),
          5_000,
        );
        waiting.set(id, (frame) => {
          clearTimeout(giveUp);
          resolve(frame);
        });
        serverStdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`,
        );
      });
    },
    notify(method, params) {
      serverStdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`);
    },
    async close() {
      await transport.close().catch(() => {});
    },
  };
}

async function handshake(session: StdioSession): Promise<void> {
  await session.rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'record-resource-exposure-pin', version: '0.0.0' },
  });
  session.notify('notifications/initialized');
}

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

const RECORD_URI = 'objectstack://objects/task/records/t1';

/**
 * The `objectql` service, faked at the one seam the plugin uses: `find`.
 * `sys_api_key` resolves the stdio principal through the REAL
 * `resolveAuthzContext` chain; `task` is the row both read paths are after.
 */
function fakeObjectQL() {
  return {
    find: vi.fn(async (object: string, _query?: unknown, _options?: unknown) => {
      if (object === 'sys_api_key') return [{ id: 'k1', user_id: 'usr_stdio', revoked: false }];
      if (object === 'task') return [{ id: 't1', title: 'the row behind the declaration' }];
      return [];
    }),
    insert: vi.fn(async () => ({ id: 'new1' })),
    update: vi.fn(async (_o: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      return {};
    }),
    delete: vi.fn(async (_o: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return true;
    }),
    aggregate: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    findOne: vi.fn(async () => null),
  };
}

/** A metadata service serving ONE object definition — the single declaration under test. */
function fakeMetadata(def: unknown) {
  return {
    listObjects: vi.fn(async () => [{ name: 'task', label: 'Task', fields: { title: {} } }]),
    getObject: vi.fn(async (name: string) => (name === 'task' ? def : null)),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => true),
    getRegisteredTypes: vi.fn(async () => ['object']),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

function mockContext(services: Record<string, unknown>) {
  const registry = new Map<string, unknown>(Object.entries(services));
  return {
    registerService: vi.fn((name: string, service: unknown) => registry.set(name, service)),
    getService: vi.fn((name: string) => {
      if (!registry.has(name)) throw new Error(`Service "${name}" not found`);
      return registry.get(name);
    }),
    replaceService: vi.fn(),
    getServices: vi.fn(() => registry),
    hook: vi.fn(),
    trigger: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(() => ({})),
  };
}

/**
 * One read path's answer, normalized to the same shape for both surfaces.
 *
 * The two surfaces serialize a refusal differently and neither is this card's
 * to change: the resource wraps it as a JSON `{ error }` body (its `catch` in
 * `bridgeResources`), the tool answers `isError: true` with the bare message as
 * text (`errorResult(messageOf(err))`). Normalizing here is what lets the cases
 * below compare VERDICTS rather than two serialization accidents.
 */
interface PathAnswer {
  /** The refusal message, or `undefined` when the path served a row. */
  error?: string;
  /** The row, or `undefined` when the path refused. */
  record?: any;
}

interface BothPaths {
  /** What `resources/read` on the record URI answered. */
  resource: PathAnswer;
  /** What `tools/call get_record` answered. */
  tool: PathAnswer;
  /** Every `ql.find` call that asked for ROW data (the principal reads are excluded). */
  rowReads: any[][];
}

/**
 * The `ExecutionContext` a `ql.find` call carried.
 *
 * Read from EITHER argument position on purpose. The two read paths assemble
 * the call differently today — the bridge sends `find(obj, query, { context })`
 * and the plugin's inline reader sends `find(obj, { where, limit, context })` —
 * so a helper that knew only one position would silently report "no principal"
 * for the other path and turn an ADR-0101 assertion into a no-op.
 */
function contextOf(call: any[]): any {
  return call[2]?.context ?? call[1]?.context;
}

/**
 * Boot the real plugin against ONE declaration and drive BOTH read paths.
 *
 * Only the transport attach is stubbed — `start()` would claim this test
 * process's real stdin/stdout. Everything this card is about (building the
 * reader, gating it, registering the resource) runs for real.
 */
async function readBothPaths(def: unknown): Promise<BothPaths> {
  const ql = fakeObjectQL();
  const ctx = mockContext({ metadata: fakeMetadata(def), objectql: ql });

  const plugin = new MCPServerPlugin({ autoStart: true });
  await plugin.init(ctx as any);
  const runtime = (ctx.registerService as any).mock.calls.find(
    (c: any[]) => c[0] === 'mcp',
  )[1] as MCPServerRuntime;
  vi.spyOn(runtime, 'start').mockResolvedValue(undefined);
  await plugin.start(ctx as any);

  const session = await openStdio(runtime.server);
  try {
    await handshake(session);

    const resourceFrame = await session.rpc('resources/read', { uri: RECORD_URI });
    expect(resourceFrame.error, 'resources/read failed at the protocol level').toBeUndefined();
    const resourceBody = JSON.parse(resourceFrame.result.contents[0].text);
    const resource: PathAnswer =
      typeof resourceBody?.error === 'string'
        ? { error: resourceBody.error }
        : { record: resourceBody };

    const toolFrame = await session.rpc('tools/call', {
      name: 'get_record',
      arguments: { objectName: 'task', recordId: 't1' },
    });
    expect(toolFrame.error, 'tools/call failed at the protocol level').toBeUndefined();
    const toolText = toolFrame.result.content[0].text as string;
    const tool: PathAnswer = toolFrame.result.isError
      ? { error: toolText }
      : { record: JSON.parse(toolText) };

    return {
      resource,
      tool,
      rowReads: ql.find.mock.calls.filter((c: any[]) => c[0] === 'task'),
    };
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// The parity claim
// ---------------------------------------------------------------------------

describe('#8266 one declaration, both read paths, same verdict', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OS_MCP_SERVER_TRANSPORT;
    delete process.env.OS_MCP_STDIO_ENABLED;
    process.env.OS_MCP_STDIO_API_KEY = 'osk_record_resource_pin';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('refuses the record RESOURCE when apiEnabled is false, exactly as the tool does', async () => {
    const both = await readBothPaths({ name: 'task', enable: { apiEnabled: false } });

    // The half this card exists to fix. Before the change this read returned
    // the row — the whole defect in one assertion. The ROW is asserted first
    // on purpose: when this regresses, the leaked row is the value the failure
    // prints, rather than "expected string, got undefined" pointing at the
    // absent refusal.
    expect(
      both.resource.record,
      'the record resource SERVED a row for an object declaring apiEnabled: false',
    ).toBeUndefined();
    expect(both.resource.error).toMatch(/not exposed via the API/i);

    // The half #8083 already fixed, re-read here so the claim is a COMPARISON
    // rather than two independent literals.
    expect(both.tool.error).toMatch(/not exposed via the API/i);
    expect(both.tool.record).toBeUndefined();

    // Same verdict, not merely both-unhappy: the two surfaces answer the SAME
    // sentence because they take the same decision from the same helper.
    expect(both.resource.error).toBe(both.tool.error);

    // Refused BEFORE dispatch — the engine was never asked for the row, by
    // either path. A gate that refused after reading would still have read.
    expect(both.rowReads).toHaveLength(0);
  });

  it('the gate is what refuses — the ABLATION', async () => {
    // Identical boot, identical fixture, identical reads. The ONLY difference
    // is the declaration. If this case did not serve both rows, every refusal
    // above would be evidence of nothing: a parity that holds because both
    // paths break for an unrelated reason is the failure mode this card's
    // acceptance explicitly names.
    const both = await readBothPaths({ name: 'task', enable: { apiEnabled: true } });

    expect(both.resource.error).toBeUndefined();
    expect(both.resource.record.id).toBe('t1');
    expect(both.resource.record.title).toBe('the row behind the declaration');

    expect(both.tool.error).toBeUndefined();
    expect(both.tool.record.id).toBe('t1');

    // Both paths really did reach the engine — the reachability half of the
    // ablation, and the thing that was true of the RESOURCE in the pre-change
    // state for `apiEnabled: false` too.
    expect(both.rowReads).toHaveLength(2);
    // Still under the key's identity: this gate is surface area, and the
    // ADR-0101 principal binding is untouched by it.
    for (const call of both.rowReads) {
      expect(contextOf(call).userId).toBe('usr_stdio');
      expect(contextOf(call).isSystem).toBe(false);
    }
  });

  it('refuses the record resource when the whitelist excludes `get`', async () => {
    // Not a second spelling of the case above: `apiEnabled: false` is one
    // branch of the helper and the `apiMethods` whitelist is another. A reader
    // gated on a MIS-SPELLED action word (`'read'`, say) would still pass the
    // first case — `apiEnabled: false` refuses before the action is consulted
    // — and only fails here, where the action word decides.
    const both = await readBothPaths({ name: 'task', enable: { apiMethods: ['list'] } });

    expect(
      both.resource.record,
      'the record resource SERVED a row for an object whose whitelist excludes `get`',
    ).toBeUndefined();
    expect(both.resource.error).toMatch(/not allowed on object/i);
    expect(both.resource.error).toContain('get');

    expect(both.tool.record).toBeUndefined();
    expect(both.resource.error).toBe(both.tool.error);
    expect(both.rowReads).toHaveLength(0);
  });

  it('serves the record resource when the whitelist includes `get`', async () => {
    // The whitelist branch's own ablation — the same declaration axis moved
    // one notch, so the refusal above is attributable to `get` being absent
    // rather than to any whitelist at all being present.
    const both = await readBothPaths({ name: 'task', enable: { apiMethods: ['get'] } });

    expect(both.resource.error).toBeUndefined();
    expect(both.resource.record.id).toBe('t1');
    expect(both.tool.record.id).toBe('t1');
    expect(both.rowReads).toHaveLength(2);
  });

  it('leaves the record resource ungated when the object declares nothing', async () => {
    // The overwhelmingly common case, pinned so the gate cannot regress into
    // refusing by default: an object with no exposure declaration at all is
    // unrestricted, on this path as on every other.
    const both = await readBothPaths({ name: 'task', label: 'Task' });

    expect(both.resource.record.id).toBe('t1');
    expect(both.tool.record.id).toBe('t1');
  });
});

// ---------------------------------------------------------------------------
// The envelope — asserted where it is observable
// ---------------------------------------------------------------------------

describe('#8266 the refusal carries the ADR-0112 envelope', () => {
  /**
   * The wire assertions above can only read `.message`: BOTH the resource
   * serializer (`bridgeResources`' `catch`) and the `get_record` tool
   * (`errorResult(messageOf(err))`) forward the message alone. That is
   * pre-existing on both surfaces and is not this card's to change — so the
   * envelope is asserted here, at the seam that actually carries it, rather
   * than left unasserted or faked into a wire test that cannot see it.
   */
  async function refusalFor(def: unknown, action: string): Promise<McpExposureError> {
    const metadataService = fakeMetadata(def) as unknown as IMetadataService;
    const context = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;
    const err = (await enforceApiExposure(metadataService, 'task', action, context).then(
      () => null,
      (e: unknown) => e,
    )) as McpExposureError | null;
    expect(err, 'the gate allowed — no exposure refusal was raised').toBeTruthy();
    return err!;
  }

  it('answers OBJECT_API_DISABLED / 404 for a hidden object', async () => {
    const err = await refusalFor({ name: 'task', enable: { apiEnabled: false } }, GATED_ACTIONS.get);
    expect(err.code).toBe('OBJECT_API_DISABLED');
    expect(err.status).toBe(404);
  });

  it('answers OBJECT_API_METHOD_NOT_ALLOWED / 405 with the effective set', async () => {
    const err = await refusalFor({ name: 'task', enable: { apiMethods: ['list'] } }, GATED_ACTIONS.get);
    expect(err.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    expect(err.status).toBe(405);
    expect(err.allowedOperations).toContain('list');
    expect(err.allowedOperations).not.toContain('get');
  });

  it('gates the record resource under the same action word the tool gates `bridge.get` under', () => {
    // The resource reader and the bridge's `get` verb must not drift apart on
    // the action word — that is the whole seam this card closes. Pinned as
    // data rather than prose: `plugin.ts` passes `GATED_ACTIONS.get`.
    expect(GATED_ACTIONS.get).toBe('get');
  });
});
