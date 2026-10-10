// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] Grant-equivalence goldens for the authorization resolver
 * (`resolveUserAuthzGrants`, `@objectstack/core`), whose §6 reads a user
 * grant's permission set BY NAME — `sys_user_permission_set.permission_set` —
 * instead of through `permission_set_id`.
 *
 * The resolver changes its key and not its answer. This suite boots a real
 * ObjectQL engine over the SQL driver with the real `SecurityPlugin`, so every
 * grant is written through the engine hooks that keep the two columns in step,
 * and records what the resolver answers per principal:
 *
 * - the whole envelope with the organization active, and with none (the global
 *   grants alone);
 * - platform standing as `hasPlatformAdminStanding` projects it.
 *
 * Principals: the platform administrator (`single`: the promoted first user, a
 * grant row; walled: the declared `OS_PLATFORM_OWNER_EMAIL` owner, no row), the
 * organization administrator (the owner membership, reconciled), a member (a
 * set granted through the data door, plus a grant of a DEACTIVATED set) and an
 * agent (an organization grant of an organization-less agent set inside its
 * window, plus an EXPIRED one). Three postures: `single`, `group` and
 * `isolated`.
 *
 * The golden below was recorded on the tree BEFORE the resolver moved to the
 * name (the PR record carries that run) and is unchanged after it. Pointing one
 * grant's name column at a different set turns it red with the change and
 * leaves it green on the tree before — the PR record carries that ablation.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hasPlatformAdminStanding, resetPlatformAdminEmailMemo, resolveUserAuthzGrants } from '@objectstack/core';
import type { PermissionSet } from '@objectstack/spec/security';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';

import { SecurityPlugin } from './security-plugin.js';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import { reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { SysPosition } from './objects/sys-position.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const ORG = 'org_rz';
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

async function resolverByPrincipal(posture: Posture): Promise<Record<string, unknown>> {
  const walled = posture !== 'single';
  if (walled) {
    process.env[POSTURE_ENV] = posture;
    process.env[OWNER_ENV] = 'admin@rz.example';
  }
  resetPlatformAdminEmailMemo();

  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.resolve-authz-grant-set-by-name',
    name: 'Resolver grant set by name',
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
  await engine.insert('sys_organization', { id: ORG, name: 'RZ Org', slug: 'rz' }, { context: SYS } as any);
  const user = async (id: string, email: string, createdAt: string) => {
    await engine.insert('sys_user', { id, email, name: id, created_at: createdAt, email_verified: true }, { context: SYS } as any);
    await engine.insert(
      'sys_account', { id: `acc_${id}`, user_id: id, account_id: email, provider_id: 'credential' }, { context: SYS } as any,
    );
  };
  await user('usr_admin', 'admin@rz.example', '2025-01-01T00:00:00.000Z');
  await user('usr_orgadmin', 'orgadmin@rz.example', '2025-02-01T00:00:00.000Z');
  await user('usr_member', 'member@rz.example', '2025-03-01T00:00:00.000Z');
  await user('usr_agent', 'agent@rz.example', '2025-04-01T00:00:00.000Z');

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
      inOrganization: await resolveUserAuthzGrants(engine, userId, { tenantId: ORG }),
      noOrganization: await resolveUserAuthzGrants(engine, userId, {}),
      platformStanding: await hasPlatformAdminStanding(engine, userId),
    };
  }
  return sortDeep(byPrincipal) as Record<string, unknown>;
}

describe('[ADR-0131 D4] the resolver reads a grant’s set by name — every principal answers the recorded golden', () => {
  for (const posture of ['single', 'group', 'isolated'] as const) {
    it(`${posture}: the envelope in the organization and outside it, and platform standing, per principal`, async () => {
      const actual = await resolverByPrincipal(posture);
      expect(actual).toEqual(GOLDEN[posture]);
    });
  }
});

/**
 * Recorded on the tree before the resolver moved to the name; `group` and
 * `isolated` were recorded identical, so they share one literal. `single` and
 * the walled postures differ in the organization administrator’s set alone
 * (the walled `organization_admin` against the wall-less
 * `organization_admin_no_bypass`, ADR-0105 D4); platform standing is a grant
 * row under `single` and the declared owner under a wall, and both answer the
 * same.
 */
const SINGLE: unknown = {
  agent: {
    inOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'agent@rz.example',
      org_user_ids: [
        'usr_agent',
        'usr_member',
        'usr_orgadmin'
      ],
      permissions: [
        'mcp_agent_data_read'
      ],
      positions: [
        'everyone',
        'org_member'
      ],
      posture: 'MEMBER',
      systemPermissions: []
    },
    noOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'agent@rz.example',
      org_user_ids: [
        'usr_agent'
      ],
      permissions: [],
      positions: [
        'everyone',
        'org_member'
      ],
      posture: 'MEMBER',
      systemPermissions: []
    },
    platformStanding: false
  },
  member: {
    inOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'member@rz.example',
      org_user_ids: [
        'usr_agent',
        'usr_member',
        'usr_orgadmin'
      ],
      permissions: [
        'viewer_readonly'
      ],
      positions: [
        'everyone',
        'org_member'
      ],
      posture: 'MEMBER',
      systemPermissions: []
    },
    noOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'member@rz.example',
      org_user_ids: [
        'usr_member'
      ],
      permissions: [],
      positions: [
        'everyone',
        'org_member'
      ],
      posture: 'MEMBER',
      systemPermissions: []
    },
    platformStanding: false
  },
  organizationAdmin: {
    inOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'orgadmin@rz.example',
      org_user_ids: [
        'usr_agent',
        'usr_member',
        'usr_orgadmin'
      ],
      permissions: [
        'organization_admin_no_bypass'
      ],
      positions: [
        'everyone',
        'org_owner'
      ],
      posture: 'TENANT_ADMIN',
      systemPermissions: [
        'manage_org_users',
        'setup.access',
        'setup.write'
      ]
    },
    noOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'orgadmin@rz.example',
      org_user_ids: [
        'usr_orgadmin'
      ],
      permissions: [],
      positions: [
        'everyone',
        'org_owner'
      ],
      posture: 'MEMBER',
      systemPermissions: []
    },
    platformStanding: false
  },
  platformAdmin: {
    inOrganization: {
      accessible_org_ids: [],
      email: 'admin@rz.example',
      org_user_ids: [
        'usr_admin',
        'usr_agent',
        'usr_member',
        'usr_orgadmin'
      ],
      permissions: [
        'admin_full_access'
      ],
      positions: [
        'everyone',
        'platform_admin'
      ],
      posture: 'PLATFORM_ADMIN',
      systemPermissions: [
        'manage_metadata',
        'manage_platform_settings',
        'manage_sharing',
        'manage_users',
        'setup.access',
        'setup.write',
        'studio.access',
        'view_all_audit_log'
      ]
    },
    noOrganization: {
      accessible_org_ids: [],
      email: 'admin@rz.example',
      org_user_ids: [
        'usr_admin'
      ],
      permissions: [
        'admin_full_access'
      ],
      positions: [
        'everyone',
        'platform_admin'
      ],
      posture: 'PLATFORM_ADMIN',
      systemPermissions: [
        'manage_metadata',
        'manage_platform_settings',
        'manage_sharing',
        'manage_users',
        'setup.access',
        'setup.write',
        'studio.access',
        'view_all_audit_log'
      ]
    },
    platformStanding: true
  }
};

const WALLED: unknown = {
  agent: {
    inOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'agent@rz.example',
      org_user_ids: [
        'usr_agent',
        'usr_member',
        'usr_orgadmin'
      ],
      permissions: [
        'mcp_agent_data_read'
      ],
      positions: [
        'everyone',
        'org_member'
      ],
      posture: 'MEMBER',
      systemPermissions: []
    },
    noOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'agent@rz.example',
      org_user_ids: [
        'usr_agent'
      ],
      permissions: [],
      positions: [
        'everyone',
        'org_member'
      ],
      posture: 'MEMBER',
      systemPermissions: []
    },
    platformStanding: false
  },
  member: {
    inOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'member@rz.example',
      org_user_ids: [
        'usr_agent',
        'usr_member',
        'usr_orgadmin'
      ],
      permissions: [
        'viewer_readonly'
      ],
      positions: [
        'everyone',
        'org_member'
      ],
      posture: 'MEMBER',
      systemPermissions: []
    },
    noOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'member@rz.example',
      org_user_ids: [
        'usr_member'
      ],
      permissions: [],
      positions: [
        'everyone',
        'org_member'
      ],
      posture: 'MEMBER',
      systemPermissions: []
    },
    platformStanding: false
  },
  organizationAdmin: {
    inOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'orgadmin@rz.example',
      org_user_ids: [
        'usr_agent',
        'usr_member',
        'usr_orgadmin'
      ],
      permissions: [
        'organization_admin'
      ],
      positions: [
        'everyone',
        'org_owner'
      ],
      posture: 'TENANT_ADMIN',
      systemPermissions: [
        'manage_org_users',
        'setup.access',
        'setup.write'
      ]
    },
    noOrganization: {
      accessible_org_ids: [
        'org_rz'
      ],
      email: 'orgadmin@rz.example',
      org_user_ids: [
        'usr_orgadmin'
      ],
      permissions: [],
      positions: [
        'everyone',
        'org_owner'
      ],
      posture: 'MEMBER',
      systemPermissions: []
    },
    platformStanding: false
  },
  platformAdmin: {
    inOrganization: {
      accessible_org_ids: [],
      email: 'admin@rz.example',
      org_user_ids: [
        'usr_admin',
        'usr_agent',
        'usr_member',
        'usr_orgadmin'
      ],
      permissions: [
        'admin_full_access'
      ],
      positions: [
        'everyone',
        'platform_admin'
      ],
      posture: 'PLATFORM_ADMIN',
      systemPermissions: [
        'manage_metadata',
        'manage_platform_settings',
        'manage_sharing',
        'manage_users',
        'setup.access',
        'setup.write',
        'studio.access',
        'view_all_audit_log'
      ]
    },
    noOrganization: {
      accessible_org_ids: [],
      email: 'admin@rz.example',
      org_user_ids: [
        'usr_admin'
      ],
      permissions: [
        'admin_full_access'
      ],
      positions: [
        'everyone',
        'platform_admin'
      ],
      posture: 'PLATFORM_ADMIN',
      systemPermissions: [
        'manage_metadata',
        'manage_platform_settings',
        'manage_sharing',
        'manage_users',
        'setup.access',
        'setup.write',
        'studio.access',
        'view_all_audit_log'
      ]
    },
    platformStanding: true
  }
};

const GOLDEN: Record<Posture, unknown> = { single: SINGLE, group: WALLED, isolated: WALLED };
