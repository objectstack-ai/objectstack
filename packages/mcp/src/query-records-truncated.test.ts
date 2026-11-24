// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35138] A `query_records` page that hit its row cap says so with
 * `truncated: true`, on both doors, so a model does not sum or rank one page
 * as if it were the whole set.
 *
 * The flag is decided by a probe: the handler asks the bridge for one row
 * more than the page, serves the page, and flags it when the extra row came
 * back. A page holding exactly `limit` rows and no more carries no flag. The
 * flag is present only when true.
 *
 * The two doors are the two bridges the tool runs over: the HTTP door's
 * (`packages/runtime` `domains/mcp.ts`, `callData('query')` into the data
 * door's `findData`, which answers a counted `total` and `hasMore`; the stand
 * in below answers the same page facts) and the stdio door's
 * (`createStdioDataBridge`, over a stand-in engine). The stdio bridge used to
 * answer `total: records.length` with no `hasMore`, so a capped stdio page
 * claimed to be whole; it now counts, as the data door does, and never states
 * a total it did not count.
 *
 * Where the host's read window (`OS_DATA_MAX_PAGE_SIZE` /
 * `OS_DATA_QUERY_ROW_BUDGET`) would refuse the probe row, the page is read as
 * asked and the door's counted `hasMore` decides.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import { registerObjectTools, type McpDataBridge } from './mcp-http-tools.js';

const OBJECT = 'cap_deal';
const DEF = { name: OBJECT, fields: { name: { type: 'text' } } };
const PRINCIPAL = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i + 1}`, name: `deal ${i + 1}` }));

type QueryOpts = { limit?: number; offset?: number };

/** The HTTP door's bridge: the data door's `findData` page facts — a counted total and `hasMore`. */
function httpDoor(stored: number) {
  const rows = rowsOf(stored);
  const asked: QueryOpts[] = [];
  const bridge = {
    async listObjects() { return [{ name: OBJECT, label: 'Deal' }]; },
    async describeObject(name: string) { return { name }; },
    async query(object: string, opts: QueryOpts) {
      asked.push({ limit: opts.limit, offset: opts.offset });
      const offset = opts.offset ?? 0;
      const records = rows.slice(offset, opts.limit === undefined ? undefined : offset + opts.limit);
      return { object, records, total: rows.length, hasMore: offset + records.length < rows.length };
    },
    async get(object: string, id: string) { return { object, id }; },
    async create(object: string, data: unknown) { return { object, data }; },
    async update(object: string, id: string) { return { object, id }; },
    async remove(object: string, id: string) { return { object, id, success: true }; },
  } as unknown as McpDataBridge;
  return { bridge, asked };
}

/** The stdio door's bridge, over a stand-in engine that honours `limit` / `offset` and counts. */
function stdioDoor(stored: number, opts: { countThrows?: boolean } = {}) {
  const rows = rowsOf(stored);
  const asked: QueryOpts[] = [];
  const engine = {
    find: vi.fn(async (_object: string, query: QueryOpts) => {
      asked.push({ limit: query.limit, offset: query.offset });
      const offset = query.offset ?? 0;
      return rows.slice(offset, query.limit === undefined ? undefined : offset + query.limit);
    }),
    count: vi.fn(async () => {
      if (opts.countThrows) throw new Error('count unavailable');
      return rows.length;
    }),
  };
  const metadataService = { getObject: vi.fn(async (name: string) => (name === OBJECT ? DEF : undefined)) };
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: metadataService as unknown as IMetadataService,
    resolvePrincipal: async () => PRINCIPAL,
  });
  return { bridge, asked, engine };
}

async function queryRecords(bridge: McpDataBridge, args: Record<string, unknown>): Promise<any> {
  const server = new McpServer({ name: 'pin', version: '0' });
  registerObjectTools(server, bridge);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'pin', version: '0' });
  await client.connect(clientSide);
  try {
    const res = (await client.callTool({
      name: 'query_records',
      arguments: { objectName: OBJECT, ...args },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError, res.content[0]?.text).toBeFalsy();
    return JSON.parse(res.content[0]!.text);
  } finally {
    await client.close();
  }
}

const DOORS = [
  ['HTTP', httpDoor],
  ['stdio', stdioDoor],
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('query_records — a capped page says `truncated: true` (#35138)', () => {
  for (const [door, make] of DOORS) {
    it(`${door} door: a page that hit its cap answers truncated: true, with the page only`, async () => {
      const { bridge, asked } = make(5);
      const payload = await queryRecords(bridge, { limit: 3 });
      expect(payload.truncated).toBe(true);
      expect(payload.records.map((r: { id: string }) => r.id)).toEqual(['d1', 'd2', 'd3']);
      expect(payload.total).toBe(5);
      expect(payload.hasMore).toBe(true);
      // The probe: one row past the page was asked for.
      expect(asked).toEqual([{ limit: 4, offset: undefined }]);
    });

    it(`${door} door: a page with exactly limit rows and no more answers no truncated`, async () => {
      const { bridge } = make(3);
      const payload = await queryRecords(bridge, { limit: 3 });
      expect('truncated' in payload).toBe(false);
      expect(payload.records).toHaveLength(3);
      expect(payload.total).toBe(3);
      expect(payload.hasMore).toBe(false);
    });

    it(`${door} door: the last page of a paged read is not capped`, async () => {
      const { bridge } = make(5);
      const payload = await queryRecords(bridge, { limit: 3, offset: 3 });
      expect('truncated' in payload).toBe(false);
      expect(payload.records.map((r: { id: string }) => r.id)).toEqual(['d4', 'd5']);
      expect(payload.hasMore).toBe(false);
    });

    it(`${door} door: where the read window would refuse the probe row, the page is read as asked and hasMore decides`, async () => {
      vi.stubEnv('OS_DATA_MAX_PAGE_SIZE', '3');
      const capped = make(5);
      const payload = await queryRecords(capped.bridge, { limit: 3 });
      expect(capped.asked).toEqual([{ limit: 3, offset: undefined }]);
      expect(payload.truncated).toBe(true);
      expect(payload.records).toHaveLength(3);

      const whole = make(3);
      expect('truncated' in (await queryRecords(whole.bridge, { limit: 3 }))).toBe(false);
    });
  }
});

describe('stdio query: the page facts are counted, never the page length (#35138)', () => {
  it('a capped page answers the match total and hasMore, not total: records.length', async () => {
    const { bridge, engine } = stdioDoor(5);
    const page: any = await bridge.query(OBJECT, { limit: 3 });
    expect(page.records).toHaveLength(3);
    expect(page.total).toBe(5);
    expect(page.hasMore).toBe(true);
    // Counted as the caller, under the caller's filter.
    expect(engine.count).toHaveBeenCalledWith(OBJECT, {}, { context: PRINCIPAL });
  });

  it('a count that fails states no total at all', async () => {
    const { bridge } = stdioDoor(5, { countThrows: true });
    const page: any = await bridge.query(OBJECT, { limit: 3 });
    expect(page.records).toHaveLength(3);
    expect('total' in page).toBe(false);
    expect(page.hasMore).toBe(true);
  });

  it('an unpaged read is the whole set: its length is the total, and no count runs', async () => {
    const { bridge, engine } = stdioDoor(4);
    const page: any = await bridge.query(OBJECT, {});
    expect(page.total).toBe(4);
    expect(page.hasMore).toBe(false);
    expect(engine.count).not.toHaveBeenCalled();
  });
});
