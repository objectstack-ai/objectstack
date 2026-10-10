// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4] The catalog reference boot report — every stored reference
 * whose name the security catalog does not resolve, per organization.
 *
 * Measured on a REAL `ObjectQL` engine over the SQL driver with the REAL
 * `SecurityPlugin` started on it (so the two `kernel:bootstrapped` backfills
 * the report runs after are the real ones), and the REAL metadata door
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
    report: () => collectCatalogReferences(engine as any, { posture, catalog }),
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
    await b.engine.insert(object, row, { context: orgCtx(organizationId) } as any);
  }
}

/** Grants stored the way a grant with no name is stored: the name hooks unbound, the name NULL. */
async function insertUnnamedGrants(b: Booted, rows: Array<Record<string, unknown>>): Promise<void> {
  unregisterGrantPermissionSetNameHooks(b.engine as any);
  try {
    await insertRows(b, 'sys_user_permission_set', rows.map((r) => ({ ...r, permission_set: null })));
  } finally {
    registerGrantPermissionSetNameHooks(b.engine as any);
  }
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
    unnamedGrants: o.unnamedGrants.map((g) => `${g.id}:${g.permissionSetId}`),
    positionsWithoutDefinition: o.positionsWithoutDefinition.map((p) => `${p.name}${p.refusedName ? ' (refused name)' : ''}`),
  }));

describe('[ADR-0131 D4] the catalog reference report — references whose names resolve nowhere, per organization', () => {
  it('a deployment whose every reference resolves reports nothing: declared, packaged and environment-defined names', async () => {
    const b = await boot();
    await b.protocol.saveMetaItem({ type: 'position', name: 's3_env_lead', item: { name: 's3_env_lead', label: 'Env lead' } });
    await insertRows(b, 'sys_position', [
      { id: 'pos_field', name: FIELD_LEAD.name, label: 'Field lead' },
      { id: 'pos_pkg', name: PKG_POSITION, label: 'Package lead' },
      { id: 'pos_env', name: 's3_env_lead', label: 'Env lead', organization_id: ORG },
    ]);
    await insertRows(b, 'sys_user_position', [
      { id: 'up_declared', user_id: 'usr_a', position: FIELD_LEAD.name, organization_id: ORG },
      { id: 'up_pkg', user_id: 'usr_a', position: PKG_POSITION },
      { id: 'up_env', user_id: 'usr_a', position: 's3_env_lead', organization_id: ORG },
    ]);
    await insertRows(b, 'sys_permission_set', [{ id: 'ps_auditor', name: AUDITOR.name, label: 'Auditor' }]);
    await insertRows(b, 'sys_user_permission_set', [
      { id: 'g_auditor', user_id: 'usr_a', permission_set_id: 'ps_auditor', organization_id: ORG },
    ]);

    const report = await b.report();
    expect(report.stopped).toBeUndefined();
    expect(report.absent).toEqual([]);
    expect(findings(report)).toEqual([]);
    expect(report.conflictingPositionNames).toEqual([]);
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
      { id: 'g_ghost', user_id: 'usr_a', permission_set_id: 'ps_gone', permission_set: 'ghost_set', organization_id: ORG },
      { id: 'g_ok', user_id: 'usr_a', permission_set_id: 'ps_auditor', organization_id: ORG },
    ]);

    const report = await b.report();
    expect(findings(report)).toEqual([
      {
        organizationId: null,
        positionAssignments: ['up_ghost_global:global_ghost'],
        permissionSetGrants: [], unnamedGrants: [], positionsWithoutDefinition: [],
      },
      {
        organizationId: ORG,
        positionAssignments: ['up_ghost_own:ghost_lead'],
        permissionSetGrants: ['g_ghost:ghost_set'],
        unnamedGrants: [], positionsWithoutDefinition: [],
      },
      {
        organizationId: OTHER_ORG,
        positionAssignments: ['up_ghost_other:ghost_lead'],
        permissionSetGrants: [], unnamedGrants: [], positionsWithoutDefinition: [],
      },
    ]);
    expect(report.organizations[1].positionAssignments[0].userId).toBe('usr_a');
  });

  it('a grant on a row-only set stays unnamed after the name backfill, confers nothing, and is listed', async () => {
    const b = await boot();
    await insertUser(b, 'usr_row_only');
    // A set row whose name no declaration carries: the backfill cannot show
    // the name names a definition, so the grant keeps no name.
    await insertRows(b, 'sys_permission_set', [
      { id: 'ps_row_only', name: 's3_row_only', label: 'Row only', system_permissions: ['s3_row_only_bit'] },
    ]);
    await insertUnnamedGrants(b, [
      { id: 'g_row_only', user_id: 'usr_row_only', permission_set_id: 'ps_row_only', organization_id: ORG },
    ]);
    await b.bootstrapped();

    const [grant] = (await b.engine.find('sys_user_permission_set', { where: { id: 'g_row_only' }, context: SYS })) as any[];
    expect(grant.permission_set ?? null, 'the name backfill left it unnamed').toBeNull();
    const resolved = await resolveUserAuthzGrants(b.engine as any, 'usr_row_only', { tenantId: ORG });
    expect({ permissions: resolved.permissions.includes('s3_row_only'), bit: resolved.systemPermissions.includes('s3_row_only_bit') })
      .toEqual({ permissions: false, bit: false });
    expect(findings(await b.report())).toEqual([{
      organizationId: ORG,
      positionAssignments: [], permissionSetGrants: [],
      unnamedGrants: ['g_row_only:ps_row_only'],
      positionsWithoutDefinition: [],
    }]);
  });

  it('under a walled posture, an organization-authored position has no catalog home: listed by name and organization; the organization\'s built-in copies are not', async () => {
    const b = await boot({ posture: 'isolated' });
    // The organizations' own copies of the built-ins, which the walled
    // catalog seeds when an organization is created.
    const seeded = (await b.engine.find('sys_position', { where: { name: 'everyone' }, context: SYS })) as any[];
    expect(seeded.map((r) => r.organization_id).sort(), 'PRECONDITION: each organization holds its built-in copies')
      .toEqual([ORG, OTHER_ORG]);
    await insertRows(b, 'sys_position', [
      { id: 'pos_regional_own', name: 'regional_lead', label: 'Regional lead', organization_id: ORG },
      { id: 'pos_regional_other', name: 'regional_lead', label: 'Regional lead', organization_id: OTHER_ORG },
      { id: 'pos_night_other', name: 'night_lead', label: 'Night lead', organization_id: OTHER_ORG },
    ]);
    await insertRows(b, 'sys_user_position', [
      { id: 'up_regional', user_id: 'usr_a', position: 'regional_lead', organization_id: ORG },
    ]);

    const report = await b.report();
    expect(findings(report)).toEqual([
      {
        organizationId: ORG,
        positionAssignments: ['up_regional:regional_lead'],
        permissionSetGrants: [], unnamedGrants: [],
        positionsWithoutDefinition: ['regional_lead'],
      },
      {
        organizationId: OTHER_ORG,
        positionAssignments: [], permissionSetGrants: [], unnamedGrants: [],
        positionsWithoutDefinition: ['night_lead', 'regional_lead'],
      },
    ]);
    expect(report.conflictingPositionNames, 'one name on many rows is the walled shape, not a conflict').toEqual([]);
  });

  it('under a walled posture, a definition saved through the metadata door gives the position its catalog home, and it leaves the report', async () => {
    const b = await boot({ posture: 'isolated' });
    await insertRows(b, 'sys_position', [
      { id: 'pos_regional_own', name: 'regional_lead', label: 'Regional lead', organization_id: ORG },
    ]);
    await insertRows(b, 'sys_user_position', [
      { id: 'up_regional', user_id: 'usr_a', position: 'regional_lead', organization_id: ORG },
    ]);
    expect(findings(await b.report()).map((o) => o.positionsWithoutDefinition)).toEqual([['regional_lead']]);

    await b.protocol.saveMetaItem({
      type: 'position', name: 'regional_lead', item: { name: 'regional_lead', label: 'Regional lead' }, actor: 'system',
    });
    expect(findings(await b.report())).toEqual([]);
  });

  it('under single, a position name more than one row carries is conflicting — reported, never merged — whether or not the catalog resolves it', async () => {
    const b = await boot();
    await insertRows(b, 'sys_position', [
      // Two organizations' Setup rows of one name, agreeing, from before the
      // write door refused a second holder.
      { id: 'pos_twin_own', name: 'twin_lead', label: 'Twin', organization_id: ORG },
      { id: 'pos_twin_other', name: 'twin_lead', label: 'Twin', organization_id: OTHER_ORG },
      // A package's seeded row, and an organization's Setup row of the same
      // name stored before the Setup create refused a package-held name.
      { id: 'pos_pkg', name: PKG_POSITION, label: 'Package lead' },
      { id: 'pos_pkg_own', name: PKG_POSITION, label: 'Mine', organization_id: ORG },
      { id: 'pos_alone', name: 'alone_lead', label: 'Alone', organization_id: ORG },
    ]);
    await b.bootstrapped();

    const report = await b.report();
    expect(report.conflictingPositionNames).toEqual([
      { name: PKG_POSITION, organizationIds: [null, ORG], resolves: true },
      { name: 'twin_lead', organizationIds: [ORG, OTHER_ORG], resolves: true },
    ]);
    const conflictLine = b.logger.error.mock.calls.find(([, , meta]: any[]) => meta?.conflicting);
    expect(conflictLine?.[2]?.conflicting?.items?.map((c: any) => c.name)).toEqual([PKG_POSITION, 'twin_lead']);
  });

  it('under single, the refused-name class stays listed at every boot, after the row-only backfill has recorded its verdict', async () => {
    const b = await boot();
    await insertRows(b, 'sys_position', [
      { id: 'pos_refused', name: 'Legacy Lead', label: 'Illegal name', organization_id: ORG },
    ]);
    await b.bootstrapped();
    const ledger = (await b.engine.find('sys_migration', {
      where: { id: 'adr-0131-position-environment-backfill' }, context: SYS,
    })) as any[];
    expect(ledger.length, 'the backfill recorded its verdict: the refused-name class is final for it').toBe(1);

    await b.bootstrapped();
    expect(findings(await b.report())).toEqual([{
      organizationId: ORG,
      positionAssignments: [], permissionSetGrants: [], unnamedGrants: [],
      positionsWithoutDefinition: ['Legacy Lead (refused name)'],
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
    // The binding both ways the trees carry it: the junction row today, the
    // definition's `permissionSets` once the resolver reads the catalog.
    await insertRows(b, 'sys_position_permission_set', [
      { id: 'pps_field', position_id: 'pos_field', permission_set_id: 'ps_auditor' },
    ]);
    await insertRows(b, 'sys_user_permission_set', [
      { id: 'g_auditor', user_id: 'usr_holder', permission_set_id: 'ps_auditor', organization_id: ORG },
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

  // PENDING STAGE 1. The resolver half of the stage-plan pin ("a removed
  // declaration fails closed and is reported; re-adding it clears both"). On
  // this tree the authorization resolver still reads set bodies from
  // `sys_permission_set` rows and position bindings from the junction, so a
  // declaration removed while its row stays keeps granting: measured, this
  // case fails on the tree it lands on. Enable it (`it.skip` → `it`) in the
  // change that moves the resolver onto the catalog read.
  it.skip('PENDING STAGE 1: the removed declaration fails closed at the resolver, and re-adding it restores the grant', async () => {
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

describe('[ADR-0131 D4] a read that did not happen is never "resolves nowhere"', () => {
  it('an unreadable catalog stops the report: no finding, and the stop is said', async () => {
    const b = await boot();
    await insertRows(b, 'sys_user_position', [
      { id: 'up_ghost', user_id: 'usr_a', position: 'ghost_lead', organization_id: ORG },
    ]);
    const catalog = { resolve: vi.fn().mockRejectedValue(new Error('registry offline')), list: vi.fn() };
    const report = await reportCatalogReferences(b.engine as any, { posture: 'single', catalog, logger: b.logger });
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
    const report = await collectCatalogReferences(engine, { posture: 'single', catalog: b.catalog });
    expect({ stopped: report.stopped, reading: report.stoppedReading, organizations: report.organizations })
      .toEqual({ stopped: 'scan-unreadable', reading: 'sys_user_permission_set', organizations: [] });
  });

  it('a composition without the objects reads nothing and names what it lacks', async () => {
    const engine: CatalogReferenceReportEngine = { getObject: () => undefined, find: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const catalog = { resolve: vi.fn(), list: vi.fn() };
    const report = await reportCatalogReferences(engine, { posture: 'single', catalog, logger });
    expect(report.absent).toEqual(['sys_user_position', 'sys_user_permission_set', 'sys_position']);
    expect(engine.find).not.toHaveBeenCalled();
    expect([logger.info, logger.warn, logger.error].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
  });
});

describe('[ADR-0131 D3/D4] SecurityPlugin runs the report at kernel:bootstrapped', () => {
  it('after both backfills — a name either one resolved this boot is not reported — and the report writes nothing', async () => {
    const b = await boot();
    // A row-only legal position the position backfill defines this boot, and
    // an unnamed grant whose set row's name the catalog resolves, which the
    // grant-name backfill names this boot. Neither may be reported.
    await insertRows(b, 'sys_position', [{ id: 'pos_legacy', name: 'legacy_lead', label: 'Legacy lead', organization_id: ORG }]);
    await insertRows(b, 'sys_user_position', [
      { id: 'up_legacy', user_id: 'usr_a', position: 'legacy_lead', organization_id: ORG },
      { id: 'up_ghost', user_id: 'usr_a', position: 'ghost_lead', organization_id: ORG },
    ]);
    await insertRows(b, 'sys_permission_set', [{ id: 'ps_auditor', name: AUDITOR.name, label: 'Auditor' }]);
    await insertUnnamedGrants(b, [
      { id: 'g_backfilled', user_id: 'usr_a', permission_set_id: 'ps_auditor', organization_id: ORG },
    ]);

    const handlers = b.hooks.get('kernel:bootstrapped') ?? [];
    expect(handlers.length).toBeGreaterThanOrEqual(3);
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
