// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A create or update over the stdio MCP transport answers `droppedFields`, as
 * the HTTP transport does (the protocol's `createData` / `updateData`), and
 * never echoes a value the engine dropped.
 *
 * ## The reading this pins
 *
 * The stdio bridge called `engine.insert` / `engine.update` with no
 * `onFieldsDropped` listener and built its answer from the caller's payload:
 * `{ ...data, ...written }` on create, `{ ...existing, ...data }` on update.
 * So a non-system write of a `readonly: true` column, or of a roll-up
 * `summary` (read-only on both verbs whether or not it declares `readonly`),
 * answered success with no `droppedFields`, and the record in the answer
 * carried the caller's dropped value wherever the write result did not
 * overwrite it. Measured on update: the answer carried `biggest: 99` and
 * `locked: 'forged'` over the stored `5` and `'kept'`. On create the real
 * engine's write result names every declared field (`null` where nothing was
 * stored), so it overwrites the echo here; the create assertions hold the
 * answer for any write result that leaves such a key out.
 *
 * ## What is real here
 *
 * The engine is a real `ObjectQL` (its strips, its roll-up seed, its
 * listener), over a driver that keeps rows and returns the row it was handed.
 * The bridge is the real stdio bridge, served through the runtime's HTTP face
 * (the tools are one registration for both transports), so the answer read is
 * the `create_record` / `update_record` tool answer a caller sees. Controls: a
 * write that sends no locked key answers no `droppedFields`.
 *
 * Keys and values are asserted, never wording.
 */

import { describe, it, expect } from 'vitest';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
// The lean engine entry, aliased to the source in this package's vitest config.
import { ObjectQL } from '@objectstack/objectql/core';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import type { McpDataBridge } from './mcp-http-tools.js';

type Row = Record<string, unknown>;

const ACCOUNT = 'dfx_acct';
const ORDER = 'dfx_ord';

const account = {
  name: ACCOUNT,
  label: 'Account',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    // A declared read-only column with no default.
    locked: { name: 'locked', type: 'text', readonly: true },
    // A roll-up with no `readonly` and no empty-set value (`max`).
    biggest: {
      name: 'biggest',
      type: 'summary',
      summaryOperations: { object: ORDER, field: 'amount', function: 'max' },
    },
  },
  enable: {},
};
const order = {
  name: ORDER,
  label: 'Order',
  fields: {
    id: { name: 'id', type: 'text' },
    amount: { name: 'amount', type: 'number' },
    acct: { name: 'acct', type: 'master_detail', reference: ACCOUNT },
  },
  enable: {},
};

/** A driver that keeps rows and returns the row it was handed: flat equality and `$in` WHERE. */
function rowDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Row, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and') {
        if (!(v as any[]).every((sub) => matches(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
        if (!(v as any).$in.some((x: unknown) => String(x) === String(row[k]))) return false;
        continue;
      }
      const exp = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'rows',
    version: '0.0.0',
    supports: {},
    rowOf: (o: string, id: string) => storeFor(o).get(id),
    seed(o: string, row: Row) { storeFor(o).set(String(row.id), { ...row }); },
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return (typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows).map((r) => ({ ...r }));
    },
    async findOne(o: string, ast: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(o: string, data: Row) {
      nextId += 1;
      const id = (data.id as string) ?? `e_${nextId}`;
      const row = JSON.parse(JSON.stringify({ ...data, id }));
      storeFor(o).set(id, row);
      return { ...row };
    },
    async update(o: string, id: string, data: Row) {
      const cur = storeFor(o).get(String(id));
      if (!cur) throw new Error(`not found ${o}/${id}`);
      const up = { ...cur, ...data, id };
      storeFor(o).set(String(id), up);
      return { ...up };
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
  };
  return driver;
}

async function stack() {
  const engine = new ObjectQL({ logger: { debug() {}, info() {}, warn() {}, error() {} } } as any);
  const driver = rowDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [account, order]) engine.registry.registerObject(o as any, '__test__');
  driver.seed(ACCOUNT, { id: 'a1', name: 'Acme', locked: 'kept', biggest: 5 });
  const defs: Record<string, unknown> = { [ACCOUNT]: account, [ORDER]: order };
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: {
      listObjects: async () => Object.values(defs),
      getObject: async (name: string) => defs[name],
    } as unknown as IMetadataService,
    // A person: not the system principal, so both locks apply.
    resolvePrincipal: async () => ({ userId: 'u1' }) as unknown as ExecutionContext,
  });
  return { bridge, driver };
}

let rpcId = 1;
async function callTool(bridge: McpDataBridge, name: string, args: Record<string, unknown>) {
  const body = { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } };
  const runtime = new MCPServerRuntime({ name: 'pin', version: '0.0.0' });
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge: bridge as any, parsedBody: body },
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { result?: any; error?: unknown };
  expect(json.error, JSON.stringify(json.error)).toBeUndefined();
  const result = json.result as { content: Array<{ text: string }>; isError?: boolean };
  expect(result.isError, result.content[0]!.text).not.toBe(true);
  return JSON.parse(result.content[0]!.text);
}

/** The dropped field names of an answer, each with its reason, sorted. */
const droppedOf = (answer: { droppedFields?: DroppedFieldsEvent[] }) =>
  (answer.droppedFields ?? [])
    .flatMap((e) => e.fields.map((field) => `${e.object}.${field}:${e.reason}`))
    .sort();

describe('stdio MCP create_record / update_record answer droppedFields and echo no dropped value', () => {
  it('create_record: a readonly column and a roll-up are dropped, named in droppedFields, and not echoed', async () => {
    const { bridge, driver } = await stack();

    const answer = await callTool(bridge, 'create_record', {
      objectName: ACCOUNT,
      data: { name: 'Globex', locked: 'forged', biggest: 77 },
    });

    expect(droppedOf(answer)).toEqual([`${ACCOUNT}.biggest:readonly`, `${ACCOUNT}.locked:readonly`]);
    expect(answer.record.name).toBe('Globex');
    expect(answer.record.locked ?? null).toBeNull();
    expect(answer.record.biggest ?? null).toBeNull();
    // The answer says what was stored.
    const stored = driver.rowOf(ACCOUNT, answer.id);
    expect(stored?.locked ?? null).toBeNull();
    expect(stored?.biggest ?? null).toBeNull();
  });

  it('control: a create_record that sends no locked key answers no droppedFields', async () => {
    const { bridge } = await stack();

    const answer = await callTool(bridge, 'create_record', { objectName: ACCOUNT, data: { name: 'Initech' } });

    expect(answer).not.toHaveProperty('droppedFields');
    expect(answer.record.name).toBe('Initech');
  });

  it('update_record: a readonly column and a roll-up are dropped, named in droppedFields, and the stored values stand', async () => {
    const { bridge, driver } = await stack();

    const answer = await callTool(bridge, 'update_record', {
      objectName: ACCOUNT,
      recordId: 'a1',
      data: { name: 'Acme Corp', locked: 'forged', biggest: 99 },
    });

    expect(droppedOf(answer)).toEqual([`${ACCOUNT}.biggest:readonly`, `${ACCOUNT}.locked:readonly`]);
    expect(answer.record).toMatchObject({ id: 'a1', name: 'Acme Corp', locked: 'kept', biggest: 5 });
    expect(driver.rowOf(ACCOUNT, 'a1')).toMatchObject({ name: 'Acme Corp', locked: 'kept', biggest: 5 });
  });

  it('control: an update_record that sends no locked key answers no droppedFields', async () => {
    const { bridge } = await stack();

    const answer = await callTool(bridge, 'update_record', {
      objectName: ACCOUNT,
      recordId: 'a1',
      data: { name: 'Acme Ltd' },
    });

    expect(answer).not.toHaveProperty('droppedFields');
    expect(answer.record).toMatchObject({ id: 'a1', name: 'Acme Ltd', locked: 'kept', biggest: 5 });
  });
});
