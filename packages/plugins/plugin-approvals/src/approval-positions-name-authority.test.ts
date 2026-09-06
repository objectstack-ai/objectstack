// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15981] A `sys_user_position` row SPELLING `platform_admin` confers no
 * override authority on the approvals surface.
 *
 * ## The defect this pins
 *
 * `isOverrideActor` read the capability rung FIRST and then ORed a NAME onto
 * it:
 *
 *     const isPlatformAdmin = posture === 'PLATFORM_ADMIN'
 *       || perms.includes(ADMIN_FULL_ACCESS)
 *       || positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);   // ← the hole
 *
 * Reading the rung first does not close the hole; an OR is only as strong as
 * its weakest arm. `sys_user_position` is `apiEnabled` and its `position`
 * values are unconstrained, so a tenant can mint an ADR-0057 D4 row spelling
 * that built-in name, `resolveUserAuthzGrants` §4 pushes it into
 * `grants.positions`, and the third arm answered `true` while `grants.posture`
 * — derived from the unscoped `admin_full_access` grant and nothing else —
 * stayed `MEMBER`.
 *
 * ⭐ WHAT THE ESCALATION BUYS, driven rather than argued: the platform arm of
 * `isOverrideActor` deliberately CROSSES THE TENANT WALL (the tenant-admin arm
 * below it is confined to the actor's own org). So a member of one tenant
 * holding the minted row could decide a PENDING request belonging to a
 * DIFFERENT tenant, holding no slot in its slate — see the cross-tenant arm.
 *
 * ## POPULATION OF THIS PIN — stated because a pin proves only what it covers
 *
 * Covers: `decideNode` (the approve/reject door) and `listRequests`
 * (the console's participant-visibility read, `visibleRequestIds`), for a
 * NON-slate-holding actor in a DIFFERENT organization from the request, in
 * three shapes — a D4 row spelling the built-in name with no capability grant
 * (`name-only`), a genuine unscoped `admin_full_access` grant (`genuine`), and
 * a plain member (`plain`, the floor that proves the arms are not all passing
 * for some unrelated reason). The `name-only` and `genuine` contexts are built
 * by inserting rows and resolving them through the REAL
 * `resolveUserAuthzGrants`.
 *
 * Does NOT cover: the `ADMIN_FULL_ACCESS` permission-name arm or the
 * TENANT_ADMIN arms of `isOverrideActor` (untouched by this change; the
 * `org_owner` / `org_admin` name-reads on the tenant arm are a NARROWER
 * question left to #15972's write-side card and not silently widened here),
 * the SLA/escalation paths, or the ADR-0091 validity window. Those are other
 * suites' populations, and their passing is NOT evidence about this one.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BUILTIN_IDENTITY_PLATFORM_ADMIN, ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { hasPlatformAdminStanding, resolveUserAuthzGrants } from '@objectstack/core';
// The engine's OWN dispatch predicates, so this double cannot be looser than
// the engine it stands in for (`check:engine-double-contract`).
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import type { ApprovalRequestRow } from '@objectstack/spec/contracts';
import { ApprovalService, type ApprovalNodeAutoOutcome } from './approval-service.js';

interface FakeRow { [k: string]: any }

/** The same minimal engine shape `approval-override-audit.test.ts` uses. */
function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!(v as any[]).some((sub) => matches(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported filter operator ${k}`);
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }
  return {
    _tables: tables,
    async find(object: string, options?: any) {
      const rows = ensure(object).filter((r) => matches(r, options?.filter ?? options?.where));
      const start = options?.offset ?? 0;
      return rows.slice(start, start + (options?.limit ?? 1000));
    },
    async insert(object: string, data: any) { ensure(object).push({ ...data }); return { ...data }; },
    // `update` / `delete` route through the ENGINE'S OWN dispatch predicates
    // rather than a hand-mirrored copy: a double looser than the engine it
    // stands in for is how #4434 shipped a dead REST route with its suite
    // green, and `check:engine-double-contract` grades exactly this.
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const table = ensure(object);
      if (dispatch.kind === 'multi') {
        let n = 0;
        for (let i = 0; i < table.length; i++) {
          if (matches(table[i], options?.where)) { table[i] = { ...table[i], ...data }; n++; }
        }
        return { updated: n };
      }
      const i = table.findIndex((r) => r.id === dispatch.id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return i >= 0 ? { ...table[i] } : null;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const table = ensure(object);
      if (dispatch.kind === 'multi') {
        const survivors = table.filter((r) => !matches(r, options?.where));
        const deleted = table.length - survivors.length;
        table.splice(0, table.length, ...survivors);
        return { deleted };
      }
      const i = table.findIndex((r) => r.id === dispatch.id);
      if (i >= 0) table.splice(i, 1);
      return { id: dispatch.id };
    },
    registerHook() {}, unregisterHooksByPackage() { return 0; }, async fire() {},
  };
}

const VICTIM_ORG = 't_victim';
const ATTACKER_ORG = 't_attacker';
const ATTACKER = 'usr_attacker';
const PS_ADMIN = 'ps_admin_full_access';

/**
 * A minimal ObjectQL double for the AUTHZ resolver — the shape (and the
 * top-level `$` refusal) of `resolve-authz-context.platform-admin-config.test.ts`.
 */
function makeAuthzQl(tables: Record<string, Array<Record<string, unknown>>>) {
  const matches = (row: Record<string, unknown>, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    });
  return {
    async find(object: string, opts: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
  };
}

type Shape = 'name-only' | 'genuine' | 'plain';

function authzTables(shape: Shape) {
  return {
    sys_user: [{ id: ATTACKER, email: 'attacker@example.com', email_verified: true }],
    sys_member: [{ organization_id: ATTACKER_ORG, user_id: ATTACKER, role: 'member' }],
    sys_user_position:
      shape === 'name-only'
        ? [
            // Exactly what a tenant admin can write through the `apiEnabled`
            // `sys_user_position` surface: a row whose NAME is the built-in.
            { user_id: ATTACKER, position: BUILTIN_IDENTITY_PLATFORM_ADMIN, organization_id: null },
          ]
        : [],
    // An ACTIVE catalogue row, so ADR-0049's deactivated-position filter is not
    // what carries the arm.
    sys_position:
      shape === 'name-only'
        ? [{ id: 'pos_pa', name: BUILTIN_IDENTITY_PLATFORM_ADMIN, label: 'Platform Admin', active: true }]
        : [],
    sys_position_permission_set: [],
    sys_user_permission_set:
      shape === 'genuine'
        ? [{ user_id: ATTACKER, permission_set_id: PS_ADMIN, organization_id: null }]
        : [],
    sys_permission_set: [{ id: PS_ADMIN, name: ADMIN_FULL_ACCESS, active: true }],
  };
}

/**
 * Resolve one principal through the REAL resolver, then build the context a
 * transport would. `tenantId` is the ATTACKER's own organization — the request
 * under test belongs to a different one, which is what makes the platform arm
 * (and only the platform arm) able to reach it.
 */
async function resolve(shape: Shape) {
  const ql = makeAuthzQl(authzTables(shape));
  const grants = await resolveUserAuthzGrants(ql as any, ATTACKER, { tenantId: ATTACKER_ORG });
  const context = {
    userId: ATTACKER,
    tenantId: ATTACKER_ORG,
    positions: grants.positions,
    permissions: grants.permissions,
    systemPermissions: grants.systemPermissions,
    ...(grants.posture ? { posture: grants.posture } : {}),
  } as ExecutionContext;
  return { context, grants, rung: await hasPlatformAdminStanding(ql as any, ATTACKER) };
}

/**
 * Narrow `openNodeRequest`'s union, and REFUSE the auto-approval outcome.
 * Same spelling as `business-unit-member-org-screen.test.ts` (#10230). It is
 * load-bearing here: a slate that resolved empty would auto-approve with no
 * request to attack, and every arm below would then be vacuously satisfied.
 */
function opened(result: ApprovalRequestRow | ApprovalNodeAutoOutcome): ApprovalRequestRow {
  if ('autoApproved' in result) {
    throw new Error('expected an OPENED approval request, got an auto-approval outcome');
  }
  return result;
}

const SYS = { isSystem: true, positions: [], permissions: [] } as any;
/** The victim tenant's submitter — the request being reached across the wall. */
const SUBMITTER = { userId: 'usr_victim', tenantId: VICTIM_ORG, positions: [], permissions: [] } as any;

describe('[#15981] a D4 `sys_user_position` row spelling `platform_admin` confers NO override authority', () => {
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

  /**
   * A request in the VICTIM tenant, with a staffed slate the attacker is not on.
   *
   * Each call takes its OWN record: `openNodeRequest` refuses a second pending
   * request on the same one (`DUPLICATE_REQUEST`), and an arm that leaves the
   * first request correctly PENDING would otherwise collide with itself.
   */
  let seq = 0;
  const openVictimRequest = () => {
    const n = ++seq;
    return svc.openNodeRequest(
      {
        object: 'opportunity', recordId: `opp${n}`, runId: `run_${n}`, nodeId: 'sign_off',
        flowName: 'victim_flow',
        config: {
          approvers: [{ type: 'user' as const, value: 'usr_designated' }],
          behavior: 'first_response' as const,
        },
        record: { id: `opp${n}`, amount: 100 },
      } as any,
      SUBMITTER,
    ).then(opened);
  };

  it('the name IS in positions[] while the rung says MEMBER — the premise, without which the rest is vacuous', async () => {
    const { context, grants, rung } = await resolve('name-only');

    expect(context.positions, JSON.stringify(context.positions)).toContain(
      BUILTIN_IDENTITY_PLATFORM_ADMIN,
    );
    expect(grants.posture).not.toBe('PLATFORM_ADMIN');
    expect(rung).toBe(false);
    // No capability arm of `isOverrideActor` is satisfied either, so the NAME
    // is the only thing that could admit this actor.
    expect(context.permissions).not.toContain(ADMIN_FULL_ACCESS);
  });

  /**
   * Attempt a decision and report what it DID, not merely what it threw.
   *
   * ⭐ The thrown message is NOT a sound gate signal here, and reading it as one
   * would have hidden the escalation. A cross-tenant decision that is ADMITTED
   * writes the decision and then fails building its echo, throwing
   * `READ_BACK_FAILED` — whose own message says "The write is NOT rolled back".
   * A pin that asserted `rejects.toThrow()` would therefore have gone GREEN on
   * a successful escalation. So the observable is STATE: did the request leave
   * `pending`, and was a decision action recorded?
   */
  const attemptDecide = async (ctx: ExecutionContext, id: string) => {
    let threw: string | null = null;
    try {
      await svc.decideNode(id, { decision: 'approve', actorId: ATTACKER }, ctx);
    } catch (e) {
      threw = String((e as any)?.message ?? e).split(':')[0];
    }
    const [row] = await engine.find('sys_approval_request', { where: { id } });
    const actions = (await svc.listActions(id, SYS)).filter((a: any) => a.actor_id === ATTACKER);
    return { threw, status: row?.status, decided: actions.length > 0 };
  };

  it('THREE-WAY AGREEMENT — the name says yes; the site gate and the rung both say no, and agree', async () => {
    const { context, rung } = await resolve('name-only');
    const req = await openVictimRequest();

    const nameRead = (context.positions ?? []).includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    const outcome = await attemptDecide(context, req.id);
    // The gate ADMITTED the actor iff a decision was recorded for them.
    const gate = outcome.decided;

    expect({ nameRead, gate, rung }).toEqual({ nameRead: true, gate: false, rung: false });
  });

  it('refuses to decide ANOTHER tenant’s pending request, and leaves it pending', async () => {
    const { context } = await resolve('name-only');
    const req = await openVictimRequest();

    const outcome = await attemptDecide(context, req.id);

    expect(outcome.threw).toBe('FORBIDDEN');
    // The state half, asserted because a refusal that still moved the request
    // would be no refusal at all — and because `READ_BACK_FAILED` is exactly
    // what an ADMITTED cross-tenant write throws.
    expect({ status: outcome.status, decided: outcome.decided }).toEqual({
      status: 'pending',
      decided: false,
    });
  });

  it('answers the same as a PLAIN member — the minted row buys nothing', async () => {
    const nameOnly = await resolve('name-only');
    const plain = await resolve('plain');

    const a = await openVictimRequest();
    const viaName = await attemptDecide(nameOnly.context, a.id);
    const b = await openVictimRequest();
    const viaPlain = await attemptDecide(plain.context, b.id);

    // The floor: a plain member of another tenant is refused. If this arm ever
    // stops being FORBIDDEN, the comparison above is measuring nothing.
    expect(viaPlain).toEqual({ threw: 'FORBIDDEN', status: 'pending', decided: false });
    expect(viaName).toEqual(viaPlain);
  });
});

describe('[#15981] CONTROL — a genuine unscoped admin_full_access grant still overrides', () => {
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

  /**
   * A request in the VICTIM tenant, with a staffed slate the attacker is not on.
   *
   * Each call takes its OWN record: `openNodeRequest` refuses a second pending
   * request on the same one (`DUPLICATE_REQUEST`), and an arm that leaves the
   * first request correctly PENDING would otherwise collide with itself.
   */
  let seq = 0;
  const openVictimRequest = () => {
    const n = ++seq;
    return svc.openNodeRequest(
      {
        object: 'opportunity', recordId: `opp${n}`, runId: `run_${n}`, nodeId: 'sign_off',
        flowName: 'victim_flow',
        config: {
          approvers: [{ type: 'user' as const, value: 'usr_designated' }],
          behavior: 'first_response' as const,
        },
        record: { id: `opp${n}`, amount: 100 },
      } as any,
      SUBMITTER,
    ).then(opened);
  };

  it('all three answers are TRUE and agree — the stuck-request escape hatch survives', async () => {
    const { context, rung } = await resolve('genuine');
    const req = await openVictimRequest();

    const nameRead = (context.positions ?? []).includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    // ⚠️ The echo cannot be built across the tenancy wall, so the call throws
    // `READ_BACK_FAILED` *after* recording the decision — pre-existing
    // behaviour of `readBackRequest`, untouched here and deliberately NOT
    // caught into a `null`. The decision itself is the observable.
    await expect(
      svc.decideNode(req.id, { decision: 'approve', actorId: ATTACKER }, context),
    ).rejects.toThrow(/READ_BACK_FAILED/);

    const decision = (await svc.listActions(req.id, SYS)).at(-1)!;
    const gate = decision?.actor_id === ATTACKER;
    expect({ nameRead, gate, rung }).toEqual({ nameRead: true, gate: true, rung: true });
    // …and it is still recorded AS an override (#4466), not as an ordinary
    // approval — the audit half the escape hatch is allowed to keep.
    expect(decision).toMatchObject({ action: 'approve', via_override: true });
  });

  it('the two shapes are INDISTINGUISHABLE by name and separable only by the rung', async () => {
    const escalation = await resolve('name-only');
    const genuine = await resolve('genuine');

    expect(escalation.context.positions).toContain(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    expect(genuine.context.positions).toContain(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    expect(escalation.rung).toBe(false);
    expect(genuine.rung).toBe(true);
  });
});
