// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35138] `query_records` and `aggregate_records` answer a `source` block
 * beside a successful result, as `ObjectQuerySourceSchema`
 * (`@objectstack/spec/ai`) types it: how the figures were computed, and
 * `line`, that source written as one sentence in the caller's language for
 * the answer to quote. Without it an aggregate answer came back as a bare
 * number.
 *
 * What is pinned:
 * - the block is composed from the read that ran (object, the caller's
 *   `where` exactly as sent, measures, grouping, the caller's own order and
 *   the cut beside it) and parses against the published schema;
 * - fields are named by the label the caller's served definition shows, and
 *   by the caller's own string otherwise, so the line names nothing the
 *   caller's view does not show;
 * - `records` is stated only where the read established it: a page read's
 *   counted total, an uncut aggregate's bare count summed over every group
 *   (the groups past the cap included), never after a cut;
 * - the language is the caller's, read by the shared picker; the lead word is
 *   the one the open ask cards' citation grader reads (`Source:` / `来源：`);
 * - the line stays within the schema's 280-character budget, the filter
 *   shortened first while the block carries it whole;
 * - a read the schema cannot state truthfully (one record per group over
 *   several keys), or a block the schema refuses, is served with no block;
 * - both doors answer the same block: the HTTP door's bridge (a stand-in for
 *   `packages/runtime` `domains/mcp.ts`) and the stdio door's
 *   (`createStdioDataBridge` over a stand-in engine);
 * - an error answers no block, and `get_record` answers none (its answer is
 *   the record itself, where a top-level `source` would sit among the
 *   record's own fields).
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ObjectQuerySourceSchema } from '@objectstack/spec/ai';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import { registerObjectTools, type McpDataBridge } from './mcp-http-tools.js';
import { composeObjectQuerySource, servedLabelsOf, SOURCE_LINE_MAX } from './object-query-source.js';

const OBJECT = 'src_deal';
const DEF = {
  name: OBJECT,
  label: 'Deal',
  pluralLabel: 'Deals',
  fields: {
    name: { type: 'text', label: 'Deal name' },
    stage: { type: 'text', label: 'Stage' },
    amount: { type: 'number', label: 'Amount' },
    owner: { type: 'text', label: 'Owner' },
  },
};
const ROWS = [
  { id: 'd1', name: 'one', stage: 'won', amount: 10, owner: 'u1' },
  { id: 'd2', name: 'two', stage: 'won', amount: 20, owner: 'u2' },
  { id: 'd3', name: 'three', stage: 'open', amount: 5, owner: 'u1' },
];
const GROUPS = [{ owner: 'u1', n: 2, total: 15 }, { owner: 'u2', n: 1, total: 20 }];

const LABELS = servedLabelsOf(DEF);

describe('composeObjectQuerySource — the block and its line', () => {
  it('an aggregate: every key from the read that ran, parsing against the published schema', () => {
    const where = { stage: 'won' };
    const block = composeObjectQuerySource({
      object: OBJECT,
      where,
      groupBy: ['owner'],
      aggregations: [{ function: 'count', alias: 'n' }, { function: 'sum', field: 'amount', alias: 'total' }],
      records: 3,
    }, LABELS, ['en']);
    expect(ObjectQuerySourceSchema.safeParse(block).success).toBe(true);
    expect(block).toMatchObject({
      object: OBJECT,
      filter: where,
      scope: 'visible_to_you',
      groupBy: ['owner'],
      aggregations: [{ function: 'count' }, { function: 'sum', field: 'amount' }],
      records: 3,
    });
    // The schema's `label` follows its own translation rule; the producer sets none.
    expect(block).not.toHaveProperty('label');
    const line = block!.line;
    expect(line.startsWith('Source: ')).toBe(true);
    // The object by its served plural label beside its name, the measure and
    // the grouping by their served labels, the filter as sent.
    for (const named of ['Deals (src_deal)', 'Amount', 'Owner', '{"stage":"won"}']) expect(line).toContain(named);
  });

  it('a field the served definition does not show is named by the caller\'s own string, never by a label', () => {
    const hidden = servedLabelsOf({ ...DEF, fields: { amount: DEF.fields.amount } });
    const block = composeObjectQuerySource({
      object: OBJECT,
      groupBy: ['owner'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 't' }],
    }, hidden, ['en'])!;
    expect(block.line).toContain('owner');
    expect(block.line).not.toContain('Owner');
    // No served definition at all: machine names throughout.
    const bare = composeObjectQuerySource({ object: OBJECT }, servedLabelsOf(undefined), ['en'])!;
    expect(bare.line.startsWith(`Source: ${OBJECT}`)).toBe(true);
  });

  for (const [codes, lead] of [
    [['zh-CN'], '来源：'],
    [['zh-TW'], '來源：'],
    [['ja-JP'], '出典：'],
    [['fr-FR', 'zh-CN'], '来源：'],
    [['fr-FR'], 'Source: '],
    [[], 'Source: '],
  ] as const) {
    it(`the caller's ladder ${JSON.stringify(codes)} writes the line in the language it picks`, () => {
      const block = composeObjectQuerySource({ object: OBJECT }, LABELS, codes)!;
      expect(block.line.startsWith(lead)).toBe(true);
    });
  }

  it('the cut is stated only beside the caller\'s own order, as the schema has it', () => {
    const withOrder = composeObjectQuerySource({ object: OBJECT, orderBy: [{ field: 'amount', order: 'desc' }], limit: 5 }, LABELS, ['en'])!;
    expect(withOrder).toMatchObject({ orderBy: [{ field: 'amount', order: 'desc' }], limit: 5 });
    const withoutOrder = composeObjectQuerySource({ object: OBJECT, limit: 5 }, LABELS, ['en'])!;
    expect(withoutOrder).not.toHaveProperty('limit');
    expect(withoutOrder).not.toHaveProperty('orderBy');
  });

  it('a long filter is shortened in the line, never in the block, and the line keeps its budget', () => {
    const where = { name: { $in: Array.from({ length: 80 }, (_, i) => `deal-${i}`) } };
    const block = composeObjectQuerySource({ object: OBJECT, where, records: 80 }, LABELS, ['en'])!;
    expect(Array.from(block.line).length).toBeLessThanOrEqual(SOURCE_LINE_MAX);
    expect(block.line).toContain('…');
    expect(block.line).toContain('80 records');
    expect(block.filter).toEqual(where);
  });

  it('one record per group over one key is stated; over several keys no block is served', () => {
    const one = composeObjectQuerySource({
      object: OBJECT,
      latestPer: { by: ['owner'], orderBy: [{ field: 'amount', order: 'desc' }] },
    }, LABELS, ['en'])!;
    expect(one.latestPer).toEqual({ groupBy: 'owner', orderField: 'amount' });
    expect(composeObjectQuerySource({
      object: OBJECT,
      latestPer: { by: ['owner', 'stage'], orderBy: [{ field: 'amount', order: 'desc' }] },
    }, LABELS, ['en'])).toBeUndefined();
  });

  it('a block the published schema refuses is no block', () => {
    // An array in the equality slot is refused by `FilterConditionSchema`.
    expect(composeObjectQuerySource({ object: OBJECT, where: { stage: ['won', 'open'] } }, LABELS, ['en'])).toBeUndefined();
  });
});

type Door = { bridge: McpDataBridge };

/** The HTTP door's bridge: the data door's page facts, the caller's served definition and locale ladder. */
function httpDoor(locales: readonly string[] = []): Door {
  const bridge = {
    async listObjects() { return [{ name: OBJECT, label: 'Deal' }]; },
    async describeObject(name: string) { return name === OBJECT ? { name, fields: Object.keys(DEF.fields).map((n) => ({ name: n })) } : null; },
    async servedObjectDefinitionOf(name: string) { return name === OBJECT ? DEF : null; },
    async userTextLocales() { return locales; },
    async query(object: string, opts: { where?: Record<string, unknown>; limit?: number }) {
      const records = ROWS.filter((r) => Object.entries(opts.where ?? {}).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
      const page = records.slice(0, opts.limit);
      return { object, records: page, total: records.length, hasMore: page.length < records.length };
    },
    async aggregate() { return GROUPS.map((g) => ({ ...g })); },
    async aggregateGroups(_object: string, o: { limit?: number }) {
      return { rows: GROUPS.slice(0, o.limit).map((g) => ({ ...g })), totalGroups: GROUPS.length };
    },
    async get(object: string, id: string) { return { ...ROWS.find((r) => r.id === id), object }; },
    async create(object: string, data: unknown) { return { object, data }; },
    async update(object: string, id: string) { return { object, id }; },
    async remove(object: string, id: string) { return { object, id, success: true }; },
  } as unknown as McpDataBridge;
  return { bridge };
}

/** The stdio door's bridge, over a stand-in engine; the principal's locale is the ladder. */
function stdioDoor(locales: readonly string[] = []): Door {
  const principal = { userId: 'u1', isSystem: false, ...(locales[0] ? { locale: locales[0] } : {}) } as unknown as ExecutionContext;
  const engine = {
    find: vi.fn(async (_object: string, query: { where?: Record<string, unknown>; limit?: number }) =>
      ROWS.filter((r) => Object.entries(query.where ?? {}).every(([k, v]) => (r as Record<string, unknown>)[k] === v)).slice(0, query.limit)),
    count: vi.fn(async (_object: string, query: { where?: Record<string, unknown> }) =>
      ROWS.filter((r) => Object.entries(query?.where ?? {}).every(([k, v]) => (r as Record<string, unknown>)[k] === v)).length),
    aggregate: vi.fn(async () => GROUPS.map((g) => ({ ...g }))),
  };
  const metadataService = { getObject: vi.fn(async (name: string) => (name === OBJECT ? DEF : undefined)) };
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: metadataService as unknown as IMetadataService,
    resolvePrincipal: async () => principal,
  });
  return { bridge };
}

async function callTool(
  bridge: McpDataBridge,
  name: string,
  args: Record<string, unknown>,
  options: { maxQueryLimit?: number } = {},
): Promise<{ isError: boolean; payload: any }> {
  const server = new McpServer({ name: 'pin', version: '0' });
  registerObjectTools(server, bridge, options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'pin', version: '0' });
  await client.connect(clientSide);
  try {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
    let payload: any;
    try { payload = JSON.parse(res.content[0]!.text); } catch { payload = res.content[0]?.text; }
    return { isError: res.isError === true, payload };
  } finally {
    await client.close();
  }
}

const DOORS = [
  ['HTTP', httpDoor],
  ['stdio', stdioDoor],
] as const;

describe('query_records / aggregate_records — the source block on both doors (#35138)', () => {
  for (const [door, make] of DOORS) {
    it(`${door} door: query_records states the object, the filter as sent and the counted total`, async () => {
      const { bridge } = make();
      const { isError, payload } = await callTool(bridge, 'query_records', {
        objectName: OBJECT,
        where: { stage: 'won' },
        orderBy: [{ field: 'amount', order: 'desc' }],
        limit: 1,
      });
      expect(isError).toBe(false);
      expect(ObjectQuerySourceSchema.safeParse(payload.source).success).toBe(true);
      expect(payload.source).toMatchObject({
        object: OBJECT,
        filter: { stage: 'won' },
        scope: 'visible_to_you',
        orderBy: [{ field: 'amount', order: 'desc' }],
        limit: 1,
        records: 2,
      });
      expect(payload.source.line).toContain('Deals (src_deal)');
    });

    it(`${door} door: an uncut aggregate states its measures, grouping and the records every group covers`, async () => {
      const { bridge } = make();
      // A cap of one group: the bare count is summed over every group, the one past the cap included.
      const { isError, payload } = await callTool(bridge, 'aggregate_records', {
        objectName: OBJECT,
        groupBy: ['owner'],
        aggregations: [{ function: 'count', alias: 'n' }, { function: 'sum', field: 'amount', alias: 'total' }],
      }, { maxQueryLimit: 1 });
      expect(isError).toBe(false);
      expect(payload.truncated).toBe(true);
      expect(payload.rows).toHaveLength(1);
      expect(payload.source).toMatchObject({
        object: OBJECT,
        scope: 'visible_to_you',
        groupBy: ['owner'],
        aggregations: [{ function: 'count' }, { function: 'sum', field: 'amount' }],
        records: 3,
      });
      expect(payload.source).not.toHaveProperty('filter');
      for (const named of ['Amount', 'Owner']) expect(payload.source.line).toContain(named);
    });

    it(`${door} door: the caller's locale writes the line`, async () => {
      const { bridge } = make(['zh-CN']);
      const { payload } = await callTool(bridge, 'aggregate_records', {
        objectName: OBJECT,
        aggregations: [{ function: 'count', alias: 'n' }],
      });
      expect(payload.source.line.startsWith('来源：')).toBe(true);
    });

    it(`${door} door: an error answers no block, and get_record answers none`, async () => {
      const { bridge } = make();
      const refused = await callTool(bridge, 'query_records', { objectName: 'sys_user' });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.payload)).not.toContain('"source"');
      const record = await callTool(bridge, 'get_record', { objectName: OBJECT, recordId: 'd1' });
      expect(record.isError).toBe(false);
      expect(record.payload).not.toHaveProperty('source');
    });
  }

  it('the order-and-cut path states the caller\'s order and the cut, and no records (the groups after a cut are not all)', async () => {
    const { bridge } = httpDoor();
    const { isError, payload } = await callTool(bridge, 'aggregate_records', {
      objectName: OBJECT,
      groupBy: ['owner'],
      aggregations: [{ function: 'count', alias: 'n' }],
      orderBy: [{ field: 'n', order: 'desc' }],
      limit: 1,
    });
    expect(isError).toBe(false);
    expect(payload.source).toMatchObject({ orderBy: [{ field: 'n', order: 'desc' }], limit: 1 });
    expect(payload.source).not.toHaveProperty('records');
  });

  it('a bridge with no served definition and no locale member still answers the block, in machine names and English', async () => {
    const { bridge } = httpDoor();
    delete (bridge as Partial<McpDataBridge>).servedObjectDefinitionOf;
    delete (bridge as Partial<McpDataBridge>).userTextLocales;
    const { payload } = await callTool(bridge, 'query_records', { objectName: OBJECT });
    expect(payload.source.line.startsWith(`Source: ${OBJECT}`)).toBe(true);
    expect(payload.source.records).toBe(3);
  });
});
