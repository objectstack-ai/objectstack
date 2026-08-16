// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8034 — the stdio transport must SERVE the tools it advertises.
 *
 * The defect: `initialize` over stdio answered `capabilities.tools: {}` while
 * `tools/list` and every `tools/call` answered `-32601 Method not found`. In
 * the same process, with the same key, HTTP returned the full tool set — so
 * neither the bridge nor the principal was at fault. The object/action tools
 * were registered ONLY inside `handleHttpRequest()`, on its throwaway
 * per-request server; the long-lived server behind stdio got whatever the AI
 * service's function-calling `ToolRegistry` held, which on an app that
 * registers no AI tools is nothing.
 *
 * WHY THESE TESTS DRIVE A REAL `StdioServerTransport`. The 17 pins that were
 * green through the whole outage exercised `handleHttpRequest` and
 * `bridgeTools` separately, and neither can see a transport serving a
 * different surface from the other. Every case below speaks newline-delimited
 * JSON-RPC down a real `StdioServerTransport` attached to the real long-lived
 * server — the wire a desktop MCP host actually uses, and the exact shape of
 * the card's repro. The transport is fed `PassThrough` pipes instead of
 * `process.stdin`/`stdout` (its constructor takes both) so the frames are
 * readable without spawning a process; `MCPServerRuntime.start()` attaches
 * this same class to the same `this.mcpServer`.
 *
 * WHY THE CAPABILITY PIN COMPARES TWO LIVE READS. Asserting "advertises tools"
 * and "lists 9 tools" as two literals is what the old pins effectively did, and
 * both halves stayed true of a server that served neither. `capability surface
 * agreement` below reads the advertised set out of `initialize` and the served
 * set out of the list methods on the SAME connection, and asserts them against
 * each other in BOTH directions — so it goes red on an advertisement without a
 * handler AND on a handler without an advertisement, whichever way a future
 * change breaks it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import { MCPServerPlugin } from './plugin.js';
import type { McpDataBridge } from './mcp-http-tools.js';
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

/** Attach a real `StdioServerTransport` to `server` and talk JSON-RPC to it. */
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
        // Not a frame (a host that prints to stdout — see the banner note in
        // #7915). Skipped rather than failed: this file pins the MCP surface,
        // and a strict parse here would turn someone else's noise into a red
        // build for a defect it says nothing about.
        continue;
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
      serverStdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`,
      );
    },
    async close() {
      await transport.close().catch(() => {});
    },
  };
}

const INITIALIZE_PARAMS = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'stdio-pin', version: '0.0.0' },
};

/** `initialize` + `notifications/initialized`, as a real client does. */
async function handshake(session: StdioSession): Promise<JsonRpcFrame> {
  const init = await session.rpc('initialize', INITIALIZE_PARAMS);
  session.notify('notifications/initialized');
  return init;
}

// ---------------------------------------------------------------------------
// Bridge double — records every call so delegation can be asserted
// ---------------------------------------------------------------------------

function makeBridge(): McpDataBridge & { calls: any[][] } {
  const calls: any[][] = [];
  return {
    calls,
    async listObjects() {
      calls.push(['listObjects']);
      return [
        { name: 'task', label: 'Task', fieldCount: 2 },
        { name: 'sys_user', label: 'User', fieldCount: 9 },
      ];
    },
    async describeObject(name: string) {
      calls.push(['describeObject', name]);
      return name === 'task' ? { name: 'task', fields: [{ name: 'title', type: 'text' }] } : null;
    },
    async query(object: string, opts: any) {
      calls.push(['query', object, opts]);
      return { object, records: [{ id: 't1', title: 'from the stdio transport' }], total: 1 };
    },
    async get(object: string, id: string) {
      calls.push(['get', object, id]);
      return { id, title: 'a' };
    },
    async create(object: string, data: any) {
      calls.push(['create', object, data]);
      return { object, id: 'new1', record: data };
    },
    async update(object: string, id: string, data: any) {
      calls.push(['update', object, id, data]);
      return { object, id, record: data };
    },
    async remove(object: string, id: string) {
      calls.push(['remove', object, id]);
      return { object, id, success: true };
    },
  };
}

/** The object-CRUD surface a bridge without the optional seams yields. */
const OBJECT_TOOLS = [
  'create_record',
  'delete_record',
  'describe_object',
  'get_record',
  'list_objects',
  'query_records',
  'update_record',
  'validate_expression',
].sort();

describe('#8034 stdio transport: tools/list', () => {
  let sessions: StdioSession[];

  beforeEach(() => {
    sessions = [];
  });

  afterEach(async () => {
    for (const session of sessions) await session.close();
  });

  async function connect(runtime: MCPServerRuntime): Promise<StdioSession> {
    const session = await openStdio(runtime.server);
    sessions.push(session);
    return session;
  }

  it('answers tools/list with the object tool NAMES, not -32601', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    runtime.bridgeDataTools(makeBridge());

    const session = await connect(runtime);
    await handshake(session);

    const listed = await session.rpc('tools/list');

    // The reported symptom, stated as the failure message so a regression
    // reads as itself rather than as "undefined is not an object".
    expect(
      listed.error,
      `tools/list answered an error over stdio (#8034 was ${JSON.stringify(listed.error)})`,
    ).toBeUndefined();

    const names = (listed.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(OBJECT_TOOLS);
    expect(names.length).toBeGreaterThan(0);
  });

  it('registers the action tools too when the bridge carries that seam', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    runtime.bridgeDataTools({
      ...makeBridge(),
      async listActions() {
        return [{ name: 'complete_task', objectName: 'task' }];
      },
      async runAction() {
        return { ok: true };
      },
    });

    const session = await connect(runtime);
    await handshake(session);
    const listed = await session.rpc('tools/list');
    const names = (listed.result.tools as Array<{ name: string }>).map((t) => t.name);

    expect(names).toContain('list_actions');
    expect(names).toContain('run_action');
  });

  it('serves NO tools and advertises none when no bridge was given', async () => {
    // The honest end of the same contract: a host with no principal to bind
    // registers nothing, so the capability is absent rather than advertised
    // over an empty surface. Before #8034 this server advertised `tools` here.
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });

    const session = await connect(runtime);
    const init = await handshake(session);

    expect(init.result.capabilities.tools).toBeUndefined();
    const listed = await session.rpc('tools/list');
    expect(listed.result).toBeUndefined();
    expect(listed.error).toBeDefined();
  });
});

describe('#8034 stdio transport: capability ↔ served surface agreement', () => {
  /** Every MCP primitive this server can carry, and how a client asks for it. */
  const LIST_METHOD: Record<string, string> = {
    tools: 'tools/list',
    resources: 'resources/list',
    prompts: 'prompts/list',
  };

  function metadataDouble() {
    return {
      listObjects: vi.fn(async () => [{ name: 'task', label: 'Task', fields: { title: {} } }]),
      getObject: vi.fn(async () => null),
      get: vi.fn(async () => null),
      list: vi.fn(async () => []),
      exists: vi.fn(async () => false),
      getRegisteredTypes: vi.fn(async () => ['object']),
      register: vi.fn(),
      unregister: vi.fn(),
    };
  }

  /**
   * Read both sides off ONE live connection and reconcile them.
   *
   * Neither side is written down here: the advertised set comes from the
   * server's own `initialize` result, the served set from whether each list
   * method answers or raises. That is the whole point — two literals would
   * agree with each other while agreeing with nothing the server does.
   */
  async function reconcile(runtime: MCPServerRuntime) {
    const session = await openStdio(runtime.server);
    try {
      const init = await handshake(session);
      const advertised = new Set(Object.keys((init.result.capabilities ?? {}) as object));
      const served = new Set<string>();
      for (const [capability, method] of Object.entries(LIST_METHOD)) {
        const answer = await session.rpc(method);
        if (!answer.error) served.add(capability);
      }
      return { advertised, served };
    } finally {
      await session.close();
    }
  }

  it('advertises exactly the primitives it serves — bridged server', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    const metadataService = metadataDouble();
    runtime.bridgeResources(metadataService as any);
    await runtime.bridgePrompts(metadataService as any);
    runtime.bridgeDataTools(makeBridge());

    const { advertised, served } = await reconcile(runtime);

    // A primitive is advertised if and only if its method answers.
    for (const capability of Object.keys(LIST_METHOD)) {
      expect(
        advertised.has(capability),
        `capabilities.${capability} advertised=${advertised.has(capability)} but ${LIST_METHOD[capability]} served=${served.has(capability)}`,
      ).toBe(served.has(capability));
    }
    // …and this assembly really does serve all three, so the agreement above
    // is not the vacuous "nothing advertised, nothing served".
    expect([...served].sort()).toEqual(['prompts', 'resources', 'tools']);
  });

  it('advertises exactly the primitives it serves — bare server', async () => {
    // The direction that used to fail: nothing bridged at all. Every
    // capability the constructor once hand-declared was unserved here.
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });

    const { advertised, served } = await reconcile(runtime);

    for (const capability of Object.keys(LIST_METHOD)) {
      expect(
        advertised.has(capability),
        `capabilities.${capability} advertised=${advertised.has(capability)} but ${LIST_METHOD[capability]} served=${served.has(capability)}`,
      ).toBe(served.has(capability));
    }
    expect([...served]).toEqual([]);
  });
});

describe('#8034 transport parity: one bridge, one tool surface', () => {
  async function stdioToolNames(bridge: McpDataBridge): Promise<string[]> {
    const runtime = new MCPServerRuntime({ name: 'parity', version: '1.0.0' });
    runtime.bridgeDataTools(bridge);
    const session = await openStdio(runtime.server);
    try {
      await handshake(session);
      const listed = await session.rpc('tools/list');
      expect(listed.error).toBeUndefined();
      return (listed.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
    } finally {
      await session.close();
    }
  }

  async function httpToolNames(bridge: McpDataBridge): Promise<string[]> {
    const runtime = new MCPServerRuntime({ name: 'parity', version: '1.0.0' });
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const res = await runtime.handleHttpRequest(
      new Request('http://localhost/api/v1/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      }),
      { bridge, parsedBody: body },
    );
    const json: any = await res.json();
    expect(json.error).toBeUndefined();
    return (json.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
  }

  it('exposes the SAME tool names on stdio and over HTTP for the same bridge', async () => {
    // The gate the card asks for. Divergence — not absence — was the bug: HTTP
    // served 11 tools while stdio served none, and no pin compared the two.
    const bridge = makeBridge();
    const overStdio = await stdioToolNames(bridge);
    const overHttp = await httpToolNames(bridge);

    expect(overStdio).toEqual(overHttp);
    expect(overStdio.length).toBeGreaterThan(0);
  });

  it('stays in agreement when the bridge grows an optional seam', async () => {
    // `aggregate` is registered by capability, so a bridge that has it must
    // gain the tool on BOTH transports or neither.
    const bridge: McpDataBridge = {
      ...makeBridge(),
      async aggregate() {
        return [{ status: 'open', n: 1 }];
      },
    };
    const overStdio = await stdioToolNames(bridge);
    const overHttp = await httpToolNames(bridge);

    expect(overStdio).toContain('aggregate_records');
    expect(overStdio).toEqual(overHttp);
  });
});

describe('#8034 stdio transport: a tool actually runs', () => {
  it('tools/call reaches the bridge and returns its result over the wire', async () => {
    // `tools/list` answering while every call fails would be the same defect
    // one layer down, so the invocation is driven end to end on the same wire.
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    const bridge = makeBridge();
    runtime.bridgeDataTools(bridge);

    const session = await openStdio(runtime.server);
    try {
      await handshake(session);
      const called = await session.rpc('tools/call', {
        name: 'query_records',
        arguments: { objectName: 'task', where: { status: 'open' }, limit: 5 },
      });

      expect(called.error).toBeUndefined();
      expect(called.result.isError).toBeFalsy();
      const payload = JSON.parse(called.result.content[0].text);
      expect(payload.records[0].title).toBe('from the stdio transport');

      const queryCall = bridge.calls.find((c) => c[0] === 'query');
      expect(queryCall?.[1]).toBe('task');
      expect(queryCall?.[2].where).toEqual({ status: 'open' });
    } finally {
      await session.close();
    }
  });

  it('keeps the fail-closed system-object guard on this transport', async () => {
    // The guard lives in the tool, not the transport — pinned here because
    // stdio now reaches those tools for the first time.
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    const bridge = makeBridge();
    runtime.bridgeDataTools(bridge);

    const session = await openStdio(runtime.server);
    try {
      await handshake(session);
      const called = await session.rpc('tools/call', {
        name: 'describe_object',
        arguments: { objectName: 'sys_user' },
      });

      expect(called.result.isError).toBe(true);
      expect(called.result.content[0].text).toMatch(/system object/i);
      expect(bridge.calls.find((c) => c[0] === 'describeObject')).toBeUndefined();
    } finally {
      await session.close();
    }
  });
});

describe('#8034 plugin composition: os serve stdio wiring', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OS_MCP_SERVER_TRANSPORT;
    delete process.env.OS_MCP_STDIO_ENABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  /**
   * The `objectql` service, faked at the ONE seam the plugin uses: `find`.
   * `sys_api_key` resolves the stdio principal through the real
   * `resolveAuthzContext` chain (a row with a `user_id` is all it needs); every
   * other object is the data the tools read.
   */
  function fakeObjectQL() {
    return {
      find: vi.fn(async (object: string, _query?: unknown, _options?: unknown) => {
        if (object === 'sys_api_key') return [{ id: 'k1', user_id: 'usr_stdio', revoked: false }];
        if (object === 'task') return [{ id: 't1', title: 'wired through the plugin' }];
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

  function fakeMetadata() {
    return {
      listObjects: vi.fn(async () => [{ name: 'task', label: 'Task', fields: { title: {} } }]),
      getObject: vi.fn(async () => null),
      get: vi.fn(async () => null),
      list: vi.fn(async () => []),
      exists: vi.fn(async () => false),
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

  it('registers the tools on the long-lived server and runs one under the key identity', async () => {
    process.env.OS_MCP_STDIO_API_KEY = 'osk_stdio_pin';
    const ql = fakeObjectQL();
    const ctx = mockContext({ metadata: fakeMetadata(), objectql: ql });

    const plugin = new MCPServerPlugin({ autoStart: true });
    await plugin.init(ctx as any);
    const runtime = (ctx.registerService as any).mock.calls.find(
      (c: any[]) => c[0] === 'mcp',
    )[1] as MCPServerRuntime;

    // Only the transport attach is stubbed: `start()` would claim this test
    // process's real stdin/stdout. Everything the card is about — building the
    // bridge and registering the tools — runs for real, and the assertions
    // below speak to the same server `start()` would have connected.
    const start = vi.spyOn(runtime, 'start').mockResolvedValue(undefined);
    await plugin.start(ctx as any);
    expect(start).toHaveBeenCalled();

    const session = await openStdio(runtime.server);
    try {
      const init = await handshake(session);
      expect(init.result.capabilities.tools).toBeDefined();

      const listed = await session.rpc('tools/list');
      expect(listed.error).toBeUndefined();
      const names = (listed.result.tools as Array<{ name: string }>).map((t) => t.name);
      expect(names).toContain('query_records');
      expect(names).toContain('list_objects');

      const called = await session.rpc('tools/call', {
        name: 'query_records',
        arguments: { objectName: 'task' },
      });
      expect(called.result.isError).toBeFalsy();
      const payload = JSON.parse(called.result.content[0].text);
      expect(payload.records[0].title).toBe('wired through the plugin');

      // The read ran AS the key's identity — the ADR-0101 property the record
      // resource already had, now covering the tool surface as well.
      const dataRead = ql.find.mock.calls.find((c: any[]) => c[0] === 'task');
      expect(dataRead).toBeDefined();
      expect((dataRead as any[])[2].context.userId).toBe('usr_stdio');
      expect((dataRead as any[])[2].context.isSystem).toBe(false);
    } finally {
      await session.close();
    }
  });

  it('bridges no tools — and advertises none — without a metadata service', async () => {
    process.env.OS_MCP_STDIO_API_KEY = 'osk_stdio_pin';
    const ctx = mockContext({ objectql: fakeObjectQL() });

    const plugin = new MCPServerPlugin({ autoStart: true });
    await plugin.init(ctx as any);
    const runtime = (ctx.registerService as any).mock.calls.find(
      (c: any[]) => c[0] === 'mcp',
    )[1] as MCPServerRuntime;
    vi.spyOn(runtime, 'start').mockResolvedValue(undefined);
    await plugin.start(ctx as any);

    // Loud, once, naming the remedy — never a silent empty surface.
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('stdio transport starting WITHOUT object tools'),
    );

    const session = await openStdio(runtime.server);
    try {
      const init = await handshake(session);
      expect(init.result.capabilities.tools).toBeUndefined();
    } finally {
      await session.close();
    }
  });
});
