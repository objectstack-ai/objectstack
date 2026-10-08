// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] Grant-equivalence goldens for the `plugin-security` grant
 * readers that key on `sys_user_permission_set.permission_set`, the grant's
 * permission set BY NAME, instead of `permission_set_id`.
 *
 * The readers change their key and not their answer. This suite boots a real
 * ObjectQL engine over the SQL driver with the real `SecurityPlugin` (so every
 * grant is written through the engine hooks that keep the two columns in step)
 * and records, per principal, what each reader in this package answers:
 *
 * - **the explain engine** (`buildContextForUser`): positions, permissions,
 *   system permissions, tab permissions, posture and the dropped-grant
 *   provenance — the expired and deactivated grants are the part read through
 *   the grant's name;
 * - **platform standing** as the bootstrap reads it: who already holds the
 *   unscoped `admin_full_access` grant (`findExistingPlatformAdmin`, and the
 *   `already_have_admin` answer of a second `bootstrapPlatformAdmin` pass);
 * - **organization-administrator standing** as the reconcile reads it: a
 *   re-run per principal, the boot backfill, and a demotion.
 *
 * Principals: the platform administrator (`single`: the promoted first user, a
 * grant row; walled: the declared `OS_PLATFORM_OWNER_EMAIL` owner, no row), the
 * organization administrator (the owner membership, reconciled), a member (a
 * set granted through the data door, plus a grant of a DEACTIVATED set) and an
 * agent (a windowed agent grant, plus an EXPIRED one). Three postures:
 * `single`, `group` and `isolated`.
 *
 * The golden below was recorded on the tree BEFORE the readers moved to the
 * name (the PR record carries that run) and is unchanged after it. Pointing one
 * grant's name column at a different set turns it red — the PR record carries
 * that ablation too.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import type { PermissionSet } from '@objectstack/spec/security';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';

import { SecurityPlugin } from './security-plugin.js';
import { bootstrapPlatformAdmin, findExistingPlatformAdmin } from './bootstrap-platform-admin.js';
import { backfillOrgAdminGrants, reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { buildContextForUser } from './explain-engine.js';
import { SysPosition } from './objects/sys-position.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const ORG = 'org_gr';
const EXPIRED = '2020-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

/** The non-system administrator whose writes are the data door's (superuser wildcard). */
const QA_ADMIN = {
  name: 'qa_admin',
  label: 'QA Admin',
  objects: {
    '*': {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
  },
} as unknown as PermissionSet;

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env[POSTURE_ENV];
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

type Posture = 'single' | 'group' | 'isolated';

const sortDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sortDeep((value as any)[k])]));
  }
  return value;
};

/** What the explain engine answers for one principal, minus the row ids it does not decide. */
function explainView(ctx: any): Record<string, unknown> {
  return {
    positions: ctx.positions,
    permissions: ctx.permissions,
    systemPermissions: ctx.systemPermissions,
    tabPermissions: ctx.tabPermissions ?? null,
    posture: ctx.posture ?? null,
    hasPlatformAdminGrant: ctx.hasPlatformAdminGrant,
    droppedGrants: ctx.droppedGrants,
    delegatedPositions: ctx.delegatedPositions,
  };
}

async function readersByPrincipal(posture: Posture): Promise<Record<string, unknown>> {
  const walled = posture !== 'single';
  if (walled) {
    process.env[POSTURE_ENV] = posture;
    process.env[OWNER_ENV] = 'admin@gr.example';
  }
  resetPlatformAdminEmailMemo();

  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.grant-readers-by-name',
    name: 'Grant readers by name',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysUser, SysAccount, SysMember, SysOrganization,
      SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet,
    ],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [...defaultPermissionSets, QA_ADMIN],
    },
    ...(walled
      ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture } }
      : {}),
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: vi.fn(),
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

  const orgCtx = { isSystem: true, tenantId: ORG };
  await engine.insert('sys_organization', { id: ORG, name: 'GR Org', slug: 'gr' }, { context: SYS } as any);
  const user = async (id: string, email: string, createdAt: string) => {
    await engine.insert('sys_user', { id, email, name: id, created_at: createdAt, email_verified: true }, { context: SYS } as any);
    await engine.insert(
      'sys_account', { id: `acc_${id}`, user_id: id, account_id: email, provider_id: 'credential' }, { context: SYS } as any,
    );
  };
  await user('usr_admin', 'admin@gr.example', '2025-01-01T00:00:00.000Z');
  await user('usr_orgadmin', 'orgadmin@gr.example', '2025-02-01T00:00:00.000Z');
  await user('usr_member', 'member@gr.example', '2025-03-01T00:00:00.000Z');
  await user('usr_agent', 'agent@gr.example', '2025-04-01T00:00:00.000Z');

  // The catalog and (single) the platform-admin promotion.
  const boot = await bootstrapPlatformAdmin(engine, defaultPermissionSets);
  expect(boot.adminPromoted).toBe(posture === 'single');

  // Walled: the organization's own copies of the sets its grants point at.
  if (walled) {
    for (const name of ['organization_admin', 'organization_admin_no_bypass', 'viewer_readonly']) {
      const [bucket] = await engine.find('sys_permission_set', { where: { name }, context: SYS });
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = bucket as any;
      await engine.insert('sys_permission_set', { ...rest, id: `ps_${name}_${ORG}`, organization_id: ORG }, { context: orgCtx } as any);
    }
  }
  // A deactivated set the member still holds a grant of (ADR-0049).
  await engine.insert(
    'sys_permission_set',
    {
      id: 'ps_legacy_reports',
      name: 'legacy_reports',
      label: 'Legacy reports',
      active: false,
      ...(walled ? { organization_id: ORG } : {}),
    },
    { context: walled ? orgCtx : SYS } as any,
  );

  await engine.insert('sys_member', [
    { id: 'm_owner', user_id: 'usr_orgadmin', organization_id: ORG, role: 'owner', created_at: '2025-02-01T00:00:00.000Z' },
    { id: 'm_member', user_id: 'usr_member', organization_id: ORG, role: 'member', created_at: '2025-03-01T00:00:00.000Z' },
    { id: 'm_agent', user_id: 'usr_agent', organization_id: ORG, role: 'member', created_at: '2025-04-01T00:00:00.000Z' },
  ], { context: orgCtx } as any);
  const reconciled = await reconcileOrgAdminGrant(engine, 'usr_orgadmin', ORG, { posture });
  expect(reconciled.action).toBe('granted');

  // The member's set, granted through the data door by an administrator.
  const [viewer] = await engine.find('sys_permission_set', {
    where: { name: 'viewer_readonly', ...(walled ? { organization_id: ORG } : {}) },
    context: SYS,
  });
  await engine.insert(
    'sys_user_permission_set',
    { user_id: 'usr_member', permission_set_id: (viewer as any).id },
    {
      context: {
        userId: 'usr_orgadmin', positions: [], permissions: ['qa_admin'], tenantId: ORG, accessible_org_ids: [ORG],
      },
    } as any,
  );
  // System-written grants: the member's deactivated set, the agent's windowed
  // and expired agent grants (the platform bucket's organization-less rows).
  const setId = async (name: string) =>
    String(((await engine.find('sys_permission_set', { where: { name, organization_id: null }, context: SYS })) as any[])[0]?.id);
  await engine.insert('sys_user_permission_set', [
    { id: 'ups_member_legacy', user_id: 'usr_member', permission_set_id: 'ps_legacy_reports', organization_id: ORG },
    {
      id: 'ups_agent_read', user_id: 'usr_agent', permission_set_id: await setId('mcp_agent_data_read'),
      organization_id: ORG, valid_until: FUTURE,
    },
    {
      id: 'ups_agent_write', user_id: 'usr_agent', permission_set_id: await setId('mcp_agent_data_write'),
      organization_id: ORG, valid_until: EXPIRED,
    },
  ], { context: orgCtx } as any);

  const principals = {
    platformAdmin: 'usr_admin',
    organizationAdmin: 'usr_orgadmin',
    member: 'usr_member',
    agent: 'usr_agent',
  } as const;
  const byPrincipal: Record<string, unknown> = {};
  for (const [kind, userId] of Object.entries(principals)) {
    byPrincipal[kind] = {
      explain: explainView(await buildContextForUser(engine, userId, Date.now(), ORG)),
      reconcile: await reconcileOrgAdminGrant(engine, userId, ORG, { posture }),
    };
  }

  const rerun = await bootstrapPlatformAdmin(engine, defaultPermissionSets);
  const standing = {
    existingPlatformAdmin: (await findExistingPlatformAdmin(engine, defaultPermissionSets)) ?? null,
    bootstrapRerun: {
      adminPromoted: rerun.adminPromoted,
      reason: rerun.reason ?? null,
      adminUserId: rerun.adminUserId ?? null,
    },
  };
  const backfill = await backfillOrgAdminGrants(engine, { posture });

  // A demotion: the owner membership drops to member, and the reconcile
  // revokes the organization-administrator grant.
  await engine.update('sys_member', { id: 'm_owner', role: 'member' }, { context: orgCtx } as any);
  const demotion = {
    reconcile: await reconcileOrgAdminGrant(engine, 'usr_orgadmin', ORG, { posture }),
    explain: explainView(await buildContextForUser(engine, 'usr_orgadmin', Date.now(), ORG)),
  };

  return sortDeep({ standing, principals: byPrincipal, backfill, demotion }) as Record<string, unknown>;
}

describe('[ADR-0131 D4] grant readers by name — every principal answers the recorded golden', () => {
  for (const posture of ['single', 'group', 'isolated'] as const) {
    it(`${posture}: explain, platform standing and organization-administrator standing per principal`, async () => {
      const actual = await readersByPrincipal(posture);
      expect(actual).toEqual(GOLDEN[posture]);
    });
  }
});

/**
 * Recorded on the tree before the readers moved to the name; `group` and
 * `isolated` were recorded identical, so they share one literal. `single` and the two walled postures differ in exactly two places: the organization
 * administrator's set (the walled `organization_admin` against the wall-less
 * `organization_admin_no_bypass`, ADR-0105 D4) and platform standing (a grant row
 * under `single`; the declared owner, which no grant row carries, under a wall).
 */
const SINGLE: unknown = {
  backfill: { granted: 0, revoked: 0, scanned: 3, skipped: 0 },
  demotion: {
    explain: {
      delegatedPositions: [],
      droppedGrants: [],
      hasPlatformAdminGrant: false,
      permissions: [],
      positions: ['everyone', 'org_member'],
      posture: 'MEMBER',
      systemPermissions: [],
      tabPermissions: null,
    },
    reconcile: { action: 'noop' },
  },
  principals: {
    agent: {
      explain: {
        delegatedPositions: [],
        droppedGrants: [
          {
            kind: 'permission_set',
            name: 'mcp_agent_data_write',
            state: 'expired',
            until: '2020-01-01T00:00:00.000Z',
          },
        ],
        hasPlatformAdminGrant: false,
        permissions: ['mcp_agent_data_read'],
        positions: ['everyone', 'org_member'],
        posture: 'MEMBER',
        systemPermissions: [],
        tabPermissions: null,
      },
      reconcile: { action: 'noop' },
    },
    member: {
      explain: {
        delegatedPositions: [],
        droppedGrants: [{ kind: 'permission_set', name: 'legacy_reports', state: 'deactivated' }],
        hasPlatformAdminGrant: false,
        permissions: ['viewer_readonly'],
        positions: ['everyone', 'org_member'],
        posture: 'MEMBER',
        systemPermissions: [],
        tabPermissions: null,
      },
      reconcile: { action: 'noop' },
    },
    organizationAdmin: {
      explain: {
        delegatedPositions: [],
        droppedGrants: [],
        hasPlatformAdminGrant: false,
        permissions: ['organization_admin_no_bypass'],
        positions: ['everyone', 'org_owner'],
        posture: 'TENANT_ADMIN',
        systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
        tabPermissions: null,
      },
      reconcile: { action: 'noop' },
    },
    platformAdmin: {
      explain: {
        delegatedPositions: [],
        droppedGrants: [],
        hasPlatformAdminGrant: true,
        permissions: ['admin_full_access'],
        positions: ['everyone', 'platform_admin'],
        posture: 'PLATFORM_ADMIN',
        systemPermissions: [
          'manage_metadata',
          'manage_platform_settings',
          'manage_sharing',
          'manage_users',
          'setup.access',
          'setup.write',
          'studio.access',
          'view_all_audit_log',
        ],
        tabPermissions: null,
      },
      reconcile: { action: 'noop' },
    },
  },
  standing: {
    bootstrapRerun: { adminPromoted: false, adminUserId: 'usr_admin', reason: 'already_have_admin' },
    existingPlatformAdmin: 'usr_admin',
  },
};

const WALLED: unknown = {
  backfill: { granted: 0, revoked: 0, scanned: 3, skipped: 0 },
  demotion: {
    explain: {
      delegatedPositions: [],
      droppedGrants: [],
      hasPlatformAdminGrant: false,
      permissions: [],
      positions: ['everyone', 'org_member'],
      posture: 'MEMBER',
      systemPermissions: [],
      tabPermissions: null,
    },
    reconcile: { action: 'noop' },
  },
  principals: {
    agent: {
      explain: {
        delegatedPositions: [],
        droppedGrants: [
          {
            kind: 'permission_set',
            name: 'mcp_agent_data_write',
            state: 'expired',
            until: '2020-01-01T00:00:00.000Z',
          },
        ],
        hasPlatformAdminGrant: false,
        permissions: ['mcp_agent_data_read'],
        positions: ['everyone', 'org_member'],
        posture: 'MEMBER',
        systemPermissions: [],
        tabPermissions: null,
      },
      reconcile: { action: 'noop' },
    },
    member: {
      explain: {
        delegatedPositions: [],
        droppedGrants: [{ kind: 'permission_set', name: 'legacy_reports', state: 'deactivated' }],
        hasPlatformAdminGrant: false,
        permissions: ['viewer_readonly'],
        positions: ['everyone', 'org_member'],
        posture: 'MEMBER',
        systemPermissions: [],
        tabPermissions: null,
      },
      reconcile: { action: 'noop' },
    },
    organizationAdmin: {
      explain: {
        delegatedPositions: [],
        droppedGrants: [],
        hasPlatformAdminGrant: false,
        permissions: ['organization_admin'],
        positions: ['everyone', 'org_owner'],
        posture: 'TENANT_ADMIN',
        systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
        tabPermissions: null,
      },
      reconcile: { action: 'noop' },
    },
    platformAdmin: {
      explain: {
        delegatedPositions: [],
        droppedGrants: [],
        hasPlatformAdminGrant: true,
        permissions: ['admin_full_access'],
        positions: ['everyone', 'platform_admin'],
        posture: 'PLATFORM_ADMIN',
        systemPermissions: [
          'manage_metadata',
          'manage_platform_settings',
          'manage_sharing',
          'manage_users',
          'setup.access',
          'setup.write',
          'studio.access',
          'view_all_audit_log',
        ],
        tabPermissions: null,
      },
      reconcile: { action: 'noop' },
    },
  },
  standing: {
    bootstrapRerun: { adminPromoted: false, adminUserId: null, reason: 'walled_config_derived' },
    existingPlatformAdmin: null,
  },
};

const GOLDEN: Record<Posture, unknown> = { single: SINGLE, group: WALLED, isolated: WALLED };
