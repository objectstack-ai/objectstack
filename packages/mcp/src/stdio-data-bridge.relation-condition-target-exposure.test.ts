// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22777] A nested-relation condition in a stdio caller's filter is evaluated
 * on its TARGET object (the engine lowers it by reading the target as the
 * caller), so the stdio data bridge asks each condition's target the spec's one
 * exposure decision for `list` — the same gate an addressed object gets — and
 * REFUSES an unserved target before the engine is asked. The data door asks
 * the same of the same sites (`@objectstack/metadata-protocol`). Fixture objects
 * only; refusals are asserted by envelope (`code` + `status`), never by a bare
 * throw, and every refusal asserts the engine was never reached.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { effectiveOperationsArray, resolveEffectiveApiMethods } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { createStdioDataBridge, type McpExposureError } from './stdio-data-bridge.js';
import { registerObjectTools } from './mcp-http-tools.js';

const lookup = (reference: string) => ({ type: 'lookup', reference });
/** Each source lookup → its target's `enable` block (`undefined`: none declared). */
const TARGETS: Record<string, Record<string, unknown> | undefined> = {
  hidden: { apiEnabled: false },
  closed: { apiMethods: ['create'] },
  getonly: { apiMethods: ['get'] },
  none: { apiMethods: [] },
  listonly: { apiMethods: ['list'] },
  open: undefined,
};
const DEFS: Record<string, unknown> = {
  rcx_source: {
    name: 'rcx_source',
    fields: { name: { type: 'text' }, ...Object.fromEntries(Object.keys(TARGETS).map((rel) => [rel, lookup(`rcx_${rel}`)])) },
  },
  ...Object.fromEntries(Object.entries(TARGETS).map(([rel, enable]) => [
    `rcx_${rel}`, { name: `rcx_${rel}`, fields: { name: { type: 'text' } }, ...(enable ? { enable } : {}) },
  ])),
};
const REFUSED = [
  ['hidden', 'OBJECT_API_DISABLED', 404],
  ['closed', 'OBJECT_API_METHOD_NOT_ALLOWED', 405],
  ['getonly', 'OBJECT_API_METHOD_NOT_ALLOWED', 405],
  ['none', 'OBJECT_API_METHOD_NOT_ALLOWED', 405],
] as const;

function makeBridge() {
  const engine = { find: vi.fn(async () => [{ id: 's1' }]), aggregate: vi.fn(async () => [{ n: 1 }]) };
  const metadataService = { getObject: vi.fn(async (name: string) => DEFS[name]) };
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: metadataService as unknown as IMetadataService,
    resolvePrincipal: async () => ({ userId: 'u1', isSystem: false }) as unknown as ExecutionContext,
  });
  return { bridge, engine };
}

const VERBS = {
  query: (b: ReturnType<typeof makeBridge>['bridge'], where: Record<string, unknown>) => b.query('rcx_source', { where }),
  aggregate: (b: ReturnType<typeof makeBridge>['bridge'], where: Record<string, unknown>) =>
    b.aggregate!('rcx_source', { where, aggregations: [{ function: 'count', alias: 'n' }] }),
};

describe('[#22777] the stdio bridge refuses a condition on a target the decision does not serve for list', () => {
  for (const [verb, run] of Object.entries(VERBS)) {
    for (const [rel, code, status] of REFUSED) {
      for (const [shape, where] of [
        ['direct', { [rel]: { name: 'x' } }],
        ['under $or', { $or: [{ [rel]: { name: 'x' } }, { name: 'y' }] }],
        ['under $not', { $not: { [rel]: { name: 'x' } } }],
      ] as const) {
        it(`${verb}: ${rel} (${shape}) answers ${status} and never reaches the engine`, async () => {
          const { bridge, engine } = makeBridge();
          const err = (await run(bridge, where).then(() => null, (e: unknown) => e)) as McpExposureError | null;
          expect(err, 'the call resolved: no refusal was raised').toBeTruthy();
          expect(err!.code).toBe(code);
          expect(err!.status).toBe(status);
          if (status === 405) {
            expect(err!.allowedOperations).toEqual(effectiveOperationsArray(resolveEffectiveApiMethods(TARGETS[rel]!)));
          }
          expect(err!.message).toContain(`'rcx_${rel}'`);
          expect(err!.message).toContain(`'where.${rel}'`);
          expect(engine.find).not.toHaveBeenCalled();
          expect(engine.aggregate).not.toHaveBeenCalled();
        });
      }
    }

    it(`${verb}: CONTROL a served target, an id comparand and an operator bag reach the engine unchanged`, async () => {
      for (const where of [
        { listonly: { name: 'x' } },
        { $or: [{ open: { name: 'x' } }] },
        { hidden: 'h1' },
        { hidden: { $in: ['h1'] } },
      ]) {
        const { bridge, engine } = makeBridge();
        await run(bridge, where);
        const call = (verb === 'query' ? engine.find.mock.calls[0]?.[1] : engine.aggregate.mock.calls[0]?.[1]) as
          | { where?: unknown }
          | undefined;
        expect(call?.where, JSON.stringify(where)).toBe(where);
      }
    });
  }

  it('query_records answers the refusal naming the target and the position; CONTROL a served target is answered', async () => {
    const { bridge, engine } = makeBridge();
    const server = new McpServer({ name: 'pin', version: '0' });
    registerObjectTools(server, bridge);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'pin', version: '0' });
    await client.connect(clientSide);
    try {
      const call = (where: Record<string, unknown>) =>
        client.callTool({ name: 'query_records', arguments: { objectName: 'rcx_source', where } }) as Promise<{
          isError?: boolean;
          content: Array<{ text: string }>;
        }>;
      const refused = await call({ hidden: { name: 'x' } });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]!.text).toContain("Object 'rcx_hidden' is not exposed via the API");
      expect(refused.content[0]!.text).toContain("'where.hidden'");
      expect(engine.find).not.toHaveBeenCalled();
      const served = await call({ listonly: { name: 'x' } });
      expect(served.isError).toBeFalsy();
      expect(engine.find).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  });
});
