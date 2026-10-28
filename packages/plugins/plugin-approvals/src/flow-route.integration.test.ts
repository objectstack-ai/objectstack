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
 *  - a decided request ends its route at itself, `decided`.
 *
 * ⚠️ Direction, predicted before running: every `flow_route` pin is RED on the
 * unfixed door (it served no such member); the `flow_steps` pins are green on
 * both sides on purpose: the trunk is served unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationEngine, registerLogicNodes } from '@objectstack/service-automation';
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
    // The gateways are `decision` nodes, built-ins a bare engine starts without.
    registerLogicNodes(automation, { logger: silent } as any);
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      logger: silent,
    });
    svc.attachAutomation(automation as any);
    registerApprovalNode(automation as any, svc, silent);
    automation.registerFlow(CONTRACT.name, CONTRACT as any);
    automation.registerFlow(LINEAR.name, LINEAR as any);
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

  it('a decided request ends its route at itself', async () => {
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
    });
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
