// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3356 (follow-up to #1888) — end-to-end WIRING proof for the runAs:'user'
// credential propagation. It is not enough that the engine CAN resolve grants
// (a bare-engine unit tests that in crud-runas.test.ts) — the plugin's start()
// must actually BRIDGE the shared authz resolver to the objectql/data service,
// or a real deployment still runs a runAs:'user' flow with the bare
// member/everyone fallback (the hollow-credential bug this issue reports).
//
// This boots AutomationServicePlugin on a LiteKernel with a fake objectql that
// (a) serves the sys_member / sys_user_position / sys_*_permission_set tables
// `resolveUserAuthzGrants` reads, and (b) records the ObjectQL `context` each
// CRUD op receives. A runAs:'user' run triggered with ONLY a userId (the
// record-change hook shape) must reach its update_record with the TRIGGERING
// user's resolved positions + permission-set names — not an empty envelope.

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin } from './plugin.js';
import { AutomationEngine } from './engine.js';

/**
 * A fake ObjectQL engine that both serves the authz tables (for grant
 * resolution) and records the `context` every CRUD op is called with. Registered
 * under BOTH `objectql` and `data` so the resolver (checks objectql first) and
 * the CRUD nodes (check data first) resolve the same instance.
 */
function fakeObjectQl(tables: Record<string, any[]>) {
  const crud: Array<{ op: string; obj: string; ctx: any }> = [];
  const match = (object: string, where: any): any[] =>
    (tables[object] ?? []).filter((r) =>
      Object.entries(where ?? {}).every(([k, v]) =>
        { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return v && typeof v === 'object' && '$in' in (v as any) ? (v as any).$in.includes(r[k]) : r[k] === v; },
      ),
    );
  const engine: any = {
    async find(object: string, opts: any) { crud.push({ op: 'find', obj: object, ctx: opts?.context }); return match(object, opts?.where); },
    async findOne(object: string, opts: any) { crud.push({ op: 'findOne', obj: object, ctx: opts?.context }); return match(object, opts?.where)[0]; },
    async insert(object: string, _f: any, opts: any) { crud.push({ op: 'insert', obj: object, ctx: opts?.context }); return { id: `${object}_1` }; },
    async update(object: string, _f: any, opts: any) { crud.push({ op: 'update', obj: object, ctx: opts?.context }); return { ok: true }; },
    async delete(object: string, opts: any) { crud.push({ op: 'delete', obj: object, ctx: opts?.context }); return { ok: true }; },
  };
  return { engine, crud };
}

/** start → update_record('runas_thing') → end, parameterized by runAs. */
function updateFlow(name: string, runAs: 'system' | 'user') {
  return {
    name, label: name, type: 'autolaunched', runAs,
    variables: [{ name: 'noteId', type: 'text', isInput: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'up', type: 'update_record', label: 'Update', config: { objectName: 'runas_thing', filter: { id: '{noteId}' }, fields: { status: 'x' } } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'up' }, { id: 'e2', source: 'up', target: 'end' }],
  };
}

/** Authz tables granting user 'u1' the unscoped `ehr_all` set + the `approver` position. */
const AUTHZ_TABLES: Record<string, any[]> = {
  sys_user: [{ id: 'u1', email: 'u1@x.com' }],
  sys_member: [],
  sys_user_position: [{ user_id: 'u1', position: 'approver', organization_id: null }],
  sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'psE', organization_id: null }],
  sys_permission_set: [{ id: 'psE', name: 'ehr_all', system_permissions: ['cap_ehr'] }],
  sys_position: [],
  sys_position_permission_set: [],
};

async function bootWithObjectQl(ql: any): Promise<LiteKernel> {
  const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
  kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
  const harness = {
    name: 'test.harness', type: 'standard' as const, version: '1.0.0', dependencies: [] as string[],
    async init(ctx: any) {
      ctx.registerService('objectql', ql);
      ctx.registerService('data', ql);
    },
    async start() {},
  };
  kernel.use(harness as never);
  await kernel.bootstrap();
  return kernel;
}

describe("AutomationServicePlugin bridges the runAs:'user' grant resolver (#3356)", () => {
  it("resolves the triggering user's positions + permission sets into the data op context", async () => {
    const { engine: ql, crud } = fakeObjectQl(AUTHZ_TABLES);
    const kernel = await bootWithObjectQl(ql);
    const automation = kernel.getService<AutomationEngine>('automation');
    automation.registerFlow('usr', updateFlow('usr', 'user') as never);

    // The record-change hook shape: ONLY a userId — no positions/permissions.
    const res = await automation.execute('usr', { userId: 'u1', params: { noteId: 'n1' } });
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);

    const update = crud.find((c) => c.op === 'update' && c.obj === 'runas_thing');
    expect(update, 'update_record never reached the data engine').toBeTruthy();
    expect(update!.ctx, 'runAs:user data op ran with NO identity (security skipped)').toBeTruthy();
    expect(update!.ctx.isSystem).toBe(false);
    expect(update!.ctx.userId).toBe('u1');
    expect(update!.ctx.positions).toContain('approver'); // sys_user_position
    expect(update!.ctx.positions).toContain('everyone'); // implicit anchor
    expect(
      update!.ctx.permissions,
      "the triggering user's permission set was not propagated — runAs:'user' ran with the bare member fallback (#3356)",
    ).toContain('ehr_all');

    await kernel.shutdown();
  });

  it("runAs:'system' still elevates — the resolver is not consulted", async () => {
    const { engine: ql, crud } = fakeObjectQl(AUTHZ_TABLES);
    const kernel = await bootWithObjectQl(ql);
    const automation = kernel.getService<AutomationEngine>('automation');
    automation.registerFlow('sys', updateFlow('sys', 'system') as never);

    await automation.execute('sys', { userId: 'u1', params: { noteId: 'n1' } });
    const update = crud.find((c) => c.op === 'update' && c.obj === 'runas_thing');
    expect(update!.ctx.isSystem).toBe(true);
    // #5494 — the acting user rides the elevated context as ATTRIBUTION (it
    // drives the created_by/updated_by stamps and the audit actor; the
    // isSystem short-circuit precedes every gate that reads it). What proves
    // "the resolver is not consulted" is the untouched authz envelope:
    expect(update!.ctx.userId).toBe('u1');
    expect(update!.ctx.positions).toEqual([]);
    expect(update!.ctx.permissions).toEqual([]);

    await kernel.shutdown();
  });
});

// The provenance band #3456 rides on: a run's data writes must be attributable
// to the run that made them, all the way down to the ObjectQL context — without
// it the approvals record lock cannot tell the owning run from a stranger.
describe('a run stamps its own id onto its data ops (#3456)', () => {
  it.each([
    ["runAs:'user'", 'user'],
    ["runAs:'system'", 'system'],
  ] as const)('%s carries flowRunId matching the run id', async (_label, runAs) => {
    const { engine: ql, crud } = fakeObjectQl(AUTHZ_TABLES);
    const kernel = await bootWithObjectQl(ql);
    const automation = kernel.getService<AutomationEngine>('automation');
    automation.registerFlow(`stamp_${runAs}`, updateFlow(`stamp_${runAs}`, runAs) as never);

    const res = await automation.execute(`stamp_${runAs}`, { userId: 'u1', params: { noteId: 'n1' } });
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);

    // `result.runId` is only surfaced for a PAUSED run, so cross-check against
    // the engine's own run log — the id a later `getRun` would be asked about,
    // which is exactly the join the dead-run sweep depends on.
    const [logged] = await automation.listRuns(`stamp_${runAs}`, { limit: 1 });
    const update = crud.find((c) => c.op === 'update' && c.obj === 'runas_thing');
    expect(update!.ctx.flowRunId, 'the data op carried no run provenance').toBeTruthy();
    expect(update!.ctx.flowRunId).toBe(logged.id);

    await kernel.shutdown();
  });

  it('does not leak the stamp back onto the caller-supplied context', async () => {
    const { engine: ql } = fakeObjectQl(AUTHZ_TABLES);
    const kernel = await bootWithObjectQl(ql);
    const automation = kernel.getService<AutomationEngine>('automation');
    automation.registerFlow('nomutate', updateFlow('nomutate', 'user') as never);

    // resolveRunContext copies rather than mutates, so a caller reusing one
    // context object across runs can never inherit a stale run id.
    const caller: any = { userId: 'u1', params: { noteId: 'n1' } };
    await automation.execute('nomutate', caller);
    expect(caller.flowRunId).toBeUndefined();

    await kernel.shutdown();
  });
});
