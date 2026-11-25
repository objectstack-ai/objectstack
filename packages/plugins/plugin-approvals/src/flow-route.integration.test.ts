// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26668] The approvals get serves a request's own route, `flow_route`.
 *
 * ## The defect
 *
 * The single request read served one step list, `flow_steps`, built by walking
 * the flow from its start and taking the `approve` edge, else the `true` edge,
 * else the first edge. That is the flow's trunk, not the route the request
 * takes. A contract the gateway routed from the manager to the finance-only
 * rung (#26563, hotclm's `contract_approval`) was served the manager, the
 * joint legal + finance rung, the executive and the general manager, every one
 * `upcoming`, and its own rung was absent. The record panel and the request
 * page could only stop drawing the line.
 *
 * ## The rig
 *
 * A real `ObjectQL` over `SqlDriver` (better-sqlite3, in-memory, real DDL), the
 * real `AutomationEngine` with the built-in logic nodes, so the gateway is a
 * real `decision` node, and the real `ApprovalService` behind the real approval
 * node. Every request is opened by the engine and every decision resumes the
 * run, so the history the route reads is the history a deployment writes. The
 * clock ticks one second per read, so the run's requests open in order.
 *
 * ## What it pins
 *
 *  - off the trunk: the finance-only request is served the manager `done` and
 *    itself `current`, and the route stops `undecided` at the next gateway,
 *    with none of the trunk's rungs past it; `flow_steps` is served as before;
 *  - on a linear flow, a request on the trunk is served a route equal to its
 *    `flow_steps` at every step, ending `end`;
 *  - a gateway right after the current step is served `undecided`, never the
 *    trunk's branch, and a gateway ahead of a step the graph decides lets that
 *    step through;
 *  - a decided request ends its route at itself, `decided`;
 *  - [#35863] and carries `outcome`: a later request pending (step 2 of a
 *    two-step route), the approval ended with a later step's decision, or
 *    ended at the request itself; a pending request carries none; an
 *    approval inside a subflow is never served its child run's end, nor is a
 *    request whose snapshot does not say its run is a root run.
 *
 * ⚠️ Direction, predicted before running: every `flow_route` pin is RED on the
 * unfixed door (it served no such member); the `flow_steps` pins are green on
 * both sides on purpose: the trunk is served unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationEngine, installBuiltinNodes } from '@objectstack/service-automation';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { registerApprovalNode } from './approval-node.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

const SUBMITTER = 'u_sub';
const USERS = ['u_sub', 'u_mgr', 'u_legal', 'u_fin', 'u_exec', 'u_gm', 'u_dir'].map((id) => ({
  id, name: id, email: `${id}@example.com`,
}));

const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    email: { name: 'email', label: 'Email', type: 'text' as const },
  },
};
const contract = {
  name: 'crm_contract',
  label: 'Contract',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    amount: { name: 'amount', label: 'Amount', type: 'number' as const },
    route_legal: { name: 'route_legal', label: 'Route Legal', type: 'boolean' as const },
    route_finance: { name: 'route_finance', label: 'Route Finance', type: 'boolean' as const },
  },
};

/** The plugin's own object definitions, as its manifest registers them. */
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

const step = (id: string, label: string, approver: string) =>
  ({ id, type: 'approval', label, config: { approvers: [{ type: 'user', value: approver }] } });

/**
 * hotclm's `contract_approval` shape (#26563): the manager, then a gateway to
 * the joint legal + finance rung, legal only, finance only, or none; then an
 * executive above 500000; then the general manager above 1000000. The trunk
 * takes every gateway's first (`true`) branch.
 */
const CONTRACT = {
  name: 'contract_approval', label: 'Contract Approval', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    step('manager_review', 'Manager', 'u_mgr'),
    { id: 'route', type: 'decision', label: 'Who reviews?' },
    step('legal_finance_joint', 'Legal + Finance', 'u_legal'),
    step('legal_only', 'Legal', 'u_legal'),
    step('finance_only', 'Finance', 'u_fin'),
    { id: 'exec_gate', type: 'decision', label: 'Above 500000?' },
    step('executive_signoff', 'Executive', 'u_exec'),
    { id: 'gm_gate', type: 'decision', label: 'Above 1000000?' },
    step('gm_signoff', 'General Manager', 'u_gm'),
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'manager_review' },
    { id: 'e2', source: 'manager_review', target: 'route', label: 'approve' },
    { id: 'e3', source: 'manager_review', target: 'no', label: 'reject' },
    { id: 'r1', source: 'route', target: 'legal_finance_joint', label: 'true', condition: 'record.route_legal == true && record.route_finance == true' },
    { id: 'r2', source: 'route', target: 'legal_only', label: 'legal', condition: 'record.route_legal == true && record.route_finance == false' },
    { id: 'r3', source: 'route', target: 'finance_only', label: 'finance', condition: 'record.route_legal == false && record.route_finance == true' },
    { id: 'r4', source: 'route', target: 'exec_gate', label: 'none', isDefault: true },
    { id: 'j1', source: 'legal_finance_joint', target: 'exec_gate', label: 'approve' },
    { id: 'j2', source: 'legal_finance_joint', target: 'no', label: 'reject' },
    { id: 'l1', source: 'legal_only', target: 'exec_gate', label: 'approve' },
    { id: 'l2', source: 'legal_only', target: 'no', label: 'reject' },
    { id: 'f1', source: 'finance_only', target: 'exec_gate', label: 'approve' },
    { id: 'f2', source: 'finance_only', target: 'no', label: 'reject' },
    { id: 'x1', source: 'exec_gate', target: 'executive_signoff', label: 'true', condition: 'record.amount > 500000' },
    { id: 'x2', source: 'exec_gate', target: 'gm_gate', label: 'false', isDefault: true },
    { id: 'x3', source: 'executive_signoff', target: 'gm_gate', label: 'approve' },
    { id: 'x4', source: 'executive_signoff', target: 'no', label: 'reject' },
    { id: 'g1', source: 'gm_gate', target: 'gm_signoff', label: 'true', condition: 'record.amount > 1000000' },
    { id: 'g2', source: 'gm_gate', target: 'ok', label: 'false', isDefault: true },
    { id: 'g3', source: 'gm_signoff', target: 'ok', label: 'approve' },
    { id: 'g4', source: 'gm_signoff', target: 'no', label: 'reject' },
  ],
};

/** No gateway: three steps one after another, the trunk is the route. */
const LINEAR = {
  name: 'contract_linear', label: 'Contract Linear', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    step('manager_review', 'Manager', 'u_mgr'),
    step('director_review', 'Director', 'u_dir'),
    step('gm_signoff', 'General Manager', 'u_gm'),
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'manager_review' },
    { id: 'e2', source: 'manager_review', target: 'director_review', label: 'approve' },
    { id: 'e3', source: 'manager_review', target: 'no', label: 'reject' },
    { id: 'e4', source: 'director_review', target: 'gm_signoff', label: 'approve' },
    { id: 'e5', source: 'director_review', target: 'no', label: 'reject' },
    { id: 'e6', source: 'gm_signoff', target: 'ok', label: 'approve' },
    { id: 'e7', source: 'gm_signoff', target: 'no', label: 'reject' },
  ],
};

/** [#35863] One approval, run as another flow's `subflow` body: a child run. */
const CHILD = {
  name: 'contract_child', label: 'Contract Child', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    step('legal_review', 'Legal', 'u_legal'),
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'c1', source: 'start', target: 'legal_review' },
    { id: 'c2', source: 'legal_review', target: 'ok', label: 'approve' },
    { id: 'c3', source: 'legal_review', target: 'no', label: 'reject' },
  ],
};

/** [#35863] The legal step in a child run, then the general manager in the root run. */
const HOSTED = {
  name: 'contract_hosted', label: 'Contract Hosted', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'legal', type: 'subflow', label: 'Legal subflow', config: { flowName: CHILD.name } },
    step('gm_signoff', 'General Manager', 'u_gm'),
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'h1', source: 'start', target: 'legal' },
    { id: 'h2', source: 'legal', target: 'gm_signoff' },
    { id: 'h3', source: 'gm_signoff', target: 'ok', label: 'approve' },
    { id: 'h4', source: 'gm_signoff', target: 'no', label: 'reject' },
  ],
};

/** [#35863] The manager in the root run, then the legal step in a child run, then the end. */
const REVIEWED_THEN_LEGAL = {
  name: 'contract_reviewed_then_legal', label: 'Contract Reviewed Then Legal', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    step('manager_review', 'Manager', 'u_mgr'),
    { id: 'legal', type: 'subflow', label: 'Legal subflow', config: { flowName: CHILD.name } },
    { id: 'done', type: 'end', label: 'Done' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'r1', source: 'start', target: 'manager_review' },
    { id: 'r2', source: 'manager_review', target: 'legal', label: 'approve' },
    { id: 'r3', source: 'manager_review', target: 'no', label: 'reject' },
    { id: 'r4', source: 'legal', target: 'done' },
  ],
};

/** What `flow_steps` serves for every `contract_approval` request: its trunk. */
const CONTRACT_TRUNK = ['manager_review', 'legal_finance_joint', 'executive_signoff', 'gm_signoff'];

describe('[#26668] the approvals get serves the route a request takes, not the flow\'s trunk', () => {
  let engine: ObjectQL;
  let automation: AutomationEngine;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-27T09:00:00.000Z');
  let seq = 0;

  /** Start `flow` on a fresh contract; answer the request it paused on. */
  const submit = async (flow: string, fields: Record<string, unknown>): Promise<any> => {
    const record = { id: `C_${++seq}`, title: `Contract ${seq}`, amount: 100, route_legal: false, route_finance: false, ...fields };
    await engine.insert('crm_contract', record, { context: SYSTEM } as any);
    const run = await automation.execute(flow, { object: 'crm_contract', record, userId: SUBMITTER } as any);
    expect(run.status, `${flow} paused on its first step`).toBe('paused');
    return pendingOn(record.id);
  };
  /** The one pending request on a contract, or `undefined`. */
  const pendingOn = async (recordId: string): Promise<any> => {
    const rows: any[] = await engine.find('sys_approval_request', {
      where: { record_id: recordId, status: 'pending' }, context: SYSTEM,
    } satisfies EngineQueryOptions);
    expect(rows.length, `at most one pending request on ${recordId}`).toBeLessThanOrEqual(1);
    return rows[0];
  };
  /** `decider` approves `req`; answer the request the run paused on next. */
  const approve = async (req: any, decider: string): Promise<any> => {
    const out = await svc.decide(req.id, { decision: 'approve', actorId: decider }, asUser(decider));
    expect([out.finalized, out.resumed], `${decider} approved ${req.flow_node_id}`).toEqual([true, true]);
    return pendingOn(req.record_id);
  };
  /** `decider` rejects `req`; the run walks the `reject` edge to its end. */
  const reject = async (req: any, decider: string): Promise<void> => {
    const out = await svc.decide(req.id, { decision: 'reject', actorId: decider, comment: 'Not this quarter' }, asUser(decider));
    expect([out.finalized, out.resumed], `${decider} rejected ${req.flow_node_id}`).toEqual([true, true]);
    expect(await pendingOn(req.record_id), 'nothing pending after the rejection').toBeUndefined();
  };
  /** The get, as the submitter reads it. */
  const get = async (req: any): Promise<any> => svc.getRequest(req.id, asUser(SUBMITTER));
  const states = (steps: any[] | undefined) => (steps ?? []).map((s) => [s.id, s.state]);

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, contract, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-route-test', 'approvals-route-test');
    }
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    for (const u of USERS) await engine.insert('sys_user', u, { context: SYSTEM } as any);

    automation = new AutomationEngine(silent);
    // The gateways are `decision` nodes and the hosted case a `subflow`, built-ins
    // a bare engine starts without.
    installBuiltinNodes(automation, { logger: silent, getService() { throw new Error('none'); } } as any);
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      logger: silent,
    });
    svc.attachAutomation(automation as any);
    registerApprovalNode(automation as any, svc, silent);
    automation.registerFlow(CONTRACT.name, CONTRACT as any);
    automation.registerFlow(LINEAR.name, LINEAR as any);
    automation.registerFlow(CHILD.name, CHILD as any);
    automation.registerFlow(HOSTED.name, HOSTED as any);
    automation.registerFlow(REVIEWED_THEN_LEGAL.name, REVIEWED_THEN_LEGAL as any);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the reported route, manager → finance only: the passed step and the current one, undecided past it', async () => {
    const manager = await submit(CONTRACT.name, { amount: 250000, route_finance: true });
    const finance = await approve(manager, 'u_mgr');
    expect(finance?.flow_node_id, 'the gateway sent the run to the finance-only rung').toBe('finance_only');

    const row = await get(finance);
    // The defect, as measured: the trunk names every rung but this one, all upcoming.
    expect(states(row.flow_steps)).toEqual(CONTRACT_TRUNK.map((id) => [id, 'upcoming']));
    expect(row.flow_route).toEqual({
      steps: [
        { id: 'manager_review', label: 'Manager', state: 'done' },
        { id: 'finance_only', label: 'Finance', state: 'current' },
      ],
      ahead: 'undecided',
    });
  });

  it('at the first step, a gateway right after it is served undecided, never the trunk\'s branch', async () => {
    const manager = await submit(CONTRACT.name, { amount: 250000, route_finance: true });
    const row = await get(manager);
    expect(states(row.flow_steps)).toEqual(CONTRACT_TRUNK.map((id, i) => [id, i === 0 ? 'current' : 'upcoming']));
    expect(row.flow_route).toEqual({
      steps: [{ id: 'manager_review', label: 'Manager', state: 'current' }],
      ahead: 'undecided',
    });
  });

  it('a branch that rejoins the trunk: legal only, then the executive above 500000', async () => {
    const manager = await submit(CONTRACT.name, { amount: 750000, route_legal: true });
    const legal = await approve(manager, 'u_mgr');
    expect(legal?.flow_node_id).toBe('legal_only');
    const executive = await approve(legal, 'u_legal');
    expect(executive?.flow_node_id).toBe('executive_signoff');

    const row = await get(executive);
    // The trunk shows its own branch, the joint rung, as passed: a rung this run never visited.
    expect(states(row.flow_steps)).toEqual([
      ['manager_review', 'done'], ['legal_finance_joint', 'done'], ['executive_signoff', 'current'], ['gm_signoff', 'upcoming'],
    ]);
    expect(states(row.flow_route.steps)).toEqual([
      ['manager_review', 'done'], ['legal_only', 'done'], ['executive_signoff', 'current'],
    ]);
    expect(row.flow_route.ahead).toBe('undecided');
  });

  it('a decided request ends its route at itself; at the last step, the outcome says the approval ended', async () => {
    const manager = await submit(CONTRACT.name, { amount: 250000, route_finance: true });
    const finance = await approve(manager, 'u_mgr');
    await approve(finance, 'u_fin');

    const row = await get(finance);
    expect(row.status).toBe('approved');
    expect(row.flow_route).toEqual({
      steps: [
        { id: 'manager_review', label: 'Manager', state: 'done' },
        { id: 'finance_only', label: 'Finance', state: 'done' },
      ],
      ahead: 'decided',
      // [#35863] Both gateways past the finance rung fall through to the end: no later request.
      outcome: { status: 'approved', ended: true },
    });
  });

  it('[#35863] a request decided at step 1 of a two-step route: the outcome says step 2 is pending, then that the approval ended there', async () => {
    const manager = await submit(CONTRACT.name, { amount: 250000, route_finance: true });
    const finance = await approve(manager, 'u_mgr');

    const before = await get(manager);
    expect(before.flow_route).toEqual({
      steps: [{ id: 'manager_review', label: 'Manager', state: 'done' }],
      ahead: 'decided',
      outcome: { step: { id: 'finance_only', label: 'Finance' }, status: 'pending', ended: false },
    });

    await reject(finance, 'u_fin');
    const after = await get(manager);
    expect(after.flow_route.outcome).toEqual({ step: { id: 'finance_only', label: 'Finance' }, status: 'rejected', ended: true });
  });

  it('[#35863] a request rejected at the first step: the outcome says the approval ended there, rejected', async () => {
    const manager = await submit(CONTRACT.name, { amount: 250000, route_finance: true });
    await reject(manager, 'u_mgr');

    const row = await get(manager);
    expect(row.flow_route).toEqual({
      steps: [{ id: 'manager_review', label: 'Manager', state: 'current' }],
      ahead: 'decided',
      outcome: { status: 'rejected', ended: true },
    });
  });

  it('[#35863] an approval inside a subflow: its child run\'s end is not served as the end of the record\'s approval', async () => {
    const legal = await submit(HOSTED.name, {});
    expect(legal?.flow_node_id).toBe('legal_review');
    expect(legal.flow_run_id, 'the legal step runs in a child run').toBeTruthy();
    const gm = await approve(legal, 'u_legal');
    // The child run completed; the root run went on to the general manager under its own run id.
    expect(gm?.flow_node_id).toBe('gm_signoff');
    expect(gm.flow_run_id).not.toBe(legal.flow_run_id);
    expect((await automation.getRun(legal.flow_run_id))?.status, 'the child run itself has ended').toBe('completed');

    const row = await get(legal);
    expect(row.status).toBe('approved');
    expect(row.flow_route.ahead).toBe('decided');
    // Nothing later in the child run, and the child's end is not the approval's: no outcome.
    expect('outcome' in row.flow_route).toBe(false);

    // The root run's own last request: the run completed, but its flow starts a child run, whose
    // requests are not among this run's rows, so the approval is not known to have ended here.
    await approve(gm, 'u_gm');
    expect((await automation.getRun(gm.flow_run_id))?.status, 'the root run itself has ended').toBe('completed');
    expect('outcome' in (await get(gm)).flow_route).toBe(false);
  });

  it('[#35863] a later step in a child run: the root run\'s end is not served as "ended here" for the request before it', async () => {
    const manager = await submit(REVIEWED_THEN_LEGAL.name, {});
    expect(manager?.flow_node_id).toBe('manager_review');
    const legal = await approve(manager, 'u_mgr');
    expect(legal?.flow_node_id).toBe('legal_review');
    expect(legal.flow_run_id, 'the legal step runs in a child run').not.toBe(manager.flow_run_id);

    // Legal rejects; the child run ends and the root run walks on to its end.
    await reject(legal, 'u_legal');
    expect((await automation.getRun(manager.flow_run_id))?.status, 'the root run has ended').toBe('completed');

    // The root run's rows hold only the manager's request. "The approval ended here, approved"
    // would be wrong twice: it went on to legal, and legal's rejection was the last decision.
    const row = await get(manager);
    expect(row.status).toBe('approved');
    expect(row.flow_route).toEqual({
      steps: [{ id: 'manager_review', label: 'Manager', state: 'done' }],
      ahead: 'decided',
    });
  });

  it('[#35863] a flow edited after the run is not judged by the edit: the run\'s own body hosted a subflow', async () => {
    // The run's body: the manager, then legal in a child run. Registered under its own name so the edit below touches no other pin.
    const name = 'contract_edited_after_run';
    automation.registerFlow(name, { ...REVIEWED_THEN_LEGAL, name } as any);
    await new Promise((r) => setTimeout(r, 5)); // registered strictly before the run starts
    const manager = await submit(name, {});
    const legal = await approve(manager, 'u_mgr');
    expect(legal.flow_run_id, 'the legal step runs in a child run').not.toBe(manager.flow_run_id);
    await reject(legal, 'u_legal');
    expect((await automation.getRun(manager.flow_run_id))?.status, 'the root run has ended').toBe('completed');
    expect('outcome' in (await get(manager)).flow_route).toBe(false);

    // The flow is edited to drop its subflow, under the SAME version number: the body armed now hosts no child run.
    const { nodes, edges } = REVIEWED_THEN_LEGAL;
    automation.registerFlow(name, {
      ...REVIEWED_THEN_LEGAL, name,
      nodes: nodes.filter((n) => n.id !== 'legal'),
      edges: [...edges.filter((e) => e.source !== 'legal' && e.target !== 'legal'), { id: 'r5', source: 'manager_review', target: 'done', label: 'approve' }],
    } as any);
    // Still no outcome: the run ran the body with the subflow, and legal's rejection was the last decision.
    const row = await get(manager);
    expect(row.flow_route).toEqual({ steps: [{ id: 'manager_review', label: 'Manager', state: 'done' }], ahead: 'decided' });

    // A run started on the edited body does end at the manager: "ended" is judged by the body a run ran.
    await new Promise((r) => setTimeout(r, 5));
    const next = await submit(name, {});
    await approve(next, 'u_mgr');
    expect((await get(next)).flow_route.outcome).toEqual({ status: 'approved', ended: true });
  });

  it('[#35863] a rollback re-arms an older body: a run of the newer one is not judged by it', async () => {
    const name = 'contract_rolled_back';
    const { nodes, edges } = REVIEWED_THEN_LEGAL;
    // Version 1 has no subflow; version 2, the one the run runs, adds legal in a child run.
    automation.registerFlow(name, {
      ...REVIEWED_THEN_LEGAL, name, version: 1,
      nodes: nodes.filter((n) => n.id !== 'legal'),
      edges: [...edges.filter((e) => e.source !== 'legal' && e.target !== 'legal'), { id: 'r5', source: 'manager_review', target: 'done', label: 'approve' }],
    } as any);
    automation.registerFlow(name, { ...REVIEWED_THEN_LEGAL, name, version: 2 } as any);
    await new Promise((r) => setTimeout(r, 5));
    const manager = await submit(name, {});
    const legal = await approve(manager, 'u_mgr');
    await reject(legal, 'u_legal');
    expect((await automation.getRun(manager.flow_run_id))?.status, 'the root run has ended').toBe('completed');

    // Version 1 armed again: a body with no subflow, registered before the run started, but not the body it ran.
    automation.rollbackFlow(name, 1);
    expect('outcome' in (await get(manager)).flow_route).toBe(false);
  });

  it('[#35863] a request whose snapshot does not say its run is a root run is never served "ended"', async () => {
    const manager = await submit(LINEAR.name, {});
    const director = await approve(manager, 'u_mgr');
    const gm = await approve(director, 'u_dir');
    await approve(gm, 'u_gm');
    expect((await get(gm)).flow_route.outcome).toEqual({ status: 'approved', ended: true });

    // As a request opened before the stamp reads: the run ended, but it is not known to be the root run.
    const [stored]: any[] = await engine.find('sys_approval_request', { where: { id: gm.id }, context: SYSTEM } satisfies EngineQueryOptions);
    const cfg = JSON.parse(stored.node_config_json);
    expect(cfg.__runRoot, 'the approval node stamps a root run').toBe(true);
    delete cfg.__runRoot;
    await engine.update('sys_approval_request', { id: gm.id, node_config_json: JSON.stringify(cfg) }, { context: SYSTEM } as any);
    expect('outcome' in (await get(gm)).flow_route).toBe(false);
    // An earlier request of the same run keeps its own stamp: it still says the approval went on and ended.
    expect((await get(manager)).flow_route.outcome).toEqual({ step: { id: 'gm_signoff', label: 'General Manager' }, status: 'approved', ended: true });
  });

  it('[#35863] a pending request is never served an outcome', async () => {
    const manager = await submit(CONTRACT.name, { amount: 250000, route_finance: true });
    const row = await get(manager);
    expect('outcome' in row.flow_route).toBe(false);
  });

  it('on a linear flow the trunk is the route: at every step the route equals flow_steps, ending at the flow\'s end', async () => {
    let req = await submit(LINEAR.name, {});
    for (const [node, decider] of [['manager_review', 'u_mgr'], ['director_review', 'u_dir'], ['gm_signoff', 'u_gm']] as const) {
      expect(req?.flow_node_id).toBe(node);
      const row = await get(req);
      expect(row.flow_route.steps, `at ${node}`).toEqual(row.flow_steps);
      expect(row.flow_route.ahead, `at ${node}`).toBe('end');
      if (node !== 'gm_signoff') req = await approve(req, decider);
    }
  });

  it('the list read serves no route, as it serves no flow_steps', async () => {
    const manager = await submit(CONTRACT.name, { amount: 250000, route_finance: true });
    const rows = await svc.listRequests({ object: 'crm_contract', recordId: manager.record_id }, asUser(SUBMITTER));
    expect(rows.map((r: any) => [r.id, 'flow_route' in r, 'flow_steps' in r])).toEqual([[manager.id, false, false]]);
  });
});
