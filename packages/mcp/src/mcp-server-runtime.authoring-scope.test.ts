// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26464] The host-injected authoring family over Streamable HTTP, behind the
 * `metadata:write` OAuth scope.
 *
 * What is pinned, and why each half matters as a security boundary:
 *
 *  1. The GATE. A `data:write` token, an `actions:execute` token, an empty
 *     grant and the undefined grant of an API key or a session can neither
 *     list nor call an authoring tool, and the registry is never touched. The
 *     refusal is the one the native families already use — the tool is not
 *     registered, so the SDK answers `tools/call` as an unknown tool — pinned
 *     here as the SAME JSON-RPC error code `create_record` gets without
 *     `data:write`, so the two families cannot drift into two dialects.
 *  2. The PROVENANCE. Every call that does reach the registry carries
 *     `door: 'mcp'`, the host's token principal and the host's environment in
 *     its tool context, and `actor.id` is the principal's user. A request that
 *     spoofs every plausible provenance header changes nothing a tool sees:
 *     the context is built from `handleHttpRequest`'s inputs alone.
 *  3. PARITY. The native tool surface is byte-identical with and without an
 *     injected registry when the scope is absent, and the long-lived stdio
 *     bridge (`bridgeTools`) still calls its registry with ONE argument — the
 *     shared registration body gained a seam, not a behaviour change.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_ACTIONS,
  MCP_OAUTH_SCOPE_METADATA_WRITE,
} from '@objectstack/spec/ai';
import type { AIToolDefinition, ToolCallPart } from '@objectstack/spec/contracts';

import { MCPServerRuntime, registerAuthoringTools } from './mcp-server-runtime.js';
import { grantsAuthoringTools } from './mcp-http-tools.js';
import type { McpActionBridge, McpDataBridge } from './mcp-http-tools.js';
import { MCP_TOOL_DOOR } from './types.js';
import type {
  McpAuthoringToolContext,
  McpAuthoringToolRegistry,
  McpTokenPrincipal,
  ToolExecutionResult,
  ToolRegistry,
} from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const READ_TOOLS = ['list_objects', 'describe_object', 'validate_expression', 'query_records', 'get_record', 'aggregate_records'];
const WRITE_TOOLS = ['create_record', 'update_record', 'delete_record'];
const ACTION_TOOLS = ['list_actions', 'run_action'];
const NATIVE_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS, ...ACTION_TOOLS].sort();

/** The shape a host injects: names the host chose, none of them native. */
const AUTHORING_TOOLS: AIToolDefinition[] = [
  {
    name: 'create_object',
    description: 'Create a draft object in this environment.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'verify_build',
    description: 'Validate the current drafts and report what the build refuses.',
    parameters: { type: 'object', properties: {} },
  },
];
const AUTHORING_NAMES = AUTHORING_TOOLS.map((t) => t.name).sort();

const PRINCIPAL: McpTokenPrincipal = {
  userId: 'usr_dev_1',
  organizationId: 'org_acme',
  clientId: 'claude-code',
  scopes: [MCP_OAUTH_SCOPE_METADATA_WRITE],
};
const ENVIRONMENT_ID = 'env_hosted_7';

interface RecordedCall {
  toolCall: ToolCallPart;
  context: McpAuthoringToolContext;
}

interface RecordingAuthoringRegistry extends McpAuthoringToolRegistry {
  calls: RecordedCall[];
  /** How many arguments `execute` received on each call. */
  arities: number[];
}

function makeAuthoringRegistry(
  tools: AIToolDefinition[] = AUTHORING_TOOLS,
  behaviour: 'ok' | 'isError' | 'throw' = 'ok',
): RecordingAuthoringRegistry {
  const calls: RecordedCall[] = [];
  const arities: number[] = [];
  return {
    calls,
    arities,
    getAll: () => tools,
    async execute(toolCall: ToolCallPart, context: McpAuthoringToolContext): Promise<ToolExecutionResult> {
      // eslint-disable-next-line prefer-rest-params
      arities.push(arguments.length);
      calls.push({ toolCall, context });
      if (behaviour === 'throw') throw new Error(`refused: ${toolCall.toolName}`);
      return {
        type: 'tool-result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: { type: 'text', value: `authored ${toolCall.toolName}` },
        ...(behaviour === 'isError' ? { isError: true } : {}),
      } as ToolExecutionResult;
    },
  };
}

function makeBridge(): McpDataBridge & McpActionBridge & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    async listObjects() { calls.push(['listObjects']); return [{ name: 'task', label: 'Task' }]; },
    async describeObject(name: string) { calls.push(['describeObject', name]); return { name }; },
    async query(object: string, opts: any) { calls.push(['query', object, opts]); return { object, records: [] }; },
    async get(object: string, id: string) { calls.push(['get', object, id]); return { id }; },
    async aggregate(object: string, opts: any) { calls.push(['aggregate', object, opts]); return []; },
    async create(object: string, data: any) { calls.push(['create', object, data]); return { object, id: 'n1' }; },
    async update(object: string, id: string, data: any) { calls.push(['update', object, id, data]); return { object, id }; },
    async remove(object: string, id: string) { calls.push(['remove', object, id]); return { object, id, success: true }; },
    async listActions() { calls.push(['listActions']); return [{ name: 'complete_task', objectName: 'task' }]; },
    async runAction(name: string, input: any) { calls.push(['runAction', name, input]); return { ok: true }; },
  };
}

interface CallOptions {
  grantedScopes?: string[];
  registry?: McpAuthoringToolRegistry;
  headers?: Record<string, string>;
  /** Omit the data bridge entirely (authoring-only host). */
  noBridge?: boolean;
}

async function call(runtime: MCPServerRuntime, bridge: any, body: unknown, o: CallOptions = {}) {
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(o.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, {
    ...(o.noBridge ? {} : { bridge }),
    parsedBody: body,
    ...(o.grantedScopes ? { toolOptions: { grantedScopes: o.grantedScopes } } : {}),
    ...(o.registry
      ? { authoring: { registry: o.registry, principal: PRINCIPAL, environmentId: ENVIRONMENT_ID } }
      : {}),
  });
  return { status: res.status, json: res.status === 202 ? null : await res.json() };
}

async function listTools(runtime: MCPServerRuntime, bridge: any, o: CallOptions = {}): Promise<string[]> {
  const { json } = await call(runtime, bridge, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, o);
  return (json.result?.tools ?? []).map((t: any) => t.name).sort();
}

function callTool(runtime: MCPServerRuntime, bridge: any, name: string, args: unknown, o: CallOptions = {}) {
  return call(runtime, bridge, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }, o);
}

// ---------------------------------------------------------------------------

describe('[#26464] authoring tools over HTTP — the metadata:write gate', () => {
  let runtime: MCPServerRuntime;
  let bridge: ReturnType<typeof makeBridge>;
  let registry: RecordingAuthoringRegistry;

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    bridge = makeBridge();
    registry = makeAuthoringRegistry();
  });

  it('grantsAuthoringTools admits only a scope list that names metadata:write', () => {
    expect(grantsAuthoringTools([MCP_OAUTH_SCOPE_METADATA_WRITE])).toBe(true);
    expect(grantsAuthoringTools(['openid', MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE])).toBe(true);
    expect(grantsAuthoringTools([MCP_OAUTH_SCOPE_DATA_WRITE])).toBe(false);
    expect(grantsAuthoringTools([MCP_OAUTH_SCOPE_ACTIONS])).toBe(false);
    expect(grantsAuthoringTools([])).toBe(false);
    // The undefined grant (API key / session) keeps the full NATIVE surface
    // elsewhere; here it admits nothing — authoring follows the token's consent.
    expect(grantsAuthoringTools(undefined)).toBe(false);
  });

  it('a data:write token can neither list nor call an authoring tool, and the registry is never touched', async () => {
    const names = await listTools(runtime, bridge, { grantedScopes: [MCP_OAUTH_SCOPE_DATA_WRITE], registry });
    expect(names).toEqual([...WRITE_TOOLS].sort());

    const { json } = await callTool(runtime, bridge, 'create_object', { name: 'invoice' }, {
      grantedScopes: [MCP_OAUTH_SCOPE_DATA_WRITE],
      registry,
    });
    expect(json.error).toBeDefined();
    expect(json.result).toBeUndefined();
    expect(registry.calls).toEqual([]);
  });

  it('an actions:execute token can neither list nor call an authoring tool, and the registry is never touched', async () => {
    const names = await listTools(runtime, bridge, { grantedScopes: [MCP_OAUTH_SCOPE_ACTIONS], registry });
    expect(names).toEqual([...ACTION_TOOLS].sort());

    const { json } = await callTool(runtime, bridge, 'verify_build', {}, {
      grantedScopes: [MCP_OAUTH_SCOPE_ACTIONS],
      registry,
    });
    expect(json.error).toBeDefined();
    expect(registry.calls).toEqual([]);
  });

  it('the undefined grant (API key / session) keeps the full native surface and no authoring tool', async () => {
    const withRegistry = await listTools(runtime, bridge, { registry });
    const withoutRegistry = await listTools(runtime, bridge, {});
    expect(withRegistry).toEqual(NATIVE_TOOLS);
    expect(withRegistry).toEqual(withoutRegistry);

    const { json } = await callTool(runtime, bridge, 'create_object', { name: 'invoice' }, { registry });
    expect(json.error).toBeDefined();
    expect(registry.calls).toEqual([]);
  });

  it('an empty grant registers nothing even with a registry injected (fail-closed)', async () => {
    const { json } = await call(runtime, bridge, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
      grantedScopes: [],
      registry,
    });
    expect(json.result).toBeUndefined();
    expect(json.error).toBeDefined();
  });

  it('the refusal is the SAME answer create_record gets without data:write — one mechanism, not two', async () => {
    // Control: a native write tool under a read-only grant.
    const native = await callTool(runtime, bridge, 'create_record', { objectName: 'task', data: { title: 'x' } }, {
      grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ],
      registry,
    });
    // Subject: an authoring tool under a grant that lacks metadata:write.
    const authoring = await callTool(runtime, bridge, 'create_object', { name: 'invoice' }, {
      grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_DATA_WRITE, MCP_OAUTH_SCOPE_ACTIONS],
      registry,
    });
    expect(native.json.error).toBeDefined();
    expect(authoring.json.error).toBeDefined();
    expect(authoring.json.error.code).toBe(native.json.error.code);
    // Both name the tool and nothing else: the SDK's unknown-tool answer.
    expect(native.json.error.message).toMatch(/create_record/);
    expect(authoring.json.error.message).toMatch(/create_object/);
    expect(authoring.json.error.message.replace('create_object', 'create_record')).toBe(native.json.error.message);
    expect(registry.calls).toEqual([]);
    expect(bridge.calls.find((c: any[]) => c[0] === 'create')).toBeUndefined();
  });

  it('a metadata:write token lists exactly the injected tools (no data scope ⇒ no data tool)', async () => {
    const names = await listTools(runtime, bridge, { grantedScopes: [MCP_OAUTH_SCOPE_METADATA_WRITE], registry });
    expect(names).toEqual(AUTHORING_NAMES);
  });

  it('metadata:write beside the data scopes lists the native surface AND the injected tools', async () => {
    const names = await listTools(runtime, bridge, {
      grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_DATA_WRITE, MCP_OAUTH_SCOPE_ACTIONS, MCP_OAUTH_SCOPE_METADATA_WRITE],
      registry,
    });
    expect(names).toEqual([...NATIVE_TOOLS, ...AUTHORING_NAMES].sort());
  });

  it('a metadata:write token with no registry injected is byte-identical to today (nothing extra registered)', async () => {
    const names = await listTools(runtime, bridge, {
      grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE],
    });
    expect(names).toEqual([...READ_TOOLS].sort());
  });

  it('an authoring-only host (no data bridge) still serves the injected tools under the scope', async () => {
    const names = await listTools(runtime, bridge, {
      grantedScopes: [MCP_OAUTH_SCOPE_METADATA_WRITE],
      registry,
      noBridge: true,
    });
    expect(names).toEqual(AUTHORING_NAMES);
  });
});

describe('[#26464] authoring tools over HTTP — door provenance in the tool context', () => {
  let runtime: MCPServerRuntime;
  let bridge: ReturnType<typeof makeBridge>;
  let registry: RecordingAuthoringRegistry;
  const GRANT = [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE];

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    bridge = makeBridge();
    registry = makeAuthoringRegistry();
  });

  it('a call through the bridge reaches the handler with door: mcp, the token principal and the environment', async () => {
    const { json } = await callTool(runtime, bridge, 'create_object', { name: 'invoice' }, {
      grantedScopes: GRANT,
      registry,
    });
    expect(json.result.isError).toBeFalsy();
    expect(json.result.content[0].text).toBe('authored create_object');

    expect(registry.calls).toHaveLength(1);
    const { toolCall, context } = registry.calls[0];
    expect(toolCall).toMatchObject({ type: 'tool-call', toolName: 'create_object', input: { name: 'invoice' } });
    expect(context.door).toBe(MCP_TOOL_DOOR);
    expect(context.door).toBe('mcp');
    expect(context.principal).toEqual(PRINCIPAL);
    expect(context.environmentId).toBe(ENVIRONMENT_ID);
    // A reader that knows only `ToolExecutionContext` runs as the token's user.
    expect(context.actor).toEqual({ id: PRINCIPAL.userId });
    // The context is `(toolCall, context)` — two arguments, the second never omitted.
    expect(registry.arities).toEqual([2]);
  });

  it('spoofed provenance headers are ignored: the context is built from the host inputs alone', async () => {
    const spoof = {
      'x-door': 'studio',
      'x-objectstack-door': 'cli',
      'x-environment-id': 'env_victim',
      'x-user-id': 'usr_admin',
      'x-forwarded-user': 'usr_admin',
      'x-organization-id': 'org_victim',
      'x-principal': 'usr_admin',
    };
    const { json } = await callTool(runtime, bridge, 'verify_build', {}, {
      grantedScopes: GRANT,
      registry,
      headers: spoof,
    });
    expect(json.result.isError).toBeFalsy();
    expect(registry.calls).toHaveLength(1);
    const { context } = registry.calls[0];
    expect(context.door).toBe('mcp');
    expect(context.principal).toEqual(PRINCIPAL);
    expect(context.environmentId).toBe(ENVIRONMENT_ID);
    expect(context.actor.id).toBe(PRINCIPAL.userId);
    // None of the spoofed values reaches any member of the context, under any key.
    const serialised = JSON.stringify(context);
    for (const value of Object.values(spoof)) expect(serialised).not.toContain(value);
  });

  it('every call gets a fresh context — a handler mutating its context cannot taint the next call', async () => {
    const tainting: McpAuthoringToolRegistry = {
      getAll: () => AUTHORING_TOOLS,
      async execute(toolCall, context) {
        registry.calls.push({ toolCall, context });
        (context as any).door = 'studio';
        (context as any).principal = { userId: 'usr_admin' };
        return {
          type: 'tool-result',
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          output: { type: 'text', value: 'ok' },
        } as ToolExecutionResult;
      },
    };
    const o: CallOptions = { grantedScopes: GRANT, registry: tainting };
    await callTool(runtime, bridge, 'verify_build', {}, o);
    await callTool(runtime, bridge, 'verify_build', {}, o);
    expect(registry.calls).toHaveLength(2);
    // The second call's context was built fresh: the first handler's writes are not in it.
    const second = registry.calls[1].context;
    expect(second.door).toBe('studio'); // the handler's own write, on its own object …
    // … so compare what the runtime HANDED it: the first call's object is not the second's,
    expect(registry.calls[0].context).not.toBe(second);
    // and the host's principal object was not replaced on the injection.
    expect(PRINCIPAL.userId).toBe('usr_dev_1');
  });

  it('an environment the host did not name is absent from the context, not undefined-valued', async () => {
    const server = new McpServer({ name: 'x', version: '0' });
    const names = registerAuthoringTools(server, { registry, principal: PRINCIPAL }, GRANT);
    expect(names).toEqual(AUTHORING_TOOLS.map((t) => t.name));
    // Drive one call through the SDK-registered handler via a second runtime
    // path is not needed: the provenance builder is what `registerAuthoringTools`
    // closes over, so assert through the HTTP door with no environment instead.
    const rt = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_build', arguments: {} } };
    await rt.handleHttpRequest(
      new Request('http://localhost/api/v1/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
      }),
      { parsedBody: body, toolOptions: { grantedScopes: GRANT }, authoring: { registry, principal: PRINCIPAL } },
    );
    expect(registry.calls).toHaveLength(1);
    expect('environmentId' in registry.calls[0].context).toBe(false);
  });

  it('registerAuthoringTools registers nothing and returns [] for a grant that lacks the scope', () => {
    for (const grant of [undefined, [], [MCP_OAUTH_SCOPE_DATA_WRITE], [MCP_OAUTH_SCOPE_ACTIONS]] as const) {
      const server = new McpServer({ name: 'x', version: '0' });
      expect(registerAuthoringTools(server, { registry, principal: PRINCIPAL, environmentId: ENVIRONMENT_ID }, grant)).toEqual([]);
    }
  });

  it('a registry result flagged isError, and a registry that throws, both come back as tool errors (as on stdio)', async () => {
    const flagged = makeAuthoringRegistry(AUTHORING_TOOLS, 'isError');
    const a = await callTool(runtime, bridge, 'verify_build', {}, { grantedScopes: GRANT, registry: flagged });
    expect(a.json.result.isError).toBe(true);
    expect(a.json.result.content[0].text).toBe('authored verify_build');

    const throwing = makeAuthoringRegistry(AUTHORING_TOOLS, 'throw');
    const b = await callTool(runtime, bridge, 'verify_build', {}, { grantedScopes: GRANT, registry: throwing });
    expect(b.json.result.isError).toBe(true);
    expect(b.json.result.content[0].text).toBe('refused: verify_build');
    // Both calls still carried the provenance before the registry answered.
    expect(flagged.calls[0].context.door).toBe('mcp');
    expect(throwing.calls[0].context.door).toBe('mcp');
  });
});

// ---------------------------------------------------------------------------
// stdio parity: the long-lived bridge is unchanged
// ---------------------------------------------------------------------------

interface JsonRpcFrame {
  jsonrpc: string;
  id?: number;
  result?: any;
  error?: { code: number; message: string };
}

async function openStdio(server: McpServer) {
  const serverStdin = new PassThrough();
  const serverStdout = new PassThrough();
  const transport = new StdioServerTransport(serverStdin, serverStdout);
  await server.connect(transport);
  let nextId = 1;
  let buffered = '';
  const waiting = new Map<number, (frame: JsonRpcFrame) => void>();
  serverStdout.on('data', (chunk: Buffer | string) => {
    buffered += String(chunk);
    let nl = buffered.indexOf('\n');
    while (nl >= 0) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      nl = buffered.indexOf('\n');
      if (!line) continue;
      let frame: JsonRpcFrame;
      try { frame = JSON.parse(line) as JsonRpcFrame; } catch { continue; }
      const resolve = typeof frame.id === 'number' ? waiting.get(frame.id) : undefined;
      if (resolve && typeof frame.id === 'number') { waiting.delete(frame.id); resolve(frame); }
    }
  });
  return {
    rpc(method: string, params?: unknown): Promise<JsonRpcFrame> {
      const id = nextId++;
      return new Promise<JsonRpcFrame>((resolve, reject) => {
        const giveUp = setTimeout(() => reject(new Error(`stdio: no answer to "${method}" within 5s`)), 5_000);
        waiting.set(id, (frame) => { clearTimeout(giveUp); resolve(frame); });
        serverStdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
      });
    },
    notify(method: string, params?: unknown) {
      serverStdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`);
    },
    async close() { await transport.close().catch(() => {}); },
  };
}

describe('[#26464] stdio parity — bridgeTools still calls its ToolRegistry with one argument', () => {
  let session: Awaited<ReturnType<typeof openStdio>> | undefined;
  afterEach(async () => { await session?.close(); session = undefined; });

  it('the long-lived bridge passes (toolCall) alone — no provenance, no second argument', async () => {
    const calls: ToolCallPart[] = [];
    const arities: number[] = [];
    const legacy: ToolRegistry = {
      getAll: () => AUTHORING_TOOLS,
      async execute(toolCall: ToolCallPart): Promise<ToolExecutionResult> {
        // eslint-disable-next-line prefer-rest-params
        arities.push(arguments.length);
        calls.push(toolCall);
        return {
          type: 'tool-result',
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          output: { type: 'text', value: `executed ${toolCall.toolName}` },
        } as ToolExecutionResult;
      },
    };
    const runtime = new MCPServerRuntime({ name: 'stdio-parity', version: '0.0.0' });
    runtime.bridgeTools(legacy);
    session = await openStdio(runtime.server);
    await session.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pin', version: '0' } });
    session.notify('notifications/initialized');

    const listed = (await session.rpc('tools/list')).result?.tools ?? [];
    expect(listed.map((t: any) => t.name).sort()).toEqual(AUTHORING_NAMES);

    const answer = await session.rpc('tools/call', { name: 'create_object', arguments: { name: 'invoice' } });
    expect(answer.result?.isError).toBeFalsy();
    expect(answer.result?.content?.[0]?.text).toBe('executed create_object');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: 'tool-call', toolName: 'create_object', input: { name: 'invoice' } });
    expect(arities).toEqual([1]);
  });
});
