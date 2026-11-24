// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35137] `query_records` and `get_record` name the fields field-level
 * security withheld from the caller (`withheldFields`, with a note), so a
 * left-out field is said to be not visible, never read as blank.
 *
 * The rule: a field is named only when the caller's own served schema shows
 * it AND the security service does not answer it readable — both the
 * framework's answers, asked as the caller (`McpDataBridge.fieldVisibilityOf`),
 * never derived from rows. A field the served schema does not show is never
 * named, anywhere in the result.
 *
 * Two halves:
 *  1. the tool layer every door shares, over the HTTP runtime with a bridge
 *     whose two answers the case sets;
 *  2. the stdio bridge itself (`createStdioDataBridge`): its served schema is
 *     the object-schema mask's (ADR-0106), so the same security answers name
 *     a field for a caller whose schema shows it (a D4-exempt caller, or the
 *     D8 switch off) and for no caller whose schema hides it.
 * The HTTP bridge's two answers are pinned on the real security layer in
 * `packages/runtime/src/domains/mcp-object-schema-mask.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { OBJECT_SCHEMA_MASK_DISABLE_ENV } from '@objectstack/metadata-core';
import { SEARCH_COMPANION_FIELD } from '@objectstack/spec/data';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import { registerObjectTools, type McpDataBridge, type McpFieldVisibility } from './mcp-http-tools.js';
import { createStdioDataBridge } from './stdio-data-bridge.js';

const OBJECT = 'crm_rate_card';
const HIDDEN = 'secret_margin';

/** Does `name` occur in `text` as an identifier token? */
const mentions = (text: string, name: string) => (text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? ([] as string[])).includes(name);

// ── 1. The tool layer ──────────────────────────────────────────────────────

const ROW = { id: 'r1', name: 'Ada', notes: null };

function makeBridge(visibility?: McpDataBridge['fieldVisibilityOf']): McpDataBridge {
  const bridge: any = {
    async listObjects() { return [{ name: OBJECT, label: 'Rate card' }]; },
    async describeObject(name: string) { return { name }; },
    async query(object: string) { return { object, records: [{ ...ROW }], total: 1 }; },
    async get() { return { ...ROW }; },
    async create(object: string, data: any) { return { object, data }; },
    async update(object: string, id: string) { return { object, id }; },
    async remove(object: string, id: string) { return { object, id, success: true }; },
  };
  if (visibility) bridge.fieldVisibilityOf = visibility;
  return bridge;
}

const answering = (v: McpFieldVisibility) => async () => v;

async function callTool(bridge: McpDataBridge, name: string, args: Record<string, unknown>) {
  const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, { bridge, parsedBody: body });
  const json: any = await res.json();
  expect(json.result?.isError, JSON.stringify(json)).toBeFalsy();
  const text: string = json.result.content[0].text;
  return { text, payload: JSON.parse(text) };
}

const queryRecords = (bridge: McpDataBridge, args: Record<string, unknown> = {}) =>
  callTool(bridge, 'query_records', { objectName: OBJECT, ...args });
const getRecord = (bridge: McpDataBridge) => callTool(bridge, 'get_record', { objectName: OBJECT, recordId: 'r1' });

describe('query_records / get_record — withheldFields, the tool layer', () => {
  /** The caller's schema shows `cost_rate`; the security service does not answer it readable. */
  const WITHHELD = { served: ['id', 'name', 'notes', 'cost_rate'], readable: ['id', 'name', 'notes'] };

  it('a field the served schema shows and the readable answer leaves out is named, with the note', async () => {
    for (const { payload } of [await queryRecords(makeBridge(answering(WITHHELD))), await getRecord(makeBridge(answering(WITHHELD)))]) {
      expect(payload.withheldFields).toEqual(['cost_rate']);
      expect(typeof payload.withheldFieldsNote).toBe('string');
      expect(payload.withheldFieldsNote).toMatch(/not visible to you/);
      expect(payload.withheldFieldsNote).toMatch(/never say they are empty/);
      // Names only: the note names no field, and no value is added anywhere.
      expect(mentions(payload.withheldFieldsNote, 'cost_rate')).toBe(false);
    }
    const { payload } = await queryRecords(makeBridge(answering(WITHHELD)));
    expect(payload.records).toEqual([ROW]);
    expect(payload.total).toBe(1);
  });

  it('a field the served schema does not show is never named, anywhere in the result, even when asked for', async () => {
    // The readable answer leaves it out too; the served schema not showing it is what decides.
    const bridge = makeBridge(answering({ served: ['id', 'name', 'notes'], readable: ['id', 'name', 'notes'] }));
    const asked = await queryRecords(bridge, { fields: ['name', HIDDEN] });
    expect(mentions(asked.text, HIDDEN)).toBe(false);
    expect(asked.payload.withheldFields).toBeUndefined();
    const whole = await getRecord(bridge);
    expect(mentions(whole.text, HIDDEN)).toBe(false);
  });

  it('a readable field with an empty value is not named', async () => {
    const { payload } = await queryRecords(makeBridge(answering(WITHHELD)));
    expect(payload.records[0].notes).toBeNull();
    expect(payload.withheldFields).not.toContain('notes');
  });

  it('only the fields the call asked for are named when it asks for some', async () => {
    const none = await queryRecords(makeBridge(answering(WITHHELD)), { fields: ['name', 'notes'] });
    expect(none.payload.withheldFields).toBeUndefined();
    expect(none.payload.withheldFieldsNote).toBeUndefined();
    const one = await queryRecords(makeBridge(answering(WITHHELD)), { fields: ['name', 'cost_rate', 'cost_rate'] });
    expect(one.payload.withheldFields).toEqual(['cost_rate']);
  });

  it('a caller with nothing withheld gets no member and no note — the answer is byte-identical to before', async () => {
    const unrestricted = makeBridge(answering({ served: ['id', 'name', 'notes'], readable: ['id', 'name', 'notes', 'created_at'] }));
    const before = makeBridge(undefined);
    expect((await queryRecords(unrestricted)).text).toBe((await queryRecords(before)).text);
    expect((await getRecord(unrestricted)).text).toBe((await getRecord(before)).text);
    expect((await queryRecords(unrestricted)).payload).toEqual({ object: OBJECT, records: [ROW], total: 1, source: expect.any(Object) });
  });

  it('a bridge that cannot answer, or whose answer throws, names nothing and never fails the read', async () => {
    for (const visibility of [async () => undefined, async () => { throw new Error('security service unhealthy (test)'); }]) {
      const { payload } = await queryRecords(makeBridge(visibility));
      expect(payload).toEqual({ object: OBJECT, records: [ROW], total: 1, source: expect.any(Object) });
      expect((await getRecord(makeBridge(visibility))).payload).toEqual(ROW);
    }
  });

  it('beside a delegation narrowing, both are stated', async () => {
    const bridge: any = makeBridge(answering(WITHHELD));
    bridge.diagnoseDelegation = async () => ({ narrowed: true, statement: 'Narrowed by the agent ceiling.' });
    const { payload } = await queryRecords(bridge);
    expect(payload.withheldFields).toEqual(['cost_rate']);
    expect(payload.delegationNarrowed).toBe(true);
  });
});

// ── 2. The stdio bridge ────────────────────────────────────────────────────

const DECLARED = () => ({
  name: OBJECT,
  label: 'Rate card',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    notes: { name: 'notes', type: 'text', label: 'Notes' },
    [HIDDEN]: { name: HIDDEN, type: 'currency', label: 'Secret margin' },
  },
});
/** What the data plane serves a caller denied {@link HIDDEN}: the key deleted. */
const SERVED_ROW = { id: 'r1', name: 'Ada', notes: null };
const READABLE = ['id', 'name', 'notes'];

/** A security service that denies {@link HIDDEN} on both planes, as field-level security does. */
const denyingSecurity = () => ({
  getReadableFields: vi.fn(async () => [...READABLE]),
  getMetadataReadableFields: vi.fn(async () => [...READABLE]),
  canReadObject: async () => true,
});

async function stdioSession(
  context: Record<string, unknown>,
  security?: Record<string, unknown>,
  declared: () => ReturnType<typeof DECLARED> = DECLARED,
) {
  const engine = {
    find: vi.fn(async () => [{ ...SERVED_ROW }]),
  } as unknown as IDataEngine;
  const bridge = createStdioDataBridge({
    engine,
    metadataService: {
      listObjects: async () => [declared()],
      getObject: async (name: string) => (name === OBJECT ? declared() : undefined),
    } as unknown as IMetadataService,
    resolvePrincipal: async () => ({ ...context }) as unknown as ExecutionContext,
    ...(security ? { security: () => security } : {}),
  });
  const server = new McpServer({ name: 'pin', version: '0' });
  registerObjectTools(server, bridge);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'pin', version: '0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
    const text = res.content[0]!.text;
    expect(res.isError, text).toBeFalsy();
    return { text, payload: JSON.parse(text) };
  };
  return {
    query: (args: Record<string, unknown> = {}) => call('query_records', { objectName: OBJECT, ...args }),
    get: () => call('get_record', { objectName: OBJECT, recordId: 'r1' }),
    describe: () => call('describe_object', { objectName: OBJECT }),
    close: () => client.close(),
  };
}

const MEMBER = { userId: 'u_member', systemPermissions: [] };
/** ADR-0106 D4: may write the schema, so is served all of it, while field-level security still withholds data. */
const AUTHOR = { userId: 'u_author', systemPermissions: ['manage_metadata'] };

describe('stdio bridge — withheldFields from the served schema and the readable answer', () => {
  let previousSwitch: string | undefined;
  beforeEach(() => {
    previousSwitch = process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
    delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
  });
  afterEach(() => {
    if (previousSwitch === undefined) delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
    else process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = previousSwitch;
  });

  it('a caller whose served schema shows the field is told it is withheld, on query_records and get_record', async () => {
    const session = await stdioSession(AUTHOR, denyingSecurity());
    try {
      expect(mentions((await session.describe()).text, HIDDEN), 'precondition: the schema shows it').toBe(true);
      for (const { payload } of [await session.query(), await session.get()]) {
        expect(payload.withheldFields).toEqual([HIDDEN]);
        expect(payload.withheldFieldsNote).toMatch(/not visible to you/);
      }
      expect((await session.query()).payload.records).toEqual([SERVED_ROW]);
    } finally {
      await session.close();
    }
  });

  it('a caller whose served schema hides the field never sees it named, even asking for it', async () => {
    const session = await stdioSession(MEMBER, denyingSecurity());
    try {
      expect(mentions((await session.describe()).text, HIDDEN), 'precondition: the schema hides it').toBe(false);
      for (const { text, payload } of [await session.query({ fields: ['name', HIDDEN] }), await session.query(), await session.get()]) {
        expect(mentions(text, HIDDEN)).toBe(false);
        expect(payload.withheldFields).toBeUndefined();
        expect(payload.withheldFieldsNote).toBeUndefined();
      }
    } finally {
      await session.close();
    }
  });

  it('with the D8 switch off the schema shows the field to the member, so it is named', async () => {
    process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = '1';
    const session = await stdioSession(MEMBER, denyingSecurity());
    try {
      expect((await session.query()).payload.withheldFields).toEqual([HIDDEN]);
    } finally {
      await session.close();
    }
  });

  it('the served list is describe_object\'s field list, on an object served with a column describe_object does not list', async () => {
    const withCompanion = () => {
      const def = DECLARED();
      return { ...def, fields: { ...def.fields, [SEARCH_COMPANION_FIELD]: { name: SEARCH_COMPANION_FIELD, type: 'text', label: 'Search' } } };
    };
    const session = await stdioSession(AUTHOR, denyingSecurity(), withCompanion as unknown as typeof DECLARED);
    try {
      const described = (await session.describe()).payload.fields.map((f: { name: string }) => f.name);
      expect(described, 'precondition: describe_object does not list the column').not.toContain(SEARCH_COMPANION_FIELD);
      for (const { payload } of [await session.query(), await session.get()]) {
        expect(payload.withheldFields).toEqual([HIDDEN]);
      }
    } finally {
      await session.close();
    }
  });

  it('CONTROL — nothing withheld, or no security service: no member, and the readable answer is asked as the principal', async () => {
    const security = { ...denyingSecurity(), getReadableFields: vi.fn(async () => [...READABLE, HIDDEN]) };
    const unrestricted = await stdioSession(AUTHOR, security);
    const unsecured = await stdioSession(AUTHOR, undefined);
    try {
      const a = await unrestricted.query();
      expect(a.payload).toEqual({ object: OBJECT, records: [SERVED_ROW], hasMore: false, source: expect.any(Object) });
      expect(security.getReadableFields).toHaveBeenCalledWith(OBJECT, expect.objectContaining({ userId: AUTHOR.userId }));
      expect((await unsecured.query()).text).toBe(a.text);
      expect((await unsecured.get()).payload).toEqual(SERVED_ROW);
    } finally {
      await unrestricted.close();
      await unsecured.close();
    }
  });
});
