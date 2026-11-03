// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The stdio data bridge leaves the `internal: true` evaluate refusal to the
 * ENGINE: it hands the engine the caller's query under the caller's principal
 * on `query` (`where`, `orderBy`) and on `aggregate` (`where`, `groupBy`,
 * `aggregations`), never asks a `protocol` service for it (a host may register
 * none, or a protocol other than the shipped one), and a refusal the engine
 * throws reaches the caller as thrown: the tool renders its `code`, `status`
 * and sentence.
 *
 * The refusal itself is the engine's one definition and is pinned there
 * (`@objectstack/objectql`, `internal-field-evaluation-guard.test.ts`, which
 * also boots a kernel with no protocol service), and the whole path on a real
 * stack, with and without a protocol service, in `@objectstack/dogfood`. This
 * file pins the bridge's half. Refusals are asserted on the envelope, never on
 * a bare throw.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import { registerObjectTools } from './mcp-http-tools.js';

const OBJECT = 'ifx_vault';
const FLAGGED = 'pin';
const DEF = { name: OBJECT, fields: { name: { type: 'text' }, [FLAGGED]: { type: 'text' } } };

/** The engine's refusal (fields only; the sentence is the engine's to pin). */
function engineRefusal(param: string) {
  return Object.assign(new Error(`Cannot filter '${OBJECT}' by '${FLAGGED}' (${param}): the query was not run.`), {
    code: 'INVALID_FIELD', status: 400, httpStatus: 400, object: OBJECT, field: FLAGGED, fields: [FLAGGED], param,
  });
}

const PRINCIPAL = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;

/** A stand-in engine that refuses any query whose JSON names the flagged field, as the real one does. */
function makeBridge(withProtocolFace = false) {
  const refuses = (query: unknown) => {
    if (JSON.stringify(query).includes(`"${FLAGGED}"`)) throw engineRefusal('filter');
  };
  const engine = {
    find: vi.fn(async (_object: string, query: unknown) => { refuses(query); return [{ id: 'r1', name: 'alpha' }]; }),
    aggregate: vi.fn(async (_object: string, query: unknown) => { refuses(query); return [{ n: 1 }]; }),
  };
  const metadataService = { getObject: vi.fn(async (name: string) => (name === OBJECT ? DEF : undefined)) };
  // A protocol that still carries a face of that name: the bridge must not ask it.
  const protocolFace = vi.fn();
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: metadataService as unknown as IMetadataService,
    ...(withProtocolFace ? { protocol: () => ({ assertNoInternalFieldEvaluated: protocolFace }) as never } : {}),
    resolvePrincipal: async () => PRINCIPAL,
  });
  return { bridge, engine, protocolFace };
}

const refusalOf = async (run: () => Promise<unknown>) => {
  const err: any = await run().then(() => undefined, (e: unknown) => e);
  expect(err, 'the call resolved: the gate\'s refusal did not reach the caller').toBeDefined();
  return { code: err.code, status: err.status, field: err.field, object: err.object };
};
const REFUSED = { code: 'INVALID_FIELD', status: 400, field: FLAGGED, object: OBJECT };

describe('the stdio bridge leaves the internal-field refusal to the engine', () => {
  it('query: the engine gets the call\'s where and orderBy under the principal, and its refusal reaches the caller', async () => {
    const { bridge, engine } = makeBridge();
    const where = { [FLAGGED]: { $startsWith: 'x' } };
    const orderBy = [{ field: 'name', order: 'asc' as const }];
    expect(await refusalOf(() => bridge.query(OBJECT, { where, orderBy, limit: 5 }))).toEqual(REFUSED);
    expect(engine.find).toHaveBeenCalledTimes(1);
    expect(engine.find.mock.calls[0]![1]).toMatchObject({ where, orderBy });
    expect((engine.find.mock.calls[0] as unknown[])[2]).toEqual({ context: PRINCIPAL });

    const sorted = [{ field: FLAGGED, order: 'desc' as const }];
    expect(await refusalOf(() => bridge.query(OBJECT, { orderBy: sorted }))).toEqual(REFUSED);
  });

  it('aggregate: the engine gets where, groupBy and aggregations under the principal, and its refusal reaches the caller', async () => {
    const { bridge, engine } = makeBridge();
    const bodies = [
      { where: { [FLAGGED]: 'x' }, aggregations: [{ function: 'count' as const, alias: 'n' }] },
      { groupBy: [FLAGGED], aggregations: [{ function: 'count' as const, alias: 'n' }] },
      { aggregations: [{ function: 'max' as const, field: FLAGGED, alias: 'm' }] },
      { aggregations: [{ function: 'count' as const, alias: 'n', filter: { [FLAGGED]: 'x' } }] },
    ];
    for (const body of bodies) {
      expect(await refusalOf(() => bridge.aggregate!(OBJECT, body))).toEqual(REFUSED);
      expect(engine.aggregate.mock.lastCall![1]).toMatchObject({ ...body, context: PRINCIPAL });
    }
  });

  it('never asks a protocol service for it, even one carrying a face of that name', async () => {
    const { bridge, engine, protocolFace } = makeBridge(true);
    expect(await refusalOf(() => bridge.query(OBJECT, { where: { [FLAGGED]: 'x' } }))).toEqual(REFUSED);
    expect(await refusalOf(() => bridge.aggregate!(OBJECT, { groupBy: [FLAGGED], aggregations: [{ function: 'count', alias: 'n' }] }))).toEqual(REFUSED);
    expect(protocolFace).not.toHaveBeenCalled();
    expect(engine.find).toHaveBeenCalledTimes(1);
    expect(engine.aggregate).toHaveBeenCalledTimes(1);
  });

  it('CONTROL — an ordinary-field query is served by the engine, on both verbs', async () => {
    const { bridge, engine } = makeBridge();
    const where = { name: 'alpha' };
    const rows = await bridge.query(OBJECT, { where, orderBy: [{ field: 'name', order: 'asc' }] });
    expect(engine.find).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(rows)).toContain('alpha');
    await bridge.aggregate!(OBJECT, { where, groupBy: ['name'], aggregations: [{ function: 'count', alias: 'n' }] });
    expect(engine.aggregate).toHaveBeenCalledTimes(1);
  });

  it('query_records and aggregate_records render the engine\'s refusal as its envelope', async () => {
    const { bridge } = makeBridge();
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
        expect(error.message).toBe(engineRefusal('filter').message);
      }
    } finally {
      await client.close();
    }
  });
});
