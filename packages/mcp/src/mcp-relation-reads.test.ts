// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35145] `query_records`' `expand` and `get_record`'s `related`: a record
 * with the records it points at, and a parent with its children, in one call.
 *
 * The tool half, against a recording bridge:
 *
 * - ⭐ THE RULE: every object a new read shape reaches is judged by the MCP
 *   read guard exactly as the named object is. A target the guard refuses
 *   refuses the whole call with a coded `PERMISSION_DENIED`, and nothing is
 *   read (no `query`, no `get`);
 * - a name that is not a reference field of the object as the caller is
 *   served it, or a link field that does not point at the parent, is a coded
 *   `INVALID_FIELD`, before any read;
 * - the bounds: at most 3 expand fields, at most 3 related lists, at most 20
 *   rows a list (never above `maxQueryLimit`); a capped list answers
 *   `truncated: true` from the probe row, as a capped `query_records` page;
 * - a related list is read only after the parent record was, filtered by the
 *   link to it alone.
 *
 * The stdio bridge half: `expand` is built as the data door builds it.
 *
 * The whole read over MCP, under real row, field and tenant security, is in
 * the dogfood harness (`related-read-over-mcp.dogfood.test.ts`).
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import { createStdioDataBridge } from './stdio-data-bridge.js';

const OPP = 'crm_opportunity';
const ACCOUNT = 'crm_account';
const ACTIVITY = 'crm_activity';
const NOTE = 'crm_note';

const DEFS: Record<string, { name: string; fields: Record<string, Record<string, unknown>> }> = {
  [OPP]: {
    name: OPP,
    fields: {
      name: { type: 'text' },
      account: { type: 'lookup', reference: ACCOUNT },
      owner_id: { type: 'lookup', reference: 'sys_user' },
      organization_id: { type: 'lookup', reference: 'sys_organization' },
      renewal_of: { type: 'lookup', reference: OPP },
    },
  },
  [ACCOUNT]: { name: ACCOUNT, fields: { name: { type: 'text' } } },
  [ACTIVITY]: {
    name: ACTIVITY,
    fields: {
      subject: { type: 'text' },
      account: { type: 'lookup', reference: ACCOUNT },
      opportunity: { type: 'lookup', reference: OPP },
      contact_account: { type: 'lookup', reference: ACCOUNT },
    },
  },
  [NOTE]: { name: NOTE, fields: { body: { type: 'text' }, accounts: { type: 'lookup', reference: ACCOUNT, multiple: true } } },
};

interface Recorded { op: string; object: string; opts?: any }

function makeBridge(opts: {
  answers?: Record<string, unknown>;
  record?: unknown;
  definitions?: boolean;
  queryThrows?: Record<string, unknown>;
} = {}) {
  const calls: Recorded[] = [];
  const bridge: any = {
    async listObjects() { return Object.values(DEFS).map((d) => ({ name: d.name, label: d.name })); },
    async describeObject(name: string) { return DEFS[name] ?? null; },
    // `sys_user` attests its AI read opt-in; `sys_organization` does not.
    async aiReadExposed(name: string) { return name === 'sys_user'; },
    async query(object: string, o: any) {
      calls.push({ op: 'query', object, opts: o });
      if (opts.queryThrows?.[object]) throw opts.queryThrows[object];
      return opts.answers?.[object] ?? { object, records: [], total: 0, hasMore: false };
    },
    async get(object: string, id: string) {
      calls.push({ op: 'get', object, opts: { id } });
      return opts.record === undefined ? { id, name: 'Acme' } : opts.record;
    },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return { success: true }; },
  };
  if (opts.definitions !== false) {
    bridge.servedObjectDefinitionOf = async (name: string) => {
      calls.push({ op: 'definition', object: name });
      return DEFS[name] ?? null;
    };
  }
  return { bridge, calls };
}

async function call(
  bridge: any,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; payload: any; text: string }> {
  const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, { bridge, parsedBody: body });
  const json: any = await res.json();
  const text = String(json.result?.content?.[0]?.text ?? json.error?.message ?? '');
  let payload: any;
  try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  return { isError: json.result?.isError === true || json.error !== undefined, payload, text };
}

const reads = (calls: Recorded[]) => calls.filter((c) => c.op === 'query' || c.op === 'get');
const envelope = (payload: any) => ({ code: payload?.error?.code, status: payload?.error?.status });

describe('query_records expand — the tool', () => {
  it('hands the judged names to the bridge as expand, in the one query it reads', async () => {
    const { bridge, calls } = makeBridge();
    const answer = await call(bridge, 'query_records', { objectName: OPP, expand: ['account', 'owner_id', 'account'] });
    expect(answer.isError, answer.text).toBe(false);
    expect(reads(calls)).toHaveLength(1);
    expect(reads(calls)[0]).toMatchObject({ object: OPP, opts: { expand: ['account', 'owner_id'] } });
  });

  it('control: a call without expand hands the bridge no expand key and judges no target definition', async () => {
    const { bridge, calls } = makeBridge();
    await call(bridge, 'query_records', { objectName: OPP });
    expect('expand' in reads(calls)[0].opts).toBe(false);
    // [#35138] The one definition read is the queried object's, after the
    // read, for the labels its source line names fields by.
    expect(calls.filter((c) => c.op === 'definition')).toEqual([{ op: 'definition', object: OPP }]);
    expect(calls.findIndex((c) => c.op === 'definition')).toBeGreaterThan(calls.findIndex((c) => c === reads(calls)[0]));
  });

  it('⭐ a field whose target the read guard refuses refuses the whole call: PERMISSION_DENIED, nothing read', async () => {
    const { bridge, calls } = makeBridge();
    const answer = await call(bridge, 'query_records', { objectName: OPP, expand: ['account', 'organization_id'] });
    expect(answer.isError).toBe(true);
    expect(envelope(answer.payload)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(answer.text).toContain('sys_organization');
    expect(reads(calls)).toHaveLength(0);
  });

  for (const [label, name, fragment] of [
    ['an unknown field', 'nope', 'Unknown field'],
    ['a field that is not a relationship', 'name', 'not a relationship'],
    ['a dotted path (one level only)', 'account.owner_id', 'Unknown field'],
  ] as const) {
    it(`refuses ${label}: INVALID_FIELD, nothing read`, async () => {
      const { bridge, calls } = makeBridge();
      const answer = await call(bridge, 'query_records', { objectName: OPP, expand: [name] });
      expect(envelope(answer.payload)).toEqual({ code: 'INVALID_FIELD', status: 400 });
      expect(answer.text).toContain(fragment);
      expect(reads(calls)).toHaveLength(0);
    });
  }

  it('more than three fields is refused at the door', async () => {
    const { bridge, calls } = makeBridge();
    const answer = await call(bridge, 'query_records', { objectName: OPP, expand: ['account', 'owner_id', 'renewal_of', 'organization_id'] });
    expect(answer.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('a bridge that serves no object definitions refuses expand (NOT_IMPLEMENTED), nothing read', async () => {
    const { bridge, calls } = makeBridge({ definitions: false });
    const answer = await call(bridge, 'query_records', { objectName: OPP, expand: ['account'] });
    expect(envelope(answer.payload)).toEqual({ code: 'NOT_IMPLEMENTED', status: 501 });
    expect(reads(calls)).toHaveLength(0);
  });
});

describe('get_record related — the tool', () => {
  it('reads the record, then each list filtered by the link alone, capped with a probe row', async () => {
    const opps = { object: OPP, records: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }], total: 3, hasMore: false };
    const { bridge, calls } = makeBridge({ answers: { [OPP]: opps } });
    const answer = await call(bridge, 'get_record', {
      objectName: ACCOUNT,
      recordId: 'a1',
      related: [
        { object: OPP, fields: ['id', 'name'], orderBy: [{ field: 'name', order: 'asc' }], limit: 2 },
        { object: ACTIVITY, field: 'account' },
      ],
    });
    expect(answer.isError, answer.text).toBe(false);
    expect(reads(calls).map((c) => `${c.op}:${c.object}`)).toEqual([`get:${ACCOUNT}`, `query:${OPP}`, `query:${ACTIVITY}`]);
    expect(reads(calls)[1].opts).toEqual({
      where: { account: 'a1' }, fields: ['id', 'name'], orderBy: [{ field: 'name', order: 'asc' }], limit: 3,
    });
    // The default cap is 20 rows, read with one probe row.
    expect(reads(calls)[2].opts).toEqual({ where: { account: 'a1' }, limit: 21 });
    expect(answer.payload.record).toEqual({ id: 'a1', name: 'Acme' });
    expect(answer.payload.related[0]).toEqual({
      object: OPP, field: 'account', records: [{ id: 'o1' }, { id: 'o2' }], total: 3, hasMore: true, truncated: true,
    });
    expect(answer.payload.related[1]).toMatchObject({ object: ACTIVITY, field: 'account', records: [] });
    expect(answer.payload.related[1].truncated).toBeUndefined();
  });

  it('control: a call without related answers the record alone, as before', async () => {
    const { bridge, calls } = makeBridge();
    const answer = await call(bridge, 'get_record', { objectName: ACCOUNT, recordId: 'a1' });
    expect(answer.payload).toEqual({ id: 'a1', name: 'Acme' });
    expect(calls.map((c) => c.op)).toEqual(['get']);
  });

  it('⭐ a related object the read guard refuses refuses the whole call before anything about it is read', async () => {
    const { bridge, calls } = makeBridge();
    const answer = await call(bridge, 'get_record', {
      objectName: ACCOUNT, recordId: 'a1', related: [{ object: OPP }, { object: 'sys_audit_log', field: 'record_id' }],
    });
    expect(envelope(answer.payload)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(answer.text).toContain('sys_audit_log');
    expect(calls).toEqual([]);
  });

  it('several link fields and none named: refused, the candidates named', async () => {
    const { bridge, calls } = makeBridge();
    const answer = await call(bridge, 'get_record', { objectName: ACCOUNT, recordId: 'a1', related: [{ object: ACTIVITY }] });
    expect(envelope(answer.payload)).toEqual({ code: 'INVALID_FIELD', status: 400 });
    expect(answer.text).toContain('account, contact_account');
    expect(reads(calls)).toHaveLength(0);
  });

  for (const [label, entry] of [
    ['a child with no field that points at the parent', { object: ACCOUNT }],
    ['an object not served to the caller', { object: 'crm_unknown' }],
    ['a named field that points elsewhere', { object: ACTIVITY, field: 'opportunity' }],
    ['a named field that is not a relationship', { object: ACTIVITY, field: 'subject' }],
  ] as const) {
    it(`refuses ${label}, before any read`, async () => {
      const { bridge, calls } = makeBridge();
      const answer = await call(bridge, 'get_record', { objectName: ACCOUNT, recordId: 'a1', related: [entry] });
      expect(answer.isError).toBe(true);
      expect(['INVALID_FIELD', 'OBJECT_NOT_FOUND']).toContain(answer.payload?.error?.code);
      expect(reads(calls)).toHaveLength(0);
    });
  }

  it('each list names the fields withheld from its own rows, as a plain read of that object does', async () => {
    const { bridge } = makeBridge();
    bridge.fieldVisibilityOf = async (name: string) =>
      name === OPP
        ? { served: ['name', 'account', 'probability'], readable: ['name', 'account'] }
        : { served: ['name'], readable: ['name'] };
    const answer = await call(bridge, 'get_record', { objectName: ACCOUNT, recordId: 'a1', related: [{ object: OPP }] });
    expect(answer.payload.related[0].withheldFields).toEqual(['probability']);
    expect(answer.payload.record.withheldFields).toBeUndefined();
    const plain = await call(bridge, 'query_records', { objectName: OPP });
    expect(plain.payload.withheldFields).toEqual(answer.payload.related[0].withheldFields);
  });

  it('a list the agent ceiling narrowed carries the delegation notice query_records carries; others do not', async () => {
    const { bridge } = makeBridge();
    bridge.diagnoseDelegation = async (name: string) =>
      name === OPP ? { narrowed: true, statement: 'narrowed by the agent ceiling' } : { narrowed: false };
    const answer = await call(bridge, 'get_record', {
      objectName: ACCOUNT, recordId: 'a1', related: [{ object: OPP }, { object: ACTIVITY, field: 'account' }],
    });
    expect(answer.payload.related[0]).toMatchObject({ delegationNarrowed: true, warning: 'narrowed by the agent ceiling' });
    expect(answer.payload.related[1].delegationNarrowed).toBeUndefined();
    const plain = await call(bridge, 'query_records', { objectName: OPP });
    expect(plain.payload).toMatchObject({ delegationNarrowed: true, warning: 'narrowed by the agent ceiling' });
  });

  it('a diagnosis that throws never fails the list', async () => {
    const { bridge } = makeBridge();
    bridge.diagnoseDelegation = async () => { throw new Error('probe down'); };
    const answer = await call(bridge, 'get_record', { objectName: ACCOUNT, recordId: 'a1', related: [{ object: OPP }] });
    expect(answer.isError, answer.text).toBe(false);
    expect(answer.payload.related[0].delegationNarrowed).toBeUndefined();
  });

  it('a multi-value link field is matched with $contains', async () => {
    const { bridge, calls } = makeBridge();
    await call(bridge, 'get_record', { objectName: ACCOUNT, recordId: 'a1', related: [{ object: NOTE }] });
    expect(reads(calls)[1].opts.where).toEqual({ accounts: { $contains: 'a1' } });
  });

  it('a record the caller cannot read: RECORD_NOT_FOUND, and no list is read', async () => {
    const { bridge, calls } = makeBridge({ record: null });
    const answer = await call(bridge, 'get_record', { objectName: ACCOUNT, recordId: 'a1', related: [{ object: OPP }] });
    expect(answer.payload?.error?.code).toBe('RECORD_NOT_FOUND');
    expect(reads(calls).map((c) => c.op)).toEqual(['get']);
  });

  it('a list\'s own refusal is the whole call\'s, with its code', async () => {
    const denied = Object.assign(new Error('no read on crm_opportunity'), { code: 'PERMISSION_DENIED', status: 403 });
    const { bridge } = makeBridge({ queryThrows: { [OPP]: denied } });
    const answer = await call(bridge, 'get_record', { objectName: ACCOUNT, recordId: 'a1', related: [{ object: OPP }] });
    expect(envelope(answer.payload)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(answer.payload.record).toBeUndefined();
  });

  for (const [label, related] of [
    ['four lists', [{ object: OPP }, { object: OPP }, { object: OPP }, { object: OPP }]],
    ['a limit above 20', [{ object: OPP, limit: 21 }]],
    ['a caller filter on the list', [{ object: OPP, where: { name: 'x' } }]],
  ] as const) {
    it(`refused at the door: ${label}`, async () => {
      const { bridge, calls } = makeBridge();
      const answer = await call(bridge, 'get_record', { objectName: ACCOUNT, recordId: 'a1', related });
      expect(answer.isError).toBe(true);
      expect(calls).toHaveLength(0);
    });
  }
});

describe('query_records expand — the stdio bridge', () => {
  const PRINCIPAL = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;

  function makeStdio(defs: Record<string, unknown>) {
    const engine = { find: vi.fn(async () => [{ id: 'o1' }]), count: vi.fn(async () => 1) };
    const metadataService = { getObject: vi.fn(async (name: string) => defs[name]) };
    const bridge = createStdioDataBridge({
      engine: engine as unknown as IDataEngine,
      metadataService: metadataService as unknown as IMetadataService,
      resolvePrincipal: async () => PRINCIPAL,
    });
    return { bridge, engine };
  }

  it('hands the engine the expand map, keyed by field, naming each target', async () => {
    const { bridge, engine } = makeStdio({ [OPP]: DEFS[OPP], [ACCOUNT]: DEFS[ACCOUNT] });
    await bridge.query(OPP, { expand: ['account'] });
    const [, query] = engine.find.mock.calls[0] as unknown as [string, any];
    expect(query.expand).toEqual({ account: { object: ACCOUNT } });
  });

  it('a target that does not serve get is withheld, as the data door withholds it', async () => {
    const { bridge, engine } = makeStdio({
      [OPP]: DEFS[OPP],
      [ACCOUNT]: { ...DEFS[ACCOUNT], enable: { apiEnabled: false } },
    });
    await bridge.query(OPP, { expand: ['account'] });
    const [, query] = engine.find.mock.calls[0] as unknown as [string, any];
    expect('expand' in query).toBe(false);
  });

  it('a name that is not a reference field: the door\'s INVALID_FIELD, before the engine', async () => {
    const { bridge, engine } = makeStdio({ [OPP]: DEFS[OPP] });
    const err: any = await bridge.query(OPP, { expand: ['name'] }).then(() => null, (e: unknown) => e);
    expect({ code: err?.code, status: err?.status, field: err?.field }).toEqual({ code: 'INVALID_FIELD', status: 400, field: 'name' });
    expect(engine.find).not.toHaveBeenCalled();
  });
});
