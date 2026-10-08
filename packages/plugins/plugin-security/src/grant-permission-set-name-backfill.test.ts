// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] The one-time backfill of `sys_user_permission_set.permission_set`
 * on grants written before the column existed.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver with the REAL
 * `SecurityPlugin` started on it, so the backfill's writes pass the same
 * engine, driver wall and name hooks a deployment's do. A grant "written
 * before the column existed" is made by writing it with the name hooks
 * unbound and clearing the name, which is the stored shape such a grant has.
 *
 * The catalog the names are verified through is S1's read
 * (`createSecurityCatalogReader`) over the engine registry, which holds the
 * permission-set definitions here as a package manifest's `permissions` put
 * them there in a deployment.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  LiteKernel,
  assembleExecutionContext,
  createSecurityCatalogReader,
  resetPlatformAdminEmailMemo,
  resolveUserAuthzGrants,
  type SecurityCatalogReader,
} from '@objectstack/core';
import type { PermissionSet } from '@objectstack/spec/security';
import { DATA_MIGRATION_FLAG_OBJECT } from '@objectstack/spec/system';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';
import { SysMigration } from '@objectstack/platform-objects/system';

import { SecurityPlugin } from './security-plugin.js';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import { reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { SysPosition } from './objects/sys-position.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import {
  registerGrantPermissionSetNameHooks,
  unregisterGrantPermissionSetNameHooks,
} from './grant-permission-set-name.js';
import {
  GRANT_SET_NAME_BACKFILL_MIGRATION_ID,
  runOneTimeGrantPermissionSetNameBackfill,
} from './grant-permission-set-name-backfill.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const ORG = 'org_eq';
const OTHER_ORG = 'org_other';
const CATALOG_PACKAGE = 'com.objectstack.qa.grant-name-backfill';

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

/** A tenant's own set, and the other organization's set of another name. */
const OWN_SET = { name: 'eq_reviewer', label: 'Reviewer', objects: {} } as unknown as PermissionSet;
const OTHER_SET = { name: 'other_auditor', label: 'Auditor', objects: {} } as unknown as PermissionSet;

type Posture = 'single' | 'isolated';
type Engine = ObjectQL;
const engines: Engine[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env[POSTURE_ENV];
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const newLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

interface World {
  engine: Engine;
  catalog: SecurityCatalogReader;
  /** Kernel lifecycle hooks the plugin registered, by event — collected, never fired by the fixture. */
  hooks: Map<string, Array<() => Promise<unknown>>>;
  pluginLogger: ReturnType<typeof newLogger>;
}

/**
 * A booted engine with the RBAC objects, the deployment ledger and the started
 * `SecurityPlugin`, in `posture`; the platform catalog rows seeded by
 * `bootstrapPlatformAdmin` (and, in `single`, its promotion), and both
 * organizations present.
 */
async function boot(posture: Posture, opts: { ledger?: boolean } = {}): Promise<World> {
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
    id: 'com.objectstack.qa.grant-name-backfill',
    name: 'Grant name backfill',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysUser, SysAccount, SysMember, SysOrganization,
      SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet,
      ...(opts.ledger === false ? [] : [SysMigration]),
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
    ...(posture === 'isolated'
      ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture: 'isolated' } }
      : {}),
  };
  const hooks = new Map<string, Array<() => Promise<unknown>>>();
  const pluginLogger = newLogger();
  const ctx: any = {
    logger: pluginLogger,
    hook: (event: string, handler: () => Promise<unknown>) => {
      if (!hooks.has(event)) hooks.set(event, []);
      hooks.get(event)!.push(handler);
    },
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

  for (const [id, slug] of [[ORG, 'eq'], [OTHER_ORG, 'other']]) {
    await engine.insert('sys_organization', { id, name: id, slug }, { context: SYS } as any);
  }
  // The catalog definitions, where a package manifest's `permissions` put them
  // — registered once the organizations exist, so the plugin's
  // organization-creation catalog seeding (not this suite's subject) seeds
  // exactly what it seeds in the S4a equivalence world.
  // Copies: the registry stamps its item in place, and these are shared module objects.
  for (const ps of [...defaultPermissionSets, QA_ADMIN, OWN_SET, OTHER_SET]) {
    engine.registry.registerItem('permission', structuredClone(ps) as any, 'name' as any, CATALOG_PACKAGE);
  }
  const seeded = await bootstrapPlatformAdmin(engine, defaultPermissionSets);
  expect(seeded.adminPromoted).toBe(false); // no user yet — the golden world promotes after its users exist

  const catalog = createSecurityCatalogReader({ registry: engine.registry, metadata: services.metadata as any });
  return { engine, catalog, hooks, pluginLogger };
}

const orgCtx = (organizationId: string) => ({ isSystem: true, tenantId: organizationId });

async function insertSet(engine: Engine, row: Record<string, unknown>, organizationId?: string): Promise<void> {
  await engine.insert('sys_permission_set', row, { context: organizationId ? orgCtx(organizationId) : SYS } as any);
}

async function insertUser(engine: Engine, id: string, email: string, createdAt: string): Promise<void> {
  await engine.insert('sys_user', { id, email, name: id, created_at: createdAt, email_verified: true }, { context: SYS } as any);
  await engine.insert(
    'sys_account', { id: `acc_${id}`, user_id: id, account_id: email, provider_id: 'credential' }, { context: SYS } as any,
  );
}

/** Write grants the way they were stored before the name column existed: id only, name NULL. */
async function insertUnnamedGrants(engine: Engine, rows: Array<Record<string, unknown>>): Promise<void> {
  unregisterGrantPermissionSetNameHooks(engine);
  try {
    for (const row of rows) {
      await engine.insert('sys_user_permission_set', row, { context: SYS } as any);
    }
  } finally {
    registerGrantPermissionSetNameHooks(engine);
  }
}

/** Clear every grant's name — what a grant written before the column carries. */
async function clearAllNames(engine: Engine): Promise<void> {
  unregisterGrantPermissionSetNameHooks(engine);
  try {
    const rows = (await engine.find('sys_user_permission_set', { fields: ['id'], context: SYS })) as any[];
    for (const row of rows) {
      await engine.update('sys_user_permission_set', { id: row.id, permission_set: null }, { context: SYS } as any);
    }
  } finally {
    registerGrantPermissionSetNameHooks(engine);
  }
}

async function grants(engine: Engine): Promise<Array<Record<string, any>>> {
  const rows = (await engine.find('sys_user_permission_set', {
    fields: ['id', 'user_id', 'permission_set_id', 'permission_set', 'organization_id'],
    orderBy: [{ field: 'id', order: 'asc' }],
    context: SYS,
  })) as any[];
  return rows;
}

async function grant(engine: Engine, id: string): Promise<Record<string, any> | null> {
  return (await engine.findOne('sys_user_permission_set', { where: { id }, context: SYS })) as any;
}

async function ledgerRows(engine: Engine): Promise<Array<Record<string, any>>> {
  return (await engine.find(DATA_MIGRATION_FLAG_OBJECT, {
    where: { id: GRANT_SET_NAME_BACKFILL_MIGRATION_ID },
    context: SYS,
  })) as any[];
}

/** Every string a logger mock was handed — message and meta — for disclosure checks. */
const loggedText = (logger: ReturnType<typeof newLogger>): string =>
  JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls]);

// ---------------------------------------------------------------------------
// The four principals (the grant-equivalence world)
// ---------------------------------------------------------------------------

const sortDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sortDeep((value as any)[k])]));
  }
  return value;
};

/**
 * The platform administrator, organization administrator and member written by
 * the REAL writers, as the S4a equivalence suite writes them; the organization's
 * own catalog copies in the walled posture.
 */
async function seedPrincipals(world: World, posture: Posture): Promise<void> {
  const { engine } = world;
  await insertUser(engine, 'usr_admin', 'admin@eq.example', '2025-01-01T00:00:00.000Z');
  await insertUser(engine, 'usr_orgadmin', 'orgadmin@eq.example', '2025-02-01T00:00:00.000Z');
  await insertUser(engine, 'usr_member', 'member@eq.example', '2025-03-01T00:00:00.000Z');
  const promoted = await bootstrapPlatformAdmin(engine, defaultPermissionSets);
  expect(promoted.adminPromoted).toBe(posture === 'single');

  if (posture === 'isolated') {
    for (const name of ['organization_admin', 'organization_admin_no_bypass', 'viewer_readonly']) {
      const [bucket] = (await engine.find('sys_permission_set', { where: { name }, context: SYS })) as any[];
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = bucket;
      await insertSet(engine, { ...rest, id: `ps_${name}_${ORG}`, organization_id: ORG }, ORG);
    }
  }

  await engine.insert('sys_member', [
    { id: 'm_owner', user_id: 'usr_orgadmin', organization_id: ORG, role: 'owner', created_at: '2025-02-01T00:00:00.000Z' },
    { id: 'm_member', user_id: 'usr_member', organization_id: ORG, role: 'member', created_at: '2025-03-01T00:00:00.000Z' },
  ], { context: orgCtx(ORG) } as any);
  const reconciled = await reconcileOrgAdminGrant(engine, 'usr_orgadmin', ORG, { posture });
  expect(reconciled.action).toBe('granted');

  const [viewer] = (await engine.find('sys_permission_set', {
    where: { name: 'viewer_readonly', ...(posture === 'isolated' ? { organization_id: ORG } : {}) },
    context: SYS,
  })) as any[];
  await engine.insert(
    'sys_user_permission_set',
    { user_id: 'usr_member', permission_set_id: viewer.id },
    { context: { userId: 'usr_orgadmin', positions: [], permissions: ['qa_admin'], tenantId: ORG } } as any,
  );
}

async function grantsByPrincipal(engine: Engine): Promise<Record<string, unknown>> {
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

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe('[ADR-0131 D4] grant name backfill — every name agrees with the id and resolves through the catalog read', () => {
  for (const posture of ['single', 'isolated'] as const) {
    it(`${posture}: each unnamed grant gets the name of the set row its id points at, verified through the catalog read`, async () => {
      const world = await boot(posture);
      const { engine, catalog } = world;
      await seedPrincipals(world, posture);
      // An organization's grant pointing at the organization-less platform row,
      // the shape grants written before the per-organization catalog carry.
      const [bucketViewer] = (await engine.find('sys_permission_set', {
        where: { name: 'viewer_readonly', organization_id: null }, context: SYS,
      })) as any[];
      await insertUnnamedGrants(engine, [
        { id: 'g_bucket', user_id: 'usr_orgadmin', permission_set_id: bucketViewer.id, organization_id: ORG },
      ]);
      await clearAllNames(engine);
      const before = await grants(engine);
      expect(before.length).toBe(posture === 'single' ? 4 : 3);
      expect(before.every((g) => g.permission_set === null)).toBe(true);

      const logger = newLogger();
      const outcome = await runOneTimeGrantPermissionSetNameBackfill(engine as any, { catalog, logger });
      expect(outcome.status).toBe('ran');
      expect(outcome.backfill?.named.length).toBe(before.length);

      for (const g of await grants(engine)) {
        const [set] = (await engine.find('sys_permission_set', { where: { id: g.permission_set_id }, context: SYS })) as any[];
        expect(g.permission_set, g.id).toBe(set.name);
        const entry = await catalog.resolve('permission', g.permission_set);
        expect(entry?.name, g.id).toBe(g.permission_set);
      }
      expect(logger.error).not.toHaveBeenCalled();
    });
  }
});

describe('[ADR-0131 D4] grant name backfill — no principal’s grants change', () => {
  for (const posture of ['single', 'isolated'] as const) {
    it(`${posture}: platform administrator, organization administrator, member and agent resolve to the golden before and after`, async () => {
      const world = await boot(posture);
      await seedPrincipals(world, posture);
      await clearAllNames(world.engine);

      expect(await grantsByPrincipal(world.engine)).toEqual(GOLDEN[posture]);
      const outcome = await runOneTimeGrantPermissionSetNameBackfill(world.engine as any, {
        catalog: world.catalog, logger: newLogger(),
      });
      expect(outcome.status).toBe('ran');
      expect((await grants(world.engine)).every((g) => typeof g.permission_set === 'string')).toBe(true);
      expect(await grantsByPrincipal(world.engine)).toEqual(GOLDEN[posture]);
    });
  }
});

describe('[ADR-0131 D4] grant name backfill — report, never guess', () => {
  it('an id that names no set row stays unnamed and is reported by count and grant id; the verdict is recorded', async () => {
    const { engine, catalog } = await boot('single');
    await insertUser(engine, 'usr_member', 'member@eq.example', '2025-03-01T00:00:00.000Z');
    await insertUnnamedGrants(engine, [{ id: 'g_gone', user_id: 'usr_member', permission_set_id: 'ps_gone' }]);

    const logger = newLogger();
    const outcome = await runOneTimeGrantPermissionSetNameBackfill(engine as any, { catalog, logger });

    expect((await grant(engine, 'g_gone'))?.permission_set).toBeNull();
    expect(outcome.backfill?.dangling).toEqual(['g_gone']);
    const [message, meta] = logger.warn.mock.calls.find(([m]) => String(m).includes('names no sys_permission_set row'))!;
    expect(String(message)).toMatch(/^\[security\] 1 sys_user_permission_set grant\(s\)/);
    expect(meta).toMatchObject({ count: 1, grants: { ids: ['g_gone'] } });
    expect(outcome.status).toBe('ran');
    expect(await ledgerRows(engine)).toHaveLength(1);
  });

  it('a catalog read that answers nothing: no name is written, the refusal is loud, and the verdict is not recorded', async () => {
    const world = await boot('single');
    await seedPrincipals(world, 'single');
    await clearAllNames(world.engine);
    const silent: SecurityCatalogReader = { resolve: async () => undefined, list: async () => [] };

    const logger = newLogger();
    const outcome = await runOneTimeGrantPermissionSetNameBackfill(world.engine as any, { catalog: silent, logger });

    const after = await grants(world.engine);
    expect(after.length).toBe(3);
    expect(after.every((g) => g.permission_set === null)).toBe(true);
    expect(outcome.backfill?.named).toEqual([]);
    expect([...(outcome.backfill?.unresolved ?? [])].sort()).toEqual(after.map((g) => g.id).sort());
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, , meta] = logger.error.mock.calls[0];
    expect(String(message)).toMatch(/^\[security\] 3 sys_user_permission_set grant\(s\) were NOT given a permission_set/);
    expect(meta).toMatchObject({ count: 3 });
    expect(outcome.status).toBe('undecided');
    expect(await ledgerRows(world.engine)).toHaveLength(0);
  });

  it('a name the catalog does not resolve YET leaves the verdict unrecorded; once it is registered, the next pass names it', async () => {
    const { engine, catalog } = await boot('single');
    await insertUser(engine, 'usr_member', 'member@eq.example', '2025-03-01T00:00:00.000Z');
    await insertSet(engine, { id: 'ps_late', name: 'late_reviewer', label: 'Late' });
    await insertUnnamedGrants(engine, [{ id: 'g_late', user_id: 'usr_member', permission_set_id: 'ps_late' }]);

    const first = await runOneTimeGrantPermissionSetNameBackfill(engine as any, { catalog, logger: newLogger() });
    expect(first.status).toBe('undecided');
    expect(first.backfill?.unresolved).toEqual(['g_late']);
    expect((await grant(engine, 'g_late'))?.permission_set).toBeNull();
    expect(await ledgerRows(engine)).toHaveLength(0);

    // A package registering the definition after that pass — a later boot's catalog.
    engine.registry.registerItem('permission', { name: 'late_reviewer', label: 'Late', objects: {} } as any, 'name' as any, CATALOG_PACKAGE);
    const second = await runOneTimeGrantPermissionSetNameBackfill(engine as any, { catalog, logger: newLogger() });
    expect(second.status).toBe('ran');
    expect((await grant(engine, 'g_late'))?.permission_set).toBe('late_reviewer');
    expect(await ledgerRows(engine)).toHaveLength(1);
  });

  it('a name write that does not land is reported at error and leaves the verdict unrecorded', async () => {
    const world = await boot('single');
    await seedPrincipals(world, 'single');
    await clearAllNames(world.engine);
    const realUpdate = world.engine.update.bind(world.engine);
    vi.spyOn(world.engine, 'update').mockImplementation(async (object: string, data: any, options?: any) => {
      if (object === 'sys_user_permission_set') throw new Error('disk full');
      return realUpdate(object, data, options);
    });

    const logger = newLogger();
    const outcome = await runOneTimeGrantPermissionSetNameBackfill(world.engine as any, { catalog: world.catalog, logger });

    expect(outcome.status).toBe('undecided');
    expect(outcome.backfill?.failed.length).toBe(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toMatch(/name write\(s\) did NOT land/);
    expect(await ledgerRows(world.engine)).toHaveLength(0);
  });
});

describe('[ADR-0131 D4] grant name backfill — a name never crosses organizations', () => {
  for (const posture of ['single', 'isolated'] as const) {
    it(`${posture}: a grant whose id names another organization's set row keeps no name, and nothing of that organization is logged`, async () => {
      const { engine, catalog } = await boot(posture);
      await insertUser(engine, 'usr_member', 'member@eq.example', '2025-03-01T00:00:00.000Z');
      await insertSet(engine, { id: 'ps_other', name: OTHER_SET.name, label: 'Auditor' }, OTHER_ORG);
      await insertSet(engine, { id: 'ps_own', name: OWN_SET.name, label: 'Reviewer' }, ORG);
      const [bucketViewer] = (await engine.find('sys_permission_set', {
        where: { name: 'viewer_readonly', organization_id: null }, context: SYS,
      })) as any[];
      await insertUnnamedGrants(engine, [
        // The organization's grant on the other organization's set.
        { id: 'g_cross', user_id: 'usr_member', permission_set_id: 'ps_other', organization_id: ORG },
        // An organization-less grant (it applies in every organization) on an organization's set.
        { id: 'g_global_cross', user_id: 'usr_member', permission_set_id: 'ps_other' },
        { id: 'g_global_own', user_id: 'usr_member', permission_set_id: 'ps_own' },
        // Controls inside the wall: the organization's own set, and the organization-less platform row.
        { id: 'g_own', user_id: 'usr_member', permission_set_id: 'ps_own', organization_id: ORG },
        { id: 'g_bucket', user_id: 'usr_member', permission_set_id: bucketViewer.id, organization_id: ORG },
        { id: 'g_global_bucket', user_id: 'usr_member', permission_set_id: bucketViewer.id },
      ]);

      const logger = newLogger();
      const outcome = await runOneTimeGrantPermissionSetNameBackfill(engine as any, { catalog, logger });

      expect(outcome.backfill?.crossOrganization).toEqual(['g_cross', 'g_global_cross', 'g_global_own']);
      for (const id of ['g_cross', 'g_global_cross', 'g_global_own']) {
        expect((await grant(engine, id))?.permission_set, id).toBeNull();
      }
      expect((await grant(engine, 'g_own'))?.permission_set).toBe(OWN_SET.name);
      expect((await grant(engine, 'g_bucket'))?.permission_set).toBe('viewer_readonly');
      expect((await grant(engine, 'g_global_bucket'))?.permission_set).toBe('viewer_readonly');

      const [, meta] = logger.warn.mock.calls.find(([m]) => String(m).includes('outside the grant'))!;
      expect(meta).toMatchObject({ count: 3, grants: { ids: ['g_cross', 'g_global_cross', 'g_global_own'] } });
      const text = loggedText(logger);
      expect(text).not.toContain(OTHER_SET.name);
      expect(text).not.toContain(OTHER_ORG);
      expect(text).not.toContain('ps_other');
      // Decided: nothing a later pass could name.
      expect(outcome.status).toBe('ran');
    });
  }
});

describe('[ADR-0131 D4] grant name backfill — once, and remembered in sys_migration', () => {
  it('a second pass writes nothing, and the ledger row is written once', async () => {
    const world = await boot('single');
    await seedPrincipals(world, 'single');
    await clearAllNames(world.engine);

    const first = await runOneTimeGrantPermissionSetNameBackfill(world.engine as any, {
      catalog: world.catalog, logger: newLogger(),
    });
    expect(first.status).toBe('ran');
    const [row] = await ledgerRows(world.engine);
    expect(row).toMatchObject({ id: GRANT_SET_NAME_BACKFILL_MIGRATION_ID, blocking: 0 });
    expect(row.verified_at ?? null).toBeNull();
    expect(JSON.parse(row.details)).toEqual({ unnamed: 3, named: 3, dangling: 0, crossOrganization: 0 });

    const update = vi.spyOn(world.engine, 'update');
    const insert = vi.spyOn(world.engine, 'insert');
    const find = vi.spyOn(world.engine, 'find');
    const second = await runOneTimeGrantPermissionSetNameBackfill(world.engine as any, {
      catalog: world.catalog, logger: newLogger(),
    });
    expect(second).toEqual({ status: 'already-run', ledger: 'recorded' });
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(await ledgerRows(world.engine)).toHaveLength(1);
  });

  it('with no ledger on the kernel the pass still names, says it cannot remember, and a second pass renames nothing', async () => {
    const world = await boot('single', { ledger: false });
    await seedPrincipals(world, 'single');
    await clearAllNames(world.engine);

    const logger = newLogger();
    const first = await runOneTimeGrantPermissionSetNameBackfill(world.engine as any, { catalog: world.catalog, logger });
    expect(first.status).toBe('ran-unrecorded');
    expect(first.ledger).toBe('unavailable');
    expect(first.backfill?.named.length).toBe(3);
    expect(logger.warn.mock.calls.some(([m]) => String(m).includes('cannot record it'))).toBe(true);

    const update = vi.spyOn(world.engine, 'update');
    const second = await runOneTimeGrantPermissionSetNameBackfill(world.engine as any, {
      catalog: world.catalog, logger: newLogger(),
    });
    expect(second.backfill?.unnamed).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('[ADR-0131 D4] grant name backfill — the write path', () => {
  it('the name lands with the S4a hooks unbound too: the backfill writes the name, it does not lean on the hook stamp', async () => {
    const world = await boot('isolated');
    await seedPrincipals(world, 'isolated');
    await clearAllNames(world.engine);
    unregisterGrantPermissionSetNameHooks(world.engine);

    const outcome = await runOneTimeGrantPermissionSetNameBackfill(world.engine as any, {
      catalog: world.catalog, logger: newLogger(),
    });
    expect(outcome.status).toBe('ran');
    for (const g of await grants(world.engine)) {
      const [set] = (await world.engine.find('sys_permission_set', { where: { id: g.permission_set_id }, context: SYS })) as any[];
      expect(g.permission_set, g.id).toBe(set.name);
    }
  });
});

describe('[ADR-0131 D4] grant name backfill — on a real kernel boot', () => {
  it('a permission set a kernel:ready handler registers AFTER SecurityPlugin’s is named on the same boot, and the verdict is recorded', async () => {
    const engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      true,
    );
    await engine.init();
    engine.registerApp({
      id: CATALOG_PACKAGE,
      name: 'Grant name backfill',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [
        SysUser, SysAccount, SysMember, SysOrganization,
        SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet, SysMigration,
      ],
    } as any);
    await engine.syncSchemas();
    engines.push(engine);
    vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
    for (const ps of defaultPermissionSets) {
      engine.registry.registerItem('permission', structuredClone(ps) as any, 'name' as any, CATALOG_PACKAGE);
    }
    // Stored before this boot: the set row, and a grant written before the
    // name column existed (no SecurityPlugin has bound the name hooks yet).
    await insertSet(engine, { id: 'ps_late', name: 'late_reviewer', label: 'Late' });
    await insertUser(engine, 'usr_member', 'member@eq.example', '2025-03-01T00:00:00.000Z');
    await engine.insert(
      'sys_user_permission_set',
      { id: 'g_late', user_id: 'usr_member', permission_set_id: 'ps_late' },
      { context: SYS } as any,
    );
    expect((await grant(engine, 'g_late'))?.permission_set).toBeNull();

    const metadata = {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [...defaultPermissionSets],
    };
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    // The engine's stand-in: SecurityPlugin depends on the engine plugin by name.
    kernel.use({
      name: 'com.objectstack.engine.objectql',
      init: async (ctx: any) => {
        ctx.registerService('objectql', engine);
        ctx.registerService('metadata', metadata);
        ctx.registerService('manifest', { register: () => undefined });
      },
      start: async () => undefined,
    } as any);
    kernel.use(new SecurityPlugin({ fallbackPermissionSet: 'member_default' }));
    // The late provider: its `kernel:ready` handler is registered after
    // SecurityPlugin's own, so it runs after the platform bootstrap.
    kernel.use({
      name: 'com.objectstack.qa.late-catalog',
      dependencies: ['com.objectstack.security'],
      init: async () => undefined,
      start: async (ctx: any) => {
        ctx.hook('kernel:ready', async () => {
          engine.registry.registerItem(
            'permission', { name: 'late_reviewer', label: 'Late', objects: {} } as any, 'name' as any, CATALOG_PACKAGE,
          );
        });
      },
    } as any);
    try {
      await kernel.bootstrap();
      expect((await grant(engine, 'g_late'))?.permission_set).toBe('late_reviewer');
      expect(await ledgerRows(engine)).toHaveLength(1);
    } finally {
      await kernel.shutdown();
    }
  });
});

describe('[ADR-0131 D4] grant name backfill — boot wiring', () => {
  it('SecurityPlugin runs it at kernel:bootstrapped, through the catalog read over the engine registry', async () => {
    const world = await boot('single');
    await seedPrincipals(world, 'single');
    await clearAllNames(world.engine);

    const handlers = world.hooks.get('kernel:bootstrapped') ?? [];
    expect(handlers).toHaveLength(1);
    const errorsBefore = world.pluginLogger.error.mock.calls.length;
    const warningsBefore = world.pluginLogger.warn.mock.calls.length;
    await handlers[0]();

    expect((await grants(world.engine)).every((g) => typeof g.permission_set === 'string')).toBe(true);
    expect(await ledgerRows(world.engine)).toHaveLength(1);
    expect(world.pluginLogger.error.mock.calls.length).toBe(errorsBefore);
    expect(world.pluginLogger.warn.mock.calls.length).toBe(warningsBefore);
  });
});

/**
 * The resolver's envelope per principal — recorded from the tree BEFORE the
 * name column existed (the S4a grant-equivalence golden), and unchanged by
 * clearing the names or by the backfill: no reader reads the name yet.
 */
const GOLDEN: Record<Posture, unknown> = {
  single: {
    agent: {
      onBehalfOf: { principalKind: 'human', userId: 'usr_orgadmin' },
      permissions: ['mcp_agent_data_read'],
      positions: [],
      principalKind: 'agent',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    member: {
      accessible_org_ids: ['org_eq'],
      email: 'member@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['viewer_readonly'],
      positions: ['everyone', 'org_member'],
      posture: 'MEMBER',
      systemPermissions: [],
    },
    organizationAdmin: {
      accessible_org_ids: ['org_eq'],
      email: 'orgadmin@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['organization_admin_no_bypass'],
      positions: ['everyone', 'org_owner'],
      posture: 'TENANT_ADMIN',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    platformAdmin: {
      accessible_org_ids: [],
      email: 'admin@eq.example',
      org_user_ids: ['usr_admin', 'usr_member', 'usr_orgadmin'],
      permissions: ['admin_full_access'],
      positions: ['everyone', 'platform_admin'],
      posture: 'PLATFORM_ADMIN',
      systemPermissions: [
        'manage_metadata', 'manage_platform_settings', 'manage_sharing', 'manage_users',
        'setup.access', 'setup.write', 'studio.access', 'view_all_audit_log',
      ],
    },
  },
  isolated: {
    agent: {
      onBehalfOf: { principalKind: 'human', userId: 'usr_orgadmin' },
      permissions: ['mcp_agent_data_read'],
      positions: [],
      principalKind: 'agent',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    member: {
      accessible_org_ids: ['org_eq'],
      email: 'member@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['viewer_readonly'],
      positions: ['everyone', 'org_member'],
      posture: 'MEMBER',
      systemPermissions: [],
    },
    organizationAdmin: {
      accessible_org_ids: ['org_eq'],
      email: 'orgadmin@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['organization_admin'],
      positions: ['everyone', 'org_owner'],
      posture: 'TENANT_ADMIN',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    platformAdmin: {
      accessible_org_ids: [],
      email: 'admin@eq.example',
      org_user_ids: ['usr_admin', 'usr_member', 'usr_orgadmin'],
      permissions: ['admin_full_access'],
      positions: ['everyone', 'platform_admin'],
      posture: 'PLATFORM_ADMIN',
      systemPermissions: [
        'manage_metadata', 'manage_platform_settings', 'manage_sharing', 'manage_users',
        'setup.access', 'setup.write', 'studio.access', 'view_all_audit_log',
      ],
    },
  },
};
