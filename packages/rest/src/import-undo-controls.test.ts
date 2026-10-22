// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24380] AN IMPORT UNDO RUNS UNDER THE OBJECT'S DECLARED CONTROLS.
 *
 * `POST /data/import/jobs/:jobId/undo` reverses a finished import: it deletes
 * the records the job created and restores the fields it updated. Those
 * reversal writes are ordinary writes on a live app, so for every caller but
 * the system principal (`ExecutionContext.isSystem`) they run under the
 * object's metadata-bound hooks, its record-change triggers and its
 * `state_machine` rule — the same rule the import doors keep: only the system
 * principal may take an app's declared controls off a write. The system
 * principal keeps `skipAutomations` / `skipStateMachine`. A historical job's
 * undo keeps `preserveAudit` for every caller.
 *
 * A row a control refuses is reported per row, in the undo answer's `failures`
 * and in the job's stored undo log, and is not counted as reverted: the job is
 * stamped `reverted_at` only once every row is reverted, and until then it
 * stays undoable for exactly the rows that remain.
 *
 * The fixtures are behaviour only, over the REAL routes, a REAL
 * {@link ObjectQL} engine, the REAL protocol and a sqlite `:memory:` driver:
 *
 *  - `ou_deal` carries an APPROVAL GATE: a metadata-bound `beforeUpdate` hook
 *    that re-opens approval (`approval_status: 'pending'`) whenever the amount
 *    changes;
 *  - `ou_case` carries a CLOSED-RECORD FREEZE: metadata-bound `beforeUpdate`
 *    and `beforeDelete` hooks that refuse any change to, or deletion of, a case
 *    whose stored `status` is `closed`;
 *  - `ou_ticket` carries a `state_machine` rule in which `closed` is terminal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { SysImportJob } from '@objectstack/platform-objects/audit';
import { UndoImportJobResponseSchema } from '@objectstack/spec/api';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const DEAL = {
  name: 'ou_deal', label: 'Deal', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
    amount: { name: 'amount', type: 'number' as const, label: 'Amount' },
    approval_status: { name: 'approval_status', type: 'text' as const, label: 'Approval status' },
  },
};

const STATUS = {
  name: 'status', type: 'select' as const, label: 'Status',
  options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }],
};

const CASE = {
  name: 'ou_case', label: 'Case', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    title: { name: 'title', type: 'text' as const, label: 'Title' },
    status: STATUS,
  },
};

const TICKET = {
  name: 'ou_ticket', label: 'Ticket', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    title: { name: 'title', type: 'text' as const, label: 'Title' },
    status: STATUS,
  },
  validations: [{
    type: 'state_machine', name: 'ticket_flow', message: 'A closed ticket stays closed.',
    field: 'status', transitions: { open: ['closed'], closed: [] },
  }],
};

const FROZEN = 'A closed case is frozen.';

/**
 * A metadata-bound hook body's refusal, in the shape the sandbox runner gives
 * it (`.message` its debug wrapper, `.innerMessage` the author's sentence), as
 * `rest-write-route-hook-refusal-sentence.ledger.test.ts` reproduces it: this
 * package does not depend on `@objectstack/runtime`.
 */
function hookRefusal(hook: string, sentence: string): Error {
  const err = new Error(`hook '${hook}' threw: Error: ${sentence}`);
  err.name = 'SandboxError';
  return Object.assign(err, { innerMessage: sentence });
}

const MEMBER = { userId: 'usr_member' };
const SYSTEM = { userId: 'usr_system_job', isSystem: true };

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
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(makeSqliteDriver(), true);
  await engine.init();
  for (const o of [DEAL, CASE, TICKET, SysImportJob]) engine.registry.registerObject(o as any);
  await engine.syncSchemas();
  // A real `single` install's Default Organization: the system writes below
  // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
  await installDefaultOrganization(engine);
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }

  // The app's declared controls, bound from metadata exactly as a
  // `defineStack({ hooks })` app binds them.
  engine.bindHooks([
    {
      name: 'ou_deal_approval_gate',
      object: 'ou_deal',
      events: ['beforeUpdate'],
      handler: async (ctx: any) => {
        const data = ctx.input?.data ?? {};
        if ('amount' in data && data.amount !== ctx.previous?.amount) data.approval_status = 'pending';
      },
    },
    {
      name: 'ou_case_closed_freeze',
      object: 'ou_case',
      events: ['beforeUpdate', 'beforeDelete'],
      handler: async (ctx: any) => {
        if (ctx.previous?.status === 'closed') throw hookRefusal('ou_case_closed_freeze', FROZEN);
      },
    },
  ] as any, { packageId: 'ou-app' });

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  let caller: Record<string, unknown> = MEMBER;
  (rest as any).resolveExecCtx = async () => caller;
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const find = (method: string, path: string): any => {
    const route = routes.find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`route ${method} ${path} is not registered`);
    return route;
  };
  const create = find('POST', '/api/v1/data/:object/import/jobs');
  const progressRoute = find('GET', '/api/v1/data/import/jobs/:jobId');
  const undoRoute = find('POST', '/api/v1/data/import/jobs/:jobId/undo');

  const progress = async (jobId: string) => {
    const res = makeRes();
    await progressRoute.handler({ params: { jobId }, query: {} } as any, res);
    return res._json;
  };

  return {
    engine,
    protocol,
    as(next: Record<string, unknown>) { caller = next; },
    progress,
    /** Run an async import job as the current caller and wait for it to finish. */
    async importJob(object: string, body: Record<string, unknown>): Promise<string> {
      const res = makeRes();
      await create.handler({ params: { object }, body: { format: 'json', ...body } } as any, res);
      expect(res._status).toBe(201);
      const jobId = res._json.jobId as string;
      for (let i = 0; i < 200; i++) {
        const p = await progress(jobId);
        if (['succeeded', 'failed', 'cancelled'].includes(p?.status)) {
          expect(p.status).toBe('succeeded');
          return jobId;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error('import job did not finish');
    },
    async undo(jobId: string) {
      const res = makeRes();
      await undoRoute.handler({ params: { jobId } } as any, res);
      return res;
    },
    /** The job row as stored, read the way the engine-owned writer reads it. */
    async jobRow(jobId: string): Promise<any> {
      return engine.findOne('sys_import_job', { where: { id: jobId }, context: { isSystem: true } });
    },
    async record(object: string, id: string): Promise<any> {
      return engine.findOne(object, { where: { id }, context: { isSystem: true } });
    },
    /** A later edit on the live app, by a signed-in user, between the import and its undo. */
    async edit(object: string, id: string, data: Record<string, unknown>) {
      await protocol.updateData({ object, id, data, context: MEMBER } as any);
    },
  };
}

/** The stored undo log, whichever way the json column materialised. */
function storedUndoLog(row: any): any {
  const raw = row?.undo_log;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

describe('[#24380] an import undo runs under the object\'s declared controls for every caller but the system principal', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  /** One deal the import updates (its amount) and one it creates. */
  async function dealJob(): Promise<string> {
    await ctx.engine.insert('ou_deal', { id: 'd_old', name: 'Acme renewal', amount: 100, approval_status: 'approved' }, { context: { isSystem: true } });
    const jobId = await ctx.importJob('ou_deal', {
      writeMode: 'upsert', matchFields: ['id'],
      rows: [{ id: 'd_old', amount: 250 }, { id: 'd_new', name: 'Globex', amount: 10 }],
    });
    // The import re-opened approval on the changed amount; the app's approver
    // then approves it again, before anyone undoes the import.
    expect(await ctx.record('ou_deal', 'd_old')).toMatchObject({ amount: 250, approval_status: 'pending' });
    await ctx.edit('ou_deal', 'd_old', { approval_status: 'approved' });
    return jobId;
  }

  it('a signed-in caller\'s undo runs the object\'s hooks on its reversal writes, and reverts every row', async () => {
    const jobId = await dealJob();

    const res = await ctx.undo(jobId);
    expect(res._status ?? 200).toBe(200);
    expect(res._json).toEqual({
      success: true, jobId, object: 'ou_deal', deleted: 1, restored: 1, failed: 0, failures: [],
    });
    // The restore is a change of amount, so the approval gate re-opened approval.
    expect(await ctx.record('ou_deal', 'd_old')).toMatchObject({ amount: 100, approval_status: 'pending' });
    expect(await ctx.record('ou_deal', 'd_new')).toBeNull();

    const after = await ctx.progress(jobId);
    expect(after.undoable).toBe(false);
    expect(after.revertedAt).toBeTruthy();
  });

  it('the system principal\'s undo keeps the skips: no metadata-bound hook runs on its reversal writes', async () => {
    const jobId = await dealJob();

    ctx.as(SYSTEM);
    const res = await ctx.undo(jobId);
    expect(res._json).toMatchObject({ success: true, deleted: 1, restored: 1, failed: 0, failures: [] });
    expect(await ctx.record('ou_deal', 'd_old')).toMatchObject({ amount: 100, approval_status: 'approved' });
    expect(await ctx.record('ou_deal', 'd_new')).toBeNull();
  });

  it('a signed-in caller\'s undo walks the state machine: a restore it refuses is reported per row and is not counted as reverted', async () => {
    await ctx.engine.insert('ou_ticket', [
      { id: 't_closed', title: 'printer', status: 'open' },
      { id: 't_renamed', title: 'old name', status: 'open' },
    ], { context: { isSystem: true } });
    const jobId = await ctx.importJob('ou_ticket', {
      writeMode: 'update', matchFields: ['id'],
      rows: [{ id: 't_closed', status: 'closed' }, { id: 't_renamed', title: 'new name' }],
    });

    const res = await ctx.undo(jobId);
    expect(res._status ?? 200).toBe(200);
    expect(res._json).toMatchObject({ success: false, jobId, object: 'ou_ticket', deleted: 0, restored: 1, failed: 1 });
    expect(res._json.failures).toEqual([
      { id: 't_closed', action: 'restore', code: 'VALIDATION_FAILED', error: 'A closed ticket stays closed.' },
    ]);
    // The answer is the published contract's, field for field.
    expect(UndoImportJobResponseSchema.strict().safeParse(res._json).success).toBe(true);
    expect(await ctx.record('ou_ticket', 't_closed')).toMatchObject({ status: 'closed' });
    expect(await ctx.record('ou_ticket', 't_renamed')).toMatchObject({ title: 'old name' });

    // The job's history: not stamped reverted, and the stored undo log keeps
    // exactly the row that remains, with its refusal.
    const row = await ctx.jobRow(jobId);
    expect(row.reverted_at ?? null).toBeNull();
    const log = storedUndoLog(row);
    expect(log.created).toEqual([]);
    expect(log.updated).toEqual([{ id: 't_closed', before: { id: 't_closed', status: 'open' } }]);
    expect(log.failures).toEqual(res._json.failures);
    const after = await ctx.progress(jobId);
    expect(after.undoable).toBe(true);
    expect(after.revertedAt).toBeUndefined();

    // The rest stays undoable, and a second undo retries only that row: the
    // system principal's skips the state machine.
    ctx.as(SYSTEM);
    const retry = await ctx.undo(jobId);
    expect(retry._json).toMatchObject({ success: true, deleted: 0, restored: 1, failed: 0, failures: [] });
    expect(await ctx.record('ou_ticket', 't_closed')).toMatchObject({ status: 'open' });
    const done = await ctx.progress(jobId);
    expect(done.undoable).toBe(false);
    expect(done.revertedAt).toBeTruthy();
  });

  it('a delete and a restore a closed-record freeze refuses are each reported per row, and the job keeps both', async () => {
    await ctx.engine.insert('ou_case', { id: 'c_old', title: 'before', status: 'open' }, { context: { isSystem: true } });
    const jobId = await ctx.importJob('ou_case', {
      writeMode: 'upsert', matchFields: ['id'],
      rows: [{ id: 'c_old', title: 'after' }, { id: 'c_new', title: 'fresh', status: 'open' }],
    });
    // Both cases are closed on the live app after the import.
    await ctx.edit('ou_case', 'c_old', { status: 'closed' });
    await ctx.edit('ou_case', 'c_new', { status: 'closed' });

    const res = await ctx.undo(jobId);
    expect(res._json).toMatchObject({ success: false, deleted: 0, restored: 0, failed: 2 });
    expect(res._json.failures).toEqual([
      { id: 'c_new', action: 'delete', code: 'VALIDATION_ERROR', error: FROZEN },
      { id: 'c_old', action: 'restore', code: 'VALIDATION_ERROR', error: FROZEN },
    ]);
    expect(await ctx.record('ou_case', 'c_new')).toMatchObject({ title: 'fresh', status: 'closed' });
    expect(await ctx.record('ou_case', 'c_old')).toMatchObject({ title: 'after', status: 'closed' });

    const row = await ctx.jobRow(jobId);
    expect(row.reverted_at ?? null).toBeNull();
    const log = storedUndoLog(row);
    expect(log.created).toEqual(['c_new']);
    expect(log.updated.map((u: any) => u.id)).toEqual(['c_old']);
    expect(log.failures).toEqual(res._json.failures);
  });

  describe('the write context the reversal writes carry', () => {
    function spyWriteContexts() {
      const seen: Array<{ op: string; object: string; context: any }> = [];
      for (const op of ['updateData', 'deleteData'] as const) {
        const orig = (ctx.protocol as any)[op].bind(ctx.protocol);
        (ctx.protocol as any)[op] = async (args: any) => {
          seen.push({ op, object: args.object, context: args.context });
          return orig(args);
        };
      }
      return () => seen.filter((s) => s.object === 'ou_deal');
    }

    /** A historical job, created by the system principal (the only caller the import doors let send it). */
    async function historicalJob(): Promise<string> {
      await ctx.engine.insert('ou_deal', { id: 'h_old', name: 'Initech', amount: 5, approval_status: 'approved' }, { context: { isSystem: true } });
      ctx.as(SYSTEM);
      const jobId = await ctx.importJob('ou_deal', {
        writeMode: 'upsert', matchFields: ['id'], treatAsHistorical: true,
        rows: [{ id: 'h_old', amount: 7 }, { id: 'h_new', name: 'Umbrella', amount: 1 }],
      });
      ctx.as(MEMBER);
      return jobId;
    }

    it('a historical job keeps preserveAudit on a signed-in caller\'s undo, which carries no control skip', async () => {
      const jobId = await historicalJob();
      const writes = spyWriteContexts();
      const res = await ctx.undo(jobId);
      expect(res._json).toMatchObject({ success: true, deleted: 1, restored: 1 });
      expect(writes().map((w) => w.op).sort()).toEqual(['deleteData', 'updateData']);
      for (const w of writes()) {
        expect(w.context?.preserveAudit).toBe(true);
        expect(w.context?.skipAutomations).toBeUndefined();
        expect(w.context?.skipStateMachine).toBeUndefined();
      }
    });

    it('a historical job keeps preserveAudit on the system principal\'s undo, beside its skips', async () => {
      const jobId = await historicalJob();
      ctx.as(SYSTEM);
      const writes = spyWriteContexts();
      await ctx.undo(jobId);
      expect(writes().length).toBe(2);
      for (const w of writes()) {
        expect(w.context).toMatchObject({ preserveAudit: true, skipAutomations: true, skipStateMachine: true });
      }
    });
  });
});
