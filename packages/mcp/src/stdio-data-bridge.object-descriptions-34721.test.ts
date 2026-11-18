// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34721] The stdio transport's `list_objects` and `describe_object` answer
 * the object's and each field's AUTHORED `description`, read off the object
 * as the principal is served it (ADR-0106 D5): a field the principal cannot
 * read is withheld with its description, and a definition that authors none
 * keeps the shape it always had (no `description` key). Driven through the
 * real tools (`registerObjectTools`) over the stdio bridge, with a security
 * service built by the shared ADR-0106 double (`securityDoubleFor`).
 *
 * The HTTP twin is `packages/runtime/src/domains/mcp-object-descriptions-34721.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { securityDoubleFor } from '@objectstack/metadata-core/testing';
import { OBJECT_SCHEMA_MASK_DISABLE_ENV } from '@objectstack/metadata-core';
import { AUDIT_FIELD_DEFS } from '@objectstack/spec/data';
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
    blank_note: { name: 'blank_note', type: 'text', label: 'Note', description: '   ' },
    [DENIED]: { name: DENIED, type: 'currency', label: 'Margin', description: DENIED_TEXT },
    // [#34877] A platform-injected column, as the registry serves it beside the declared fields.
    created_at: { name: 'created_at', ...AUDIT_FIELD_DEFS.created_at },
  },
});
const plain = () => ({ name: PLAIN, label: 'Plain', fields: { id: { name: 'id', type: 'text' }, title: { name: 'title', type: 'text' } } });

/** The real tools over the stdio bridge, the principal reading `readable` (every field when omitted). */
async function connect(readable?: readonly string[]) {
  const security = readable
    ? securityDoubleFor({
        id: 'restricted-caller/34721',
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
  return { call, listTools: () => client.listTools(), close: () => client.close() };
}

const prevMask = process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
beforeEach(() => { delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV]; });
afterEach(() => {
  if (prevMask === undefined) delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
  else process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = prevMask;
});

/** Every field but the denied one (the double answers one readable set for every object). */
const MEMBER_READS = ['id', 'subject', 'amount', 'blank_note', 'created_at', 'title'] as const;

const field = (described: any, name: string) => described.fields.find((f: any) => f.name === name);

describe('[#34721] stdio list_objects and describe_object serve the authored descriptions, as the principal is served the object', () => {
  it('describe_object: a readable field\'s description is returned, a field the principal cannot read is withheld with its description', async () => {
    const session = await connect(MEMBER_READS);
    try {
      const described = await session.call('describe_object', { objectName: OBJ });
      expect(described.isError).toBe(false);
      expect(described.json.description).toBe(OBJECT_TEXT);
      expect(field(described.json, 'amount')).toMatchObject({ name: 'amount', label: 'Amount', description: AMOUNT_TEXT });
      expect(field(described.json, DENIED)).toBeUndefined();
      expect(described.text).not.toContain(DENIED_TEXT);
    } finally {
      await session.close();
    }
  });

  it('CONTROL — a principal who may read every field is returned that field\'s description', async () => {
    const session = await connect();
    try {
      const described = await session.call('describe_object', { objectName: OBJ });
      expect(field(described.json, DENIED)).toMatchObject({ name: DENIED, description: DENIED_TEXT });
    } finally {
      await session.close();
    }
  });

  it('describe_object: a field or object that authors no description (or a blank one) carries no description key', async () => {
    const session = await connect(MEMBER_READS);
    try {
      const described = (await session.call('describe_object', { objectName: OBJ })).json;
      expect('description' in field(described, 'subject')).toBe(false);
      expect('description' in field(described, 'blank_note')).toBe(false);
      expect('description' in (await session.call('describe_object', { objectName: PLAIN })).json).toBe(false);
    } finally {
      await session.close();
    }
  });

  it('list_objects: each object\'s authored description, and no key on an object that authors none', async () => {
    const session = await connect(MEMBER_READS);
    try {
      const listed = (await session.call('list_objects', {})).json;
      const found = (name: string) => listed.objects.find((o: any) => o.name === name);
      expect(found(OBJ)).toEqual({ name: OBJ, label: 'Deal', description: OBJECT_TEXT, fieldCount: 5 });
      expect(found(PLAIN)).toEqual({ name: PLAIN, label: 'Plain', fieldCount: 2 });
    } finally {
      await session.close();
    }
  });
});

describe('[#34877] the describe_object tool description says whose words a field description carries', () => {
  it('names the author\'s and the platform\'s text, and an injected column\'s description is answered with system: true', async () => {
    const session = await connect(MEMBER_READS);
    try {
      const { tools } = await session.listTools();
      const description = tools.find((t) => t.name === 'describe_object')!.description!;
      expect(description).toContain('description (where set: the author\'s, or the platform\'s on a column it injects)');
      expect(description).not.toContain('description (where written)');
      const described = (await session.call('describe_object', { objectName: OBJ })).json;
      expect(field(described, 'created_at')).toMatchObject({ description: AUDIT_FIELD_DEFS.created_at.description, system: true });
      expect(field(described, 'amount')).toMatchObject({ description: AMOUNT_TEXT, system: false });
    } finally {
      await session.close();
    }
  });
});
