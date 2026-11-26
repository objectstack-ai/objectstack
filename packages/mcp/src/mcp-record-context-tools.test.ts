// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0160 D4] `get_record_context` on MCP: one definition, one executor,
 * every transport.
 *
 * Pinned here, over the stdio bridge (`createStdioDataBridge`) and the real
 * executor (`@objectstack/service-record-context`): the tool registers only on
 * a bridge carrying both record-context members and only under `data:read`,
 * with the executor's description; the HTTP door (`handleHttpRequest`) and the
 * stdio door (`bridgeDataTools` on the long-lived server) list it alike and
 * answer every call alike, success and refusal; the tool layer's read guard
 * refuses a system root before the bridge is asked and is the guard the
 * executor judges every other object with; and a root the caller cannot read
 * is answered exactly as `get_record` answers it. The executor's own rules
 * (order of judgement, naming bound, field and row level, the body) are
 * pinned with the service, in `service-record-context`'s tests; the HTTP
 * bridge's door wiring in `packages/runtime/src/mcp-record-context-tools-bridge.test.ts`.
 *
 * And over the real protocol (no protocol double): a package pack the
 * protocol's served listing decorates with `_diagnostics` is the pack the
 * stdio door answers through — the door hands the executor the authored pack.
 */

import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { GET_RECORD_CONTEXT_TOOL_NAME, MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_DATA_WRITE } from '@objectstack/spec/ai';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { createRecordContextTools } from '@objectstack/service-record-context';
import { ObjectQL } from '@objectstack/objectql/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMetadataObject } from '@objectstack/metadata-core';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';
import { createStdioDataBridge } from './stdio-data-bridge.js';

const OBJECTS: Record<string, Record<string, unknown>> = {
  policy: {
    name: 'policy',
    label: 'Policy',
    nameField: 'title',
    fields: {
      title: { name: 'title', type: 'text', label: 'Title' },
      status: { name: 'status', type: 'select', label: 'Status', options: [{ value: 'active', label: 'Active' }] },
      content: { name: 'content', type: 'markdown', label: 'Content' },
    },
  },
  policy_revision: {
    name: 'policy_revision',
    label: 'Policy revision',
    nameField: 'version',
    fields: {
      version: { name: 'version', type: 'text', label: 'Version' },
      policy: { name: 'policy', type: 'lookup', reference: 'policy', label: 'Policy' },
    },
  },
  closed_revision: {
    name: 'closed_revision',
    label: 'Closed revision',
    apiEnabled: false,
    fields: {
      version: { name: 'version', type: 'text', label: 'Version' },
      policy: { name: 'policy', type: 'lookup', reference: 'policy', label: 'Policy' },
    },
  },
  sys_note: {
    name: 'sys_note',
    label: 'Note',
    fields: {
      body: { name: 'body', type: 'text', label: 'Body' },
      policy: { name: 'policy', type: 'lookup', reference: 'policy', label: 'Policy' },
    },
  },
};

const ROWS: Record<string, Array<Record<string, unknown>>> = {
  policy: [{ id: 'p1', title: 'Fire cover', status: 'active', content: '# Scope\nCovers fire.' }],
  policy_revision: [
    { id: 'r1', version: 'v1', policy: 'p1' },
    { id: 'r2', version: 'v2', policy: 'p1' },
  ],
  closed_revision: [],
  sys_note: [],
};

const PACK = {
  name: 'policy_document',
  label: 'Policy document',
  object: 'policy',
  fields: ['title', 'status'],
  related: [{ object: 'policy_revision', fields: ['version'] }],
  body: { field: 'content' },
};

/** An engine over {@link ROWS}: equality `where`, `limit`, and `fields` projection. */
function engine(): IDataEngine {
  return {
    find: vi.fn(async (object: string, query: { where?: Record<string, unknown>; limit?: number; fields?: string[] }) => {
      const where = query.where ?? {};
      const rows = (ROWS[object] ?? [])
        .filter((r) => Object.entries(where).every(([k, v]) => {
          // Equality only: a combinator or operator this double does not implement is refused, never read as a field.
          if (k.startsWith('$') || (v !== null && typeof v === 'object')) throw new Error(`engine double: unsupported where '${k}'`);
          return r[k] === v;
        }))
        .slice(0, query.limit ?? Infinity);
      return query.fields
        ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k === 'id' || query.fields!.includes(k))))
        : rows;
    }),
  } as unknown as IDataEngine;
}

function stdioBridge(packs: unknown[] = [PACK], withService = true, protocol?: Record<string, unknown>): McpDataBridge {
  const metadataService = {
    getObject: async (name: string) => OBJECTS[name],
    listObjects: async () => Object.values(OBJECTS),
    list: async (type: string) => (type === 'ai_context' ? packs : []),
  } as unknown as IMetadataService;
  const tools = createRecordContextTools();
  return createStdioDataBridge({
    engine: engine(),
    metadataService,
    resolvePrincipal: async () => ({ userId: 'u_key', isSystem: false }) as never,
    ...(protocol ? { protocol: () => protocol as never } : {}),
    ...(withService ? { recordContextTools: { recordContextTools: () => tools } } : {}),
  });
}

interface ToolAnswer {
  isError: boolean;
  payload: any;
}

async function overHttp(bridge: McpDataBridge, method: string, params: Record<string, unknown>, grantedScopes?: string[]) {
  const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  const body = { jsonrpc: '2.0', id: 1, method, params };
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, {
    bridge,
    parsedBody: body,
    ...(grantedScopes ? { toolOptions: { grantedScopes } } : {}),
  });
  return ((await res.json()) as any).result;
}

async function overStdio<T>(bridge: McpDataBridge, use: (client: Client) => Promise<T>): Promise<T> {
  const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  runtime.bridgeDataTools(bridge);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await runtime.server.connect(serverSide);
  const client = new Client({ name: 't', version: '1.0.0' });
  await client.connect(clientSide);
  try {
    return await use(client);
  } finally {
    await client.close();
  }
}

const answerOf = (result: any): ToolAnswer => ({
  isError: result?.isError === true,
  payload: JSON.parse(result.content[0].text),
});

async function callBoth(bridge: McpDataBridge, name: string, args: Record<string, unknown>) {
  const http = answerOf(await overHttp(bridge, 'tools/call', { name, arguments: args }));
  const stdio = answerOf(await overStdio(bridge, (c) => c.callTool({ name, arguments: args })));
  return { http, stdio };
}

const contextTool = (tools: Array<{ name: string }>) => tools.find((t) => t.name === GET_RECORD_CONTEXT_TOOL_NAME) as any;

describe('[ADR-0160 D4] get_record_context — registration', () => {
  it('is listed alike on both doors, under the executor\'s description, read-only', async () => {
    const bridge = stdioBridge();
    const http = contextTool((await overHttp(bridge, 'tools/list', {})).tools);
    const stdio = contextTool((await overStdio(bridge, (c) => c.listTools())).tools);
    expect(http).toBeDefined();
    expect(stdio).toEqual(http);
    expect(http.description).toBe(createRecordContextTools().definitions[0].description);
    expect(http.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(Object.keys(http.inputSchema.properties).sort()).toEqual(['anchor', 'context', 'objectName', 'recordId']);
  });

  it('is not listed on a bridge without the record-context service, nor for a grant without data:read', async () => {
    expect(contextTool((await overHttp(stdioBridge([PACK], false), 'tools/list', {})).tools)).toBeUndefined();
    expect(contextTool((await overHttp(stdioBridge(), 'tools/list', {}, [MCP_OAUTH_SCOPE_DATA_WRITE])).tools)).toBeUndefined();
    expect(contextTool((await overHttp(stdioBridge(), 'tools/list', {}, [MCP_OAUTH_SCOPE_DATA_READ])).tools)).toBeDefined();
  });
});

describe('[ADR-0160 D4] get_record_context — transport parity (HTTP and stdio answer alike)', () => {
  it('answers a record through its pack, the same on both doors', async () => {
    const { http, stdio } = await callBoth(stdioBridge(), GET_RECORD_CONTEXT_TOOL_NAME, { objectName: 'policy', recordId: 'p1' });
    expect(http.isError).toBe(false);
    expect(stdio).toEqual(http);
    expect(http.payload.data.pack.name).toBe('policy_document');
    expect(http.payload.data.fields).toEqual([
      { name: 'title', label: 'Title', value: 'Fire cover' },
      { name: 'status', label: 'Status', value: 'active', display: 'Active' },
    ]);
    expect(http.payload.data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['r1', 'r2']);
    expect(http.payload.data.body.text).toBe('# Scope\nCovers fire.');
    expect(typeof http.payload.framing).toBe('string');
  });

  it('refuses alike: a pack name nobody has is one coded answer on both doors', async () => {
    const { http, stdio } = await callBoth(stdioBridge(), GET_RECORD_CONTEXT_TOOL_NAME, {
      objectName: 'policy',
      recordId: 'p1',
      context: 'no_such_pack',
    });
    expect(http.isError).toBe(true);
    expect(stdio).toEqual(http);
    expect(http.payload.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
  });

  it('an unknown record is answered exactly as get_record answers it, on both doors', async () => {
    const args = { objectName: 'policy', recordId: 'nope' };
    const context = await callBoth(stdioBridge(), GET_RECORD_CONTEXT_TOOL_NAME, args);
    const record = await callBoth(stdioBridge(), 'get_record', args);
    expect(context.stdio).toEqual(context.http);
    expect(context.http).toEqual(record.http);
    expect(context.http.payload.error).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
  });

  it('a root whose API exposure refuses the read is answered as get_record answers it', async () => {
    const args = { objectName: 'closed_revision', recordId: 'x1' };
    const context = await callBoth(stdioBridge([{ ...PACK, name: 'closed', object: 'closed_revision', related: undefined, body: undefined, fields: ['version'] }]), GET_RECORD_CONTEXT_TOOL_NAME, args);
    const record = await callBoth(stdioBridge(), 'get_record', args);
    expect(context.stdio).toEqual(context.http);
    expect(context.http.payload.error.code).toBe(record.http.payload.error.code);
    expect(context.http.payload.error.code).toBe('OBJECT_API_DISABLED');
    expect(context.http.payload.error.status).toBe(record.http.payload.error.status);
  });
});

describe('[ADR-0160 D4] get_record_context — the gates the record tools put before the same reads', () => {
  it('a system root is refused by the tool layer\'s read guard before the bridge is asked', async () => {
    const getRecordContext = vi.fn(async () => ({}));
    const bridge = {
      async listObjects() { return []; },
      async describeObject() { return null; },
      async query() { return { records: [] }; },
      async get() { return null; },
      async create() { return {}; },
      async update() { return {}; },
      async remove() { return {}; },
      getRecordContext,
      recordContextToolDefinitions: () => createRecordContextTools().definitions,
    } as McpDataBridge;
    const result = await overHttp(bridge, 'tools/call', {
      name: GET_RECORD_CONTEXT_TOOL_NAME,
      arguments: { objectName: 'sys_note', recordId: 'n1' },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('system object');
    expect(getRecordContext).not.toHaveBeenCalled();
  });

  it('the executor judges a related child with the same guard: a system child refuses the call, unnamed', async () => {
    const pack = { ...PACK, related: [{ object: 'sys_note', fields: ['body'] }] };
    const { http, stdio } = await callBoth(stdioBridge([pack]), GET_RECORD_CONTEXT_TOOL_NAME, { objectName: 'policy', recordId: 'p1' });
    expect(stdio).toEqual(http);
    expect(http.payload.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(JSON.stringify(http.payload)).not.toContain('sys_note');
  });

  it('a related child whose package is disabled refuses the call unnamed, alike on both doors', async () => {
    const disabled = Object.assign(new Error("Object 'policy_revision' belongs to a disabled package"), {
      code: 'OBJECT_PACKAGE_DISABLED',
      status: 404,
      object: 'policy_revision',
    });
    const protocol = {
      async getMetaItemForExecution({ type, name }: { type: string; name: string }) {
        if (type === 'object' && name === 'policy_revision') throw disabled;
        return { type, name, item: type === 'object' ? OBJECTS[name] : undefined };
      },
      async getMetaItems({ type }: { type: string }) {
        return { type, items: type === 'ai_context' ? [PACK] : type === 'object' ? Object.values(OBJECTS) : [] };
      },
    };
    const { http, stdio } = await callBoth(stdioBridge([PACK], true, protocol), GET_RECORD_CONTEXT_TOOL_NAME, { objectName: 'policy', recordId: 'p1' });
    expect(stdio).toEqual(http);
    expect(http.payload.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(JSON.stringify(http.payload)).not.toContain('policy_revision');
  });

  it('a related child its API exposure refuses refuses the call, named (the caller\'s schema shows it)', async () => {
    const pack = { ...PACK, related: [{ object: 'closed_revision', fields: ['version'] }] };
    const { http, stdio } = await callBoth(stdioBridge([pack]), GET_RECORD_CONTEXT_TOOL_NAME, { objectName: 'policy', recordId: 'p1' });
    expect(stdio).toEqual(http);
    expect(http.payload.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(http.payload.error.message).toContain("'closed_revision'");
  });
});

describe('[ADR-0160 D4] get_record_context — a package pack the real protocol serves', () => {
  it('the served listing carries the read decoration, and both doors answer through the pack', async () => {
    const engineOfRecord = new ObjectQL();
    const store = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    await store.initObjects([SysMetadataObject] as never);
    engineOfRecord.registerDriver(store as never, true);
    await engineOfRecord.init();
    engineOfRecord.registry.registerObject(SysMetadataObject as never, '@objectstack/platform-objects');
    engineOfRecord.registerApp({
      id: 'com.objectstack.qa.record-context-stdio',
      name: 'record context stdio',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [OBJECTS.policy, OBJECTS.policy_revision],
      aiContexts: [PACK],
    } as never);
    const protocol = new ObjectStackProtocolImplementation(engineOfRecord as never);
    try {
      // Precondition: the protocol serves the pack decorated, as `/meta/ai_context` does.
      // Were it served bare, this case could not tell a door that strips from one that does not.
      const listed = (await protocol.getMetaItems({ type: 'ai_context' })) as { items: Array<Record<string, unknown>> };
      const served = listed.items.find((p) => p.name === PACK.name);
      expect(served?._packageId).toBe('com.objectstack.qa.record-context-stdio');
      expect(served).toHaveProperty('_diagnostics');

      // No pack on the metadata service: the only listing is the protocol's.
      const bridge = stdioBridge([], true, protocol as unknown as Record<string, unknown>);
      const { http, stdio } = await callBoth(bridge, GET_RECORD_CONTEXT_TOOL_NAME, {
        objectName: 'policy',
        recordId: 'p1',
        context: PACK.name,
      });
      expect(http.isError, JSON.stringify(http.payload)).toBe(false);
      expect(stdio).toEqual(http);
      expect(http.payload.data.pack.name).toBe(PACK.name);
      expect(http.payload.data.related[0].rows.map((r: { id: string }) => r.id)).toEqual(['r1', 'r2']);
    } finally {
      await engineOfRecord.destroy();
    }
  });
});

describe('[ADR-0150 addendum 2026-11-25] get_record_context — the stdio door places each pack\'s package', () => {
  const ALPHA = 'com.acme.sales';
  const BETA = 'com.acme.people';
  const brief = (packageId: string, label: string) => ({
    name: 'brief', label, object: 'policy', fields: ['title'], _packageId: packageId, _provenance: 'package',
  });
  /** The stdio bridge over two packages' same-name packs, its engine's registry placing `namespaces`. */
  function placedBridge(namespaces: Record<string, string> | undefined): McpDataBridge {
    const placed = engine() as IDataEngine & { registry?: unknown };
    if (namespaces) {
      placed.registry = { getPackage: (id: string) => (namespaces[id] ? { manifest: { namespace: namespaces[id] } } : undefined) };
    }
    const tools = createRecordContextTools();
    return createStdioDataBridge({
      engine: placed,
      metadataService: {
        getObject: async (name: string) => OBJECTS[name],
        listObjects: async () => Object.values(OBJECTS),
        list: async (type: string) => (type === 'ai_context' ? [brief(ALPHA, 'Sales brief'), brief(BETA, 'People brief')] : []),
      } as unknown as IMetadataService,
      resolvePrincipal: async () => ({ userId: 'u_key', isSystem: false }) as never,
      recordContextTools: { recordContextTools: () => tools },
    });
  }
  const call = (context: string) => ({ objectName: 'policy', recordId: 'p1', context });

  it('two packages\' packs of one name on one root: each is reached by its face, alike on both transports', async () => {
    const bridge = placedBridge({ [ALPHA]: 'sales', [BETA]: 'people' });
    const sales = await callBoth(bridge, GET_RECORD_CONTEXT_TOOL_NAME, call('sales-brief'));
    const people = await callBoth(bridge, GET_RECORD_CONTEXT_TOOL_NAME, call('people-brief'));
    expect(sales.http.isError, JSON.stringify(sales.http.payload)).toBe(false);
    expect(sales.stdio).toEqual(sales.http);
    expect(sales.http.payload.data.pack).toEqual({ name: 'brief', label: 'Sales brief' });
    expect(people.stdio).toEqual(people.http);
    expect(people.http.payload.data.pack).toEqual({ name: 'brief', label: 'People brief' });
  });

  it('the bare name both packages hold is refused 409, naming each face', async () => {
    const { http, stdio } = await callBoth(placedBridge({ [ALPHA]: 'sales', [BETA]: 'people' }), GET_RECORD_CONTEXT_TOOL_NAME, call('brief'));
    expect(stdio).toEqual(http);
    expect(http.payload.error).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect(http.payload.error.message).toContain('sales-brief');
    expect(http.payload.error.message).toContain('people-brief');
  });

  it('control: an engine whose registry cannot place the packages spells each pack by its bare name, so no face reaches one', async () => {
    const { http } = await callBoth(placedBridge(undefined), GET_RECORD_CONTEXT_TOOL_NAME, call('sales-brief'));
    expect(http.isError).toBe(true);
    expect(http.payload.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
  });
});
