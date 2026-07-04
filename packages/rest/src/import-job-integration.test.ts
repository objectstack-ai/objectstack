// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end async import-job integration: the REAL create / progress / results
 * / list / cancel routes driven by a REAL {@link ObjectQL} engine +
 * {@link ObjectStackProtocolImplementation}, an in-memory driver, and real
 * registered objects (including a `sys_import_job` mirror) — no protocol mocks.
 *
 * Proves the P1 async pipeline: a create request persists a job row and returns
 * immediately; the background worker streams the batch through the SAME shared
 * runner the sync route uses, updating progress on the row; and readers can poll
 * progress, fetch a capped results report, and list history.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, ObjectStackProtocolImplementation } from '@objectstack/objectql';
import { RestServer } from './rest-server';

// In-memory driver — equality + `$in`, with skip/limit (mirrors import-integration).
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

const TASK = {
  name: 'task', label: 'Task', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    title: { name: 'title', type: 'text' as const, label: '标题' },
    done: { name: 'done', type: 'boolean' as const, label: '完成' },
    score: { name: 'score', type: 'number' as const, label: '分数' },
  },
};

// Minimal sys_import_job mirror the routes read/write through the protocol.
const SYS_IMPORT_JOB = {
  name: 'sys_import_job', label: 'Import Job', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    object_name: { name: 'object_name', type: 'text' as const },
    status: { name: 'status', type: 'text' as const },
    total_rows: { name: 'total_rows', type: 'number' as const },
    processed_rows: { name: 'processed_rows', type: 'number' as const },
    created_count: { name: 'created_count', type: 'number' as const },
    updated_count: { name: 'updated_count', type: 'number' as const },
    skipped_count: { name: 'skipped_count', type: 'number' as const },
    error_count: { name: 'error_count', type: 'number' as const },
    write_mode: { name: 'write_mode', type: 'text' as const },
    dry_run: { name: 'dry_run', type: 'boolean' as const },
    run_automations: { name: 'run_automations', type: 'boolean' as const },
    error: { name: 'error', type: 'textarea' as const },
    results: { name: 'results', type: 'json' as const },
    started_at: { name: 'started_at', type: 'text' as const },
    completed_at: { name: 'completed_at', type: 'text' as const },
    created_by: { name: 'created_by', type: 'text' as const },
    created_at: { name: 'created_at', type: 'text' as const },
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
  engine.registry.registerObject(TASK as any);
  engine.registry.registerObject(SYS_IMPORT_JOB as any);

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const find = (method: string, path: string) => routes.find((r: any) => r.method === method && r.path === path);
  return {
    engine, protocol,
    create: find('POST', '/api/v1/data/:object/import/jobs'),
    progress: find('GET', '/api/v1/data/import/jobs/:jobId'),
    results: find('GET', '/api/v1/data/import/jobs/:jobId/results'),
    list: find('GET', '/api/v1/data/import/jobs'),
    cancel: find('POST', '/api/v1/data/import/jobs/:jobId/cancel'),
    undo: find('POST', '/api/v1/data/import/jobs/:jobId/undo'),
  };
}

const callCreate = (route: any, body: any) => {
  const res = makeRes();
  return route.handler({ params: { object: 'task' }, body } as any, res).then(() => res);
};
const callJob = (route: any, jobId: string, query: any = {}) => {
  const res = makeRes();
  return route.handler({ params: { jobId }, query } as any, res).then(() => res);
};

/** Poll the progress route until the job reaches a terminal state. */
async function waitForTerminal(progress: any, jobId: string, tries = 100): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const res = await callJob(progress, jobId);
    const status = res._json?.status;
    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return res._json;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`import job ${jobId} did not finish`);
}

describe('async import job — real engine + protocol integration', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => {
    ctx = await boot();
    expect(ctx.create).toBeDefined();
    expect(ctx.progress && ctx.results && ctx.list && ctx.cancel && ctx.undo).toBeTruthy();
  });

  it('creates a job, processes it in the background, and persists rows', async () => {
    const res = await callCreate(ctx.create, {
      format: 'json',
      rows: [
        { id: 'a', title: 'one', done: '是', score: '10' },
        { id: 'b', title: 'two', done: '否', score: '20' },
        { id: 'c', title: 'three', score: 'not-a-number' }, // one failure
      ],
    });
    expect(res._status).toBe(201);
    expect(res._json).toMatchObject({ object: 'task', status: 'pending', total: 3 });
    const jobId = res._json.jobId;
    expect(jobId).toMatch(/^imp_/);

    const done = await waitForTerminal(ctx.progress, jobId);
    expect(done).toMatchObject({ status: 'succeeded', total: 3, processed: 3, created: 2, errors: 1 });
    expect(done.percentComplete).toBe(100);

    // Records really landed (coerced: 是→true, "10"→10).
    const a = await ctx.engine.findOne('task', { where: { id: 'a' } });
    expect(a).toMatchObject({ title: 'one', done: true, score: 10 });

    // Results route returns the capped per-row report (failure present).
    const results = await callJob(ctx.results, jobId);
    expect(results._json.resultsTruncated).toBe(false);
    expect(results._json.results.find((r: any) => !r.ok)).toMatchObject({ field: 'score', code: 'invalid_number' });
  });

  it('rejects a payload above the 50k async ceiling with 413', async () => {
    const rows = Array.from({ length: 50_001 }, (_, i) => ({ id: `x${i}`, title: 't' }));
    const res = await callCreate(ctx.create, { format: 'json', rows });
    expect(res._status).toBe(413);
    expect(res._json.code).toBe('PAYLOAD_TOO_LARGE');
    expect(String(res._json.error)).toMatch(/50000/);
  });

  it('lists jobs in history and filters by status', async () => {
    const r1 = await callCreate(ctx.create, { format: 'json', rows: [{ id: 'l1', title: 'a' }] });
    await waitForTerminal(ctx.progress, r1._json.jobId);
    const r2 = await callCreate(ctx.create, { format: 'json', rows: [{ id: 'l2', title: 'b' }] });
    await waitForTerminal(ctx.progress, r2._json.jobId);

    const all = await callJob(ctx.list, '', {});
    expect(all._json.jobs.length).toBe(2);
    expect(all._json.jobs[0]).toHaveProperty('jobId');
    expect(all._json.jobs[0]).toHaveProperty('createdAt');

    const succeeded = await callJob(ctx.list, '', { status: 'succeeded' });
    expect(succeeded._json.jobs.length).toBe(2);
    const failedOnly = await callJob(ctx.list, '', { status: 'failed' });
    expect(failedOnly._json.jobs.length).toBe(0);
  });

  it('404s progress/results/cancel for an unknown job id', async () => {
    const p = await callJob(ctx.progress, 'imp_nope');
    expect(p._status).toBe(404);
    const r = await callJob(ctx.results, 'imp_nope');
    expect(r._status).toBe(404);
    const c = await callJob(ctx.cancel, 'imp_nope');
    expect(c._status).toBe(404);
  });

  it('cancel on an already-finished job is a no-op success', async () => {
    const created = await callCreate(ctx.create, { format: 'json', rows: [{ id: 'k', title: 'x' }] });
    const jobId = created._json.jobId;
    await waitForTerminal(ctx.progress, jobId);
    const c = await callJob(ctx.cancel, jobId);
    expect(c._json).toMatchObject({ success: true });
    // Terminal state preserved.
    const after = await callJob(ctx.progress, jobId);
    expect(after._json.status).toBe('succeeded');
  });

  it('undoes a job: deletes created records and restores updated ones', async () => {
    // Seed one existing record so an upsert both creates and updates.
    await ctx.protocol.createData({ object: 'task', data: { id: 'u_existing', title: 'old title', score: 1 } });

    const created = await callCreate(ctx.create, {
      format: 'json', writeMode: 'upsert', matchFields: ['id'],
      rows: [
        { id: 'u_existing', title: 'new title', score: 99 }, // update
        { id: 'u_new1', title: 'fresh one' },                // create
        { id: 'u_new2', title: 'fresh two' },                // create
      ],
    });
    const jobId = created._json.jobId;
    const done = await waitForTerminal(ctx.progress, jobId);
    expect(done).toMatchObject({ status: 'succeeded', created: 2, updated: 1 });
    expect(done.undoable).toBe(true);

    // Writes really landed.
    expect(await ctx.engine.findOne('task', { where: { id: 'u_new1' } })).toBeTruthy();
    expect(await ctx.engine.findOne('task', { where: { id: 'u_existing' } })).toMatchObject({ title: 'new title', score: 99 });

    // Undo.
    const u = await callJob(ctx.undo, jobId);
    expect(u._json).toMatchObject({ success: true, deleted: 2, restored: 1, failed: 0 });

    // Created records are gone; the updated record is back to its pre-import values.
    expect(await ctx.engine.findOne('task', { where: { id: 'u_new1' } })).toBeFalsy();
    expect(await ctx.engine.findOne('task', { where: { id: 'u_new2' } })).toBeFalsy();
    expect(await ctx.engine.findOne('task', { where: { id: 'u_existing' } })).toMatchObject({ title: 'old title', score: 1 });

    // Job now flags as reverted + no longer undoable.
    const after = await callJob(ctx.progress, jobId);
    expect(after._json.undoable).toBe(false);
    expect(after._json.revertedAt).toBeTruthy();
  });

  it('undoing twice is rejected (409 already reverted)', async () => {
    const created = await callCreate(ctx.create, { format: 'json', rows: [{ id: 'uu1', title: 'x' }] });
    const jobId = created._json.jobId;
    await waitForTerminal(ctx.progress, jobId);
    const first = await callJob(ctx.undo, jobId);
    expect(first._json.success).toBe(true);
    const second = await callJob(ctx.undo, jobId);
    expect(second._status).toBe(409);
    expect(second._json.code).toBe('ALREADY_REVERTED');
  });

  it('404s undo for an unknown job id', async () => {
    const res = await callJob(ctx.undo, 'imp_nope');
    expect(res._status).toBe(404);
  });
});
