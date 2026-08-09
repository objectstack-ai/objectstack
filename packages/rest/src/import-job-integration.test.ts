// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end async import-job integration: the REAL create / progress / results
 * / list / cancel routes driven by a REAL {@link ObjectQL} engine +
 * {@link ObjectStackProtocolImplementation}, a REAL sqlite `:memory:` driver,
 * and real registered objects (including the platform's own `sys_import_job`) —
 * no protocol mocks and, since #5704 批次 3 / #5785, no hand-written storage and
 * no hand-written mirror of the job object either.
 *
 * Proves the P1 async pipeline: a create request persists a job row and returns
 * immediately; the background worker streams the batch through the SAME shared
 * runner the sync route uses, updating progress on the row; and readers can poll
 * progress, fetch a capped results report, and list history.
 *
 * Backend note (#5704 批次 3 / #5785): "persists a job row" was, until this
 * migration, an entry in a Map — durability asserted against a store that cannot
 * fail to store. The job row now round-trips through a real table, which is what
 * makes the out-of-band-cancel case (a `status` another node wrote, read back by
 * this one) a statement about persisted state rather than about shared memory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysImportJob } from '@objectstack/platform-objects/audit';
// #6535: the ONE definition of the async-import row ceiling. The pin below reads it
// from here so that moving it is observable at the enforcement point.
import { IMPORT_JOB_MAX_ROWS } from '@objectstack/spec/api';
import { RestServer } from './rest-server';

// The real backend: better-sqlite3 `:memory:`, constructed the canonical way
// (`examples/app-crm`, `cli db clean`, PR #5715's `makeDefaultDriver()`).
function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

/** Engines booted by this file, torn down (and their `:memory:` DBs closed) per test. */
const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const TASK = {
  name: 'task', label: 'Task', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    title: { name: 'title', type: 'text' as const, label: '标题' },
    done: { name: 'done', type: 'boolean' as const, label: '完成' },
    score: { name: 'score', type: 'number' as const, label: '分数' },
  },
};

/**
 * The REAL `sys_import_job` (`@objectstack/platform-objects`), not a mirror.
 *
 * This slot held a hand-written "minimal mirror" until #5785. A Map store
 * accepted every key the routes wrote whether the fixture declared it or not, so
 * the mirror could silently fall behind the object it mirrored — and it had:
 * `undo_log` and `reverted_at` (the whole undo feature, #3549's subject) were
 * missing, and three datetime columns were declared `text`. Against a real
 * table that is `no such column: undo_log`, which is how the drift surfaced.
 *
 * Re-declaring the columns by hand would only reset the same clock, so the
 * fixture is retired in favour of the definition the deployed server registers.
 * `@objectstack/platform-objects` is already a production dependency of this
 * package, and the routes under test write this object by name.
 */
const SYS_IMPORT_JOB = SysImportJob;

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

async function boot(decorateDriver?: (driver: any) => void) {
  const driver = makeSqliteDriver();
  decorateDriver?.(driver);
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(TASK as any);
  engine.registry.registerObject(SYS_IMPORT_JOB as any);
  // Real DDL for both tables before the first job row is written.
  await engine.syncSchemas();

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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

  // #6535: the ceiling has ONE definition — the spec export — and rest is its only
  // enforcer. So this case derives everything it knows about the ceiling from that
  // export: how big a payload must be to breach it, and the number the 413 copy is
  // required to name. Re-spelling 50_000 here would just move the duplicated literal
  // into a third place and re-open the drift surface the fix closes.
  //
  // What this pin buys, precisely: while spec and rest agree (they do today, both
  // 50_000) it is green against BOTH implementations — there is no live defect to
  // catch. It goes red the moment they DISAGREE. With a rest that re-declares its own
  // literal, moving the spec constant down makes this send `spec + 1` rows at a route
  // still enforcing the stale, larger number: the payload is accepted and no 413 is
  // produced at all. Under the imported constant the two move together and stay green.
  it('rejects a payload above the async ceiling the spec declares, with 413', async () => {
    const rows = Array.from({ length: IMPORT_JOB_MAX_ROWS + 1 }, (_, i) => ({ id: `x${i}`, title: 't' }));
    const res = await callCreate(ctx.create, { format: 'json', rows });
    // Rejection-class: assert the ADR-0112 envelope (status AND code), never a bare throw.
    expect(res._status).toBe(413);
    expect(res._json.code).toBe('PAYLOAD_TOO_LARGE');
    // The wording is contract here — the 413 tells the caller what to split the file
    // into — so the interpolated number must be the spec's, on top of the envelope.
    expect(String(res._json.error)).toContain(String(IMPORT_JOB_MAX_ROWS));
    expect(String(res._json.error)).toContain(`batches of ${IMPORT_JOB_MAX_ROWS}`);
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

  // framework#2824 — cancelling a running job must actually stop the worker.
  it('cancels a running job mid-flight: the worker stops at the next checkpoint', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `mc${i}`, title: `t${i}` }));
    const created = await callCreate(ctx.create, { format: 'json', rows });
    const jobId = created._json.jobId;

    const c = await callJob(ctx.cancel, jobId);
    expect(c._json).toMatchObject({ success: true });

    const done = await waitForTerminal(ctx.progress, jobId);
    expect(done.status).toBe('cancelled');

    // Let the background worker settle (progress stops moving), then prove it
    // really stopped early instead of importing all 1000 rows (#2824's bug).
    let settled = -1;
    for (let i = 0; i < 100; i++) {
      const r = await callJob(ctx.progress, jobId);
      const p = Number(r._json?.processed ?? 0);
      if (p === settled) break;
      settled = p;
      await new Promise((rr) => setTimeout(rr, 10));
    }
    expect(settled).toBeLessThan(1000);
    const written = await ctx.engine.find('task', { where: {} });
    expect(written.length).toBeLessThan(1000);
  });

  // framework#2824 — a durable 'cancelled' written by another process (no
  // in-memory flag on this node) must stop the worker too.
  it('stops the worker when the job row is marked cancelled out-of-band', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `oc${i}`, title: `t${i}` }));
    const created = await callCreate(ctx.create, { format: 'json', rows });
    const jobId = created._json.jobId;

    // Simulate a cancel accepted by a different node: write the durable row
    // directly, bypassing this server's cancel route and in-memory flag.
    await ctx.protocol.updateData({ object: 'sys_import_job', id: jobId, data: { status: 'cancelled' } });

    const done = await waitForTerminal(ctx.progress, jobId);
    expect(done.status).toBe('cancelled');
    let settled = -1;
    for (let i = 0; i < 100; i++) {
      const r = await callJob(ctx.progress, jobId);
      const p = Number(r._json?.processed ?? 0);
      if (p === settled) break;
      settled = p;
      await new Promise((rr) => setTimeout(rr, 10));
    }
    expect(settled).toBeLessThan(1000);
  });

  // framework#2824 — a cancel that lands too late to stop the loop must still
  // win the terminal state: the worker's final patch may not overwrite the
  // durable 'cancelled' with 'succeeded'.
  it('keeps the terminal state cancelled when the cancel lands after the last row', async () => {
    // Slow the task writes so the cancel deterministically arrives while the
    // job is running — but the 3-row job has no mid-loop checkpoint, so the
    // loop still completes every row before noticing.
    const slowCtx = await boot((driver) => {
      const bulkCreate = driver.bulkCreate.bind(driver);
      driver.bulkCreate = async (o: string, rows2: any[]) => {
        if (o === 'task') await new Promise((r) => setImmediate(r));
        return bulkCreate(o, rows2);
      };
      const create = driver.create.bind(driver);
      driver.create = async (o: string, data: any) => {
        if (o === 'task') await new Promise((r) => setImmediate(r));
        return create(o, data);
      };
    });
    const created = await callCreate(slowCtx.create, {
      format: 'json',
      rows: [{ id: 'lc1', title: 'a' }, { id: 'lc2', title: 'b' }, { id: 'lc3', title: 'c' }],
    });
    const jobId = created._json.jobId;
    const c = await callJob(slowCtx.cancel, jobId);
    expect(c._json).toMatchObject({ success: true });

    const done = await waitForTerminal(slowCtx.progress, jobId);
    // The counts stay truthful (rows were written), but the user's cancel wins
    // the status — before the fix this flipped back to 'succeeded'.
    expect(done.status).toBe('cancelled');
    // Give the worker's final patch time to land, then re-check it did not
    // overwrite the status.
    await new Promise((r) => setTimeout(r, 50));
    const after = await callJob(slowCtx.progress, jobId);
    expect(after._json.status).toBe('cancelled');
    expect(after._json.processed).toBe(3);
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

  // #3549 — the undo write context must mirror the import's own write context.
  // A historical import carries `preserveAudit` (#3493) so it keeps the original
  // `updated_at`/`updated_by` (and business `readonly` fields) instead of
  // stamping-now / stripping them. The undo restores the captured pre-import
  // snapshot; if that restore write does NOT also carry `preserveAudit`, the
  // audit auto-stamp re-writes `updated_at`/`updated_by` to "now" — silently
  // corrupting the very timeline the historical import preserved. So undo of a
  // historical import must set `preserveAudit`, and undo of a normal import
  // must not. We assert on the write context the route hands the protocol.
  function spyUpdateContexts() {
    const seen: Array<{ object: string; context: any }> = [];
    const orig = (ctx.protocol as any).updateData.bind(ctx.protocol);
    (ctx.protocol as any).updateData = async (args: any) => {
      seen.push({ object: args.object, context: args.context });
      return orig(args);
    };
    return seen;
  }

  it('undo of a historical import carries preserveAudit on the restore write (#3549)', async () => {
    // Seed an existing row so the historical upsert updates it (populates the undo log).
    await ctx.protocol.createData({ object: 'task', data: { id: 'h_existing', title: 'orig', score: 1 } });

    const created = await callCreate(ctx.create, {
      format: 'json', writeMode: 'upsert', matchFields: ['id'], treatAsHistorical: true,
      rows: [{ id: 'h_existing', title: 'historical', score: 42 }],
    });
    const jobId = created._json.jobId;
    const done = await waitForTerminal(ctx.progress, jobId);
    expect(done).toMatchObject({ status: 'succeeded', updated: 1 });
    expect(done.undoable).toBe(true);

    // Observe only the undo phase.
    const seen = spyUpdateContexts();
    const u = await callJob(ctx.undo, jobId);
    expect(u._json).toMatchObject({ success: true, restored: 1 });

    const restoreWrites = seen.filter((s) => s.object === 'task');
    expect(restoreWrites.length).toBeGreaterThan(0);
    for (const w of restoreWrites) expect(w.context?.preserveAudit).toBe(true);
  });

  it('undo of a normal import does NOT set preserveAudit — default stamp/strip (#3549)', async () => {
    await ctx.protocol.createData({ object: 'task', data: { id: 'n_existing', title: 'orig', score: 1 } });

    const created = await callCreate(ctx.create, {
      format: 'json', writeMode: 'upsert', matchFields: ['id'], // treatAsHistorical omitted
      rows: [{ id: 'n_existing', title: 'updated', score: 7 }],
    });
    const jobId = created._json.jobId;
    const done = await waitForTerminal(ctx.progress, jobId);
    expect(done).toMatchObject({ status: 'succeeded', updated: 1 });

    const seen = spyUpdateContexts();
    const u = await callJob(ctx.undo, jobId);
    expect(u._json).toMatchObject({ success: true, restored: 1 });

    const restoreWrites = seen.filter((s) => s.object === 'task');
    expect(restoreWrites.length).toBeGreaterThan(0);
    for (const w of restoreWrites) expect(w.context?.preserveAudit).toBeUndefined();
  });
});
