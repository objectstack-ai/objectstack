// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29896] The stdio data bridge's `query` refuses a sort on a field whose
 * author declared `sortable: false` with the Data API list door's
 * `400 INVALID_SORT`, before the engine runs anything. This transport hands
 * `orderBy` straight to `engine.find`, which judges only whether a column is
 * stored, so the stdio `query_records` was the one public door that still
 * sorted by such a field. The verdict is the served sortability projection's
 * (`resolveObjectSortability`), over the object `describe_object` serves.
 *
 * Controls: a field with no `sortable` key, a field with `sortable: true`, and
 * a query with no sort reach the engine unchanged. Refusals are asserted on the
 * envelope, never on a bare throw; the harness is the stand-in engine of
 * `stdio-data-bridge.internal-field-evaluation.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import { registerObjectTools } from './mcp-http-tools.js';

const OBJECT = 'sfx_note';
const DEF = {
  name: OBJECT,
  fields: {
    name: { type: 'text' },
    nosort: { type: 'textarea', sortable: false },
    rank: { type: 'number', sortable: true },
  },
};

const PRINCIPAL = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;

function makeBridge() {
  const engine = {
    find: vi.fn(async () => [{ id: 'r1', name: 'alpha' }]),
  };
  const metadataService = { getObject: vi.fn(async (name: string) => (name === OBJECT ? DEF : undefined)) };
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: metadataService as unknown as IMetadataService,
    resolvePrincipal: async () => PRINCIPAL,
  });
  return { bridge, engine };
}

const refusalOf = async (run: () => Promise<unknown>) => {
  const err: any = await run().then(() => undefined, (e: unknown) => e);
  expect(err, 'the call resolved: the sort refusal did not reach the caller').toBeDefined();
  return { code: err.code, status: err.status, field: err.field, object: err.object, param: err.param };
};
const REFUSED = { code: 'INVALID_SORT', status: 400, field: 'nosort', object: OBJECT, param: 'orderBy' };

describe('[#29896] stdio query: a sort on a `sortable: false` field is refused before the engine', () => {
  it('refuses the sort, alone or behind a sortable one, and never calls the engine', async () => {
    const { bridge, engine } = makeBridge();
    for (const orderBy of [
      [{ field: 'nosort', order: 'asc' as const }],
      [{ field: 'name', order: 'asc' as const }, { field: 'nosort', order: 'desc' as const }],
    ]) {
      expect(await refusalOf(() => bridge.query(OBJECT, { orderBy }))).toEqual(REFUSED);
    }
    expect(engine.find).not.toHaveBeenCalled();
  });

  it('CONTROL — no `sortable` key, `sortable: true` and no sort at all reach the engine unchanged', async () => {
    const { bridge, engine } = makeBridge();
    const orderBy = [{ field: 'name', order: 'asc' as const }, { field: 'rank', order: 'desc' as const }];
    await bridge.query(OBJECT, { orderBy, limit: 5 });
    expect(engine.find).toHaveBeenCalledTimes(1);
    expect(engine.find.mock.calls[0]![1]).toMatchObject({ orderBy, limit: 5 });
    // A filter on the field is not a sort: `sortable: false` governs ordering only.
    await bridge.query(OBJECT, { where: { nosort: 'x' } });
    expect(engine.find).toHaveBeenCalledTimes(2);
  });

  it('query_records renders the refusal as its envelope', async () => {
    const { bridge, engine } = makeBridge();
    const server = new McpServer({ name: 'pin', version: '0' });
    registerObjectTools(server, bridge);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'pin', version: '0' });
    await client.connect(clientSide);
    try {
      const res = (await client.callTool({
        name: 'query_records',
        arguments: { objectName: OBJECT, orderBy: [{ field: 'nosort', order: 'asc' }] },
      })) as { isError?: boolean; content: Array<{ text: string }> };
      expect(res.isError).toBe(true);
      const { error } = JSON.parse(res.content[0]!.text) as { error: { code: unknown; status: unknown; message: string } };
      expect({ code: error.code, status: error.status }).toEqual({ code: 'INVALID_SORT', status: 400 });
      expect(error.message).toContain("'nosort'");
      expect(engine.find).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});
