// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * #10153 — the `manager` approver is screened to the request's organization.
 *
 * This file began as round 1's MEASUREMENT HARNESS, which pinned the defective
 * behaviour on purpose so the premise and the tiering question were
 * reproducible rather than argued. `PREMISE A` and `CLAUSE-2 (a)` asserted
 * today's cross-org resolution; the fix inverts both, exactly as that file's
 * header instructed. The probes that describe the SIBLING treatment (`B`,
 * `B2`, `C-b`) and the `team` gap (`W`) are unchanged, and they are what makes
 * the inversion readable: the same tree, the same run, one screened type next
 * to the newly screened one.
 *
 * What it pins, both directions and both policies:
 *   A     — a manager whose only `sys_member` row is in ANOTHER organization no
 *           longer resolves into this organization's slate.
 *   A2    — a manager who IS a member here still resolves. Without this, a
 *           screen that rejected everything would pass A.
 *   A3    — a manager with NO membership row anywhere still resolves: the
 *           tenancy fact is absent, so routing is left exactly as it was.
 *   A4    — a request with no organization at all is untouched (no screen, and
 *           no read to perform it).
 *   B/B2  — the sibling `position` expansion IS screened, and its screen is not
 *           reject-everything.
 *   W     — `team` was still NOT screened when this file was written; #10230
 *           closed that and INVERTED this pin. It stays here as the cross-file
 *           statement that no unscreened expansion is left.
 *   C-a   — THE ACCEPT-TO-REJECT FLIP. Under `onEmptyApprovers: 'fail'` a node
 *           whose sole approver is a cross-org `manager` used to OPEN; it now
 *           throws `NO_APPROVERS`. That throw is PRE-EXISTING code and a bare
 *           `Error`, not a minted ADR-0112 envelope — there is no `code` /
 *           `status` to assert here, and inventing one would be a fiction.
 *   C-a2  — the same node under the DEFAULT policy (`admin_rescue`) still
 *           OPENS. This is what confines the flip to one non-default policy.
 *   C-b   — a screened sibling in the identical shape throws too (unchanged).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import type { ApprovalRequestRow } from '@objectstack/spec/contracts';
import { ApprovalService, type ApprovalNodeAutoOutcome } from './approval-service.js';

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

/**
 * `openNodeRequest` returns `ApprovalRequestRow | ApprovalNodeAutoOutcome` — the
 * second arm is the `onEmptyApprovers: 'auto_approve'` exit, which opens no
 * request at all. Narrow rather than read through the union: every probe below
 * asserts something about an OPENED request, so an auto-approval reaching one of
 * them is a wrong answer that must say so, not a property read off the wrong arm.
 * (Left unnarrowed this file billed the package's TEST_DEBT ledger 21 raw TS2339
 * — invisible to `pnpm --filter @objectstack/plugin-approvals typecheck`, whose
 * tsconfig excludes `**\/*.test.ts`, and caught only by `check:type-check-debt
 * --re-measure`.)
 */
function opened(result: ApprovalRequestRow | ApprovalNodeAutoOutcome): ApprovalRequestRow {
  if ('autoApproved' in result) {
    throw new Error('expected an OPENED approval request, got an auto-approval outcome');
  }
  return result;
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

describe('#10153 manager approver org screen', () => {
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

  // `ApprovalRequestRow` — the PUBLISHED contract type — declares no
  // `organization_id`, though `openNodeRequest` stamps one on the row it writes
  // and returns. Read the stamp off the persisted row rather than through a
  // property the contract does not have. (Filed separately; not this card.)
  const storedOrg = () => (engine._tables['sys_approval_request'] ?? [])[0]?.organization_id;

  // `{ type: 'manager' }` and `{ type: 'manager', value: 'owner_id' }` resolve
  // through the same line (`record[a.value] ?? record.owner_id`); the explicit
  // spelling is used from here on only so the unresolved fallback slot reads as
  // `manager:owner_id` rather than `manager:undefined`.
  const MGR = { type: 'manager', value: 'owner_id' };

  it('A — a manager whose membership is in ANOTHER organization is screened OUT', async () => {
    const req = opened(await svc.openNodeRequest(input([MGR]), CTX_A));
    console.log('[PROBE A] request org =', storedOrg(), 'pending_approvers =', JSON.stringify(req.pending_approvers));
    // Inverted from round 1, which measured ['u_mgr_b'] here.
    expect(req.pending_approvers).toEqual(['manager:owner_id']);
    expect((req.pending_approvers ?? []).some((x: string) => !x.includes(':'))).toBe(false);
  });

  it('A2 — a manager who IS a member of the request org still resolves', async () => {
    engine._tables['sys_member'].push({ id: 'm3', user_id: 'u_mgr_b', organization_id: ORG_A, role: 'member' });
    const req = opened(await svc.openNodeRequest(input([MGR]), CTX_A));
    console.log('[PROBE A2] pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_mgr_b']);
  });

  it('A3 — a manager with NO membership row anywhere is left alone (no tenancy fact)', async () => {
    engine._tables['sys_member'] = engine._tables['sys_member'].filter((m: any) => m.user_id !== 'u_mgr_b');
    const req = opened(await svc.openNodeRequest(input([MGR]), CTX_A));
    console.log('[PROBE A3] pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_mgr_b']);
  });

  it('A4 — a request carrying no organization is untouched by the screen', async () => {
    const ctxNoOrg = { userId: 'u_sub', positions: [], permissions: [] } as any;
    const req = opened(await svc.openNodeRequest(input([MGR]), ctxNoOrg));
    console.log('[PROBE A4] request org =', storedOrg(), 'pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_mgr_b']);
  });

  it('PREMISE B — sibling `position` IS screened to the request org (same tree)', async () => {
    const req = opened(await svc.openNodeRequest(input([{ type: 'position', value: 'cfo' }]), CTX_A));
    console.log('[PROBE B] pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['position:cfo']);
  });

  it('PREMISE B2 — same-org `position` holder DOES resolve (screen is not reject-everything)', async () => {
    engine._tables['sys_user_position'].push({ id: 'p2', user_id: 'u_pos_a', position: 'cfo', organization_id: ORG_A });
    const req = opened(await svc.openNodeRequest(input([{ type: 'position', value: 'cfo' }]), CTX_A));
    console.log('[PROBE B2] pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_pos_a']);
  });

  it('C-a — THE FLIP: sole cross-org `manager` + onEmptyApprovers:fail now THROWS', async () => {
    // Round 1 measured this same call OPENING (status 'pending'). This is the
    // accept-to-reject flip that re-graded the card `Clause-2: yes`, pinned so
    // a reviewer reads it here rather than discovering it.
    let err: any = null;
    try {
      await svc.openNodeRequest(input([MGR], { onEmptyApprovers: 'fail' }), CTX_A);
    } catch (e) { err = e; }
    console.log('[PROBE C-a] threw =', err ? String(err.message).slice(0, 90) : 'NOTHING');
    expect(err).toBeTruthy();
    expect(String(err.message)).toMatch(/^NO_APPROVERS:/);
  });

  it('C-a2 — the SAME node under the DEFAULT policy still opens (the flip is confined)', async () => {
    const req = opened(await svc.openNodeRequest(input([MGR]), CTX_A)); // onEmptyApprovers absent => admin_rescue
    console.log('[PROBE C-a2] status =', req.status, 'approvers =', JSON.stringify(req.pending_approvers));
    expect(req.status).toBe('pending');
    expect(req.pending_approvers).toEqual(['manager:owner_id']);
  });

  it('CLAUSE-2 (b) — a SCREENED sibling in the same shape THROWS NO_APPROVERS', async () => {
    let err: any = null;
    try {
      await svc.openNodeRequest(input([{ type: 'position', value: 'cfo' }], { onEmptyApprovers: 'fail' }), CTX_A);
    } catch (e) { err = e; }
    console.log('[PROBE C-b] threw =', err ? String(err.message).slice(0, 90) : 'NOTHING');
    expect(err).toBeTruthy();
  });

  it('W — `team` IS org-screened now too (#10230 landed; the gap this pin held is closed)', async () => {
    engine._tables['sys_team'] = [{ id: 'team_b', name: 'B team', organization_id: 'org_b' }];
    engine._tables['sys_team_member'] = [{ id: 'tm1', team_id: 'team_b', user_id: 'u_team_b' }];
    const req = opened(await svc.openNodeRequest(input([{ type: 'team', value: 'team_b' }]), CTX_A));
    console.log('[PROBE W] org_a request, org_b team -> pending_approvers =', JSON.stringify(req.pending_approvers));
    // Inverted by #10230, which this pin was written to hand off to. The two
    // directions and the `null` / absent-row limbs live in that card's own file
    // (`team-approver-org-screen.test.ts`); what stays HERE is the cross-file
    // fact this file exists to keep true — the last unscreened expansion is gone.
    expect(req.pending_approvers).toEqual(['team:team_b']);
  });
});
