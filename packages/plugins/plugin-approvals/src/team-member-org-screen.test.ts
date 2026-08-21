// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * #10547 — the expanded TEAM MEMBERS are screened to the request's organization.
 *
 * #10230 made the TEAM prove its tenancy. `sys_team_member` carries `team_id`
 * and `user_id` and no organization column at all
 * (`packages/platform-objects/src/identity/sys-team-member.object.ts`), so a
 * team that passes that screen still says nothing about the people it lists.
 *
 * The card filed itself as a CODE READING and asked for a measurement first.
 * Measured on this tree, same fixture, before the fix — quoted verbatim from
 * the probe:
 *
 *   [PROBE P] pending_approvers = ["u_outsider","u_insider"]
 *   [PROBE P] sys_member reads = 0
 *
 * `u_outsider`'s only `sys_member` row is in `org_b`; the request is `org_a`
 * and the team is stamped `org_a`. He held approval authority over an `org_a`
 * record, and nothing had read `sys_member` at all. The hole is reachable.
 *
 * Two directions are pinned throughout, because pinning only the first would
 * sit green over an implementation that screened out EVERY member — the exact
 * failure #10230's ablation leg B demonstrated on the sibling card:
 *
 *   M1    — a member provably outside the organization no longer enters the slate.
 *   M2    — a member of THIS organization still does.
 *   M3    — a member with NO `sys_member` row at all still does: the tenancy
 *           fact is ABSENT, and #3807 is the recorded cost of reading absent as
 *           negative (every seeded approver resolved to nobody).
 *   M4    — an unreadable `sys_member` leaves routing alone (fail-open on a
 *           fault, never an emptied live slate).
 *   M5    — a request carrying no organization is untouched, and performs no read.
 *   M6    — THE MIXED TEAM, both directions in one assertion: the outsider is
 *           dropped and the insider is kept, from one expansion.
 *   M7    — a member of the request's org AND another org still routes (holding
 *           membership elsewhere is not disqualifying; holding none here is).
 *   M8    — ONE read for the whole slate, not one per person.
 *   M9    — the drop is LOUD: the warning names the users, both organizations
 *           and the card.
 *   M10   — a TRUNCATED membership read fails OPEN. This read is the only
 *           evidence a member is a tenant here, so an incomplete result must not
 *           be spent as proof of absence.
 *   E1/E2 — the same two directions through the `expression` / `resolveAs:
 *           'team'` path, which is the second call site.
 *   C-b   — THE ACCEPT-TO-REJECT FLIP (Clause-2). Under `onEmptyApprovers:
 *           'fail'` a node whose sole approver is a same-org team staffed only
 *           by outsiders used to OPEN; it now throws `NO_APPROVERS`. That throw
 *           is PRE-EXISTING code and a bare `Error`, not a minted ADR-0112
 *           envelope — there is no `code` / `status` to assert here, and
 *           inventing one would be a fiction (the reading #10153 and #10230
 *           both record for their own flips).
 *   C-b2  — the same node under the DEFAULT policy (`admin_rescue`) still OPENS,
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

/** See the identical note in `team-approver-org-screen.test.ts` (#10230). */
function opened(result: ApprovalRequestRow | ApprovalNodeAutoOutcome): ApprovalRequestRow {
  if ('autoApproved' in result) {
    throw new Error('expected an OPENED approval request, got an auto-approval outcome');
  }
  return result;
}

const ORG_A = 'org_a';
const ORG_B = 'org_b';
const CTX_A = { userId: 'u_sub', organizationId: ORG_A, positions: [], permissions: [] } as any;
const TEAM_A = { type: 'team', value: 'team_a' };

function input(approvers: any[], configExtra: Record<string, any> = {}, recordId = 'opp1') {
  return {
    object: 'opportunity', recordId, runId: 'run_1', nodeId: 'approve_step',
    flowName: 'deal_approval',
    config: { approvers, behavior: 'first_response' as const, lockRecord: false, ...configExtra },
    record: { id: recordId, owner_id: 'u_sub', amount: 100 },
  };
}

describe('#10547 team MEMBER org screen', () => {
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
    // The TEAM is this organization's — it passes #10230's screen outright.
    // Everything below is therefore about its MEMBERS, never about the team.
    engine._tables['sys_team'] = [{ id: 'team_a', name: 'A team', organization_id: ORG_A }];
    engine._tables['sys_team_member'] = [{ id: 'tm1', team_id: 'team_a', user_id: 'u_outsider' }];
    engine._tables['sys_member'] = [{ id: 'm1', user_id: 'u_outsider', organization_id: ORG_B }];
  });

  it('M1 — a member provably outside the organization is screened OUT', async () => {
    const req = opened(await svc.openNodeRequest(input([TEAM_A]), CTX_A));
    console.log('[PROBE M1] org_a request, org_a team, org_b-only member -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    // Inverts the card's measured [PROBE P], which had u_outsider on the slate.
    expect(req.pending_approvers).toEqual(['team:team_a']);
    expect((req.pending_approvers ?? []).some((x: string) => !x.includes(':'))).toBe(false);
  });

  it('M2 — a member of THIS organization still routes', async () => {
    engine._tables['sys_team_member'] = [{ id: 'tm2', team_id: 'team_a', user_id: 'u_insider' }];
    engine._tables['sys_member'] = [{ id: 'm2', user_id: 'u_insider', organization_id: ORG_A }];
    const req = opened(await svc.openNodeRequest(input([TEAM_A]), CTX_A));
    console.log('[PROBE M2] same-org member -> pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_insider']);
  });

  it('M3 — a member with NO `sys_member` row at all still routes (fact absent, #3807)', async () => {
    engine._tables['sys_member'] = [];
    const req = opened(await svc.openNodeRequest(input([TEAM_A]), CTX_A));
    console.log('[PROBE M3] no membership rows -> pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_outsider']);
  });

  it('M4 — an unreadable `sys_member` leaves routing alone (fail-open on a fault)', async () => {
    const realFind = engine.find.bind(engine);
    engine.find = (async (object: string, options?: any) => {
      if (object === 'sys_member') throw new Error('connection reset');
      return realFind(object, options);
    }) as any;
    const req = opened(await svc.openNodeRequest(input([TEAM_A]), CTX_A));
    console.log('[PROBE M4] sys_member unreadable -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_outsider']);
  });

  it('M5 — a request carrying no organization is untouched, and reads no `sys_member`', async () => {
    const ctxNoOrg = { userId: 'u_sub', positions: [], permissions: [] } as any;
    engine._reads.length = 0;
    const req = opened(await svc.openNodeRequest(input([TEAM_A]), ctxNoOrg));
    console.log('[PROBE M5] no request org -> pending_approvers =',
      JSON.stringify(req.pending_approvers), '· sys_member reads =',
      engine._reads.filter(r => r === 'sys_member').length);
    expect(req.pending_approvers).toEqual(['u_outsider']);
    expect(engine._reads.filter(r => r === 'sys_member')).toEqual([]);
  });

  it('M6 — THE MIXED TEAM: the outsider is dropped and the insider is kept, one expansion', async () => {
    engine._tables['sys_team_member'].push({ id: 'tm2', team_id: 'team_a', user_id: 'u_insider' });
    engine._tables['sys_member'].push({ id: 'm2', user_id: 'u_insider', organization_id: ORG_A });
    const req = opened(await svc.openNodeRequest(input([TEAM_A]), CTX_A));
    console.log('[PROBE M6] mixed team -> pending_approvers =', JSON.stringify(req.pending_approvers));
    // An implementation that screened out EVERYONE would yield ['team:team_a']
    // and an unscreened one ['u_outsider','u_insider']. Only the correct one
    // yields exactly the insider.
    expect(req.pending_approvers).toEqual(['u_insider']);
  });

  it('M7 — a member of this org AND another still routes (multi-org membership is fine)', async () => {
    engine._tables['sys_member'] = [
      { id: 'm1', user_id: 'u_outsider', organization_id: ORG_B },
      { id: 'm3', user_id: 'u_outsider', organization_id: ORG_A },
    ];
    const req = opened(await svc.openNodeRequest(input([TEAM_A]), CTX_A));
    console.log('[PROBE M7] member of both orgs -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_outsider']);
  });

  it('M8 — ONE `sys_member` read for the whole slate, not one per person', async () => {
    for (let i = 0; i < 5; i++) {
      engine._tables['sys_team_member'].push({ id: `tmx${i}`, team_id: 'team_a', user_id: `u${i}` });
      engine._tables['sys_member'].push({ id: `mx${i}`, user_id: `u${i}`, organization_id: ORG_A });
    }
    engine._reads.length = 0;
    const req = opened(await svc.openNodeRequest(input([TEAM_A]), CTX_A));
    const reads = engine._reads.filter(r => r === 'sys_member').length;
    console.log('[PROBE M8] 6-member team -> sys_member reads =', reads,
      '· pending_approvers =', JSON.stringify(req.pending_approvers));
    expect(reads).toBe(1);
    expect(req.pending_approvers).toEqual(['u0', 'u1', 'u2', 'u3', 'u4']);
  });

  it('M9 — the drop is loud: the warning names the users, both organizations and the card', async () => {
    await svc.openNodeRequest(input([TEAM_A]), CTX_A);
    const hit = warnings.find(([msg]) => String(msg).includes('#10547'));
    console.log('[PROBE M9] warning =', hit ? String(hit[0]).slice(0, 100) : 'NONE');
    expect(hit).toBeTruthy();
    expect(String(hit![0])).toContain(ORG_A);
    expect(hit![1]).toMatchObject({
      teamId: 'team_a', requestOrganizationId: ORG_A, droppedUserIds: ['u_outsider'],
    });
    expect(hit![1].droppedMemberOrganizationIds).toEqual([[ORG_B]]);
  });

  it('M10 — a TRUNCATED membership read fails OPEN, never closed', async () => {
    // The screen asks for at most MEMBER_SCREEN_READ_LIMIT rows. A driver that
    // returns the cap may have more behind it, so the evidence is incomplete —
    // and incomplete evidence must not be spent as proof that a member is not a
    // tenant here.
    const realFind = engine.find.bind(engine);
    engine.find = (async (object: string, options?: any) => {
      if (object === 'sys_member') {
        const cap = Number(options?.limit ?? 0);
        return Array.from({ length: cap }, (_, i) => (
          { id: `flood${i}`, user_id: 'someone_else', organization_id: ORG_B }
        ));
      }
      return realFind(object, options);
    }) as any;
    const req = opened(await svc.openNodeRequest(input([TEAM_A]), CTX_A));
    console.log('[PROBE M10] truncated membership read -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_outsider']);
    expect(warnings.some(([m]) => String(m).includes('truncated'))).toBe(true);
  });

  it('E1 — the `expression` / resolveAs:team path screens the outside member too', async () => {
    const req = opened(await svc.openNodeRequest(input([
      { type: 'expression', value: '"team_a"', resolveAs: 'team' },
    ]), CTX_A));
    console.log('[PROBE E1] expression resolveAs:team, org_b-only member -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['team:team_a']);
  });

  it('E2 — the same path still routes a SAME-org member', async () => {
    engine._tables['sys_team_member'] = [{ id: 'tm2', team_id: 'team_a', user_id: 'u_insider' }];
    engine._tables['sys_member'] = [{ id: 'm2', user_id: 'u_insider', organization_id: ORG_A }];
    const req = opened(await svc.openNodeRequest(input([
      { type: 'expression', value: '"team_a"', resolveAs: 'team' },
    ]), CTX_A));
    console.log('[PROBE E2] expression resolveAs:team, same-org member -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_insider']);
  });

  it('C-b — THE FLIP: sole same-org team staffed only by outsiders + onEmptyApprovers:fail THROWS', async () => {
    let err: any = null;
    try {
      await svc.openNodeRequest(input([TEAM_A], { onEmptyApprovers: 'fail' }), CTX_A);
    } catch (e) { err = e; }
    console.log('[PROBE C-b] threw =', err ? String(err.message).slice(0, 90) : 'NOTHING');
    expect(err).toBeTruthy();
    expect(String(err.message)).toMatch(/^NO_APPROVERS:/);
  });

  it('C-b2 — the SAME node under the DEFAULT policy still opens (the flip is confined)', async () => {
    const req = opened(await svc.openNodeRequest(input([TEAM_A]), CTX_A)); // absent => admin_rescue
    console.log('[PROBE C-b2] status =', req.status, 'approvers =', JSON.stringify(req.pending_approvers));
    expect(req.status).toBe('pending');
    expect(req.pending_approvers).toEqual(['team:team_a']);
  });
});
