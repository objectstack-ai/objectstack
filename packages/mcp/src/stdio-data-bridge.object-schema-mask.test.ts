// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 D1/D5] The stdio transport's object-schema reads answer the field
 * set every other object-schema exit answers the same caller: `describe_object`,
 * `list_objects`' `fieldCount`, `validate_expression`'s fields in scope and the
 * `objectstack://objects` resources serve no field the principal cannot read.
 *
 * Driven by the SAME case table the REST and dispatcher `/meta` suites run
 * (`OBJECT_SCHEMA_MASK_CASES`, `@objectstack/metadata-core/testing`), so every
 * tier is judged here as it is there: the projection (D1), the three D6
 * failure postures, the D4 exemptions, the D7 fallback and the D8 switch. The
 * table's own matcher reads a `fields` RECORD and the `/meta` document's other
 * positions; `describe_object` answers a field LIST and none of those
 * positions, so the verdict is restated here over what the tool serves:
 *
 *  - `fields` — exactly the present names, in declared order, and no absent
 *    name anywhere in the tool's text, as an identifier token;
 *  - `unmasked` — the answer is byte-identical to the one a deployment with
 *    no security service gets, which is the shape this tool always served;
 *  - `fault` — a coded tool error carrying the `/meta` door's code and status
 *    (`FIELD_VISIBILITY_UNRESOLVED`, 503) and no field.
 *
 * The plugin composition is pinned beneath the table: `MCPServerPlugin` hands
 * the bridge and the object resources the host's `security` service.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import {
  FLS_CONTRACT_ALL_FIELDS,
  FLS_CONTRACT_OBJECT,
  OBJECT_SCHEMA_MASK_CASES,
  securityDoubleFor,
  type ObjectSchemaMaskCase,
} from '@objectstack/metadata-core/testing';
import { OBJECT_SCHEMA_MASK_DISABLE_ENV } from '@objectstack/metadata-core';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import { registerObjectTools } from './mcp-http-tools.js';
import { MCPServerPlugin } from './plugin.js';
import type { MCPServerRuntime } from './mcp-server-runtime.js';

const OBJECT = FLS_CONTRACT_OBJECT.name;
const account = () => JSON.parse(JSON.stringify(FLS_CONTRACT_OBJECT));

/** Does `name` occur in `text` as an identifier token? */
const mentions = (text: string, name: string) => (text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).includes(name);

interface ToolAnswer {
  isError: boolean;
  text: string;
  json: any;
}

/** The stdio bridge under `testCase`'s caller and security service, behind the real tools. */
async function connectBridge(testCase: ObjectSchemaMaskCase | undefined) {
  const security = testCase ? securityDoubleFor(testCase) : undefined;
  const metadataService = {
    listObjects: vi.fn(async () => [account()]),
    getObject: vi.fn(async (name: string) => (name === OBJECT ? account() : undefined)),
  };
  const bridge = createStdioDataBridge({
    engine: {} as unknown as IDataEngine,
    metadataService: metadataService as unknown as IMetadataService,
    resolvePrincipal: async () => ({ ...(testCase?.context ?? { userId: 'u_staff' }) }) as unknown as ExecutionContext,
    ...(security ? { security: () => security } : {}),
  });
  const server = new McpServer({ name: 'pin', version: '0' });
  registerObjectTools(server, bridge);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'pin', version: '0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>): Promise<ToolAnswer> => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
    const text = res.content[0]!.text;
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { isError: res.isError === true, text, json };
  };
  return { call, close: () => client.close() };
}

/** Run `run` with the D8 switch set as `testCase` asks. */
async function underDeployment<T>(testCase: ObjectSchemaMaskCase | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
  if (testCase?.maskingDisabled) process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = '1';
  else delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
    else process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = previous;
  }
}

/** One case's answers from the three tools that serve the object's fields. */
async function answersUnder(testCase: ObjectSchemaMaskCase | undefined) {
  return underDeployment(testCase, async () => {
    const session = await connectBridge(testCase);
    try {
      return {
        described: await session.call('describe_object', { objectName: OBJECT }),
        listed: await session.call('list_objects', {}),
        validated: await session.call('validate_expression', { objectName: OBJECT, expression: 'record.name' }),
      };
    } finally {
      await session.close();
    }
  });
}

/** The answer this tool always served: the declared fields, projected to name/type/label/required. */
const DECLARED_ANSWER = {
  name: FLS_CONTRACT_OBJECT.name,
  label: FLS_CONTRACT_OBJECT.label,
  fields: Object.entries(FLS_CONTRACT_OBJECT.fields as Record<string, any>).map(([name, f]) => ({
    name,
    type: f?.type,
    label: f?.label ?? name,
    required: f?.required ?? false,
  })),
  enableFeatures: (FLS_CONTRACT_OBJECT as { enable?: unknown }).enable ?? {},
};

describe('[ADR-0106] stdio describe_object / list_objects / validate_expression — the shared case table', () => {
  let baseline: Awaited<ReturnType<typeof answersUnder>>;
  beforeEach(async () => {
    // No security service at all: D6 tier 1, the answer as declared.
    baseline = await answersUnder(undefined);
  });

  it('the baseline is the answer this tool always served', () => {
    expect(baseline.described.isError).toBe(false);
    expect(baseline.described.json).toEqual(DECLARED_ANSWER);
    expect(baseline.described.json.fields.map((f: any) => f.name)).toEqual([...FLS_CONTRACT_ALL_FIELDS]);
  });

  for (const testCase of OBJECT_SCHEMA_MASK_CASES) {
    it(testCase.id, async () => {
      const { described, listed, validated } = await answersUnder(testCase);
      const expected = testCase.expect;
      if (expected.kind === 'fault') {
        for (const answer of [described, listed, validated]) {
          expect(answer.isError, `${testCase.id}: refused, never served`).toBe(true);
          expect({ code: answer.json?.error?.code, status: answer.json?.error?.status })
            .toEqual({ code: 'FIELD_VISIBILITY_UNRESOLVED', status: 503 });
          expect(mentions(answer.text, 'salary_grade')).toBe(false);
        }
        return;
      }
      expect(described.isError).toBe(false);
      const fieldCount = listed.json.objects.find((o: any) => o.name === OBJECT)?.fieldCount;
      if (expected.kind === 'unmasked') {
        // Byte-identical to the unrestricted answer, not merely equal in names.
        expect(described.text).toBe(baseline.described.text);
        expect(listed.text).toBe(baseline.listed.text);
        expect(validated.text).toBe(baseline.validated.text);
        expect(fieldCount).toBe(FLS_CONTRACT_ALL_FIELDS.length);
        return;
      }
      expect(described.json.fields.map((f: any) => f.name)).toEqual(
        FLS_CONTRACT_ALL_FIELDS.filter((name) => expected.present.includes(name)),
      );
      expect(fieldCount).toBe(expected.present.length);
      for (const name of expected.absent) {
        for (const answer of [described, listed, validated]) {
          expect(mentions(answer.text, name), `${testCase.id}: '${name}' must not exist for this caller`).toBe(false);
        }
      }
    });
  }
});

describe('[ADR-0106] MCPServerPlugin hands the stdio bridge and the object resources the host security service', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
    process.env.OS_MCP_STDIO_API_KEY = 'osk_object_schema_mask_pin';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  /** The plugin over a security service answering `readable`, and a client on its long-lived server. */
  async function boot(readable: readonly string[] | 'throw') {
    const metadata = {
      listObjects: vi.fn(async () => [account()]),
      getObject: vi.fn(async (name: string) => (name === OBJECT ? account() : null)),
      get: vi.fn(async () => null),
      list: vi.fn(async () => []),
      exists: vi.fn(async () => false),
      getRegisteredTypes: vi.fn(async () => ['object']),
      register: vi.fn(),
      unregister: vi.fn(),
    };
    const objectql = {
      // The stdio principal resolves from this key row and its owner.
      find: vi.fn(async (object: string, query?: any) => {
        if (object === 'sys_api_key') return [{ id: 'k1', user_id: 'usr_stdio', revoked: false }];
        if (object === 'sys_user') return query?.where?.id === 'usr_stdio' ? [{ id: 'usr_stdio' }] : [];
        return [];
      }),
      update: vi.fn(async () => ({})),
    };
    const answer = async () => {
      if (readable === 'throw') throw new Error('security service unhealthy (test)');
      return [...readable];
    };
    const security = { getReadableFields: vi.fn(answer), getMetadataReadableFields: vi.fn(answer) };
    const registry = new Map<string, unknown>([['metadata', metadata], ['objectql', objectql], ['security', security]]);
    const ctx: any = {
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
    const plugin = new MCPServerPlugin({ autoStart: true });
    await plugin.init(ctx);
    const runtime = registry.get('mcp') as MCPServerRuntime;
    // `start()` would claim this process's real stdin/stdout.
    vi.spyOn(runtime, 'start').mockResolvedValue(undefined);
    await plugin.start(ctx);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await runtime.server.connect(serverSide);
    const client = new Client({ name: 'pin', version: '0' });
    await client.connect(clientSide);
    const tool = async (name: string, args: Record<string, unknown>) => {
      const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
      return { isError: res.isError === true, text: res.content[0]!.text };
    };
    const resource = async (uri: string) => {
      const res = await client.readResource({ uri });
      return (res.contents[0] as { text: string }).text;
    };
    return { tool, resource, security, close: () => client.close() };
  }

  it('a field the key principal cannot read is in neither the tools nor the resources', async () => {
    const k = await boot(['id', 'name']);
    try {
      const described = await k.tool('describe_object', { objectName: OBJECT });
      expect(described.isError).toBe(false);
      expect(JSON.parse(described.text).fields.map((f: any) => f.name)).toEqual(['id', 'name']);
      const schema = await k.resource(`objectstack://objects/${OBJECT}`);
      expect(JSON.parse(schema).fields.map((f: any) => f.name)).toEqual(['id', 'name']);
      const listing = JSON.parse(await k.resource('objectstack://objects'));
      expect(listing.objects.find((o: any) => o.name === OBJECT)?.fieldCount).toBe(2);
      for (const text of [described.text, schema]) {
        expect(mentions(text, 'salary_grade')).toBe(false);
        expect(mentions(text, 'bonus_formula')).toBe(false);
      }
      // Asked about the key's own principal, never a system context.
      const [, context] = k.security.getMetadataReadableFields.mock.calls[0] as unknown as [string, any];
      expect(context.userId).toBe('usr_stdio');
      expect(context.isSystem).toBe(false);
    } finally {
      await k.close();
    }
  });

  it('a field visibility that cannot be evaluated refuses the tool and the resources with the door code', async () => {
    const k = await boot('throw');
    try {
      const described = await k.tool('describe_object', { objectName: OBJECT });
      expect(described.isError).toBe(true);
      expect(JSON.parse(described.text).error).toMatchObject({ code: 'FIELD_VISIBILITY_UNRESOLVED', status: 503 });
      for (const uri of [`objectstack://objects/${OBJECT}`, 'objectstack://objects']) {
        const body = JSON.parse(await k.resource(uri));
        expect({ code: body.code, status: body.status }).toEqual({ code: 'FIELD_VISIBILITY_UNRESOLVED', status: 503 });
        expect(body.fields).toBeUndefined();
        expect(body.objects).toBeUndefined();
      }
    } finally {
      await k.close();
    }
  });

  it('CONTROL — a principal who may read every field is served the declared answer on both', async () => {
    const k = await boot([...FLS_CONTRACT_ALL_FIELDS]);
    try {
      const described = await k.tool('describe_object', { objectName: OBJECT });
      expect(JSON.parse(described.text)).toEqual(DECLARED_ANSWER);
      expect(JSON.parse(await k.resource(`objectstack://objects/${OBJECT}`)).fields.map((f: any) => f.name))
        .toEqual([...FLS_CONTRACT_ALL_FIELDS]);
    } finally {
      await k.close();
    }
  });
});
