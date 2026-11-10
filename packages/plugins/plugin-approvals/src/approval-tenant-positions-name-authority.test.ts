// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16166] A `sys_user_position` row SPELLING `org_owner` / `org_admin` confers
 * no TENANT-admin override authority on the approvals surface.
 *
 * ## The defect this pins
 *
 * `isOverrideActor`'s TENANT arm read the capability rung FIRST and then ORed
 * two NAMES onto it:
 *
 *     const isTenantAdmin = posture === 'TENANT_ADMIN'
 *       || ORGANIZATION_ADMIN_GRANTS.some((n) => perms.includes(n))
 *       || positions.includes(BUILTIN_IDENTITY_ORG_OWNER)     // ← the holes
 *       || positions.includes(BUILTIN_IDENTITY_ORG_ADMIN);
 *
 * the same species #15981 / PR #16148 closed on the PLATFORM arm of the same
 * predicate, and for the same reason: an OR is only as strong as its weakest
 * arm, so reading the rung first protects nothing.
 *
 * ## What the tenant-authority RUNG is — established, not copied across
 *
 * ⛔ The platform arm's expression is NOT reusable here. `posture` is resolved
 * by `derivePosture` (`packages/core/src/security/posture-ladder.ts`) from HELD
 * CAPABILITY GRANTS: `PLATFORM_ADMIN` from the unscoped `admin_full_access`
 * grant, `TENANT_ADMIN` from `ORGANIZATION_ADMIN_GRANTS.some(n =>
 * permissions.includes(n))` — the identical expression the second arm above
 * already spells. So on the tenant side the rung and the capability arm are ONE
 * reading of ONE authority (`ORGANIZATION_ADMIN` / `ORGANIZATION_ADMIN_NO_BYPASS`
 * are declared in `packages/spec/src/identity/eval-user.zod.ts` as "the source
 * of truth for the `TENANT_ADMIN` posture rung"), kept as two arms only so a
 * transport that never resolved `posture` still reads the capability. The two
 * NAMES are the other thing entirely: ADR-0068 D2 declares them "a normalized
 * PROJECTION into `current_user.positions`", whose sources of truth live
 * elsewhere. A projection is not an authority, and that is the whole fix.
 *
 * ## POPULATION OF THIS PIN — stated because a pin proves only what it covers
 *
 * Covers three doors of `isOverrideActor` — `decideNode` (approve/reject),
 * `recall`, and `listRequests` (the console participant-visibility read) — for
 * a NON-slate, NON-submitter actor in the SAME organization as the request
 * (the tenant arm is org-confined by construction, so same-org is where it can
 * reach at all), in four shapes resolved through the REAL
 * `resolveUserAuthzGrants`: a stored assignment row spelling `org_owner`, one
 * spelling `org_admin`, a genuine org-scoped `organization_admin` capability
 * grant, and a plain member (the floor that proves the arms are not all passing
 * for an unrelated reason).
 *
 * Does NOT cover: the PLATFORM arm (its own suite,
 * `approval-positions-name-authority.test.ts`), `reassign` / `decide` /
 * `getRequest`, the SLA escalation paths, or the ADR-0091 validity window.
 * Those are other suites' populations and their passing is NOT evidence about
 * this one.
 *
 * ⚠️ The stored row is modelled as one that ALREADY EXISTS. The write door was
 * closed separately (`plugin-security` refuses a reserved identity name on
 * `sys_user_position.position`), and that ruling was explicitly "refuse new
 * writes only. No migration." — so a row predating it still resolves into
 * `positions` on every request, which is exactly why the READER has to be fixed
 * too. A reader is not an invariant; neither is a writer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILTIN_IDENTITY_ORG_OWNER,
  BUILTIN_IDENTITY_ORG_ADMIN,
  ADMIN_FULL_ACCESS,
  ORGANIZATION_ADMIN,
  ORGANIZATION_ADMIN_GRANTS,
} from '@objectstack/spec/identity';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { resolveUserAuthzGrants } from '@objectstack/core';
// The engine's OWN dispatch predicates, so this double cannot be looser than
// the engine it stands in for (`check:engine-double-contract`).
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import type { ApprovalRequestRow } from '@objectstack/spec/contracts';
import { ApprovalService, type ApprovalNodeAutoOutcome } from './approval-service.js';
import { bindCatalogFromTables } from './__tests__/security-catalog.testkit.js';

interface FakeRow { [k: string]: any }

/** The same minimal engine shape `approval-positions-name-authority.test.ts` uses. */
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

/** ONE organization: the tenant arm is org-confined, so this is where it bites. */
const ORG = 't_acme';
const ACTOR = 'usr_delegate';
const PS_ORG_ADMIN = 'ps_organization_admin';

/**
 * A minimal ObjectQL double for the AUTHZ resolver — the shape (and the
 * top-level `$` refusal) of `resolve-authz-context.platform-admin-config.test.ts`.
 */
function makeAuthzQl(tables: Record<string, Array<Record<string, unknown>>>) {
  const matches = (row: Record<string, unknown>, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      // An absent column reads as NULL, as it does in SQL (`organization_id: null`).
      if (v === null) return (row[k] ?? null) === null;
      return row[k] === v;
    });
  return bindCatalogFromTables({
    async find(object: string, opts: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
  }, tables);
}

type Shape = 'row-org-owner' | 'row-org-admin' | 'genuine' | 'plain';

const STORED_NAME: Partial<Record<Shape, string>> = {
  'row-org-owner': BUILTIN_IDENTITY_ORG_OWNER,
  'row-org-admin': BUILTIN_IDENTITY_ORG_ADMIN,
};

function authzTables(shape: Shape) {
  const stored = STORED_NAME[shape];
  return {
    sys_user: [{ id: ACTOR, email: 'delegate@example.com', email_verified: true }],
    // An ordinary member of the organization — `member` normalizes to
    // `org_member`, so nothing here carries administration standing.
    sys_member: [{ organization_id: ORG, user_id: ACTOR, role: 'member' }],
    sys_user_position: stored
      // A row of exactly the ADR-0057 D4 shape that survives the write-side
      // refusal by predating it (that ruling declined a migration).
      ? [{ user_id: ACTOR, position: stored, organization_id: ORG }]
      : [],
    // An ACTIVE catalogue row, so ADR-0049's deactivated-position filter is not
    // what carries the arm.
    sys_position: stored
      ? [{ id: `pos_${stored}`, name: stored, label: stored, active: true }]
      : [],
    sys_position_permission_set: [],
    sys_user_permission_set:
      shape === 'genuine'
        ? [{ user_id: ACTOR, permission_set_id: PS_ORG_ADMIN, permission_set: ORGANIZATION_ADMIN, organization_id: ORG }]
        : [],
    sys_permission_set: [{ id: PS_ORG_ADMIN, name: ORGANIZATION_ADMIN, active: true }],
  };
}

/**
 * Resolve one principal through the REAL resolver, then build the context a
 * transport would. The `rung` reading is `grants.posture === 'TENANT_ADMIN'` —
 * ADR-0095 D3's tenant rung, derived by `derivePosture` from the org-admin
 * capability grants and from nothing else.
 */
async function resolve(shape: Shape) {
  const ql = makeAuthzQl(authzTables(shape));
  const grants = await resolveUserAuthzGrants(ql as any, ACTOR, { tenantId: ORG });
  const context = {
    userId: ACTOR,
    tenantId: ORG,
    positions: grants.positions,
    permissions: grants.permissions,
    systemPermissions: grants.systemPermissions,
    ...(grants.posture ? { posture: grants.posture } : {}),
  } as ExecutionContext;
  return { context, grants, rung: grants.posture === 'TENANT_ADMIN' };
}

/**
 * Narrow `openNodeRequest`'s union, and REFUSE the auto-approval outcome — a
 * slate that resolved empty would auto-approve with no request to attack, and
 * every arm below would then be vacuously satisfied.
 */
function opened(result: ApprovalRequestRow | ApprovalNodeAutoOutcome): ApprovalRequestRow {
  if ('autoApproved' in result) {
    throw new Error('expected an OPENED approval request, got an auto-approval outcome');
  }
  return result;
}

const SYS = { isSystem: true, positions: [], permissions: [] } as any;
/** The submitter — same organization, so the request is reachable by the arm at all. */
const SUBMITTER = { userId: 'usr_submitter', tenantId: ORG, positions: [], permissions: [] } as any;

function harness() {
  const engine = makeFakeEngine();
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();
  const svc = new ApprovalService({
    engine: engine as any,
    clock: { now: () => new Date(baseTime + (n++) * 1000) },
  });
  let seq = 0;
  /**
   * A request in the SAME organization, with a staffed slate the actor is not
   * on. Each call takes its OWN record: `openNodeRequest` refuses a second
   * pending request on the same one (`DUPLICATE_REQUEST`).
   */
  const openRequest = () => {
    const i = ++seq;
    return svc.openNodeRequest(
      {
        object: 'opportunity', recordId: `opp${i}`, runId: `run_${i}`, nodeId: 'sign_off',
        flowName: 'deal_flow',
        config: {
          approvers: [{ type: 'user' as const, value: 'usr_designated' }],
          behavior: 'first_response' as const,
        },
        record: { id: `opp${i}`, amount: 100 },
      } as any,
      SUBMITTER,
    ).then(opened);
  };
  /**
   * Attempt a decision and report what it DID, not merely what it threw — an
   * ADMITTED write is the observable, and a throw-shaped assertion would go
   * green on one (the sibling platform suite measured exactly that trap).
   */
  const attemptDecide = async (ctx: ExecutionContext, id: string) => {
    let threw: string | null = null;
    try {
      await svc.decideNode(id, { decision: 'approve', actorId: ACTOR }, ctx);
    } catch (e) {
      threw = String((e as any)?.message ?? e).split(':')[0];
    }
    const [row] = await engine.find('sys_approval_request', { where: { id } });
    const actions = (await svc.listActions(id, SYS)).filter((a: any) => a.actor_id === ACTOR);
    return { threw, status: row?.status, decided: actions.length > 0 };
  };
  /** The same shape for the recall door: did the request actually leave `pending`? */
  const attemptRecall = async (ctx: ExecutionContext, id: string) => {
    let threw: string | null = null;
    try {
      await svc.recall(id, { actorId: ACTOR }, ctx);
    } catch (e) {
      threw = String((e as any)?.message ?? e).split(':')[0];
    }
    const [row] = await engine.find('sys_approval_request', { where: { id } });
    return { threw, status: row?.status };
  };
  return { engine, svc, openRequest, attemptDecide, attemptRecall };
}

describe('[#16166] a stored `sys_user_position` row spelling an org built-in confers NO override authority', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it.each(['row-org-owner', 'row-org-admin'] as const)(
    '%s — the name IS in positions[] while the rung says MEMBER (the premise, without which the rest is vacuous)',
    async (shape) => {
      const { context, grants, rung } = await resolve(shape);
      const name = STORED_NAME[shape]!;

      expect(context.positions, JSON.stringify(context.positions)).toContain(name);
      expect(grants.posture).toBe('MEMBER');
      expect(rung).toBe(false);
      // No capability arm of `isOverrideActor` is satisfied either, so the NAME
      // is the only thing that could admit this actor.
      expect(context.permissions).not.toContain(ADMIN_FULL_ACCESS);
      for (const g of ORGANIZATION_ADMIN_GRANTS) expect(context.permissions).not.toContain(g);
    },
  );

  it('the request under attack really is in the actor’s own organization — the tenant arm reaches nothing else', async () => {
    const req = await h.openRequest();
    const [raw] = await h.engine.find('sys_approval_request', { where: { id: req.id } });
    expect(raw.organization_id).toBe(ORG);
    expect(raw.status).toBe('pending');
    // …and the actor holds no slot in the staffed slate.
    expect(String(raw.pending_approvers ?? '')).not.toContain(ACTOR);
  });

  it.each(['row-org-owner', 'row-org-admin'] as const)(
    '%s — THREE-WAY AGREEMENT: the name says yes; the site gate and the rung both say no, and agree',
    async (shape) => {
      const { context, rung } = await resolve(shape);
      const req = await h.openRequest();

      const nameRead = (context.positions ?? []).includes(STORED_NAME[shape]!);
      const outcome = await h.attemptDecide(context, req.id);
      // The gate ADMITTED the actor iff a decision was recorded for them.
      expect({ nameRead, gate: outcome.decided, rung }).toEqual({ nameRead: true, gate: false, rung: false });
    },
  );

  it.each(['row-org-owner', 'row-org-admin'] as const)(
    '%s — refuses to decide, and leaves the request pending',
    async (shape) => {
      const { context } = await resolve(shape);
      const req = await h.openRequest();

      const outcome = await h.attemptDecide(context, req.id);

      // Not an override actor, and no participant: no reader of the request,
      // so the door answers as for a missing id.
      expect(outcome.threw).toBe('REQUEST_NOT_FOUND');
      // The state half, asserted because a refusal that still moved the request
      // would be no refusal at all.
      expect({ status: outcome.status, decided: outcome.decided })
        .toEqual({ status: 'pending', decided: false });
    },
  );

  it.each(['row-org-owner', 'row-org-admin'] as const)(
    '%s — refuses to RECALL someone else’s pending request',
    async (shape) => {
      const { context } = await resolve(shape);
      const req = await h.openRequest();

      const outcome = await h.attemptRecall(context, req.id);

      expect(outcome).toEqual({ threw: 'REQUEST_NOT_FOUND', status: 'pending' });
    },
  );

  it.each(['row-org-owner', 'row-org-admin'] as const)(
    '%s — sees NOTHING in the console list: a non-participant is not an override viewer',
    async (shape) => {
      const { context } = await resolve(shape);
      await h.openRequest();

      expect(await h.svc.listRequests({}, context)).toEqual([]);
    },
  );

  it.each(['row-org-owner', 'row-org-admin'] as const)(
    '%s — answers the same as a PLAIN member: the stored row buys nothing',
    async (shape) => {
      const named = await resolve(shape);
      const plain = await resolve('plain');

      const a = await h.openRequest();
      const viaName = await h.attemptDecide(named.context, a.id);
      const b = await h.openRequest();
      const viaPlain = await h.attemptDecide(plain.context, b.id);

      // The floor: a plain member is refused — a non-participant, answered as
      // for a missing id. If this arm ever stops being refused, the comparison
      // above is measuring nothing.
      expect(viaPlain).toEqual({ threw: 'REQUEST_NOT_FOUND', status: 'pending', decided: false });
      expect(viaName).toEqual(viaPlain);
      expect(await h.svc.listRequests({}, plain.context)).toEqual([]);
    },
  );
});

describe('[#16166] CONTROL — a genuine org-admin capability grant still overrides', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it('resolves the TENANT_ADMIN rung from the capability, holding NO org built-in name', async () => {
    const { context, grants, rung } = await resolve('genuine');

    expect(grants.posture).toBe('TENANT_ADMIN');
    expect(rung).toBe(true);
    expect(context.permissions).toContain(ORGANIZATION_ADMIN);
    // The separation the fix rests on: authority here is the GRANT, and this
    // principal carries neither built-in NAME.
    expect(context.positions).not.toContain(BUILTIN_IDENTITY_ORG_OWNER);
    expect(context.positions).not.toContain(BUILTIN_IDENTITY_ORG_ADMIN);
  });

  it('decides a request it holds no slot on — the #3424 stuck-request escape hatch survives', async () => {
    const { context, rung } = await resolve('genuine');
    const req = await h.openRequest();

    const outcome = await h.attemptDecide(context, req.id);
    expect({ gate: outcome.decided, rung }).toEqual({ gate: true, rung: true });
    expect(outcome.status).toBe('approved');

    // …and it is still recorded AS an override (#4466), not as an ordinary
    // approval — the audit half the escape hatch is allowed to keep.
    const decision = (await h.svc.listActions(req.id, SYS)).at(-1)!;
    expect(decision).toMatchObject({ action: 'approve', via_override: true });
  });

  it('recalls, and sees the request in the console list — the other two doors of the same hatch', async () => {
    const { context } = await resolve('genuine');
    const req = await h.openRequest();

    expect((await h.svc.listRequests({}, context)).map((r) => r.id)).toContain(req.id);
    expect(await h.attemptRecall(context, req.id)).toEqual({ threw: null, status: 'recalled' });
  });
});

/**
 * [ADR-0131 D1] A request that carries NO organization belongs to no
 * organization's administrator. Under a walled posture (`isolated`, `group`)
 * only a platform administrator or a system context acts on it; under `single`
 * a tenant administrator still does. A request that carries an organization is
 * acted on by that organization's administrator or a platform administrator.
 *
 * ## POPULATION OF THIS PIN
 *
 * Every door that acts on a request by id — approve, reject, recall, reassign,
 * send back, resubmit, remind, request info, comment — for a tenant
 * administrator resolved through the REAL `resolveUserAuthzGrants` (the
 * `genuine` shape above: an org-scoped `organization_admin` grant in `ORG`).
 * The request is opened in `ORG` and then given the organization the case
 * needs; the no-organization case models a stored row that predates ADR-0131
 * D9 (a new write is stamped or refused, so legacy rows are the population).
 * The refused answer is pinned side by side with the answer for an id that
 * names no request. CONTROLS: the platform administrator and a system context
 * under a walled posture, the tenant administrator under `single`, the
 * tenant administrator on their own organization's request, and the tenant
 * administrator refused on another organization's request.
 */
describe('[ADR-0131 D1] under a walled posture, a request with no organization is acted on only by a platform administrator or the system', () => {
  const OTHER_ORG = 't_other';
  const PLATFORM = {
    userId: 'usr_platform', tenantId: ORG, posture: 'PLATFORM_ADMIN',
    positions: [], permissions: [ADMIN_FULL_ACCESS],
  } as unknown as ExecutionContext;

  type Door =
    | 'approve' | 'reject' | 'recall' | 'reassign' | 'sendBack'
    | 'resubmit' | 'remind' | 'requestInfo' | 'comment';
  const DOORS: readonly Door[] = [
    'approve', 'reject', 'recall', 'reassign', 'sendBack', 'resubmit', 'remind', 'requestInfo', 'comment',
  ];
  /** The three doors the override admits a non-participant through (#3424). */
  const OVERRIDE_DOORS: readonly Door[] = ['approve', 'reject', 'recall', 'reassign'];

  /**
   * A service under `posture`, and one pending request opened in `ORG` whose
   * stored organization is then set to `requestOrg` (`null` = none). The
   * reassign target is an account of the request's organization, so a
   * reassign that is admitted lands.
   */
  async function setup(posture: string, requestOrg: string | null) {
    const engine = makeFakeEngine();
    engine._tables.sys_user = [{ id: 'usr_designated' }, { id: 'usr_target' }];
    engine._tables.sys_member = [{ organization_id: requestOrg ?? ORG, user_id: 'usr_target' }];
    const svc = new ApprovalService({ engine: engine as any, tenancyPosture: () => posture });
    const req = opened(await svc.openNodeRequest(
      {
        object: 'opportunity', recordId: 'opp1', runId: 'run_1', nodeId: 'sign_off',
        flowName: 'deal_flow',
        config: {
          approvers: [{ type: 'user' as const, value: 'usr_designated' }],
          behavior: 'first_response' as const,
        },
        record: { id: 'opp1', amount: 100 },
      } as any,
      SUBMITTER,
    ));
    const row = engine._tables.sys_approval_request.find((r) => r.id === req.id)!;
    row.organization_id = requestOrg;
    return { engine, svc, id: req.id };
  }

  /** Drive one door; report the refusal it threw (whole message) or `null`. */
  async function act(svc: ApprovalService, door: Door, id: string, ctx: ExecutionContext): Promise<string | null> {
    const actorId = String((ctx as any).userId ?? 'system');
    try {
      switch (door) {
        case 'approve': await svc.decide(id, { decision: 'approve', actorId } as any, ctx); break;
        case 'reject': await svc.decide(id, { decision: 'reject', actorId } as any, ctx); break;
        case 'recall': await svc.recall(id, { actorId } as any, ctx); break;
        case 'reassign': await svc.reassign(id, { actorId, to: 'usr_target' }, ctx); break;
        case 'sendBack': await svc.sendBack(id, { actorId, comment: 'please revise' } as any, ctx); break;
        case 'resubmit': await svc.resubmit(id, { actorId } as any, ctx); break;
        case 'remind': await svc.remind(id, { actorId }, ctx); break;
        case 'requestInfo': await svc.requestInfo(id, { actorId, comment: 'more detail' }, ctx); break;
        case 'comment': await svc.comment(id, { actorId, comment: 'a note' }, ctx); break;
      }
      return null;
    } catch (e) {
      return String((e as any)?.message ?? e);
    }
  }

  /** What the door left behind: the request's status and the actions the actor recorded. */
  async function trace(engine: ReturnType<typeof makeFakeEngine>, id: string, actor: string) {
    const [row] = await engine.find('sys_approval_request', { where: { id } });
    const actions = (await engine.find('sys_approval_action', { where: { request_id: id } }))
      .filter((a: any) => a.actor_id === actor);
    return { status: row?.status, pending: row?.pending_approvers, actions: actions.length };
  }

  /**
   * An admitted caller's answer: the door's result, or — for a caller whose
   * active organization is not the request's — `READ_BACK_FAILED`, the loud
   * answer for a write that landed but whose echo the caller's organization
   * scope cannot read (the write is recorded). Never a refusal.
   */
  const expectAdmitted = (threw: string | null) => {
    if (threw !== null) expect(threw).toMatch(/^READ_BACK_FAILED:/);
  };

  /** The effect an admitted override door leaves. */
  const ADMITTED: Record<string, (t: Awaited<ReturnType<typeof trace>>) => void> = {
    approve: (t) => expect(t.status).toBe('approved'),
    reject: (t) => expect(t.status).toBe('rejected'),
    recall: (t) => expect(t.status).toBe('recalled'),
    reassign: (t) => expect(String(t.pending)).toContain('usr_target'),
  };

  describe.each(['isolated', 'group'])('under the walled `%s` posture', (posture) => {
    it.each(DOORS)('a tenant administrator is refused on `%s`, answered as an id that names no request, and the request is unchanged', async (door) => {
      const { context } = await resolve('genuine');
      expect(context.posture).toBe('TENANT_ADMIN');
      const { engine, svc, id } = await setup(posture, null);
      const before = await trace(engine, id, ACTOR);

      const threw = await act(svc, door, id, context);

      expect(threw).toBe(`REQUEST_NOT_FOUND: ${id}`);
      expect(await trace(engine, id, ACTOR)).toEqual(before);
      expect(before).toMatchObject({ status: 'pending', actions: 0 });
    });

    it.each(DOORS)('side by side on `%s`: the refusal is the answer an id that names no request gets', async (door) => {
      const { context } = await resolve('genuine');
      const { svc, id } = await setup(posture, null);
      const missing = 'areq_does_not_exist';

      const onRow = await act(svc, door, id, context);
      const onMissing = await act(svc, door, missing, context);

      expect(onMissing).toBe(`REQUEST_NOT_FOUND: ${missing}`);
      expect(onRow?.replace(id, '<id>')).toBe(onMissing?.replace(missing, '<id>'));
      // The read door gives both the same answer too.
      expect(await svc.getRequest(id, context)).toBeNull();
      expect(await svc.getRequest(missing, context)).toBeNull();
    });

    it('the list door shows the request to a platform administrator, with the override flag, and not to the tenant administrator', async () => {
      const { context } = await resolve('genuine');
      const { svc, id } = await setup(posture, null);
      const rows = await svc.listRequests({}, PLATFORM);
      expect(rows.find((r) => r.id === id)).toMatchObject({ viewer: { can_override: true } });
      expect(await svc.listRequests({}, context)).toEqual([]);
    });

    it.each(OVERRIDE_DOORS)('CONTROL — a platform administrator still acts on `%s`', async (door) => {
      const { engine, svc, id } = await setup(posture, null);
      expectAdmitted(await act(svc, door, id, PLATFORM));
      ADMITTED[door](await trace(engine, id, 'usr_platform'));
    });

    it.each(OVERRIDE_DOORS)('CONTROL — a system context still acts on `%s`', async (door) => {
      const { engine, svc, id } = await setup(posture, null);
      expectAdmitted(await act(svc, door, id, SYS));
      ADMITTED[door](await trace(engine, id, 'system'));
    });

    it.each(OVERRIDE_DOORS)('CONTROL — an organization’s own administrator still acts on `%s` for that organization’s request', async (door) => {
      const { context } = await resolve('genuine');
      const { engine, svc, id } = await setup(posture, ORG);
      expect(await act(svc, door, id, context)).toBeNull();
      ADMITTED[door](await trace(engine, id, ACTOR));
    });

    it.each(OVERRIDE_DOORS)('CONTROL — an administrator of another organization is refused on `%s` for an organization’s request', async (door) => {
      const { context } = await resolve('genuine');
      const { engine, svc, id } = await setup(posture, OTHER_ORG);
      expect(await act(svc, door, id, context)).toBe(`REQUEST_NOT_FOUND: ${id}`);
      expect(await trace(engine, id, ACTOR)).toMatchObject({ status: 'pending', actions: 0 });
    });
  });

  describe('under the `single` posture', () => {
    it.each(OVERRIDE_DOORS)('CONTROL — a tenant administrator still acts on `%s` for a request with no organization', async (door) => {
      const { context } = await resolve('genuine');
      const { engine, svc, id } = await setup('single', null);
      expectAdmitted(await act(svc, door, id, context));
      ADMITTED[door](await trace(engine, id, ACTOR));
    });
  });
});
