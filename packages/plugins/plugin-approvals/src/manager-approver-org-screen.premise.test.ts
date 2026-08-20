// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * MEASUREMENT HARNESS for #10153 — it pins the CURRENT (defective) behaviour on
 * purpose, so the premise and the tiering question are reproducible rather than
 * argued. It is NOT the fix and it is NOT on a pull request.
 *
 * ⛔ Whoever implements the org screen must INVERT `PREMISE A` and `CLAUSE-2 (a)`
 * — they assert today's cross-org resolution, which is exactly what the fix
 * removes. `PREMISE B` / `B2` / `CLAUSE-2 (b)` describe the sibling treatment
 * and stay as they are.
 *
 * What it measures, all on one tree:
 *   A     — `manager` resolves a manager whose only `sys_member` row is in
 *           another organization, into this organization's approver slate.
 *   B/B2  — the sibling `position` expansion IS screened, and the screen is not
 *           reject-everything (a same-org holder still resolves).
 *   W     — `team` is NOT screened either, which is why #10153's warrant
 *           ("every sibling expansion is org-scoped") does not hold as stated.
 *   C-a/b — the tiering question: today a sole cross-org `manager` approver
 *           under `onEmptyApprovers: 'fail'` OPENS the request; a screened type
 *           in the identical shape THROWS `NO_APPROVERS`. Applying the screen
 *           therefore moves that input from accepted to refused.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { ApprovalService } from './approval-service.js';

function makeFakeEngine() {
  const tables: Record<string, any[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  function matches(row: any, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') { if (!(v as any[]).some(s => matches(row, s))) return false; continue; }
      if (k === '$and') { if (!(v as any[]).every(s => matches(row, s))) return false; continue; }
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false; continue;
      }
      if (v != null && typeof v === 'object' && '$ne' in (v as any)) {
        if (rv === (v as any).$ne) return false; continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }
  return {
    _tables: tables,
    async find(object: string, options?: any) {
      const rows = ensure(object).filter(r => matches(r, options?.filter ?? options?.where));
      return rows.slice(0, options?.limit ?? 1000);
    },
    async insert(object: string, data: any) { ensure(object).push({ ...data }); return { ...data }; },
    async update(object: string, data: any, options?: any) {
      // Pinned to ObjectQL.update's OWN dispatch predicate — a double looser
      // than the engine it stands in for turns a green suite into no suite.
      const dispatch = assertEngineUpdateDispatch(data, options);
      const t = ensure(object);
      if (dispatch.kind === 'multi') {
        let n = 0;
        for (let i = 0; i < t.length; i++) {
          if (matches(t[i], options?.where)) { t[i] = { ...t[i], ...data }; n++; }
        }
        return { updated: n };
      }
      const i = t.findIndex(r => r.id === dispatch.id);
      if (i >= 0) t[i] = { ...t[i], ...data };
      return t[i];
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const t = ensure(object);
      if (dispatch.kind === 'multi') {
        const survivors = t.filter(r => !matches(r, options?.where));
        const deleted = t.length - survivors.length;
        t.splice(0, t.length, ...survivors);
        return { deleted };
      }
      const i = t.findIndex(r => r.id === dispatch.id);
      if (i >= 0) t.splice(i, 1);
      return { id: dispatch.id };
    },
    registerHook() {}, unregisterHooksByPackage() { return 0; }, async fire() {},
  };
}

const ORG_A = 'org_a';
const CTX_A = { userId: 'u_sub', organizationId: ORG_A, positions: [], permissions: [] } as any;

function input(approvers: any[], configExtra: Record<string, any> = {}) {
  return {
    object: 'opportunity', recordId: 'opp1', runId: 'run_1', nodeId: 'approve_step',
    flowName: 'deal_approval',
    config: { approvers, behavior: 'first_response' as const, lockRecord: false, ...configExtra },
    record: { id: 'opp1', owner_id: 'u_sub', amount: 100 },
  };
}

describe('#10153 probe', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;

  beforeEach(() => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(new Date('2026-01-15T10:00:00Z').getTime() + (n++) * 1000) },
    });
    // Directory: submitter in org_a; his manager is a member of org_b ONLY.
    engine._tables['sys_user'] = [
      { id: 'u_sub', manager_id: 'u_mgr_b' },
      { id: 'u_mgr_b', manager_id: null },
    ];
    engine._tables['sys_member'] = [
      { id: 'm1', user_id: 'u_sub', organization_id: ORG_A, role: 'member' },
      { id: 'm2', user_id: 'u_mgr_b', organization_id: 'org_b', role: 'member' },
    ];
    // Sibling directory: the only `cfo` holder is in org_b.
    engine._tables['sys_user_position'] = [
      { id: 'p1', user_id: 'u_pos_b', position: 'cfo', organization_id: 'org_b' },
    ];
  });

  it('PREMISE A — `manager` resolves ACROSS the org boundary (unscreened)', async () => {
    const req = await svc.openNodeRequest(input([{ type: 'manager' }]), CTX_A);
    console.log('[PROBE A] request org =', req.organization_id, 'pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_mgr_b']);
  });

  it('PREMISE B — sibling `position` IS screened to the request org (same tree)', async () => {
    const req = await svc.openNodeRequest(input([{ type: 'position', value: 'cfo' }]), CTX_A);
    console.log('[PROBE B] pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['position:cfo']);
  });

  it('PREMISE B2 — same-org `position` holder DOES resolve (screen is not reject-everything)', async () => {
    engine._tables['sys_user_position'].push({ id: 'p2', user_id: 'u_pos_a', position: 'cfo', organization_id: ORG_A });
    const req = await svc.openNodeRequest(input([{ type: 'position', value: 'cfo' }]), CTX_A);
    console.log('[PROBE B2] pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_pos_a']);
  });

  it('CLAUSE-2 (a) — TODAY: sole cross-org `manager` + onEmptyApprovers:fail SUCCEEDS', async () => {
    const req = await svc.openNodeRequest(input([{ type: 'manager' }], { onEmptyApprovers: 'fail' }), CTX_A);
    console.log('[PROBE C-a] opened OK, status =', req.status, 'approvers =', JSON.stringify(req.pending_approvers));
    expect(req.status).toBe('pending');
  });

  it('CLAUSE-2 (b) — a SCREENED sibling in the same shape THROWS NO_APPROVERS', async () => {
    let err: any = null;
    try {
      await svc.openNodeRequest(input([{ type: 'position', value: 'cfo' }], { onEmptyApprovers: 'fail' }), CTX_A);
    } catch (e) { err = e; }
    console.log('[PROBE C-b] threw =', err ? String(err.message).slice(0, 90) : 'NOTHING');
    expect(err).toBeTruthy();
  });

  it('WARRANT — sibling `team` is NOT org-screened either (cross-org team resolves)', async () => {
    engine._tables['sys_team'] = [{ id: 'team_b', name: 'B team', organization_id: 'org_b' }];
    engine._tables['sys_team_member'] = [{ id: 'tm1', team_id: 'team_b', user_id: 'u_team_b' }];
    const req = await svc.openNodeRequest(input([{ type: 'team', value: 'team_b' }]), CTX_A);
    console.log('[PROBE W] org_a request, org_b team -> pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_team_b']);
  });
});
