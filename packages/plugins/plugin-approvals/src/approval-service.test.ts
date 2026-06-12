// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Node-era approval service tests (ADR-0019).
 *
 * Approval is a flow node — there is no standalone process engine. These tests
 * exercise the service directly: opening a node-driven request, recording
 * decisions (first_response / unanimous), the public `decide()` resume bridge,
 * the read API, and the global record-lock hook.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalService, REMIND_COOLDOWN_MS } from './approval-service.js';
import { bindApprovalLockHook, unbindAllHooks } from './lifecycle-hooks.js';

interface FakeRow { [k: string]: any }

function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  const hooks: Record<string, Array<{ handler: (ctx: any) => any | Promise<any>; object?: string | string[]; packageId?: string }>> = {};

  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!(v as any[]).some(sub => matches(row, sub))) return false;
        continue;
      }
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$ne' in (v as any)) {
        if (rv === (v as any).$ne) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$contains' in (v as any)) {
        if (!String(rv ?? '').includes(String((v as any).$contains))) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }

  return {
    _tables: tables,
    _hooks: hooks,
    async find(object: string, options?: any) {
      const rows = ensure(object).filter(r => matches(r, options?.filter ?? options?.where));
      if (options?.orderBy?.[0]) {
        // Canonical SortNode key only (spec/data/query.zod.ts): a sloppy
        // `direction:` key must fall through to the schema default (asc),
        // exactly like the real engine — that's how the remind() cool-down
        // regression stayed invisible when this mock honored both keys.
        const { field, order } = options.orderBy[0];
        rows.sort((a, b) => {
          const av = a[field]; const bv = b[field];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return order === 'desc' ? -cmp : cmp;
        });
      }
      const start = options?.offset ?? 0;
      return rows.slice(start, start + (options?.limit ?? 1000));
    },
    async insert(object: string, data: any) {
      ensure(object).push({ ...data });
      return { ...data };
    },
    async update(object: string, idOrData: any, _opts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : _opts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const table = ensure(object);
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    async delete(object: string, options?: any) {
      const table = ensure(object);
      const id = options?.where?.id ?? options?.id;
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table.splice(i, 1);
      return { id };
    },
    // ── hook surface (for the record-lock hook) ──
    registerHook(event: string, handler: (ctx: any) => any, options?: any) {
      (hooks[event] ??= []).push({ handler, object: options?.object, packageId: options?.packageId });
    },
    unregisterHooksByPackage(packageId: string): number {
      let n = 0;
      for (const ev of Object.keys(hooks)) {
        const before = hooks[ev].length;
        hooks[ev] = hooks[ev].filter(h => h.packageId !== packageId);
        n += before - hooks[ev].length;
      }
      return n;
    },
    async fire(event: string, ctx: any) {
      for (const h of hooks[event] ?? []) {
        if (h.object) {
          const objs = Array.isArray(h.object) ? h.object : [h.object];
          if (!objs.includes(ctx.object)) continue;
        }
        await h.handler(ctx);
      }
    },
  };
}

const CTX = { userId: 'u1', tenantId: 't1', roles: [], permissions: [] } as any;
const SYS = { isSystem: true, roles: [], permissions: [] } as any;

function nodeConfig(approvers: string[], extra: Record<string, any> = {}) {
  return {
    approvers: approvers.map(v => ({ type: 'user' as const, value: v })),
    behavior: 'first_response' as const,
    lockRecord: true,
    ...extra,
  };
}

function openInput(approvers: string[], extra: Record<string, any> = {}, configExtra: Record<string, any> = {}) {
  return {
    object: 'opportunity',
    recordId: 'opp1',
    runId: 'run_1',
    nodeId: 'approve_step',
    flowName: 'deal_approval',
    config: nodeConfig(approvers, configExtra),
    record: { id: 'opp1', amount: 100 },
    ...extra,
  };
}

describe('ApprovalService (node era)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  beforeEach(() => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(baseTime + (n++) * 1000) },
    });
  });

  // ── openNodeRequest ─────────────────────────────────────────────

  it('openNodeRequest: creates a pending request + submit action with flow correlation', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    expect(req.status).toBe('pending');
    expect(req.process_name).toBe('flow:deal_approval');
    expect(req.flow_run_id).toBe('run_1');
    expect(req.flow_node_id).toBe('approve_step');
    expect(req.pending_approvers).toEqual(['u9']);
    expect(engine._tables['sys_approval_request']).toHaveLength(1);
    expect(engine._tables['sys_approval_action'][0].action).toBe('submit');
  });

  it('openNodeRequest: snapshots the node config on the row', async () => {
    await svc.openNodeRequest(openInput(['u9']), CTX);
    const raw = engine._tables['sys_approval_request'][0];
    expect(JSON.parse(raw.node_config_json)).toMatchObject({ behavior: 'first_response', lockRecord: true });
  });

  it('openNodeRequest: deduplicates a pending request per (object, record)', async () => {
    await svc.openNodeRequest(openInput(['u9']), CTX);
    await expect(svc.openNodeRequest(openInput(['u9'], { runId: 'run_2' }), CTX))
      .rejects.toThrow(/DUPLICATE_REQUEST/);
  });

  it('openNodeRequest: requires object, recordId, runId', async () => {
    await expect(svc.openNodeRequest(openInput(['u9'], { object: '' }), CTX)).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(svc.openNodeRequest(openInput(['u9'], { recordId: '' }), CTX)).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(svc.openNodeRequest(openInput(['u9'], { runId: '' }), CTX)).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it('openNodeRequest: mirrors status onto the business record when configured', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', amount: 100 }];
    await svc.openNodeRequest(openInput(['u9'], {}, { approvalStatusField: 'approval_status' }), CTX);
    expect(engine._tables['opportunity'][0].approval_status).toBe('pending');
  });

  // ── decideNode ──────────────────────────────────────────────────

  it('decideNode: first_response approve finalizes immediately', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expect(out.finalized).toBe(true);
    expect(out.decision).toBe('approve');
    expect(out.runId).toBe('run_1');
    expect(out.nodeId).toBe('approve_step');
    expect(out.request.status).toBe('approved');
  });

  it('decideNode: reject finalizes as rejected', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.decideNode(req.id, { decision: 'reject', actorId: 'u9', comment: 'no' }, SYS);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('rejected');
  });

  it('decideNode: unanimous holds until every approver acts', async () => {
    const req = await svc.openNodeRequest(openInput(['u1', 'u2'], {}, { behavior: 'unanimous' }), CTX);
    const first = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    expect(first.finalized).toBe(false);
    expect(first.request.pending_approvers).toEqual(['u2']);
    const second = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u2' }, SYS);
    expect(second.finalized).toBe(true);
    expect(second.request.status).toBe('approved');
  });

  it('decideNode: blocks a non-approver in a non-system context', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await expect(
      svc.decideNode(req.id, { decision: 'approve', actorId: 'mallory' }, { isSystem: false, roles: [], permissions: [] } as any),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('decideNode: rejects a decision on a non-pending request', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    await expect(svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS)).rejects.toThrow(/INVALID_STATE/);
  });

  it('decideNode: mirrors the terminal status onto the business record', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', amount: 100 }];
    const req = await svc.openNodeRequest(openInput(['u9'], {}, { approvalStatusField: 'approval_status' }), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expect(engine._tables['opportunity'][0].approval_status).toBe('approved');
  });

  // ── decide(): public contract + resume bridge ───────────────────

  it('decide: resumes the owning run down the matching branch on finalize', async () => {
    const resumed: any[] = [];
    svc.attachAutomation({ async resume(runId, signal) { resumed.push({ runId, signal }); } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.decide(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expect(out.finalized).toBe(true);
    expect(out.resumed).toBe(true);
    expect(out.runId).toBe('run_1');
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({ runId: 'run_1', signal: { branchLabel: 'approve' } });
  });

  it('decide: does not resume while a unanimous request is still pending', async () => {
    const resumed: any[] = [];
    svc.attachAutomation({ async resume(runId) { resumed.push(runId); } });
    const req = await svc.openNodeRequest(openInput(['u1', 'u2'], {}, { behavior: 'unanimous' }), CTX);
    const out = await svc.decide(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    expect(out.finalized).toBe(false);
    expect(out.resumed).toBe(false);
    expect(resumed).toHaveLength(0);
  });

  it('decide: finalizes even when no automation is attached (resumed=false)', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.decide(req.id, { decision: 'reject', actorId: 'u9' }, SYS);
    expect(out.finalized).toBe(true);
    expect(out.resumed).toBe(false);
  });

  // ── read API ────────────────────────────────────────────────────

  it('listRequests: filters by approver and status', async () => {
    await svc.openNodeRequest(openInput(['u9']), CTX);
    const pending = await svc.listRequests({ status: 'pending', approverId: 'u9' }, SYS);
    expect(pending).toHaveLength(1);
    const none = await svc.listRequests({ approverId: 'nobody' }, SYS);
    expect(none).toHaveLength(0);
  });

  it('listRequests: approverId accepts a list and matches ANY identity', async () => {
    await svc.openNodeRequest(openInput(['u9']), CTX);
    // None of these identities individually except the last is the approver.
    const hit = await svc.listRequests(
      { status: 'pending', approverId: ['someone-else', 'user@example.com', 'u9'] },
      SYS,
    );
    expect(hit).toHaveLength(1);
    // A list with no matching identity returns nothing.
    const miss = await svc.listRequests({ approverId: ['a', 'b', 'role:viewer'] }, SYS);
    expect(miss).toHaveLength(0);
    // Empty / whitespace-only ids are ignored, not treated as a match-all.
    const ignored = await svc.listRequests({ approverId: ['', '  '] }, SYS);
    expect(ignored).toHaveLength(1);
  });

  it('listActions: returns the audit trail for a request', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.map(a => a.action)).toEqual(['submit', 'approve']);
  });

  it('getRequest: returns null for an unknown id', async () => {
    expect(await svc.getRequest('nope', SYS)).toBeNull();
  });

  // ── recall ──────────────────────────────────────────────────────

  it('recall: submitter withdraws a pending request', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.recall(req.id, { actorId: 'u1', comment: 'changed my mind' }, CTX);
    expect(out.request.status).toBe('recalled');
    expect(out.request.completed_at).toBeTruthy();
    expect(out.request.pending_approvers).toEqual([]);
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.map(a => a.action)).toEqual(['submit', 'recall']);
    expect(actions[1].comment).toBe('changed my mind');
  });

  it('recall: blocks a non-submitter in a non-system context', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await expect(svc.recall(req.id, { actorId: 'u9' }, { roles: [], permissions: [] } as any))
      .rejects.toThrow(/FORBIDDEN/);
  });

  it('recall: rejects a recall on a non-pending request', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    await expect(svc.recall(req.id, { actorId: 'u1' }, SYS)).rejects.toThrow(/INVALID_STATE/);
  });

  it('recall: resumes the owning run down the reject branch with decision=recall', async () => {
    const resumed: any[] = [];
    svc.attachAutomation({ async resume(runId, signal) { resumed.push({ runId, signal }); } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.recall(req.id, { actorId: 'u1' }, CTX);
    expect(out.resumed).toBe(true);
    expect(resumed[0]).toMatchObject({
      runId: 'run_1',
      signal: { branchLabel: 'reject', output: { decision: 'recall' } },
    });
  });

  it('recall: mirrors `recalled` onto the business record when configured', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', amount: 100 }];
    const req = await svc.openNodeRequest(openInput(['u9'], {}, { approvalStatusField: 'approval_status' }), CTX);
    await svc.recall(req.id, { actorId: 'u1' }, CTX);
    expect(engine._tables['opportunity'][0].approval_status).toBe('recalled');
  });

  // ── inbox display fields ────────────────────────────────────────

  it('rows expose submitted_at as an alias of created_at', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    expect(req.submitted_at).toBeTruthy();
    expect(req.submitted_at).toBe(req.created_at);
    const listed = await svc.listRequests({ status: 'pending' }, SYS);
    expect(listed[0].submitted_at).toBe(listed[0].created_at);
  });

  it('rows carry authored flow/node labels when provided', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9'], { flowLabel: 'Deal Approval', nodeLabel: 'Manager Review' }), CTX,
    );
    expect(req.process_label).toBe('Deal Approval');
    expect(req.step_label).toBe('Manager Review');
  });

  it('rows fall back to prettified machine names when labels are absent', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    expect(req.process_label).toBe('Deal Approval'); // from `flow:deal_approval`
    expect(req.step_label).toBe('Approve Step');     // from `approve_step`
  });

  it('listRequests enriches record_title and submitter_name', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', name: 'Acme Renewal', amount: 100 }];
    engine._tables['sys_user'] = [{ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' }];
    await svc.openNodeRequest(openInput(['u9']), CTX); // submitter_id = u1 (CTX.userId)
    const rows = await svc.listRequests({ status: 'pending' }, SYS);
    expect(rows[0].record_title).toBe('Acme Renewal');
    expect(rows[0].submitter_name).toBe('Ada Lovelace');
  });

  it('enrichment falls back to the payload snapshot when the record is gone', async () => {
    await svc.openNodeRequest(
      openInput(['u9'], { record: { id: 'opp1', name: 'Snapshot Title', amount: 1 } }), CTX,
    );
    const rows = await svc.listRequests({ status: 'pending' }, SYS);
    expect(rows[0].record_title).toBe('Snapshot Title');
  });

  it('enrichment resolves lookup foreign keys in the payload to record titles', async () => {
    (engine as any).getSchema = (name: string) =>
      name === 'opportunity'
        ? { label: 'Opportunity', fields: { name: {}, account: { type: 'lookup', reference: 'account' } } }
        : name === 'account' ? { label: 'Account', fields: { name: {} } } : undefined;
    engine._tables['opportunity'] = [{ id: 'opp1', name: 'Acme Renewal', account: 'acc1' }];
    engine._tables['account'] = [{ id: 'acc1', name: 'Acme Corp' }];
    await svc.openNodeRequest(openInput(['u9'], { record: { id: 'opp1', name: 'Acme Renewal', account: 'acc1' } }), CTX);
    const rows = await svc.listRequests({ status: 'pending' }, SYS);
    expect(rows[0].object_label).toBe('Opportunity');
    expect(rows[0].payload_display).toEqual({ account: 'Acme Corp' });
  });

  it('enrichment maps user-id approvers to display names', async () => {
    engine._tables['sys_user'] = [{ id: 'u9', name: 'Grace Hopper', email: 'grace@example.com' }];
    await svc.openNodeRequest(openInput(['u9']), CTX);
    const rows = await svc.listRequests({ status: 'pending' }, SYS);
    expect(rows[0].pending_approver_names).toEqual({ u9: 'Grace Hopper' });
  });

  it('listActions resolves actor display names', async () => {
    engine._tables['sys_user'] = [
      { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
      { id: 'u9', name: 'Grace Hopper', email: 'grace@example.com' },
    ];
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.map(a => (a as any).actor_name)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  // ── thread interactions ─────────────────────────────────────────

  it('reassign: hands the slot to a new approver and audits the move', async () => {
    const req = await svc.openNodeRequest(openInput(['u9', 'u2']), CTX);
    const out = await svc.reassign(req.id, { actorId: 'u9', to: 'u7' }, CTX);
    expect(out.request.pending_approvers).toEqual(['u7', 'u2']);
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.at(-1)).toMatchObject({ action: 'reassign', actor_id: 'u9', comment: 'u9 → u7' });
  });

  it('reassign: notifies the new approver via messaging', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.reassign(req.id, { actorId: 'u9', to: 'u7' }, CTX);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ topic: 'approval.reassigned', audience: ['u7'] });
  });

  it('reassign: blocks a non-holder and duplicate targets', async () => {
    const req = await svc.openNodeRequest(openInput(['u9', 'u2']), CTX);
    await expect(svc.reassign(req.id, { actorId: 'intruder', to: 'u7' }, CTX)).rejects.toThrow(/FORBIDDEN/);
    await expect(svc.reassign(req.id, { actorId: 'u9', to: 'u2' }, CTX)).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it('remind: notifies pending approvers, audits, and throttles repeats', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(openInput(['u9', 'u2']), CTX);
    const out = await svc.remind(req.id, { actorId: 'u1' }, CTX); // u1 = submitter (CTX.userId)
    expect(out.notified).toBe(2);
    // ADR-0043: per-approver fan-out so each reminder carries personal links.
    const reminders = emitted.filter(e => e.topic === 'approval.reminder');
    expect(reminders.map(r => r.audience)).toEqual([['u9'], ['u2']]);
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.at(-1)?.action).toBe('remind');
    // The fake clock steps 1s per call — well inside the 4h cool-down.
    await expect(svc.remind(req.id, { actorId: 'u1' }, CTX)).rejects.toThrow(/THROTTLED/);
  });

  it('remind: cool-down measures from the NEWEST reminder, not the first', async () => {
    // Regression: the throttle query sorted with the non-canonical
    // `direction: 'desc'` key, which SortNode strips — so it sorted asc and
    // compared against the FIRST reminder ever sent. Once 4h passed after
    // reminder #1, every later remind() sailed through unthrottled.
    let nowMs = baseTime;
    const localSvc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(nowMs += 1000) },
    });
    const req = await localSvc.openNodeRequest(openInput(['u9']), CTX);
    await localSvc.remind(req.id, { actorId: 'u1' }, CTX);
    // Jump past the cool-down: a second reminder is legitimately allowed.
    nowMs += REMIND_COOLDOWN_MS;
    await localSvc.remind(req.id, { actorId: 'u1' }, CTX);
    // Immediately after reminder #2 the throttle must bite again — with the
    // wrong sort key it compared against reminder #1 (now >4h old) and let
    // unlimited reminders through.
    await expect(localSvc.remind(req.id, { actorId: 'u1' }, CTX)).rejects.toThrow(/THROTTLED/);
  });

  it('remind: only the submitter may nudge', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await expect(svc.remind(req.id, { actorId: 'u9' }, { roles: [], permissions: [] } as any))
      .rejects.toThrow(/FORBIDDEN/);
  });

  it('requestInfo: keeps the request pending and notifies the submitter', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.requestInfo(req.id, { actorId: 'u9', comment: 'Need the Q3 numbers' }, CTX);
    expect(out.request.status).toBe('pending');
    expect(out.request.pending_approvers).toEqual(['u9']);
    expect(emitted[0]).toMatchObject({ topic: 'approval.request_info', audience: ['u1'] });
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.at(-1)).toMatchObject({ action: 'request_info', comment: 'Need the Q3 numbers' });
  });

  it('comment: submitter and approver may reply; outsiders may not', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.comment(req.id, { actorId: 'u1', comment: 'Numbers attached.' }, CTX);
    await svc.comment(req.id, { actorId: 'u9', comment: 'Thanks, reviewing.' }, CTX);
    await expect(svc.comment(req.id, { actorId: 'outsider', comment: 'hi' }, { roles: [], permissions: [] } as any))
      .rejects.toThrow(/FORBIDDEN/);
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.filter(a => a.action === 'comment')).toHaveLength(2);
  });

  // ── actionable links (ADR-0043) ─────────────────────────────────

  it('issueActionTokens: stores hashes only and binds approver + action', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const tokens = await svc.issueActionTokens(req.id, 'u9');
    expect(tokens.approve).not.toBe(tokens.reject);
    const rows = engine._tables['sys_approval_token'];
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.token_hash.length === 64)).toBe(true); // sha256 hex, never the raw token
    expect(rows.every(r => !JSON.stringify(r).includes(tokens.approve))).toBe(true);
    await expect(svc.issueActionTokens(req.id, 'stranger')).rejects.toThrow(/FORBIDDEN/);
  });

  it('redeem: approves as the bound approver and burns the token (single-use)', async () => {
    const resumed: any[] = [];
    svc.attachAutomation({ async resume(runId, signal) { resumed.push({ runId, signal }); } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const { approve } = await svc.issueActionTokens(req.id, 'u9');
    const out = await svc.redeemActionToken(approve);
    expect(out).toMatchObject({ ok: true, action: 'approve', approverId: 'u9' });
    expect((out as any).request.status).toBe('approved');
    expect(resumed[0]?.signal?.branchLabel).toBe('approve');
    const acts = await svc.listActions(req.id, SYS);
    expect(acts.at(-1)).toMatchObject({ action: 'approve', actor_id: 'u9', comment: 'Via action link' });
    // replay
    expect(await svc.redeemActionToken(approve)).toMatchObject({ ok: false, reason: 'consumed' });
  });

  it('peek: validates without consuming (GET never mutates)', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const { reject } = await svc.issueActionTokens(req.id, 'u9');
    expect(await svc.peekActionToken(reject)).toMatchObject({ ok: true, action: 'reject' });
    expect(await svc.peekActionToken(reject)).toMatchObject({ ok: true }); // still live
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('pending');
  });

  it('redeem: dead tokens — invalid, expired, decided request, reassigned slot', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    expect(await svc.redeemActionToken('garbage')).toMatchObject({ ok: false, reason: 'invalid' });

    const short = await svc.issueActionTokens(req.id, 'u9', { ttlMs: 1 });
    // fake clock advances 1s per call — far beyond a 1ms TTL
    expect(await svc.redeemActionToken(short.approve)).toMatchObject({ ok: false, reason: 'expired' });

    const live = await svc.issueActionTokens(req.id, 'u9');
    await svc.reassign(req.id, { actorId: 'u9', to: 'u7' }, CTX);
    expect(await svc.redeemActionToken(live.approve)).toMatchObject({ ok: false, reason: 'not_approver' });

    const forU7 = await svc.issueActionTokens(req.id, 'u7');
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u7' }, SYS);
    expect(await svc.redeemActionToken(forU7.reject)).toMatchObject({ ok: false, reason: 'not_pending' });
  });

  it('remind: each concrete approver gets their own action links', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(openInput(['u9', 'ada@example.com']), CTX);
    await svc.remind(req.id, { actorId: 'u1' }, CTX);
    const reminders = emitted.filter(e => e.topic === 'approval.reminder');
    expect(reminders).toHaveLength(2);
    for (const r of reminders) {
      expect(r.audience).toHaveLength(1);
      expect(r.payload.actions).toHaveLength(2);
      expect(r.payload.actions[0].url).toContain('/api/v1/approvals/act?token=');
    }
    const urls = reminders.flatMap(r => r.payload.actions.map((a: any) => a.url));
    expect(new Set(urls).size).toBe(4); // every link is personal + per-action
  });

  // ── pagination + search pushdown (#1745) ────────────────────────

  async function openMany(n: number) {
    for (let i = 0; i < n; i++) {
      await svc.openNodeRequest(openInput(['u9'], {
        recordId: `opp${i}`, record: { id: `opp${i}`, name: `Deal ${i}` },
      }), CTX);
    }
  }

  it('listRequests: windows pushable queries newest-first with limit/offset', async () => {
    await openMany(5);
    const page1 = await svc.listRequests({ limit: 2, offset: 0 }, SYS);
    const page2 = await svc.listRequests({ limit: 2, offset: 2 }, SYS);
    expect(page1.map(r => r.record_id)).toEqual(['opp4', 'opp3']); // created_at desc
    expect(page2.map(r => r.record_id)).toEqual(['opp2', 'opp1']);
  });

  it('listRequests: q matches the payload snapshot (record titles) via pushdown', async () => {
    await openMany(3);
    const hit = await svc.listRequests({ q: 'Deal 1', limit: 10 }, SYS);
    expect(hit.map(r => r.record_id)).toEqual(['opp1']);
    const miss = await svc.listRequests({ q: 'no-such-thing', limit: 10 }, SYS);
    expect(miss).toHaveLength(0);
  });

  it('countRequests: returns the unwindowed total for a filter', async () => {
    await openMany(4);
    expect(await svc.countRequests({ status: 'pending' }, SYS)).toBe(4);
    expect(await svc.countRequests({ q: 'Deal 2' }, SYS)).toBe(1);
  });

  it('listRequests: approver queries window in memory AFTER exact-match filtering', async () => {
    await openMany(4); // approver u9 on all
    await svc.openNodeRequest(openInput(['someone-else'], {
      recordId: 'oppX', record: { id: 'oppX', name: 'Other' },
    }), CTX);
    const page = await svc.listRequests({ approverId: 'u9', limit: 2, offset: 2 }, SYS);
    expect(page).toHaveLength(2);
    expect(page.every(r => r.pending_approvers?.includes('u9'))).toBe(true);
    expect(await svc.countRequests({ approverId: 'u9' }, SYS)).toBe(4);
  });

  // ── SLA escalation (ADR-0042) ───────────────────────────────────

  function makeOverdue(reqId: string) {
    // Push created_at into the past so a small timeoutHours is breached.
    const row = engine._tables['sys_approval_request'].find(r => r.id === reqId)!;
    row.created_at = new Date(baseTime - 10 * 3600_000).toISOString();
  }

  it('runEscalations: notify action messages approvers + escalateTo + submitter, once', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 2, action: 'notify', escalateTo: 'boss', notifySubmitter: true } }), CTX,
    );
    makeOverdue(req.id);
    const first = await svc.runEscalations();
    expect(first.escalated).toBe(1);
    expect(emitted.map(e => e.topic)).toEqual(['approval.sla_breached', 'approval.sla_breached']);
    expect(emitted[0].audience).toEqual(['u9', 'boss']);
    expect(emitted[1].audience).toEqual(['u1']); // submitter
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.at(-1)).toMatchObject({ action: 'escalate', actor_id: 'system:sla', comment: 'notify → boss' });
    // Single-shot: second sweep is a no-op.
    const second = await svc.runEscalations();
    expect(second.escalated).toBe(0);
    expect(emitted).toHaveLength(2);
  });

  it('runEscalations: auto_approve decides as system:sla and resumes the flow', async () => {
    const resumed: any[] = [];
    svc.attachAutomation({ async resume(runId, signal) { resumed.push({ runId, signal }); } });
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 1, action: 'auto_approve', notifySubmitter: false } }), CTX,
    );
    makeOverdue(req.id);
    const out = await svc.runEscalations();
    expect(out.escalated).toBe(1);
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('approved');
    expect(resumed[0]).toMatchObject({ runId: 'run_1', signal: { branchLabel: 'approve' } });
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.map(a => a.action)).toEqual(['submit', 'escalate', 'approve']);
    expect(actions.at(-1)?.actor_id).toBe('system:sla');
  });

  it('runEscalations: auto_reject decides as system:sla', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 1, action: 'auto_reject', notifySubmitter: false } }), CTX,
    );
    makeOverdue(req.id);
    await svc.runEscalations();
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('rejected');
  });

  it('runEscalations: reassign replaces the approver set with escalateTo', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9', 'u2'], {}, { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'boss', notifySubmitter: false } }), CTX,
    );
    makeOverdue(req.id);
    await svc.runEscalations();
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('pending');
    expect(fresh?.pending_approvers).toEqual(['boss']);
  });

  it('runEscalations: skips requests that are not yet due or have no SLA', async () => {
    await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 1000, action: 'auto_approve' } }), CTX,
    );
    await svc.openNodeRequest(openInput(['u9'], { recordId: 'opp2', record: { id: 'opp2' } }), CTX);
    const out = await svc.runEscalations();
    expect(out.scanned).toBe(2);
    expect(out.escalated).toBe(0);
  });

  // ── SLA + flow steps ────────────────────────────────────────────

  it('rows expose sla_due_at when the node declares escalation.timeoutHours', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 48, action: 'notify', notifySubmitter: true } }), CTX,
    );
    expect(req.sla_due_at).toBe(new Date(Date.parse(req.created_at!) + 48 * 3600_000).toISOString());
    const noSla = await svc.openNodeRequest(openInput(['u9'], { recordId: 'opp2', record: { id: 'opp2' } }), CTX);
    expect(noSla.sla_due_at).toBeUndefined();
  });

  it('getRequest attaches flow_steps from the owning flow graph', async () => {
    svc.attachAutomation({
      async getFlow(name: string) {
        if (name !== 'deal_approval') return null;
        return {
          name: 'deal_approval',
          nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'approve_step', type: 'approval', label: 'Manager Approval' },
            { id: 'gate', type: 'decision', label: 'Big?' },
            { id: 'exec_step', type: 'approval', label: 'Executive Approval' },
            { id: 'end', type: 'end', label: 'End' },
          ],
          edges: [
            { id: 'e1', source: 'start', target: 'approve_step' },
            { id: 'e2', source: 'approve_step', target: 'gate', label: 'approve' },
            { id: 'e3', source: 'gate', target: 'exec_step', label: 'true' },
            { id: 'e4', source: 'exec_step', target: 'end', label: 'approve' },
          ],
        };
      },
    });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.flow_steps).toEqual([
      { id: 'approve_step', label: 'Manager Approval', state: 'current' },
      { id: 'exec_step', label: 'Executive Approval', state: 'upcoming' },
    ]);
  });

  it('enrichment resolves an email submitter via sys_user.email', async () => {
    engine._tables['sys_user'] = [{ id: 'u7', name: 'Grace Hopper', email: 'grace@example.com' }];
    await svc.openNodeRequest(openInput(['u9'], { submitterId: 'grace@example.com' }), CTX);
    const rows = await svc.listRequests({ status: 'pending' }, SYS);
    expect(rows[0].submitter_name).toBe('Grace Hopper');
  });
});

describe('record-lock hook (node era)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  beforeEach(async () => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(baseTime + (n++) * 1000) } });
    bindApprovalLockHook(engine as any);
    await svc.openNodeRequest(openInput(['u9'], {}, { approvalStatusField: 'approval_status' }), CTX);
  });

  it('blocks a user edit to a record with a pending approval', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
        session: { isSystem: false, roles: [], userId: 'u1' },
      }),
    ).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('allows a status-mirror write (only the approvalStatusField changes)', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { approval_status: 'approved' } },
        session: { isSystem: false, roles: [] },
      }),
    ).resolves.toBeUndefined();
  });

  it('allows engine self-writes (system session)', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
        session: { isSystem: true, roles: [] },
      }),
    ).resolves.toBeUndefined();
  });

  it('allows an admin override', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
        session: { isSystem: false, roles: ['admin'] },
      }),
    ).resolves.toBeUndefined();
  });

  it('does not lock records without a pending request', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'other_record', data: { amount: 200 } },
        session: { isSystem: false, roles: [] },
      }),
    ).resolves.toBeUndefined();
  });

  it('unbindAllHooks removes the lock hook', () => {
    expect(unbindAllHooks(engine as any)).toBe(1);
    expect(engine._hooks['beforeUpdate']).toHaveLength(0);
  });
});
