// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * #14946 — the expanded BUSINESS-UNIT MEMBERS are screened to the directory
 * organization, with a STRICT equality.
 *
 * `expandBusinessUnitUsers` screens the `sys_business_unit` rows with
 * `businessUnitOrgScope` — null-inclusive since #3807, because a seeded unit
 * carries `organization_id = null` by construction and is admitted on purpose.
 * The `sys_business_unit_member` read that follows carried NO organization
 * predicate at all, under `SYSTEM_CTX`, which carries no tenant either. A
 * seeded unit id exists identically in every tenant, so tenant A's request
 * resolved that unit and then collected EVERY tenant's membership rows off it.
 *
 * Why the member screen is strict where the unit screen is not — measured on
 * this tree, not inherited from the sibling card:
 *
 *   - `sys_business_unit_member` declares no `organization_id`
 *     (`packages/platform-objects/src/identity/sys-business-unit-member.object.ts`);
 *     the column is INJECTED (`applySystemFields`, `injected-system-columns.ts`)
 *     and the tenancy census lists the object `reach: "in"` with
 *     `tenantField: "organization_id"`;
 *   - REST / session writes fill it (`SqlDriver.injectTenantOnInsert`); seed
 *     replay does not (`seed-loader.ts` withholds its `fallbackOrgId` from
 *     every `sys_` object); elevated system-context writes do not either
 *     (`unclassified` in `PLATFORM_OBJECT_TENANCY`, tracked as #14570).
 *
 *   ⇒ a NULL there means UNKNOWN tenancy, not "platform-global", and routing
 *   approval authority over tenant A's record to an identity of unknown
 *   tenancy is the same cross-tenant hole by the other door. The screen fails
 *   CLOSED, exactly as `plugin-sharing`'s `memberScope` does for the same rows.
 *
 * Every anchor unit below is SEEDED (`organization_id: null`) unless a case
 * says otherwise. That is load-bearing: on an org-stamped unit the assertions
 * would hold even if the member screen were deleted, because the unit screen
 * would answer first. Anchoring on a seeded unit is what makes each case a pin
 * on the MEMBER screen.
 *
 *   B1  — THE LEAK: a seeded unit with two tenants' membership rows resolves
 *         ONLY the request organization's users, at both depths of the walk.
 *   B2  — THE CONTROL: an org-stamped unit still routes its own members —
 *         strict, not broken — and still drops the other tenant's row.
 *   B3  — THE DECLARED COST: org-less membership rows (seed replay, elevated
 *         writes) do NOT route when the request carries an organization; the
 *         slot falls to the literal and the #3807 warning fires, so the empty
 *         slate is loud rather than silent.
 *   B4  — a request carrying no organization is untouched: every member
 *         routes and the read carries no organization predicate.
 *   B5  — THE SHAPE: the member read carries a strict `organization_id`
 *         equality and no `$or` null arm, in ONE read for the whole subtree.
 *   B6  — the `expression` / `resolveAs: 'department'` call site is closed too.
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
      // A row that simply omits the column is `undefined`, which a strict
      // `organization_id: 'org_a'` equality must NOT match — the same answer
      // a SQL `organization_id = ?` gives an unstamped row.
      if (rv !== v) return false;
    }
    return true;
  }
  return {
    _tables: tables,
    /** Every `find` anyone made, with its options — pins the predicate SHAPE (B5). */
    _finds: [] as Array<{ object: string; options: any }>,
    async find(object: string, options?: any) {
      this._finds.push({ object, options });
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
/** No organization anywhere on the request — the single-org / embedded stack. */
const CTX_NO_ORG = { userId: 'u_sub', positions: [], permissions: [] } as any;
const DEPT_SEEDED = { type: 'department', value: 'bu_seeded' };

/**
 * The org chart the card describes: a SEEDED unit tree (`organization_id:
 * null`, which `businessUnitOrgScope` admits by design) — the same unit ids
 * in every tenant.
 */
const SEEDED_TREE = [
  { id: 'bu_seeded', organization_id: null, active: true },
  { id: 'bu_seeded_child', parent_business_unit_id: 'bu_seeded', organization_id: null, active: true },
];

/**
 * Two tenants' membership rows on that shared tree, at both depths — the
 * shape the REST/session write path produces on a real multi-tenant
 * deployment, since it stamps `organization_id` from the caller's tenant.
 */
const TWO_TENANT_MEMBERS = [
  { id: 'bm_a', business_unit_id: 'bu_seeded', user_id: 'u_a', organization_id: ORG_A },
  { id: 'bm_b', business_unit_id: 'bu_seeded', user_id: 'u_b', organization_id: ORG_B },
  { id: 'bm_a_child', business_unit_id: 'bu_seeded_child', user_id: 'u_a_child', organization_id: ORG_A },
  { id: 'bm_b_child', business_unit_id: 'bu_seeded_child', user_id: 'u_b_child', organization_id: ORG_B },
];

function input(approvers: any[], configExtra: Record<string, any> = {}, extra: Record<string, any> = {}) {
  return {
    object: 'opportunity', recordId: 'opp1', runId: 'run_1', nodeId: 'approve_step',
    flowName: 'deal_approval',
    config: { approvers, behavior: 'first_response' as const, lockRecord: false, ...configExtra },
    record: { id: 'opp1', owner_id: 'u_sub', amount: 100 },
    ...extra,
  };
}

describe('#14946 business-unit MEMBER org screen', () => {
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
    engine._tables['sys_business_unit'] = SEEDED_TREE.map(r => ({ ...r }));
    engine._tables['sys_business_unit_member'] = TWO_TENANT_MEMBERS.map(r => ({ ...r }));
  });

  const memberReads = () => engine._finds.filter(f => f.object === 'sys_business_unit_member');

  it('B1 — THE LEAK: a seeded unit resolves ONLY the request organization\'s members, at both depths', async () => {
    const req = opened(await svc.openNodeRequest(input([DEPT_SEEDED]), CTX_A));
    console.log('[PROBE B1] org_a request, seeded unit, org_a+org_b members -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect([...(req.pending_approvers ?? [])].sort()).toEqual(['u_a', 'u_a_child']);
    expect(req.pending_approvers).not.toContain('u_b');
    expect(req.pending_approvers).not.toContain('u_b_child');
  });

  it('B2 — THE CONTROL: an org-stamped unit still routes its own members, and still drops the other tenant\'s', async () => {
    // The unit screen admits this unit outright, so anything dropped here is
    // the MEMBER screen's doing — and anything kept proves it is strict, not
    // "refuses everything".
    engine._tables['sys_business_unit'] = [{ id: 'bu_mine', organization_id: ORG_A, active: true }];
    engine._tables['sys_business_unit_member'] = [
      { id: 'bm1', business_unit_id: 'bu_mine', user_id: 'u_a', organization_id: ORG_A },
      { id: 'bm2', business_unit_id: 'bu_mine', user_id: 'u_b', organization_id: ORG_B },
    ];
    const req = opened(await svc.openNodeRequest(input([{ type: 'department', value: 'bu_mine' }]), CTX_A));
    console.log('[PROBE B2] org_a request, org_a unit, org_a+org_b members -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['u_a']);
  });

  it('B3 — THE DECLARED COST: org-less membership rows do NOT route when the request carries an organization, and the empty slate is LOUD', async () => {
    // Seed replay and elevated system writes both leave `organization_id`
    // NULL (#14570). Unknown tenancy is not "this organization": the slot
    // falls to the literal, which #3807's warning already reports.
    engine._tables['sys_business_unit_member'] = [
      { id: 'bm_seeded', business_unit_id: 'bu_seeded', user_id: 'u_seeded', organization_id: null },
      { id: 'bm_unstamped', business_unit_id: 'bu_seeded_child', user_id: 'u_unstamped' },
    ];
    const req = opened(await svc.openNodeRequest(input([DEPT_SEEDED]), CTX_A));
    console.log('[PROBE B3] org_a request, seeded unit, org-less members -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect(req.pending_approvers).toEqual(['department:bu_seeded']);
    const loud = warnings.find(([msg]) => String(msg).includes("approver 'department:bu_seeded' expanded to nobody"));
    expect(loud).toBeDefined();
    expect(loud?.[1]).toMatchObject({ type: 'department', value: 'bu_seeded', organizationId: ORG_A });
  });

  it('B4 — a request carrying no organization is untouched: every member routes, no organization predicate', async () => {
    const req = opened(await svc.openNodeRequest(input([DEPT_SEEDED]), CTX_NO_ORG));
    console.log('[PROBE B4] org-less request -> pending_approvers =', JSON.stringify(req.pending_approvers));
    expect([...(req.pending_approvers ?? [])].sort()).toEqual(['u_a', 'u_a_child', 'u_b', 'u_b_child']);
    const reads = memberReads();
    expect(reads.length).toBe(1);
    const where = reads[0].options?.where ?? reads[0].options?.filter ?? {};
    expect(where).not.toHaveProperty('organization_id');
    expect(where).not.toHaveProperty('$or');
  });

  it('B5 — THE SHAPE: one member read for the whole subtree, carrying a strict equality and no null arm', async () => {
    await svc.openNodeRequest(input([DEPT_SEEDED]), CTX_A);
    const reads = memberReads();
    expect(reads.length).toBe(1);
    const where = reads[0].options?.where ?? reads[0].options?.filter ?? {};
    console.log('[PROBE B5] sys_business_unit_member where =', JSON.stringify(where));
    expect(where.organization_id).toBe(ORG_A);
    // ⛔ Not `businessUnitOrgScope`'s `$or: [{organization_id}, {organization_id: null}]`.
    // A null arm here would re-admit every org-less row — the B3 population —
    // and re-open the hole for the elevated-write case.
    expect(where).not.toHaveProperty('$or');
    expect([...(where.business_unit_id?.$in ?? [])].sort()).toEqual(['bu_seeded', 'bu_seeded_child']);
  });

  it('B6 — the `expression` / `resolveAs: \'department\'` call site is closed too', async () => {
    const req = opened(await svc.openNodeRequest(input(
      [{ type: 'expression', value: 'vars.picked', resolveAs: 'department' }],
      { behavior: 'unanimous' },
      { variables: { picked: ['bu_seeded'] } },
    ), CTX_A));
    console.log('[PROBE B6] expression/resolveAs department -> pending_approvers =',
      JSON.stringify(req.pending_approvers));
    expect([...(req.pending_approvers ?? [])].sort()).toEqual(['u_a', 'u_a_child']);
    expect(req.pending_approvers).not.toContain('u_b');
    expect(req.pending_approvers).not.toContain('u_b_child');
  });
});
