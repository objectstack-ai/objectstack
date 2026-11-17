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
