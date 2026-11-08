// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31605] The host-installed tool-call interceptor on the `mcp` service.
 *
 * What is pinned:
 *
 *  1. NOTHING INSTALLED, NOTHING CHANGED. With no interceptor every tool call
 *     answers what the tool answers, the tool runs once, and the seam reads
 *     neither the HTTP caller nor the stdio principal — it does no work at all.
 *  2. ALLOW, DENY, REPLACE on every registration path: the HTTP object tools,
 *     the action tools, the file tools and the host-injected authoring family;
 *     on stdio the bridged data tools and the bridged AI `ToolRegistry`.
 *     Allow runs the tool and serves its answer, deny never runs it and
 *     answers the coded-refusal envelope, replace runs it once and serves the
 *     interceptor's result.
 *  3. THE PRINCIPAL is the host's: projected from the `caller` the host passed
 *     (HTTP) or the stdio identity the plugin bound, frozen, and unchanged by
 *     any header or JSON-RPC member a client sends.
 *  4. THE CONTRACT'S EDGES: a throw refuses (a coded one keeps its code), a
 *     verdict that is neither a result nor a deny is refused as a fault, a
 *     tool's own throw keeps its own answer, and `next()` runs the tool once.
 *  5. COVERAGE BY CONSTRUCTION: a tool a plugin registers on the runtime's
 *     server itself — `registerTool`, the deprecated `tool`, a handler a later
 *     `update` installs — is routed too.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MCP_OAUTH_SCOPE_METADATA_WRITE } from '@objectstack/spec/ai';
import type { AIToolDefinition, ToolCallPart, ToolExecutionContext } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { MCPServerRuntime, setRuntimeStdioPrincipal } from './mcp-server-runtime.js';
import type { McpHttpCaller } from './mcp-server-runtime.js';
import type { McpActionBridge, McpDataBridge } from './mcp-http-tools.js';
import type { McpFileBridge } from './file-content.js';
import type {
  McpAuthoringToolRegistry,
  McpToolCallContext,
  McpToolCallResult,
  McpToolInterceptor,
  ToolExecutionResult,
  ToolRegistry,
} from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Call = unknown[];

/** A bridge carrying the data, action and file seams; every call is recorded. */
function makeBridge(): McpDataBridge & McpActionBridge & McpFileBridge & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async listObjects() { calls.push(['listObjects']); return [{ name: 'task', label: 'Task', fieldCount: 1 }]; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create(object: string, data: Record<string, unknown>) {
      calls.push(['create', object, data]);
      return { object, id: 'new1', record: data };
    },
    async update() { return {}; },
    async remove() { return {}; },
    async listActions() {
      calls.push(['listActions']);
      return [{ name: 'complete_task', objectName: 'task', label: 'Complete', type: 'script', params: [] }];
    },
    async runAction(name: string) {
      calls.push(['runAction', name]);
      return { ok: true, action: name };
    },
    async readRecordFile(object: string, recordId: string) {
      calls.push(['readRecordFile', object, recordId]);
      return {
        fileId: 'f1',
        name: 'note.txt',
        mimeType: 'text/plain',
        size: 5,
        field: 'notes',
        maxBytes: 1024,
        bytes: new Uint8Array(Buffer.from('hello')),
        download: { url: 'https://acme.test/raw/tok', expiresAt: '2026-11-08T12:00:00.000Z' },
      };
    },
  } as McpDataBridge & McpActionBridge & McpFileBridge & { calls: Call[] };
}

const AUTHORING_TOOL: AIToolDefinition = {
  name: 'create_object',
  description: 'Create a draft object.',
  parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
};

function makeAuthoringRegistry(): McpAuthoringToolRegistry & { calls: ToolCallPart[] } {
  const calls: ToolCallPart[] = [];
  return {
    calls,
    getAll: () => [AUTHORING_TOOL],
    async execute(toolCall) {
      calls.push(toolCall);
      return result(toolCall, `drafted ${(toolCall.input as { name: string }).name}`);
    },
  };
}

const AI_TOOL: AIToolDefinition = {
  name: 'summarize_pipeline',
  description: 'Summarize the open pipeline.',
  parameters: { type: 'object', properties: { stage: { type: 'string' } } },
};

function makeToolRegistry(): ToolRegistry & { calls: Array<{ call: ToolCallPart; context?: ToolExecutionContext; arity: number }> } {
  const calls: Array<{ call: ToolCallPart; context?: ToolExecutionContext; arity: number }> = [];
  return {
    calls,
    getAll: () => [AI_TOOL],
    async execute(call: ToolCallPart, context?: ToolExecutionContext) {
      calls.push({ call, context, arity: arguments.length });
      return result(call, 'pipeline: 3 open');
    },
  };
}

function result(call: ToolCallPart, value: string): ToolExecutionResult {
  return { type: 'tool-result', toolCallId: call.toolCallId, toolName: call.toolName, output: { type: 'text', value } };
}

/** The ExecutionContext a host admitted an OAuth agent as. */
const AGENT_EC: ExecutionContext = {
  userId: 'usr_ana',
  tenantId: 'org_acme',
  principalKind: 'agent',
  onBehalfOf: { userId: 'usr_ana', principalKind: 'human' },
  performedBy: { clientId: 'oauth_app_claude' },
  positions: ['sales_rep'],
  permissions: ['records:read'],
  isSystem: false,
} as ExecutionContext;

const AGENT_CALLER: McpHttpCaller = { executionContext: AGENT_EC, environmentId: 'env_prod' };

const AGENT_PRINCIPAL = {
  userId: 'usr_ana',
  principalKind: 'agent',
  onBehalfOf: { userId: 'usr_ana', principalKind: 'human' },
  performedBy: { clientId: 'oauth_app_claude' },
  organizationId: 'org_acme',
  environmentId: 'env_prod',
};

/** The stdio key's identity. */
const STDIO_EC = {
  userId: 'usr_ops',
  tenantId: 'org_acme',
  principalKind: 'human',
  positions: ['admin'],
  permissions: ['records:write'],
  isSystem: false,
} as ExecutionContext;

const STDIO_PRINCIPAL = { userId: 'usr_ops', principalKind: 'human', organizationId: 'org_acme' };

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

interface HttpCallOptions {
  caller?: McpHttpCaller;
  grantedScopes?: string[];
  authoring?: McpAuthoringToolRegistry;
  headers?: Record<string, string>;
}

let nextId = 1;

async function httpCall(
  runtime: MCPServerRuntime,
  bridge: unknown,
  name: string,
  args: Record<string, unknown>,
  o: HttpCallOptions = {},
): Promise<McpToolCallResult> {
  const body = { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } };
  const request = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(o.headers ?? {}) },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(request, {
    bridge: bridge as McpDataBridge,
    parsedBody: body,
    ...(o.grantedScopes ? { toolOptions: { grantedScopes: o.grantedScopes } } : {}),
    ...(o.authoring
      ? { authoring: { registry: o.authoring, principal: { userId: 'usr_ana', scopes: o.grantedScopes ?? [] } } }
      : {}),
    ...(o.caller ? { caller: o.caller } : {}),
  });
  const json = (await res.json()) as { result?: McpToolCallResult; error?: unknown };
  if (!json.result) throw new Error(`no tools/call result: ${JSON.stringify(json)}`);
  return json.result;
}

/** A client connected to the runtime's long-lived server, as `start()` would connect stdio. */
async function connectLongLived(runtime: MCPServerRuntime): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await runtime.server.connect(serverSide);
  const client = new Client({ name: 'interceptor-pin', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

async function stdioCall(client: Client, name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
  return (await client.callTool({ name, arguments: args })) as McpToolCallResult;
}

function textOf(r: McpToolCallResult): string {
  const first = r.content[0] as { type: string; text?: string };
  return first.text ?? '';
}

// ---------------------------------------------------------------------------
// Interceptors
// ---------------------------------------------------------------------------

interface Recorded {
  seen: McpToolCallContext[];
  interceptor: McpToolInterceptor;
}

function allowing(): Recorded {
  const seen: McpToolCallContext[] = [];
  return { seen, interceptor: async (call, next) => { seen.push(call); return next(); } };
}

function denying(): Recorded {
  const seen: McpToolCallContext[] = [];
  return {
    seen,
    interceptor: async (call) => {
      seen.push(call);
      return { outcome: 'deny', code: 'PERMISSION_DENIED', message: 'This AI is disabled for your organization.', status: 403 };
    },
  };
}

function replacing(): Recorded & { tool: McpToolCallResult[] } {
  const seen: McpToolCallContext[] = [];
  const tool: McpToolCallResult[] = [];
  return {
    seen,
    tool,
    interceptor: async (call, next) => {
      seen.push(call);
      tool.push(await next());
      return { content: [{ type: 'text', text: 'replaced by the host' }] };
    },
  };
}

const DENIED_ENVELOPE = {
  error: { code: 'PERMISSION_DENIED', message: 'This AI is disabled for your organization.', status: 403 },
};

// ---------------------------------------------------------------------------
// The paths
// ---------------------------------------------------------------------------

interface Path {
  label: string;
  transport: 'http' | 'stdio';
  tool: string;
  args: Record<string, unknown>;
  /** Run one call on a fresh fixture; `ran` says whether the tool itself executed. */
  open(runtime: MCPServerRuntime): Promise<{ call(): Promise<McpToolCallResult>; ran(): number; close(): Promise<void> }>;
}

const HTTP_PATHS: Path[] = [
  {
    label: 'HTTP object tool',
    transport: 'http',
    tool: 'create_record',
    args: { objectName: 'task', data: { title: 'call Ana' } },
    async open(runtime) {
      const bridge = makeBridge();
      return {
        call: () => httpCall(runtime, bridge, this.tool, this.args, { caller: AGENT_CALLER }),
        ran: () => bridge.calls.filter((c) => c[0] === 'create').length,
        close: async () => {},
      };
    },
  },
  {
    label: 'HTTP action tool',
    transport: 'http',
    tool: 'list_actions',
    args: {},
    async open(runtime) {
      const bridge = makeBridge();
      return {
        call: () => httpCall(runtime, bridge, this.tool, this.args, { caller: AGENT_CALLER }),
        ran: () => bridge.calls.filter((c) => c[0] === 'listActions').length,
        close: async () => {},
      };
    },
  },
  {
    label: 'HTTP file tool',
    transport: 'http',
    tool: 'read_file',
    args: { objectName: 'task', recordId: 't1', field: 'notes' },
    async open(runtime) {
      const bridge = makeBridge();
      return {
        call: () => httpCall(runtime, bridge, this.tool, this.args, { caller: AGENT_CALLER }),
        ran: () => bridge.calls.filter((c) => c[0] === 'readRecordFile').length,
        close: async () => {},
      };
    },
  },
  {
    label: 'HTTP authoring family',
    transport: 'http',
    tool: 'create_object',
    args: { name: 'invoice' },
    async open(runtime) {
      const bridge = makeBridge();
      const authoring = makeAuthoringRegistry();
      return {
        call: () =>
          httpCall(runtime, bridge, this.tool, this.args, {
            caller: AGENT_CALLER,
            grantedScopes: [MCP_OAUTH_SCOPE_METADATA_WRITE],
            authoring,
          }),
        ran: () => authoring.calls.length,
        close: async () => {},
      };
    },
  },
];

const STDIO_PATHS: Path[] = [
  {
    label: 'stdio data tool',
    transport: 'stdio',
    tool: 'create_record',
    args: { objectName: 'task', data: { title: 'call Ana' } },
    async open(runtime) {
      const bridge = makeBridge();
      runtime.bridgeDataTools(bridge);
      setRuntimeStdioPrincipal(runtime, async () => STDIO_EC);
      const client = await connectLongLived(runtime);
      return {
        call: () => stdioCall(client, this.tool, this.args),
        ran: () => bridge.calls.filter((c) => c[0] === 'create').length,
        close: () => client.close(),
      };
    },
  },
  {
    label: 'stdio bridged AI tool',
    transport: 'stdio',
    tool: 'summarize_pipeline',
    args: { stage: 'open' },
    async open(runtime) {
      const registry = makeToolRegistry();
      runtime.bridgeTools(registry);
      setRuntimeStdioPrincipal(runtime, async () => STDIO_EC);
      const client = await connectLongLived(runtime);
      return {
        call: () => stdioCall(client, this.tool, this.args),
        ran: () => registry.calls.length,
        close: () => client.close(),
      };
    },
  },
];

const PATHS = [...HTTP_PATHS, ...STDIO_PATHS];

// ---------------------------------------------------------------------------
// 1. Nothing installed
// ---------------------------------------------------------------------------

describe('[#31605] no interceptor installed — every call runs as before', () => {
  let runtime: MCPServerRuntime;
  let fixture: Awaited<ReturnType<Path['open']>> | undefined;
  beforeEach(() => { runtime = new MCPServerRuntime({ name: 'interceptor-off', version: '0.0.0' }); });
  afterEach(async () => { await fixture?.close(); fixture = undefined; });

  it('a fresh runtime has none', () => {
    expect(runtime.hasToolInterceptor()).toBe(false);
  });

  for (const path of PATHS) {
    it(`${path.label}: the tool runs once and its answer is served, identical to an installed-then-cleared slot`, async () => {
      fixture = await path.open(runtime);
      const untouched = await fixture.call();
      expect(untouched.isError).toBeFalsy();
      expect(fixture.ran()).toBe(1);

      runtime.setToolInterceptor(allowing().interceptor);
      runtime.clearToolInterceptor();
      expect(runtime.hasToolInterceptor()).toBe(false);
      const cleared = await fixture.call();
      expect(fixture.ran()).toBe(2);
      expect(cleared).toEqual(untouched);
    });
  }

  it('HTTP: the seam never reads the caller the host passed', async () => {
    const bridge = makeBridge();
    let reads = 0;
    const caller: McpHttpCaller = {
      get executionContext() { reads += 1; return AGENT_EC; },
      get environmentId() { reads += 1; return 'env_prod'; },
    };
    const answer = await httpCall(runtime, bridge, 'create_record', { objectName: 'task', data: { title: 'x' } }, { caller });
    expect(answer.isError).toBeFalsy();
    expect(reads).toBe(0);
  });

  it('stdio: the seam never resolves the bound principal for a data tool', async () => {
    const bridge = makeBridge();
    runtime.bridgeDataTools(bridge);
    let resolutions = 0;
    setRuntimeStdioPrincipal(runtime, async () => { resolutions += 1; return STDIO_EC; });
    const client = await connectLongLived(runtime);
    fixture = { call: async () => ({ content: [] }), ran: () => 0, close: () => client.close() };
    const answer = await stdioCall(client, 'create_record', { objectName: 'task', data: { title: 'x' } });
    expect(answer.isError).toBeFalsy();
    expect(resolutions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Allow, deny, replace on every path
// ---------------------------------------------------------------------------

describe('[#31605] allow, deny and replace on every registration path', () => {
  let runtime: MCPServerRuntime;
  let fixture: Awaited<ReturnType<Path['open']>> | undefined;
  beforeEach(() => { runtime = new MCPServerRuntime({ name: 'interceptor-on', version: '0.0.0' }); });
  afterEach(async () => { await fixture?.close(); fixture = undefined; });

  for (const path of PATHS) {
    const principal = path.transport === 'http' ? AGENT_PRINCIPAL : STDIO_PRINCIPAL;

    it(`${path.label}: allow runs the tool and serves its answer; the context is the server's`, async () => {
      fixture = await path.open(runtime);
      const baseline = await fixture.call();
      const recorded = allowing();
      runtime.setToolInterceptor(recorded.interceptor);

      const answer = await fixture.call();
      expect(answer).toEqual(baseline);
      expect(fixture.ran()).toBe(2);
      expect(recorded.seen).toHaveLength(1);
      expect(recorded.seen[0]).toEqual({
        door: 'mcp',
        transport: path.transport,
        toolName: path.tool,
        arguments: path.args,
        principal,
      });
    });

    it(`${path.label}: deny never runs the tool and answers the coded-refusal envelope`, async () => {
      fixture = await path.open(runtime);
      const recorded = denying();
      runtime.setToolInterceptor(recorded.interceptor);

      const answer = await fixture.call();
      expect(fixture.ran()).toBe(0);
      expect(recorded.seen).toHaveLength(1);
      expect(answer.isError).toBe(true);
      expect(JSON.parse(textOf(answer))).toEqual(DENIED_ENVELOPE);
    });

    it(`${path.label}: replace runs the tool once and serves the interceptor's result`, async () => {
      fixture = await path.open(runtime);
      const recorded = replacing();
      runtime.setToolInterceptor(recorded.interceptor);

      const answer = await fixture.call();
      expect(fixture.ran()).toBe(1);
      expect(recorded.tool).toHaveLength(1);
      expect(recorded.tool[0]!.isError).toBeFalsy();
      expect(answer).toEqual({ content: [{ type: 'text', text: 'replaced by the host' }] });
    });
  }
});

// ---------------------------------------------------------------------------
// 3. The principal
// ---------------------------------------------------------------------------

describe('[#31605] the principal is the host\'s, and no request can change it', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => { runtime = new MCPServerRuntime({ name: 'interceptor-principal', version: '0.0.0' }); });

  it('HTTP: spoofed identity headers change no member, and nothing beyond the named members is projected', async () => {
    const recorded = allowing();
    runtime.setToolInterceptor(recorded.interceptor);
    await httpCall(runtime, makeBridge(), 'create_record', { objectName: 'task', data: { title: 'x' } }, {
      caller: AGENT_CALLER,
      headers: {
        'x-user-id': 'usr_mallory',
        'x-principal-kind': 'system',
        'x-on-behalf-of': 'usr_ceo',
        'x-client-id': 'oauth_app_evil',
        'x-organization-id': 'org_other',
        'x-tenant-id': 'org_other',
        'x-environment-id': 'env_other',
        'x-objectstack-environment': 'env_other',
        'x-door': 'rest',
        'x-transport': 'stdio',
      },
    });
    expect(recorded.seen).toHaveLength(1);
    const call = recorded.seen[0]!;
    expect(call.principal).toEqual(AGENT_PRINCIPAL);
    expect(call.door).toBe('mcp');
    expect(call.transport).toBe('http');
    // `positions` / `permissions` / `isSystem: false` stay with the host.
    expect(Object.keys(call.principal).sort()).toEqual(Object.keys(AGENT_PRINCIPAL).sort());
  });

  it('HTTP: a JSON-RPC _meta naming another principal changes nothing either', async () => {
    const recorded = allowing();
    runtime.setToolInterceptor(recorded.interceptor);
    const body = {
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: {
        name: 'create_record',
        arguments: { objectName: 'task', data: { title: 'x' } },
        _meta: { userId: 'usr_mallory', principal: { userId: 'usr_mallory' }, environmentId: 'env_other' },
      },
    };
    const request = new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    });
    await runtime.handleHttpRequest(request, { bridge: makeBridge(), parsedBody: body, caller: AGENT_CALLER });
    expect(recorded.seen[0]!.principal).toEqual(AGENT_PRINCIPAL);
  });

  it('HTTP: a request whose host passed no caller is told an empty principal, never a header\'s', async () => {
    const recorded = allowing();
    runtime.setToolInterceptor(recorded.interceptor);
    await httpCall(runtime, makeBridge(), 'create_record', { objectName: 'task', data: { title: 'x' } }, {
      headers: { 'x-user-id': 'usr_mallory', 'x-environment-id': 'env_other' },
    });
    expect(recorded.seen[0]!.principal).toEqual({});
  });

  it('HTTP: a system principal the host admitted is marked as one', async () => {
    const recorded = allowing();
    runtime.setToolInterceptor(recorded.interceptor);
    await httpCall(runtime, makeBridge(), 'create_record', { objectName: 'task', data: { title: 'x' } }, {
      caller: { executionContext: { isSystem: true } as ExecutionContext, environmentId: 'env_prod' },
    });
    expect(recorded.seen[0]!.principal).toEqual({ isSystem: true, environmentId: 'env_prod' });
  });

  it('the context, its principal and its arguments are frozen; the tool still gets what the client sent', async () => {
    const bridge = makeBridge();
    const seen: McpToolCallContext[] = [];
    runtime.setToolInterceptor(async (call, next) => {
      seen.push(call);
      return next();
    });
    await httpCall(runtime, bridge, 'create_record', { objectName: 'task', data: { title: 'x' } }, { caller: AGENT_CALLER });
    const call = seen[0]!;
    expect(Object.isFrozen(call)).toBe(true);
    expect(Object.isFrozen(call.principal)).toBe(true);
    expect(Object.isFrozen(call.principal.onBehalfOf)).toBe(true);
    expect(Object.isFrozen(call.arguments)).toBe(true);
    expect(Object.isFrozen(call.arguments.data)).toBe(true);
    expect(bridge.calls).toContainEqual(['create', 'task', { title: 'x' }]);
    // The host's context is not aliased: freezing the projection froze nothing of the host's.
    expect(Object.isFrozen(AGENT_EC)).toBe(false);
    expect(Object.isFrozen(AGENT_EC.onBehalfOf)).toBe(false);
  });

  it('stdio: the principal is re-resolved at each call, so a changed identity is the next call\'s', async () => {
    const registry = makeToolRegistry();
    runtime.bridgeTools(registry);
    let current: ExecutionContext = STDIO_EC;
    setRuntimeStdioPrincipal(runtime, async () => current);
    const recorded = allowing();
    runtime.setToolInterceptor(recorded.interceptor);
    const client = await connectLongLived(runtime);
    try {
      await stdioCall(client, 'summarize_pipeline', {});
      current = { ...STDIO_EC, userId: 'usr_successor' } as ExecutionContext;
      await stdioCall(client, 'summarize_pipeline', {});
    } finally {
      await client.close();
    }
    expect(recorded.seen.map((c) => c.principal.userId)).toEqual(['usr_ops', 'usr_successor']);
  });

  it('stdio: a key that no longer resolves refuses the call before the interceptor, with its code', async () => {
    const registry = makeToolRegistry();
    runtime.bridgeTools(registry);
    setRuntimeStdioPrincipal(runtime, async () => {
      throw Object.assign(new Error('The API key was revoked.'), { code: 'API_KEY_REVOKED', status: 401 });
    });
    const recorded = allowing();
    runtime.setToolInterceptor(recorded.interceptor);
    const client = await connectLongLived(runtime);
    let answer: McpToolCallResult;
    try {
      answer = await stdioCall(client, 'summarize_pipeline', {});
    } finally {
      await client.close();
    }
    expect(recorded.seen).toHaveLength(0);
    expect(registry.calls).toHaveLength(0);
    expect(answer!.isError).toBe(true);
    expect(JSON.parse(textOf(answer!))).toEqual({
      error: { code: 'API_KEY_REVOKED', message: 'The API key was revoked.', status: 401 },
    });
  });

  it('stdio with no principal bound: the interceptor is told an empty principal', async () => {
    const registry = makeToolRegistry();
    runtime.bridgeTools(registry);
    const recorded = allowing();
    runtime.setToolInterceptor(recorded.interceptor);
    const client = await connectLongLived(runtime);
    try {
      await stdioCall(client, 'summarize_pipeline', {});
    } finally {
      await client.close();
    }
    expect(recorded.seen[0]!.principal).toEqual({});
    expect(recorded.seen[0]!.transport).toBe('stdio');
  });
});

// ---------------------------------------------------------------------------
// 3b. The bridged AI tools run as the stdio principal
// ---------------------------------------------------------------------------

describe('[#31605] bridgeTools passes the stdio principal as the execution context', () => {
  it('once bound, every call carries the key\'s user as actor (with or without an interceptor)', async () => {
    const runtime = new MCPServerRuntime({ name: 'bridge-actor', version: '0.0.0' });
    const registry = makeToolRegistry();
    runtime.bridgeTools(registry);
    // Bound AFTER bridging, as the plugin does: read at the call.
    setRuntimeStdioPrincipal(runtime, async () => STDIO_EC);
    const client = await connectLongLived(runtime);
    try {
      await stdioCall(client, 'summarize_pipeline', { stage: 'open' });
      runtime.setToolInterceptor(allowing().interceptor);
      await stdioCall(client, 'summarize_pipeline', { stage: 'open' });
    } finally {
      await client.close();
    }
    expect(registry.calls).toHaveLength(2);
    for (const { call, context, arity } of registry.calls) {
      expect(arity).toBe(2);
      expect(call).toMatchObject({ type: 'tool-call', toolName: 'summarize_pipeline', input: { stage: 'open' } });
      expect(context).toEqual({ actor: { id: 'usr_ops', positions: ['admin'], permissions: ['records:write'] } });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The contract's edges
// ---------------------------------------------------------------------------

describe('[#31605] the contract\'s edges', () => {
  let runtime: MCPServerRuntime;
  let bridge: ReturnType<typeof makeBridge>;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'interceptor-edges', version: '0.0.0' });
    bridge = makeBridge();
  });
  const create = () => httpCall(runtime, bridge, 'create_record', { objectName: 'task', data: { title: 'x' } }, { caller: AGENT_CALLER });
  const created = () => bridge.calls.filter((c) => c[0] === 'create').length;

  it('a coded throw before next() refuses the call with its code; the tool never runs', async () => {
    runtime.setToolInterceptor(async () => {
      throw Object.assign(new Error('No AI seat is assigned to you.'), { code: 'PERMISSION_DENIED', status: 403 });
    });
    const answer = await create();
    expect(created()).toBe(0);
    expect(answer.isError).toBe(true);
    expect(JSON.parse(textOf(answer))).toEqual({
      error: { code: 'PERMISSION_DENIED', message: 'No AI seat is assigned to you.', status: 403 },
    });
  });

  it('a verdict that is neither a result nor a deny is refused as a fault, never served', async () => {
    const odd: unknown[] = [undefined, null, 'ok', { outcome: 'hold' }, { outcome: 'deny' }, { allowed: true }];
    for (const verdict of odd) {
      runtime.setToolInterceptor((async () => verdict) as unknown as McpToolInterceptor);
      const answer = await create();
      expect(answer.isError).toBe(true);
      expect(JSON.parse(textOf(answer))).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 },
      });
    }
    expect(created()).toBe(0);
  });

  it('a tool result the interceptor saw and then refused to vouch for is not served either', async () => {
    runtime.setToolInterceptor((async (_call: McpToolCallContext, next: () => Promise<McpToolCallResult>) => {
      await next();
      return { outcome: 'hold' };
    }) as unknown as McpToolInterceptor);
    const answer = await create();
    expect(created()).toBe(1);
    expect(JSON.parse(textOf(answer)).error.code).toBe('INTERNAL_ERROR');
  });

  it('next() runs the tool once, however often it is called', async () => {
    runtime.setToolInterceptor(async (_call, next) => {
      const first = await next();
      const second = await next();
      expect(second).toBe(first);
      return first;
    });
    const answer = await create();
    expect(answer.isError).toBeFalsy();
    expect(created()).toBe(1);
  });

  it('a tool\'s own throw that the interceptor lets through keeps the answer it has with none installed', async () => {
    const server = runtime.server;
    server.registerTool('explode', { description: 'throws', inputSchema: { n: z.number() } }, async () => {
      throw new Error('tool exploded');
    });
    const client = await connectLongLived(runtime);
    try {
      const bare = await stdioCall(client, 'explode', { n: 1 });
      runtime.setToolInterceptor(async (_call, next) => next());
      const intercepted = await stdioCall(client, 'explode', { n: 1 });
      expect(intercepted).toEqual(bare);
      expect(textOf(bare)).toBe('tool exploded');
    } finally {
      await client.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Coverage by construction
// ---------------------------------------------------------------------------

describe('[#31605] a tool a plugin registers on the runtime\'s server is routed too', () => {
  let runtime: MCPServerRuntime;
  let client: Client | undefined;
  beforeEach(() => { runtime = new MCPServerRuntime({ name: 'interceptor-plugin-tools', version: '0.0.0' }); });
  afterEach(async () => { await client?.close(); client = undefined; });

  it('registerTool, the deprecated tool(), and a handler update() installs all pass the gate', async () => {
    const ran: string[] = [];
    runtime.server.registerTool('plugin_echo', { description: 'echo', inputSchema: { text: z.string() } }, async ({ text }) => {
      ran.push(`echo:${text}`);
      return { content: [{ type: 'text' as const, text }] };
    });
    runtime.server.tool('plugin_ping', 'ping', async () => {
      ran.push('ping');
      return { content: [{ type: 'text' as const, text: 'pong' }] };
    });
    const swapped = runtime.server.registerTool('plugin_swapped', { description: 'v1' }, async () => {
      ran.push('v1');
      return { content: [{ type: 'text' as const, text: 'v1' }] };
    });
    swapped.update({
      callback: async () => {
        ran.push('v2');
        return { content: [{ type: 'text' as const, text: 'v2' }] };
      },
    });
    const recorded = denying();
    runtime.setToolInterceptor(recorded.interceptor);
    client = await connectLongLived(runtime);

    for (const name of ['plugin_echo', 'plugin_ping', 'plugin_swapped']) {
      const answer = await stdioCall(client, name, name === 'plugin_echo' ? { text: 'hi' } : {});
      expect(answer.isError).toBe(true);
    }
    expect(ran).toEqual([]);
    expect(recorded.seen.map((c) => [c.toolName, c.arguments])).toEqual([
      ['plugin_echo', { text: 'hi' }],
      ['plugin_ping', {}],
      ['plugin_swapped', {}],
    ]);

    runtime.clearToolInterceptor();
    expect(textOf(await stdioCall(client, 'plugin_swapped', {}))).toBe('v2');
    expect(ran).toEqual(['v2']);
  });

  it('a renamed tool is told by its new name', async () => {
    const tool = runtime.server.registerTool('old_name', { description: 'renamed' }, async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));
    tool.update({ name: 'new_name' });
    const recorded = allowing();
    runtime.setToolInterceptor(recorded.interceptor);
    client = await connectLongLived(runtime);
    await stdioCall(client, 'new_name', {});
    expect(recorded.seen.map((c) => c.toolName)).toEqual(['new_name']);
  });
});
