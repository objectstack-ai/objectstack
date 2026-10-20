// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24348] WHO MAY TAKE AN OBJECT'S DECLARED CONTROLS OFF AN IMPORT.
 *
 * The two import doors — `POST /data/:object/import` and
 * `POST /data/:object/import/jobs` — read two request flags that remove an
 * app's declared business controls from every row they write:
 * `runAutomations: false` (the runner writes with `skipAutomations`: no
 * metadata-bound hook, no record-change trigger) and `treatAsHistorical: true`
 * (`skipStateMachine` + `preserveAudit`). Both are honoured only for the
 * system principal (`ExecutionContext.isSystem`), and refused `403
 * PERMISSION_DENIED`, in the ADR-0112 envelope, to every other caller —
 * before the body is parsed, so a refused request writes no row and creates
 * no job. `importControlOptOutRefusal` (`import-prepare.ts`) is the one
 * predicate both doors ask.
 *
 * The fixtures are behaviour only, over the REAL route, a REAL {@link ObjectQL}
 * engine, the REAL protocol and a sqlite `:memory:` driver:
 *
 *  - `oo_deal` carries an APPROVAL GATE: a metadata-bound `beforeInsert` hook
 *    that marks every new deal `approval_status: 'pending'`, the way an app's
 *    approval opens on a new record;
 *  - `oo_case` carries a CLOSED-RECORD FREEZE: a metadata-bound `beforeUpdate`
 *    hook that refuses any change to a case whose stored `status` is `closed`.
 *
 * A caller that is refused leaves both controls exactly where they were; the
 * same caller without the opt-out imports with both in force; the system
 * principal keeps the opt-out.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { SysImportJob } from '@objectstack/platform-objects/audit';
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
  name: 'oo_deal', label: 'Deal', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
    amount: { name: 'amount', type: 'number' as const, label: 'Amount' },
    approval_status: { name: 'approval_status', type: 'text' as const, label: 'Approval status' },
  },
};

const CASE = {
  name: 'oo_case', label: 'Case', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    title: { name: 'title', type: 'text' as const, label: 'Title' },
    status: {
      name: 'status', type: 'select' as const, label: 'Status',
      options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }],
    },
  },
};

/** An object whose API exposure is switched off: the door's 404 must still come first. */
const HIDDEN = {
  name: 'oo_hidden', label: 'Hidden', systemFields: false,
  enable: { apiEnabled: false },
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    title: { name: 'title', type: 'text' as const, label: 'Title' },
  },
};

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
  for (const o of [DEAL, CASE, HIDDEN, SysImportJob]) engine.registry.registerObject(o as any);
  await engine.syncSchemas();
  // A real `single` install's Default Organization: the system writes below
  // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
  await installDefaultOrganization(engine);
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }

  // The app's two declared controls, bound from metadata exactly as a
  // `defineStack({ hooks })` app binds them — the binding `skipAutomations`
  // skips.
  engine.bindHooks([
    {
      name: 'oo_deal_approval_gate',
      object: 'oo_deal',
      events: ['beforeInsert'],
      handler: async (ctx: any) => { ctx.input.data.approval_status = 'pending'; },
    },
    {
      name: 'oo_case_closed_freeze',
      object: 'oo_case',
      events: ['beforeUpdate'],
      handler: async (ctx: any) => {
        if (ctx.previous?.status === 'closed') throw new Error('A closed case is frozen');
      },
    },
  ] as any, { packageId: 'oo-app' });

  await engine.insert('oo_case', { id: 'c_closed', title: 'closed as agreed', status: 'closed' });

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
  const sync = find('POST', '/api/v1/data/:object/import');
  const jobs = find('POST', '/api/v1/data/:object/import/jobs');
  const progress = find('GET', '/api/v1/data/import/jobs/:jobId');
  return {
    engine,
    as(next: Record<string, unknown>) { caller = next; },
    async door(kind: 'sync' | 'jobs', object: string, body: any) {
      const res = makeRes();
      await (kind === 'sync' ? sync : jobs).handler({ params: { object }, body } as any, res);
      if (kind === 'jobs' && res._status === 201) {
        for (let i = 0; i < 200; i++) {
          const p = makeRes();
          await progress.handler({ params: { jobId: res._json.jobId }, query: {} } as any, p);
          if (['succeeded', 'failed', 'cancelled'].includes(p._json?.status)) return { res, job: p._json };
          await new Promise((r) => setTimeout(r, 5));
        }
        throw new Error('import job did not finish');
      }
      return { res, job: undefined as any };
    },
  };
}

const DEAL_ROWS = [{ id: 'd1', name: 'Acme renewal', amount: 250000 }];
const CASE_ROWS = [{ id: 'c_closed', title: 'reopened by import' }];
const CASE_UPDATE = { writeMode: 'update', matchFields: ['id'] };

/** The refusal, asserted by its envelope: code, status and the subject it names. */
function expectRefused(res: any, object: string, refused: string[]) {
  expect(res._status).toBe(403);
  expect(res._json?.success).toBe(false);
  expect(res._json?.error?.code).toBe('PERMISSION_DENIED');
  expect(res._json?.error?.details).toEqual({ object, refused });
}

describe('[#24348] the import doors honour a control opt-out only for the system principal', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  const jobRows = () => ctx.engine.find('sys_import_job', { context: { isSystem: true } });

  describe('a signed-in caller who is not the system principal', () => {
    for (const kind of ['sync', 'jobs'] as const) {
      it(`${kind}: runAutomations:false on an approval-gated insert is refused 403 and writes nothing`, async () => {
        const { res } = await ctx.door(kind, 'oo_deal', { format: 'json', rows: DEAL_ROWS, runAutomations: false });
        expectRefused(res, 'oo_deal', ['runAutomations']);
        expect(await ctx.engine.findOne('oo_deal', { where: { id: 'd1' } })).toBeNull();
        expect(await jobRows()).toEqual([]);
      });

      it(`${kind}: runAutomations:false on an update of a frozen record is refused 403 and the record is unchanged`, async () => {
        const { res } = await ctx.door(kind, 'oo_case', { format: 'json', rows: CASE_ROWS, ...CASE_UPDATE, runAutomations: false });
        expectRefused(res, 'oo_case', ['runAutomations']);
        expect(await ctx.engine.findOne('oo_case', { where: { id: 'c_closed' } }))
          .toMatchObject({ title: 'closed as agreed', status: 'closed' });
        expect(await jobRows()).toEqual([]);
      });

      it(`${kind}: treatAsHistorical:true is refused 403 the same way`, async () => {
        const { res } = await ctx.door(kind, 'oo_case', { format: 'json', rows: CASE_ROWS, ...CASE_UPDATE, treatAsHistorical: true });
        expectRefused(res, 'oo_case', ['treatAsHistorical']);
        expect(await ctx.engine.findOne('oo_case', { where: { id: 'c_closed' } }))
          .toMatchObject({ title: 'closed as agreed', status: 'closed' });
      });

      it(`${kind}: both opt-outs together are named together`, async () => {
        const { res } = await ctx.door(kind, 'oo_deal', { format: 'json', rows: DEAL_ROWS, runAutomations: false, treatAsHistorical: true });
        expectRefused(res, 'oo_deal', ['runAutomations', 'treatAsHistorical']);
        expect(await ctx.engine.findOne('oo_deal', { where: { id: 'd1' } })).toBeNull();
      });
    }

    it('a dry run that sends the opt-out is refused too, not previewed', async () => {
      const { res } = await ctx.door('sync', 'oo_deal', { format: 'json', rows: DEAL_ROWS, dryRun: true, runAutomations: false });
      expectRefused(res, 'oo_deal', ['runAutomations']);
    });

    it('an object the API does not expose keeps its 404 ahead of the refusal', async () => {
      const { res } = await ctx.door('sync', 'oo_hidden', { format: 'json', rows: [{ id: 'h1', title: 'x' }], runAutomations: false });
      expect(res._status).toBe(404);
    });

    for (const kind of ['sync', 'jobs'] as const) {
      it(`${kind}: the SAME caller without the opt-out imports with both controls in force`, async () => {
        const deal = await ctx.door(kind, 'oo_deal', { format: 'json', rows: DEAL_ROWS });
        const created = kind === 'sync' ? deal.res._json : deal.job;
        expect(created).toMatchObject({ created: 1 });
        expect(await ctx.engine.findOne('oo_deal', { where: { id: 'd1' } }))
          .toMatchObject({ name: 'Acme renewal', approval_status: 'pending' });

        const frozen = await ctx.door(kind, 'oo_case', { format: 'json', rows: CASE_ROWS, ...CASE_UPDATE });
        const updated = kind === 'sync' ? frozen.res._json : frozen.job;
        expect(updated).toMatchObject({ updated: 0 });
        expect(await ctx.engine.findOne('oo_case', { where: { id: 'c_closed' } }))
          .toMatchObject({ title: 'closed as agreed', status: 'closed' });
      });
    }

    it('an explicit runAutomations:true and treatAsHistorical:false are not opt-outs', async () => {
      const { res } = await ctx.door('sync', 'oo_deal', { format: 'json', rows: DEAL_ROWS, runAutomations: true, treatAsHistorical: false });
      expect(res._status ?? 200).toBe(200);
      expect(res._json).toMatchObject({ created: 1 });
      expect(await ctx.engine.findOne('oo_deal', { where: { id: 'd1' } })).toMatchObject({ approval_status: 'pending' });
    });
  });

  describe('the system principal keeps the opt-out', () => {
    for (const kind of ['sync', 'jobs'] as const) {
      it(`${kind}: runAutomations:false writes past both controls`, async () => {
        ctx.as(SYSTEM);
        const deal = await ctx.door(kind, 'oo_deal', { format: 'json', rows: DEAL_ROWS, runAutomations: false });
        expect(kind === 'sync' ? deal.res._json : deal.job).toMatchObject({ created: 1 });
        const stored: any = await ctx.engine.findOne('oo_deal', { where: { id: 'd1' } });
        expect(stored).toMatchObject({ name: 'Acme renewal' });
        expect(stored?.approval_status ?? null).toBeNull();

        const frozen = await ctx.door(kind, 'oo_case', { format: 'json', rows: CASE_ROWS, ...CASE_UPDATE, runAutomations: false });
        expect(kind === 'sync' ? frozen.res._json : frozen.job).toMatchObject({ updated: 1 });
        expect(await ctx.engine.findOne('oo_case', { where: { id: 'c_closed' } }))
          .toMatchObject({ title: 'reopened by import' });
      });
    }

    it('treatAsHistorical:true is admitted', async () => {
      ctx.as(SYSTEM);
      const { res } = await ctx.door('sync', 'oo_deal', { format: 'json', rows: DEAL_ROWS, treatAsHistorical: true });
      expect(res._status ?? 200).toBe(200);
      expect(res._json).toMatchObject({ created: 1 });
    });
  });
});
