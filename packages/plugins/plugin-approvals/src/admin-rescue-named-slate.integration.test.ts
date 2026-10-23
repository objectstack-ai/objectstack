// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An empty `admin_rescue` slate opens on the organization's administrators,
 * as ordinary approvers (#22824).
 *
 * ## The defect
 *
 * A node whose approvers resolved to no concrete person opened, under the
 * default `onEmptyApprovers: 'admin_rescue'`, on a slate that named no one
 * (the literal `position:<p>`). No "My Pending" listed it, the bell counted 0,
 * the `approval.requested` fan-out told no one, and only the #3424 override
 * could decide it — measured on every fresh HotCRM install's default
 * sign-offs.
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL), with the real
 * `resolveUserAuthzGrants` reading a bound security catalog, and the messaging
 * surface recording what reaches it:
 *
 * - a position-only slate with no holder opens on the organization's
 *   administrators — each holder of `organization_admin` or
 *   `organization_admin_no_bypass` in the request's organization — and the
 *   request is listed and counted for each of them under their own
 *   `approverId`, and each is told once;
 * - a tenant administrator's decision is an ordinary approval
 *   (`via_override: false`);
 * - a member sees nothing and is told nothing; a platform administrator is not
 *   on the slate for being one; another organization's administrator is not
 *   on it;
 * - the request says why: a timeline note and `__resolvedFrom`;
 * - [#23556] the log names the empty slot once and the routing once, and no
 *   line says the request cannot advance;
 * - an administrator out of office is covered by their delegate;
 * - CONTROLS: a staffed slate is unchanged; `fallback`, `auto_approve` and
 *   `fail` are unchanged; an organization with no administrator still gets
 *   the request that names no one, which the override decides.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { bindSecurityCatalogReader, type SecurityCatalogEntry, type SecurityCatalogReader } from '@objectstack/core';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;

const ORG = 'org_a';
const OTHER_ORG = 'org_b';
/** An organization whose only member holds no administrator capability. */
const LEADERLESS_ORG = 'org_c';

/** The acting envelope of a member of `org`, with the grants it resolved to. */
const as = (userId: string, org: string, permissions: string[] = []) =>
  ({ userId, tenantId: org, positions: [], permissions }) as any;
const OWNER = as('u_owner', ORG, ['organization_admin']);
const ADMIN = as('u_admin', ORG, ['organization_admin_no_bypass']);
const MEMBER = as('u_member', ORG);
const ROOT = as('u_root', ORG, ['admin_full_access']);

const USERS = [
  'u_sub', 'u_owner', 'u_admin', 'u_member', 'u_root', 'u_other_owner', 'u_alice', 'u_fallback', 'u_cover',
  'u_lonely',
].map((id) => ({ id, name: id, email: `${id}@example.com` }));

/** `sys_member`: who is in which organization, by better-auth role. */
const MEMBERS: Array<[string, string, string]> = [
  ['u_sub', ORG, 'member'],
  ['u_owner', ORG, 'owner'],
  ['u_admin', ORG, 'admin'],
  ['u_member', ORG, 'member'],
  ['u_root', ORG, 'member'],
  ['u_other_owner', OTHER_ORG, 'owner'],
  ['u_lonely', LEADERLESS_ORG, 'member'],
];

/**
 * `sys_user_permission_set`: the grants the authorization resolver reads. The
 * org-admin grants are what `auto-org-admin-grant.ts` provisions from the
 * owner/admin role; the platform administrator's grant is unscoped.
 */
const GRANTS: Array<[string, string, string | null]> = [
  ['u_owner', 'organization_admin', ORG],
  ['u_admin', 'organization_admin_no_bypass', ORG],
  ['u_root', 'admin_full_access', null],
  ['u_other_owner', 'organization_admin', OTHER_ORG],
];

const text = (name: string) => ({ name, label: name, type: 'text' as const });
const objectDef = (name: string, fields: string[]) => ({
  name,
  label: name,
  fields: Object.fromEntries([
    ['id', { ...text('id'), primaryKey: true }],
    ...fields.map((f) => [f, text(f)]),
  ]),
});

/** A catalog serving exactly the permission sets this suite grants. */
function catalogServing(names: string[]): SecurityCatalogReader {
  const entry = (name: string): SecurityCatalogEntry => ({
    type: 'permission', name, definition: { name }, source: 'registry',
  });
  return {
    async resolve(type, name) {
      return type === 'permission' && names.includes(name) ? entry(name) : undefined;
    },
    async list(type) {
      return type === 'permission' ? names.map(entry) : [];
    },
  };
}

/** The plugin's own object definitions, as its manifest registers them. */
async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

interface Emitted {
  topic: string;
  audience: string[];
  source?: { object: string; id: string };
}

describe('an empty admin_rescue slate opens on the organization\'s administrators (#22824)', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-11T09:00:00.000Z');
  const emits: Emitted[] = [];
  const warnings: string[] = [];

  const open = async (key: string, approvers: any[], extra: Record<string, unknown> = {}, org = ORG): Promise<any> => {
    await engine.insert('crm_deal', { id: `D_${key}`, title: key }, { context: SYSTEM } as any);
    return svc.openNodeRequest({
      object: 'crm_deal', recordId: `D_${key}`, runId: `run_${key}`, nodeId: 'review', flowName: 'deal_review',
      config: { approvers, behavior: 'first_response', ...extra } as any,
      submitterId: 'u_sub', record: { id: `D_${key}`, title: key }, organizationId: org,
    }, as('u_sub', org));
  };
  const UNSTAFFED = [{ type: 'position', value: 'sales_manager' }];

  /** Who was told on `approval.requested` about one request, one entry per message. */
  const told = (requestId: string) => emits
    .filter((e) => e.topic === 'approval.requested' && e.source?.id === requestId)
    .flatMap((e) => e.audience).sort();
  /** My Pending and the bell, for one caller: their own approver identities, both faces. */
  const myPending = async (ctx: any) => {
    const filter = { status: 'pending' as const, approverId: [ctx.userId, `${ctx.userId}@example.com`] };
    const rows = await svc.listRequests(filter, ctx);
    return { ids: rows.map((r) => r.id).sort(), total: await svc.countRequests(filter, ctx) };
  };
  const actionsOf = async (requestId: string): Promise<any[]> => engine.find('sys_approval_action', {
    where: { request_id: requestId }, context: SYSTEM,
  });
  const snapshotOf = async (requestId: string) => {
    const [row]: any[] = await engine.find('sys_approval_request', { where: { id: requestId }, context: SYSTEM });
    return JSON.parse(row.node_config_json);
  };

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    const defs = [
      objectDef('sys_user', ['name', 'email']),
      objectDef('sys_member', ['user_id', 'organization_id', 'role']),
      objectDef('sys_user_position', ['user_id', 'position', 'organization_id']),
      objectDef('sys_user_permission_set', ['user_id', 'permission_set', 'organization_id']),
      objectDef('crm_deal', ['title']),
      ...(await packageObjects()),
    ];
    for (const def of defs) engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    await engine.syncSchemas();
    // The organization-less rows below exist only on a store built before 18.x
    // (ADR-0131 D1 makes a fresh tenant column NOT NULL): this is that store.
    await relaxTenantColumns(engine, ['sys_user', 'sys_user_permission_set', 'crm_deal', 'sys_approval_delegation']);
    bindSecurityCatalogReader(engine, catalogServing([
      'organization_admin', 'organization_admin_no_bypass', 'admin_full_access',
    ]));
    for (const u of USERS) await engine.insert('sys_user', u, { context: SYSTEM } as any);
    for (const [i, [user_id, organization_id, role]] of MEMBERS.entries()) {
      await engine.insert('sys_member', { id: `m_${i}`, user_id, organization_id, role }, { context: SYSTEM } as any);
    }
    for (const [i, [user_id, permission_set, organization_id]] of GRANTS.entries()) {
      await engine.insert('sys_user_permission_set', { id: `ups_${i}`, user_id, permission_set, organization_id },
        { context: SYSTEM } as any);
    }

    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      logger: {
        warn: (msg: string) => { warnings.push(String(msg)); }, info: () => {}, error: () => {}, debug: () => {},
      } as any,
    });
    svc.attachMessaging({ emit: (async (input: Emitted) => { emits.push(input); }) as any });
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('a position nobody holds opens on the organization\'s administrators, in each one\'s queue and bell, each told once', async () => {
    const row = await open('rescue', UNSTAFFED);
    expect(row.status).toBe('pending');
    expect([...row.pending_approvers].sort()).toEqual(['u_admin', 'u_owner']);

    for (const admin of [OWNER, ADMIN]) {
      expect(await myPending(admin), admin.userId).toEqual({ ids: [row.id], total: 1 });
      // Ordinary approvers: the slot is theirs, not an override.
      const seen = await svc.getRequest(row.id, admin);
      expect((seen as any)?.viewer?.can_act, admin.userId).toBe(true);
    }
    expect(told(row.id)).toEqual(['u_admin', 'u_owner']);
  });

  it('a member sees nothing and is told nothing; a platform admin and another organization\'s admin are not on the slate', async () => {
    const row = await open('outsiders', UNSTAFFED);
    // The scene first: the slate IS the administrators', so the absences
    // below are not read off a slate that names no one at all.
    expect([...row.pending_approvers].sort()).toEqual(['u_admin', 'u_owner']);
    expect(row.pending_approvers).not.toContain('u_member');
    expect(row.pending_approvers).not.toContain('u_root');
    expect(row.pending_approvers).not.toContain('u_other_owner');

    expect(await myPending(MEMBER)).toEqual({ ids: [], total: 0 });
    expect(await myPending(ROOT)).toEqual({ ids: [], total: 0 });
    expect(told(row.id)).not.toContain('u_member');
    expect(told(row.id)).not.toContain('u_root');
    expect(told(row.id)).not.toContain('u_other_owner');
  });

  it('a tenant administrator\'s decision is an ordinary approval, not an override', async () => {
    const row = await open('decided', UNSTAFFED);
    const out = await svc.decide(row.id, { decision: 'approve', actorId: 'u_owner' } as any, OWNER);
    expect([out.finalized, out.request.status]).toEqual([true, 'approved']);
    const decision = (await actionsOf(row.id)).find((a) => a.action === 'approve');
    expect(decision).toMatchObject({ actor_id: 'u_owner', acted_as: 'u_owner' });
    expect(Boolean(decision?.via_override)).toBe(false);
  });

  it('the request says why: a timeline note and the abandoned slate in __resolvedFrom', async () => {
    const row = await open('why', UNSTAFFED);
    const notes = (await actionsOf(row.id)).filter((a) => a.action === 'comment');
    expect(notes).toHaveLength(1);
    expect(notes[0].actor_id ?? null).toBeNull();
    expect(notes[0].comment).toContain("position 'sales_manager' has no holder");
    expect((await snapshotOf(row.id)).__resolvedFrom).toEqual({
      'admin_rescue:abandoned': ['position:sales_manager'],
      'admin_rescue:reason': "position 'sales_manager' has no holder",
    });
  });

  it('[#23556] the log names the empty slot and the routing once — no line says the request cannot advance', async () => {
    const before = warnings.length;
    const row = await open('logged', UNSTAFFED);
    expect([...row.pending_approvers].sort()).toEqual(['u_admin', 'u_owner']);
    const lines = warnings.slice(before);
    // The scene: the per-slot line and the node-level routing line both fired,
    // so the absence below is not read off an opening that logged nothing.
    expect(lines.filter((w) => w.includes("approver 'position:sales_manager' expanded to nobody"))).toHaveLength(1);
    expect(lines.filter((w) => w.includes("opening on this organization's administrators"))).toHaveLength(1);
    expect(lines.filter((w) => /cannot advance/.test(w))).toEqual([]);
  });

  it('a fallback that resolves to no one degrades to the administrators, and says so', async () => {
    const row = await open('fallback_empty', UNSTAFFED, {
      onEmptyApprovers: 'fallback', fallbackApprovers: [{ type: 'position', value: 'treasury' }],
    });
    expect([...row.pending_approvers].sort()).toEqual(['u_admin', 'u_owner']);
    expect((await snapshotOf(row.id)).__resolvedFrom['admin_rescue:reason']).toBe(
      "position 'sales_manager' has no holder; the declared fallbackApprovers resolved to no one either",
    );
  });

  // Last of the cases whose slate is `org_a`'s administrators: the delegation
  // it writes stays, and no case after it reads that slate.
  it('an administrator out of office is covered by their delegate, as any named approver is', async () => {
    await engine.insert('sys_approval_delegation', {
      id: 'dlg_admin', delegator_id: 'u_admin', delegate_id: 'u_cover', reason: 'leave',
      valid_from: '2026-09-01T00:00:00.000Z', valid_until: '2026-12-31T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
    }, { context: SYSTEM } as any);
    const row = await open('cover', UNSTAFFED);
    expect([...row.pending_approvers].sort()).toEqual(['u_cover', 'u_owner']);
    expect(told(row.id)).toEqual(['u_owner']);
    expect(emits.filter((e) => e.topic === 'approval.ooo_substituted' && e.source?.id === row.id)
      .flatMap((e) => e.audience)).toEqual(['u_cover']);
  });

  describe('controls', () => {
    it('a staffed slate is unchanged: no administrator is added, and no note is written', async () => {
      const row = await open('staffed', [{ type: 'user', value: 'u_alice' }]);
      expect(row.pending_approvers).toEqual(['u_alice']);
      expect(told(row.id)).toEqual(['u_alice']);
      expect((await actionsOf(row.id)).map((a) => a.action)).toEqual(['submit']);
    });

    it('fallback opens on its declared approvers, not on the administrators', async () => {
      const row = await open('fallback', UNSTAFFED, {
        onEmptyApprovers: 'fallback', fallbackApprovers: [{ type: 'user', value: 'u_fallback' }],
      });
      expect(row.pending_approvers).toEqual(['u_fallback']);
      expect(told(row.id)).toEqual(['u_fallback']);
    });

    it('auto_approve opens nothing and fail refuses, as before', async () => {
      expect(await open('waved', UNSTAFFED, { onEmptyApprovers: 'auto_approve' }))
        .toEqual({ autoApproved: true, reason: 'empty_approvers' });
      await expect(open('refused', UNSTAFFED, { onEmptyApprovers: 'fail' })).rejects.toThrow(/^NO_APPROVERS:/);
    });

    it('an organization with no administrator gets the request that names no one, said loudly, and the override decides it', async () => {
      const before = warnings.length;
      const row = await open('leaderless', UNSTAFFED, {}, LEADERLESS_ORG);
      expect(row.pending_approvers).toEqual(['position:sales_manager']);
      expect(told(row.id)).toEqual([]);
      expect(warnings.slice(before).some((w) => w.includes(`organization '${LEADERLESS_ORG}' has no administrator`)))
        .toBe(true);
      // Break-glass stays break-glass: a platform administrator holds no slot
      // and decides it through the #3424 override, recorded as one.
      const root = as('u_root', LEADERLESS_ORG, ['admin_full_access']);
      await svc.decide(row.id, { decision: 'approve', actorId: 'u_root' } as any, root);
      const decision = (await actionsOf(row.id)).find((a) => a.action === 'approve');
      expect(decision).toMatchObject({ actor_id: 'u_root' });
      expect(Boolean(decision?.via_override)).toBe(true);
    });
  });
});
