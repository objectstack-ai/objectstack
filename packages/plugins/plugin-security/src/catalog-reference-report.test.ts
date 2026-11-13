// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4] The catalog reference boot report — every stored reference
 * whose name the security catalog does not resolve, per organization.
 *
 * Measured on a REAL `ObjectQL` engine over the SQL driver with the REAL
 * `SecurityPlugin` started on it (so the `kernel:bootstrapped` handler that
 * runs the report is the real one), and the REAL metadata door
 * (`ObjectStackProtocolImplementation`) for the definition saves. The catalog
 * is S1's read (`createSecurityCatalogReader`) over the engine registry and a
 * metadata service whose declarations a test can remove and re-add — the way
 * a package's or a stack's declaration leaves the catalog while the rows that
 * name it stay.
 *
 * Every assertion reads the structured result, never the log's wording; the
 * wiring pin finds the plugin's lines by their structured meta. One pin reads
 * wording on purpose: the unnamed-grant line is release text an operator acts
 * on, and its fix is the ownership ceremony's reviewed plan and apply.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataCommitObject,
  SysMetadataAuditObject,
} from '@objectstack/metadata-core';
import {
  createSecurityCatalogReader,
  resetPlatformAdminEmailMemo,
  resolveUserAuthzGrants,
  type SecurityCatalogReader,
} from '@objectstack/core';
import type { PermissionSet } from '@objectstack/spec/security';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';
import { SysMigration } from '@objectstack/platform-objects/system';

import { SecurityPlugin } from './security-plugin.js';
import { SysPosition } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import {
  collectCatalogReferences,
  reportCatalogReferences,
  type CatalogReferenceReport,
  type CatalogReferenceReportEngine,
} from './catalog-reference-report.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const ORG = 'org_s3';
const OTHER_ORG = 'org_s3_other';
/** A package that declares one position, the way a stack's `positions` reach the registry. */
const PKG = 'com.example.s3';
const PKG_POSITION = 's3_pkg_lead';

/** A permission set and a position whose declarations a test removes and re-adds. */
const AUDITOR = { name: 's3_auditor', label: 'Auditor', systemPermissions: ['s3_audit_trail'], objects: {} };
const FIELD_LEAD = { name: 's3_field_lead', label: 'Field lead', permissionSets: [AUDITOR.name] };

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

interface Booted {
  engine: ObjectQL;
  protocol: any;
  logger: { info: any; warn: any; error: any; debug: any };
  /** Kernel lifecycle hooks the plugin registered, by event — collected, fired only by a test. */
  hooks: Map<string, Array<() => Promise<unknown>>>;
  catalog: SecurityCatalogReader;
  /** [ADR-0150 D3/D4] The catalog the plugin binds: permission sets by (package, name). */
  /** The metadata service's declarations, by type — remove one and the catalog stops resolving it. */
  declared: { position: Map<string, Record<string, unknown>>; permission: Map<string, Record<string, unknown>> };
  report(): Promise<CatalogReferenceReport>;
  bootstrapped(): Promise<void>;
}

async function boot(opts: { posture?: 'single' | 'isolated' } = {}): Promise<Booted> {
  const posture = opts.posture ?? 'single';
  const walled = posture !== 'single';
  if (walled) {
    process.env[POSTURE_ENV] = posture;
    process.env[OWNER_ENV] = 'admin@s3.example';
  }
  resetPlatformAdminEmailMemo();

  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.catalog-reference-report',
    name: 'Catalog reference report',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysUser, SysAccount, SysMember, SysOrganization,
      SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet,
      SysMetadataObject, SysMetadataHistoryObject, SysMetadataCommitObject, SysMetadataAuditObject,
      SysMigration,
    ],
  } as any);
  await engine.syncSchemas();
  // The organization-less rows below exist only on a store built before 18.x
  // (ADR-0131 D1 makes a fresh tenant column NOT NULL): this is that store.
  await relaxTenantColumns(engine, ['sys_permission_set', 'sys_position', 'sys_position_permission_set', 'sys_user_position']);
  engines.push(engine);

  (engine as any).registry.registerItem('position', { name: PKG_POSITION, label: 'Package lead' }, 'name', PKG);

  const declared = {
    position: new Map<string, Record<string, unknown>>([[FIELD_LEAD.name, { ...FIELD_LEAD }]]),
    permission: new Map<string, Record<string, unknown>>(
      [...defaultPermissionSets, QA_ADMIN, AUDITOR].map((ps: any) => [ps.name, structuredClone(ps)]),
    ),
  };
  const metadata = {
    get: async (type: string, name: string) =>
      type === 'position' || type === 'permission'
        ? (declared[type].get(name) ?? null)
        : (engine.getSchema(name) ?? null),
    list: async (type: string) =>
      type === 'position' || type === 'permission' ? [...declared[type].values()] : [],
  };
  const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map(), undefined);
  const services: Record<string, unknown> = {
    // [ADR-0150 D3, #31674] The manifest service registers the plugin's own
    // permission sets into the engine registry under the plugin's package, as
    // a booted kernel does, so a built-in position resolves them as its own.
    manifest: { register: vi.fn((m: { id: string; permissions?: Array<Record<string, unknown>> }) => {
      for (const ps of m.permissions ?? []) (engine as any).registry.registerItem('permission', structuredClone(ps), 'name', m.id);
    }) },
    objectql: engine,
    metadata,
    protocol,
    ...(walled ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture } } : {}),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const hooks = new Map<string, Array<() => Promise<unknown>>>();
  const ctx: any = {
    logger,
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

  for (const [id, slug] of [[ORG, 's3'], [OTHER_ORG, 's3-other']]) {
    await engine.insert('sys_organization', { id, name: id, slug }, { context: SYS } as any);
  }
  const catalog = createSecurityCatalogReader({ registry: (engine as any).registry, metadata });
  return {
    engine,
    protocol,
    logger,
    hooks,
    catalog,
    declared,
    report: () => collectCatalogReferences(engine as any, { catalog }),
    async bootstrapped() {
      for (const handler of hooks.get('kernel:bootstrapped') ?? []) await handler();
    },
  };
}

const orgCtx = (organizationId: string | null) =>
  (organizationId ? { isSystem: true, tenantId: organizationId } : SYS);

async function insertRows(b: Booted, object: string, rows: Array<Record<string, unknown>>): Promise<void> {
  for (const row of rows) {
    const organizationId = (row.organization_id as string | undefined) ?? null;
    // [C8 stage 8b] An organization-less row is legacy residue, landed straight
    // through the driver: under `single` the engine stamps or refuses such a
    // platform insert (ADR-0131 D9), and this rig holds two organizations.
    if (organizationId === null) await (b.engine as any).getDriver(object).create(object, row);
    else await b.engine.insert(object, row, { context: orgCtx(organizationId) } as any);
  }
}

/**
 * Grants stored the way a grant written before the name column is stored: the
 * name NULL, written beneath the engine, which refuses a grant naming nothing
 * (ADR-0131 D4).
 */
async function insertUnnamedGrants(b: Booted, rows: Array<Record<string, unknown>>): Promise<void> {
  const driver: any = (b.engine as any).getDriver('sys_user_permission_set');
  for (const r of rows) await driver.knex('sys_user_permission_set').insert({ ...r, permission_set: null });
}

async function insertUser(b: Booted, id: string): Promise<void> {
  await b.engine.insert('sys_user', {
    id, email: `${id}@s3.example`, name: id, created_at: '2025-01-01T00:00:00.000Z', email_verified: true,
  }, { context: SYS } as any);
  await b.engine.insert('sys_member', {
    id: `m_${id}`, user_id: id, organization_id: ORG, role: 'member', created_at: '2025-01-01T00:00:00.000Z',
  }, { context: orgCtx(ORG) } as any);
}

/** The per-organization findings, as plain data: what a reader of the report sees. */
const findings = (report: CatalogReferenceReport) =>
  report.organizations.map((o) => ({
    organizationId: o.organizationId,
    positionAssignments: o.positionAssignments.map((r) => `${r.id}:${r.name}`),
    permissionSetGrants: o.permissionSetGrants.map((r) => `${r.id}:${r.name}`),
    unnamedGrants: o.unnamedGrants.map((g) => `${g.id}:${g.userId}`),
  }));

describe('[ADR-0131 D4] the catalog reference report — references whose names resolve nowhere, per organization', () => {
  it('a deployment whose every reference resolves reports nothing: declared, packaged and environment-defined names', async () => {
    const b = await boot();
    await b.protocol.saveMetaItem({ type: 'position', name: 's3_env_lead', item: { name: 's3_env_lead', label: 'Env lead' } });
    await insertRows(b, 'sys_user_position', [
      { id: 'up_declared', user_id: 'usr_a', position: FIELD_LEAD.name, organization_id: ORG },
      { id: 'up_pkg', user_id: 'usr_a', position: PKG_POSITION },
      { id: 'up_env', user_id: 'usr_a', position: 's3_env_lead', organization_id: ORG },
    ]);
    await insertRows(b, 'sys_permission_set', [{ id: 'ps_auditor', name: AUDITOR.name, label: 'Auditor' }]);
    await insertRows(b, 'sys_user_permission_set', [
      { id: 'g_auditor', user_id: 'usr_a', permission_set: AUDITOR.name, organization_id: ORG },
    ]);

    const report = await b.report();
    expect(report.stopped).toBeUndefined();
    expect(report.absent).toEqual([]);
    expect(findings(report)).toEqual([]);
  });

  it('an assignment and a grant whose names resolve nowhere are listed under their own organization, and nowhere else', async () => {
    const b = await boot();
    await insertRows(b, 'sys_user_position', [
      { id: 'up_ghost_own', user_id: 'usr_a', position: 'ghost_lead', organization_id: ORG },
      { id: 'up_ghost_other', user_id: 'usr_b', position: 'ghost_lead', organization_id: OTHER_ORG },
      { id: 'up_ghost_global', user_id: 'usr_c', position: 'global_ghost' },
      { id: 'up_ok', user_id: 'usr_a', position: FIELD_LEAD.name, organization_id: ORG },
    ]);
    // A system write naming a set no row backs is left as written (the name
    // hooks stand down for system provisioning), which is the stored shape of
    // a grant whose permission set has gone.
    await insertRows(b, 'sys_permission_set', [{ id: 'ps_auditor', name: AUDITOR.name, label: 'Auditor' }]);
    await insertRows(b, 'sys_user_permission_set', [
      { id: 'g_ghost', user_id: 'usr_a', permission_set: 'ghost_set', organization_id: ORG },
      { id: 'g_ok', user_id: 'usr_a', permission_set: AUDITOR.name, organization_id: ORG },
    ]);

    const report = await b.report();
    expect(findings(report)).toEqual([
      {
        organizationId: null,
        positionAssignments: ['up_ghost_global:global_ghost'],
        permissionSetGrants: [], unnamedGrants: [],
      },
      {
        organizationId: ORG,
        positionAssignments: ['up_ghost_own:ghost_lead'],
        permissionSetGrants: ['g_ghost:ghost_set'],
        unnamedGrants: [],
      },
      {
        organizationId: OTHER_ORG,
        positionAssignments: ['up_ghost_other:ghost_lead'],
        permissionSetGrants: [], unnamedGrants: [],
      },
    ]);
    expect(report.organizations[1].positionAssignments[0].userId).toBe('usr_a');
  });

  it('an unnamed grant stays unnamed through the boot (no boot names it, ADR-0131 D10), confers nothing, and is listed', async () => {
    const b = await boot();
    await insertUser(b, 'usr_row_only');
    // A set row whose name no declaration carries, beside a grant that names
    // nothing: only the v18 ceremony's rewrite names a legacy grant.
    await insertRows(b, 'sys_permission_set', [
      { id: 'ps_row_only', name: 's3_row_only', label: 'Row only', system_permissions: ['s3_row_only_bit'] },
    ]);
    await insertUnnamedGrants(b, [
      { id: 'g_row_only', user_id: 'usr_row_only', organization_id: ORG },
    ]);
    await b.bootstrapped();

    const [grant] = (await b.engine.find('sys_user_permission_set', { where: { id: 'g_row_only' }, context: SYS })) as any[];
    expect(grant.permission_set ?? null, 'no boot names it').toBeNull();
    const resolved = await resolveUserAuthzGrants(b.engine as any, 'usr_row_only', { tenantId: ORG });
    expect({ permissions: resolved.permissions.includes('s3_row_only'), bit: resolved.systemPermissions.includes('s3_row_only_bit') })
      .toEqual({ permissions: false, bit: false });
    expect(findings(await b.report())).toEqual([{
      organizationId: ORG,
      positionAssignments: [], permissionSetGrants: [],
      unnamedGrants: ['g_row_only:usr_row_only'],
    }]);
  });
});

describe('[ADR-0131 D4] the unnamed-grant line prescribes the ownership ceremony', () => {
  // The one wording pin in this file. The line an operator reads at boot sends
  // them to the ceremony (open since #24581): its plan, then the apply of that
  // reviewed plan, which names each legacy grant. It never says to keep the
  // database on 17.x. Everything else in the line is the report's own: the
  // count, the field, the D4 reason, and that nothing was changed.
  const FIX = 'Fix: run the v18 ceremony. Plan it first, os migrate organization-ownership --out plan.json, and review '
    + 'the file it writes; then run os migrate organization-ownership --apply --backup-taken --plan-file plan.json';

  it('names the count, the empty field, the reason and "Nothing was changed", then the ceremony\'s plan and apply', async () => {
    const b = await boot();
    await insertUser(b, 'usr_a');
    await insertUser(b, 'usr_b');
    await insertUnnamedGrants(b, [
      { id: 'g_one', user_id: 'usr_a', organization_id: ORG },
      { id: 'g_two', user_id: 'usr_b', organization_id: ORG },
    ]);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await reportCatalogReferences(b.engine as any, { catalog: b.catalog, logger });

    // Anti-vacuity: the report logged exactly the unnamed-grant line, found by its meta.
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, , meta] = logger.error.mock.calls[0] as [string, unknown, { count: number }];
    expect(meta.count).toBe(2);

    expect(message).toContain(
      '[security] 2 sys_user_permission_set grant(s) name no permission set (permission_set is empty), '
      + 'so each confers nothing (ADR-0131 D4). Nothing was changed. ' + FIX,
    );
    expect(message).not.toMatch(/fresh installs only|on a 17\.x release|carries the upgrade path/);
  });
});

describe('[ADR-0131 D4] a removed declaration is reported; re-adding it clears the report', () => {
  /** A member granted the auditor set directly and assigned the field-lead position that binds it. */
  const seedHolder = async (b: Booted) => {
    await insertUser(b, 'usr_holder');
    await insertRows(b, 'sys_permission_set', [
      { id: 'ps_auditor', name: AUDITOR.name, label: 'Auditor', system_permissions: AUDITOR.systemPermissions },
    ]);
    await insertRows(b, 'sys_position', [{ id: 'pos_field', name: FIELD_LEAD.name, label: 'Field lead' }]);
    // A junction row beside the definition's `permissionSets`: the resolver
    // reads only the definition, so this row grants nothing on its own — it is
    // here to show that a row left behind keeps nothing alive.
    await insertRows(b, 'sys_position_permission_set', [
      { id: 'pps_field', position_id: 'pos_field', permission_set_id: 'ps_auditor' },
    ]);
    await insertRows(b, 'sys_user_permission_set', [
      { id: 'g_auditor', user_id: 'usr_holder', permission_set: AUDITOR.name, organization_id: ORG },
    ]);
    await insertRows(b, 'sys_user_position', [
      { id: 'up_field', user_id: 'usr_holder', position: FIELD_LEAD.name, organization_id: ORG },
    ]);
  };
  const reported = async (b: Booted) => {
    const report = await b.report();
    return {
      grants: report.organizations.flatMap((o) => o.permissionSetGrants.map((g) => g.id)),
      assignments: report.organizations.flatMap((o) => o.positionAssignments.map((a) => a.id)),
    };
  };
  const remove = (b: Booted) => {
    b.declared.permission.delete(AUDITOR.name);
    b.declared.position.delete(FIELD_LEAD.name);
  };
  const readd = (b: Booted) => {
    b.declared.permission.set(AUDITOR.name, structuredClone(AUDITOR));
    b.declared.position.set(FIELD_LEAD.name, { ...FIELD_LEAD });
  };

  it('the grant and the assignment are listed while the declarations are gone, and drop out once they are back', async () => {
    const b = await boot();
    await seedHolder(b);
    expect(await reported(b)).toEqual({ grants: [], assignments: [] });
    remove(b);
    expect(await reported(b)).toEqual({ grants: ['g_auditor'], assignments: ['up_field'] });
    readd(b);
    expect(await reported(b)).toEqual({ grants: [], assignments: [] });
  });

  // The resolver half of the stage-plan pin ("a removed declaration fails
  // closed and is reported; re-adding it clears both"). The authorization
  // resolver reads set bodies and the position's `permissionSets` from the
  // security catalog, so the rows `seedHolder` leaves behind — the set row and
  // the junction row included — keep nothing granting once the declarations
  // are gone.
  it('the removed declaration fails closed at the resolver, and re-adding it restores the grant', async () => {
    const b = await boot();
    await seedHolder(b);
    const held = async () => {
      const resolved = await resolveUserAuthzGrants(b.engine as any, 'usr_holder', { tenantId: ORG });
      return {
        auditor: resolved.permissions.includes(AUDITOR.name),
        bit: resolved.systemPermissions.includes('s3_audit_trail'),
      };
    };
    expect(await held()).toEqual({ auditor: true, bit: true });
    remove(b);
    expect(await held(), 'fails closed').toEqual({ auditor: false, bit: false });
    expect(await reported(b), 'and is reported').toEqual({ grants: ['g_auditor'], assignments: ['up_field'] });
    readd(b);
    expect(await held()).toEqual({ auditor: true, bit: true });
    expect(await reported(b)).toEqual({ grants: [], assignments: [] });
  });
});

describe('[ADR-0131 D4] a position definition naming a permission set the catalog does not resolve — listed per position', () => {
  /** A package that declares one permission set, and a package position binding it beside the auditor set. */
  const SET_PKG = 'com.example.s3.sets';
  const PKG_SET = { name: 's3_pkg_set', label: 'Package set', objects: {} };
  const BINDING_POSITION = 's3_bound_lead';

  /**
   * The set package ships the package set and the auditor set: in a booted
   * kernel every permission set a package position names is in the engine
   * registry (the catalog read's measurement table), so ADR-0150 D3 resolves
   * it from the position's package. The rig's metadata service still holds the
   * auditor set for the package-less readers.
   */
  const installSet = (b: Booted) => {
    (b.engine as any).registry.registerItem('permission', structuredClone(PKG_SET), 'name', SET_PKG);
    (b.engine as any).registry.registerItem('permission', structuredClone(AUDITOR), 'name', SET_PKG);
  };
  /** The set leaves the registry the way an uninstall of its package removes it. */
  const uninstallSet = (b: Booted) => (b.engine as any).registry.unregisterItem('permission', PKG_SET.name);
  /** An installed package, declaring `dependencies` — the closure ADR-0150 D3 resolves a package position's sets in. */
  const installManifest = (b: Booted, id: string, dependencies: string[] = []) =>
    (b.engine as any).registry.installPackage({
      id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop(),
      ...(dependencies.length > 0 ? { dependencies: Object.fromEntries(dependencies.map((d) => [d, '^1.0.0'])) } : {}),
    }, 'code');
  const bindPositions = (b: Booted) => {
    // The binding position's package declares the package that holds the set.
    installManifest(b, PKG, [SET_PKG]);
    (b.engine as any).registry.registerItem(
      'position',
      { name: BINDING_POSITION, label: 'Bound lead', permissionSets: [PKG_SET.name, AUDITOR.name, PKG_SET.name] },
      'name',
      PKG,
    );
  };

  it('a fresh deployment reports no position: every built-in, declared and packaged position binds a set the catalog resolves', async () => {
    const b = await boot();
    installSet(b);
    bindPositions(b);
    // Anti-vacuity: the catalog really serves positions that name sets.
    const named = (await b.catalog.list('position')).filter((e) => Array.isArray(e.definition.permissionSets)
      && (e.definition.permissionSets as unknown[]).length > 0).map((e) => e.name);
    expect(named).toEqual(expect.arrayContaining([FIELD_LEAD.name, BINDING_POSITION]));
    expect((await b.report()).positions).toEqual([]);
  });

  it('lists each position once, with only the names that resolve nowhere, its owner, and position order', async () => {
    const b = await boot();
    installSet(b);
    bindPositions(b);
    uninstallSet(b);
    (b.engine as any).registry.unregisterItem('permission', AUDITOR.name);
    b.declared.permission.delete(AUDITOR.name);

    const report = await b.report();
    expect(report.stopped).toBeUndefined();
    expect(report.positions).toEqual([
      { position: BINDING_POSITION, packageId: PKG, permissionSets: [PKG_SET.name, AUDITOR.name] },
      { position: FIELD_LEAD.name, packageId: null, permissionSets: [AUDITOR.name] },
    ]);
    // A definition belongs to no organization: nothing is filed under one.
    expect(findings(report)).toEqual([]);
  });

  it('clears by itself once the package is installed again: the next report lists nothing', async () => {
    const b = await boot();
    installSet(b);
    bindPositions(b);
    uninstallSet(b);
    expect((await b.report()).positions).toEqual([
      { position: BINDING_POSITION, packageId: PKG, permissionSets: [PKG_SET.name] },
    ]);
    installSet(b);
    expect((await b.report()).positions).toEqual([]);
  });

  it('logs one error line naming each position and its unresolved sets, and the clean line only once nothing is left', async () => {
    const b = await boot();
    installSet(b);
    bindPositions(b);
    uninstallSet(b);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await reportCatalogReferences(b.engine as any, { catalog: b.catalog, logger });
    expect(logger.error.mock.calls.map(([, , meta]: any[]) => meta)).toEqual([{
      count: 1,
      permissionSets: [PKG_SET.name],
      positions: { items: [{ position: BINDING_POSITION, packageId: PKG, permissionSets: [PKG_SET.name] }] },
    }]);
    expect(logger.info).not.toHaveBeenCalled();

    installSet(b);
    logger.error.mockClear();
    await reportCatalogReferences(b.engine as any, { catalog: b.catalog, logger });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('[ADR-0150 D3/D7] lists a set the position\'s package cannot reach, with the refusal naming every candidate', async () => {
    const OTHER_PKG = 'com.example.s3.other';
    const OTHER_POSITION = 's3_other_lead';
    const b = await boot();
    installSet(b);
    bindPositions(b);
    expect((await b.report()).positions).toEqual([]);
    // A second package's position names the same set without declaring the
    // package that holds it: the set is held, but outside its closure.
    installManifest(b, OTHER_PKG);
    (b.engine as any).registry.registerItem(
      'position', { name: OTHER_POSITION, label: 'Other lead', permissionSets: [PKG_SET.name] }, 'name', OTHER_PKG,
    );
    const report = await collectCatalogReferences(b.engine as any, { catalog: b.catalog });
    expect(report.positions.map((p) => p.position)).toEqual([OTHER_POSITION]);
    expect(report.positions[0]).toMatchObject({ position: OTHER_POSITION, packageId: OTHER_PKG, permissionSets: [PKG_SET.name] });
    expect(report.positions[0]?.refusals).toEqual([
      expect.objectContaining({ permissionSet: PKG_SET.name, reason: 'outside-closure', candidates: [expect.stringContaining(SET_PKG)] }),
    ]);
  });

  it('an unreadable position list stops the report: no finding, and the stop is said', async () => {
    const b = await boot();
    await insertRows(b, 'sys_user_position', [
      { id: 'up_ghost', user_id: 'usr_a', position: 'ghost_lead', organization_id: ORG },
    ]);
    for (const list of [vi.fn().mockRejectedValue(new Error('registry offline')), vi.fn().mockResolvedValue(undefined)]) {
      const catalog = { resolve: b.catalog.resolve.bind(b.catalog), list };
      const report = await collectCatalogReferences(b.engine as any, { catalog });
      expect({ stopped: report.stopped, organizations: report.organizations, positions: report.positions }).toEqual({
        stopped: 'catalog-unreadable', organizations: [], positions: [],
      });
      expect(list).toHaveBeenCalledWith('position');
    }
  });
});

describe('[ADR-0131 D4] a read that did not happen is never "resolves nowhere"', () => {
  it('an unreadable catalog stops the report: no finding, and the stop is said', async () => {
    const b = await boot();
    await insertRows(b, 'sys_user_position', [
      { id: 'up_ghost', user_id: 'usr_a', position: 'ghost_lead', organization_id: ORG },
    ]);
    const catalog = { resolve: vi.fn().mockRejectedValue(new Error('registry offline')), list: vi.fn() };
    const report = await reportCatalogReferences(b.engine as any, { catalog, logger: b.logger });
    expect({ stopped: report.stopped, organizations: report.organizations }).toEqual({
      stopped: 'catalog-unreadable', organizations: [],
    });
    expect(b.logger.error).not.toHaveBeenCalled();
    expect(b.logger.warn.mock.calls.filter(([, meta]: any[]) => meta?.stop === 'catalog-unreadable')).toHaveLength(1);
  });

  it('an unreadable scan stops the report the same way', async () => {
    const b = await boot();
    const engine: CatalogReferenceReportEngine = {
      getObject: (name) => (b.engine as any).getObject(name),
      find: async (object, options) => {
        if (object === 'sys_user_permission_set') throw new Error('table locked');
        return b.engine.find(object, options as EngineQueryOptions);
      },
    };
    const report = await collectCatalogReferences(engine, { catalog: b.catalog });
    expect({ stopped: report.stopped, reading: report.stoppedReading, organizations: report.organizations })
      .toEqual({ stopped: 'scan-unreadable', reading: 'sys_user_permission_set', organizations: [] });
  });

  it('a composition without the objects scans no table, still reads the positions, and names what it lacks', async () => {
    const engine: CatalogReferenceReportEngine = { getObject: () => undefined, find: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const catalog = { resolve: vi.fn(), list: vi.fn().mockResolvedValue([]) };
    const report = await reportCatalogReferences(engine, { catalog, logger });
    expect(report.absent).toEqual(['sys_user_position', 'sys_user_permission_set']);
    expect(engine.find).not.toHaveBeenCalled();
    expect(catalog.list.mock.calls).toEqual([['position']]);
    expect([logger.info, logger.warn, logger.error].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
  });
});

describe('[ADR-0131 D3/D4] SecurityPlugin runs the report at kernel:bootstrapped', () => {
  it('as the last kernel:bootstrapped handler, and the report writes nothing', async () => {
    const b = await boot();
    // (The grant-name backfill ran ahead of it until the v18 ceremony's
    // rewrite replaced it, ADR-0131 D10; the row-only position backfill until
    // C3 stage 8 unwired it.)
    await insertRows(b, 'sys_user_position', [
      { id: 'up_ghost', user_id: 'usr_a', position: 'ghost_lead', organization_id: ORG },
    ]);

    const handlers = b.hooks.get('kernel:bootstrapped') ?? [];
    // The platform baseline seam's window close (it re-derives the everyone
    // anchor only when a set joined after the derivation began — none here),
    // then this report, last. The grant-name backfill that ran ahead of it is
    // retired (ADR-0131 D10).
    expect(handlers).toHaveLength(2);
    for (const handler of handlers.slice(0, -1)) await handler();
    const writes = [
      vi.spyOn(b.engine, 'insert'), vi.spyOn(b.engine, 'update'), vi.spyOn(b.engine, 'delete'),
    ];
    const errorsBefore = b.logger.error.mock.calls.length;
    await handlers[handlers.length - 1]();

    expect(writes.map((w) => w.mock.calls.length), 'the report writes nothing').toEqual([0, 0, 0]);
    const lines = b.logger.error.mock.calls.slice(errorsBefore).map(([, , meta]: any[]) => meta);
    expect(lines.map((meta: any) => meta?.organizations?.items?.map((o: any) => ({
      organizationId: o.organizationId, positions: o.positions, assignments: o.assignments,
    })))).toEqual([[{ organizationId: ORG, positions: { ghost_lead: 1 }, assignments: { items: ['up_ghost'] } }]]);
  });
});

/**
 * [ADR-0150 D8] A grant whose package no longer serves its set, read onto a
 * holder another grant of the same user, set and organization is bound to,
 * confers nothing (`staleGrantBesideBoundGrant`, the rule the authorization
 * resolver applies). The report lists exactly those rows, per organization.
 * Every package here shares one namespace, the only place a stale column is
 * read onto another holder (#31698).
 */
describe('[ADR-0150 D8] the report lists each stale-column grant beside a grant bound to the holder it reads', () => {
  const Q = 'com.acme.q';
  const GONE = 'com.acme.gone';
  /** `solo` held by Q alone. */
  const solo = { name: 'solo', _packageId: Q, systemPermissions: ['cap_solo'] };
  const catalog = createSecurityCatalogReader({
    registry: {
      getItem: (type: string, name: string) => (type === 'permission' && name === 'solo' ? solo : undefined),
      listItems: (type: string) => (type === 'permission' ? [solo] : []),
      isPackageDisabled: () => false,
      packageScopedHoldersOf: (type: string, name: string) => (type === 'permission' && name === 'solo' ? [Q] : []),
      getPackageScopedItem: (type: string, name: string, packageId: string) =>
        type === 'permission' && name === 'solo' && packageId === Q ? solo : undefined,
      getEnvironmentScopedItem: () => undefined,
      getArtifactItem: () => undefined,
      getPackage: (id: string) => ({ manifest: { id, namespace: 'acme' } }),
      getAllPackages: () => [],
    } as any,
    metadata: { get: () => undefined, list: () => [] },
  });
  const grant = (id: string, user: string, column: string, organization = ORG) =>
    ({ id, user_id: user, permission_set: 'solo', permission_set_package: column, organization_id: organization });
  const rows = [
    grant('g_bound', 'usr_a', Q),
    grant('g_stale', 'usr_a', GONE),
    // CONTROL: the same stale column with no bound grant beside it reads the one holder, as before.
    grant('g_alone', 'usr_b', GONE),
    // CONTROL: bound in another organization only.
    grant('g_bound_elsewhere', 'usr_c', Q, OTHER_ORG),
    grant('g_stale_here', 'usr_c', GONE),
  ];
  const engine: CatalogReferenceReportEngine = {
    getObject: () => ({}),
    find: async (object, options: any) =>
      object === 'sys_user_permission_set' ? rows.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit) : [],
  };

  it('lists the stale grant under its organization, with its package and the bound holder, and nothing else', async () => {
    const report = await collectCatalogReferences(engine, { catalog });
    expect(report.organizations.map((o) => ({ organizationId: o.organizationId, withheld: o.staleGrantsBesideBound })))
      .toEqual([{
        organizationId: ORG,
        withheld: [{ id: 'g_stale', userId: 'usr_a', name: 'solo', packageId: GONE, holder: Q }],
      }]);
    expect(report.organizations.flatMap((o) => o.permissionSetGrants)).toEqual([]);
  });

  it('logs one error line for the category, with every listed grant in its meta', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await reportCatalogReferences(engine, { catalog, logger });
    const lines = logger.error.mock.calls.filter(([line]: any[]) => String(line).includes('no longer serves their permission set'));
    expect(lines).toHaveLength(1);
    expect(lines[0][2]).toEqual({
      count: 1,
      organizations: {
        items: [{
          organizationId: ORG,
          count: 1,
          grants: { items: [{ id: 'g_stale', userId: 'usr_a', permissionSet: 'solo', packageId: GONE, holder: Q }] },
        }],
      },
    });
  });
});

/**
 * [ADR-0150 D2/D8, #31698] A grant whose package no longer serves its set,
 * where the holder the name now reads is outside that package's namespace,
 * confers nothing: the catalog never reads the column onto that holder. The
 * report lists exactly those rows, per organization, with the holder — apart
 * from the grants naming a set nothing holds.
 */
describe('[ADR-0150 D2/D8, #31698] the report lists each stale-column grant whose holder is outside its package\'s namespace', () => {
  const Q = 'com.acme.q';
  /** Of Q's namespace, holding no set. */
  const SAME = 'com.acme.q-old';
  /** Of another namespace, holding no set. */
  const OTHER = 'com.acme.other';
  const NAMESPACES: Record<string, string> = { [Q]: 'q', [SAME]: 'q', [OTHER]: 'other' };
  /** `solo` held by Q alone; `env_only` by the environment alone. */
  const solo = { name: 'solo', _packageId: Q, systemPermissions: ['cap_solo'] };
  const envOnly = { name: 'env_only', systemPermissions: ['cap_env'] };
  const catalog = createSecurityCatalogReader({
    registry: {
      getItem: (type: string, name: string) => (type !== 'permission' ? undefined : name === 'solo' ? solo : name === 'env_only' ? envOnly : undefined),
      listItems: (type: string) => (type === 'permission' ? [solo, envOnly] : []),
      isPackageDisabled: () => false,
      packageScopedHoldersOf: (type: string, name: string) => (type === 'permission' && name === 'solo' ? [Q] : []),
      getPackageScopedItem: (type: string, name: string, packageId: string) =>
        type === 'permission' && name === 'solo' && packageId === Q ? solo : undefined,
      getEnvironmentScopedItem: (type: string, name: string) => (type === 'permission' && name === 'env_only' ? envOnly : undefined),
      getArtifactItem: () => undefined,
      getPackage: (id: string) => (NAMESPACES[id] ? { manifest: { id, namespace: NAMESPACES[id] } } : undefined),
      getAllPackages: () => [],
    } as any,
    metadata: { get: () => undefined, list: () => [] },
  });
  const grant = (id: string, user: string, set: string, column: string, organization = ORG) =>
    ({ id, user_id: user, permission_set: set, permission_set_package: column, organization_id: organization });
  const rows = [
    grant('g_other', 'usr_a', 'solo', OTHER),
    grant('g_env', 'usr_b', 'env_only', SAME, OTHER_ORG),
    // CONTROL: a stale column of the holder's namespace reads the holder, as before.
    grant('g_same', 'usr_c', 'solo', SAME),
    // CONTROL: a column of a package the registry does not know has no
    // namespace to bound the read, and reads the holder, as before.
    grant('g_unknown', 'usr_c', 'solo', 'com.acme.gone'),
    // CONTROL: a set nothing holds is the other line.
    grant('g_ghost', 'usr_c', 'ghost', OTHER),
  ];
  const engine: CatalogReferenceReportEngine = {
    getObject: () => ({}),
    find: async (object, options: any) =>
      object === 'sys_user_permission_set' ? rows.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit) : [],
  };

  it('lists each such grant under its organization, with its package and the holder, and nothing else', async () => {
    const report = await collectCatalogReferences(engine, { catalog });
    expect(report.organizations.map((o) => ({
      organizationId: o.organizationId,
      outside: o.staleGrantsOutsideNamespace,
      unresolved: o.permissionSetGrants.map((g) => g.id),
      withheld: o.staleGrantsBesideBound,
    }))).toEqual([
      {
        organizationId: ORG,
        outside: [
          { id: 'g_other', userId: 'usr_a', name: 'solo', packageId: OTHER, holder: Q },
        ],
        unresolved: ['g_ghost'],
        withheld: [],
      },
      {
        organizationId: OTHER_ORG,
        outside: [{ id: 'g_env', userId: 'usr_b', name: 'env_only', packageId: SAME, holder: null }],
        unresolved: [],
        withheld: [],
      },
    ]);
  });

  it('logs one error line for the category, with every listed grant in its meta and the fix', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await reportCatalogReferences(engine, { catalog, logger });
    const lines = logger.error.mock.calls.filter(([line]: any[]) => String(line).includes("outside that package's namespace"));
    expect(lines).toHaveLength(1);
    expect(String(lines[0][0])).toContain('so each confers nothing');
    expect(String(lines[0][0])).toContain('grant it again naming its package; then remove each listed grant');
    expect(lines[0][2]).toEqual({
      count: 2,
      organizations: {
        items: [
          {
            organizationId: ORG,
            count: 1,
            grants: { items: [
              { id: 'g_other', userId: 'usr_a', permissionSet: 'solo', packageId: OTHER, holder: Q },
            ] },
          },
          {
            organizationId: OTHER_ORG,
            count: 1,
            grants: { items: [{ id: 'g_env', userId: 'usr_b', permissionSet: 'env_only', packageId: SAME, holder: null }] },
          },
        ],
      },
    });
  });
});
