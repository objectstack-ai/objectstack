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
import { bindApprovalLockHook, bindDelegationWriteGuard, unbindAllHooks } from './lifecycle-hooks.js';

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

const CTX = { userId: 'u1', tenantId: 't1', positions: [], permissions: [] } as any;
const SYS = { isSystem: true, positions: [], permissions: [] } as any;

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

  // ── approver expansion: position (ADR-0090 D3) ──────────────────

  const positionInput = (extra: Record<string, any> = {}) => ({
    ...openInput([]),
    config: {
      approvers: [{ type: 'position' as const, value: 'sales_manager' }],
      behavior: 'first_response' as const,
      lockRecord: true,
    },
    ...extra,
  });

  it('position approver: expands via sys_user_position, org-scoped', async () => {
    engine._tables['sys_user_position'] = [
      { id: 'up1', user_id: 'u5', position: 'sales_manager', organization_id: 't1' },
      { id: 'up2', user_id: 'u6', position: 'sales_manager', organization_id: 't1' },
      { id: 'up3', user_id: 'u7', position: 'sales_manager', organization_id: 't2' }, // other tenant
      { id: 'up4', user_id: 'u8', position: 'cfo', organization_id: 't1' },           // other position
    ];
    const req = await svc.openNodeRequest(positionInput(), CTX);
    expect(req.pending_approvers.sort()).toEqual(['u5', 'u6']);
  });

  it('position approver: unions the sys_member.role transition source (ADR-0057 D4)', async () => {
    engine._tables['sys_user_position'] = [
      { id: 'up1', user_id: 'u5', position: 'sales_manager', organization_id: 't1' },
    ];
    engine._tables['sys_member'] = [
      { id: 'm1', user_id: 'u6', role: 'sales_manager', organization_id: 't1' },
      { id: 'm2', user_id: 'u5', role: 'sales_manager', organization_id: 't1' }, // deduped
    ];
    const req = await svc.openNodeRequest(positionInput(), CTX);
    expect(req.pending_approvers.sort()).toEqual(['u5', 'u6']);
  });

  it('position approver: falls back to a position: literal when nobody holds it', async () => {
    const req = await svc.openNodeRequest(positionInput(), CTX);
    expect(req.pending_approvers).toEqual(['position:sales_manager']);
  });

  // ── approver expansion: org_membership_level + its deprecated `role` alias
  //    (ADR-0090 D3) ────────────────────────────────────────────────────────

  // `recordId` is parameterised: the service rejects a second pending request
  // on the same record, and the alias test deliberately opens two.
  const tierInput = (type: 'org_membership_level' | 'role', recordId = 'opp1') => ({
    ...openInput([]),
    recordId,
    record: { id: recordId, amount: 100 },
    config: {
      approvers: [{ type: type as any, value: 'admin' }],
      behavior: 'first_response' as const,
      lockRecord: true,
    },
  });

  it('org_membership_level approver: expands the better-auth tier, org-scoped', async () => {
    engine._tables['sys_member'] = [
      { id: 'm1', user_id: 'u1', role: 'admin', organization_id: 't1' },
      { id: 'm2', user_id: 'u2', role: 'admin', organization_id: 't1' },
      { id: 'm3', user_id: 'u3', role: 'admin', organization_id: 't2' },  // other tenant
      { id: 'm4', user_id: 'u4', role: 'member', organization_id: 't1' }, // other tier
    ];
    const req = await svc.openNodeRequest(tierInput('org_membership_level'), CTX);
    expect(req.pending_approvers.sort()).toEqual(['u1', 'u2']);
  });

  it('deprecated `role` alias resolves IDENTICALLY to org_membership_level', async () => {
    engine._tables['sys_member'] = [
      { id: 'm1', user_id: 'u1', role: 'admin', organization_id: 't1' },
      { id: 'm2', user_id: 'u4', role: 'member', organization_id: 't1' },
    ];
    const canonical = await svc.openNodeRequest(tierInput('org_membership_level', 'opp_canon'), CTX);
    const deprecated = await svc.openNodeRequest(tierInput('role', 'opp_depr'), CTX);
    expect(deprecated.pending_approvers).toEqual(canonical.pending_approvers);
    expect(deprecated.pending_approvers).toEqual(['u1']);
  });

  // The fallback literal keeps the AUTHORED spelling: `sys_approval_approver`
  // rows and `pending_approvers` slots written by 15.x carry `role:<v>`, and
  // canonicalising the literal here would orphan every one of them.
  it('deprecated `role` alias keeps its legacy literal on fallback (no orphaned slots)', async () => {
    const req = await svc.openNodeRequest(tierInput('role'), CTX);
    expect(req.pending_approvers).toEqual(['role:admin']);
  });

  it('org_membership_level falls back to its own canonical literal', async () => {
    const req = await svc.openNodeRequest(tierInput('org_membership_level'), CTX);
    expect(req.pending_approvers).toEqual(['org_membership_level:admin']);
  });

  it("department approver: honors the spec enum value 'department' (not just the business_unit dialect)", async () => {
    engine._tables['sys_business_unit'] = [
      { id: 'bu1', organization_id: 't1', active: true },
      { id: 'bu2', parent_business_unit_id: 'bu1', organization_id: 't1', active: true },
    ];
    engine._tables['sys_business_unit_member'] = [
      { id: 'bm1', business_unit_id: 'bu1', user_id: 'u5' },
      { id: 'bm2', business_unit_id: 'bu2', user_id: 'u6' },
    ];
    const req = await svc.openNodeRequest(positionInput({
      config: {
        approvers: [{ type: 'department' as const, value: 'bu1' }],
        behavior: 'first_response' as const,
        lockRecord: true,
      },
    }), CTX);
    expect(req.pending_approvers.sort()).toEqual(['u5', 'u6']);
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
      svc.decideNode(req.id, { decision: 'approve', actorId: 'mallory' }, { isSystem: false, positions: [], permissions: [] } as any),
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

  // ── viewer capability (#3310) ───────────────────────────────────
  it('getRequest: viewer.can_act is true for a pending approver, false for the submitter', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX); // submitter u1, approver u9
    const asApprover = await svc.getRequest(req.id, { userId: 'u9', tenantId: 't1' } as any);
    expect(asApprover!.viewer).toEqual({ can_act: true, is_submitter: false, can_override: false });
    const asSubmitter = await svc.getRequest(req.id, { userId: 'u1', tenantId: 't1' } as any);
    expect(asSubmitter!.viewer).toEqual({ can_act: false, is_submitter: true, can_override: false });
    const asOther = await svc.getRequest(req.id, { userId: 'u_stranger', tenantId: 't1' } as any);
    expect(asOther!.viewer).toEqual({ can_act: false, is_submitter: false, can_override: false });
  });

  it('getRequest: viewer.can_act drops to false once the request is finalized', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS); // → approved
    const after = await svc.getRequest(req.id, { userId: 'u9', tenantId: 't1' } as any);
    expect(after!.status).toBe('approved');
    expect(after!.viewer!.can_act).toBe(false);
  });

  it('listRequests: attaches viewer to every row from the caller context', async () => {
    await svc.openNodeRequest(openInput(['u9']), CTX);
    const rows = await svc.listRequests({ status: 'pending' }, { userId: 'u9', tenantId: 't1' } as any);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.viewer != null)).toBe(true);
    expect(rows[0].viewer!.can_act).toBe(true);
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
    await expect(svc.recall(req.id, { actorId: 'u9' }, { positions: [], permissions: [] } as any))
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
    await expect(svc.remind(req.id, { actorId: 'u9' }, { positions: [], permissions: [] } as any))
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
    await expect(svc.comment(req.id, { actorId: 'outsider', comment: 'hi' }, { positions: [], permissions: [] } as any))
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

  it('listRequests: approver queries resolve via the index and window engine-side', async () => {
    await openMany(4); // approver u9 on all
    await svc.openNodeRequest(openInput(['someone-else'], {
      recordId: 'oppX', record: { id: 'oppX', name: 'Other' },
    }), CTX);
    const page = await svc.listRequests({ approverId: 'u9', limit: 2, offset: 2 }, SYS);
    expect(page).toHaveLength(2);
    expect(page.every(r => r.pending_approvers?.includes('u9'))).toBe(true);
    expect(await svc.countRequests({ approverId: 'u9' }, SYS)).toBe(4);
  });

  it('listRequests/countRequests: status arrays push down as $in', async () => {
    await openMany(3);
    const all = await svc.listRequests({ status: 'pending' }, SYS);
    await svc.decideNode(all[0].id, { decision: 'approve', actorId: 'u9' }, SYS);
    await svc.decideNode(all[1].id, { decision: 'reject', actorId: 'u9' }, SYS);
    const done = await svc.listRequests({ status: ['approved', 'rejected'] }, SYS);
    expect(done.map(r => r.status).sort()).toEqual(['approved', 'rejected']);
    expect(await svc.countRequests({ status: ['approved', 'rejected'] }, SYS)).toBe(2);
    expect(await svc.countRequests({ status: ['recalled'] }, SYS)).toBe(0);
  });

  // ── pending-approver index (#1745 join table) ───────────────────

  const indexRows = () => (engine._tables['sys_approval_approver'] ?? [])
    .map(r => ({ request_id: r.request_id, approver: r.approver }));

  it('openNodeRequest mirrors every approver identity into the index', async () => {
    const req = await svc.openNodeRequest(openInput(['u9', 'ada@example.com', 'role:finance']), CTX);
    expect(indexRows()).toEqual([
      { request_id: req.id, approver: 'u9' },
      { request_id: req.id, approver: 'ada@example.com' },
      { request_id: req.id, approver: 'role:finance' },
    ]);
  });

  it('decide and recall clear the request\'s index rows', async () => {
    const a = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(a.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expect(indexRows()).toHaveLength(0);

    const b = await svc.openNodeRequest(openInput(['u9'], { recordId: 'opp2', record: { id: 'opp2' } }), CTX);
    await svc.recall(b.id, { actorId: 'u1' }, CTX);
    expect(indexRows()).toHaveLength(0);
  });

  it('unanimous partial approval shrinks the index to the still-pending set', async () => {
    const req = await svc.openNodeRequest(openInput(['u1', 'u2'], {}, { behavior: 'unanimous' }), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    expect(indexRows()).toEqual([{ request_id: req.id, approver: 'u2' }]);
  });

  it('reassign and SLA-reassign rewrite the index rows', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9', 'u2'], {}, { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'boss', notifySubmitter: false } }), CTX,
    );
    await svc.reassign(req.id, { actorId: 'u9', to: 'u7' }, SYS);
    expect(indexRows().map(r => r.approver).sort()).toEqual(['u2', 'u7']);

    makeOverdue(req.id);
    await svc.runEscalations();
    expect(indexRows()).toEqual([{ request_id: req.id, approver: 'boss' }]);
  });

  it('approver-filtered pages stay correct past the old 500-row scan window', async () => {
    // 30 u9 requests are the OLDEST rows, buried under 510 newer non-matching
    // ones — the pre-#1745 bounded scan (limit 500, newest-first) could never
    // reach them. Seeded directly: 540 openNodeRequest round-trips are noise.
    const reqs = (engine._tables['sys_approval_request'] ??= []);
    const idx = (engine._tables['sys_approval_approver'] ??= []);
    const ts = (i: number) => new Date(baseTime + i * 1000).toISOString();
    for (let i = 0; i < 30; i++) {
      reqs.push({
        id: `match_${i}`, process_name: 'flow:f', object_name: 'o', record_id: `m${i}`,
        status: 'pending', pending_approvers: 'u9', created_at: ts(i), updated_at: ts(i),
      });
      idx.push({ id: `aapr_m${i}`, request_id: `match_${i}`, approver: 'u9', organization_id: null, created_at: ts(i) });
    }
    for (let i = 0; i < 510; i++) {
      reqs.push({
        id: `noise_${i}`, process_name: 'flow:f', object_name: 'o', record_id: `n${i}`,
        status: 'pending', pending_approvers: 'someone-else', created_at: ts(100 + i), updated_at: ts(100 + i),
      });
      idx.push({ id: `aapr_n${i}`, request_id: `noise_${i}`, approver: 'someone-else', organization_id: null, created_at: ts(100 + i) });
    }

    expect(await svc.countRequests({ approverId: 'u9' }, SYS)).toBe(30);
    const page = await svc.listRequests({ approverId: 'u9', limit: 10, offset: 20 }, SYS);
    // Newest-first within the matches: offset 20 of 30 → match_9 … match_0.
    expect(page.map(r => r.id)).toEqual(Array.from({ length: 10 }, (_, k) => `match_${9 - k}`));
    expect(page.every(r => r.pending_approvers?.includes('u9'))).toBe(true);
  });

  it('rebuildApproverIndex backfills legacy rows, drops orphans + stale entries, and is idempotent', async () => {
    const reqs = (engine._tables['sys_approval_request'] ??= []);
    const idx = (engine._tables['sys_approval_approver'] ??= []);
    const ts = new Date(baseTime).toISOString();
    // Legacy pending row written before the index existed.
    reqs.push({
      id: 'legacy_1', process_name: 'flow:f', object_name: 'o', record_id: 'r1',
      status: 'pending', pending_approvers: 'u1,u2', created_at: ts, updated_at: ts,
    });
    // Completed row whose index rows were never cleaned (orphan).
    reqs.push({
      id: 'done_1', process_name: 'flow:f', object_name: 'o', record_id: 'r2',
      status: 'approved', pending_approvers: null, created_at: ts, updated_at: ts,
    });
    idx.push({ id: 'aapr_orphan', request_id: 'done_1', approver: 'u3', organization_id: null, created_at: ts });
    // Pending row whose index drifted (holds an approver no longer in the CSV).
    reqs.push({
      id: 'drift_1', process_name: 'flow:f', object_name: 'o', record_id: 'r3',
      status: 'pending', pending_approvers: 'u5', created_at: ts, updated_at: ts,
    });
    idx.push({ id: 'aapr_stale', request_id: 'drift_1', approver: 'u4', organization_id: null, created_at: ts });

    const out = await svc.rebuildApproverIndex();
    expect(out).toEqual({ requests: 2, inserted: 3, deleted: 2 }); // +u1 +u2 +u5 / -orphan -stale
    expect(indexRows().sort((a, b) => a.approver.localeCompare(b.approver))).toEqual([
      { request_id: 'legacy_1', approver: 'u1' },
      { request_id: 'legacy_1', approver: 'u2' },
      { request_id: 'drift_1', approver: 'u5' },
    ]);

    const again = await svc.rebuildApproverIndex();
    expect(again).toEqual({ requests: 2, inserted: 0, deleted: 0 });
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

  it('runEscalations: reassign expands a position escalateTo to its holders (ADR-0090 D3)', async () => {
    engine._tables['sys_user_position'] = [
      { id: 'up1', user_id: 'u5', position: 'approvals_supervisor', organization_id: 't1' },
      { id: 'up2', user_id: 'u6', position: 'approvals_supervisor', organization_id: 't1' },
      { id: 'up3', user_id: 'u7', position: 'approvals_supervisor', organization_id: 't2' }, // other tenant
    ];
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'approvals_supervisor', notifySubmitter: false } }), CTX,
    );
    makeOverdue(req.id);
    await svc.runEscalations();
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('pending');
    expect(fresh?.pending_approvers?.slice().sort()).toEqual(['u5', 'u6']);
    // The audit trail keeps the AUTHORED target, not the expansion.
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.find(a => a.action === 'escalate')?.comment).toBe('reassign → approvals_supervisor');
  });

  it('runEscalations: notify expands a position escalateTo into the audience', async () => {
    engine._tables['sys_user_position'] = [
      { id: 'up1', user_id: 'u5', position: 'approvals_supervisor', organization_id: 't1' },
    ];
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 2, action: 'notify', escalateTo: 'approvals_supervisor', notifySubmitter: false } }), CTX,
    );
    makeOverdue(req.id);
    await svc.runEscalations();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].audience).toEqual(['u9', 'u5']);
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

// ── Admin / privileged override (#3424) ──────────────────────────────
//
// An approval routed to a position/team with NO holders resolves to only the
// unresolvable `position:<name>` literal — no concrete user is in the slate, so
// every normal decision is FORBIDDEN and (with lockRecord) the record stays
// locked forever with no in-product recovery. A platform or tenant admin may
// act on the pending request to release it: approve, reject, reassign it to a
// real approver, or recall it. Privilege is org-scoped for tenant admins.
describe('ApprovalService — admin override (#3424)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  // Admin exec contexts, shaped like the resolved authz envelope (permissions
  // carry the permission-set names the shared resolver aggregates).
  const PLATFORM_ADMIN = { userId: 'root', tenantId: 't1', positions: [], permissions: ['admin_full_access'] } as any;
  const TENANT_ADMIN = { userId: 'owner', tenantId: 't1', positions: [], permissions: ['organization_admin'] } as any;
  const OTHER_TENANT_ADMIN = { userId: 'owner2', tenantId: 't2', positions: [], permissions: ['organization_admin'] } as any;
  const MEMBER = { userId: 'nobody', tenantId: 't1', positions: [], permissions: [] } as any;

  // A request routed to an UNSTAFFED position → `pending_approvers` falls back to
  // the `position:sales_manager` literal, undecidable by any normal user.
  const stuckInput = (extra: Record<string, any> = {}) => ({
    object: 'opportunity', recordId: 'opp1', runId: 'run_1', nodeId: 'approve_step',
    flowName: 'deal_approval',
    config: { approvers: [{ type: 'position' as const, value: 'sales_manager' }], behavior: 'first_response' as const, lockRecord: true },
    record: { id: 'opp1', amount: 100 },
    ...extra,
  });

  beforeEach(() => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(baseTime + (n++) * 1000) } });
  });

  it('the stuck request is undecidable by any normal user (repro)', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    expect(req.pending_approvers).toEqual(['position:sales_manager']);
    // Even the org owner-by-id is not in the resolved (empty) slate.
    await expect(svc.decideNode(req.id, { decision: 'approve', actorId: 'nobody' }, MEMBER))
      .rejects.toThrow(/FORBIDDEN/);
  });

  it('a tenant admin can approve a stuck request, finalizing it (which releases the lock)', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    const out = await svc.decide(req.id, { decision: 'approve', actorId: 'owner' }, TENANT_ADMIN);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('approved');
    // No pending request remains → the record-lock hook no longer blocks edits.
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('approved');
    expect(fresh?.pending_approvers).toEqual([]);
    // Audited under the admin's own id — never spoofed as an approver.
    const acts = await svc.listActions(req.id, SYS);
    expect(acts.at(-1)).toMatchObject({ action: 'approve', actor_id: 'owner' });
  });

  it('a platform admin can reject a stuck request', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    const out = await svc.decide(req.id, { decision: 'reject', actorId: 'root' }, PLATFORM_ADMIN);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('rejected');
  });

  it('an admin override finalizes even a unanimous request immediately (not one vote among the slate)', async () => {
    const req = await svc.openNodeRequest(stuckInput({
      config: { approvers: [{ type: 'position' as const, value: 'sales_manager' }], behavior: 'unanimous' as const, lockRecord: true },
    }), CTX);
    const out = await svc.decide(req.id, { decision: 'approve', actorId: 'owner' }, TENANT_ADMIN);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('approved');
  });

  it('an admin can reassign a stuck request to a real approver, who then decides normally', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    const out = await svc.reassign(req.id, { actorId: 'owner', to: 'u7' }, TENANT_ADMIN);
    expect(out.request.pending_approvers).toEqual(['u7']);
    const decided = await svc.decideNode(
      req.id, { decision: 'approve', actorId: 'u7' },
      { userId: 'u7', tenantId: 't1', positions: [], permissions: [] } as any,
    );
    expect(decided.finalized).toBe(true);
  });

  it('an admin can recall (withdraw) a stuck request', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    const out = await svc.recall(req.id, { actorId: 'owner', comment: 'unstaffed role' }, TENANT_ADMIN);
    expect(out.request.status).toBe('recalled');
    expect(out.request.pending_approvers).toEqual([]);
  });

  it('a tenant admin of a DIFFERENT org cannot override (privilege is org-scoped)', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX); // organization_id = t1
    await expect(svc.decideNode(req.id, { decision: 'approve', actorId: 'owner2' }, OTHER_TENANT_ADMIN))
      .rejects.toThrow(/FORBIDDEN/);
  });

  it('viewer.can_override reflects the privilege, and drops once finalized', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    const asAdmin = await svc.getRequest(req.id, TENANT_ADMIN);
    expect(asAdmin!.viewer).toMatchObject({ can_act: false, can_override: true });
    const asMember = await svc.getRequest(req.id, MEMBER);
    expect(asMember!.viewer!.can_override).toBe(false);
    await svc.decide(req.id, { decision: 'approve', actorId: 'owner' }, TENANT_ADMIN);
    const after = await svc.getRequest(req.id, TENANT_ADMIN);
    expect(after!.viewer!.can_override).toBe(false);
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
        session: { isSystem: false, positions: [], userId: 'u1' },
      }),
    ).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('allows a status-mirror write (only the approvalStatusField changes)', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { approval_status: 'approved' } },
        session: { isSystem: false, positions: [] },
      }),
    ).resolves.toBeUndefined();
  });

  it('allows engine self-writes (system session)', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
        session: { isSystem: true, positions: [] },
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
        session: { isSystem: false, positions: [] },
      }),
    ).resolves.toBeUndefined();
  });

  it('unbindAllHooks removes the lock hook', () => {
    expect(unbindAllHooks(engine as any)).toBe(1);
    expect(engine._hooks['beforeUpdate']).toHaveLength(0);
  });
});

// ── Out-of-office auto-skip (#1322 M1/M4) ─────────────────────────────
//
// When a resolved individual approver has declared an active OOO delegation,
// the slot is rerouted to the delegate at resolution time (never a background
// job), audited as `ooo_substitute`, and both parties are notified. Group /
// graph approvers (position/team/department/tier) are left untouched.
describe('ApprovalService — out-of-office delegation (#1322)', () => {
  // Mid-window instant for the issue's own example (leave 5/26–5/30).
  const OOO_NOW = new Date('2026-05-27T10:00:00Z').getTime();
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let emitted: any[];

  function seedDelegation(rows: Array<Record<string, any>>) {
    engine._tables['sys_approval_delegation'] = rows.map((r, i) => ({
      id: `del${i}`,
      organization_id: 't1',
      valid_from: '2026-05-26T00:00:00Z',
      valid_until: '2026-05-30T00:00:00Z',
      reason: 'Annual leave',
      ...r,
    }));
  }

  beforeEach(() => {
    engine = makeFakeEngine();
    emitted = [];
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(OOO_NOW) } });
    svc.attachMessaging({ emit: async (m: any) => { emitted.push(m); } });
  });

  it('type:user — reroutes an out-of-office approver to the delegate', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['bob']);
  });

  it('records an ooo_substitute audit action with "A → B — reason"', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    await svc.openNodeRequest(openInput(['alice']), CTX);
    const sub = engine._tables['sys_approval_action'].find((a: any) => a.action === 'ooo_substitute');
    expect(sub).toBeTruthy();
    expect(sub.comment).toBe('alice → bob — Annual leave');
    expect(sub.actor_id).toBeNull(); // system-recorded reroute, no human actor
  });

  it('notifies both the delegate and the skipped approver', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    await svc.openNodeRequest(openInput(['alice']), CTX);
    const to = emitted.find(e => e.topic === 'approval.ooo_substituted');
    const from = emitted.find(e => e.topic === 'approval.ooo_skipped');
    expect(to?.audience).toEqual(['bob']);
    expect(from?.audience).toEqual(['alice']);
  });

  it('does not reroute before valid_from (window not yet open)', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob', valid_from: '2026-05-28T00:00:00Z' }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['alice']);
    expect(engine._tables['sys_approval_action'].some((a: any) => a.action === 'ooo_substitute')).toBe(false);
  });

  it('does not reroute at/after valid_until (half-open window)', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob', valid_until: '2026-05-27T10:00:00Z' }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['alice']);
  });

  it('type:field — reroutes the user stored in the record field', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    const input = {
      ...openInput([]),
      record: { id: 'opp1', reviewer: 'alice' },
      config: { approvers: [{ type: 'field', value: 'reviewer' }], behavior: 'first_response', lockRecord: true },
    };
    const req = await svc.openNodeRequest(input as any, CTX);
    expect(req.pending_approvers).toEqual(['bob']);
  });

  it('type:manager — reroutes when the resolved manager is out of office', async () => {
    engine._tables['sys_user'] = [{ id: 'carol', manager_id: 'alice' }];
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    const input = {
      ...openInput([]),
      record: { id: 'opp1', owner_id: 'carol' },
      config: { approvers: [{ type: 'manager', value: 'owner_id' }], behavior: 'first_response', lockRecord: true },
    };
    const req = await svc.openNodeRequest(input as any, CTX);
    expect(req.pending_approvers).toEqual(['bob']);
  });

  it('follows a delegation chain A → B → C', async () => {
    seedDelegation([
      { delegator_id: 'alice', delegate_id: 'bob' },
      { delegator_id: 'bob', delegate_id: 'carol' },
    ]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['carol']);
    expect(engine._tables['sys_approval_action'].filter((a: any) => a.action === 'ooo_substitute')).toHaveLength(2);
  });

  it('stops on a cycle A → B → A without looping', async () => {
    seedDelegation([
      { delegator_id: 'alice', delegate_id: 'bob' },
      { delegator_id: 'bob', delegate_id: 'alice' },
    ]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['bob']);
  });

  it('ignores a self-delegation (A → A)', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'alice' }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['alice']);
    expect(engine._tables['sys_approval_action'].some((a: any) => a.action === 'ooo_substitute')).toBe(false);
  });

  it('leaves approvers unchanged when there is no active delegation', async () => {
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['alice']);
  });

  it('does not OOO-substitute group-routed (position) approvers', async () => {
    engine._tables['sys_user_position'] = [{ id: 'up1', user_id: 'alice', position: 'sales_manager', organization_id: 't1' }];
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    const input = {
      ...openInput([]),
      config: { approvers: [{ type: 'position', value: 'sales_manager' }], behavior: 'first_response', lockRecord: true },
    };
    const req = await svc.openNodeRequest(input as any, CTX);
    // Position-routed leave is ADR-0091's job, not this path: the holder stays.
    expect(req.pending_approvers).toEqual(['alice']);
  });

  it('respects tenant scope: a rule scoped to another org does not apply', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob', organization_id: 't2' }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['alice']);
  });

  it('applies a cross-tenant (null org) rule regardless of request tenant', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob', organization_id: null }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['bob']);
  });
});

// ── Delegation self-service write guard (#1322 follow-up) ─────────────
//
// sys_approval_delegation is apiEnabled CRUD; a member must not be able to
// forge a delegation for someone else (delegator_id = victim) and reroute the
// victim's approvals. The guard forces delegator_id == acting user for normal
// writes; system/admin contexts bypass. Row-ownership on update/delete is the
// platform's created_by RLS (not exercised here).
describe('sys_approval_delegation write guard (#1322)', () => {
  const DEL = 'sys_approval_delegation';
  let engine: ReturnType<typeof makeFakeEngine>;

  beforeEach(() => {
    engine = makeFakeEngine();
    bindDelegationWriteGuard(engine as any);
  });

  const fireInsert = (data: any, session: any) =>
    (engine as any).fire('beforeInsert', { object: DEL, input: { data }, session });
  const fireUpdate = (data: any, session: any) =>
    (engine as any).fire('beforeUpdate', { object: DEL, input: { id: data?.id ?? 'd1', data }, session });
  const member = (userId?: string) => ({ isSystem: false, roles: [], ...(userId ? { userId } : {}) });

  it('allows a member to create their own delegation', async () => {
    await expect(fireInsert({ delegator_id: 'u1', delegate_id: 'u2' }, member('u1'))).resolves.toBeUndefined();
  });

  it('rejects a member forging a delegation for someone else', async () => {
    await expect(fireInsert({ delegator_id: 'victim', delegate_id: 'u1' }, member('u1'))).rejects.toThrow(/FORBIDDEN/);
  });

  it('stamps the caller as delegator when omitted on insert', async () => {
    const data: any = { delegate_id: 'u2' };
    await fireInsert(data, member('u1'));
    expect(data.delegator_id).toBe('u1');
  });

  it('rejects an unauthenticated non-system insert', async () => {
    await expect(fireInsert({ delegate_id: 'u2' }, member())).rejects.toThrow(/FORBIDDEN/);
  });

  it('bypasses the guard for system context', async () => {
    await expect(fireInsert({ delegator_id: 'victim', delegate_id: 'u1' }, { isSystem: true })).resolves.toBeUndefined();
  });

  it('lets an admin set the delegator to anyone', async () => {
    await expect(fireInsert({ delegator_id: 'victim', delegate_id: 'u2' }, { isSystem: false, roles: ['admin'], userId: 'admin1' })).resolves.toBeUndefined();
  });

  it('rejects a member relabelling delegator on update', async () => {
    await expect(fireUpdate({ id: 'd1', delegator_id: 'victim' }, member('u1'))).rejects.toThrow(/FORBIDDEN/);
  });

  it('allows a member update that does not touch delegator_id', async () => {
    await expect(fireUpdate({ id: 'd1', valid_until: '2026-06-01T00:00:00Z' }, member('u1'))).resolves.toBeUndefined();
  });

  it('rejects a batch insert if any row names a foreign delegator', async () => {
    await expect(fireInsert(
      [{ delegator_id: 'u1', delegate_id: 'u2' }, { delegator_id: 'victim', delegate_id: 'u3' }],
      member('u1'),
    )).rejects.toThrow(/FORBIDDEN/);
  });
});

// ── Quorum & per-group sign-off (#3266) ───────────────────────────────
//
// quorum = M-of-N collective sign-off; per_group = one (or minApprovals) from
// EACH group (会签). A single rejection is always a veto. Group membership is
// snapshotted at open, so OOO-substituted approvers count for their group.
describe('ApprovalService — quorum & per_group (#3266)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  const base = new Date('2026-08-01T10:00:00Z').getTime();

  beforeEach(() => {
    engine = makeFakeEngine();
    let n = 0;
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(base + (n++) * 1000) } });
  });

  // Build an openNodeRequest input with explicit approver specs + behavior.
  const cfg = (approvers: any[], behavior: string, extra: Record<string, any> = {}) => ({
    ...openInput([]),
    config: { approvers, behavior, lockRecord: true, ...extra },
  });
  const U = (v: string, group?: string) => (group ? { type: 'user', value: v, group } : { type: 'user', value: v });

  it('quorum: holds until minApprovals reached, then finalizes', async () => {
    const req = await svc.openNodeRequest(cfg([U('u1'), U('u2'), U('u3')], 'quorum', { minApprovals: 2 }), CTX);
    const a = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    expect(a.finalized).toBe(false);
    expect(a.request.status).toBe('pending');
    const b = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u2' }, SYS);
    expect(b.finalized).toBe(true);
    expect(b.request.status).toBe('approved');
  });

  it('quorum: minApprovals clamps to the approver count (no deadlock)', async () => {
    const req = await svc.openNodeRequest(cfg([U('u1'), U('u2')], 'quorum', { minApprovals: 5 }), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    const b = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u2' }, SYS);
    expect(b.finalized).toBe(true);
  });

  it('quorum: any reject is a veto', async () => {
    const req = await svc.openNodeRequest(cfg([U('u1'), U('u2'), U('u3')], 'quorum', { minApprovals: 2 }), CTX);
    const r = await svc.decideNode(req.id, { decision: 'reject', actorId: 'u1' }, SYS);
    expect(r.finalized).toBe(true);
    expect(r.request.status).toBe('rejected');
  });

  it('per_group: advances only when EACH group approves', async () => {
    const req = await svc.openNodeRequest(cfg([U('l1', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    const a = await svc.decideNode(req.id, { decision: 'approve', actorId: 'l1' }, SYS);
    expect(a.finalized).toBe(false); // finance still pending
    const b = await svc.decideNode(req.id, { decision: 'approve', actorId: 'f1' }, SYS);
    expect(b.finalized).toBe(true);
    expect(b.request.status).toBe('approved');
  });

  it('per_group: two approvals in ONE group do not satisfy another group', async () => {
    const req = await svc.openNodeRequest(
      cfg([U('l1', 'legal'), U('l2', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'l1' }, SYS);
    const b = await svc.decideNode(req.id, { decision: 'approve', actorId: 'l2' }, SYS);
    expect(b.finalized).toBe(false); // finance still missing
  });

  it('per_group: minApprovals=2 needs two from each group', async () => {
    const req = await svc.openNodeRequest(cfg(
      [U('l1', 'legal'), U('l2', 'legal'), U('f1', 'finance'), U('f2', 'finance')],
      'per_group', { minApprovals: 2 }), CTX);
    for (const u of ['l1', 'f1', 'l2']) {
      const r = await svc.decideNode(req.id, { decision: 'approve', actorId: u }, SYS);
      expect(r.finalized).toBe(false);
    }
    const done = await svc.decideNode(req.id, { decision: 'approve', actorId: 'f2' }, SYS);
    expect(done.finalized).toBe(true);
  });

  it('per_group: reject is a veto', async () => {
    const req = await svc.openNodeRequest(cfg([U('l1', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    const r = await svc.decideNode(req.id, { decision: 'reject', actorId: 'l1' }, SYS);
    expect(r.request.status).toBe('rejected');
  });

  it('per_group: an OOO-substituted member still counts for their group', async () => {
    engine._tables['sys_approval_delegation'] = [
      { id: 'd', delegator_id: 'l1', delegate_id: 'lb', organization_id: 't1', valid_from: null, valid_until: null, reason: 'leave' },
    ];
    const req = await svc.openNodeRequest(cfg([U('l1', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    expect(req.pending_approvers).toContain('lb');
    expect(req.pending_approvers).not.toContain('l1');
    const a = await svc.decideNode(req.id, { decision: 'approve', actorId: 'lb' }, SYS); // delegate covers legal
    expect(a.finalized).toBe(false);
    const b = await svc.decideNode(req.id, { decision: 'approve', actorId: 'f1' }, SYS);
    expect(b.finalized).toBe(true);
  });

  it('records decision attachments on the audit row', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9', attachments: ['file_1', 'file_2'] }, SYS);
    const act = engine._tables['sys_approval_action'].find((a: any) => a.action === 'approve');
    expect(act.attachments).toEqual(['file_1', 'file_2']);
  });
});

// ── Decision progress + notification deep links (#2678 P1.5) ──────────
describe('ApprovalService — decision_progress & deep links (#2678 P1.5)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;

  beforeEach(() => {
    engine = makeFakeEngine();
    let n = 0;
    const base = new Date('2026-09-01T09:00:00Z').getTime();
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(base + (n++) * 1000) } });
  });

  const cfg = (approvers: any[], behavior: string, extra: Record<string, any> = {}) => ({
    ...openInput([]),
    config: { approvers, behavior, lockRecord: true, ...extra },
  });
  const U = (v: string, group?: string) => (group ? { type: 'user', value: v, group } : { type: 'user', value: v });

  it('per_group: getRequest exposes per-group progress that updates per approval', async () => {
    const req = await svc.openNodeRequest(cfg([U('l1', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    let row: any = await svc.getRequest(req.id, SYS);
    expect(row.decision_progress).toMatchObject({ behavior: 'per_group', got: 0, need: 2 });
    expect(row.decision_progress.groups).toEqual([
      { group: 'finance', got: 0, need: 1, satisfied: false },
      { group: 'legal', got: 0, need: 1, satisfied: false },
    ]);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'l1' }, SYS);
    row = await svc.getRequest(req.id, SYS);
    expect(row.decision_progress.got).toBe(1);
    expect(row.decision_progress.groups.find((g: any) => g.group === 'legal')).toMatchObject({ got: 1, satisfied: true });
    expect(row.decision_progress.groups.find((g: any) => g.group === 'finance')).toMatchObject({ got: 0, satisfied: false });
  });

  it('per_group: pending_approver_groups maps each pending approver to its group (objectui#2807)', async () => {
    const req = await svc.openNodeRequest(cfg([U('l1', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    let row: any = await svc.getRequest(req.id, SYS);
    // Every pending slot is labeled with the group it fills.
    expect(row.pending_approver_groups).toEqual({ l1: ['legal'], f1: ['finance'] });
    // Once legal signs off, l1 drops out of pending — and out of the map.
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'l1' }, SYS);
    row = await svc.getRequest(req.id, SYS);
    expect(row.pending_approver_groups).toEqual({ f1: ['finance'] });
  });

  it('per_group with unnamed groups omits synthetic keys; non-per_group omits the map (objectui#2807)', async () => {
    // Distinct (record, run) so the two opens aren't a duplicate-pending clash.
    const mk = (approvers: any[], behavior: string, recordId: string, runId: string, extra: Record<string, any> = {}) => ({
      ...openInput([], { recordId, runId }),
      config: { approvers, behavior, lockRecord: true, ...extra },
    });
    // Unnamed approvers → synthetic `#N` group keys, which are not surfaced.
    const unnamed = await svc.openNodeRequest(mk([U('u1'), U('u2')], 'per_group', 'opp_u', 'run_u'), CTX);
    const uRow: any = await svc.getRequest(unnamed.id, SYS);
    expect(uRow.pending_approver_groups).toBeUndefined();
    // Quorum aggregates approvals, not groups — no approver→group map.
    const q = await svc.openNodeRequest(mk([U('a1'), U('a2')], 'quorum', 'opp_q', 'run_q', { minApprovals: 2 }), CTX);
    const qRow: any = await svc.getRequest(q.id, SYS);
    expect(qRow.pending_approver_groups).toBeUndefined();
  });

  it('quorum: progress reports approvals against the clamped threshold', async () => {
    const req = await svc.openNodeRequest(cfg([U('u1'), U('u2'), U('u3')], 'quorum', { minApprovals: 2 }), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    const row: any = await svc.getRequest(req.id, SYS);
    expect(row.decision_progress).toMatchObject({ behavior: 'quorum', got: 1, need: 2 });
  });

  it('first_response: no decision_progress', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const row: any = await svc.getRequest(req.id, SYS);
    expect(row.decision_progress).toBeUndefined();
  });

  it('notify: inbox actionUrl is rewritten to a request deep link', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(openInput(['u1', 'u2']), CTX);
    await svc.reassign(req.id, { actorId: 'u1', to: 'u7' }, SYS);
    const note = emitted.find(e => e.topic === 'approval.reassigned');
    expect(note.payload.actionUrl).toBe(`/system/approvals?request=${encodeURIComponent(req.id)}`);
  });
});

// listActions must surface decision attachments through the contract mapping
// (#3266 — the column existed but rowFromAction dropped it; caught in browser).
describe('ApprovalService — listActions attachments mapping (#3266)', () => {
  it('returns the attachments recorded on a decision', async () => {
    const engine = makeFakeEngine();
    let n = 0;
    const svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(1757000000000 + (n++) * 1000) } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9', attachments: ['file_a'] }, SYS);
    const acts = await svc.listActions(req.id, SYS);
    const approve = acts.find(a => a.action === 'approve');
    expect(approve?.attachments).toEqual(['file_a']);
  });
});
