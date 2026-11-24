// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34872] The stdio transport's `list_objects` and `describe_object` answer
 * the object's and each field's label, option labels and descriptions in the
 * locale this transport speaks: it carries no request, so that is the i18n
 * service's default (what `metaRequestLocale` answers with no header), the
 * reading the stdio `list_datasets` localizes with. The translation is the
 * `/meta` object door's own (`translateMetaList`), applied to the object as
 * the principal is served it (ADR-0106 D3/D5): a masked field stays absent,
 * its translated text with it. An `en` default with no entry, or no i18n
 * service the host can resolve, serves the authored text. Names never change.
 *
 * Driven through the real tools (`registerObjectTools`) over the stdio bridge,
 * with a security service built by the shared ADR-0106 double
 * (`securityDoubleFor`). The HTTP twin is
 * `packages/runtime/src/domains/mcp-object-locale-34872.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { securityDoubleFor } from '@objectstack/metadata-core/testing';
import { OBJECT_SCHEMA_MASK_DISABLE_ENV } from '@objectstack/metadata-core';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import { registerObjectTools } from './mcp-http-tools.js';
import { MCPServerPlugin } from './plugin.js';
import type { MCPServerRuntime } from './mcp-server-runtime.js';

const OBJ = 'deal';
const PLAIN = 'plain';
const DENIED = 'secret_margin';
const OBJECT_TEXT = 'A sales deal, from first call to signed order.';
const AMOUNT_TEXT = 'Amount, tax excluded.';
const DENIED_TEXT = 'Internal margin after rebates.';

const deal = () => ({
  name: OBJ,
  label: 'Deal',
  description: OBJECT_TEXT,
  fields: {
    id: { name: 'id', type: 'text', label: 'ID' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    amount: { name: 'amount', type: 'currency', label: 'Amount', description: AMOUNT_TEXT },
    stage: {
      name: 'stage', type: 'select', label: 'Stage',
      options: [{ value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }],
    },
    [DENIED]: { name: DENIED, type: 'currency', label: 'Margin', description: DENIED_TEXT },
  },
});
const plain = () => ({ name: PLAIN, label: 'Plain', fields: { id: { name: 'id', type: 'text' }, title: { name: 'title', type: 'text', label: 'Title' } } });

/** The zh-CN bundle: the deal, its fields (`help` is the bundle key a field's description is served from) and one option. */
const ZH_CN = {
  objects: {
    [OBJ]: {
      label: '交易',
      description: '一笔销售交易，从首次接触到签单。',
      fields: {
        subject: { label: '主题' },
        amount: { label: '金额', help: '金额，不含税。' },
        stage: { label: '阶段', options: { won: '赢单' } },
        [DENIED]: { label: '毛利', help: '返利后的内部毛利。' },
      },
    },
  },
};

/** An i18n service double: the zh-CN bundle above, an empty `en` one, and the default the case names. */
function i18nService(defaultLocale: string) {
  const bundles: Record<string, unknown> = { 'zh-CN': ZH_CN, en: {} };
  return {
    getLocales: () => Object.keys(bundles),
    getTranslations: (locale: string) => bundles[locale],
    getDefaultLocale: () => defaultLocale,
  };
}

/**
 * The real tools over the stdio bridge, the principal reading `readable`
 * (every field when omitted), localized by `i18n` (no i18n dependency when omitted).
 */
async function connect(opts: { readable?: readonly string[]; i18n?: () => unknown } = {}) {
  const { readable, i18n } = opts;
  const security = readable
    ? securityDoubleFor({
        id: 'restricted-caller/34872',
        why: 'a principal denied one field',
        context: { userId: 'u_member', systemPermissions: [] },
        readable: [...readable],
        expect: { kind: 'unmasked' },
      } as never)
    : undefined;
  const defs = () => [deal(), plain()];
  const bridge = createStdioDataBridge({
    engine: {} as unknown as IDataEngine,
    metadataService: {
      listObjects: vi.fn(async () => defs()),
      getObject: vi.fn(async (name: string) => defs().find((d) => d.name === name)),
    } as unknown as IMetadataService,
    resolvePrincipal: async () => ({ userId: 'u_member', systemPermissions: [] }) as unknown as ExecutionContext,
    ...(security ? { security: () => security } : {}),
    ...(i18n ? { i18n } : {}),
  });
  const server = new McpServer({ name: 'pin', version: '0' });
  registerObjectTools(server, bridge);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'pin', version: '0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>): Promise<{ text: string; json: any; isError: boolean }> => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
    const text = res.content[0]!.text;
    return { text, json: JSON.parse(text), isError: res.isError === true };
  };
  return { call, close: () => client.close() };
}

const prevMask = process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
beforeEach(() => { delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV]; });
afterEach(() => {
  if (prevMask === undefined) delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
  else process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = prevMask;
});

/** Every field but the denied one (the double answers one readable set for every object). */
const MEMBER_READS = ['id', 'subject', 'amount', 'stage', 'title'] as const;

const field = (described: any, name: string) => described.fields.find((f: any) => f.name === name);

describe('[#34872] stdio list_objects and describe_object serve labels and descriptions in the default locale', () => {
  it('describe_object under a zh-CN default: the object\'s and each field\'s label, description and option label are the bundle\'s; names never change', async () => {
    const session = await connect({ i18n: () => i18nService('zh-CN') });
    try {
      const described = await session.call('describe_object', { objectName: OBJ });
      expect(described.isError).toBe(false);
      expect(described.json).toMatchObject({ name: OBJ, label: '交易', description: '一笔销售交易，从首次接触到签单。' });
      expect(field(described.json, 'subject')).toMatchObject({ name: 'subject', label: '主题' });
      expect(field(described.json, 'amount')).toMatchObject({ name: 'amount', label: '金额', description: '金额，不含税。' });
      expect(field(described.json, 'stage')).toMatchObject({
        name: 'stage',
        label: '阶段',
        options: [{ value: 'won', label: '赢单' }, { value: 'lost', label: 'Lost' }],
      });
    } finally {
      await session.close();
    }
  });

  it('list_objects under a zh-CN default: each object\'s label and description are the bundle\'s; an object the bundle does not carry keeps its own', async () => {
    const session = await connect({ readable: MEMBER_READS, i18n: () => i18nService('zh-CN') });
    try {
      const listed = (await session.call('list_objects', {})).json;
      const found = (name: string) => listed.objects.find((o: any) => o.name === name);
      expect(found(OBJ)).toEqual({ name: OBJ, label: '交易', description: '一笔销售交易，从首次接触到签单。', fieldCount: 4 });
      expect(found(PLAIN)).toEqual({ name: PLAIN, label: 'Plain', fieldCount: 2 });
    } finally {
      await session.close();
    }
  });

  it('a field the principal cannot read stays absent under translation, its translated label and description with it', async () => {
    const session = await connect({ readable: MEMBER_READS, i18n: () => i18nService('zh-CN') });
    try {
      const described = await session.call('describe_object', { objectName: OBJ });
      expect(described.json.label).toBe('交易');
      expect(field(described.json, DENIED)).toBeUndefined();
      for (const leaked of ['毛利', '返利后的内部毛利。', 'Margin', DENIED_TEXT]) expect(described.text).not.toContain(leaked);
    } finally {
      await session.close();
    }
  });

  it('an `en` default with no entry: the authored labels, descriptions and option labels', async () => {
    const session = await connect({ i18n: () => i18nService('en') });
    try {
      const described = (await session.call('describe_object', { objectName: OBJ })).json;
      expect(described).toMatchObject({ name: OBJ, label: 'Deal', description: OBJECT_TEXT });
      expect(field(described, 'amount')).toMatchObject({ label: 'Amount', description: AMOUNT_TEXT });
      expect(field(described, 'stage').options).toEqual([{ value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]);
      const listed = (await session.call('list_objects', {})).json;
      expect(listed.objects.find((o: any) => o.name === OBJ)).toMatchObject({ label: 'Deal', description: OBJECT_TEXT });
    } finally {
      await session.close();
    }
  });

  it('an i18n service the host cannot resolve (its resolver throws), or none: the authored text, never an error', async () => {
    for (const i18n of [() => { throw new Error('i18n not registered'); }, undefined]) {
      const session = await connect({ ...(i18n ? { i18n } : {}) });
      try {
        const described = await session.call('describe_object', { objectName: OBJ });
        expect(described.isError).toBe(false);
        expect(described.json).toMatchObject({ label: 'Deal', description: OBJECT_TEXT });
        const listed = (await session.call('list_objects', {})).json;
        expect(listed.objects.find((o: any) => o.name === OBJ)).toMatchObject({ label: 'Deal', description: OBJECT_TEXT });
      } finally {
        await session.close();
      }
    }
  });
});

describe('[#34995] the stdio object resources serve labels in the locale the object tools speak', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
    process.env.OS_MCP_STDIO_API_KEY = 'osk_object_locale_resource_pin';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  /**
   * `MCPServerPlugin` over a host registering `i18n` (none when omitted) and a
   * security service answering `readable`, and a client on its long-lived
   * server: the composition that hands the tools and the resources their views.
   */
  async function boot(opts: { readable: readonly string[]; i18n?: unknown }) {
    const defs = () => [deal(), plain()];
    const metadata = {
      listObjects: vi.fn(async () => defs()),
      getObject: vi.fn(async (name: string) => defs().find((d) => d.name === name) ?? null),
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
      getSchema: vi.fn(() => undefined),
    };
    const answer = async () => [...opts.readable];
    const security = { getReadableFields: vi.fn(answer), getMetadataReadableFields: vi.fn(answer) };
    const registry = new Map<string, unknown>([['metadata', metadata], ['objectql', objectql], ['security', security]]);
    if (opts.i18n) registry.set('i18n', opts.i18n);
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
      return { isError: res.isError === true, text: res.content[0]!.text, json: JSON.parse(res.content[0]!.text) };
    };
    const resource = async (uri: string) => {
      const res = await client.readResource({ uri });
      const text = (res.contents[0] as { text: string }).text;
      return { text, json: JSON.parse(text) };
    };
    return { tool, resource, close: () => client.close() };
  }

  /** Each listed object's name and label. */
  const labelsOf = (listed: any) => Object.fromEntries(listed.objects.map((o: any) => [o.name, o.label]));

  it('under a zh-CN default: each resource serves the bundle\'s labels, exactly as describe_object and list_objects do', async () => {
    const k = await boot({ readable: MEMBER_READS, i18n: i18nService('zh-CN') });
    try {
      const schema = await k.resource(`objectstack://objects/${OBJ}`);
      expect(schema.json).toMatchObject({ name: OBJ, label: '交易', description: '一笔销售交易，从首次接触到签单。' });
      expect(field(schema.json, 'subject')).toMatchObject({ name: 'subject', label: '主题' });
      expect(field(schema.json, 'amount')).toMatchObject({ name: 'amount', label: '金额', description: '金额，不含税。' });
      expect(field(schema.json, 'stage').options).toEqual([{ value: 'won', label: '赢单' }, { value: 'lost', label: 'Lost' }]);
      const listing = await k.resource('objectstack://objects');
      expect(labelsOf(listing.json)).toEqual({ [OBJ]: '交易', [PLAIN]: 'Plain' });

      // The card's done-when: a resource read and a tool call for the same object answer the same labels.
      const described = await k.tool('describe_object', { objectName: OBJ });
      expect(described.isError).toBe(false);
      expect(schema.json).toEqual(described.json);
      expect(labelsOf(listing.json)).toEqual(labelsOf((await k.tool('list_objects', {})).json));
    } finally {
      await k.close();
    }
  });

  it('a field the principal cannot read stays absent from the translated resources, its translated text with it', async () => {
    const k = await boot({ readable: MEMBER_READS, i18n: i18nService('zh-CN') });
    try {
      const schema = await k.resource(`objectstack://objects/${OBJ}`);
      expect(schema.json.label).toBe('交易');
      expect(field(schema.json, DENIED)).toBeUndefined();
      for (const leaked of [DENIED, '毛利', '返利后的内部毛利。', 'Margin', DENIED_TEXT]) expect(schema.text).not.toContain(leaked);
      const listing = await k.resource('objectstack://objects');
      expect(listing.json.objects.find((o: any) => o.name === OBJ)?.fieldCount).toBe(4);
    } finally {
      await k.close();
    }
  });

  it('an `en` default with no entry, or no i18n service on the host: the authored labels on the resources and the tools alike', async () => {
    for (const i18n of [i18nService('en'), undefined]) {
      const k = await boot({ readable: MEMBER_READS, ...(i18n ? { i18n } : {}) });
      try {
        const schema = await k.resource(`objectstack://objects/${OBJ}`);
        expect(schema.json).toMatchObject({ name: OBJ, label: 'Deal', description: OBJECT_TEXT });
        expect(field(schema.json, 'amount')).toMatchObject({ label: 'Amount', description: AMOUNT_TEXT });
        expect(schema.json).toEqual((await k.tool('describe_object', { objectName: OBJ })).json);
        const listing = await k.resource('objectstack://objects');
        expect(labelsOf(listing.json)).toEqual({ [OBJ]: 'Deal', [PLAIN]: 'Plain' });
        expect(labelsOf(listing.json)).toEqual(labelsOf((await k.tool('list_objects', {})).json));
      } finally {
        await k.close();
      }
    }
  });
});
