// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end import integration: the REAL `POST /data/:object/import` route
 * driven by a REAL {@link ObjectQL} engine + {@link ObjectStackProtocolImplementation},
 * an in-memory driver, and real registered objects — no protocol mocks.
 *
 * Mirrors `export-integration.test.ts`. It proves the server-side coercion +
 * upsert pipeline against the SAME metadata accessor (`getMetaItem`) and write
 * path (`createData`/`updateData`) a deployed server runs: human cells
 * (是→true, 高→high, name→id) become storage values, and writeMode routes each
 * row to create / update / skip.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, ObjectStackProtocolImplementation } from '@objectstack/objectql';
import { RestServer } from './rest-server';

// ---------------------------------------------------------------------------
// In-memory driver — equality + `$in` (what matchFields / $expand issue).
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
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      const skip = Number(ast?.skip ?? ast?.offset ?? 0) || 0;
      const limit = ast?.limit ?? ast?.top;
      return limit != null ? rows.slice(skip, skip + Number(limit)) : rows.slice(skip);
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

const USER = {
  name: 'user', label: 'User', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: '姓名' },
    email: { name: 'email', type: 'email' as const, label: '邮箱' },
  },
};

const TASK = {
  name: 'task', label: 'Task', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    title: { name: 'title', type: 'text' as const, label: '标题' },
    done: { name: 'done', type: 'boolean' as const, label: '完成' },
    priority: {
      name: 'priority', type: 'select' as const, label: '优先级',
      options: [{ label: '高', value: 'high' }, { label: '低', value: 'low' }],
    },
    score: { name: 'score', type: 'number' as const, label: '分数' },
    due: { name: 'due', type: 'date' as const, label: '截止' },
    owner: { name: 'owner', type: 'lookup' as const, label: '负责人', reference: 'user', displayField: 'name' },
  },
};

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

async function boot() {
  const { driver } = makeMemoryDriver();
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(USER as any);
  engine.registry.registerObject(TASK as any);
  await engine.insert('user', { id: 'u1', name: '张三', email: 'zhang@x.com' });
  await engine.insert('user', { id: 'u2', name: '李四', email: 'li@x.com' });

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import',
  );
  return { engine, protocol, route };
}

const call = (route: any, body: any) => {
  const res = makeRes();
  return route.handler({ params: { object: 'task' }, body } as any, res).then(() => res);
};

describe('import route — real engine + protocol integration', () => {
  let route: any;
  let engine: any;

  beforeEach(async () => {
    ({ route, engine } = await boot());
    expect(route).toBeDefined();
  });

  it('coerces every special value type on insert (是→true, 高→high, name→id, date→ISO)', async () => {
    const csv = [
      'ID,标题,完成,优先级,分数,截止,负责人',
      '1,写代码,是,高,"1,200",2026/06/30,张三',
    ].join('\n');
    const res = await call(route, {
      format: 'csv', csv,
      mapping: { ID: 'id', 标题: 'title', 完成: 'done', 优先级: 'priority', 分数: 'score', 截止: 'due', 负责人: 'owner' },
    });
    expect(res._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    const stored = await engine.findOne('task', { where: { id: '1' } });
    expect(stored).toMatchObject({
      title: '写代码', done: true, priority: 'high', score: 1200, owner: 'u1',
    });
    expect(String(stored.due)).toContain('2026-06-30');
  });

  it('resolves a lookup by email when displayField is not the match, and reports not-found', async () => {
    // Default candidate fields include email — resolve 李四 via email.
    const res = await call(route, {
      format: 'json',
      rows: [
        { id: 'a', title: 'x', owner: 'li@x.com' },
        { id: 'b', title: 'y', owner: '查无此人' },
      ],
    });
    expect(res._json.created).toBe(1);
    expect(res._json.errors).toBe(1);
    const failed = res._json.results.find((r: any) => !r.ok);
    expect(failed).toMatchObject({ field: 'owner', code: 'reference_not_found' });
    const a = await engine.findOne('task', { where: { id: 'a' } });
    expect(a.owner).toBe('u2');
  });

  it('reports reference_ambiguous when a name matches more than one record', async () => {
    // Second 张三 makes the name non-unique; the importer must refuse to guess.
    await engine.insert('user', { id: 'u3', name: '张三', email: 'zhang2@x.com' });
    const res = await call(route, {
      format: 'json',
      rows: [
        { id: 'a', title: 'x', owner: '张三' },       // ambiguous name
        { id: 'b', title: 'y', owner: 'zhang2@x.com' }, // unique email → resolves
      ],
    });
    expect(res._json.errors).toBe(1);
    expect(res._json.results.find((r: any) => !r.ok)).toMatchObject({ field: 'owner', code: 'reference_ambiguous' });
    const b = await engine.findOne('task', { where: { id: 'b' } });
    expect(b.owner).toBe('u3');
  });

  it('accepts a pasted record id directly via the id fast-path', async () => {
    const res = await call(route, {
      format: 'json',
      rows: [{ id: 'c', title: 'z', owner: 'u1' }],
    });
    expect(res._json.errors).toBe(0);
    const c = await engine.findOne('task', { where: { id: 'c' } });
    expect(c.owner).toBe('u1');
  });

  it('surfaces per-row coercion errors without aborting the batch', async () => {
    const res = await call(route, {
      format: 'json',
      rows: [
        { id: 'ok', title: 'fine', score: '42' },
        { id: 'bad', title: 'nope', score: 'not-a-number' },
      ],
    });
    expect(res._json.ok).toBe(1);
    expect(res._json.errors).toBe(1);
    expect(res._json.results.find((r: any) => !r.ok)).toMatchObject({ field: 'score', code: 'invalid_number' });
  });

  it('dryRun coerces + previews create/update without persisting', async () => {
    const res = await call(route, {
      format: 'json', dryRun: true,
      rows: [{ id: 'z', title: 'preview', done: '否' }],
    });
    expect(res._json).toMatchObject({ dryRun: true, ok: 1, created: 1 });
    expect(await engine.findOne('task', { where: { id: 'z' } })).toBeNull();
  });

  it('writeMode:update touches an existing match and skips non-matches', async () => {
    await engine.insert('task', { id: '100', title: 'old', score: 1 });
    const res = await call(route, {
      format: 'json', writeMode: 'update', matchFields: ['id'],
      rows: [
        { id: '100', title: 'new', score: 2 },   // matches → update
        { id: '999', title: 'ghost' },            // no match → skip
      ],
    });
    expect(res._json).toMatchObject({ updated: 1, skipped: 1, created: 0 });
    const row = await engine.findOne('task', { where: { id: '100' } });
    expect(row).toMatchObject({ title: 'new', score: 2 });
    expect(await engine.findOne('task', { where: { id: '999' } })).toBeNull();
  });

  it('writeMode:upsert updates a match by a non-id field, else creates', async () => {
    await engine.insert('task', { id: '200', title: 'Acme', score: 1 });
    const res = await call(route, {
      format: 'json', writeMode: 'upsert', matchFields: ['title'],
      rows: [
        { title: 'Acme', score: 9 },     // matches by title → update
        { title: 'Umbrella', score: 5 }, // no match → create
      ],
    });
    expect(res._json).toMatchObject({ updated: 1, created: 1 });
    const acme = await engine.findOne('task', { where: { title: 'Acme' } });
    expect(acme).toMatchObject({ id: '200', score: 9 });
    const umbrella = await engine.findOne('task', { where: { title: 'Umbrella' } });
    expect(umbrella?.score).toBe(5);
  });

  it('rejects update/upsert without matchFields', async () => {
    const res = await call(route, { format: 'json', writeMode: 'upsert', rows: [{ title: 'x' }] });
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('INVALID_REQUEST');
  });

  it('parses a native xlsx workbook server-side and coerces cells like csv', async () => {
    const ExcelJS: any = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['ID', '标题', '完成', '优先级', '分数', '截止', '负责人']);
    ws.addRow(['1', '写代码', '是', '高', 1200, new Date('2026-06-30T00:00:00Z'), '张三']);
    ws.addRow(['2', '测试', '否', '低', 3, '2026/07/01', '李四']);
    const buf = await wb.xlsx.writeBuffer();
    const xlsxBase64 = Buffer.from(buf).toString('base64');

    const res = await call(route, {
      format: 'xlsx', xlsxBase64,
      mapping: { ID: 'id', 标题: 'title', 完成: 'done', 优先级: 'priority', 分数: 'score', 截止: 'due', 负责人: 'owner' },
    });
    expect(res._json).toMatchObject({ total: 2, ok: 2, errors: 0, created: 2 });
    const one = await engine.findOne('task', { where: { id: '1' } });
    expect(one).toMatchObject({ title: '写代码', done: true, priority: 'high', score: 1200, owner: 'u1' });
    expect(String(one.due)).toContain('2026-06-30');
    const two = await engine.findOne('task', { where: { id: '2' } });
    expect(two).toMatchObject({ title: '测试', done: false, priority: 'low', score: 3, owner: 'u2' });
  });

  it('reads xlsxBase64 without an explicit format and honors the sheet selector', async () => {
    const ExcelJS: any = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Empty'); // decoy first sheet
    const ws = wb.addWorksheet('Data');
    ws.addRow(['id', 'title', 'score']);
    ws.addRow(['x1', 'from-named-sheet', 7]);
    const buf = await wb.xlsx.writeBuffer();
    const xlsxBase64 = Buffer.from(buf).toString('base64');

    const res = await call(route, { xlsxBase64, sheet: 'Data' });
    expect(res._json).toMatchObject({ total: 1, ok: 1, created: 1 });
    const row = await engine.findOne('task', { where: { id: 'x1' } });
    expect(row).toMatchObject({ title: 'from-named-sheet', score: 7 });
  });

  it('rejects a malformed xlsx payload with 400', async () => {
    const res = await call(route, { format: 'xlsx', xlsxBase64: Buffer.from('not a workbook').toString('base64') });
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('INVALID_REQUEST');
    expect(String(res._json.error)).toMatch(/xlsx/i);
  });
});
