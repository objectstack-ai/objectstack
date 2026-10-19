// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `runAs:'user'` hook fired by a write of a user-triggered `runAs:'system'`
 * flow runs on that user's own grants, as the user's own request does — not
 * on the member baseline.
 *
 * The defect this pins: `resolveRunDataContext`'s system arm carried empty
 * `positions` / `permissions` beside the run's `userId`. The hook de-elevates
 * to that context (`ScopedContext.withRunAs('user')`), and the engine's hook
 * seed keeps carried arrays verbatim, resolving a user's grants only when none
 * are carried. So the hook read under the baseline sets alone, whoever the
 * user was: less than a user granted more, and more than a user whose own sets
 * scope a read the baseline leaves open. The system arm now carries no arrays
 * when it names a user, and the seed resolves that user's grants in the run's
 * organisation. The run's own elevation is unchanged.
 *
 * Directions decided before running:
 *  - a user granted more than the baseline: the hook reads what they may (was:
 *    refused on an object the baseline does not grant);
 *  - a user whose own sets read FEWER rows of an object than the baseline:
 *    the hook reads those fewer rows (was: every row the baseline reads);
 *  - after an approval decision the run's user is the decider, so a hook a
 *    post-decision write fires runs on the decider's grants (was: baseline);
 *  - CONTROL, a user-less system run (a schedule): its envelope is unchanged
 *    and the hook is still refused for want of a user;
 *  - CONTROL, the former envelope fired by hand: the baseline answer, which
 *    is what each direction above moved away from.
 *
 * The real stack, as `runas-user-hook-org-peers.integration.test.ts` composes
 * it: ObjectKernel, ObjectQLPlugin, driver-sql on better-sqlite3 `:memory:`,
 * the identity objects and the real SecurityPlugin, plus the real
 * AutomationEngine and its CRUD nodes. The defect sits in the hand-off from
 * the flow's data context through the hook's derivation to the security
 * middleware, which no single-layer test sees.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, resolveUserAuthzGrants, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, bindHooksToEngine, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { RESUME_AUTHORITY_SERVICE, type ResumeSignal } from '@objectstack/spec/contracts';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

const SYS = { isSystem: true } as const;
const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const text = (name: string) => ({ name, label: name, type: 'text' as const });

/** The object the flows write; its insert fires the hook under test. */
const triggerObject = { name: 'hgp_trigger', label: 'Hook grants trigger', fields: { name: text('name') } };
/** An object the baseline does not grant: only `hgp_ledger_reader` reads it. */
const ledgerObject = { name: 'hgp_ledger', label: 'Ledger', sharingModel: 'public_read', fields: { title: text('title') } };
/** An object the baseline reads in full. */
const noteObject = { name: 'hgp_note', label: 'Note', sharingModel: 'public_read', fields: { title: text('title') } };

/** The deployment's member profile, composed into the baseline beside `member_default`. */
const memberProfile = PermissionSetSchema.parse({
  name: 'hgp_member', label: 'Hook grants: member profile',
  objects: { hgp_note: { allowRead: true } },
});
const ledgerReader = PermissionSetSchema.parse({
  name: 'hgp_ledger_reader', label: 'Hook grants: ledger reader',
  objects: { hgp_ledger: { allowRead: true } },
});
const noteOwnRows = PermissionSetSchema.parse({
  name: 'hgp_note_own_rows', label: 'Hook grants: own notes',
  objects: { hgp_note: { allowRead: true } },
  rowLevelSecurity: [{ name: 'hgp_note_own', object: 'hgp_note', operation: 'select', using: 'owner_id == current_user.id' }],
});

/** The approval node's stand-in: a pause only its owning service may continue. */
const GATED = defineActionDescriptor({
  type: 'decision_gate', version: '1.0.0', name: 'Decision Gate',
  supportsPause: true, resumeAuthority: 'service',
});

/** What `ApprovalService.decide` hands the engine for a human decision. */
const decided = (resumedBy?: string): ResumeSignal => ({
  branchLabel: 'approve',
  output: { decision: 'approve' },
  ...(resumedBy ? { resumedBy } : {}),
  [RESUME_AUTHORITY_SERVICE]: true,
});

const create = (id: string, name: string) => ({
  id, type: 'create_record', label: id, config: { objectName: 'hgp_trigger', fields: { name } },
});

/** start → create_record(hgp_trigger) → end, under runAs:'system'. */
const sweepFlow = {
  name: 'hgp_sweep', label: 'hgp_sweep', type: 'autolaunched', runAs: 'system',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, create('mk', 'sweep'), { id: 'end', type: 'end', label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'mk' }, { id: 'e2', source: 'mk', target: 'end' }],
};

/** start → create (submit) → gate → create (after the decision) → end, under runAs:'system'. */
const reviewFlow = {
  name: 'hgp_review', label: 'hgp_review', type: 'autolaunched', runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    create('submit', 'submit'),
    { id: 'gate', type: 'decision_gate', label: 'Review' },
    create('after', 'after'),
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'submit' },
    { id: 'e2', source: 'submit', target: 'gate' },
    { id: 'e3', source: 'gate', target: 'after', label: 'approve' },
    { id: 'e4', source: 'after', target: 'end' },
  ],
};

/** A read's answer: the ids it returned, or the refusal's envelope. */
type Answer = string[] | { code: unknown; status: unknown };
interface Firing { trigger: string; ledger: Answer; note: Answer }

describe("a runAs:'user' hook fired by a user-triggered runAs:'system' flow's write runs on that user's own grants", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let orgA = '';
  /** What the hook's reads answered, per firing. */
  const firings: Firing[] = [];
  /** The context each `hgp_trigger` insert carried to the middleware chain. */
  const writeContexts: Array<Record<string, unknown>> = [];
  /** The context the hook's `hgp_note` read carried, per firing. */
  const hookReadContexts: Array<Record<string, unknown>> = [];

  const ids = (rows: unknown): string[] => (Array.isArray(rows) ? rows.map((r: any) => String(r.id)).sort() : []);
  const answer = async (read: () => Promise<unknown>): Promise<Answer> => {
    try {
      return ids(await read());
    } catch (e: any) {
      return { code: e?.code, status: e?.statusCode ?? e?.status };
    }
  };

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await kernel.use({
      name: 'test.driver.sqlite', type: 'standard', version: '1.0.0',
      async init(ctx: PluginContext) { ctx.registerService('driver.default', driver); },
    });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new SecurityPlugin({
      defaultPermissionSets: [...securityDefaultPermissionSets, memberProfile, ledgerReader, noteOwnRows],
      fallbackPermissionSet: 'hgp_member',
    }));
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');
    automation.registerNodeExecutor({ type: 'decision_gate', descriptor: GATED, async execute() { return { success: true, suspend: true }; } });
    automation.registerFlow('hgp_sweep', sweepFlow as never);
    automation.registerFlow('hgp_review', reviewFlow as never);
    for (const o of [triggerObject, ledgerObject, noteObject]) ql.registry.registerObject(o as any, 'hook-grants-test', 'hook-grants-test');
    await ql.syncSchemas();

    const orgs = await ql.find('sys_organization', { context: SYS });
    orgA = String(orgs[0].id);
    const inOrg = { isSystem: true, tenantId: orgA } as const;
    for (const id of ['usr_above', 'usr_below', 'usr_peer']) {
      await ql.insert('sys_user', { id, name: id, email: `${id}@example.test` }, { context: SYS });
      await ql.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: orgA, role: 'member' }, { context: SYS });
    }
    await ql.insert('sys_user_permission_set', { id: 'ups_above', user_id: 'usr_above', permission_set: 'hgp_ledger_reader', organization_id: orgA }, { context: SYS });
    await ql.insert('sys_user_permission_set', { id: 'ups_below', user_id: 'usr_below', permission_set: 'hgp_note_own_rows', organization_id: orgA }, { context: SYS });
    await ql.insert('hgp_ledger', { id: 'ledger_1', title: 'Ledger' }, { context: inOrg });
    await ql.insert('hgp_note', { id: 'note_below', title: 'Below', owner_id: 'usr_below' }, { context: inOrg });
    await ql.insert('hgp_note', { id: 'note_peer', title: 'Peer', owner_id: 'usr_peer' }, { context: inOrg });

    let inHook = false;
    ql.registerMiddleware(async (opCtx: any, next: any) => {
      if (opCtx.object === 'hgp_trigger' && opCtx.operation === 'insert') writeContexts.push({ ...(opCtx.context ?? {}) });
      if (inHook && opCtx.object === 'hgp_note') hookReadContexts.push({ ...(opCtx.context ?? {}) });
      return next();
    });
    bindHooksToEngine(ql, [
      {
        name: 'read_as_user',
        object: 'hgp_trigger',
        events: ['afterInsert'],
        priority: 100,
        runAs: 'user',
        handler: async (ctx: any) => {
          inHook = true;
          try {
            firings.push({
              trigger: String(ctx.input?.name ?? ''),
              ledger: await answer(() => ctx.api.object('hgp_ledger').find({ fields: ['id'] })),
              note: await answer(() => ctx.api.object('hgp_note').find({ fields: ['id'] })),
            });
          } finally {
            inHook = false;
          }
        },
      } as any,
    ], { packageId: 'app:test', logger: silentLogger });
  }, 30_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  /** What the request path hands ObjectQL for `userId` acting in organisation A. */
  async function requestContext(userId: string) {
    const g = await resolveUserAuthzGrants(ql, userId, { tenantId: orgA, bypassGrantsCache: true });
    return { userId, tenantId: orgA, isSystem: false, positions: g.positions, permissions: g.permissions, org_user_ids: g.org_user_ids };
  }
  /** What the user's own request reads, the answer the hook must match. */
  async function ownRequest(userId: string): Promise<Omit<Firing, 'trigger'>> {
    const context = await requestContext(userId);
    return {
      ledger: await answer(() => ql.find('hgp_ledger', { fields: ['id'], context: context as any })),
      note: await answer(() => ql.find('hgp_note', { fields: ['id'], context: context as any })),
    };
  }
  /** Run the system sweep as triggered by `userId` in organisation A; answer the hook's firing and the write's context. */
  async function sweepAs(userId: string) {
    const before = firings.length;
    const res = await automation.execute('hgp_sweep', { userId, tenantId: orgA } as never);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect(firings.length, 'the hook ran exactly once').toBe(before + 1);
    return { firing: firings[firings.length - 1], write: writeContexts[writeContexts.length - 1] };
  }
  /** Fire the hook with `context` as the triggering write's context, by hand. */
  async function fireWith(context: Record<string, unknown>) {
    const before = firings.length;
    await ql.insert('hgp_trigger', { name: 'by-hand' }, { context: context as any });
    expect(firings.length, 'the hook ran exactly once').toBe(before + 1);
    return firings[firings.length - 1];
  }
  const DENIED = { code: 'PERMISSION_DENIED', status: 403 };

  it('GUARD: the two users\' own requests differ from the baseline in opposite directions', async () => {
    // The baseline alone: no ledger, every note.
    expect(await fireWith({ ...SYS, userId: 'usr_peer', tenantId: orgA, positions: [], permissions: [] }))
      .toMatchObject({ ledger: DENIED, note: ['note_below', 'note_peer'] });
    expect(await ownRequest('usr_above')).toEqual({ ledger: ['ledger_1'], note: ['note_below', 'note_peer'] });
    expect(await ownRequest('usr_below')).toEqual({ ledger: DENIED, note: ['note_below'] });
  });

  it('a user granted more than the baseline: the hook reads what their own request reads', async () => {
    const { firing, write } = await sweepAs('usr_above');
    expect(write).toMatchObject({ isSystem: true, userId: 'usr_above', tenantId: orgA });
    expect(Object.keys(write), 'the system write carried permission sets beside its user').not.toContain('permissions');
    expect({ ledger: firing.ledger, note: firing.note }).toEqual(await ownRequest('usr_above'));
    expect(firing.ledger).toEqual(['ledger_1']);
    const hookCtx = hookReadContexts[hookReadContexts.length - 1];
    expect(hookCtx.isSystem, 'the hook de-elevated').toBe(false);
    expect(hookCtx.permissions).toContain('hgp_ledger_reader');
  });

  it('a user whose own sets read fewer rows than the baseline: the hook reads those fewer rows', async () => {
    const { firing, write } = await sweepAs('usr_below');
    expect(write).toMatchObject({ isSystem: true, userId: 'usr_below', tenantId: orgA });
    expect({ ledger: firing.ledger, note: firing.note }).toEqual(await ownRequest('usr_below'));
    expect(firing.note).toEqual(['note_below']);
    expect(hookReadContexts[hookReadContexts.length - 1].permissions).toContain('hgp_note_own_rows');
  });

  it("after an approval decision a post-decision write's hook runs on the decider's grants, and the submit write's on the submitter's", async () => {
    const before = firings.length;
    const paused = await automation.execute('hgp_review', { userId: 'usr_below', tenantId: orgA } as never);
    expect(paused.status, JSON.stringify(paused)).toBe('paused');
    const res = await automation.resume(paused.runId!, decided('usr_above'));
    expect(res.success, JSON.stringify(res)).not.toBe(false);
    const [submit, after] = firings.slice(before);
    expect(submit).toMatchObject({ trigger: 'submit', ledger: DENIED, note: ['note_below'] });
    expect(after).toMatchObject({ trigger: 'after', ledger: ['ledger_1'], note: ['note_below', 'note_peer'] });
    expect(writeContexts[writeContexts.length - 1]).toMatchObject({ isSystem: true, userId: 'usr_above' });
  });

  it('CONTROL: a user-less system run keeps its envelope, and the hook is still refused for want of a user', async () => {
    const before = firings.length;
    const res = await automation.execute('hgp_sweep', { event: 'schedule', params: {} } as never);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    const write = writeContexts[writeContexts.length - 1];
    expect(write).toMatchObject({ isSystem: true, actor: 'svc:flow:hgp_sweep', positions: [], permissions: [] });
    expect(write.userId).toBeUndefined();
    expect(firings.slice(before)).toEqual([{
      trigger: 'sweep',
      ledger: { code: 'HOOK_UNSCOPED_DATA_ACCESS', status: 403 },
      note: { code: 'HOOK_UNSCOPED_DATA_ACCESS', status: 403 },
    }]);
  });
});
