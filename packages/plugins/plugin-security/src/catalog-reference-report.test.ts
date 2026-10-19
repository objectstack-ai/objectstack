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
 * wiring pin finds the plugin's lines by their structured meta.
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
    manifest: { register: vi.fn() },
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

  const installSet = (b: Booted) =>
    (b.engine as any).registry.registerItem('permission', structuredClone(PKG_SET), 'name', SET_PKG);
  /** The set leaves the registry the way an uninstall of its package removes it. */
  const uninstallSet = (b: Booted) => (b.engine as any).registry.unregisterItem('permission', PKG_SET.name);
  const bindPositions = (b: Booted) => {
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
    // This report alone: the grant-name backfill that ran ahead of it is retired (ADR-0131 D10).
    expect(handlers).toHaveLength(1);
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
