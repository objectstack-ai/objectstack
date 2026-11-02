// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The stdio data bridge asks the data door's internal-field gate — the
 * `protocol` service's `assertNoInternalFieldEvaluated` — before its engine
 * reads anything, on `query` (the call's `where` and `orderBy`) and on
 * `aggregate` (`where`, `groupBy`, `aggregations`), and a refusal it throws
 * reaches the caller as thrown: the tool renders its `code`, `status` and
 * sentence, and the engine is never asked.
 *
 * The gate itself is the protocol's and is pinned there
 * (`@objectstack/metadata-protocol`, the public-face cases beside the data
 * door's position enumeration), and the whole path on a real stack in
 * `@objectstack/dogfood`. This file pins the bridge's half: that it asks, with
 * what, before what — and that a host whose protocol has no such face (or that
 * registers no protocol) is served exactly as before. Refusals are asserted on
 * the envelope, never on a bare throw.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { createStdioDataBridge, type StdioProtocolObjectReads } from './stdio-data-bridge.js';
import { registerObjectTools } from './mcp-http-tools.js';

const OBJECT = 'ifx_vault';
const FLAGGED = 'pin';
const DEF = { name: OBJECT, fields: { name: { type: 'text' }, [FLAGGED]: { type: 'text' } } };

/** The door's refusal as the protocol throws it (fields only; the sentence is the protocol's to pin). */
function doorRefusal(param: string) {
  return Object.assign(new Error(`Cannot evaluate '${OBJECT}' by '${FLAGGED}' (${param}): the query was not run.`), {
    code: 'INVALID_FIELD', status: 400, httpStatus: 400, object: OBJECT, field: FLAGGED, fields: [FLAGGED], param,
  });
}

/** A stand-in for the protocol's gate: refuses any query whose JSON names the flagged field. */
function gate() {
  return vi.fn((_object: string, query: Record<string, unknown>) => {
    if (JSON.stringify(query).includes(`"${FLAGGED}"`)) throw doorRefusal('filter');
  });
}

function makeBridge(protocol?: StdioProtocolObjectReads) {
  const engine = {
    find: vi.fn(async () => [{ id: 'r1', name: 'alpha' }]),
    aggregate: vi.fn(async () => [{ n: 1 }]),
  };
  const metadataService = { getObject: vi.fn(async (name: string) => (name === OBJECT ? DEF : undefined)) };
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: metadataService as unknown as IMetadataService,
    ...(protocol ? { protocol: () => protocol } : {}),
    resolvePrincipal: async () => ({ userId: 'u1', isSystem: false }) as unknown as ExecutionContext,
  });
  return { bridge, engine };
}

const refusalOf = async (run: () => Promise<unknown>) => {
  const err: any = await run().then(() => undefined, (e: unknown) => e);
  expect(err, 'the call resolved: the gate\'s refusal did not reach the caller').toBeDefined();
  return { code: err.code, status: err.status, field: err.field, object: err.object };
};
const REFUSED = { code: 'INVALID_FIELD', status: 400, field: FLAGGED, object: OBJECT };

describe('the stdio bridge asks the protocol\'s internal-field gate before the engine', () => {
  it('query: the gate is asked with the call\'s where and orderBy, and its refusal stops the read', async () => {
    const assertNoInternalFieldEvaluated = gate();
    const { bridge, engine } = makeBridge({ assertNoInternalFieldEvaluated });
    const where = { [FLAGGED]: { $startsWith: 'x' } };
    const orderBy = [{ field: 'name', order: 'asc' as const }];
    expect(await refusalOf(() => bridge.query(OBJECT, { where, orderBy, limit: 5 }))).toEqual(REFUSED);
    expect(assertNoInternalFieldEvaluated).toHaveBeenCalledWith(OBJECT, { where, orderBy });
    expect(engine.find).not.toHaveBeenCalled();

    const sorted = [{ field: FLAGGED, order: 'desc' as const }];
    expect(await refusalOf(() => bridge.query(OBJECT, { orderBy: sorted }))).toEqual(REFUSED);
    expect(engine.find).not.toHaveBeenCalled();
  });

  it('aggregate: the gate is asked with where, groupBy and aggregations, and its refusal stops the aggregate', async () => {
    const assertNoInternalFieldEvaluated = gate();
    const { bridge, engine } = makeBridge({ assertNoInternalFieldEvaluated });
    const bodies = [
      { where: { [FLAGGED]: 'x' }, aggregations: [{ function: 'count' as const, alias: 'n' }] },
      { groupBy: [FLAGGED], aggregations: [{ function: 'count' as const, alias: 'n' }] },
      { aggregations: [{ function: 'max' as const, field: FLAGGED, alias: 'm' }] },
      { aggregations: [{ function: 'count' as const, alias: 'n', filter: { [FLAGGED]: 'x' } }] },
    ];
    for (const body of bodies) {
      expect(await refusalOf(() => bridge.aggregate!(OBJECT, body))).toEqual(REFUSED);
      expect(assertNoInternalFieldEvaluated).toHaveBeenLastCalledWith(OBJECT, {
        where: (body as { where?: unknown }).where,
        groupBy: (body as { groupBy?: unknown }).groupBy,
        aggregations: body.aggregations,
      });
    }
    expect(engine.aggregate).not.toHaveBeenCalled();
  });

  it('CONTROL — a query the gate passes reaches the engine unchanged, on both verbs', async () => {
    const assertNoInternalFieldEvaluated = gate();
    const { bridge, engine } = makeBridge({ assertNoInternalFieldEvaluated });
    const where = { name: 'alpha' };
    await bridge.query(OBJECT, { where, orderBy: [{ field: 'name', order: 'asc' }] });
    expect(engine.find).toHaveBeenCalledTimes(1);
    expect((engine.find.mock.calls[0] as unknown[])[1]).toMatchObject({ where, orderBy: [{ field: 'name', order: 'asc' }] });
    await bridge.aggregate!(OBJECT, { where, groupBy: ['name'], aggregations: [{ function: 'count', alias: 'n' }] });
    expect(engine.aggregate).toHaveBeenCalledTimes(1);
    expect(assertNoInternalFieldEvaluated).toHaveBeenCalledTimes(2);
  });

  it('CONTROL — no protocol, or one without the face: served as before (no door to agree with)', async () => {
    for (const protocol of [undefined, {} as StdioProtocolObjectReads]) {
      const { bridge, engine } = makeBridge(protocol);
      await bridge.query(OBJECT, { where: { [FLAGGED]: 'x' } });
      await bridge.aggregate!(OBJECT, { where: { [FLAGGED]: 'x' }, aggregations: [{ function: 'count', alias: 'n' }] });
      expect(engine.find).toHaveBeenCalledTimes(1);
      expect(engine.aggregate).toHaveBeenCalledTimes(1);
    }
  });

  it('query_records and aggregate_records render the gate\'s refusal as its envelope', async () => {
    const { bridge, engine } = makeBridge({ assertNoInternalFieldEvaluated: gate() });
    const server = new McpServer({ name: 'pin', version: '0' });
    registerObjectTools(server, bridge);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'pin', version: '0' });
    await client.connect(clientSide);
    try {
      for (const [name, args] of [
        ['query_records', { objectName: OBJECT, where: { [FLAGGED]: 'x' } }],
        ['aggregate_records', { objectName: OBJECT, groupBy: [FLAGGED], aggregations: [{ function: 'count', alias: 'n' }] }],
      ] as const) {
        const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
        expect(res.isError, name).toBe(true);
        const { error } = JSON.parse(res.content[0]!.text) as { error: { code: unknown; status: unknown; message: string } };
        expect({ code: error.code, status: error.status }).toEqual({ code: 'INVALID_FIELD', status: 400 });
        expect(error.message).toBe(doorRefusal('filter').message);
      }
      expect(engine.find).not.toHaveBeenCalled();
      expect(engine.aggregate).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});
