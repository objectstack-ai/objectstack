// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3, C2 stage S7] The `sys_position` data-door write-through under
 * `single`, end to end inside one process: a real ObjectQL engine over the SQL
 * driver, the real `SecurityPlugin` (so every write passes the security
 * middleware the write-through is registered inside), and the REAL metadata
 * door (`ObjectStackProtocolImplementation`, read from source by this package's
 * vitest alias) over the same engine, writing real `sys_metadata` rows.
 *
 * What the pins hold, each against the door itself rather than a double of it:
 *
 * - a Setup create lands its row AND an environment definition that the
 *   security catalog read resolves; an assignment to it grants exactly what
 *   the same position granted as a row only;
 * - an edit and a deactivation keep the row and the definition agreeing
 *   (`active` and `is_default` stay row-only); a rename moves the definition;
 *   a delete removes both;
 * - a create, or a rename, into a name the metadata door refuses answers the
 *   door's own refusal and keeps nothing (seat re-rule Q1 = A); an edit of a
 *   row that already carries such a name still lands as a row write;
 * - an edit that keeps a name a package or a built-in holds, and a delete of
 *   such a row, stand the write-through down: the write is passed on and
 *   nothing reaches metadata (Q2 = A), pinned at the write-through's own level
 *   rather than at the data door's answer;
 * - a create, or a rename into, a name a package or a built-in holds answers
 *   the metadata door's own locked-base refusal and keeps nothing (C2 stage
 *   S10, ADR-0048 addendum N.2/N.3); the engine's own refusals keep theirs;
 * - a package registering a name a Setup position holds in the environment
 *   ledger is refused `NAMESPACE_CONFLICT` (Q3 = A, within Q4 = A);
 * - controls: a walled posture, a system write and a kernel without a metadata
 *   door write rows exactly as before.
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
import { createSecurityCatalogReader, resetPlatformAdminEmailMemo } from '@objectstack/core';
import type { PermissionSet } from '@objectstack/spec/security';
import { DATA_MIGRATION_FLAG_OBJECT } from '@objectstack/spec/system';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';
import { SysMigration } from '@objectstack/platform-objects/system';

import { SecurityPlugin } from './security-plugin.js';
import { buildContextForUser } from './explain-engine.js';
import { SysPosition } from './objects/sys-position.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { createPositionWriteThrough } from './position-write-through.js';
import {
  POSITION_ENVIRONMENT_BACKFILL_MIGRATION_ID,
  backfillRowOnlyPositions,
  isRecordablePositionBackfillVerdict,
  runOneTimePositionEnvironmentBackfill,
} from './position-environment-backfill.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const ORG = 'org_pw';
/** A package that declares one position, the way a stack's `positions` reach the registry. */
const PKG = 'com.example.pw';
const PKG_POSITION = 'pw_field_lead';

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
  /** The data door's writer: the administrator, in the organization. */
  admin: Record<string, unknown>;
  catalogResolves(name: string): Promise<boolean>;
  envRows(name: string): Promise<Array<{ organization_id: string | null; state: string; body: Record<string, unknown> }>>;
  rows(name: string): Promise<any[]>;
  /** Kernel lifecycle hooks the plugin registered, by event — collected, fired only by a test. */
  hooks: Map<string, Array<() => Promise<unknown>>>;
  catalog: ReturnType<typeof createSecurityCatalogReader>;
}

async function boot(opts: { posture?: 'single' | 'isolated'; door?: boolean; ledger?: boolean } = {}): Promise<Booted> {
  const posture = opts.posture ?? 'single';
  const walled = posture !== 'single';
  if (walled) {
    process.env[POSTURE_ENV] = posture;
    process.env[OWNER_ENV] = 'admin@pw.example';
  }
  resetPlatformAdminEmailMemo();

  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.position-write-through',
    name: 'Position write-through',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysUser, SysAccount, SysMember, SysOrganization,
      SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet,
      SysMetadataObject, SysMetadataHistoryObject, SysMetadataCommitObject, SysMetadataAuditObject,
      ...(opts.ledger === false ? [] : [SysMigration]),
    ],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);

  // A package-declared position: registered under its package, as the
  // engine's stack collection loop registers a stack's `positions`, with the
  // row the declared-position seeder writes for it (no provenance stamped).
  (engine as any).registry.registerItem('position', { name: PKG_POSITION, label: 'Field lead' }, 'name', PKG);
  await engine.insert('sys_position', { id: 'pos_pkg', name: PKG_POSITION, label: 'Field lead' }, { context: SYS } as any);

  const protocol = opts.door === false
    ? null
    : new ObjectStackProtocolImplementation(engine as never, () => new Map(), undefined);
  const metadata = {
    get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
    list: async (type: string) => (type === 'position' ? [] : [...defaultPermissionSets, QA_ADMIN]),
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    ...(protocol ? { protocol } : {}),
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

  await engine.insert('sys_organization', { id: ORG, name: 'PW Org', slug: 'pw' }, { context: SYS } as any);
  const catalog = createSecurityCatalogReader({ registry: (engine as any).registry, metadata });
  return {
    engine,
    protocol,
    logger,
    hooks,
    catalog,
    admin: { userId: 'usr_admin', positions: [], permissions: ['qa_admin'], tenantId: ORG, accessible_org_ids: [ORG] },
    async catalogResolves(name) {
      const entry = await catalog.resolve('position', name);
      return entry !== undefined && entry.name === name;
    },
    async envRows(name) {
      const rows = (await engine.find('sys_metadata', { where: { type: 'position', name }, context: SYS })) as any[];
      return rows.map((r) => ({
        organization_id: r.organization_id ?? null,
        state: r.state,
        body: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      }));
    },
    async rows(name) {
      return (await engine.find('sys_position', { where: { name }, context: SYS })) as any[];
    },
  };
}


/** The ADR-0112 envelope a refusal carries: its code and status. */
const envelope = (e: any) => ({ code: e?.code, status: e?.status ?? e?.httpStatus });
/** The refusal a write answered, or `null` when it was accepted. */
const refusalOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

const create = (b: Booted, row: Record<string, unknown>) =>
  b.engine.insert('sys_position', row, { context: b.admin } as any);
const patch = (b: Booted, id: string, data: Record<string, unknown>) =>
  b.engine.update('sys_position', { id, ...data }, { context: b.admin } as any);
const remove = (b: Booted, id: string) =>
  b.engine.delete('sys_position', { where: { id }, context: b.admin } as any);

/** What the explain engine answers for one principal: the grants a position carries. */
async function grantsOf(engine: ObjectQL, userId: string): Promise<Record<string, unknown>> {
  const ctx = await buildContextForUser(engine, userId, Date.now(), ORG);
  return {
    positions: [...(ctx.positions ?? [])].sort(),
    permissions: [...(ctx.permissions ?? [])].sort(),
    systemPermissions: [...(ctx.systemPermissions ?? [])].sort(),
  };
}

describe('[ADR-0131 D3] position write-through under single — a Setup position gets its environment definition', () => {
  it('a Setup create lands its row AND an environment definition that the security catalog read resolves', async () => {
    const b = await boot();
    await create(b, { name: 'regional_lead', label: 'Regional lead', description: 'Leads a region', is_default: true });
    const [row] = await b.rows('regional_lead');
    expect({ label: row.label, is_default: !!row.is_default, active: !!row.active }).toEqual({
      label: 'Regional lead', is_default: true, active: true,
    });
    // `is_default` and `active` are row state: the definition carries neither.
    expect(await b.envRows('regional_lead')).toEqual([{
      organization_id: null,
      state: 'active',
      body: { name: 'regional_lead', label: 'Regional lead', description: 'Leads a region', delegatable: false },
    }]);
    expect(await b.catalogResolves('regional_lead')).toBe(true);
  });

  it('a user assigned to a Setup-created position is granted exactly what the row-only position granted', async () => {
    const grantsThrough = async (door: boolean) => {
      const b = await boot({ door });
      await b.engine.insert('sys_user', {
        id: 'usr_holder', email: 'holder@pw.example', name: 'holder', email_verified: true,
      }, { context: SYS } as any);
      await b.engine.insert('sys_member', {
        id: 'm_holder', user_id: 'usr_holder', organization_id: ORG, role: 'member',
      }, { context: SYS } as any);
      await b.engine.insert('sys_permission_set', {
        id: 'ps_pw_reports',
        name: 'pw_reports',
        label: 'Reports',
        object_permissions: JSON.stringify({ sys_position: { allowRead: true } }),
        system_permissions: JSON.stringify(['view_reports']),
      }, { context: SYS } as any);
      const created: any = await create(b, { name: 'report_reader', label: 'Report reader' });
      await b.engine.insert('sys_position_permission_set', {
        id: 'pps_reports', position_id: created.id, permission_set_id: 'ps_pw_reports',
      }, { context: SYS } as any);
      await b.engine.insert('sys_user_position', {
        id: 'up_holder', user_id: 'usr_holder', position: 'report_reader', organization_id: ORG,
      }, { context: SYS } as any);
      return { grants: await grantsOf(b.engine, 'usr_holder'), defined: (await b.envRows('report_reader')).length };
    };
    const before = await grantsThrough(false); // no metadata door: the row-only position, as before this stage
    const after = await grantsThrough(true);
    expect(before.defined).toBe(0);
    expect(after.defined).toBe(1);
    expect(after.grants).toEqual(before.grants);
    expect(after.grants).toMatchObject({ positions: expect.arrayContaining(['report_reader']), permissions: ['pw_reports'] });
  });

  it('an edit keeps the row and the definition agreeing; a deactivation and is_default stay on the row', async () => {
    const b = await boot();
    const created: any = await create(b, { name: 'shift_lead', label: 'Shift lead' });
    await patch(b, created.id, { label: 'Shift supervisor', description: 'Runs a shift', delegatable: true });
    expect((await b.envRows('shift_lead')).map((r) => r.body)).toEqual([
      { name: 'shift_lead', label: 'Shift supervisor', description: 'Runs a shift', delegatable: true },
    ]);
    const saves = vi.spyOn(b.protocol, 'saveMetaItem');
    await patch(b, created.id, { active: false });
    await patch(b, created.id, { is_default: true });
    expect(saves, 'a row-state patch writes no definition').not.toHaveBeenCalled();
    const [row] = await b.rows('shift_lead');
    expect({ label: row.label, active: !!row.active, is_default: !!row.is_default }).toEqual({
      label: 'Shift supervisor', active: false, is_default: true,
    });
    expect((await b.envRows('shift_lead')).map((r) => r.body)).toEqual([
      { name: 'shift_lead', label: 'Shift supervisor', description: 'Runs a shift', delegatable: true },
    ]);
  });

  it('a rename saves the new name\'s definition and deletes the old one', async () => {
    const b = await boot();
    const created: any = await create(b, { name: 'night_lead', label: 'Night lead' });
    await patch(b, created.id, { name: 'evening_lead' });
    expect(await b.rows('night_lead')).toEqual([]);
    expect((await b.rows('evening_lead')).map((r) => r.id)).toEqual([created.id]);
    expect(await b.envRows('night_lead')).toEqual([]);
    expect((await b.envRows('evening_lead')).map((r) => r.body)).toEqual([
      { name: 'evening_lead', label: 'Night lead', delegatable: false },
    ]);
    expect(await b.catalogResolves('night_lead')).toBe(false);
    expect(await b.catalogResolves('evening_lead')).toBe(true);
  });

  it('a delete removes the row, then the definition', async () => {
    const b = await boot();
    const created: any = await create(b, { name: 'temp_lead', label: 'Temp lead' });
    expect(await b.catalogResolves('temp_lead')).toBe(true);
    await remove(b, created.id);
    expect(await b.rows('temp_lead')).toEqual([]);
    expect(await b.envRows('temp_lead')).toEqual([]);
    expect(await b.catalogResolves('temp_lead')).toBe(false);
  });

  it('a definition delete that fails is reported at error, once, naming the remedy — the row stays deleted', async () => {
    const b = await boot();
    const created: any = await create(b, { name: 'sticky_lead', label: 'Sticky lead' });
    vi.spyOn(b.protocol, 'deleteMetaItem').mockRejectedValueOnce(new Error('store unavailable'));
    await remove(b, created.id);
    expect(await b.rows('sticky_lead')).toEqual([]);
    const errors = b.logger.error.mock.calls.filter(([m]: [string]) => String(m).includes("'sticky_lead'"));
    expect(errors).toHaveLength(1);
    expect(String(errors[0][0])).toContain('DELETE /api/v1/meta/position/sticky_lead');
  });
});

describe('[ADR-0131 D3] Q1 = A — a name the metadata door refuses is refused with the door\'s own answer', () => {
  it.each([
    ['uppercase and a space', 'Regional Lead', { code: 'INVALID_REQUEST', status: 400 }],
    ['a hyphen', 'regional-lead', { code: 'INVALID_REQUEST', status: 400 }],
    ['a leading digit', '9lead', { code: 'INVALID_REQUEST', status: 400 }],
    ['a leading underscore', '_lead', { code: 'INVALID_REQUEST', status: 400 }],
    ['one character', 'r', { code: 'INVALID_METADATA', status: 422 }],
    ['a dot', 'regional.lead', { code: 'INVALID_METADATA', status: 422 }],
  ])('a create named with %s is refused and keeps nothing', async (_label, name, expected) => {
    const b = await boot();
    const refusal = await refusalOf(create(b, { name, label: 'x' }));
    expect(envelope(refusal)).toEqual(expected);
    expect(await b.rows(name), 'the row write was undone').toEqual([]);
    expect(await b.envRows(name)).toEqual([]);
  });

  it('a rename into such a name is refused, and the row and its definition keep the old name', async () => {
    const b = await boot();
    const created: any = await create(b, { name: 'audit_lead', label: 'Audit lead' });
    const refusal = await refusalOf(patch(b, created.id, { name: 'Audit Lead', label: 'Renamed' }));
    expect(envelope(refusal)).toEqual({ code: 'INVALID_REQUEST', status: 400 });
    const [row] = await b.rows('audit_lead');
    expect({ id: row?.id, label: row?.label }).toEqual({ id: created.id, label: 'Audit lead' });
    expect(await b.rows('Audit Lead')).toEqual([]);
    expect((await b.envRows('audit_lead')).map((r) => r.body)).toEqual([
      { name: 'audit_lead', label: 'Audit lead', delegatable: false },
    ]);
  });

  it('control: an edit of a row that already carries such a name lands as a row write, with no definition', async () => {
    const b = await boot();
    // A row written before this stage (a system write is never translated).
    await b.engine.insert('sys_position', { id: 'pos_legacy', name: 'Legacy Lead', label: 'Legacy' }, { context: SYS } as any);
    await patch(b, 'pos_legacy', { label: 'Legacy (renamed label)' });
    const [row] = await b.rows('Legacy Lead');
    expect(row?.label).toBe('Legacy (renamed label)');
    expect(await b.envRows('Legacy Lead')).toEqual([]);
  });

  it('a metadata refusal of a legal name undoes the create, and the refusal is the answer', async () => {
    const b = await boot();
    const refused = Object.assign(new Error('store refused'), { code: 'METADATA_STORE_UNAVAILABLE', status: 503 });
    vi.spyOn(b.protocol, 'saveMetaItem').mockRejectedValueOnce(refused);
    const refusal = await refusalOf(create(b, { name: 'store_lead', label: 'Store lead' }));
    expect(refusal).toBe(refused);
    expect(await b.rows('store_lead')).toEqual([]);
    expect(await b.envRows('store_lead')).toEqual([]);
  });

  it('a metadata refusal of an edit restores the row the edit changed', async () => {
    const b = await boot();
    const created: any = await create(b, { name: 'desk_lead', label: 'Desk lead' });
    const refused = Object.assign(new Error('store refused'), { code: 'METADATA_STORE_UNAVAILABLE', status: 503 });
    vi.spyOn(b.protocol, 'saveMetaItem').mockRejectedValueOnce(refused);
    expect(await refusalOf(patch(b, created.id, { label: 'Desk supervisor' }))).toBe(refused);
    expect((await b.rows('desk_lead'))[0]?.label).toBe('Desk lead');
    expect((await b.envRows('desk_lead')).map((r) => r.body)).toEqual([
      { name: 'desk_lead', label: 'Desk lead', delegatable: false },
    ]);
  });
});

describe('[ADR-0131 D3] Q2 = A — an edit that keeps, or a delete of, a name a package or a built-in holds stands the write-through down', () => {
  // Pinned at the write-through's own level, never at the data door's answer:
  // whether the data door admits an edit of a package-declared row is the
  // system-row gate's call, decided on the row's provenance stamp, and that
  // stamp is another change's. The write-through must stand down whatever the
  // stamp says, because it reads the name's holder from the engine registry.
  // A CREATE under such a name is no stand-down since stage S10 (below).
  it('the write-through passes an edit or a delete on a package-held name to the next step, and writes nothing to metadata', async () => {
    const b = await boot();
    const door = {
      saveMetaItem: vi.fn(async (_request: Record<string, unknown>) => undefined),
      deleteMetaItem: vi.fn(async (_request: Record<string, unknown>) => undefined),
      // The real door's verdict, so the S10 refusal is in force for this double too.
      packagedBaseRefusal: vi.fn((request: { type: string; name: string; operation: 'save' | 'create' | 'delete' }) =>
        b.protocol.packagedBaseRefusal(request) as Error | null),
    };
    const writeThrough = createPositionWriteThrough({
      ql: b.engine, getProtocol: () => door, getPosture: () => 'single', logger: b.logger,
    });
    const passOn = async (opCtx: any, write: () => Promise<unknown>) => {
      const next = vi.fn(async () => { opCtx.result = await write(); });
      await writeThrough(opCtx, next);
      return next.mock.calls.length;
    };

    // An edit of the package-declared row (the label and delegatable a Setup edit sends).
    const edit = { object: 'sys_position', operation: 'update', data: { id: 'pos_pkg', label: 'Edited', delegatable: true }, context: b.admin };
    expect(await passOn(edit, () => b.engine.update('sys_position', { id: 'pos_pkg', label: 'Edited', delegatable: true }, { context: SYS } as any)))
      .toBe(1);
    // A delete of the package-declared row.
    const del = { object: 'sys_position', operation: 'delete', options: { where: { id: 'pos_pkg' } }, context: b.admin };
    expect(await passOn(del, () => b.engine.delete('sys_position', { where: { id: 'pos_pkg' }, context: SYS } as any))).toBe(1);

    expect(door.saveMetaItem).not.toHaveBeenCalled();
    expect(door.deleteMetaItem).not.toHaveBeenCalled();
    expect(await b.envRows(PKG_POSITION)).toEqual([]);

    // Control: the same write-through, the same door, a name only Setup holds — it writes the definition.
    const setupOnly = { object: 'sys_position', operation: 'insert', data: { name: 'setup_lead', label: 'Setup lead' }, context: b.admin };
    expect(await passOn(setupOnly, () => b.engine.insert('sys_position', { name: 'setup_lead', label: 'Setup lead' }, { context: SYS } as any)))
      .toBe(1);
    expect(door.saveMetaItem).toHaveBeenCalledTimes(1);
    expect(door.saveMetaItem.mock.calls[0][0]).toMatchObject({ type: 'position', name: 'setup_lead' });
  });

  it('control: the metadata door itself refuses an environment save over that name (NOT_OVERRIDABLE)', async () => {
    const b = await boot();
    const refusal = await refusalOf(
      b.protocol.saveMetaItem({ type: 'position', name: PKG_POSITION, item: { name: PKG_POSITION, label: 'x' } }),
    );
    expect(envelope(refusal)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
  });
});

describe('[C2 stage S10, ADR-0048 addendum N.2/N.3] one namespace — a create or a rename into a held name answers the door\'s refusal', () => {
  /** The metadata door's own envelope for an environment save over a name a package or a built-in holds. */
  const DOOR_REFUSAL = { code: 'NOT_OVERRIDABLE', status: 403 };

  it.each([
    ['a package declares', PKG_POSITION],
    ['the platform declares as an audience anchor', 'everyone'],
    ['the platform declares as an audience anchor (guest)', 'guest'],
  ])('a create under a name %s is refused with the door\'s envelope, and keeps no row and no definition', async (_holder, name) => {
    const b = await boot();
    const before = (await b.rows(name)).map((r) => r.id);
    const refusal = await refusalOf(create(b, { name, label: 'Mine' }));
    expect(envelope(refusal)).toEqual(DOOR_REFUSAL);
    expect((await b.rows(name)).map((r) => r.id), 'the created row was undone').toEqual(before);
    expect(await b.envRows(name)).toEqual([]);
  });

  it('the refusal is the door\'s own, relayed as the door built it — the same verdict a metadata CREATE gets', async () => {
    // [#22591] A Setup create is a create, so it is the door's answer to a
    // create that is relayed: the metadata door's first-write save
    // (`parentVersion: null`, `If-None-Match: *` on its REST route).
    const b = await boot();
    const refusal: any = await refusalOf(create(b, { name: PKG_POSITION, label: 'Mine' }));
    const door: any = await refusalOf(b.protocol.saveMetaItem({
      type: 'position', name: PKG_POSITION, item: { name: PKG_POSITION, label: 'Mine' }, parentVersion: null,
    }));
    expect({ code: refusal?.code, status: refusal?.status, message: refusal?.message })
      .toEqual({ code: door?.code, status: door?.status, message: door?.message });
  });

  // [#22591] The remedy follows the act. The administrator is creating a
  // position of their own (or renaming one into the name), so the refusal names
  // the remedy a create has — a name no package or built-in holds, and where the
  // held names are listed — never the edit remedy ("edit the source artifact and
  // redeploy") of a position someone else declared. Pinned on the KIND: what the
  // sentence points at, not its words. The door's edit refusal is the control.
  const LISTING = 'GET /api/v1/meta/position';
  const remedyKind = (message: unknown) => {
    const text = String(message);
    const newName = text.includes(LISTING);
    const edit = /\bredeploy\b|\bsource\b/.test(text);
    return newName && edit ? 'both' : newName ? 'new-name' : edit ? 'edit' : 'none';
  };

  it.each([
    ['a package declares', PKG_POSITION],
    ['the platform declares (everyone)', 'everyone'],
  ])('a create under a name %s names a free name, not the edit remedy; the door\'s edit refusal keeps its own', async (_holder, name) => {
    const b = await boot();
    const refusal: any = await refusalOf(create(b, { name, label: 'Mine' }));
    expect(envelope(refusal)).toEqual(DOOR_REFUSAL);
    expect(remedyKind(refusal?.message)).toBe('new-name');
    const edit: any = await refusalOf(b.protocol.saveMetaItem({ type: 'position', name, item: { name, label: 'Mine' } }));
    expect(envelope(edit)).toEqual(DOOR_REFUSAL);
    expect(remedyKind(edit?.message)).toBe('edit');
  });

  it('a rename into a held name names a free name too', async () => {
    const b = await boot();
    const created: any = await create(b, { name: 'lane_lead', label: 'Lane lead' });
    const refusal: any = await refusalOf(patch(b, created.id, { name: 'guest' }));
    expect(envelope(refusal)).toEqual(DOOR_REFUSAL);
    expect(remedyKind(refusal?.message)).toBe('new-name');
  });

  it('a bulk create carrying one held name is refused whole: no row of the write is kept', async () => {
    const b = await boot();
    const refusal = await refusalOf(b.engine.insert('sys_position', [
      { name: 'bulk_lead', label: 'Bulk lead' },
      { name: PKG_POSITION, label: 'Mine' },
    ], { context: b.admin } as any));
    expect(envelope(refusal)).toEqual(DOOR_REFUSAL);
    expect(await b.rows('bulk_lead')).toEqual([]);
    expect(await b.envRows('bulk_lead')).toEqual([]);
    expect((await b.rows(PKG_POSITION)).map((r) => r.id)).toEqual(['pos_pkg']);
  });

  it.each([
    ['a package declares', PKG_POSITION],
    ['the platform declares', 'guest'],
  ])('a rename into a name %s is refused; the row and its definition keep the old name', async (_holder, held) => {
    const b = await boot();
    const created: any = await create(b, { name: 'route_lead', label: 'Route lead' });
    const refusal = await refusalOf(patch(b, created.id, { name: held, label: 'Renamed' }));
    expect(envelope(refusal)).toEqual(DOOR_REFUSAL);
    const [row] = await b.rows('route_lead');
    expect({ id: row?.id, label: row?.label }).toEqual({ id: created.id, label: 'Route lead' });
    expect((await b.rows(held)).map((r) => r.id)).not.toContain(created.id);
    // Before S10 the rename stood down for the new name and then deleted the old name's definition.
    expect((await b.envRows('route_lead')).map((r) => r.body)).toEqual([
      { name: 'route_lead', label: 'Route lead', delegatable: false },
    ]);
    expect(await b.envRows(held)).toEqual([]);
  });

  it('a verdict the door cannot reach is no admission: the create and the rename are undone, and the failure is the answer', async () => {
    const b = await boot();
    const created: any = await create(b, { name: 'yard_lead', label: 'Yard lead' });
    const unreadable = Object.assign(new Error('registry unreadable'), { code: 'METADATA_STORE_UNAVAILABLE', status: 503 });
    vi.spyOn(b.protocol, 'packagedBaseRefusal').mockImplementation(() => { throw unreadable; });
    expect(await refusalOf(create(b, { name: 'dock_lead', label: 'Dock lead' }))).toBe(unreadable);
    expect(await b.rows('dock_lead')).toEqual([]);
    expect(await refusalOf(patch(b, created.id, { name: 'gate_lead' }))).toBe(unreadable);
    expect((await b.rows('yard_lead')).map((r) => r.id)).toEqual([created.id]);
    expect(await b.rows('gate_lead')).toEqual([]);
  });

  it('control: the engine\'s own refusals keep their answer — a reserved identity name stays VALIDATION_FAILED', async () => {
    const b = await boot();
    // The platform holds `org_admin` too, but the engine's rule validator refuses
    // the row before the door is asked (the REST layer answers it 400).
    const refusal: any = await refusalOf(create(b, { name: 'org_admin', label: 'Mine' }));
    expect({ name: refusal?.name, code: refusal?.code }).toEqual({ name: 'ValidationError', code: 'VALIDATION_FAILED' });
    expect(await b.rows('org_admin')).toEqual([]);
  });

  it('control: an edit that keeps a held name stays a row write, with no definition and no refusal', async () => {
    const b = await boot();
    // A row that predates this stage: an organization's own row under the package's name.
    await b.engine.insert('sys_position', {
      id: 'pos_twin', name: PKG_POSITION, label: 'Twin', organization_id: ORG,
    }, { context: SYS } as any);
    await patch(b, 'pos_twin', { label: 'Twin (relabelled)' });
    expect((await b.rows(PKG_POSITION)).find((r) => r.id === 'pos_twin')?.label).toBe('Twin (relabelled)');
    expect(await b.envRows(PKG_POSITION)).toEqual([]);
  });

  it('control: a door that brings no locked-base verdict keeps the stand-down', async () => {
    const b = await boot();
    const door = {
      saveMetaItem: vi.fn(async (_request: Record<string, unknown>) => undefined),
      deleteMetaItem: vi.fn(async (_request: Record<string, unknown>) => undefined),
    };
    const writeThrough = createPositionWriteThrough({
      ql: b.engine, getProtocol: () => door, getPosture: () => 'single', logger: b.logger,
    });
    const opCtx: any = { object: 'sys_position', operation: 'insert', data: { name: 'everyone', label: 'Everyone' }, context: b.admin };
    const next = vi.fn(async () => { opCtx.result = { id: 'pos_builtin', name: 'everyone' }; });
    await writeThrough(opCtx, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(door.saveMetaItem).not.toHaveBeenCalled();
  });
});

describe('[ADR-0131 D3] Q3 = A — a package cannot register a name a Setup position holds in the environment ledger', () => {
  it('the registry item seam refuses it 422 NAMESPACE_CONFLICT, naming both holders', async () => {
    const b = await boot();
    await create(b, { name: 'claims_lead', label: 'Claims lead' });
    let thrown: any = null;
    try {
      (b.engine as any).registry.registerItem('position', { name: 'claims_lead', label: 'Pkg' }, 'name', 'com.example.other');
    } catch (e) { thrown = e; }
    expect(envelope(thrown)).toEqual({ code: 'NAMESPACE_CONFLICT', status: 422 });
    expect(thrown?.existingHolder).toEqual({ kind: 'environment' });
    expect(String(thrown?.message)).toContain('com.example.other');
  });
});

describe('[ADR-0131 D3] controls — what the write-through leaves exactly as it was', () => {
  it('a walled posture: an organization administrator\'s create lands its organization row, and no definition', async () => {
    const b = await boot({ posture: 'isolated' });
    const saves = vi.spyOn(b.protocol, 'saveMetaItem');
    await create(b, { name: 'plant_lead', label: 'Plant lead' });
    expect((await b.rows('plant_lead')).map((r) => r.organization_id)).toEqual([ORG]);
    expect(saves).not.toHaveBeenCalled();
    expect(await b.envRows('plant_lead')).toEqual([]);
  });

  it('a system write is never translated', async () => {
    const b = await boot();
    await b.engine.insert('sys_position', { id: 'pos_sys', name: 'seeded_lead', label: 'Seeded' }, { context: SYS } as any);
    expect((await b.rows('seeded_lead')).length).toBe(1);
    expect(await b.envRows('seeded_lead')).toEqual([]);
  });

  it('a kernel with no metadata door writes the row exactly as before', async () => {
    const b = await boot({ door: false });
    await create(b, { name: 'plain_lead', label: 'Plain lead' });
    expect((await b.rows('plain_lead')).length).toBe(1);
    expect(await b.envRows('plain_lead')).toEqual([]);
  });

  it('a built-in position is still refused at the admin door, before anything is translated', async () => {
    const b = await boot();
    await b.engine.insert('sys_position', {
      id: 'pos_everyone', name: 'everyone', label: 'Everyone', managed_by: 'platform',
    }, { context: SYS } as any);
    const refusal: any = await refusalOf(patch(b, 'pos_everyone', { label: 'All' }));
    expect(refusal?.name).toBe('PermissionDeniedError');
    expect(await b.envRows('everyone')).toEqual([]);
  });

  it('the permission-set write-through is unchanged: a data-door set create still becomes a permission definition', async () => {
    const b = await boot();
    await b.engine.insert('sys_permission_set', { name: 'pw_viewers', label: 'Viewers' }, { context: b.admin } as any);
    const rows = (await b.engine.find('sys_metadata', { where: { type: 'permission', name: 'pw_viewers' }, context: SYS })) as any[];
    expect(rows.map((r) => r.organization_id ?? null)).toEqual([null]);
    expect(await b.envRows('pw_viewers')).toEqual([]);
  });
});

describe('[ADR-0131 D3] the row-only position backfill — once, under single, remembered in sys_migration', () => {
  /** Rows written before the write-through existed: system writes, as the pre-stage data door left them. */
  const seedRowOnly = async (b: Booted) => {
    await b.engine.insert('sys_position', [
      { id: 'pos_a', name: 'legacy_lead', label: 'Legacy lead', description: 'Before S7', delegatable: true },
      { id: 'pos_b', name: 'Legacy Lead', label: 'Illegal name' },
      { id: 'pos_c', name: 'twin_lead', label: 'Twin' },
      { id: 'pos_d', name: 'twin_lead', label: 'Twin', organization_id: ORG },
    ], { context: SYS } as any);
  };
  const census = async (b: Booted) => {
    const names = [...new Set(((await b.engine.find('sys_position', { context: SYS })) as any[]).map((r) => r.name))];
    const rowOnly: string[] = [];
    for (const n of names) if (!(await b.catalogResolves(n))) rowOnly.push(n);
    return rowOnly.sort();
  };
  const runBootstrapped = async (b: Booted) => {
    for (const handler of b.hooks.get('kernel:bootstrapped') ?? []) await handler();
  };
  const ledgerRows = async (b: Booted) =>
    (await b.engine.find(DATA_MIGRATION_FLAG_OBJECT, {
      where: { id: POSITION_ENVIRONMENT_BACKFILL_MIGRATION_ID }, context: SYS,
    })) as any[];

  it('SecurityPlugin runs it at kernel:bootstrapped: the row-only census is empty after it, save the refused-name class', async () => {
    const b = await boot();
    await seedRowOnly(b);
    expect(await census(b)).toEqual(['Legacy Lead', 'legacy_lead', 'twin_lead']);
    await runBootstrapped(b);
    expect(await census(b), 'only the final refused-name class stays row-only').toEqual(['Legacy Lead']);
    expect((await b.envRows('legacy_lead')).map((r) => ({ org: r.organization_id, body: r.body }))).toEqual([
      { org: null, body: { name: 'legacy_lead', label: 'Legacy lead', description: 'Before S7', delegatable: true } },
    ]);
    expect(await b.envRows(PKG_POSITION), 'a package-declared position is left alone').toEqual([]);
    const [ledger] = await ledgerRows(b);
    expect(JSON.parse(ledger.details)).toEqual({ names: 4, rowOnly: 3, backfilled: 2, refusedName: 1 });
    const warned = b.logger.warn.mock.calls.filter(([m]: [string]) => String(m).includes('keep no environment definition'));
    expect(warned).toHaveLength(1);
    expect(warned[0][1]).toEqual({ count: 1, positions: { names: ['Legacy Lead'] } });
  });

  it('a rerun changes nothing: the recorded verdict skips the pass, and a fresh pass writes nothing', async () => {
    const b = await boot();
    await seedRowOnly(b);
    await runBootstrapped(b);
    const saves = vi.spyOn(b.protocol, 'saveMetaItem');
    const again = await runOneTimePositionEnvironmentBackfill(b.engine as any, {
      posture: 'single', catalog: b.catalog, door: b.protocol, logger: b.logger,
    });
    expect(again.status).toBe('already-run');
    const pass = await backfillRowOnlyPositions(b.engine as any, { catalog: b.catalog, door: b.protocol, logger: b.logger });
    expect({ rowOnly: pass.rowOnly, backfilled: pass.backfilled, refusedName: pass.refusedName }).toEqual({
      rowOnly: ['Legacy Lead'], backfilled: [], refusedName: ['Legacy Lead'],
    });
    expect(saves).not.toHaveBeenCalled();
    expect(await ledgerRows(b)).toHaveLength(1);
  });

  it('rows of one name that disagree are not guessed at: reported at error, and the verdict stays unrecorded', async () => {
    const b = await boot();
    await b.engine.insert('sys_position', [
      { id: 'pos_x', name: 'split_lead', label: 'Split A' },
      { id: 'pos_y', name: 'split_lead', label: 'Split B', organization_id: ORG },
    ], { context: SYS } as any);
    const out = await runOneTimePositionEnvironmentBackfill(b.engine as any, {
      posture: 'single', catalog: b.catalog, door: b.protocol, logger: b.logger,
    });
    expect(out.status).toBe('undecided');
    expect(out.backfill?.conflicting).toEqual(['split_lead']);
    expect(await b.envRows('split_lead')).toEqual([]);
    expect(await ledgerRows(b)).toEqual([]);
    expect(b.logger.error.mock.calls.some(([m]: [string]) => String(m).includes('rows carrying each name disagree'))).toBe(true);
  });

  it('a definition write that does not land is loud, and the next boot retries', async () => {
    const b = await boot();
    await seedRowOnly(b);
    vi.spyOn(b.protocol, 'saveMetaItem').mockRejectedValueOnce(new Error('store unavailable'));
    const first = await runOneTimePositionEnvironmentBackfill(b.engine as any, {
      posture: 'single', catalog: b.catalog, door: b.protocol, logger: b.logger,
    });
    expect(first.status).toBe('undecided');
    expect(first.backfill?.failed).toEqual(['legacy_lead']);
    expect(await ledgerRows(b)).toEqual([]);
    expect(b.logger.error).toHaveBeenCalled();
    const second = await runOneTimePositionEnvironmentBackfill(b.engine as any, {
      posture: 'single', catalog: b.catalog, door: b.protocol, logger: b.logger,
    });
    expect(second.status).toBe('ran');
    expect(second.backfill?.backfilled).toEqual(['legacy_lead']);
    expect(await ledgerRows(b)).toHaveLength(1);
  });

  it('a walled posture does not run it; neither does a kernel with no metadata door record a verdict', async () => {
    const walled = await boot({ posture: 'isolated' });
    await seedRowOnly(walled);
    expect((await runOneTimePositionEnvironmentBackfill(walled.engine as any, {
      posture: 'isolated', catalog: walled.catalog, door: walled.protocol, logger: walled.logger,
    })).status).toBe('not-applicable');
    expect(await walled.envRows('legacy_lead')).toEqual([]);

    const doorless = await boot({ door: false });
    await seedRowOnly(doorless);
    const out = await runOneTimePositionEnvironmentBackfill(doorless.engine as any, {
      posture: 'single', catalog: doorless.catalog, door: null, logger: doorless.logger,
    });
    expect({ status: out.status, stopped: out.backfill?.stopped }).toEqual({ status: 'undecided', stopped: 'door-absent' });
    expect(await ledgerRows(doorless)).toEqual([]);
  });

  it('isRecordablePositionBackfillVerdict: the refused-name class is final; a failure, a conflict or a stop is not', () => {
    const base = { names: 1, rowOnly: ['x'], backfilled: [], refusedName: ['X X'], conflicting: [], failed: [] };
    expect(isRecordablePositionBackfillVerdict(base)).toBe(true);
    expect(isRecordablePositionBackfillVerdict({ ...base, failed: ['x'] })).toBe(false);
    expect(isRecordablePositionBackfillVerdict({ ...base, conflicting: ['x'] })).toBe(false);
    expect(isRecordablePositionBackfillVerdict({ ...base, stopped: 'scan-unreadable' })).toBe(false);
  });
});
