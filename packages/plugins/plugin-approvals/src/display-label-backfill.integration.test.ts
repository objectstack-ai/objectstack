// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23889] The boot-time fill of the approval lists' display columns on rows
 * written before those columns existed (`display-label-backfill.ts`), and the
 * two riders that keep a stored label honest.
 *
 * ## What this pins
 *
 * Driven on a real `ObjectQL` over `SqlDriver` (better-sqlite3, in-memory, real
 * DDL). The rows are seeded as an 18.0.0-next.2 writer left them: the labels
 * only in `node_config_json`, no display column, actions without a pointer.
 *
 *  (a) ONE BOOT — `ApprovalsServicePlugin.start()` then `kernel:ready`, the
 *      production wiring — fills every display column: a terminal request and
 *      a pending one, the flow and step labels by the chain the approvals door
 *      serves (snapshot label, else the humanized machine name, so the two
 *      doors agree), the waiting-on column of the pending one, and on every
 *      action the step label, the record pointer and the acting-as label;
 *  (b) a SECOND boot writes nothing;
 *  (c) null-only: a column a live writer already filled is never overwritten,
 *      and an action whose request no longer exists keeps a null pointer and
 *      takes its own humanized step name;
 *  (d) a failed `sys_user` read stores no label — never the raw address — says
 *      so once at `warn`, and the next run fills it; a non-person slot keeps its
 *      address by design;
 *  (e) the action-slot backfill labels every `acted_as` it writes;
 *  (f) an empty authored label is stored as the humanized machine name, never
 *      `''`, at open.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService, slotLabelSourceOf } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { backfillApprovalDisplayLabels } from './display-label-backfill.js';
import { backfillActionSlots } from './action-slot-backfill.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const STAMP = '2026-09-01T09:00:00.000Z';

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

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** A request row exactly as the previous release wrote it, keyed `areq_<key>`. */
function legacyRequest(id: string, extra: Record<string, unknown>) {
  return {
    id: `areq_${id}`, process_name: 'flow:deal_review', object_name: 'crm_deal', record_id: `D_${id}`,
    submitter_id: 'u_sub', current_step: 'manager_review', current_step_index: 0,
    flow_run_id: `run_${id}`, flow_node_id: 'manager_review', created_at: STAMP, updated_at: STAMP,
    ...extra,
  };
}

function legacyAction(id: string, requestId: string, extra: Record<string, unknown>) {
  return {
    id, request_id: requestId, step_name: 'manager_review', step_index: 0, created_at: STAMP, ...extra,
  };
}

/** One plugin boot on `engine`: `start()`, then `kernel:ready`, as the kernel runs it. */
async function boot(engine: ObjectQL): Promise<{ warn: string[] }> {
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const warn: string[] = [];
  const ctx: any = {
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
    getService: (name: string) => {
      if (name === 'objectql') return engine;
      throw new Error(`no service '${name}'`);
    },
    registerService: () => {},
    logger: { ...quiet, warn: (msg: string) => { warn.push(String(msg)); } },
  };
  await new ApprovalsServicePlugin({ disableAutoHooks: true }).start(ctx);
  for (const fn of hooks['kernel:ready'] ?? []) await fn();
  return { warn };
}

describe('#23889 — the boot-time display-label backfill', () => {
  let engine: ObjectQL;

  const row = async (object: string, id: string) =>
    ((await engine.find(object, { where: { id }, limit: 1, context: SYSTEM } satisfies EngineQueryOptions)) as any[])[0];

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, deal, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    for (const u of [
      { id: 'u_sub', name: 'Sam Submitter', email: 'sam@example.com' },
      { id: 'u_alice', name: 'Alice', email: 'alice@example.com' },
      { id: 'u_mail', name: 'Mia Mail', email: 'mail@example.com' },
    ]) await engine.insert('sys_user', u, { context: SYSTEM } as any);

    // A terminal request whose snapshot carries the authored labels.
    await engine.insert('sys_approval_request', legacyRequest('done', {
      status: 'approved', pending_approvers: null, completed_at: STAMP,
      node_config_json: JSON.stringify({ approvers: [], __flowLabel: 'Deal Review', __nodeLabel: 'Legal sign-off' }),
    }), { context: SYSTEM } as any);
    // A pending request written before labels were captured at all.
    await engine.insert('sys_approval_request', legacyRequest('open', {
      status: 'pending', pending_approvers: 'u_alice,position:legal',
      node_config_json: JSON.stringify({ approvers: [] }),
    }), { context: SYSTEM } as any);
    await engine.insert('sys_approval_action', legacyAction('a_submit', 'areq_done', { action: 'submit', actor_id: 'u_sub' }), { context: SYSTEM } as any);
    await engine.insert('sys_approval_action', legacyAction('a_vote', 'areq_done', {
      action: 'approve', actor_id: 'u_alice', acted_as: 'u_alice',
    }), { context: SYSTEM } as any);
    await engine.insert('sys_approval_action', legacyAction('a_thread', 'areq_open', {
      action: 'comment', actor_id: null, acted_as: 'position:legal',
    }), { context: SYSTEM } as any);
    // A request id that no longer resolves.
    await engine.insert('sys_approval_action', legacyAction('a_orphan', 'areq_gone', {
      action: 'comment', step_name: 'final_check', actor_id: null,
    }), { context: SYSTEM } as any);
  });

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('(a) one boot fills every display column on terminal and pending requests and on their actions', async () => {
    await boot(engine);

    expect(await row('sys_approval_request', 'areq_done')).toMatchObject({
      process_label: 'Deal Review', current_step_label: 'Legal sign-off', pending_approver_labels: null,
    });
    expect(await row('sys_approval_request', 'areq_open')).toMatchObject({
      // No snapshot label: the humanized machine name, as the approvals door serves it.
      process_label: 'Deal Review', current_step_label: 'Manager Review',
      pending_approver_labels: 'Alice, position:legal',
    });
    expect(await row('sys_approval_action', 'a_submit')).toMatchObject({
      step_label: 'Legal sign-off', object_name: 'crm_deal', record_id: 'D_done', acted_as_label: null,
    });
    expect(await row('sys_approval_action', 'a_vote')).toMatchObject({
      step_label: 'Legal sign-off', object_name: 'crm_deal', record_id: 'D_done', acted_as_label: 'Alice',
    });
    expect(await row('sys_approval_action', 'a_thread')).toMatchObject({
      step_label: 'Manager Review', object_name: 'crm_deal', record_id: 'D_open', acted_as_label: 'position:legal',
    });

    // The two doors agree on the same row.
    const svc = new ApprovalService({ engine: engine as any, logger: quiet as any });
    const served: any = await svc.getRequest('areq_open', SYSTEM);
    const stored = await row('sys_approval_request', 'areq_open');
    expect(served.process_label).toBe(stored.process_label);
    expect(served.step_label).toBe(stored.current_step_label);
  });

  it('(b) a second boot writes nothing', async () => {
    await boot(engine);
    const update = vi.spyOn(engine, 'update');
    await boot(engine);
    const displayWrites = update.mock.calls.filter(([object]) =>
      object === 'sys_approval_request' || object === 'sys_approval_action');
    expect(displayWrites).toEqual([]);
    update.mockRestore();
  });

  it('(c) never overwrites a column a live writer filled; an orphaned action keeps a null pointer and its own step name', async () => {
    await engine.update('sys_approval_request', { id: 'areq_open', process_label: 'Live label' }, { context: SYSTEM } as any);
    // An action whose step label and acting-as label a writer already stored,
    // different from what its request would give: the fill copies only its
    // null pointer columns and leaves both labels as stored.
    await engine.update('sys_approval_action', {
      id: 'a_vote', step_label: 'Recorded step', acted_as_label: 'Recorded name',
    }, { context: SYSTEM } as any);
    const svc = new ApprovalService({ engine: engine as any, logger: quiet as any });
    const out = await backfillApprovalDisplayLabels(engine as any, slotLabelSourceOf(svc));
    expect(out.requestsFilled).toBe(2);

    expect((await row('sys_approval_request', 'areq_open')).process_label).toBe('Live label');
    expect(await row('sys_approval_action', 'a_vote')).toMatchObject({
      step_label: 'Recorded step', acted_as_label: 'Recorded name', object_name: 'crm_deal', record_id: 'D_done',
    });
    expect(await row('sys_approval_action', 'a_orphan')).toMatchObject({
      step_label: 'Final Check', object_name: null, record_id: null, acted_as_label: null,
    });
    expect(await backfillApprovalDisplayLabels(engine as any, slotLabelSourceOf(svc)))
      .toEqual({ requestsFilled: 0, actionsFilled: 0 });
  });

  it('(d) a failed name read stores no label and says so once; the next run fills it', async () => {
    const warn: string[] = [];
    // The same engine, except that every `sys_user` read fails.
    const failing: any = Object.create(engine);
    failing.find = (object: string, options: EngineQueryOptions) =>
      object === 'sys_user' ? Promise.reject(new Error('sys_user unavailable')) : engine.find(object, options);
    const broken = new ApprovalService({ engine: failing, logger: { ...quiet, warn: (m: string) => { warn.push(m); } } as any });

    const labels = slotLabelSourceOf(broken);
    // A person slot gets null; a non-person slot keeps its address by design.
    expect(await labels.slotLabels(['u_alice', 'position:legal'])).toEqual([null, 'position:legal']);
    expect(await labels.slateLabels(['u_alice', 'position:legal'])).toBeNull();
    expect(warn.filter((m) => m.includes('could not be read'))).toHaveLength(2);

    await backfillApprovalDisplayLabels(engine as any, labels);
    expect((await row('sys_approval_request', 'areq_open')).pending_approver_labels).toBeNull();
    expect((await row('sys_approval_action', 'a_vote')).acted_as_label).toBeNull();
    expect((await row('sys_approval_action', 'a_thread')).acted_as_label).toBe('position:legal');

    const healthy = new ApprovalService({ engine: engine as any, logger: quiet as any });
    await backfillApprovalDisplayLabels(engine as any, slotLabelSourceOf(healthy));
    expect((await row('sys_approval_request', 'areq_open')).pending_approver_labels).toBe('Alice, position:legal');
    expect((await row('sys_approval_action', 'a_vote')).acted_as_label).toBe('Alice');
  });

  it('(e) the action-slot backfill labels every acted_as it writes', async () => {
    await engine.insert('sys_approval_action', legacyAction('a_slot_email', 'areq_open', {
      action: 'comment', actor_id: 'mail@example.com',
    }), { context: SYSTEM } as any);
    await engine.insert('sys_approval_action', legacyAction('a_slot_vote', 'areq_open', {
      action: 'approve', actor_id: 'u_alice',
    }), { context: SYSTEM } as any);
    const svc = new ApprovalService({ engine: engine as any, logger: quiet as any });
    const out = await backfillActionSlots(engine as any, { labels: slotLabelSourceOf(svc) });
    expect(out).toMatchObject({ literalsMoved: 1, votesStamped: 1 });

    expect(await row('sys_approval_action', 'a_slot_email')).toMatchObject({
      actor_id: null, acted_as: 'mail@example.com', acted_as_label: 'Mia Mail',
    });
    expect(await row('sys_approval_action', 'a_slot_vote')).toMatchObject({
      acted_as: 'u_alice', acted_as_label: 'Alice',
    });
  });

  it('(f) an empty authored label is stored as the humanized machine name, never the empty string', async () => {
    await engine.insert('crm_deal', { id: 'D_f', title: 'f' }, { context: SYSTEM } as any);
    const svc = new ApprovalService({
      engine: engine as any, logger: quiet as any,
      automation: { getRun: async (id: string) => ({ id, status: 'paused' }) } as any,
    });
    const opened: any = await svc.openNodeRequest({
      object: 'crm_deal', recordId: 'D_f', runId: 'run_f', nodeId: 'legal_review',
      flowName: 'deal_review', flowLabel: '', nodeLabel: '',
      config: { approvers: [{ type: 'user', value: 'u_alice' }], behavior: 'first_response' } as any,
      submitterId: 'u_sub', record: { id: 'D_f', title: 'f' },
    }, { userId: 'u_sub', positions: [], permissions: [] } as any);
    expect(await row('sys_approval_request', opened.id)).toMatchObject({
      process_label: 'Deal Review', current_step_label: 'Legal Review',
    });
    expect(opened.process_label).toBe('Deal Review');
    expect(opened.step_label).toBe('Legal Review');
  });
});
