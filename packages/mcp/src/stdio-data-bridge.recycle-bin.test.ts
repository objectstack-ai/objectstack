// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A delete over MCP answers whether the recycle bin kept the record:
 * `delete_record` with the spec's `recycleBinEntryId` (`DeleteDataResponse`),
 * `delete_records` with `recycleBinEntries`, one `{ recordId,
 * recycleBinEntryId }` per deleted record the bin kept.
 *
 * ## The reading this pins
 *
 * Measured on a booted showcase (real ObjectQL, SqlDriver, `sys_recycle_bin`)
 * through both transports: every confirmed `delete_record` and
 * `delete_records` of a business record wrote a recycle-bin entry (30-day
 * retention, restored 200 through the REST door). The HTTP bridge answered
 * the entry (the protocol's `deleteData` asks the engine for it); the stdio
 * bridge did not ask, so its `delete_record` answer named no entry and the
 * record read as gone for good; `delete_records` named none on either.
 *
 * ## What is real here
 *
 * The engine is a real `ObjectQL` (the capture, the cascade, the entry write),
 * over a driver that keeps rows, with the bin declared as
 * `@objectstack/platform-objects` declares it. The bridge is the real stdio
 * bridge, served through the runtime's HTTP face (the tools are one
 * registration for both transports). Controls: a platform object (`ai_`; a
 * `sys_` one is refused by the object guard unless the host allows system
 * objects) and a composition with no bin delete for good, and their answers
 * name no entry.
 *
 * Keys and ids are asserted, never wording.
 */

import { describe, it, expect } from 'vitest';
import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { RECYCLE_BIN_ENTRY_FIELDS, RECYCLE_BIN_OBJECT } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL } from '@objectstack/objectql';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import type { McpDataBridge } from './mcp-http-tools.js';

type Row = Record<string, unknown>;

const NOTE = 'rbx_note';
const PLATFORM = 'ai_rbx_thing';

const text = (name: string) => ({ name, type: 'text' as const });
const note = { name: NOTE, label: 'Note', fields: { id: text('id'), title: text('title') }, enable: {} };
const platformThing = { name: PLATFORM, label: 'Thing', fields: { id: text('id'), title: text('title') }, enable: {} };
/** The bin, declared as `@objectstack/platform-objects` declares it. */
const bin = {
  name: RECYCLE_BIN_OBJECT,
  label: 'Recycle Bin Entry',
  managedBy: 'engine-owned',
  fields: { ...RECYCLE_BIN_ENTRY_FIELDS },
  lifecycle: { class: 'transient', ttl: { field: 'purge_after', expireAfter: '0h' } },
};

/** A driver that keeps rows: equality and `$in` WHERE, the caller's `limit` after the filter. */
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
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
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

async function stack(options: { withBin: boolean }) {
  const engine = new ObjectQL({ logger: { debug() {}, info() {}, warn() {}, error() {} } } as any);
  const driver = rowDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  const objects: any[] = [note, platformThing, ...(options.withBin ? [bin] : [])];
  for (const o of objects) engine.registry.registerObject(o, '__test__');
  for (const object of [NOTE, PLATFORM]) {
    for (const id of ['r1', 'r2', 'r3']) driver.seed(object, { id, title: `${object} ${id}` });
  }
  const defs: Record<string, unknown> = { [NOTE]: note, [PLATFORM]: platformThing };
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: {
      listObjects: async () => Object.values(defs),
      getObject: async (name: string) => defs[name],
    } as unknown as IMetadataService,
    resolvePrincipal: async () => ({ userId: 'u1' }) as unknown as ExecutionContext,
  });
  /** The bin's entries for `object`, keyed by the record each holds. */
  const entriesOf = (object: string) =>
    new Map((driver.rowsOf(RECYCLE_BIN_OBJECT) as Row[])
      .filter((e) => e.object_name === object)
      .map((e) => [String(e.record_id), String(e.id)]));
  return { bridge, driver, entriesOf };
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

const confirmed = { [AI_ACTION_CONFIRMATION_MEMBER]: true };

describe('a delete over MCP names the recycle-bin entry that keeps the record', () => {
  it('delete_record answers recycleBinEntryId: the entry the bin wrote for the record', async () => {
    const { bridge, driver, entriesOf } = await stack({ withBin: true });

    const answer = await callTool(bridge, 'delete_record', { objectName: NOTE, recordId: 'r1', ...confirmed });

    const entry = entriesOf(NOTE).get('r1');
    expect(entry, 'the bin wrote no entry for the deleted record').toBeDefined();
    expect(answer).toEqual({ object: NOTE, id: 'r1', success: true, recycleBinEntryId: entry });
    expect(driver.rowsOf(NOTE).map((r: Row) => r.id)).toEqual(['r2', 'r3']);
  });

  it('delete_records answers recycleBinEntries: each deleted record with its entry', async () => {
    const { bridge, entriesOf } = await stack({ withBin: true });

    const answer = await callTool(bridge, 'delete_records', { objectName: NOTE, recordIds: ['r1', 'r3'], ...confirmed });

    const entries = entriesOf(NOTE);
    expect(entries.size).toBe(2);
    expect(answer).toMatchObject({ deleted: 2, refused: 0 });
    expect(answer.recycleBinEntries).toEqual([
      { recordId: 'r1', recycleBinEntryId: entries.get('r1') },
      { recordId: 'r3', recycleBinEntryId: entries.get('r3') },
    ]);
  });

  it('control: a platform object deletes for good, and neither answer names an entry', async () => {
    const { bridge, driver } = await stack({ withBin: true });

    const one = await callTool(bridge, 'delete_record', { objectName: PLATFORM, recordId: 'r1', ...confirmed });
    const many = await callTool(bridge, 'delete_records', { objectName: PLATFORM, recordIds: ['r2'], ...confirmed });

    expect(one).toEqual({ object: PLATFORM, id: 'r1', success: true });
    expect(many).toMatchObject({ deleted: 1 });
    expect(many).not.toHaveProperty('recycleBinEntries');
    expect(driver.rowsOf(RECYCLE_BIN_OBJECT)).toEqual([]);
    expect(driver.rowsOf(PLATFORM).map((r: Row) => r.id)).toEqual(['r3']);
  });

  it('control: on a composition with no recycle bin, a business record deletes for good and no entry is named', async () => {
    const { bridge, driver } = await stack({ withBin: false });

    const one = await callTool(bridge, 'delete_record', { objectName: NOTE, recordId: 'r1', ...confirmed });
    const many = await callTool(bridge, 'delete_records', { objectName: NOTE, recordIds: ['r2'], ...confirmed });

    expect(one).toEqual({ object: NOTE, id: 'r1', success: true });
    expect(many).toMatchObject({ deleted: 1 });
    expect(many).not.toHaveProperty('recycleBinEntries');
    expect(driver.rowsOf(NOTE).map((r: Row) => r.id)).toEqual(['r3']);
  });

  it('both tools tell the model which answer key says the record was kept', async () => {
    const { bridge } = await stack({ withBin: true });
    const body = { jsonrpc: '2.0', id: rpcId++, method: 'tools/list' };
    const res = await new MCPServerRuntime({ name: 'pin', version: '0.0.0' }).handleHttpRequest(
      new Request('http://localhost/api/v1/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
      }),
      { bridge: bridge as any, parsedBody: body },
    );
    const tools = ((await res.json()) as any).result.tools as Array<{ name: string; description: string }>;
    const descriptionOf = (name: string) => tools.find((t) => t.name === name)?.description ?? '';
    expect(descriptionOf('delete_record')).toContain('recycleBinEntryId');
    expect(descriptionOf('delete_records')).toContain('recycleBinEntries');
  });
});
