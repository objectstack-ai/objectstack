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
  const engine = {
    find: vi.fn(async (_object: string, _query?: { where?: unknown }) => [{ id: 's1' }]),
    aggregate: vi.fn(async (_object: string, _query?: { where?: unknown }) => [{ n: 1 }]),
  };
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
        const call = (verb === 'query' ? engine.find : engine.aggregate).mock.calls[0]?.[1];
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
      // [#23509] The tool renders the refusal's envelope: the code and status
      // the bridge threw, beside the unchanged sentence.
      const { error } = JSON.parse(refused.content[0]!.text) as {
        error: { code: unknown; status: unknown; message: string };
      };
      expect(error.code).toBe('OBJECT_API_DISABLED');
      expect(error.status).toBe(404);
      expect(error.message).toContain("Object 'rcx_hidden' is not exposed via the API");
      expect(error.message).toContain("'where.hidden'");
      expect(engine.find).not.toHaveBeenCalled();
      const served = await call({ listonly: { name: 'x' } });
      expect(served.isError).toBeFalsy();
      expect(engine.find).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  });
});

/**
 * [#36393] Every hop the engine serves, not the first one only: the engine
 * lowers a condition beneath a condition up to three relationships, reading
 * each related object, so the bridge asks every target on the way, disabled
 * package first, at its full position. `rcx_hop_source.mid → rcx_hop_mid`,
 * whose lookups reach `rcx_hidden` (not exposed), `rcx_open` and
 * `rcx_hop_locked` (a disabled package's object that also declares
 * `apiEnabled: false`: the order pin). The protocol's by-name read refuses a
 * disabled package's object, as the shipped protocol does.
 */
describe('[#36393] the stdio bridge asks every hop of a nested-relation condition', () => {
  const HOP_DEFS: Record<string, unknown> = {
    ...DEFS,
    rcx_hop_source: { name: 'rcx_hop_source', fields: { name: { type: 'text' }, mid: lookup('rcx_hop_mid') } },
    rcx_hop_mid: {
      name: 'rcx_hop_mid',
      fields: { name: { type: 'text' }, hidden: lookup('rcx_hidden'), open: lookup('rcx_open'), locked: lookup('rcx_hop_locked') },
    },
    rcx_hop_locked: { name: 'rcx_hop_locked', fields: { name: { type: 'text' } }, enable: { apiEnabled: false } },
  };

  function makeHopBridge(opts: { disabled: ReadonlySet<string>; isSystem?: boolean }) {
    const engine = {
      find: vi.fn(async (_object: string, _query?: { where?: unknown }) => [{ id: 's1' }]),
      aggregate: vi.fn(async (_object: string, _query?: { where?: unknown }) => [{ n: 1 }]),
    };
    const byName = async ({ name }: { type: string; name: string }) => {
      if (opts.disabled.has(name)) {
        throw Object.assign(new Error(`Object '${name}' belongs to a disabled package`), { code: 'OBJECT_PACKAGE_DISABLED', status: 404, object: name });
      }
      return { item: HOP_DEFS[name] };
    };
    const bridge = createStdioDataBridge({
      engine: engine as unknown as IDataEngine,
      metadataService: { getObject: vi.fn(async (name: string) => HOP_DEFS[name]) } as unknown as IMetadataService,
      protocol: () => ({ getMetaItem: byName }),
      resolvePrincipal: async () => ({ userId: 'u1', isSystem: opts.isSystem === true }) as unknown as ExecutionContext,
    });
    return { bridge, engine };
  }

  const HOP_VERBS = {
    query: (b: ReturnType<typeof makeHopBridge>['bridge'], where: Record<string, unknown>) => b.query('rcx_hop_source', { where }),
    aggregate: (b: ReturnType<typeof makeHopBridge>['bridge'], where: Record<string, unknown>) =>
      b.aggregate!('rcx_hop_source', { where, aggregations: [{ function: 'count', alias: 'n' }] }),
  };
  const refusal = async (run: () => Promise<unknown>) => {
    const err = (await run().then(() => null, (e: unknown) => e)) as (McpExposureError & { object?: string }) | null;
    expect(err, 'the call resolved: no refusal was raised').toBeTruthy();
    return err!;
  };

  for (const [verb, run] of Object.entries(HOP_VERBS)) {
    for (const [shape, where] of [
      ['direct', { mid: { hidden: { name: 'x' } } }],
      ['under $or', { $or: [{ mid: { hidden: { name: 'x' } } }, { name: 'y' }] }],
      ['under $not', { $not: { mid: { hidden: { name: 'x' } } } }],
    ] as const) {
      it(`${verb}: a two-hop condition (${shape}) on a target that is not exposed answers 404 at its full position and never reaches the engine`, async () => {
        const { bridge, engine } = makeHopBridge({ disabled: new Set() });
        const err = await refusal(() => run(bridge, where));
        expect({ code: err.code, status: err.status }).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
        expect(err.message).toContain("'rcx_hidden'");
        expect(err.message).toContain("'where.mid.hidden'");
        expect(engine.find).not.toHaveBeenCalled();
        expect(engine.aggregate).not.toHaveBeenCalled();
      });
    }

    it(`${verb}: a two-hop condition into a disabled package's object answers 404 OBJECT_PACKAGE_DISABLED, the stored value or any other`, async () => {
      for (const value of ['secret', 'NOPE']) {
        const { bridge, engine } = makeHopBridge({ disabled: new Set(['rcx_open']) });
        const err = await refusal(() => run(bridge, { mid: { open: { name: value } } }));
        expect({ code: err.code, status: err.status, object: err.object }).toEqual({ code: 'OBJECT_PACKAGE_DISABLED', status: 404, object: 'rcx_open' });
        expect(engine.find).not.toHaveBeenCalled();
        expect(engine.aggregate).not.toHaveBeenCalled();
      }
    });

    it(`${verb}: ORDER a two-hop target both disabled and not exposed answers the package refusal first, the exposure refusal once enabled`, async () => {
      const disabled = await refusal(() => run(makeHopBridge({ disabled: new Set(['rcx_hop_locked']) }).bridge, { mid: { locked: { name: 'x' } } }));
      expect({ code: disabled.code, status: disabled.status }).toEqual({ code: 'OBJECT_PACKAGE_DISABLED', status: 404 });
      const enabled = await refusal(() => run(makeHopBridge({ disabled: new Set() }).bridge, { mid: { locked: { name: 'x' } } }));
      expect({ code: enabled.code, status: enabled.status }).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
      expect(enabled.message).toContain("'where.mid.locked'");
    });

    it(`${verb}: CONTROL a two-hop condition on a served target reaches the engine unchanged`, async () => {
      const { bridge, engine } = makeHopBridge({ disabled: new Set() });
      const where = { mid: { open: { name: 'x' } } };
      await run(bridge, where);
      const call = (verb === 'query' ? engine.find : engine.aggregate).mock.calls[0]?.[1];
      expect(call?.where).toBe(where);
    });

    it(`${verb}: CONTROL a system context is asked nothing at any hop (this transport's bypass, unchanged)`, async () => {
      const { bridge, engine } = makeHopBridge({ disabled: new Set(['rcx_open']), isSystem: true });
      await run(bridge, { mid: { hidden: { name: 'x' } } });
      await run(bridge, { mid: { open: { name: 'x' } } });
      expect((verb === 'query' ? engine.find : engine.aggregate)).toHaveBeenCalledTimes(2);
    });
  }
});
