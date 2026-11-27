// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0162 Execution item 7, "The root run"] Each request records its root
 * run as it opens, in columns of its own the store can be asked for: the run
 * its approval's tree of runs was started on, as the automation service hands
 * it to the approval node (`AutomationEngine.rootRunOf`).
 *
 * Driven on the real data engine (SQLite through `SqlDriver`, the plugin's own
 * object definitions synced), so the columns exist and the store filters on
 * them, and on the real automation engine. The pins:
 *  - a root run's request records its own run;
 *  - a `subflow` child's requests, both steps, record the parent, which the
 *    request's own `flow_run_id` does not name;
 *  - the card's test: a child run started before the release, which opens a
 *    request after it, records its root run. The release is played as a
 *    restart: the parked runs lose their root run (the shape a run parked
 *    before the stamp has), and a fresh engine over the same store resumes;
 *  - a child whose tree cannot be read whole (its parent is no longer parked)
 *    opens no request: the step is refused and the run fails, saying why;
 *  - an automation service that hands no root run (no `rootRunOf`) records
 *    none, as before.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationEngine, InMemorySuspendedRunStore, installBuiltinNodes } from '@objectstack/service-automation';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { registerApprovalNode, type ApprovalAutomationSurface } from './approval-node.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child() { return silent; } } as any;

const ORG = 'org_root_run';
const SUBMITTER = 'u_sub';
const USERS = [
  { id: SUBMITTER, name: 'Sam Submitter', email: 'sam@example.com' },
  { id: 'u_mgr', name: 'Mona Manager', email: 'mona@example.com' },
  { id: 'u_exec', name: 'Eve Exec', email: 'eve@example.com' },
];

const sysUser = {
  name: 'sys_user', label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    email: { name: 'email', label: 'Email', type: 'text' as const },
  },
};
const deal = {
  name: 'crm_deal', label: 'Deal',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};

async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: silent,
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

const step = (id: string, approver: string) =>
  ({ id, type: 'approval', label: id, config: { approvers: [{ type: 'user', value: approver }] } });

/** Two approval steps: the second opens in the segment the first decision resumes. */
const TWO_STEP = {
  name: 'deal_two_step', label: 'Deal Two Step', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    step('mgr', 'u_mgr'),
    step('exec', 'u_exec'),
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mgr' },
    { id: 'e2', source: 'mgr', target: 'exec', label: 'approve' },
    { id: 'e3', source: 'mgr', target: 'no', label: 'reject' },
    { id: 'e4', source: 'exec', target: 'ok', label: 'approve' },
    { id: 'e5', source: 'exec', target: 'no', label: 'reject' },
  ],
};

/** Hosts the two steps in a `subflow` child: every request names the CHILD run. */
const PARENT = {
  name: 'deal_parent', label: 'Deal Parent', type: 'autolaunched',
  nodes: [
    { id: 'pstart', type: 'start', label: 'Start' },
    { id: 'sub', type: 'subflow', label: 'Approval', config: { flowName: 'deal_two_step' } },
    { id: 'pend', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'p1', source: 'pstart', target: 'sub' },
    { id: 'p2', source: 'sub', target: 'pend' },
  ],
};

describe('ADR-0162 item 7 — each request records its root run, in columns the store can be asked for', () => {
  let engine: ObjectQL;
  let store: InMemorySuspendedRunStore;
  let automation: AutomationEngine;
  let svc: ApprovalService;
  let now = Date.parse('2026-11-27T09:00:00.000Z');

  /** A fresh automation process over `store`: the engine, its built-ins, the approval node, the service wired to it. */
  function boot(surfaceOf: (a: AutomationEngine) => ApprovalAutomationSurface = (a) => a as any): AutomationEngine {
    const a = new AutomationEngine(silent, store);
    installBuiltinNodes(a, { logger: silent, getService() { throw new Error('none'); } } as any);
    registerApprovalNode(surfaceOf(a), svc, silent);
    a.registerFlow('deal_two_step', TWO_STEP as any);
    a.registerFlow('deal_parent', PARENT as any);
    svc.attachAutomation(a as any);
    return a;
  }

  const submit = async (flow: string, key: string): Promise<{ runId: string; request: any }> => {
    const record = { id: `D_${key}`, title: key, organization_id: ORG };
    await engine.insert('crm_deal', record, { context: SYSTEM } as any);
    const run = await automation.execute(flow, { object: 'crm_deal', record, userId: SUBMITTER } as any);
    expect(run.status, `${flow} on D_${key} paused on its first step`).toBe('paused');
    return { runId: run.runId!, request: await pendingOn(`D_${key}`) };
  };
  const pendingOn = async (recordId: string): Promise<any> => {
    const rows: any[] = await engine.find('sys_approval_request', {
      where: { record_id: recordId, status: 'pending' }, context: SYSTEM,
    } satisfies EngineQueryOptions);
    expect(rows.length, `at most one pending request on ${recordId}`).toBeLessThanOrEqual(1);
    return rows[0];
  };
  const byRootRun = async (rootRunId: string): Promise<any[]> =>
    engine.find('sys_approval_request', { where: { root_run_id: rootRunId }, context: SYSTEM } satisfies EngineQueryOptions);
  const isoOf = (value: unknown): string | null => (value == null ? null : new Date(value as string).toISOString());
  const approve = (req: any, decider: string) =>
    svc.decide(req.id, { decision: 'approve', actorId: decider }, asUser(decider));

  /** The shape a run parked before runs recorded their root run has. */
  async function forgetRootRuns(runIds: string[]): Promise<void> {
    for (const id of runIds) {
      const row = await store.load(id);
      expect((row!.context as any).$rootRun, `run '${id}' parked with a root run, before it is forgotten`).toBeDefined();
      delete (row!.context as any).$rootRun;
      await store.save(row!);
    }
  }

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, deal, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    for (const u of USERS) await engine.insert('sys_user', u, { context: SYSTEM } as any);
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(now += 1000) }, logger: silent });
    store = new InMemorySuspendedRunStore();
    automation = boot();
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('a root run\'s request records its own run, and the store answers by it', async () => {
    const { runId, request } = await submit('deal_two_step', 'root');
    const parked = await store.load(runId);

    expect(request.flow_run_id).toBe(runId);
    expect(request.root_run_id).toBe(runId);
    expect(isoOf(request.root_run_started_at)).toBe(parked!.startedAt);
    expect((await byRootRun(runId)).map(r => r.id)).toEqual([request.id]);
  });

  it('a subflow child\'s requests, both steps, record the parent, which `flow_run_id` does not name', async () => {
    const { runId: parentRunId, request: first } = await submit('deal_parent', 'child');
    const parentRow = await store.load(parentRunId);

    expect(first.flow_run_id).not.toBe(parentRunId);
    expect(first.root_run_id).toBe(parentRunId);
    expect(isoOf(first.root_run_started_at)).toBe(parentRow!.startedAt);

    await approve(first, 'u_mgr');
    const second = await pendingOn('D_child');
    expect([second.flow_node_id, second.flow_run_id]).toEqual(['exec', first.flow_run_id]);
    expect(second.root_run_id).toBe(parentRunId);
    expect((await byRootRun(parentRunId)).map(r => r.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('a child run started before the release, which opens a request after it, records its root run', async () => {
    const { runId: parentRunId, request: first } = await submit('deal_parent', 'before');
    const childRunId = first.flow_run_id as string;
    const parentRow = await store.load(parentRunId);
    // Before the release: neither run carries a root run, and the request it
    // opened records none.
    await forgetRootRuns([parentRunId, childRunId]);
    await engine.update('sys_approval_request', { id: first.id, root_run_id: null, root_run_started_at: null }, { context: SYSTEM } as any);

    // The release: a fresh process over the same store resumes the child.
    automation = boot();
    const out = await approve(first, 'u_mgr');
    expect([out.finalized, out.resumed]).toEqual([true, true]);

    const second = await pendingOn('D_before');
    expect([second.flow_node_id, second.flow_run_id]).toEqual(['exec', childRunId]);
    expect(second.root_run_id).toBe(parentRunId);
    expect(isoOf(second.root_run_started_at)).toBe(parentRow!.startedAt);
  });

  it('a child whose tree cannot be read whole opens no request: the step is refused and the run fails, saying why', async () => {
    const { runId: parentRunId, request: first } = await submit('deal_parent', 'orphan');
    const childRunId = first.flow_run_id as string;
    await forgetRootRuns([parentRunId, childRunId]);
    await store.delete(parentRunId);

    automation = boot();
    await approve(first, 'u_mgr').catch(() => undefined);

    expect(await pendingOn('D_orphan'), 'no second request opened').toBeUndefined();
    const requests: any[] = await engine.find('sys_approval_request', { where: { record_id: 'D_orphan' }, context: SYSTEM });
    expect(requests.map(r => r.flow_node_id)).toEqual(['mgr']);
    const child = await automation.getRun(childRunId);
    expect(child?.status).toBe('failed');
    expect(String(child?.error)).toContain("Approval node 'exec': the approval this step belongs to cannot be placed");
  });

  it('an automation service that hands no root run records none, as before', async () => {
    automation = boot((a) => ({
      registerNodeExecutor: (executor) => a.registerNodeExecutor(executor as any),
      resume: (runId, signal) => a.resume(runId, signal as any),
      flowKeyOfRun: (context) => a.flowKeyOfRun(context as any),
    }));
    const { runId, request } = await submit('deal_two_step', 'older_engine');

    expect(request.flow_run_id).toBe(runId);
    expect(request.root_run_id ?? null).toBeNull();
    expect(request.root_run_started_at ?? null).toBeNull();
  });
});
