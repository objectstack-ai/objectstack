// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * #10230 — the `team` approver expansion is screened to the request's organization.
 *
 * `team` was the LAST approver expansion that resolved people without asking
 * which organization was asking. Measured on this tree before the fix, and
 * quoted verbatim from the card:
 *
 *   [PROBE W] org_a request, org_b team -> pending_approvers = ["u_team_b"]
 *
 * Two directions are pinned throughout, because only pinning the first would
 * sit green over an implementation that filtered out EVERY team:
 *
 *   T1    — a team stamped with ANOTHER organization no longer enters the slate.
 *   T2    — a team stamped with THIS organization still does.
 *   T3    — a team stamped with NO organization (`organization_id: null`) still
 *           does: on a platform object that means "owned by no organization",
 *           the shape a seed writes, not "owned by someone else".
 *   T4    — a `team_id` with no `sys_team` row at all still does — the tenancy
 *           fact is absent, so routing is left exactly as it was. This package's
 *           own `team_ok` expansion fixture is such a stack.
 *   T5    — an unreadable `sys_team` leaves routing alone (fail-open on an
 *           infrastructure fault, never an emptied live slate).
 *   T6    — a request carrying no organization is untouched, and performs no read.
 *   T7    — the drop is LOUD: the warning names the team, both organizations
 *           and the card.
 *   E1/E2 — the same two directions through the `expression` / `resolveAs:
 *           'team'` path, which is the second call site.
 *   X1    — the failure SHAPE matches the screened siblings: the slot falls back
 *           to the dead `team:<id>` literal, exactly as a cross-org `position`
 *           resolves to `position:cfo` (asserted here, in the same run, on the
 *           same tree).
 *   C-a   — THE ACCEPT-TO-REJECT FLIP (Clause-2). Under `onEmptyApprovers:
 *           'fail'` a node whose sole approver is a cross-org `team` used to
 *           OPEN; it now throws `NO_APPROVERS`. That throw is PRE-EXISTING code
 *           and a bare `Error`, not a minted ADR-0112 envelope — there is no
 *           `code` / `status` to assert here, and inventing one would be a
 *           fiction (the same reading #10153's file records for its own flip).
 *   C-a2  — the same node under the DEFAULT policy (`admin_rescue`) still OPENS,
 *           which is what confines the flip to one non-default policy.
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
    _reads: [] as string[],
    async find(object: string, options?: any) {
      this._reads.push(object);
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
 * asserts something about an OPENED request, so an auto-approval reaching one
 * of them is a wrong answer that must say so, not a property read off the wrong
 * arm. (Left unnarrowed, a file like this one bills the package's TEST_DEBT
 * ledger in raw TS2339 — invisible to the package `typecheck`, whose tsconfig
 * excludes `**\/*.test.ts`.)
 */
function opened(result: ApprovalRequestRow | ApprovalNodeAutoOutcome): ApprovalRequestRow {
  if ('autoApproved' in result) {
    throw new Error('expected an OPENED approval request, got an auto-approval outcome');
  }
  return result;
}

const ORG_A = 'org_a';
const ORG_B = 'org_b';
const CTX_A = { userId: 'u_sub', organizationId: ORG_A, positions: [], permissions: [] } as any;
const TEAM_B = { type: 'team', value: 'team_b' };

// `recordId` is a parameter because X1 opens TWO requests in one test and
// `openNodeRequest` refuses a second pending approval on the same record
// (`DUPLICATE_REQUEST`) — a real guard, not something to route around.
function input(approvers: any[], configExtra: Record<string, any> = {}, recordId = 'opp1') {
  return {
    object: 'opportunity', recordId, runId: 'run_1', nodeId: 'approve_step',
    flowName: 'deal_approval',
    config: { approvers, behavior: 'first_response' as const, lockRecord: false, ...configExtra },
    record: { id: recordId, owner_id: 'u_sub', amount: 100 },
  };
}

describe('#10230 team approver org screen', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let warnings: Array<[any, any]>;
  let n = 0;

  beforeEach(() => {
    engine = makeFakeEngine();
    warnings = [];
    n = 0;
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(new Date('2026-01-15T10:00:00Z').getTime() + (n++) * 1000) },
      logger: { warn: (msg: any, meta: any) => warnings.push([msg, meta]) } as any,
    });
    // `team_b` belongs to org_b; the request below is raised in org_a.
    engine._tables['sys_team'] = [{ id: 'team_b', name: 'B team', organization_id: ORG_B }];
    engine._tables['sys_team_member'] = [{ id: 'tm1', team_id: 'team_b', user_id: 'u_team_b' }];
    // Sibling directory, for the failure-shape contrast in X1: the only `cfo`
    // holder is in org_b too.
    engine._tables['sys_user_position'] = [
      { id: 'p1', user_id: 'u_pos_b', position: 'cfo', organization_id: ORG_B },
    ];
  });

  it('T1 — a team belonging to ANOTHER organization is screened OUT', async () => {
    const req = opened(await svc.openNodeRequest(input([TEAM_B]), CTX_A));
    console.log('[PROBE T1] org_a request, org_b team -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    // Inverts the card's [PROBE W], which measured ["u_team_b"] here.
    expect(req.pending_approvers).toEqual(['team:team_b']);
    expect((req.pending_approvers ?? []).some((x: string) => !x.includes(':'))).toBe(false);
  });

  it('T2 — a team belonging to THIS organization still resolves', async () => {
    engine._tables['sys_team'].push({ id: 'team_a', name: 'A team', organization_id: ORG_A });
    engine._tables['sys_team_member'].push({ id: 'tm2', team_id: 'team_a', user_id: 'u_team_a' });
    const req = opened(await svc.openNodeRequest(input([{ type: 'team', value: 'team_a' }]), CTX_A));
    console.log('[PROBE T2] same-org team -> pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_team_a']);
  });

  it('T3 — a team stamped with NO organization (seeded / env-wide) still resolves', async () => {
    engine._tables['sys_team'] = [{ id: 'team_b', name: 'seeded', organization_id: null }];
    const req = opened(await svc.openNodeRequest(input([TEAM_B]), CTX_A));
    console.log('[PROBE T3] null-org team -> pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_team_b']);
  });

  it('T4 — a team with NO `sys_team` row at all still resolves (no tenancy fact)', async () => {
    engine._tables['sys_team'] = [];
    const req = opened(await svc.openNodeRequest(input([TEAM_B]), CTX_A));
    console.log('[PROBE T4] no team row -> pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_team_b']);
  });

  it('T5 — an unreadable `sys_team` leaves routing alone (fail-open on a fault)', async () => {
    const realFind = engine.find.bind(engine);
    engine.find = (async (object: string, options?: any) => {
      if (object === 'sys_team') throw new Error('connection reset');
      return realFind(object, options);
    }) as any;
    const req = opened(await svc.openNodeRequest(input([TEAM_B]), CTX_A));
    console.log('[PROBE T5] sys_team unreadable -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_team_b']);
  });

  it('T6 — a request carrying no organization is untouched, and reads no `sys_team`', async () => {
    const ctxNoOrg = { userId: 'u_sub', positions: [], permissions: [] } as any;
    engine._reads.length = 0;
    const req = opened(await svc.openNodeRequest(input([TEAM_B]), ctxNoOrg));
    console.log('[PROBE T6] no request org -> pending_approvers =',
      JSON.stringify(req.pending_approvers), '· sys_team reads =',
      engine._reads.filter(r => r === 'sys_team').length);
    expect(req.pending_approvers).toEqual(['u_team_b']);
    expect(engine._reads.filter(r => r === 'sys_team')).toEqual([]);
  });

  it('T7 — the drop is loud: the warning names the team, both organizations and the card', async () => {
    await svc.openNodeRequest(input([TEAM_B]), CTX_A);
    const hit = warnings.find(([msg]) => String(msg).includes('#10230'));
    console.log('[PROBE T7] warning =', hit ? String(hit[0]).slice(0, 90) : 'NONE');
    expect(hit).toBeTruthy();
    expect(hit![1]).toMatchObject({
      teamId: 'team_b', teamOrganizationId: ORG_B, requestOrganizationId: ORG_A,
    });
  });

  it('E1 — the `expression` / resolveAs:team path screens the cross-org team too', async () => {
    const req = opened(await svc.openNodeRequest(input([
      { type: 'expression', value: '"team_b"', resolveAs: 'team' },
    ]), CTX_A));
    console.log('[PROBE E1] expression resolveAs:team, org_b team -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['team:team_b']);
  });

  it('E2 — the same path still resolves a SAME-org team', async () => {
    engine._tables['sys_team'].push({ id: 'team_a', name: 'A team', organization_id: ORG_A });
    engine._tables['sys_team_member'].push({ id: 'tm2', team_id: 'team_a', user_id: 'u_team_a' });
    const req = opened(await svc.openNodeRequest(input([
      { type: 'expression', value: '"team_a"', resolveAs: 'team' },
    ]), CTX_A));
    console.log('[PROBE E2] expression resolveAs:team, same-org team -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_team_a']);
  });

  it('X1 — the failure SHAPE matches the screened sibling `position`, same tree, same run', async () => {
    const team = opened(await svc.openNodeRequest(input([TEAM_B]), CTX_A));
    const position = opened(await svc.openNodeRequest(
      input([{ type: 'position', value: 'cfo' }], {}, 'opp2'), CTX_A,
    ));
    console.log('[PROBE X1] team =', JSON.stringify(team.pending_approvers),
      '· position =', JSON.stringify(position.pending_approvers));
    // Both fall back to the dead `type:value` literal. The card asked whether
    // `team` should differ here; measured, there is no reason to — the literal
    // fallback is the file's single answer to "the graph resolved nobody", it
    // keeps 15.x stored slots working, and #3807's warning makes it visible.
    expect(team.pending_approvers).toEqual(['team:team_b']);
    expect(position.pending_approvers).toEqual(['position:cfo']);
  });

  it('C-a — THE FLIP: sole cross-org `team` + onEmptyApprovers:fail now THROWS', async () => {
    let err: any = null;
    try {
      await svc.openNodeRequest(input([TEAM_B], { onEmptyApprovers: 'fail' }), CTX_A);
    } catch (e) { err = e; }
    console.log('[PROBE C-a] threw =', err ? String(err.message).slice(0, 90) : 'NOTHING');
    expect(err).toBeTruthy();
    expect(String(err.message)).toMatch(/^NO_APPROVERS:/);
  });

  it('C-a2 — the SAME node under the DEFAULT policy still opens (the flip is confined)', async () => {
    const req = opened(await svc.openNodeRequest(input([TEAM_B]), CTX_A)); // absent => admin_rescue
    console.log('[PROBE C-a2] status =', req.status, 'approvers =', JSON.stringify(req.pending_approvers));
    expect(req.status).toBe('pending');
    expect(req.pending_approvers).toEqual(['team:team_b']);
  });
});
