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
import { ApprovalService } from './approval-service.js';
import { bindApprovalLockHook, unbindAllHooks } from './lifecycle-hooks.js';

interface FakeRow { [k: string]: any }

function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  const hooks: Record<string, Array<{ handler: (ctx: any) => any | Promise<any>; object?: string | string[]; packageId?: string }>> = {};

  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$ne' in (v as any)) {
        if (rv === (v as any).$ne) return false;
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
        const { field, direction } = options.orderBy[0];
        rows.sort((a, b) => {
          const av = a[field]; const bv = b[field];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return direction === 'desc' ? -cmp : cmp;
        });
      }
      return rows.slice(0, options?.limit ?? 1000);
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
