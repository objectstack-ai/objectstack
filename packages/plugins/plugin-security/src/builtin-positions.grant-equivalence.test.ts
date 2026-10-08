// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D2, C2 stage S2] Grant equivalence: declaring the six built-in
 * positions as position metadata changes no principal's grants.
 *
 * The stage moves where the six come from — one declaration list, registered
 * with the engine registry and read by the built-in seeder — and changes what
 * the declared-positions seeder reads. No resolver reads a definition yet, so
 * the only ways a grant could move are a catalog row that is no longer seeded,
 * seeded differently, or seeded twice: above all `everyone`, which carries every
 * authenticated principal's baseline through its binding. So unlike a
 * resolver-only harness, this one runs the plugin's REAL `kernel:ready`
 * bootstrap (catalog seeding and the baseline binding to `everyone` included)
 * before it resolves anyone, and the catalog holds a stack-declared position
 * beside the six.
 *
 * The four principals, resolved by the REAL resolver in two postures, against
 * a golden recorded from the tree BEFORE the declarations existed (the PR record
 * carries that run):
 *
 * - **platform administrator** — `single`: the first authenticable user,
 *   promoted by the bootstrap; walled: the declared `OS_PLATFORM_OWNER_EMAIL`
 *   owner (configuration, no row);
 * - **organization administrator** — the owner membership, granted by
 *   `reconcileOrgAdminGrant`;
 * - **member** — a member granted a set through the data door by an
 *   administrator's non-system write;
 * - **agent** — an OAuth agent acting for the organization administrator with
 *   the actions consent (`assembleExecutionContext`, ADR-0090 D10).
 *
 * What is compared is the resolver's whole envelope per principal, arrays
 * sorted so a reorder is not read as a change. `member_default` reaching every
 * human principal is the `everyone` binding at work.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  assembleExecutionContext,
  resetPlatformAdminEmailMemo,
  resolveUserAuthzGrants,
} from '@objectstack/core';
import type { PermissionSet } from '@objectstack/spec/security';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';

import { SecurityPlugin } from './security-plugin.js';
import { reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { securityObjects } from './manifest.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const ORG = 'org_eq';

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

/** A stack-declared position, as an app registers it with the metadata service. */
const DECLARED_POSITIONS = [{ name: 'field_rep', label: 'Field Rep', description: 'Works the territory' }];

/**
 * The app's own default set — the deployment's declared baseline, bound to
 * `everyone` by the boot. Owned by a package, so the walled boot materializes
 * the organization's copy of it and binds THAT, the way an installed app's
 * default set reaches every organization's `everyone`.
 */
const APP_DEFAULT = {
  name: 'field_default',
  label: 'Field Default',
  isDefault: true,
  objects: { sys_user: { allowRead: true } },
  _packageId: 'com.example.field',
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

type Posture = 'single' | 'isolated';

const sortDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sortDeep((value as any)[k])]));
  }
  return value;
};

async function grantsByPrincipal(posture: Posture): Promise<Record<string, unknown>> {
  if (posture === 'isolated') {
    process.env[POSTURE_ENV] = 'isolated';
    process.env[OWNER_ENV] = 'admin@eq.example';
  }
  resetPlatformAdminEmailMemo();

  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.builtin-position-equivalence',
    name: 'Built-in position equivalence',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUser, SysAccount, SysMember, SysOrganization, ...securityObjects],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async (type: string) => {
        if (type === 'position') return DECLARED_POSITIONS.map((p) => ({ ...p }));
        if (type === 'permission') return [...defaultPermissionSets, QA_ADMIN, APP_DEFAULT];
        return [];
      },
    },
    ...(posture === 'isolated'
      ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture: 'isolated' } }
      : {}),
  };
  const hooks = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: (name: string, handler: (...args: unknown[]) => unknown) => {
      hooks.set(name, [...(hooks.get(name) ?? []), handler]);
    },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'field_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

  // Everything the boot sweep reads exists BEFORE `kernel:ready`: the
  // organization (the walled sweep seeds one catalog per organization) and
  // the users (the `single` sweep promotes the first authenticable one).
  const orgCtx = { isSystem: true, tenantId: ORG };
  await engine.insert('sys_organization', { id: ORG, name: 'Eq Org', slug: 'eq' }, { context: SYS } as any);
  const user = async (id: string, email: string, createdAt: string) => {
    await engine.insert('sys_user', { id, email, name: id, created_at: createdAt, email_verified: true }, { context: SYS } as any);
    await engine.insert(
      'sys_account', { id: `acc_${id}`, user_id: id, account_id: email, provider_id: 'credential' }, { context: SYS } as any,
    );
  };
  await user('usr_admin', 'admin@eq.example', '2025-01-01T00:00:00.000Z');
  await user('usr_orgadmin', 'orgadmin@eq.example', '2025-02-01T00:00:00.000Z');
  await user('usr_member', 'member@eq.example', '2025-03-01T00:00:00.000Z');
  await engine.insert('sys_member', [
    { id: 'm_owner', user_id: 'usr_orgadmin', organization_id: ORG, role: 'owner', created_at: '2025-02-01T00:00:00.000Z' },
    { id: 'm_member', user_id: 'usr_member', organization_id: ORG, role: 'member', created_at: '2025-03-01T00:00:00.000Z' },
  ], { context: orgCtx } as any);

  // The plugin's own boot: seeders, the baseline binding to `everyone`, the
  // organization-admin backfill — in registration order, as the kernel fires them.
  for (const handler of hooks.get('kernel:ready') ?? []) await handler();

  // PRECONDITION: the catalog the grants ride on was really seeded — the six,
  // and the stack-declared position beside them.
  const seededNames = ((await engine.find('sys_position', { where: {}, context: SYS } as any)) as any[])
    .map((r) => r.name).sort();
  expect(seededNames).toEqual(
    ['everyone', 'field_rep', 'guest', 'org_admin', 'org_member', 'org_owner', 'platform_admin'],
  );

  // Walled: the organization's own copies of the sets its grants point at
  // (the per-organization catalog), cloned from the platform bucket the boot
  // just wrote — as the name-column equivalence suite does.
  if (posture === 'isolated') {
    for (const name of ['organization_admin', 'organization_admin_no_bypass', 'viewer_readonly']) {
      const [bucket] = await engine.find('sys_permission_set', { where: { name }, context: SYS });
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = bucket as any;
      await engine.insert('sys_permission_set', { ...rest, id: `ps_${name}_${ORG}`, organization_id: ORG }, { context: orgCtx } as any);
    }
  }
  // `single`: the boot's organization-admin backfill already granted it, so
  // the reconcile finds nothing to do; walled: the organization's copy exists
  // only now, so the reconcile grants.
  const reconciled = await reconcileOrgAdminGrant(engine, 'usr_orgadmin', ORG, { posture });
  expect(reconciled.action).toBe(posture === 'single' ? 'noop' : 'granted');

  // The member's set, granted through the data door by an administrator.
  const [viewer] = await engine.find('sys_permission_set', {
    where: { name: 'viewer_readonly', ...(posture === 'isolated' ? { organization_id: ORG } : {}) },
    context: SYS,
  });
  await engine.insert(
    'sys_user_permission_set',
    { user_id: 'usr_member', permission_set_id: (viewer as any).id },
    { context: { userId: 'usr_orgadmin', positions: [], permissions: ['qa_admin'], tenantId: ORG } } as any,
  );

  const resolve = (userId: string) => resolveUserAuthzGrants(engine, userId, { tenantId: ORG });
  const admin = await resolve('usr_admin');
  const orgAdmin = await resolve('usr_orgadmin');
  const member = await resolve('usr_member');
  const agentCtx = assembleExecutionContext({
    authz: { ...orgAdmin, userId: 'usr_orgadmin', tenantId: ORG } as any,
    oauth: {
      userId: 'usr_orgadmin',
      scopes: ['data:read', 'actions:execute'],
      clientId: 'agent_client_eq',
      scopePermissions: ['mcp_agent_data_read'],
      delegatesActions: true,
    } as any,
    localization: undefined,
    requestLocale: undefined,
    accessToken: undefined,
    authGate: undefined,
  });
  const agent = {
    principalKind: (agentCtx as any)?.principalKind,
    positions: (agentCtx as any)?.positions,
    permissions: (agentCtx as any)?.permissions,
    systemPermissions: (agentCtx as any)?.systemPermissions,
    onBehalfOf: (agentCtx as any)?.onBehalfOf,
  };
  return sortDeep({ platformAdmin: admin, organizationAdmin: orgAdmin, member, agent }) as Record<string, unknown>;
}

describe('[ADR-0131 D2] grant equivalence — the built-in positions as declared metadata change no principal’s grants', () => {
  for (const posture of ['single', 'isolated'] as const) {
    it(`${posture}: platform administrator, organization administrator, member and agent resolve to the recorded golden`, async () => {
      const actual = await grantsByPrincipal(posture);
      expect(actual).toEqual(GOLDEN[posture]);
    });
  }
});

/**
 * Recorded from the tree BEFORE the declarations existed (objectstack
 * `51290bca2c`, this file run against that tree's sources), and unchanged
 * after them. `field_default` on every human principal is the `everyone`
 * binding; `single` also binds the platform's `member_default` (its
 * organization-less catalog holds that set), while the walled organization's
 * catalog holds only its own copy of the app's set. The organization
 * administrator's set is the walled `organization_admin` against the wall-less
 * `organization_admin_no_bypass` (ADR-0105 D4).
 */
const GOLDEN: Record<Posture, unknown> = {
  single: {
    agent: {
      onBehalfOf: {
        principalKind: 'human',
        userId: 'usr_orgadmin',
      },
      permissions: ['mcp_agent_data_read'],
      positions: [],
      principalKind: 'agent',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    member: {
      accessible_org_ids: ['org_eq'],
      email: 'member@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['field_default', 'member_default', 'viewer_readonly'],
      positions: ['everyone', 'org_member'],
      posture: 'MEMBER',
      systemPermissions: [],
    },
    organizationAdmin: {
      accessible_org_ids: ['org_eq'],
      email: 'orgadmin@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['field_default', 'member_default', 'organization_admin_no_bypass'],
      positions: ['everyone', 'org_owner'],
      posture: 'TENANT_ADMIN',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    platformAdmin: {
      accessible_org_ids: [],
      email: 'admin@eq.example',
      org_user_ids: ['usr_admin', 'usr_member', 'usr_orgadmin'],
      permissions: ['admin_full_access', 'field_default', 'member_default'],
      positions: ['everyone', 'platform_admin'],
      posture: 'PLATFORM_ADMIN',
      systemPermissions: [
        'manage_metadata', 'manage_platform_settings', 'manage_sharing', 'manage_users', 'setup.access',
        'setup.write', 'studio.access', 'view_all_audit_log',
      ],
    },
  },
  isolated: {
    agent: {
      onBehalfOf: {
        principalKind: 'human',
        userId: 'usr_orgadmin',
      },
      permissions: ['mcp_agent_data_read'],
      positions: [],
      principalKind: 'agent',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    member: {
      accessible_org_ids: ['org_eq'],
      email: 'member@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['field_default', 'viewer_readonly'],
      positions: ['everyone', 'org_member'],
      posture: 'MEMBER',
      systemPermissions: [],
    },
    organizationAdmin: {
      accessible_org_ids: ['org_eq'],
      email: 'orgadmin@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['field_default', 'organization_admin'],
      positions: ['everyone', 'org_owner'],
      posture: 'TENANT_ADMIN',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    platformAdmin: {
      accessible_org_ids: [],
      email: 'admin@eq.example',
      org_user_ids: ['usr_admin', 'usr_member', 'usr_orgadmin'],
      permissions: ['admin_full_access', 'field_default'],
      positions: ['everyone', 'platform_admin'],
      posture: 'PLATFORM_ADMIN',
      systemPermissions: [
        'manage_metadata', 'manage_platform_settings', 'manage_sharing', 'manage_users', 'setup.access',
        'setup.write', 'studio.access', 'view_all_audit_log',
      ],
    },
  },
};
