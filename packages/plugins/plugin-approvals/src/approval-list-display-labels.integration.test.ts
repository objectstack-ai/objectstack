// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23889] The approval lists show engine-written display values: the flow's
 * and the step's labels, whom a pending request waits on, the record an action
 * is about, and the slot an action was taken as.
 *
 * ## The contract
 *
 * The lists are generic list views over `sys_approval_request` and
 * `sys_approval_action`: they show stored columns and nothing else. So every
 * display value is a column the approval engine writes on the write that
 * changes the fact it describes, and a list never re-derives a label from flow
 * metadata or resolves an approver address itself:
 *
 *  - `process_label` / `current_step_label` — the flow's and the Approval
 *    node's authored labels, as the flow engine hands them to
 *    `openNodeRequest`, snapshotted at open;
 *  - `pending_approver_labels` — one label per slot of `pending_approvers`,
 *    written with the slate on every write that sets it and cleared with it;
 *  - on every action row, from its request: `step_label`, the pointer pair
 *    `object_name` + `record_id`, and `acted_as_label`.
 *
 * A slot that names a person (a user id, or an email an account carries) is
 * labelled with the account's name by the resolver the approvals door already
 * names `pending_approver_names` with; any other slot shows as its address.
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL), reading the stored rows
 * back as the system:
 *
 *  (a) open writes both labels and the waiting-on column, and the submit
 *      action carries the step label and the record pointer;
 *  (b) a partial tally rewrites the waiting-on column, each decision records
 *      the label of the slot it took (a person's name, a position's address),
 *      and the finalizing decision clears the column with the slate;
 *  (c) a reassign and the SLA sweep's reassign rewrite the waiting-on column;
 *  (d) an action on a request opened before the label columns copies the step
 *      label from that request's config snapshot;
 *  (e) read discipline: each name the waiting-on column holds is one the
 *      approvals door serves the same reader for the same request;
 *  (f) the declaration: the list views show the display columns in place of
 *      the machine ones, every column they name is a declared field, and the
 *      action's `record_id` is the id half of a pointer pair.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string, positions: string[] = []) =>
  ({ userId, positions, permissions: [] }) as any;

const USERS = [
  { id: 'u_sub', name: 'Sam Submitter', email: 'sam@example.com' },
  { id: 'u_legal', name: 'Lee Legal', email: 'lee@example.com' },
  { id: 'u_mail', name: 'Mia Mail', email: 'mail@example.com' },
  { id: 'u_alice', name: 'Alice', email: 'alice@example.com' },
  { id: 'u_bob', name: 'Bob', email: 'bob@example.com' },
  { id: 'u_boss', name: 'Boss', email: 'boss@example.com' },
];
const POSITION = 'position:legal';
const EMAIL = 'mail@example.com';
const FLOW_LABEL = 'Deal Review';
const NODE_LABEL = 'Legal sign-off';

const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    email: { name: 'email', label: 'Email', type: 'text' as const },
  },
};
const deal = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};
const FLOW = { name: 'deal_review', label: FLOW_LABEL, nodes: [{ id: 'review', type: 'approval', label: NODE_LABEL }], edges: [] };

async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

describe('#23889 — the approval lists read engine-written display columns', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-01T09:00:00.000Z');

  const requestRow = async (id: string) =>
    ((await engine.find('sys_approval_request', { where: { id }, limit: 1, context: SYSTEM } satisfies EngineQueryOptions)) as any[])[0];
  const actionsOf = async (requestId: string) =>
    ((await engine.find('sys_approval_action', {
      where: { request_id: requestId }, orderBy: [{ field: 'created_at', order: 'asc' }], context: SYSTEM,
    } satisfies EngineQueryOptions)) as any[]);
  const open = async (key: string, approvers: any[], extra: Record<string, unknown> = {}) => {
    await engine.insert('crm_deal', { id: `D_${key}`, title: key }, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object: 'crm_deal', recordId: `D_${key}`, runId: `run_${key}`, nodeId: 'review',
      flowName: FLOW.name, flowLabel: FLOW_LABEL, nodeLabel: NODE_LABEL,
      config: { approvers, behavior: 'first_response', ...extra } as any,
      submitterId: 'u_sub', record: { id: `D_${key}`, title: key },
    }, asUser('u_sub'));
    return row.id as string;
  };

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
    for (const u of USERS) await engine.insert('sys_user', u, { context: SYSTEM } as any);

    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      automation: {
        resume: async () => ({ status: 'completed' }),
        cancelRun: async () => undefined,
        getRun: async (runId: string) => ({ id: runId, status: 'paused' }),
        getFlow: async () => FLOW,
      } as any,
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('(a) open writes the flow and step labels and whom the request waits on; the submit action carries the step label and the record pointer', async () => {
    const id = await open('a', [
      { type: 'position', value: 'legal' }, { type: 'user', value: 'u_alice' }, { type: 'user', value: EMAIL },
    ], { behavior: 'unanimous' });

    const row = await requestRow(id);
    expect(row.process_name).toBe('flow:deal_review');
    expect(row.process_label).toBe(FLOW_LABEL);
    expect(row.current_step).toBe('review');
    expect(row.current_step_label).toBe(NODE_LABEL);
    expect(row.pending_approvers).toBe(`${POSITION},u_alice,${EMAIL}`);
    // A position nobody holds stays its address; a user id and an email an
    // account carries are labelled with the account's name.
    expect(row.pending_approver_labels).toBe(`${POSITION}, Alice, Mia Mail`);

    const [submit] = await actionsOf(id);
    expect(submit).toMatchObject({
      action: 'submit', step_name: 'review', step_label: NODE_LABEL,
      object_name: 'crm_deal', record_id: 'D_a', acted_as: null, acted_as_label: null,
    });
  });

  it('(b) a partial tally rewrites whom the request waits on, each decision labels the slot it took, and the final decision clears the column', async () => {
    const id = await open('b', [
      { type: 'position', value: 'legal' }, { type: 'user', value: 'u_alice' }, { type: 'user', value: EMAIL },
    ], { behavior: 'unanimous' });

    await svc.decideNode(id, { decision: 'approve' } as any, asUser('u_alice'));
    expect((await requestRow(id)).pending_approver_labels).toBe(`${POSITION}, Mia Mail`);

    await svc.decideNode(id, { decision: 'approve', actorId: EMAIL } as any, asUser('u_mail'));
    expect((await requestRow(id)).pending_approver_labels).toBe(POSITION);

    await svc.decideNode(id, { decision: 'approve', actorId: POSITION } as any, asUser('u_legal', ['legal']));
    const done = await requestRow(id);
    expect(done.status).toBe('approved');
    expect(done.pending_approvers).toBeNull();
    expect(done.pending_approver_labels).toBeNull();

    const decisions = (await actionsOf(id)).filter((a) => a.action === 'approve');
    expect(decisions.map((a) => [a.acted_as, a.acted_as_label])).toEqual([
      ['u_alice', 'Alice'],
      [EMAIL, 'Mia Mail'],
      [POSITION, POSITION],
    ]);
    for (const a of decisions) {
      expect(a).toMatchObject({ step_label: NODE_LABEL, object_name: 'crm_deal', record_id: 'D_b' });
    }
  });

  it('(c) a reassign and the SLA sweep\'s reassign rewrite whom the request waits on', async () => {
    const id = await open('c', [{ type: 'user', value: 'u_alice' }]);
    await svc.reassign(id, { actorId: 'u_alice', to: 'u_bob' }, asUser('u_alice'));
    expect((await requestRow(id)).pending_approver_labels).toBe('Bob');
    const reassign = (await actionsOf(id)).find((a) => a.action === 'reassign');
    expect(reassign).toMatchObject({ step_label: NODE_LABEL, object_name: 'crm_deal', record_id: 'D_c' });

    const sla = await open('c_sla', [{ type: 'user', value: 'u_alice' }],
      { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'u_boss', notifySubmitter: false } });
    now += 2 * 3600_000;
    await svc.runEscalations();
    const escalated = await requestRow(sla);
    expect(escalated.pending_approvers).toBe('u_boss');
    expect(escalated.pending_approver_labels).toBe('Boss');
    expect((await actionsOf(sla)).find((a) => a.action === 'escalate')).toMatchObject({
      step_label: NODE_LABEL, object_name: 'crm_deal', record_id: 'D_c_sla', acted_as_label: null,
    });
  });

  it('(d) an action on a request opened before the label columns copies the step label from its config snapshot', async () => {
    await engine.insert('crm_deal', { id: 'D_d', title: 'd' }, { context: SYSTEM } as any);
    const stamp = new Date(now += 1000).toISOString();
    // The row as an earlier writer left it: labels only on the snapshot.
    await engine.insert('sys_approval_request', {
      id: 'areq_legacy', process_name: 'flow:deal_review', object_name: 'crm_deal', record_id: 'D_d',
      submitter_id: 'u_sub', status: 'pending', current_step: 'review', current_step_index: 0,
      pending_approvers: 'u_alice', flow_run_id: 'run_d', flow_node_id: 'review',
      node_config_json: JSON.stringify({
        approvers: [{ type: 'user', value: 'u_alice' }], behavior: 'first_response',
        __flowLabel: FLOW_LABEL, __nodeLabel: 'Old label',
      }),
      created_at: stamp, updated_at: stamp,
    }, { context: SYSTEM } as any);

    await svc.comment('areq_legacy', { actorId: 'u_alice', comment: 'looking' }, asUser('u_alice'));
    const comment = (await actionsOf('areq_legacy')).find((a) => a.action === 'comment');
    expect(comment).toMatchObject({
      step_label: 'Old label', object_name: 'crm_deal', record_id: 'D_d', acted_as: 'u_alice', acted_as_label: 'Alice',
    });
    // The row itself is not rewritten by a thread entry: it gains its waiting-on
    // column on its next slate write.
    expect((await requestRow('areq_legacy')).pending_approver_labels).toBeNull();
  });

  it('(e) every name the waiting-on column holds is one the approvals door serves the same reader for the same request', async () => {
    const id = await open('e', [
      { type: 'position', value: 'legal' }, { type: 'user', value: 'u_alice' }, { type: 'user', value: EMAIL },
    ], { behavior: 'unanimous' });
    const reader = asUser('u_alice');
    const served: any = await svc.getRequest(id, reader);
    expect(served).not.toBeNull();
    const servedNames = new Set(Object.values(served.pending_approver_names ?? {}));
    const slots = new Set(served.pending_approvers);
    const labels = String((await requestRow(id)).pending_approver_labels).split(', ');
    expect(labels).toHaveLength(slots.size);
    for (const label of labels) {
      expect(servedNames.has(label) || slots.has(label)).toBe(true);
    }
  });

  it('(f) the list views show the display columns in place of the machine ones, and every column is a declared field', () => {
    const req: any = SysApprovalRequest;
    const act: any = SysApprovalAction;

    for (const [name, view] of Object.entries<any>(req.listViews)) {
      expect(view.columns, name).toContain('process_label');
      expect(view.columns, name).not.toContain('process_name');
      expect(view.columns, name).not.toContain('current_step');
      for (const col of view.columns) expect(req.fields[col], `${name}.${col}`).toBeDefined();
    }
    for (const name of ['all_requests', 'my_pending', 'submitted_by_me']) {
      expect(req.listViews[name].columns, name).toContain('current_step_label');
    }
    for (const name of ['all_requests', 'my_pending']) {
      expect(req.listViews[name].columns, name).toContain('pending_approver_labels');
    }

    for (const [name, view] of Object.entries<any>(act.listViews)) {
      expect(view.columns, name).toContain('step_label');
      expect(view.columns, name).not.toContain('step_name');
      for (const col of view.columns) expect(act.fields[col], `${name}.${col}`).toBeDefined();
    }
    for (const name of ['recent', 'all_actions']) {
      // The pointer shows as its id half; the type half is fetched for that
      // cell, never shown as a column (`sys-approval-request-pointer-pair.test.ts`).
      expect(act.listViews[name].columns, name).toEqual(expect.arrayContaining(['record_id', 'acted_as_label']));
      expect(act.listViews[name].columns, name).not.toContain('object_name');
      expect(act.listViews[name].columns, name).not.toContain('acted_as');
    }
    expect(act.fields.record_id.referenceVia).toBe('object_name');
  });
});
