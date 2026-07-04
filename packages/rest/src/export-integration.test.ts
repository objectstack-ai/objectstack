// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end export integration: the REAL streaming export route driven by a
 * REAL {@link ObjectQL} engine + {@link ObjectStackProtocolImplementation},
 * an in-memory driver, and real registered objects — no protocol mocks.
 *
 * This is the test the mocked `rest.test.ts` export suite could not be: those
 * stubbed `getObjectSchema` (a method with no real implementation) and pre-shaped
 * `findData` to return `{ data }` with an already-`$expand`-ed `owner`. That
 * green masked three production bugs:
 *   1. the route called the dead `getObjectSchema` hook → no field metadata in
 *      production → zero formatting;
 *   2. `buildFieldMetaMap` only understood the array `fields` shape, not the
 *      object-map the engine registry actually serves;
 *   3. the route read `result.data`, but real `findData` returns `{ records }`
 *      → every production export streamed ZERO rows (an empty file).
 *
 * Here the readable cells (完成→是, 优先级→高, 负责人→张三) are produced by the
 * real metadata accessor (`getMetaItem`) and a real `$expand` that resolves the
 * lookup id `u1` to its record — exactly the path a deployed server runs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { ObjectQL, ObjectStackProtocolImplementation } from '@objectstack/objectql';
import { RestServer } from './rest-server';

// ---------------------------------------------------------------------------
// In-memory driver — equality + `$in` (the latter is what `$expand` issues when
// it batch-fetches referenced records: `where: { id: { $in: [...] } }`).
// ---------------------------------------------------------------------------
function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const matchOne = (cell: unknown, cond: unknown): boolean => {
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ('$in' in c) return Array.isArray(c.$in) && c.$in.some((x) => (cell ?? null) === (x ?? null));
      if ('$eq' in c) return (cell ?? null) === ((c.$eq as unknown) ?? null);
      if ('$ne' in c) return (cell ?? null) !== ((c.$ne as unknown) ?? null);
    }
    return (cell ?? null) === ((cond as unknown) ?? null);
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if (!matchOne(row[k], v)) return false;
    }
    return true;
  };
  const sortRows = (rows: Record<string, unknown>[], orderBy: any): Record<string, unknown>[] => {
    if (!orderBy) return rows;
    // Accept {field:'asc'|'desc'} | [['field','asc']] | ['field']
    const specs: Array<[string, 'asc' | 'desc']> = [];
    if (Array.isArray(orderBy)) {
      for (const o of orderBy) {
        if (Array.isArray(o)) specs.push([String(o[0]), o[1] === 'desc' ? 'desc' : 'asc']);
        else if (typeof o === 'string') specs.push([o, 'asc']);
      }
    } else if (typeof orderBy === 'object') {
      for (const [f, d] of Object.entries(orderBy)) specs.push([f, d === 'desc' ? 'desc' : 'asc']);
    }
    if (specs.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const [f, d] of specs) {
        const av = a[f] as any, bv = b[f] as any;
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return d === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      const sorted = sortRows(rows, ast?.orderBy ?? ast?.sort ?? ast?.order);
      const skip = Number(ast?.skip ?? ast?.offset ?? 0) || 0;
      const limit = ast?.limit ?? ast?.top;
      const sliced = limit != null ? sorted.slice(skip, skip + Number(limit)) : sorted.slice(skip);
      return sliced;
    },
    findStream() { throw new Error('ns'); },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
      const up = { ...cur, ...data, id }; s.set(id, up); return up;
    },
    async upsert(o: string, data: Record<string, unknown>) { const id = data.id as string | undefined; return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data); },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

// ---------------------------------------------------------------------------
// Objects — object-map `fields` (the engine's real shape), mixed value types.
// systemFields:false keeps the column set deterministic (just our fields).
// ---------------------------------------------------------------------------
const USER = {
  name: 'user',
  label: 'User',
  systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: '姓名' },
  },
};

const TASK = {
  name: 'task',
  label: 'Task',
  systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    title: { name: 'title', type: 'text' as const, label: '标题' },
    done: { name: 'done', type: 'boolean' as const, label: '完成' },
    priority: {
      name: 'priority', type: 'select' as const, label: '优先级',
      options: [{ label: '高', value: 'high' }, { label: '低', value: 'low' }],
    },
    due: { name: 'due', type: 'date' as const, label: '截止' },
    owner: { name: 'owner', type: 'lookup' as const, label: '负责人', reference: 'user', displayField: 'name' },
  },
};

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  let status = 200;
  const res: any = {
    write: (s: string) => { chunks.push(typeof s === 'string' ? s : String(s)); return true; },
    end: () => {},
    header: (n: string, v: string) => { headers[n] = v; return res; },
    status: (code: number) => { status = code; return res; },
    json: (body: any) => { (res as any)._json = body; return res; },
  };
  return { res, chunks, headers, getStatus: () => status, getJson: () => (res as any)._json };
}

function makeBinRes() {
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  const res: any = {
    write: (c: any) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return true; },
    end: () => {},
    header: (n: string, v: string) => { headers[n] = v; return res; },
    status: () => res,
    json: () => res,
  };
  return { res, getBuffer: () => Buffer.concat(chunks), headers };
}

async function boot() {
  const { driver } = makeMemoryDriver();
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(USER as any);
  engine.registry.registerObject(TASK as any);
  await engine.insert('user', { id: 'u1', name: '张三' });
  await engine.insert('user', { id: 'u2', name: '李四' });
  // owner stored as a bare id — the readable name must come from a real $expand.
  await engine.insert('task', { id: '1', title: '写代码', done: true, priority: 'high', due: '2026-06-30T00:00:00.000Z', owner: 'u1' });
  await engine.insert('task', { id: '2', title: '写文档', done: false, priority: 'low', due: '2026-07-01T00:00:00.000Z', owner: 'u2' });

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export',
  );
  return { engine, protocol, route };
}

function parseCsv(text: string): string[][] {
  return text.split('\r\n').filter((l) => l.length > 0).map((l) => l.split(','));
}

describe('export route — real engine + protocol integration', () => {
  let route: any;
  let protocol: any;

  beforeEach(async () => {
    ({ route, protocol } = await boot());
    expect(route).toBeDefined();
  });

  it('the real metadata accessor returns the task object schema', async () => {
    // Probe: proves getMetaItem (registry-first) sees a registerObject'd object,
    // i.e. the accessor the route now relies on actually resolves in production.
    const res = await protocol.getMetaItem({ type: 'object', name: 'task' });
    const schema = res && typeof res === 'object' && 'item' in res ? (res as any).item : res;
    expect(schema).toBeTruthy();
    expect(schema.fields).toBeTruthy();
    expect(schema.fields.done?.type).toBe('boolean');
    expect(schema.fields.owner?.reference).toBe('user');
  });

  it('CSV: formats every value type readably; owner name comes from a REAL $expand', async () => {
    const { res, chunks, headers } = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, res);

    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
    const rows = parseCsv(chunks.join(''));
    // Header from schema labels; column order from schema field order.
    expect(rows[0]).toEqual(['ID', '标题', '完成', '优先级', '截止', '负责人']);
    // boolean→是, select→高, date→YYYY-MM-DD, lookup id u1 → 张三 (via $expand).
    expect(rows[1]).toEqual(['1', '写代码', '是', '高', '2026-06-30', '张三']);
    expect(rows[2]).toEqual(['2', '写文档', '否', '低', '2026-07-01', '李四']);
  });

  it('CSV: is NON-EMPTY — regression for the findData `.records` vs `.data` bug', async () => {
    const { res, chunks } = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, res);
    const dataRows = parseCsv(chunks.join('')).slice(1); // drop header
    // The mocked suite returned `{ data }`; real findData returns `{ records }`.
    // If the route only read `.data`, this would be 0 — an empty production file.
    expect(dataRows.length).toBe(2);
  });

  it('XLSX: opens as a real workbook with formatted cells', async () => {
    const { res, getBuffer, headers } = makeBinRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'xlsx' } } as any, res);

    expect(headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(getBuffer() as any);
    const ws = wb.worksheets[0];
    const header = (ws.getRow(1).values as any[]).slice(1).map((v) => String(v));
    expect(header).toEqual(['ID', '标题', '完成', '优先级', '截止', '负责人']);
    const r1 = (ws.getRow(2).values as any[]).slice(1).map((v) => String(v));
    expect(r1).toEqual(['1', '写代码', '是', '高', '2026-06-30', '张三']);
  });

  it('JSON: readable values, all rows present', async () => {
    const { res, chunks, headers } = makeRes();
    await route.handler({ params: { object: 'task' }, query: { format: 'json' } } as any, res);

    expect(headers['Content-Type']).toBe('application/json; charset=utf-8');
    const arr = JSON.parse(chunks.join(''));
    expect(arr).toHaveLength(2);
    expect(arr[0]).toMatchObject({ title: '写代码', done: '是', priority: '高', due: '2026-06-30', owner: '张三' });
  });

  it('filter + orderby are plumbed to the engine (only done=true, desc by id)', async () => {
    const { res, chunks } = makeRes();
    await route.handler({
      params: { object: 'task' },
      query: { format: 'csv', filter: JSON.stringify({ done: true }), orderby: 'id:desc' },
    } as any, res);

    const dataRows = parseCsv(chunks.join('')).slice(1);
    // Only the done=true task survives the filter.
    expect(dataRows.map((r) => r[0])).toEqual(['1']);
    expect(dataRows[0][2]).toBe('是');
  });
});
