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

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { AutomationEngine } from '@objectstack/service-automation';
import { SqlDriver } from '@objectstack/driver-sql';
import { bindSecurityCatalogReader, type SecurityCatalogEntry, type SecurityCatalogReader } from '@objectstack/core';
import { normalizeStackInput } from '@objectstack/spec';
import { ApprovalNodeConfigSchema } from '@objectstack/spec/automation';
import { runAuthoringRules, runRuntimeAuthoringRules, APPROVAL_APPROVER_PLATFORM_ADMIN_AUTHORED } from '@objectstack/lint';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { registerApprovalNode } from './approval-node.js';
import { readStoredSlate, readsAsPlatformAdminAddress } from './approver-address.js';
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
/** A stand-in for the flow engine's reads, answering from the tables above. */
const STAND_IN_AUTOMATION = {
  armedFlowPackage: (name: string) => ARMED[name],
  packagedFlowOwner: (name: string) => NAME_OWNER[name],
  getFlow: async () => ARMED_BODY,
} as any;

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

/** The members each queue's expander answers, as the queue service would. */
const QUEUES: Record<string, string[]> = {};

/** The record a request's snapshot carries when a `platform_admin` step opened its slot. */
const SLOT_RECORD_KEY = '__platformAdminSlotOpened';

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
        ...objectDef('sys_user', ['name', 'email', 'manager_id'], { email_verified: { name: 'email_verified', label: 'v', type: 'boolean' } }),
        systemFields: { tenant: false },
      },
      // Organizations belong to no organization (ADR-0131).
      { ...objectDef('sys_organization', ['name', 'slug']), systemFields: { tenant: false } },
      objectDef('sys_member', ['user_id', 'organization_id', 'role']),
      objectDef('sys_user_position', ['user_id', 'position', 'organization_id']),
      objectDef('sys_user_permission_set', ['user_id', 'permission_set', 'organization_id']),
      objectDef('crm_deal', ['title', 'reviewer', 'subject', 'organization_id'], {
        reviewers: { name: 'reviewers', label: 'reviewers', type: 'lookup', reference: 'sys_user', multiple: true },
      }),
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
      ownershipQueues: () => ({ expandMembers: async (name: string) => QUEUES[name] ?? [] }),
    });
    svc.attachMessaging({
      emit: (async (input: { topic: string; audience: string[] }) => {
        if (input.topic === 'approval.requested') told.push(input.audience);
      }) as any,
    });
    svc.attachAutomation(STAND_IN_AUTOMATION);
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

  it('the slot reads by a label, not its address: on the stored row and on the approvals door', async () => {
    const row = await open('label', 'host_review', PLATFORM);
    const [stored] = await requestRows('label');
    expect(stored.pending_approver_labels).toBe('Platform administrators');
    expect((await svc.getRequest(row.id, as('u_root')) as any)?.pending_approver_names)
      .toEqual({ [SLOT]: 'Platform administrators' });
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
    const out = await svc.decide(row.id, { decision: 'reject', comment: 'Over budget.', actorId: SLOT } as any, as('u_owner_cfg'));
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
    it('case 1: the resolved slate holds no slot the typed approver did not open', async () => {
      const row = await open('case_1', 'tenant_review', [{ type: 'user', value: SLOT }, { type: 'user', value: 'u_alice' }]);
      expect(row.pending_approvers).toEqual(['u_alice']);
    });

    it('case 2: the resolved slate holds no slot the typed approver did not open', async () => {
      const row = await open('case_2', 'tenant_review', [{ type: 'field', value: 'reviewer' }], {},
        { fields: { reviewer: `${SLOT},u_alice` } });
      expect(row.pending_approvers).toEqual(['u_alice']);
    });

    it('case 3: the resolved slate holds no slot the typed approver did not open', async () => {
      const row = await open('case_3', 'tenant_review',
        [{ type: 'expression', value: 'trigger.reviewer', resolveAs: 'user' }, { type: 'user', value: 'u_alice' }], {},
        { fields: { reviewer: SLOT } });
      expect(row.pending_approvers).toEqual(['u_alice']);
    });

    it('case 4: the resolved slate holds no slot the typed approver did not open', async () => {
      await engine.insert('sys_user_position', {
        id: 'pos_case_4', user_id: SLOT, position: 'deal_desk', organization_id: ORG,
      }, { context: SYSTEM } as any);
      try {
        const row = await open('case_4', 'tenant_review',
          [{ type: 'position', value: 'deal_desk' }, { type: 'user', value: 'u_alice' }]);
        expect(row.pending_approvers).toEqual(['u_alice']);
      } finally {
        await engine.delete('sys_user_position', { where: { id: 'pos_case_4' }, context: SYSTEM } as any);
      }
    });

    it('case 5: a later slate holds no slot the typed approver did not open', async () => {
      await engine.insert('sys_user_position', {
        id: 'pos_case_5', user_id: SLOT, position: 'escalation_desk', organization_id: ORG,
      }, { context: SYSTEM } as any);
      try {
        await open('case_5', 'tenant_review', [{ type: 'user', value: 'u_alice' }],
          { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'escalation_desk', notifySubmitter: false } });
        now += 2 * 3600_000;
        await svc.runEscalations();
        expect((await requestRows('case_5'))[0].pending_approvers).not.toContain(SLOT);
      } finally {
        await engine.delete('sys_user_position', { where: { id: 'pos_case_5' }, context: SYSTEM } as any);
      }
    });

    it('case 6: the resolved slate keeps its people and holds no slot the typed approver did not open', async () => {
      await engine.insert('sys_approval_delegation', {
        id: 'dlg_case_6', delegator_id: 'u_alice', delegate_id: SLOT, organization_id: ORG,
      }, { context: SYSTEM } as any);
      try {
        const row = await open('case_6', 'tenant_review', [{ type: 'user', value: 'u_alice' }]);
        expect(row.pending_approvers).toEqual(['u_alice']);
      } finally {
        await engine.delete('sys_approval_delegation', { where: { id: 'dlg_case_6' }, context: SYSTEM } as any);
      }
    });
  });

  describe('the slot is judged on the slate the decision, override and inbox doors read: no route opens it but the typed approver', () => {
    const person = { type: 'user', value: 'u_member' };
    const joined = `u_alice,${SLOT}`;
    const orgAdmin = () => as('u_org_admin', ORG, ['organization_admin']);
    /**
     * The doors, each as it reads the stored slate: the request as the
     * service serves it, the approver index as plugin start rebuilds it from
     * the stored slate (the inbox), the decision admission for a caller in
     * platform standing naming the slot, and the override admission (a slate
     * holding the slot would withhold the tenant arm).
     */
    const expectNoDoorReadsTheSlot = async (id: string) => {
      expect((await svc.getRequest(id, SYSTEM))?.pending_approvers).not.toContain(SLOT);
      await svc.rebuildApproverIndex();
      expect(await inbox(as('u_root'))).not.toContain(id);
      await expect(svc.decide(id, { decision: 'approve', actorId: SLOT } as any, as('u_root')))
        .rejects.toThrow(/^(REQUEST_NOT_FOUND|FORBIDDEN): /);
      expect((await svc.getRequest(id, orgAdmin()) as any)?.viewer?.can_override).toBe(true);
    };
    const withRows = async (object: string, rows: Array<Record<string, unknown>>, body: () => Promise<void>) => {
      for (const row of rows) await engine.insert(object, row, { context: SYSTEM } as any);
      try {
        await body();
      } finally {
        for (const row of rows) await engine.delete(object, { where: { id: row.id }, context: SYSTEM } as any);
      }
    };
    const opensOn = async (key: string, approvers: any[], expected: string[], extra = {}, fields = {}) => {
      const row = await open(key, 'tenant_review', approvers, extra, { fields });
      expect(row.pending_approvers).toEqual(expected);
      await expectNoDoorReadsTheSlot(row.id);
      return row;
    };

    it('case 7: an approver entry opens no slot the doors read', async () => {
      await opensOn('case_7', [person, { type: 'user', value: joined }], ['u_member']);
    });

    it('case 8: an approver entry opens no slot the doors read', async () => {
      await opensOn('case_8', [person, { type: 'user', value: `u_alice, ${SLOT}` }], ['u_member']);
    });

    it('case 9: an approver entry opens no slot the doors read', async () => {
      await opensOn('case_9', [person, { type: 'team', value: `no_team,${SLOT}` }], ['u_member']);
    });

    it('case 10: an approver entry opens no slot the doors read', async () => {
      await opensOn('case_10', [person, { type: 'position', value: `nobody,${SLOT}` }], ['u_member']);
    });

    it('case 11: an approver entry opens no slot the doors read', async () => {
      await opensOn('case_11', [person, { type: 'org_membership_level', value: `nobody,${SLOT}` }], ['u_member']);
    });

    it('case 12: an approver entry opens no slot the doors read', async () => {
      await opensOn('case_12', [person, { type: 'department', value: `no_unit,${SLOT}` }], ['u_member']);
    });

    it('case 13: a record value opens no slot the doors read', async () => {
      await opensOn('case_13', [person, { type: 'field', value: 'reviewers' }], ['u_member'], {}, { reviewers: [joined] });
    });

    it('case 14: a directory value opens no slot the doors read', async () => {
      await withRows('sys_user', [{ id: 'u_case_14', name: 'u_case_14', manager_id: joined }], async () => {
        await opensOn('case_14', [person, { type: 'manager', value: 'subject' }], ['u_member'], {}, { subject: 'u_case_14' });
      });
    });

    it('case 15: a directory value opens no slot the doors read', async () => {
      await withRows('sys_user_position', [{ id: 'pos_case_15', user_id: joined, position: 'desk_15', organization_id: ORG }], async () => {
        await opensOn('case_15', [person, { type: 'position', value: 'desk_15' }], ['u_member']);
        await opensOn('case_15b', [person, { type: 'expression', value: "'desk_15'", resolveAs: 'position' }], ['u_member']);
      });
    });

    it('case 16: a delegation opens no slot the doors read, and the slot stays with its approver', async () => {
      await withRows('sys_approval_delegation', [{
        id: 'dlg_case_16', delegator_id: 'u_alice', delegate_id: `u_member,${SLOT}`, organization_id: ORG,
      }], async () => {
        await opensOn('case_16', [person, { type: 'user', value: 'u_alice' }], ['u_member', 'u_alice']);
      });
    });

    it('case 17: a fallback slate opens no slot the doors read', async () => {
      await opensOn('case_17', [{ type: 'position', value: 'nobody_holds_this' }], ['u_member'], {
        onEmptyApprovers: 'fallback', fallbackApprovers: [person, { type: 'team', value: `no_team,${SLOT}` }],
      });
    });

    it('case 18: the administrators\' slate opens no slot the doors read', async () => {
      await withRows('sys_member', [{ id: 'm_case_18', user_id: joined, organization_id: ORG, role: 'admin' }], async () => {
        await withRows('sys_user_permission_set', [{
          id: 'ups_case_18', user_id: joined, permission_set: 'organization_admin', organization_id: ORG,
        }], async () => {
          await opensOn('case_18', [{ type: 'position', value: 'nobody_holds_this' }], ['u_org_admin']);
        });
      });
    });

    it('case 19: a slate rewritten by a vote holds no slot the doors read', async () => {
      const row = await opensOn('case_19',
        [person, { type: 'user', value: 'u_alice' }, { type: 'team', value: `no_team,${SLOT}` }],
        ['u_member', 'u_alice'], { behavior: 'unanimous' });
      const out = await svc.decide(row.id, { decision: 'approve' } as any, as('u_member'));
      expect(out.request.pending_approvers).toEqual(['u_alice']);
      await expectNoDoorReadsTheSlot(row.id);
    });

    it('case 20: a slate the SLA hands over holds no slot the doors read', async () => {
      await withRows('sys_user_position', [
        { id: 'pos_case_20', user_id: joined, position: 'desk_20', organization_id: ORG },
        { id: 'pos_case_20b', user_id: 'u_member', position: `desk_20b,${SLOT}`, organization_id: ORG },
      ], async () => {
        for (const [key, escalateTo] of [['case_20', 'desk_20'], ['case_20b', `position:desk_20b,${SLOT}`]]) {
          const row = await open(key, 'tenant_review', [{ type: 'user', value: 'u_alice' }],
            { escalation: { timeoutHours: 1, action: 'reassign', escalateTo, notifySubmitter: false } });
          now += 2 * 3600_000;
          await svc.runEscalations();
          expect((await svc.getRequest(row.id, SYSTEM))?.pending_approvers).toEqual(['u_alice']);
          await expectNoDoorReadsTheSlot(row.id);
        }
      });
    });

    it('case 21: a hand-off target puts no slot on the slate the doors read', async () => {
      await withRows('sys_user_position', [{ id: 'pos_case_21', user_id: 'u_member', position: `desk_21,${SLOT}`, organization_id: ORG }], async () => {
        const row = await open('case_21', 'tenant_review', [{ type: 'user', value: 'u_alice' }]);
        await expect(svc.reassign(row.id, { actorId: 'u_alice', to: `position:desk_21,${SLOT}` }, as('u_alice')))
          .rejects.toThrow(/^VALIDATION_FAILED: cannot reassign to /);
        expect((await svc.getRequest(row.id, SYSTEM))?.pending_approvers).toEqual(['u_alice']);
        await expectNoDoorReadsTheSlot(row.id);
      });
    });

    it('case 22: a queue\'s members open no slot the doors read', async () => {
      QUEUES.queue_22 = ['u_member', SLOT, joined];
      await opensOn('case_22', [{ type: 'queue', value: 'queue_22' }], ['u_member']);
    });

    it('case 23: an expression yielding a list of people opens no slot the doors read', async () => {
      await opensOn('case_23', [{ type: 'expression', value: 'trigger.reviewers', resolveAs: 'user' }], ['u_member'], {},
        { reviewers: ['u_member', SLOT, joined] });
    });

    it('the slot test is total: an entry that is not text is judged as the text the stored slate holds for it', () => {
      const entries: unknown[] = [
        42, true, null, undefined, { toString: () => SLOT }, [SLOT], ['u_alice', SLOT], [['u_alice', SLOT]],
        [`u_alice, ${SLOT}`], ['u_alice', 'u_member'],
      ];
      const asStored = entries.map((entry) => readStoredSlate([entry].join(',')).includes(SLOT));
      expect(entries.map((entry) => readsAsPlatformAdminAddress(entry))).toEqual(asStored);
      expect(asStored.filter(Boolean)).toHaveLength(5);
    });
  });

  describe('the doors honour the slot only on a request that records a platform_admin step opened it', () => {
    const orgAdmin = () => as('u_org_admin', ORG, ['organization_admin']);
    const snapshotOf = async (key: string): Promise<Record<string, unknown>> =>
      JSON.parse(String((await requestRows(key))[0].node_config_json));
    /** The request as a row that holds no such record: its stored slate and the rest of its snapshot as they are. */
    const withoutTheRecord = async (key: string): Promise<void> => {
      const [row] = await requestRows(key);
      const snapshot = await snapshotOf(key);
      delete snapshot[SLOT_RECORD_KEY];
      await engine.update('sys_approval_request', { id: row.id, node_config_json: JSON.stringify(snapshot) },
        { context: SYSTEM } as any);
    };
    const doorsRead = async (id: string) => {
      await svc.rebuildApproverIndex();
      return {
        served: (await svc.getRequest(id, SYSTEM))?.pending_approvers,
        listed: (await inbox(as('u_root'))).includes(id),
        orgAdminOverrides: (await svc.getRequest(id, orgAdmin()) as any)?.viewer?.can_override,
      };
    };

    it('CONTROL: a request a platform_admin step opened records it, and every door reads the slot', async () => {
      const row = await open('recorded', 'host_review', [...PLATFORM, { type: 'user', value: 'u_alice' }]);
      expect((await snapshotOf('recorded'))[SLOT_RECORD_KEY]).toBe(true);
      expect(await doorsRead(row.id)).toEqual({ served: [SLOT, 'u_alice'], listed: true, orgAdminOverrides: false });
      const out = await svc.decide(row.id, { decision: 'approve', actorId: SLOT } as any, as('u_root'));
      expect(out.request.status).toBe('approved');
      expect((await actionsOf(row.id)).find((a) => a.action === 'approve')).toMatchObject({ actor_id: 'u_root', acted_as: SLOT });
    });

    it('a request without the record: no door reads the slot its stored slate holds, and its people decide as before', async () => {
      const row = await open('no_record', 'host_review', [...PLATFORM, { type: 'user', value: 'u_alice' }]);
      await withoutTheRecord('no_record');
      expect((await requestRows('no_record'))[0].pending_approvers).toBe(`${SLOT},u_alice`);
      expect(await doorsRead(row.id)).toEqual({ served: ['u_alice'], listed: false, orgAdminOverrides: true });
      await expect(svc.decide(row.id, { decision: 'approve', actorId: SLOT } as any, as('u_root')))
        .rejects.toThrow(/^(REQUEST_NOT_FOUND|FORBIDDEN): /);
      await expect(svc.decide(row.id, { decision: 'approve' } as any, as('u_root')))
        .rejects.toThrow(/^(REQUEST_NOT_FOUND|FORBIDDEN): /);
      const out = await svc.decide(row.id, { decision: 'approve' } as any, as('u_alice'));
      expect(out.request.status).toBe('approved');
    });

    it('a request without the record: a vote that rewrites its slate indexes no slot for the inbox', async () => {
      const row = await open('no_record_vote', 'host_review', [...PLATFORM, { type: 'user', value: 'u_alice' }],
        { behavior: 'unanimous' });
      await withoutTheRecord('no_record_vote');
      await svc.rebuildApproverIndex();
      await svc.decide(row.id, { decision: 'approve' } as any, as('u_alice'));
      expect((await requestRows('no_record_vote'))[0]).toMatchObject({ status: 'pending', pending_approvers: SLOT });
      expect(await inbox(as('u_root'))).not.toContain(row.id);
      expect(await doorsRead(row.id)).toEqual({ served: [], listed: false, orgAdminOverrides: true });
    });

    it('only the open path writes the record: a step\'s config cannot carry it', async () => {
      const declared = ApprovalNodeConfigSchema.safeParse({ approvers: PLATFORM, [SLOT_RECORD_KEY]: true });
      expect(declared.success).toBe(false);
      expect(declared.error?.issues.map((issue) => issue.code)).toContain('unrecognized_keys');
      await open('handed', 'tenant_review', [{ type: 'user', value: 'u_alice' }], { [SLOT_RECORD_KEY]: true });
      expect(await snapshotOf('handed')).not.toHaveProperty(SLOT_RECORD_KEY);
    });
  });

  describe('the origin is answered for the body whose step is being opened, on the real flow engine', () => {
    const HOST_FLOW = 'host_review_real';
    const flowDef = {
      name: HOST_FLOW, label: 'Host review', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'review', type: 'approval', label: 'Review', config: { approvers: [{ type: 'platform_admin' }] } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'review' },
        { id: 'e2', source: 'review', target: 'end', label: 'approve' },
        { id: 'e3', source: 'review', target: 'end', label: 'reject' },
      ],
    };
    const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
    let automation: AutomationEngine;
    let armedNode: any;

    beforeAll(async () => {
      automation = new AutomationEngine(quiet);
      registerApprovalNode(automation as any, svc, quiet);
      automation.setPackagedFlowSource((name) => (name === HOST_FLOW ? 'com.host.review' : undefined));
      automation.registerFlow(HOST_FLOW, flowDef, { source: 'package', packageId: 'com.host.review' });
      svc.attachAutomation(automation as any);
      armedNode = (await automation.getFlow(HOST_FLOW))?.nodes.find((n: any) => n.id === 'review');
    });

    afterAll(() => {
      svc.attachAutomation(STAND_IN_AUTOMATION);
      vi.restoreAllMocks();
    });

    const deal = async (key: string) => {
      await engine.insert('crm_deal', { id: `D_${key}`, title: key, organization_id: ORG }, { context: SYSTEM } as any);
      return { id: `D_${key}`, title: key };
    };
    const openDirect = async (key: string, node: unknown, flowKey?: string) => svc.openNodeRequest({
      object: 'crm_deal', recordId: `D_${key}`, runId: `run_${key}`, nodeId: 'review', flowName: HOST_FLOW, flowKey,
      config: { approvers: [{ type: 'platform_admin' }], behavior: 'first_response' } as any,
      submitterId: 'u_sub', record: await deal(key), organizationId: ORG, node,
    }, as('u_sub'));

    it('a real run of a code package\'s flow opens on the slot, the origin read for the body it runs', async () => {
      expect(automation.armedFlowPackage(HOST_FLOW)).toBe('com.host.review');
      const slotRead = vi.spyOn(automation, 'getFlowSlot');
      const record = await deal('real_run');
      const result = await automation.execute(HOST_FLOW, {
        object: 'crm_deal', record, userId: 'u_sub', organizationId: ORG, tenantId: ORG,
      } as any);
      expect(result).toMatchObject({ status: 'paused' });
      expect(slotRead).toHaveBeenCalledWith('com.host.review', HOST_FLOW);
      expect(await requestRows('real_run')).toMatchObject([{ status: 'pending', pending_approvers: SLOT }]);
      slotRead.mockRestore();
    });

    it('the slot read: the armed body\'s own step opens, and a step it does not hold is refused', async () => {
      const slotRead = vi.spyOn(automation, 'getFlowSlot');
      const opened = await openDirect('real_slot', armedNode, HOST_FLOW);
      expect(opened).toMatchObject({ status: 'pending', pending_approvers: [SLOT] });
      expect(slotRead).toHaveBeenCalledWith('com.host.review', HOST_FLOW);
      await expect(openDirect('real_slot_copy', { ...armedNode }, HOST_FLOW))
        .rejects.toThrow(/^FORBIDDEN: approval node 'review' of flow 'host_review_real' names the platform administrators/);
      expect(await requestRows('real_slot_copy')).toEqual([]);
      slotRead.mockRestore();
    });

    it('the bare read: the armed body\'s own step opens, and a step it does not hold is refused', async () => {
      const slotRead = vi.spyOn(automation, 'getFlowSlot');
      const bareRead = vi.spyOn(automation, 'getFlow');
      const opened = await openDirect('real_bare', armedNode);
      expect(opened).toMatchObject({ status: 'pending', pending_approvers: [SLOT] });
      expect(bareRead).toHaveBeenCalledWith(HOST_FLOW);
      expect(slotRead).not.toHaveBeenCalled();
      await expect(openDirect('real_bare_copy', { ...armedNode }))
        .rejects.toThrow(/^FORBIDDEN: approval node 'review' of flow 'host_review_real' names the platform administrators/);
      expect(await requestRows('real_bare_copy')).toEqual([]);
      slotRead.mockRestore();
      bareRead.mockRestore();
    });
  });

  describe('the platform\'s place on a mixed slate moves only for the platform or the system', () => {
    const mixed = (key: string) => open(key, 'host_review', [...PLATFORM, { type: 'user', value: 'u_alice' }]);

    it('a caller without platform standing cannot move it', async () => {
      const row = await mixed('move_1');
      await expect(svc.reassign(row.id, { actorId: 'u_alice', from: SLOT, to: 'u_member' }, as('u_alice')))
        .rejects.toThrow(/^FORBIDDEN: actor 'u_alice' may not move the platform administrators' slot/);
      expect((await requestRows('move_1'))[0].pending_approvers).toBe(`${SLOT},u_alice`);
    });

    it('a platform administrator can', async () => {
      const row = await mixed('move_2');
      await svc.reassign(row.id, { actorId: SLOT, from: SLOT, to: 'u_member' }, as('u_root'));
      expect((await requestRows('move_2'))[0].pending_approvers).toBe('u_member,u_alice');
    });

    it('the system can', async () => {
      const row = await mixed('move_3');
      await svc.reassign(row.id, { actorId: 'system', from: SLOT, to: 'u_member' }, SYSTEM);
      expect((await requestRows('move_3'))[0].pending_approvers).toBe('u_member,u_alice');
    });
  });

  describe('the origin is answered for the body whose step is being opened', () => {
    it('a step the answered origin does not describe is refused', async () => {
      await expect(open('origin_1', 'host_review', PLATFORM, {}, { node: { ...ARMED_NODE } }))
        .rejects.toThrow(/^FORBIDDEN: approval node 'review' of flow 'host_review' names the platform administrators/);
      await expect(open('origin_2', 'host_review', PLATFORM, {}, { node: undefined }))
        .rejects.toThrow(/^FORBIDDEN: /);
      expect(await requestRows('origin_1')).toEqual([]);
    });

    it('the approval executor hands the step it runs, and the origin is answered for that step', async () => {
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
      expect(await run('origin_3', ARMED_NODE)).toMatchObject({ success: true, suspend: true });
      const other = await run('origin_4', { ...ARMED_NODE });
      expect(other.success).toBe(false);
      expect(other.error).toMatch(/FORBIDDEN: approval node 'review'/);
      expect(await requestRows('origin_4')).toEqual([]);
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
