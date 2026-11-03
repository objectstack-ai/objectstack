// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';

/**
 * [#28715] The HTTP MCP bridge answers `optionFieldsOf(name)`: the fields of
 * the object `describeObject` reads that declare options, the list the
 * `validate_expression` tool hands the shared validator as
 * `ExprSchemaHint.optionFields` so it refuses `label(record.<field>)` on a
 * field with no options, as the object save door does.
 *
 * The read is the protocol's merged object listing (the one `describe_object`
 * answers from), or the metadata service's by-name read on a host with none.
 * Measured on real kernels (`ObjectKernel` + `MetadataPlugin` +
 * `ObjectQLPlugin`, with and without an `environmentId`), both serve a field
 * bound to a shared picklist with the list's resolved `options` beside its
 * `picklist` name, so the bridge reads it through `declaresOptions`, the
 * served-form predicate the engine builds `label()`'s map with. {@link SERVED}
 * is that measured shape. The stdio bridge's answer on the same shape, and
 * the tool's verdict against the door's, are pinned in `packages/mcp`
 * (`mcp-validate-expression.option-labels.test.ts`).
 */

const SERVED = {
  name: 'qaformula_p4',
  label: 'P4',
  fields: {
    first: { type: 'text', label: 'First' },
    kind: { type: 'select', label: 'Kind', options: [{ value: 'clean', label: 'Clean' }] },
    stage: { type: 'radio', label: 'Stage', options: [{ value: 'draft', label: 'Draft' }] },
    tier: { type: 'select', label: 'Tier', picklist: 'qa_tiers', options: [{ value: 'gold', label: 'Gold' }] },
  },
};

function makeKernel(opts: { withProtocol: boolean }) {
  const metadata: any = {
    listObjects: async () => [SERVED],
    getObject: async (name: string) => (name === SERVED.name ? SERVED : null),
    list: async () => [],
  };
  const protocol: any = {
    getMetaItems: async (req: any) => ({ type: req.type, items: req.type === 'object' ? [SERVED] : [] }),
  };
  const mcpService: any = {
    lastOpts: undefined,
    handleHttpRequest: async (_req: Request, o: any) => {
      mcpService.lastOpts = o;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const services: Record<string, any> = { mcp: mcpService, metadata };
  if (opts.withProtocol) services.protocol = protocol;
  return {
    getService: (n: string) => services[n],
    getServiceAsync: async (n: string) => services[n],
  } as any;
}

/** Drive the real HTTP entry point and hand back the bridge the runtime built. */
async function bridgeFor(kernel: any) {
  const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
  const res = await d.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
    request: new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{}',
    }),
    response: {},
    environmentId: undefined,
    executionContext: { userId: 'u1', isSystem: false, positions: [], permissions: [] },
  } as any);
  expect(res.response?.status, 'precondition: the MCP route must have been served').toBe(200);
  return kernel.getService('mcp').lastOpts.bridge;
}

describe('buildMcpBridge.optionFieldsOf reads the served object describeObject reads (#28715)', () => {
  const prev = process.env.OS_MCP_SERVER_ENABLED;
  beforeEach(() => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prev;
  });

  for (const withProtocol of [true, false]) {
    const read = withProtocol ? 'the merged listing' : 'the metadata service (no merged read)';
    it(`answers the option-bearing fields, picklist-bound included, from ${read}`, async () => {
      const bridge = await bridgeFor(makeKernel({ withProtocol }));
      expect(await bridge.optionFieldsOf('qaformula_p4')).toEqual(['kind', 'stage', 'tier']);
      expect(await bridge.optionFieldsOf('qa_absent')).toBeNull();
      // The same object `describe_object` describes, whose answer carries no options reading.
      const described = await bridge.describeObject('qaformula_p4');
      expect(described.fields.map((f: any) => f.name)).toEqual(['first', 'kind', 'stage', 'tier']);
      for (const f of described.fields) expect(Object.keys(f).sort()).toEqual(['label', 'name', 'required', 'type']);
    });
  }
});
