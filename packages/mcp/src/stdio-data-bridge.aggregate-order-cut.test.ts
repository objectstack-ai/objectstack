// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [aggregate order and cut] The stdio bridge's `aggregateGroups`: the same
 * gated read as `aggregate`, with the engine's order-cut-count request on the
 * engine's own read option (a `Symbol.for` key, since this package does not
 * depend on the engine at runtime), and the engine's outcome read back.
 *
 * Driven against a REAL `ObjectQL` over a recording driver named as the SQL
 * driver (the engine hands it the directive and it answers the rows and the
 * count column a database would), through `aggregate_records` on an MCP
 * client: a top five over more groups than the cap comes back as exactly five
 * groups, in the driver's order, with the statement's group count; the
 * engine's refusals (an order key naming no column of the row, a driver that
 * does not compile the cut) reach the client as their envelopes, and the
 * driver is never asked; a read the engine did not serve is never an answer.
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ObjectQL } from '@objectstack/objectql/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import { registerObjectTools } from './mcp-http-tools.js';

const OBJECT = 'oc_order';
const DEF = {
  name: OBJECT,
  label: 'Order',
  fields: {
    customer: { name: 'customer', type: 'text' },
    amount: { name: 'amount', type: 'number' },
    stage: { name: 'stage', type: 'select', options: [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }] },
  },
};
const DIRECTIVE = Symbol.for('objectstack.driver.aggregate.orderCut');
/** The engine's order-cut read option, spelled as the stdio bridge spells it. */
const AGGREGATE_ORDER_CUT = Symbol.for('objectstack.objectql.aggregateOrderCut');
const COUNT_COLUMN = '__os_total_groups';
const PRINCIPAL = { userId: 'u1', isSystem: true } as unknown as ExecutionContext;

/** 80 groups (more than the cap of 50), answered top-down as a database would after its ORDER BY. */
const GROUPS = Array.from({ length: 80 }, (_, i) => ({ customer: `c${79 - i}`, revenue: (79 - i) * 10 }));

function makeDriver(name: string, answerCount = true) {
  const asts: any[] = [];
  const driver: any = {
    name, version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; }, async findOne() { return null; }, async count() { return 0; },
    async aggregate(_o: string, ast: any) {
      asts.push(ast);
      const d = ast[DIRECTIVE];
      if (!d) return GROUPS.map((g) => ({ ...g }));
      const rows = GROUPS.slice(0, d.limit ?? GROUPS.length).map((g) => ({ ...g }));
      return answerCount ? rows.map((r) => ({ ...r, [d.totalGroupsColumn]: GROUPS.length })) : rows;
    },
    async create(_o: string, data: Record<string, unknown>) { return { ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { ...data, id }; },
    async delete() { return true; },
    async beginTransaction() { return {}; }, async commit() {}, async rollback() {},
  };
  return { driver, asts };
}

async function makeStdio(driverName = 'com.objectstack.driver.sql', answerCount = true, def: typeof DEF | Record<string, any> = DEF) {
  const { driver, asts } = makeDriver(driverName, answerCount);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(def as any, 'test');
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: { getObject: async (n: string) => (n === OBJECT ? def : undefined) } as unknown as IMetadataService,
    resolvePrincipal: async () => PRINCIPAL,
  });
  const server = new McpServer({ name: 'pin', version: '0' });
  registerObjectTools(server, bridge);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'pin', version: '0' });
  await client.connect(clientSide);
  const call = async (args: Record<string, unknown>) => {
    const res = (await client.callTool({
      name: 'aggregate_records',
      arguments: { objectName: OBJECT, groupBy: ['customer'], aggregations: [{ function: 'sum', field: 'amount', alias: 'revenue' }], ...args },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    return { isError: res.isError === true, body: JSON.parse(res.content[0]!.text) };
  };
  return { engine, bridge, asts, call, close: () => client.close() };
}

describe('[aggregate order and cut] stdio — aggregate_records over the engine', () => {
  it('top five over more groups than the cap: exactly five, in order, with the statement\'s group count', async () => {
    const h = await makeStdio();
    try {
      const { isError, body } = await h.call({ orderBy: [{ field: 'revenue', order: 'desc' }], limit: 5 });
      expect(isError, JSON.stringify(body)).toBe(false);
      expect(body.rows).toEqual(GROUPS.slice(0, 5));
      expect(body.totalGroups).toBe(80);
      expect(body.truncated).toBe(true);
      // The driver was handed the order, one probe group past the limit, and the count column — the cut is its statement's.
      expect(h.asts).toHaveLength(1);
      expect(h.asts[0][DIRECTIVE]).toEqual({
        orderBy: [{ column: 'revenue', order: 'desc' }, { column: 'customer', order: 'asc' }],
        limit: 6,
        totalGroupsColumn: COUNT_COLUMN,
      });
    } finally {
      await h.close();
    }
  });

  it('an order key naming no column of the aggregated row: INVALID_SORT naming the columns, the driver never asked', async () => {
    const h = await makeStdio();
    try {
      const { isError, body } = await h.call({ orderBy: [{ field: 'amount', order: 'desc' }], limit: 5 });
      expect(isError).toBe(true);
      expect({ code: body.error.code, status: body.error.status }).toEqual({ code: 'INVALID_SORT', status: 400 });
      expect(body.error.message).toContain('customer, revenue');
      expect(h.asts).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('a driver that does not compile the cut: INVALID_QUERY, the driver never asked', async () => {
    const h = await makeStdio('com.objectstack.driver.memory');
    try {
      const { isError, body } = await h.call({ orderBy: [{ field: 'revenue', order: 'desc' }], limit: 5 });
      expect(isError).toBe(true);
      expect({ code: body.error.code, status: body.error.status }).toEqual({ code: 'INVALID_QUERY', status: 400 });
      expect(h.asts).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('rows the driver answered without the group count are never an answer', async () => {
    const h = await makeStdio('com.objectstack.driver.sql', false);
    try {
      const { isError, body } = await h.call({ orderBy: [{ field: 'revenue', order: 'desc' }], limit: 5 });
      expect(isError).toBe(true);
      expect(body.error?.status ?? 500).toBe(500);
      expect(JSON.stringify(body)).not.toContain('c79');
    } finally {
      await h.close();
    }
  });

  it('a limit with no orderBy over a select key: the declared option order reaches the driver as the rank, before the cut', async () => {
    const h = await makeStdio();
    try {
      const { isError, body } = await h.call({ groupBy: ['stage', 'customer'], limit: 5 });
      expect(isError, JSON.stringify(body)).toBe(false);
      expect(body.totalGroups).toBe(80);
      expect(body).not.toHaveProperty('groupCount');
      expect(h.asts).toHaveLength(1);
      expect(h.asts[0][DIRECTIVE]).toEqual({
        orderBy: [
          { column: 'stage', order: 'asc', rank: ['open', 'won', 'lost'] },
          // The ranked column stays among the trailing keys: its unlisted values keep their own order.
          { column: 'stage', order: 'asc' },
          { column: 'customer', order: 'asc' },
        ],
        limit: 6,
        totalGroupsColumn: COUNT_COLUMN,
      });
    } finally {
      await h.close();
    }
  });

  it('the tool\'s longest declared order is the engine\'s longest rank: sent and served at the limit, neither past it', async () => {
    // The tool mirrors the engine's rank maximum (it has no runtime dependency
    // on the engine); this measures both at the boundary, so either moving
    // alone goes red.
    const wide = (n: number) => ({
      ...DEF,
      fields: { ...DEF.fields, wide: { name: 'wide', type: 'select', options: Array.from({ length: n }, (_, i) => ({ value: `w${i}` })) } },
    });
    const AT = 500;
    const at = await makeStdio('com.objectstack.driver.sql', true, wide(AT));
    try {
      const { isError, body } = await at.call({ groupBy: ['wide'], limit: 5 });
      // The tool sent the whole declared list as the rank, and the engine served it.
      expect(isError, JSON.stringify(body)).toBe(false);
      expect(at.asts[0][DIRECTIVE].orderBy[0].rank).toHaveLength(AT);
    } finally {
      await at.close();
    }
    const past = await makeStdio('com.objectstack.driver.sql', true, wide(AT + 1));
    try {
      const { isError, body } = await past.call({ groupBy: ['wide'], limit: 5 });
      // One past it, the tool sends no rank…
      expect(isError, JSON.stringify(body)).toBe(false);
      expect(past.asts[0][DIRECTIVE].orderBy).toEqual([{ column: 'wide', order: 'asc' }]);
      // …and the engine refuses that rank, the driver never asked.
      const rank = Array.from({ length: AT + 1 }, (_, i) => `w${i}`);
      const err: any = await past.engine
        .aggregate(OBJECT, { groupBy: ['wide'], aggregations: [{ function: 'count', alias: 'n' }] } as any,
          { [AGGREGATE_ORDER_CUT]: { orderBy: [{ field: 'wide', order: 'asc', rank }], limit: 5 } } as any)
        .then(() => undefined, (e: unknown) => e);
      expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_QUERY', status: 400 });
      expect(past.asts).toHaveLength(1);
    } finally {
      await past.close();
    }
  });

  it('CONTROL — no order, no limit: the uncut path, no directive, totalGroups and no second spelling of it', async () => {
    const h = await makeStdio();
    try {
      const { isError, body } = await h.call({});
      expect(isError).toBe(false);
      expect(body.rows).toHaveLength(50);
      expect(body).toMatchObject({ totalGroups: 80, truncated: true });
      expect(body).not.toHaveProperty('groupCount');
      expect(h.asts[0][DIRECTIVE]).toBeUndefined();
    } finally {
      await h.close();
    }
  });
});
