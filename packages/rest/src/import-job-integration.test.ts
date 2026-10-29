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
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { SysImportJob } from '@objectstack/platform-objects/audit';
// [commit a92b1793c] The ONE definition of the async-import row ceiling. The pin below reads it
// from here so that moving it is observable at the enforcement point.
import { IMPORT_JOB_MAX_ROWS } from '@objectstack/spec/api';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

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
  // A real `single` install's Default Organization: the system writes below
  // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
  await installDefaultOrganization(engine);

  // [#21516] The protocol reads the stored-metadata family; the engine refuses a
  // name its registry does not hold, so the harness registers the family as a boot
  // does — after the DDL, so an unprovisioned store still answers "no such table".
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const find = (method: string, path: string) => routes.find((r: any) => r.method === method && r.path === path);
  return {
    engine, protocol, rest,
    create: find('POST', '/api/v1/data/:object/import/jobs'),
    progress: find('GET', '/api/v1/data/import/jobs/:jobId'),
    results: find('GET', '/api/v1/data/import/jobs/:jobId/results'),
    list: find('GET', '/api/v1/data/import/jobs'),
    cancel: find('POST', '/api/v1/data/import/jobs/:jobId/cancel'),
    undo: find('POST', '/api/v1/data/import/jobs/:jobId/undo'),
    dataCreate: find('POST', '/api/v1/data/:object'),
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

  // [commit a92b1793c] The ceiling has ONE definition — the spec export — and rest is its only
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
      // Every argument is forwarded: the options carry the organization the
      // engine stamps (ADR-0131 D9), which a NOT NULL tenant column needs (D1).
      const bulkCreate = driver.bulkCreate.bind(driver);
      driver.bulkCreate = async (o: string, rows2: any[], ...rest: any[]) => {
        if (o === 'task') await new Promise((r) => setImmediate(r));
        return bulkCreate(o, rows2, ...rest);
      };
      const create = driver.create.bind(driver);
      driver.create = async (o: string, data: any, ...rest: any[]) => {
        if (o === 'task') await new Promise((r) => setImmediate(r));
        return create(o, data, ...rest);
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

    // [#24348] The import doors honour `treatAsHistorical: true` for the system
    // principal only, so the historical job is created by one (an in-process
    // caller); the undo below is the signed-in member's, as before.
    const memberCtx = (ctx.rest as any).resolveExecCtx;
    (ctx.rest as any).resolveExecCtx = async () => ({ userId: 'test-user', isSystem: true });
    const created = await callCreate(ctx.create, {
      format: 'json', writeMode: 'upsert', matchFields: ['id'], treatAsHistorical: true,
      rows: [{ id: 'h_existing', title: 'historical', score: 42 }],
    });
    (ctx.rest as any).resolveExecCtx = memberCtx;
    expect(created._status).toBe(201);
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

/**
 * The async create door resolves the object BEFORE it persists a job: an
 * object name the runtime does not register is refused up front with the
 * answer the data door gives the same name (`POST /data/OBJ`, 404
 * `OBJECT_NOT_FOUND`), and no `sys_import_job` row is written — rather than a
 * 201, a job id and a job whose every row then fails on that same refusal.
 */
describe('async import job — an unregistered object is refused before a job exists', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => {
    ctx = await boot();
    expect(ctx.create && ctx.dataCreate).toBeTruthy();
  });

  const jobRows = async () => ctx.engine.find('sys_import_job', { where: {} });
  const call = (route: any, object: string, body: any) => {
    const res = makeRes();
    return route.handler({ params: { object }, body } as any, res).then(() => res);
  };

  it('answers 404 OBJECT_NOT_FOUND, the data door\'s answer, and persists no job row', async () => {
    expect(await jobRows()).toHaveLength(0);

    const res = await call(ctx.create, 'no_such_object', { format: 'csv', csv: 'title\nx\n' });
    expect(res._status).toBe(404);
    expect(res._json?.error?.code ?? res._json?.code).toBe('OBJECT_NOT_FOUND');

    // The same envelope the data door answers for the same name, byte for byte.
    const door = await call(ctx.dataCreate, 'no_such_object', { title: 'x' });
    expect(door._status).toBe(404);
    expect(res._json).toEqual(door._json);

    // Counted at the engine: the refusal wrote no job.
    expect(await jobRows()).toHaveLength(0);
  });

  it('control: a registered object still gets 201 and exactly one job row', async () => {
    const res = await call(ctx.create, 'task', { format: 'json', rows: [{ id: 'k1', title: 'kept' }] });
    expect(res._status).toBe(201);
    expect(res._json).toMatchObject({ object: 'task', status: 'pending', total: 1 });
    await waitForTerminal(ctx.progress, res._json.jobId);
    const rows = await jobRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: res._json.jobId, object_name: 'task' });
  });
});

/**
 * The terminal status of a job that wrote nothing (maintainer ruling B, record
 * 6509036166). A job that was not cancelled, had at least one row, and ended
 * with no row created, updated or skipped ends `failed`, with `error` naming
 * the outcome and pointing at `results`. Kept `succeeded` on purpose: a job
 * whose rows partly failed (the partial pin in the first describe above), a job
 * whose every row was skipped, and a job with no rows. Cancellation still wins.
 * A dry run follows the same rule.
 */
describe('async import job — a job whose every row failed ends failed', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => {
    ctx = await boot();
    expect(ctx.create && ctx.progress && ctx.results && ctx.undo).toBeTruthy();
  });

  const badRows = (prefix: string) => [
    { id: `${prefix}1`, title: 'one', score: 'not-a-number' },
    { id: `${prefix}2`, title: 'two', score: 'nope' },
    { id: `${prefix}3`, title: 'three', score: 'x' },
  ];

  it('every row fails: the job ends failed, errors === total, and error is set', async () => {
    const res = await callCreate(ctx.create, { format: 'json', rows: badRows('af') });
    expect(res._status).toBe(201);
    const done = await waitForTerminal(ctx.progress, res._json.jobId);
    expect(done).toMatchObject({ status: 'failed', total: 3, processed: 3, created: 0, updated: 0, skipped: 0, errors: 3 });
    expect(done.errors).toBe(done.total);
    expect(typeof done.error).toBe('string');
    expect(done.error).toMatch(/results/);
    // The per-row report is still delivered beside the status.
    const results = await callJob(ctx.results, res._json.jobId);
    expect(results._json.results).toHaveLength(3);
    expect(results._json.results.every((r: any) => r.ok === false)).toBe(true);
    // Nothing landed, and the undo reader answers as it did for this job before.
    expect(await ctx.engine.find('task', { where: {} })).toHaveLength(0);
    expect(done.undoable).toBe(false);
    const u = await callJob(ctx.undo, res._json.jobId);
    expect(u._status).toBe(422);
    expect(u._json.code).toBe('NOT_UNDOABLE');
    // The history filter sees it under its real status.
    const failedOnly = await callJob(ctx.list, '', { status: 'failed' });
    expect(failedOnly._json.jobs.map((j: any) => j.jobId)).toEqual([res._json.jobId]);
  });

  it('control: every row skipped keeps succeeded', async () => {
    const res = await callCreate(ctx.create, {
      format: 'json', writeMode: 'update', matchFields: ['id'],
      rows: [{ id: 'sk1', title: 'a' }, { id: 'sk2', title: 'b' }],
    });
    expect(res._status).toBe(201);
    const done = await waitForTerminal(ctx.progress, res._json.jobId);
    expect(done).toMatchObject({ status: 'succeeded', total: 2, created: 0, updated: 0, skipped: 2, errors: 0 });
    expect(done.error).toBeUndefined();
  });

  it('control: a job with no rows keeps succeeded', async () => {
    const res = await callCreate(ctx.create, { format: 'csv', csv: 'id,title\n' });
    expect(res._status).toBe(201);
    expect(res._json.total).toBe(0);
    const done = await waitForTerminal(ctx.progress, res._json.jobId);
    expect(done).toMatchObject({ status: 'succeeded', total: 0, errors: 0 });
    expect(done.error).toBeUndefined();
  });

  it('every row of a dry run fails: the job ends failed', async () => {
    const res = await callCreate(ctx.create, { format: 'json', dryRun: true, rows: badRows('dr') });
    expect(res._status).toBe(201);
    const done = await waitForTerminal(ctx.progress, res._json.jobId);
    expect(done).toMatchObject({ status: 'failed', dryRun: true, total: 3, created: 0, updated: 0, skipped: 0, errors: 3 });
    expect(typeof done.error).toBe('string');
  });

  it('control: a valid dry run keeps succeeded', async () => {
    const res = await callCreate(ctx.create, { format: 'json', dryRun: true, rows: [{ id: 'dv1', title: 'ok' }] });
    const done = await waitForTerminal(ctx.progress, res._json.jobId);
    expect(done).toMatchObject({ status: 'succeeded', dryRun: true, created: 1, errors: 0 });
  });

  it('control: a cancel that lands after the last row still wins over an all-failed outcome', async () => {
    // Every row collides with a seeded primary key, so each fails at the
    // driver; the slowed writes let the cancel land while the job runs, and
    // the 3-row job has no mid-loop checkpoint, so the loop finishes first.
    const slowCtx = await boot((driver) => {
      const bulkCreate = driver.bulkCreate.bind(driver);
      driver.bulkCreate = async (o: string, rows2: any[], ...rest: any[]) => {
        if (o === 'task') await new Promise((r) => setImmediate(r));
        return bulkCreate(o, rows2, ...rest);
      };
      const create = driver.create.bind(driver);
      driver.create = async (o: string, data: any, ...rest: any[]) => {
        if (o === 'task') await new Promise((r) => setImmediate(r));
        return create(o, data, ...rest);
      };
    });
    for (const id of ['cf1', 'cf2', 'cf3']) {
      await slowCtx.protocol.createData({ object: 'task', data: { id, title: 'seeded' } });
    }
    const created = await callCreate(slowCtx.create, {
      format: 'json',
      rows: [{ id: 'cf1', title: 'a' }, { id: 'cf2', title: 'b' }, { id: 'cf3', title: 'c' }],
    });
    const jobId = created._json.jobId;
    const c = await callJob(slowCtx.cancel, jobId);
    expect(c._json).toMatchObject({ success: true });

    await waitForTerminal(slowCtx.progress, jobId);
    // The cancel route writes `cancelled` first; wait until the worker's own
    // final patch has landed (it is the only write of `results`), then read the row.
    for (let i = 0; i < 400; i++) {
      const r = await callJob(slowCtx.results, jobId);
      if ((r._json?.results ?? []).length === 3) break;
      await new Promise((rr) => setTimeout(rr, 5));
    }
    const after = await callJob(slowCtx.progress, jobId);
    expect(after._json.status).toBe('cancelled');
    expect(after._json).toMatchObject({ processed: 3, created: 0, updated: 0, skipped: 0, errors: 3 });
  });
});
