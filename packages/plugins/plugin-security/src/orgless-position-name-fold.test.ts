// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20555] A principal with NO active organization resolves permission sets
 * from the organization-less rows only — never from a set some organization
 * authored under a name the principal happens to hold as a position.
 *
 * ## The seam
 *
 * `resolvePermissionSetsForContextUnmemoized` requests
 * `[...positions, ...permissions]` as permission-set NAMES, and anything not
 * declared in metadata or bootstrap was read from `sys_permission_set` by name
 * (the loader reads the security catalog instead since ADR-0131 D3/D4, so no
 * row reaches it at all; the pins below hold either way). With no active
 * organization, `resolveUserAuthzGrants` still lists every current
 * membership's role (`org_member`, …) and the `everyone` anchor in
 * `positions`, and the by-name read carried no tenant — so it returned every
 * organization's row of each name, and the loader kept whichever came first.
 *
 * Measured on `main` at 1c761c0d, over this file's rig: a member of
 * `ORG_HOME` only, with no organization active, resolved the sets `ORG_OTHER`
 * had authored as `org_member` and `everyone` — their `systemPermissions` and
 * their object map (view/modify-all included) reached the resolved sets and
 * `getEffectiveObjectPermissions`. The same principal's GLOBAL grant to
 * `platform_ops` resolved `ORG_OTHER`'s same-named copy instead of the global
 * row it names. With `ORG_HOME` active the read was scoped and none of this
 * happened.
 *
 * ## The rule pinned here
 *
 * A row scoped to an organization applies only while that organization is
 * active — the rule `resolveUserAuthzGrants` applies to grant rows
 * (`grantAppliesInTenant`). An organization-less grant row applies nowhere:
 * the 18.0 ownership ceremony (ADR-0131 D10) attributes every such row before
 * an upgraded database boots, so one is invalid state, not a "global" grant.
 * So the negative pins below are paired with preservation pins: the grants a
 * principal holds in its own organization (a position folded onto the
 * catalog's same-named set, a user grant) resolve while that organization is
 * active and confer nothing with none active, and a legacy organization-less
 * grant row confers nothing either way.
 *
 * ## The rig
 *
 * A real `ObjectQL` over a real `SqlDriver` (better-sqlite3 `:memory:`), the
 * real platform object definitions, the real `SecurityPlugin` resolved through
 * the `security` service it registers, and principals built by
 * `buildContextForUser` — the same `resolveUserAuthzGrants` the request path
 * runs. The plugin's `kernel:ready` bootstraps are collected and never fired:
 * the loader under test does not depend on them, and a bootstrap left running
 * would race the engine teardown.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { SysPosition } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SecurityPlugin } from './security-plugin.js';
import { buildContextForUser } from './explain-engine.js';

const SYS = { context: { isSystem: true } } as any;
/** The organization that authors the colliding sets. Nobody below is its member except `USER_OTHER`. */
const ORG_OTHER = 'org_other';
/** The principals' own organization. */
const ORG_HOME = 'org_home';
/** A member of `ORG_HOME` only. */
const USER_HOME = 'usr_home_member';
/** A member of `ORG_HOME` only, holding two grants owned by `ORG_HOME`. */
const USER_GLOBAL = 'usr_home_global';
/** A member of `ORG_HOME` only, holding the same two grants as organization-less legacy rows. */
const USER_LEGACY = 'usr_home_legacy';
/** A member of `ORG_OTHER` — the control that the authored set resolves at all. */
const USER_OTHER = 'usr_other_member';

const PROBE_OBJECT: any = {
  name: 'probe_ledger',
  label: 'Probe Ledger',
  fields: {
    id: { type: 'text', label: 'Id', primary: true },
    name: { type: 'text', label: 'Name' },
    owner_id: { type: 'text', label: 'Owner' },
  },
};

const FULL = {
  allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
  viewAllRecords: true, modifyAllRecords: true,
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * [C8 stage 8b] An organization-less row is legacy residue: under `single` the
 * engine stamps or refuses an organization-less platform insert (ADR-0131 D9),
 * so a row with `organization_id` NULL is landed straight through the driver,
 * as an older release left it. The grant readers no longer honour one.
 */
function write(e: any, object: string, row: Record<string, unknown>) {
  return row.organization_id === null
    ? e.getDriver(object).create(object, row)
    : e.insert(object, row, SYS);
}

async function insertSet(e: any, id: string, name: string, organizationId: string | null, caps: string[]) {
  await write(e, 'sys_permission_set', {
    id,
    name,
    label: `${organizationId ?? 'global'} ${name}`,
    organization_id: organizationId,
    managed_by: 'admin',
    active: true,
    object_permissions: JSON.stringify({ probe_ledger: FULL }),
    system_permissions: JSON.stringify(caps),
  });
}

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.orgless-position-name-fold',
    name: 'Organization-less position-name fold',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet,
      SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, PROBE_OBJECT,
    ],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  const e = engine as any;
  await e.insert('sys_organization', { id: ORG_OTHER, name: ORG_OTHER, slug: 'other' }, SYS);
  await e.insert('sys_organization', { id: ORG_HOME, name: ORG_HOME, slug: 'home' }, SYS);
  for (const id of [USER_HOME, USER_GLOBAL, USER_LEGACY, USER_OTHER]) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
  }
  await e.insert('sys_member', { id: 'mem_home', user_id: USER_HOME, organization_id: ORG_HOME, role: 'member' }, SYS);
  await e.insert('sys_member', { id: 'mem_global', user_id: USER_GLOBAL, organization_id: ORG_HOME, role: 'member' }, SYS);
  await e.insert('sys_member', { id: 'mem_legacy', user_id: USER_LEGACY, organization_id: ORG_HOME, role: 'member' }, SYS);
  await e.insert('sys_member', { id: 'mem_other', user_id: USER_OTHER, organization_id: ORG_OTHER, role: 'member' }, SYS);

  // ORG_OTHER authors sets named after what every member holds as a position.
  await insertSet(e, 'ps_other_org_member', 'org_member', ORG_OTHER, ['manage_metadata', 'probe.other_org_member']);
  await insertSet(e, 'ps_other_everyone', 'everyone', ORG_OTHER, ['manage_metadata', 'probe.other_everyone']);

  // USER_GLOBAL's grants, owned by ORG_HOME:
  //  (1) a position assignment, folded onto a global same-named set;
  await write(e, 'sys_user_position', {
    id: 'up_global_ops_lead', user_id: USER_GLOBAL, position: 'ops_lead', organization_id: ORG_HOME,
  });
  await insertSet(e, 'ps_global_ops_lead', 'ops_lead', null, ['probe.global_ops_lead']);
  //  (2) a user grant to a global set, beside ORG_OTHER's same-named
  //      copy. The copy's id SORTS FIRST (`ps_0_…` before `ps_1_…`) and the
  //      SQL driver's read comes back ordered by id, so an unscoped read meets
  //      the copy first. With the ids the other way round this pin stays green
  //      against the unscoped read (measured by its ablation), so the order is
  //      load-bearing.
  await insertSet(e, 'ps_0_other_platform_ops', 'platform_ops', ORG_OTHER, ['probe.other_platform_ops']);
  await insertSet(e, 'ps_1_global_platform_ops', 'platform_ops', null, ['probe.global_platform_ops']);
  await write(e, 'sys_user_permission_set', {
    id: 'ups_global_platform_ops', user_id: USER_GLOBAL,
    permission_set: 'platform_ops', organization_id: ORG_HOME,
  });
  // USER_LEGACY holds the same two as organization-less rows — the shape an
  // older release left, which confers nothing anywhere.
  await write(e, 'sys_user_position', {
    id: 'up_legacy_ops_lead', user_id: USER_LEGACY, position: 'ops_lead', organization_id: null,
  });
  await write(e, 'sys_user_permission_set', {
    id: 'ups_legacy_platform_ops', user_id: USER_LEGACY,
    permission_set: 'platform_ops', organization_id: null,
  });
  // [ADR-0131 D3/D4] The two GLOBAL sets are declared in the catalog, which is
  // what makes a grant of them confer anything; the sets ORG_OTHER authored are
  // rows only, with no definition (#15196 Q3 A).
  engine.registry.registerItem('permission', { name: 'ops_lead', systemPermissions: ['probe.global_ops_lead'] }, 'name', 'com.test.ops');
  engine.registry.registerItem('permission', { name: 'platform_ops', systemPermissions: ['probe.global_platform_ops'] }, 'name', 'com.test.ops');
  return engine;
}

/** One `sys_permission_set` by-name read the loader issued, and the rows it got. */
interface LoaderRead { rows: Array<{ id: string; name: string; organization_id: string | null }> }

/**
 * The real engine's `find`, OBSERVED and forwarded verbatim — the one verb the
 * loader under test calls. No write or by-id verb is exposed: the plugin's
 * `kernel:ready` bootstraps are never fired here, so nothing on this path
 * needs one, and a verb that is not there cannot answer on the engine's behalf.
 */
function observed(engine: any, reads: LoaderRead[]): any {
  return {
    registry: engine.registry,
    registerMiddleware: (...a: any[]) => engine.registerMiddleware?.(...a),
    getSchema: (n: string) => engine.getSchema?.(n),
    find: async (o: string, q?: any, opt?: any) => {
      const r = await engine.find(o, q, opt);
      if (o === 'sys_permission_set' && q?.where?.name?.$in) {
        reads.push({
          rows: (r as any[]).map((x) => ({ id: x.id, name: x.name, organization_id: x.organization_id ?? null })),
        });
      }
      return r;
    },
  };
}

interface Rig {
  engine: ObjectQL;
  reads: LoaderRead[];
  security: any;
}

async function rig(): Promise<Rig> {
  const engine = await boot();
  const reads: LoaderRead[] = [];
  const plugin = new SecurityPlugin();
  const ql = observed(engine, reads);
  const services: Record<string, any> = {};
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    registerService: (n: string, s: any) => { services[n] = s; },
    registerMiddleware: () => {},
    hook: () => { /* collected, never fired — see the file header */ },
    getService: (n: string) => {
      if (n === 'objectql') return ql;
      if (n === 'metadata') return { get: async () => undefined, list: async () => [] };
      if (n === 'manifest') return { register: () => {} };
      return services[n];
    },
  };
  await plugin.init(ctx);
  await plugin.start(ctx);
  expect(services.security, 'the security service was never registered').toBeTruthy();
  return { engine, reads, security: services.security };
}

/** What a principal resolves, read back through the registered `security` service. */
async function resolve(r: Rig, userId: string, organizationId?: string) {
  const base = await buildContextForUser(r.engine, userId, Date.now(), organizationId);
  const context = organizationId
    ? { ...base, tenantId: organizationId, organizationId }
    : { ...base, tenantId: undefined };
  r.reads.length = 0;
  const sets = await r.security.resolvePermissionSetsForContext(context);
  const loaderRows = r.reads.flatMap((read) => read.rows);
  const effective = await r.security.getEffectiveObjectPermissions(context);
  const byName = new Map<string, any>(sets.map((s: any) => [s.name, s]));
  return {
    positions: base.positions as string[],
    permissions: base.permissions as string[],
    loaderRows,
    setNames: sets.map((s: any) => s.name) as string[],
    byName,
    capabilities: new Set<string>(sets.flatMap((s: any) => s.systemPermissions ?? [])),
    ledger: effective?.probe_ledger ?? null,
  };
}

describe('[#20555] with no active organization, another organization\'s set named like a position does not reach the principal', () => {
  it('precondition: the organization-less principal really holds the colliding names as positions', async () => {
    const r = await rig();
    const orgless = await resolve(r, USER_HOME);
    // Without these two names in `positions` the pins below would pass for want
    // of a collision, not because the read is scoped.
    expect(orgless.positions).toEqual(expect.arrayContaining(['org_member', 'everyone']));
  }, 120_000);

  it('the by-name read returns no other organization\'s row', async () => {
    const r = await rig();
    const orgless = await resolve(r, USER_HOME);
    expect(orgless.loaderRows.filter((row) => row.organization_id !== null)).toEqual([]);
  }, 120_000);

  // Three pins, one fact each, so the ablation shows each one fail on its own
  // rather than all three behind the first failed assertion.
  it('the authored sets are not among the resolved sets', async () => {
    const r = await rig();
    const orgless = await resolve(r, USER_HOME);
    expect(orgless.setNames.filter((n) => n === 'org_member' || n === 'everyone')).toEqual([]);
  }, 120_000);

  it('their systemPermissions do not reach the principal', async () => {
    const r = await rig();
    const orgless = await resolve(r, USER_HOME);
    expect([...orgless.capabilities].filter((c) => c === 'manage_metadata' || c.startsWith('probe.'))).toEqual([]);
  }, 120_000);

  it('their object map does not reach the effective map', async () => {
    const r = await rig();
    const orgless = await resolve(r, USER_HOME);
    expect(orgless.ledger).toBeNull();
  }, 120_000);

  it('an owned grant confers nothing with no organization active — neither the set it names nor another organization\'s copy', async () => {
    const r = await rig();
    const orgless = await resolve(r, USER_GLOBAL);
    expect(orgless.permissions).not.toContain('platform_ops');
    expect(orgless.byName.get('platform_ops')).toBeUndefined();
    // Control: with its owner active the same grant resolves the global set it
    // names, not ORG_OTHER's same-named copy (whose id sorts first).
    const home = await resolve(r, USER_GLOBAL, ORG_HOME);
    expect(home.permissions).toContain('platform_ops');
    expect(home.byName.get('platform_ops')?.systemPermissions).toEqual(['probe.global_platform_ops']);
  }, 120_000);

  it('…and the same-named copy\'s systemPermissions do not reach that principal', async () => {
    const r = await rig();
    const orgless = await resolve(r, USER_GLOBAL);
    expect([...orgless.capabilities].filter((c) => c.startsWith('probe.other_'))).toEqual([]);
    // Nor with the grant's owner active, where the grant does confer (the
    // control that keeps the leg above from passing for want of a grant).
    const home = await resolve(r, USER_GLOBAL, ORG_HOME);
    expect(home.capabilities.has('probe.global_platform_ops')).toBe(true);
    expect([...home.capabilities].filter((c) => c.startsWith('probe.other_'))).toEqual([]);
  }, 120_000);
});

describe('[#20555] what the rule keeps', () => {
  it('a position folded onto a global same-named set resolves while its owner is active, and not with none active', async () => {
    const r = await rig();
    const home = await resolve(r, USER_GLOBAL, ORG_HOME);
    expect(home.positions).toContain('ops_lead');
    expect(home.byName.get('ops_lead')?.systemPermissions).toEqual(['probe.global_ops_lead']);
    const orgless = await resolve(r, USER_GLOBAL);
    expect(orgless.positions).not.toContain('ops_lead');
    expect(orgless.byName.get('ops_lead')).toBeUndefined();
  }, 120_000);

  it('the owned grants resolve with the principal\'s own organization active', async () => {
    const r = await rig();
    const home = await resolve(r, USER_GLOBAL, ORG_HOME);
    expect(home.byName.get('ops_lead')?.systemPermissions).toEqual(['probe.global_ops_lead']);
    expect(home.byName.get('platform_ops')?.systemPermissions).toEqual(['probe.global_platform_ops']);
    expect(home.setNames).not.toContain('org_member');
  }, 120_000);

  it('an organization-less grant row confers nothing — with no organization active, or with the holder\'s own', async () => {
    const r = await rig();
    for (const organizationId of [undefined, ORG_HOME]) {
      const legacy = await resolve(r, USER_LEGACY, organizationId);
      expect(legacy.positions).not.toContain('ops_lead');
      expect(legacy.permissions).not.toContain('platform_ops');
      expect(legacy.byName.get('ops_lead')).toBeUndefined();
      expect(legacy.byName.get('platform_ops')).toBeUndefined();
      expect([...legacy.capabilities].filter((c) => c.startsWith('probe.'))).toEqual([]);
    }
  }, 120_000);

  // [ADR-0131 D3/D4, #15196 Q3 = A] REVERSED: the plugin no longer reads
  // `sys_permission_set` rows at all, so a set an organization authored as a
  // row with no catalog definition resolves for nobody — its own members,
  // with it active, included. That is the walled-row loss the ruling accepts
  // (loud at boot, promoted to the environment catalog by its operator); the
  // global sets above resolve because the catalog declares them.
  it('a set only an organization ROW carries resolves for nobody, its own active members included', async () => {
    const r = await rig();
    const other = await resolve(r, USER_OTHER, ORG_OTHER);
    expect(other.byName.get('org_member')).toBeUndefined();
    expect(other.ledger).toBeNull();
    expect(other.loaderRows).toEqual([]);
  }, 120_000);
});
