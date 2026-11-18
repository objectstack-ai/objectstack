// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [latest per group] `query_records`' `latestPer`: "each X with its latest Y"
 * in one call.
 *
 * The tool half: the argument is bounded at the door (1 to 3 partition fields,
 * 1 to 3 order keys, no other member), handed to the bridge as `latestPer`
 * with the capped `limit`, and answered `{ object, records, hasMore }` plus the
 * shared truncation flag (`truncated: true`) when more groups exist than came
 * back — never a `total`. A bridge answer that is not one row per group is no
 * answer. Without `latestPer` the tool is unchanged.
 *
 * The stdio bridge half: the request rides to `engine.find` on the engine's own
 * read option, never as a query key; the read takes one row more than `limit`
 * and serves `limit`; the partition and order fields meet the bridge's sort
 * verdicts; an engine that did not serve the window is no answer.
 *
 * The whole read over MCP, under real row, field and tenant security, is in
 * the dogfood harness (`latest-per-over-mcp.dogfood.test.ts`).
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import { createStdioDataBridge } from './stdio-data-bridge.js';

const OBJECT = 'crm_opportunity';
const LATEST_PER_KEY = Symbol.for('objectstack.objectql.latestPer');
const NEWEST = { by: ['account'], orderBy: [{ field: 'close_date', order: 'desc' }] };

function makeBridge(answer: unknown) {
  const queries: Array<{ object: string; opts: any }> = [];
  const bridge: any = {
    async listObjects() { return [{ name: OBJECT, label: 'Opportunity' }]; },
    async describeObject(name: string) { return { name }; },
    async query(object: string, opts: any) { queries.push({ object, opts }); return answer; },
    async get(object: string, id: string) { return { object, id }; },
    async create(object: string, data: any) { return { object, data }; },
    async update(object: string, id: string) { return { object, id }; },
    async remove(object: string, id: string) { return { object, id, success: true }; },
  };
  return { bridge, queries };
}

async function call(bridge: any, args: Record<string, unknown>): Promise<{ isError: boolean; payload: any; text: string }> {
  const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query_records', arguments: { objectName: OBJECT, ...args } } };
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

describe('query_records latestPer — the tool', () => {
  it('hands latestPer and the capped limit to the bridge; one page of groups, no total, no truncated flag', async () => {
    const { bridge, queries } = makeBridge({ object: OBJECT, records: [{ id: 'd3' }, { id: 'd6' }], hasMore: false });
    const answer = await call(bridge, { latestPer: NEWEST, where: { stage: 'open' } });
    expect(answer.isError, answer.text).toBe(false);
    expect(queries).toHaveLength(1);
    expect(queries[0].opts).toMatchObject({ where: { stage: 'open' }, limit: 50, latestPer: NEWEST });
    expect(answer.payload).toEqual({ object: OBJECT, records: [{ id: 'd3' }, { id: 'd6' }], hasMore: false });
  });

  it('more groups than came back: truncated: true', async () => {
    const { bridge } = makeBridge({ object: OBJECT, records: [{ id: 'd3' }], hasMore: true });
    const answer = await call(bridge, { latestPer: NEWEST, limit: 1 });
    expect(answer.payload).toEqual({ object: OBJECT, records: [{ id: 'd3' }], hasMore: true, truncated: true });
  });

  it('a bridge that answered an ordinary list (a row total) is no answer: a coded server fault, no rows', async () => {
    const { bridge } = makeBridge({ object: OBJECT, records: [{ id: 'd1' }, { id: 'd2' }], total: 2 });
    const answer = await call(bridge, { latestPer: NEWEST });
    expect(answer.isError).toBe(true);
    expect(answer.payload?.error?.code).toBe('INTERNAL_ERROR');
    expect(answer.text).not.toMatch(/"d1"/);
  });

  for (const [label, latestPer] of [
    ['four partition fields', { ...NEWEST, by: ['a', 'b', 'c', 'd'] }],
    ['no order key', { ...NEWEST, orderBy: [] }],
    ['an unknown member', { ...NEWEST, partitionBy: ['account'] }],
    ['an order that is neither asc nor desc', { ...NEWEST, orderBy: [{ field: 'close_date', order: 'newest' }] }],
  ] as const) {
    it(`refused at the door before the bridge is asked: ${label}`, async () => {
      const { bridge, queries } = makeBridge({ object: OBJECT, records: [], hasMore: false });
      const answer = await call(bridge, { latestPer });
      expect(answer.isError).toBe(true);
      expect(queries).toHaveLength(0);
    });
  }

  it('control: without latestPer the tool answers the bridge\'s list unchanged, total and all', async () => {
    const list = { object: OBJECT, records: [{ id: 'd1' }], total: 7 };
    const { bridge, queries } = makeBridge(list);
    const answer = await call(bridge, { limit: 1 });
    expect(answer.payload).toEqual(list);
    expect('latestPer' in queries[0].opts).toBe(false);
  });
});

describe('query_records latestPer — the stdio bridge', () => {
  const PRINCIPAL = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;
  const DEF = { name: OBJECT, fields: { account: { type: 'lookup' }, close_date: { type: 'date' }, note: { type: 'text', sortable: false } } };

  function makeStdio(served: boolean, rows: Array<Record<string, unknown>>) {
    const engine = {
      find: vi.fn(async (_object: string, _query: any, options: any) => {
        const request = options?.[LATEST_PER_KEY];
        if (served && request) request.outcome = { kind: 'served' };
        return rows;
      }),
    };
    const metadataService = { getObject: vi.fn(async (name: string) => (name === OBJECT ? DEF : undefined)) };
    const bridge = createStdioDataBridge({
      engine: engine as unknown as IDataEngine,
      metadataService: metadataService as unknown as IMetadataService,
      resolvePrincipal: async () => PRINCIPAL,
    });
    return { bridge, engine };
  }

  it('rides the engine\'s read option, reads limit + 1, serves limit, says hasMore; never a query key', async () => {
    const { bridge, engine } = makeStdio(true, [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }]);
    const answer: any = await bridge.query(OBJECT, { limit: 2, latestPer: NEWEST as any });
    expect(answer).toEqual({ object: OBJECT, records: [{ id: 'd1' }, { id: 'd2' }], hasMore: true });
    const [, query, options] = engine.find.mock.calls[0]!;
    expect(query.limit).toBe(3);
    expect('latestPer' in query).toBe(false);
    expect(options[LATEST_PER_KEY]).toMatchObject(NEWEST);
    expect(options.context).toBe(PRINCIPAL);
  });

  it('an engine that did not serve the window is no answer', async () => {
    const { bridge } = makeStdio(false, [{ id: 'd1' }]);
    const err = await bridge.query(OBJECT, { limit: 2, latestPer: NEWEST as any }).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/not served as one row per group/);
  });

  it('a partition field the author declared sortable: false meets the sort verdict, before the engine', async () => {
    const { bridge, engine } = makeStdio(true, []);
    const err: any = await bridge.query(OBJECT, { limit: 2, latestPer: { by: ['note'], orderBy: NEWEST.orderBy } as any })
      .then(() => null, (e: unknown) => e);
    expect({ code: err?.code, status: err?.status, field: err?.field }).toEqual({ code: 'INVALID_SORT', status: 400, field: 'note' });
    expect(engine.find).not.toHaveBeenCalled();
  });
});
