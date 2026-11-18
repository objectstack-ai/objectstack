// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35138] A refused record read (`query_records`, `aggregate_records`,
 * `get_record`) of an object, or a field, that the caller's schema does not
 * show keeps its coded refusal and carries two members beside it:
 * `notRecorded` (what the call named that is not recorded, as the caller sent
 * it) and `ifNotRecorded` (one sentence, in the caller's locale, telling the
 * model to say the data is not recorded rather than answer around a bare
 * not-found).
 *
 * The rule: the members are built only from what the caller sent and what the
 * caller's served schema (`describeObject`) shows, so an object or field the
 * caller cannot see is answered exactly as one that does not exist for them,
 * and nothing the schema shows is ever named. Each bridge below replays the
 * refusal its door answers for the case (measured on the real security layer;
 * the HTTP bridge's schema and locale answers are pinned in
 * `packages/runtime/src/domains/mcp-not-recorded.test.ts`).
 *
 * The stdio bridge's locale member is pinned at the bottom.
 */

import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';
import { createStdioDataBridge } from './stdio-data-bridge.js';

const OBJECT = 'crm_deal';
const SERVED_FIELDS = ['subject', 'amount', 'margin_formula', 'organization_id'];

/** Does `name` occur in `text` as an identifier token? */
const mentions = (text: string, name: string) => (text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? ([] as string[])).includes(name);

/** A thrown coded refusal, as the doors throw one. */
function refusal(code: string, status: number, message: string): Error {
  return Object.assign(new Error(message), { code, status });
}

const OBJECT_NOT_FOUND = (name: string) => refusal('OBJECT_NOT_FOUND', 404, `Object '${name}' not found`);
const INVALID_FIELD = (name: string) =>
  refusal('INVALID_FIELD', 400, `Query parameter 'where' filters on '${name}', which is not a field on object '${OBJECT}'.`);
/** Refusals a door may answer beside the members: the members never depend on which. */
const REFUSALS: ReadonlyArray<(name: string) => unknown> = [
  OBJECT_NOT_FOUND,
  INVALID_FIELD,
  () => refusal('PERMISSION_DENIED', 403, 'You do not have permission to perform this action.'),
];

interface BridgeCase {
  /** Objects the caller's schema shows, each with its field names. */
  served: Record<string, readonly string[]>;
  /** What every read throws, or `undefined` to answer. */
  throws?: (object: string) => unknown;
  locales?: McpDataBridge['userTextLocales'];
}

function makeBridge(c: BridgeCase): McpDataBridge {
  const read = async (object: string, answer: unknown) => {
    if (c.throws) throw c.throws(object);
    return answer;
  };
  const bridge: McpDataBridge = {
    async listObjects() { return Object.keys(c.served).map((name) => ({ name })); },
    async describeObject(name: string) {
      const fields = c.served[name];
      return fields ? { name, label: name, fields: fields.map((f) => ({ name: f, type: 'text' })) } : null;
    },
    query: (object) => read(object, { object, records: [], total: 0 }),
    get: (object, id) => read(object, { id }),
    aggregate: (object) => read(object, []) as Promise<unknown[]>,
    async create(object, data) { return { object, data }; },
    async update(object, id) { return { object, id }; },
    async remove(object, id) { return { object, id, success: true }; },
  };
  if (c.locales) bridge.userTextLocales = c.locales;
  return bridge;
}

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
  const text: string = json.result.content[0].text;
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = undefined;
  }
  return { isError: json.result.isError === true, text, payload };
}

/** The members beside the refusal, as their own JSON text: what CONTROL compares byte for byte. */
const membersText = (payload: any) => JSON.stringify({ notRecorded: payload.notRecorded, ifNotRecorded: payload.ifNotRecorded });

const EN = /^What notRecorded names is not recorded here, so nothing was read: tell the user this data is not recorded/;

describe('[#35138] record reads: an object the caller\'s schema does not show', () => {
  const bridge = () => makeBridge({ served: { [OBJECT]: SERVED_FIELDS }, throws: OBJECT_NOT_FOUND });

  it.each([
    ['query_records', { objectName: 'crm_invoice' }],
    ['aggregate_records', { objectName: 'crm_invoice', aggregations: [{ function: 'count', alias: 'n' }] }],
    ['get_record', { objectName: 'crm_invoice', recordId: 'r1' }],
  ])('%s keeps the coded refusal and names the object as not recorded, in one sentence', async (tool, args) => {
    const answer = await callTool(bridge(), tool, args);
    expect(answer.isError).toBe(true);
    expect(answer.payload.error).toEqual({ code: 'OBJECT_NOT_FOUND', message: "Object 'crm_invoice' not found", status: 404 });
    expect(answer.payload.notRecorded).toEqual({ object: 'crm_invoice' });
    expect(answer.payload.ifNotRecorded).toMatch(EN);
    expect(Object.keys(answer.payload)).toEqual(['error', 'notRecorded', 'ifNotRecorded']);
    for (const field of SERVED_FIELDS) expect(mentions(answer.text, field)).toBe(false);
  });
});

describe('[#35138] record reads: a field the caller\'s schema does not show', () => {
  const bridge = () => makeBridge({ served: { [OBJECT]: SERVED_FIELDS }, throws: () => INVALID_FIELD('invoice_total') });

  it('query_records names each field it sent that the schema does not show, in the order sent, and the coded refusal stands', async () => {
    const answer = await callTool(bridge(), 'query_records', {
      objectName: OBJECT,
      where: { $or: [{ invoice_total: { $gt: 1 } }, { subject: 'x' }], 'invoice_lines.qty': 2 },
      fields: ['subject', 'invoice_total'],
      orderBy: [{ field: 'paid_on', order: 'desc' }, { field: 'id', order: 'asc' }],
    });
    expect(answer.isError).toBe(true);
    expect(answer.payload.error.code).toBe('INVALID_FIELD');
    expect(answer.payload.error.status).toBe(400);
    expect(answer.payload.notRecorded).toEqual({ object: OBJECT, fields: ['invoice_total', 'invoice_lines', 'paid_on'] });
    expect(answer.payload.ifNotRecorded).toMatch(EN);
  });

  it('aggregate_records reads groupBy, each aggregation\'s field and filter, and where', async () => {
    const answer = await callTool(bridge(), 'aggregate_records', {
      objectName: OBJECT,
      groupBy: ['region', { field: 'created_at', dateGranularity: 'month' }],
      aggregations: [{ function: 'sum', field: 'invoice_total', alias: 't', filter: { channel: 'web' } }],
      where: { amount: { $gt: 0 } },
    });
    expect(answer.isError).toBe(true);
    expect(answer.payload.notRecorded).toEqual({ object: OBJECT, fields: ['region', 'invoice_total', 'channel'] });
  });
});

describe('[#35138] the answer names only what the caller can see — CONTROL', () => {
  it('a field the caller cannot see is answered with members byte-identical to a field that does not exist', async () => {
    const args = { objectName: OBJECT, where: { margin_net: { $gt: 0 } } };
    // The same call, the same served schema: the object either declares no such
    // field, or declares one the caller's schema does not show. Whatever
    // refusal the door answers beside them, the members are one text.
    const answers = [];
    for (const throws of REFUSALS) {
      answers.push(await callTool(makeBridge({ served: { [OBJECT]: SERVED_FIELDS }, throws: () => throws('margin_net') }), 'query_records', args));
    }
    for (const answer of answers) {
      expect(answer.isError).toBe(true);
      expect(answer.payload.notRecorded).toEqual({ object: OBJECT, fields: ['margin_net'] });
      expect(membersText(answer.payload)).toBe(membersText(answers[0].payload));
      expect(Object.keys(answer.payload)).toEqual(['error', 'notRecorded', 'ifNotRecorded']);
      for (const field of SERVED_FIELDS) expect(mentions(membersText(answer.payload), field)).toBe(false);
    }
  });

  it('an object the caller cannot read is answered with members byte-identical to an object that does not exist', async () => {
    const served = { [OBJECT]: SERVED_FIELDS };
    for (const tool of ['query_records', 'get_record'] as const) {
      const args = tool === 'get_record' ? { objectName: 'crm_vault', recordId: 'r1' } : { objectName: 'crm_vault' };
      const answers = [];
      for (const throws of REFUSALS) answers.push(await callTool(makeBridge({ served, throws }), tool, args));
      for (const answer of answers) {
        expect(answer.payload.notRecorded).toEqual({ object: 'crm_vault' });
        expect(membersText(answer.payload)).toBe(membersText(answers[0].payload));
      }
    }
  });

  it('a readable existing field is never named: a refusal about it carries no member', async () => {
    const bridge = makeBridge({
      served: { [OBJECT]: SERVED_FIELDS },
      throws: () => refusal('INVALID_FIELD', 400, "sum over 'margin_formula' cannot run: a formula has no column."),
    });
    const answer = await callTool(bridge, 'aggregate_records', {
      objectName: OBJECT,
      groupBy: ['subject'],
      aggregations: [{ function: 'sum', field: 'margin_formula', alias: 't' }],
      where: { id: 'r1', created_at: { $gt: '2026-01-01' }, updated_at: { $gt: '2026-01-01' } },
    });
    expect(answer.isError).toBe(true);
    expect(Object.keys(answer.payload)).toEqual(['error']);
  });

  it('a read that answers carries no member, and a server fault carries none even for an unknown object', async () => {
    const ok = await callTool(makeBridge({ served: { [OBJECT]: SERVED_FIELDS } }), 'query_records', { objectName: OBJECT, where: { subject: 'x' } });
    expect(ok.isError).toBe(false);
    expect(ok.payload).toEqual({ object: OBJECT, records: [], total: 0 });
    const fault = await callTool(
      makeBridge({ served: {}, throws: () => new Error('socket hang up (test)') }),
      'query_records',
      { objectName: 'crm_invoice' },
    );
    expect(fault.isError).toBe(true);
    expect(fault.payload.notRecorded).toBeUndefined();
    expect(fault.payload.ifNotRecorded).toBeUndefined();
  });

  it('a schema read that throws establishes nothing: the refusal is served alone', async () => {
    const bridge = makeBridge({ served: {}, throws: OBJECT_NOT_FOUND });
    bridge.describeObject = async () => { throw refusal('FIELD_VISIBILITY_UNRESOLVED', 503, 'x'); };
    const answer = await callTool(bridge, 'query_records', { objectName: 'crm_invoice' });
    expect(Object.keys(answer.payload)).toEqual(['error']);
  });
});

describe('[#35138] ifNotRecorded is written in the caller\'s locale', () => {
  const sentenceFor = async (locales: McpDataBridge['userTextLocales']) =>
    (await callTool(makeBridge({ served: {}, throws: OBJECT_NOT_FOUND, locales }), 'query_records', { objectName: 'crm_invoice' }))
      .payload.ifNotRecorded as string;

  it('a zh caller is answered the zh sentence; Traditional, Japanese and an unwritten language take their rung', async () => {
    expect(await sentenceFor(async () => ['zh-CN'])).toMatch(/^notRecorded 所列的内容在这里没有记录/);
    expect(await sentenceFor(async () => ['zh-TW'])).toMatch(/^notRecorded 所列的內容在這裡沒有記錄/);
    expect(await sentenceFor(async () => ['fr-FR', 'ja-JP'])).toMatch(/^notRecorded に挙げたものはここに記録されていない/);
    expect(await sentenceFor(async () => ['fr-FR'])).toMatch(EN);
  });

  it('a bridge with no locale member, or whose answer throws, is answered in en', async () => {
    expect(await sentenceFor(undefined)).toMatch(EN);
    expect(await sentenceFor(async () => { throw new Error('principal unavailable (test)'); })).toMatch(EN);
  });
});

describe('[#35138] stdio bridge: userTextLocales', () => {
  const engine = { find: async () => [], findOne: async () => null } as unknown as IDataEngine;
  const metadataService = { listObjects: async () => [], getObject: async () => undefined, list: async () => [] } as unknown as IMetadataService;
  const bridgeWith = (principal: Partial<ExecutionContext>, i18n?: () => unknown) =>
    createStdioDataBridge({
      engine,
      metadataService,
      resolvePrincipal: async () => ({ userId: 'u1', isSystem: false, ...principal }) as ExecutionContext,
      ...(i18n ? { i18n } : {}),
    });

  it('answers the principal\'s ladder, then the i18n service\'s default', async () => {
    const i18n = () => ({ getDefaultLocale: () => 'zh-CN' });
    expect(await bridgeWith({ locale: 'ja-JP', workspaceLocale: 'en-US' }, i18n).userTextLocales!()).toEqual(['ja-JP', 'en-US', 'zh-CN']);
    expect(await bridgeWith({}, i18n).userTextLocales!()).toEqual(['zh-CN']);
  });

  it('an i18n service it cannot resolve, or whose default read throws, adds no rung', async () => {
    expect(await bridgeWith({ locale: 'ja-JP' }).userTextLocales!()).toEqual(['ja-JP']);
    expect(await bridgeWith({}, () => { throw new Error('no i18n (test)'); }).userTextLocales!()).toEqual([]);
    expect(await bridgeWith({}, () => ({ getDefaultLocale: () => { throw new Error('boom (test)'); } })).userTextLocales!()).toEqual([]);
  });
});
