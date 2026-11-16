// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `platform_admin` approver type: one address slot the platform
 * administrators decide under, named only by the deployment's own packaged
 * flows.
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL), with the real
 * `hasPlatformAdminStanding` reading the stored grant rows and the configured
 * owner list, and a real package registry stating each package's origin:
 *
 * - the step opens on ONE slot, `platform_admin:*`, that names no person: no
 *   one is told, and the default `admin_rescue` does not replace it;
 * - a holder of the cross-tenant `admin_full_access` grant, and the verified
 *   configured owner who has no grant row, each find it in their inbox and
 *   decide it as an ordinary approver; the decision records the person and the
 *   slot (`actor_id`, `acted_as`), not an override;
 * - a member of the request's organization takes no slot and cannot decide;
 *   an administrator of that organization takes no slot either (the #3424
 *   override stays what it was, and is recorded as one), and an administrator
 *   of another organization cannot decide at all;
 * - a revoked administrator cannot decide a request opened before the
 *   revocation;
 * - the node refuses to open, writing nothing, unless the running body is a
 *   `code` package's own: a flow authored in the environment, an environment
 *   override of a host flow (whose NAME a host package ships), a marketplace
 *   or authored package's flow, an unrecorded package, and a fallback slate
 *   naming the type are all refused; a residual owner a `code` door recorded
 *   is admitted;
 * - the save door refuses the type as early feedback; `os lint` does not;
 * - CONTROL: an existing approver type opens and is decided as before, and
 *   the platform administrator takes no slot on it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { bindSecurityCatalogReader, type SecurityCatalogEntry, type SecurityCatalogReader } from '@objectstack/core';
import { normalizeStackInput } from '@objectstack/spec';
import { runAuthoringRules, runRuntimeAuthoringRules, APPROVAL_APPROVER_PLATFORM_ADMIN_AUTHORED } from '@objectstack/lint';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { registerApprovalNode } from './approval-node.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const SLOT = 'platform_admin:*';
const ORG = 'org_a';
const OTHER_ORG = 'org_b';
const OWNER_EMAIL = 'owner@platform.test';

/**
 * A fresh acting envelope per call, as a transport builds one per request,
 * carrying NO posture and no permissions: every admission below comes from
 * the stored rows the predicate reads, never from the envelope.
 */
const as = (userId: string, org = ORG, permissions: string[] = []) =>
  ({ userId, tenantId: org, positions: [], permissions }) as any;

const USERS = [
  { id: 'u_sub', email: 'u_sub@example.com' },
  { id: 'u_root', email: 'u_root@example.com' },
  { id: 'u_owner_cfg', email: OWNER_EMAIL, email_verified: true },
  { id: 'u_member', email: 'u_member@example.com' },
  { id: 'u_org_admin', email: 'u_org_admin@example.com' },
  { id: 'u_other_admin', email: 'u_other_admin@example.com' },
  { id: 'u_revoked', email: 'u_revoked@example.com' },
  { id: 'u_alice', email: 'u_alice@example.com' },
];

const MEMBERS: Array<[string, string, string]> = [
  ['u_sub', ORG, 'member'],
  ['u_root', ORG, 'member'],
  ['u_owner_cfg', ORG, 'member'],
  ['u_member', ORG, 'member'],
  ['u_org_admin', ORG, 'admin'],
  ['u_other_admin', OTHER_ORG, 'admin'],
  ['u_revoked', ORG, 'member'],
  ['u_alice', ORG, 'member'],
];

/** The Default Organization: an `admin_full_access` grant anchors platform standing only there (ADR-0131 D5). */
const DEFAULT_ORG = 'org_default';

/** `sys_user_permission_set`: the platform grant lives in the Default Organization. */
const GRANTS: Array<[string, string, string, string | null]> = [
  ['ups_root', 'u_root', 'admin_full_access', DEFAULT_ORG],
  ['ups_revoked', 'u_revoked', 'admin_full_access', DEFAULT_ORG],
  ['ups_org_admin', 'u_org_admin', 'organization_admin', ORG],
  ['ups_other_admin', 'u_other_admin', 'organization_admin', OTHER_ORG],
];

/** Which package's body the engine arms for each flow name (`armedFlowPackage`). */
const ARMED: Record<string, string | undefined> = {
  host_review: 'com.host.review',
  residual_review: 'com.host.residual',
  marketplace_review: 'com.vendor.app',
  authored_review: 'com.tenant.authored',
  unrecorded_review: 'com.nobody.recorded',
  installed_residual_review: 'com.vendor.residual',
  // A flow authored in the environment, and an environment override of the
  // host's `host_review_overridden`: the engine names no package for either.
  tenant_review: undefined,
  host_review_overridden: undefined,
};
/** Who ships each flow's NAME (`packagedFlowOwner`): the override's name is the host's. */
/**
 * The body the engine holds armed under every flow name here: one approval
 * node, the object the executor hands when the run executes that body.
 */
const ARMED_NODE = { id: 'review', type: 'approval', label: 'Review', config: { approvers: [{ type: 'platform_admin' }] } };
const ARMED_BODY = { nodes: [{ id: 'start', type: 'start' }, ARMED_NODE] };
const NAME_OWNER: Record<string, string | undefined> = {
  host_review: 'com.host.review',
  host_review_overridden: 'com.host.review',
};

const text = (name: string) => ({ name, label: name, type: 'text' as const });
const objectDef = (name: string, fields: string[], extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: Object.fromEntries([
    ['id', { ...text('id'), primaryKey: true }],
    ...fields.map((f) => [f, text(f)]),
    ...Object.entries(extra),
  ]),
});

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

const pkg = (id: string) => ({ id, name: id, version: '1.0.0', type: 'app' });

describe('platform_admin approver: one slot the platform administrators decide under', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let now = Date.parse('2026-11-16T09:00:00.000Z');
  const told: string[][] = [];
  const prevOwnerEnv = process.env.OS_PLATFORM_OWNER_EMAIL;

  const open = async (
    key: string, flowName: string, approvers: any[], extra: Record<string, unknown> = {},
    scene: { fields?: Record<string, unknown>; node?: unknown } = {},
  ) => {
    const fields = { title: key, ...scene.fields };
    await engine.insert('crm_deal', { id: `D_${key}`, ...fields, organization_id: ORG }, { context: SYSTEM } as any);
    const opened = await svc.openNodeRequest({
      object: 'crm_deal', recordId: `D_${key}`, runId: `run_${key}`, nodeId: 'review', flowName,
      config: { approvers, behavior: 'first_response', ...extra } as any,
      submitterId: 'u_sub', record: { id: `D_${key}`, ...fields }, organizationId: ORG,
      node: 'node' in scene ? scene.node : ARMED_NODE,
    }, as('u_sub'));
    // A slate that reads as empty auto-approves instead of opening; no pin here
    // expects that, so it is a failure of the scene, not a branch to handle.
    if ('autoApproved' in opened) throw new Error(`node ${key} auto-approved instead of opening`);
    return opened;
  };
  const PLATFORM = [{ type: 'platform_admin' }];
  const requestRows = async (key: string): Promise<any[]> => engine.find('sys_approval_request', {
    where: { record_id: `D_${key}` }, context: SYSTEM,
  });
  const actionsOf = async (requestId: string): Promise<any[]> => engine.find('sys_approval_action', {
    where: { request_id: requestId }, context: SYSTEM,
  });
  /** The inbox asked for the platform slot, as the caller. */
  const inbox = async (ctx: any): Promise<string[]> =>
    (await svc.listRequests({ status: 'pending', approverId: [SLOT] }, ctx)).map((r) => r.id).sort();

  beforeAll(async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    const defs = [
      // Accounts belong to no organization: membership says which they are in.
      {
        ...objectDef('sys_user', ['name', 'email'], { email_verified: { name: 'email_verified', label: 'v', type: 'boolean' } }),
        systemFields: { tenant: false },
      },
      // Organizations belong to no organization (ADR-0131).
      { ...objectDef('sys_organization', ['name', 'slug']), systemFields: { tenant: false } },
      objectDef('sys_member', ['user_id', 'organization_id', 'role']),
      objectDef('sys_user_position', ['user_id', 'position', 'organization_id']),
      objectDef('sys_user_permission_set', ['user_id', 'permission_set', 'organization_id']),
      objectDef('crm_deal', ['title', 'reviewer', 'organization_id']),
      ...(await packageObjects()),
    ];
    for (const def of defs) engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    await engine.syncSchemas();
    await relaxTenantColumns(engine, ['sys_user', 'sys_user_permission_set', 'crm_deal']);
    bindSecurityCatalogReader(engine, catalogServing(['organization_admin', 'admin_full_access']));
    for (const [id, slug] of [[DEFAULT_ORG, 'default'], [ORG, 'org-a'], [OTHER_ORG, 'org-b']]) {
      await engine.insert('sys_organization', { id, slug, name: slug }, { context: SYSTEM } as any);
    }
    for (const u of USERS) await engine.insert('sys_user', { name: u.id, ...u }, { context: SYSTEM } as any);
    for (const [i, [user_id, organization_id, role]] of MEMBERS.entries()) {
      await engine.insert('sys_member', { id: `m_${i}`, user_id, organization_id, role }, { context: SYSTEM } as any);
    }
    for (const [id, user_id, permission_set, organization_id] of GRANTS) {
      await engine.insert('sys_user_permission_set', { id, user_id, permission_set, organization_id },
        { context: SYSTEM } as any);
    }
    // The registering doors' statements: the host's own code, a marketplace
    // install, a package created in this environment, and two residual owners.
    engine.registry.installPackage(pkg('com.host.review') as never, 'code');
    engine.registry.installPackage(pkg('com.vendor.app') as never, 'marketplace');
    engine.registry.installPackage(pkg('com.tenant.authored') as never, 'authored');
    engine.recordResidualOwner('com.host.residual', 'code');
    engine.recordResidualOwner('com.vendor.residual', 'marketplace');

    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
    svc.attachMessaging({
      emit: (async (input: { topic: string; audience: string[] }) => {
        if (input.topic === 'approval.requested') told.push(input.audience);
      }) as any,
    });
    svc.attachAutomation({
      armedFlowPackage: (name: string) => ARMED[name],
      packagedFlowOwner: (name: string) => NAME_OWNER[name],
      getFlow: async () => ARMED_BODY,
    } as any);
  });

  afterAll(async () => {
    if (prevOwnerEnv === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
    else process.env.OS_PLATFORM_OWNER_EMAIL = prevOwnerEnv;
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('a host flow opens on the one slot, tells no one, and admin_rescue does not replace it', async () => {
    const before = told.length;
    const row = await open('slot', 'host_review', PLATFORM);
    expect(row.status).toBe('pending');
    expect(row.pending_approvers).toEqual([SLOT]);
    expect(told.slice(before).flat()).toEqual([]);
  });

  it('a holder of the cross-tenant grant finds it and decides it as an ordinary approver', async () => {
    const row = await open('grant', 'host_review', PLATFORM);
    expect(await inbox(as('u_root'))).toContain(row.id);
    expect((await svc.getRequest(row.id, as('u_root')) as any)?.viewer?.can_act).toBe(true);
    const out = await svc.decide(row.id, { decision: 'approve' } as any, as('u_root'));
    expect([out.finalized, out.request.status]).toEqual([true, 'approved']);
    const decision = (await actionsOf(row.id)).find((a) => a.action === 'approve');
    expect(decision).toMatchObject({ actor_id: 'u_root', acted_as: SLOT });
    expect(Boolean(decision?.via_override)).toBe(false);
  });

  it('the verified configured owner, who has no grant row, decides it too', async () => {
    const row = await open('owner', 'host_review', PLATFORM);
    expect(await inbox(as('u_owner_cfg'))).toContain(row.id);
    // Naming the slot is admitted for the owner as well as the default actor.
    const out = await svc.decide(row.id, { decision: 'reject', actorId: SLOT } as any, as('u_owner_cfg'));
    expect(out.request.status).toBe('rejected');
    const decision = (await actionsOf(row.id)).find((a) => a.action === 'reject');
    expect(decision).toMatchObject({ actor_id: 'u_owner_cfg', acted_as: SLOT });
    expect(Boolean(decision?.via_override)).toBe(false);
  });

  it('a member of the request\'s organization takes no slot and cannot decide', async () => {
    const row = await open('member', 'host_review', PLATFORM);
    expect(await inbox(as('u_member'))).toEqual([]);
    // Not a participant, so the request is not theirs to read: it answers as an id that names none.
    await expect(svc.decide(row.id, { decision: 'approve' } as any, as('u_member')))
      .rejects.toThrow(/^REQUEST_NOT_FOUND: /);
    await expect(svc.decide(row.id, { decision: 'approve', actorId: SLOT } as any, as('u_member')))
      .rejects.toThrow(/^FORBIDDEN: cannot act as 'platform_admin:\*'/);
    expect((await requestRows('member'))[0].status).toBe('pending');
  });

  it('an organization administrator takes no slot and no override: decide, reassign and recall are refused; another organization\'s cannot decide', async () => {
    const row = await open('org_admin', 'host_review', PLATFORM);
    const orgAdmin = () => as('u_org_admin', ORG, ['organization_admin']);
    expect((await svc.getRequest(row.id, orgAdmin()) as any)?.viewer).toMatchObject({ can_act: false, can_override: false });
    await expect(svc.decide(row.id, { decision: 'approve', actorId: SLOT } as any, orgAdmin()))
      .rejects.toThrow(/^FORBIDDEN: cannot act as 'platform_admin:\*'/);
    await expect(svc.decide(row.id, { decision: 'approve' } as any, orgAdmin()))
      .rejects.toThrow(/^FORBIDDEN: actor 'u_org_admin' is not a pending approver/);
    await expect(svc.reassign(row.id, { actorId: 'u_org_admin', to: 'u_alice' }, orgAdmin()))
      .rejects.toThrow(/^FORBIDDEN: /);
    await expect(svc.recall(row.id, {} as any, orgAdmin()))
      .rejects.toThrow(/^FORBIDDEN: /);
    await expect(svc.decide(row.id, { decision: 'approve' } as any, as('u_other_admin', OTHER_ORG, ['organization_admin'])))
      .rejects.toThrow(/^REQUEST_NOT_FOUND: /);
    expect(await requestRows('org_admin')).toMatchObject([{ status: 'pending', pending_approvers: SLOT }]);
    expect(await actionsOf(row.id)).not.toContainEqual(expect.objectContaining({ actor_id: 'u_org_admin' }));
  });

  it('an override finalizes the whole request, so a mixed slate is withheld from the organization administrator whole; its ordinary slot holder decides as before', async () => {
    const orgAdmin = () => as('u_org_admin', ORG, ['organization_admin']);
    const mixed = await open('mixed', 'host_review', [...PLATFORM, { type: 'user', value: 'u_alice' }]);
    expect(mixed.pending_approvers).toEqual([SLOT, 'u_alice']);
    expect((await svc.getRequest(mixed.id, orgAdmin()) as any)?.viewer).toMatchObject({ can_act: false, can_override: false });
    await expect(svc.decide(mixed.id, { decision: 'approve' } as any, orgAdmin()))
      .rejects.toThrow(/^FORBIDDEN: actor 'u_org_admin' is not a pending approver/);
    await svc.decide(mixed.id, { decision: 'approve' } as any, as('u_alice'));
    expect((await actionsOf(mixed.id)).find((a) => a.action === 'approve'))
      .toMatchObject({ actor_id: 'u_alice', acted_as: 'u_alice' });
    expect(Boolean((await actionsOf(mixed.id)).find((a) => a.action === 'approve')?.via_override)).toBe(false);
    // CONTROL: on a slate without the platform slot the tenant arm is unchanged.
    const ordinary = await open('ordinary', 'tenant_review', [{ type: 'user', value: 'u_alice' }]);
    expect((await svc.getRequest(ordinary.id, orgAdmin()) as any)?.viewer).toMatchObject({ can_act: false, can_override: true });
  });

  it('CONTROL: the platform administrator\'s override arm is unchanged on the platform slot', async () => {
    const row = await open('platform_override', 'host_review', PLATFORM);
    const root = () => as('u_root', ORG, ['admin_full_access']);
    expect((await svc.getRequest(row.id, root()) as any)?.viewer).toMatchObject({ can_act: true, can_override: true });
    // Recall holds no slot: the override arm alone admits a caller who is not
    // the submitter.
    await svc.recall(row.id, {} as any, root());
    expect((await requestRows('platform_override'))[0].status).not.toBe('pending');
  });

  it('a revoked administrator cannot decide a request opened before the revocation', async () => {
    const row = await open('revoked', 'host_review', PLATFORM);
    expect((await svc.getRequest(row.id, as('u_revoked')) as any)?.viewer?.can_act).toBe(true);
    await engine.delete('sys_user_permission_set', { where: { id: 'ups_revoked' }, context: SYSTEM } as any);
    expect(await inbox(as('u_revoked'))).toEqual([]);
    await expect(svc.decide(row.id, { decision: 'approve' } as any, as('u_revoked')))
      .rejects.toThrow(/^REQUEST_NOT_FOUND: /);
    await expect(svc.decide(row.id, { decision: 'approve', actorId: SLOT } as any, as('u_revoked')))
      .rejects.toThrow(/^FORBIDDEN: cannot act as 'platform_admin:\*'/);
    expect((await requestRows('revoked'))[0].status).toBe('pending');
  });

  describe('only the running body of a code package\'s flow may name it; the node refuses, writing nothing', () => {
    const refused = async (key: string, flowName: string, approvers: any[] = PLATFORM, extra = {}) => {
      await expect(open(key, flowName, approvers, extra)).rejects.toThrow(
        /^FORBIDDEN: approval node 'review' of flow '[a-z_]+' names the platform administrators/,
      );
      expect(await requestRows(key)).toEqual([]);
    };

    it('a flow authored in the environment is refused', async () => {
      await refused('tenant', 'tenant_review');
    });

    it('an environment override of a host flow is refused, though the host ships its name', async () => {
      await refused('override', 'host_review_overridden');
    });

    it('a marketplace package\'s flow is refused', async () => {
      await refused('marketplace', 'marketplace_review');
    });

    it('an authored package\'s flow, an unrecorded package\'s and a marketplace residual\'s are refused', async () => {
      await refused('authored', 'authored_review');
      await refused('unrecorded', 'unrecorded_review');
      await refused('installed_residual', 'installed_residual_review');
    });

    it('a fallback slate naming it is refused the same way', async () => {
      await refused('fallback', 'tenant_review', [{ type: 'position', value: 'nobody_holds_this' }], {
        onEmptyApprovers: 'fallback', fallbackApprovers: PLATFORM,
      });
    });

    it('a residual owner a code door recorded is admitted', async () => {
      const row = await open('residual', 'residual_review', PLATFORM);
      expect(row.pending_approvers).toEqual([SLOT]);
    });
  });

  describe('the slot is opened only by the approver type that names it: every other way a slate is resolved opens no slot', () => {
    it('a user approver whose value is the slot opens none; the slate keeps its people', async () => {
      const row = await open('via_user', 'tenant_review', [{ type: 'user', value: SLOT }, { type: 'user', value: 'u_alice' }]);
      expect(row.pending_approvers).toEqual(['u_alice']);
    });

    it('a record field holding the slot opens none', async () => {
      const row = await open('via_field', 'tenant_review', [{ type: 'field', value: 'reviewer' }], {},
        { fields: { reviewer: `${SLOT},u_alice` } });
      expect(row.pending_approvers).toEqual(['u_alice']);
    });

    it('an expression resolved as users that yields the slot opens none', async () => {
      const row = await open('via_expression', 'tenant_review',
        [{ type: 'expression', value: 'trigger.reviewer', resolveAs: 'user' }, { type: 'user', value: 'u_alice' }], {},
        { fields: { reviewer: SLOT } });
      expect(row.pending_approvers).toEqual(['u_alice']);
    });

    it('a directory row holding the slot opens none', async () => {
      await engine.insert('sys_user_position', {
        id: 'pos_slot', user_id: SLOT, position: 'deal_desk', organization_id: ORG,
      }, { context: SYSTEM } as any);
      try {
        const row = await open('via_directory', 'tenant_review',
          [{ type: 'position', value: 'deal_desk' }, { type: 'user', value: 'u_alice' }]);
        expect(row.pending_approvers).toEqual(['u_alice']);
      } finally {
        await engine.delete('sys_user_position', { where: { id: 'pos_slot' }, context: SYSTEM } as any);
      }
    });

    it('an SLA escalation onto a position whose holder row holds the slot does not hand the request to it', async () => {
      await engine.insert('sys_user_position', {
        id: 'pos_slot_esc', user_id: SLOT, position: 'escalation_desk', organization_id: ORG,
      }, { context: SYSTEM } as any);
      try {
        await open('via_escalation', 'tenant_review', [{ type: 'user', value: 'u_alice' }],
          { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'escalation_desk', notifySubmitter: false } });
        now += 2 * 3600_000;
        await svc.runEscalations();
        expect((await requestRows('via_escalation'))[0].pending_approvers).not.toContain(SLOT);
      } finally {
        await engine.delete('sys_user_position', { where: { id: 'pos_slot_esc' }, context: SYSTEM } as any);
      }
    });

    it('an out-of-office delegation that ends on the slot leaves the slot with the person', async () => {
      await engine.insert('sys_approval_delegation', {
        id: 'dlg_alice', delegator_id: 'u_alice', delegate_id: SLOT, organization_id: ORG,
      }, { context: SYSTEM } as any);
      try {
        const row = await open('via_delegation', 'tenant_review', [{ type: 'user', value: 'u_alice' }]);
        expect(row.pending_approvers).toEqual(['u_alice']);
      } finally {
        await engine.delete('sys_approval_delegation', { where: { id: 'dlg_alice' }, context: SYSTEM } as any);
      }
    });
  });

  describe('the platform\'s place on a mixed slate moves only for the platform or the system', () => {
    const mixed = (key: string) => open(key, 'host_review', [...PLATFORM, { type: 'user', value: 'u_alice' }]);

    it('the ordinary slot holder cannot move it', async () => {
      const row = await mixed('move_by_holder');
      await expect(svc.reassign(row.id, { actorId: 'u_alice', from: SLOT, to: 'u_member' }, as('u_alice')))
        .rejects.toThrow(/^FORBIDDEN: actor 'u_alice' may not move the platform administrators' slot/);
      expect((await requestRows('move_by_holder'))[0].pending_approvers).toBe(`${SLOT},u_alice`);
    });

    it('a platform administrator can', async () => {
      const row = await mixed('move_by_platform');
      await svc.reassign(row.id, { actorId: SLOT, from: SLOT, to: 'u_member' }, as('u_root'));
      expect((await requestRows('move_by_platform'))[0].pending_approvers).toBe('u_member,u_alice');
    });

    it('the system can', async () => {
      const row = await mixed('move_by_system');
      await svc.reassign(row.id, { actorId: 'system', from: SLOT, to: 'u_member' }, SYSTEM);
      expect((await requestRows('move_by_system'))[0].pending_approvers).toBe('u_member,u_alice');
    });
  });

  describe('the origin is answered for the body whose step is being opened', () => {
    it('a node that is not the armed body\'s is refused, though the armed body is a code package\'s', async () => {
      await expect(open('other_body', 'host_review', PLATFORM, {}, { node: { ...ARMED_NODE } }))
        .rejects.toThrow(/^FORBIDDEN: approval node 'review' of flow 'host_review' names the platform administrators/);
      await expect(open('no_body', 'host_review', PLATFORM, {}, { node: undefined }))
        .rejects.toThrow(/^FORBIDDEN: /);
      expect(await requestRows('other_body')).toEqual([]);
    });

    it('the approval executor hands the node it runs: the armed body\'s opens, another body\'s does not', async () => {
      const executors: any[] = [];
      registerApprovalNode({ registerNodeExecutor: (e: any) => { executors.push(e); } } as any, svc);
      const executor = executors.find((e) => e.type === 'approval');
      const run = async (key: string, node: unknown) => {
        await engine.insert('crm_deal', { id: `D_${key}`, title: key, organization_id: ORG }, { context: SYSTEM } as any);
        const variables = new Map<string, unknown>([
          ['$runId', `run_${key}`], ['$record', { id: `D_${key}`, title: key }], ['$flowName', 'host_review'],
        ]);
        return executor.execute(node, variables, { object: 'crm_deal', userId: 'u_sub', organizationId: ORG, tenantId: ORG });
      };
      expect(await run('exec_armed', ARMED_NODE)).toMatchObject({ success: true, suspend: true });
      const other = await run('exec_other', { ...ARMED_NODE });
      expect(other.success).toBe(false);
      expect(other.error).toMatch(/FORBIDDEN: approval node 'review'/);
      expect(await requestRows('exec_other')).toEqual([]);
    });
  });

  it('the save door refuses it as early feedback; os lint knows the type and refuses nothing', () => {
    const flow = {
      name: 'tenant_review', label: 'Tenant review', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'review', type: 'approval', label: 'Review', config: { approvers: PLATFORM } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'review' },
        { id: 'e2', source: 'review', target: 'end', label: 'approve' },
      ],
    };
    const judged = runRuntimeAuthoringRules({ type: 'flow', item: flow });
    const door = judged.errors.filter((f) => f.rule === APPROVAL_APPROVER_PLATFORM_ADMIN_AUTHORED);
    expect(door.map((f) => f.path)).toEqual(['flows[0].nodes[1].config.approvers[0].type']);
    const normalized = normalizeStackInput({
      manifest: { id: 'com.acme.lint', name: 'lint_probe', version: '1.0.0', type: 'app' }, flows: [flow],
    } as any) as any;
    const cli = runAuthoringRules('lint', { normalized });
    expect(cli.filter((f) => f.rule === APPROVAL_APPROVER_PLATFORM_ADMIN_AUTHORED)).toEqual([]);
    expect(cli.filter((f) => f.rule === 'approval-approver-type-unknown')).toEqual([]);
  });

  it('CONTROL: an existing approver type opens and is decided as before; the platform administrator takes no slot on it', async () => {
    const row = await open('control', 'tenant_review', [{ type: 'user', value: 'u_alice' }]);
    expect(row.pending_approvers).toEqual(['u_alice']);
    // The scene: u_root DOES hold platform standing (the grant pin above), so
    // the absence here is the slot's, not a caller with no standing.
    expect(await inbox(as('u_root'))).not.toContain(row.id);
    expect(await svc.getRequest(row.id, as('u_root'))).toBeNull();
    await expect(svc.decide(row.id, { decision: 'approve' } as any, as('u_root')))
      .rejects.toThrow(/^REQUEST_NOT_FOUND: /);
    const out = await svc.decide(row.id, { decision: 'approve' } as any, as('u_alice'));
    expect(out.request.status).toBe('approved');
    expect((await actionsOf(row.id)).find((a) => a.action === 'approve')).toMatchObject({
      actor_id: 'u_alice', acted_as: 'u_alice',
    });
  });
});
