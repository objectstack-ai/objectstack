// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24822] Step 3.7 declares, on an insert's stored-image seam, that the seam
 * judges the insert's organization (`judgesOrganization`), and it declares
 * that nowhere else.
 *
 * ## Why the member exists
 *
 * The engine's static-`readonly` strip took a caller's explicit
 * `organization_id` (the platform's tenant column declares `readonly: true`)
 * after the Layer 0 wall had admitted it, and the driver stamped the active
 * organization in its place: a 2xx, with the row in another organization than
 * the one the caller named and the wall admitted. The engine cannot tell on
 * its own where the wall judged the column. The seam it holds
 * (`OperationContext.postHookWriteImageCheck`) is also installed by a business
 * `check` alone, and by a platform operator who crosses the wall. So the wall
 * says so, on the seam, and the engine reads that member and nothing else.
 *
 * ## What this file pins
 *
 * Real `ObjectQL` (source), real `SqlDriver`, real `SecurityPlugin`; an
 * innermost probe middleware reads the seam once every other middleware ran.
 *
 * - SET: a walled insert, under `isolated` and `group`, alone or composed with
 *   a business `check`. The value is then stored as sent. With no
 *   organizations runtime in this composition, an absent value is the
 *   driver's stamp, as before.
 * - UNSET: the seam a business `check` installs under `single`, where no wall
 *   exists; and a platform operator's seam that crosses the wall with no active
 *   organization (#24821). A walled update's seam carries the member too (the
 *   card's UPDATE half): `update-seam-judges-organization.test.ts`.
 * - NO SEAM: a platform operator crossing on a private object with an active
 *   organization, and a system context.
 * - DELEGATED (ADR-0090 D10): a crossing operator acting for a walled
 *   delegator. The wall's parts are the delegator's alone, so the member is
 *   SET, and the explicit organization is held to the delegator's wall: stored
 *   as sent where it admits it, refused where it does not.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

const OWN_ORG = 'org_a';
const SISTER_ORG = 'org_c';

const FIELDS = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
};

const OBJECTS = [
  { name: 'qa_account', label: 'Account', fields: FIELDS },
  { name: 'qa_checked', label: 'Checked', fields: FIELDS },
  { name: 'qa_vault', label: 'Vault', access: { default: 'private' }, fields: FIELDS },
];

const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  rowLevelSecurity: [
    {
      name: 'checked_not_forbidden',
      object: 'qa_checked',
      operation: 'all',
      using: "record.name != 'forbidden'",
      check: "record.name != 'forbidden'",
    },
  ],
} as unknown as PermissionSet;

const PLATFORM_ADMIN: PermissionSet = {
  name: 'admin_full_access',
  label: 'Platform Administrator',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
  },
  systemPermissions: ['manage_platform_settings', 'manage_metadata'],
} as unknown as PermissionSet;

const SYS_CTX = { isSystem: true, userId: 'usr_system', tenantId: OWN_ORG };
const MEMBER_CTX = { userId: 'usr_a', tenantId: OWN_ORG, positions: [], permissions: [], posture: 'MEMBER' };
const GROUP_CTX = { ...MEMBER_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
const ADMIN_CTX = { userId: 'usr_admin', tenantId: OWN_ORG, positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' };
const ADMIN_NO_ORG_CTX = { userId: 'usr_admin', positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' };

type Posture = 'isolated' | 'group' | 'single';

interface Sighting { operation: string; installed: boolean; judgesOrganization: unknown }

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(posture: Posture) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.insert-seam-judges-organization',
    name: 'The insert seam declares the organization judged',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER, PLATFORM_ADMIN],
    },
  };
  if (posture !== 'single') {
    services['org-scoping'] = { name: 'com.objectstack.org-scoping' };
    services.tenancy = { posture };
  }
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  // Registered LAST, so it runs innermost and reads the seam as installed.
  const sightings: Sighting[] = [];
  engine.registerMiddleware((async (
    opCtx: { operation: string; postHookWriteImageCheck?: { judgesOrganization?: unknown } },
    next: () => Promise<void>,
  ) => {
    if (opCtx.operation === 'insert' || opCtx.operation === 'update') {
      sightings.push({
        operation: opCtx.operation,
        installed: opCtx.postHookWriteImageCheck !== undefined,
        judgesOrganization: opCtx.postHookWriteImageCheck?.judgesOrganization,
      });
    }
    await next();
  }) as never);

  await engine.insert('qa_account', { id: 'r1', name: 'one', organization_id: OWN_ORG }, { context: SYS_CTX } as never);
  sightings.length = 0;

  const table = async (name: string) => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(name);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex(name).select('id', 'organization_id');
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  return { engine, sightings, table };
}

interface Outcome { ok: boolean; code?: string; status?: number; message?: string }
const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number; message?: string };
    return { ok: false, code: err.code, status: err.statusCode ?? err.status, message: String(err.message ?? e) };
  }
};

const JUDGED = { operation: 'insert', installed: true, judgesOrganization: true };

describe('[#24822] step 3.7 declares the insert\'s organization judged only where the wall\'s parts are composed in', () => {
  it('`isolated` member insert on a walled object: SET, and the active organization it names is stored as sent', async () => {
    const b = await boot('isolated');

    const outcome = await attempt(() => b.engine.insert('qa_account', { id: 'r2', name: 'two', organization_id: OWN_ORG }, { context: MEMBER_CTX } as never));

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([JUDGED]);
    expect(await b.table('qa_account')).toEqual([
      { id: 'r1', organization_id: OWN_ORG },
      { id: 'r2', organization_id: OWN_ORG },
    ]);
  });

  it('`group` member insert naming a sister organization: SET, and the row is stored there, single and array', async () => {
    const b = await boot('group');

    const single = await attempt(() => b.engine.insert('qa_account', { id: 'r2', name: 'two', organization_id: SISTER_ORG }, { context: GROUP_CTX } as never));
    const bulk = await attempt(() => b.engine.insert('qa_account', [{ id: 'r3', name: 'three', organization_id: SISTER_ORG }], { context: GROUP_CTX } as never));

    expect(single.ok, single.message).toBe(true);
    expect(bulk.ok, bulk.message).toBe(true);
    expect(b.sightings).toEqual([JUDGED, JUDGED]);
    expect(await b.table('qa_account')).toEqual([
      { id: 'r1', organization_id: OWN_ORG },
      { id: 'r2', organization_id: SISTER_ORG },
      { id: 'r3', organization_id: SISTER_ORG },
    ]);
  });

  it('a walled insert under a business `check`: the composed seam carries the member, and the check still runs', async () => {
    const b = await boot('isolated');

    const admitted = await attempt(() => b.engine.insert('qa_checked', { id: 'r2', name: 'fine', organization_id: OWN_ORG }, { context: MEMBER_CTX } as never));
    const refused = await attempt(() => b.engine.insert('qa_checked', { id: 'r3', name: 'forbidden', organization_id: OWN_ORG }, { context: MEMBER_CTX } as never));

    expect(admitted.ok, admitted.message).toBe(true);
    expect(refused.ok, 'the business check still refuses its own row').toBe(false);
    expect(refused.code).toBe('PERMISSION_DENIED');
    expect(refused.status).toBe(403);
    expect(b.sightings).toEqual([JUDGED, JUDGED]);
    expect(await b.table('qa_checked')).toEqual([{ id: 'r2', organization_id: OWN_ORG }]);
  });

  it('`single` with a business `check`: the seam is installed and the member is UNSET, because no wall exists to judge the organization', async () => {
    const b = await boot('single');

    const outcome = await attempt(() => b.engine.insert('qa_checked', { id: 'r2', name: 'fine', organization_id: SISTER_ORG }, { context: MEMBER_CTX } as never));

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([{ operation: 'insert', installed: true, judgesOrganization: undefined }]);
    expect(await b.table('qa_checked'), 'taken by the strip, and the context\'s organization stamped').toEqual([
      { id: 'r2', organization_id: OWN_ORG },
    ]);
  });

  it('a platform operator crossing on a private object with NO active organization: its seam is installed with the member UNSET, and the insert is refused', async () => {
    const b = await boot('isolated');

    const outcome = await attempt(() => b.engine.insert('qa_vault', { id: 'r2', name: 'two', organization_id: SISTER_ORG }, { context: ADMIN_NO_ORG_CTX } as never));

    expect(b.sightings).toEqual([{ operation: 'insert', installed: true, judgesOrganization: undefined }]);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('PERMISSION_DENIED');
    expect(outcome.status).toBe(403);
    expect(outcome.message).toContain('has no active organization');
    expect(await b.table('qa_vault')).toEqual([]);
  });

  it('a platform operator crossing on a private object with an active organization: no seam at all, and the value is taken', async () => {
    const b = await boot('isolated');

    const outcome = await attempt(() => b.engine.insert('qa_vault', { id: 'r2', name: 'two', organization_id: SISTER_ORG }, { context: ADMIN_CTX } as never));

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([{ operation: 'insert', installed: false, judgesOrganization: undefined }]);
    expect(await b.table('qa_vault')).toEqual([{ id: 'r2', organization_id: OWN_ORG }]);
  });

  // [#24822] This cell used to pin that an update's seam carried no member:
  // the insert half declared an INSERT's organization only. The UPDATE half
  // sets it on a walled single-payload update too, and
  // `update-seam-judges-organization.test.ts` holds the update matrix.
  it('a walled update\'s seam carries the member as well (the UPDATE half)', async () => {
    const b = await boot('isolated');

    const outcome = await attempt(() => b.engine.update('qa_account', { id: 'r1', name: 'renamed' } as never, { context: MEMBER_CTX } as never));

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([{ operation: 'update', installed: true, judgesOrganization: true }]);
  });

  it('a system context installs no seam', async () => {
    const b = await boot('group');

    const outcome = await attempt(() => b.engine.insert('qa_account', { id: 'r2', name: 'two', organization_id: SISTER_ORG }, { context: SYS_CTX } as never));

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([{ operation: 'insert', installed: false, judgesOrganization: undefined }]);
  });
});

/**
 * [#24822 · ADR-0090 D10] An ON-BEHALF-OF insert whose CALLER crosses the
 * wall (a platform operator on a private object: its own Layer 0 is `null`)
 * and whose DELEGATOR is walled. Step 3.7's wall parts are then the
 * delegator's alone, so the seam judges the insert's organization against the
 * delegator's wall and declares it: an organization that wall admits is stored
 * as sent, and one it refuses is refused.
 *
 * The delegator is a real user whose context the plugin rebuilds from stored
 * rows (`resolveDelegatorContext`): two memberships, so under `group` its wall
 * is that membership set; under `isolated` it is the live request's active
 * organization.
 */
describe('[#24822 · ADR-0090 D10] a delegated insert by a crossing operator is held to the delegator\'s wall', () => {
  const ORG_A = 'org_a';
  const ORG_C = 'org_c';
  const ORG_D = 'org_d';
  const DELEGATOR = 'usr_delegator';
  /** A private object is outside the `'*'` grant, so the delegator holds it by name. */
  const DELEGATOR_SET: PermissionSet = {
    name: 'qa_vault_writer',
    label: 'Vault writer',
    objects: { qa_vault: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  } as unknown as PermissionSet;
  const SETS = [MEMBER, PLATFORM_ADMIN, DELEGATOR_SET];
  const OPERATOR_FOR_DELEGATOR = {
    userId: 'usr_operator',
    tenantId: ORG_A,
    positions: [],
    permissions: ['admin_full_access'],
    posture: 'PLATFORM_ADMIN',
    onBehalfOf: { userId: DELEGATOR },
  };

  async function bootDelegated(posture: 'isolated' | 'group') {
    const engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never) as never,
      true,
    );
    await engine.init();
    engine.registerApp({
      id: 'com.objectstack.qa.insert-seam-judges-organization-delegated',
      name: 'A delegated insert is held to the delegator\'s wall',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [
        SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
        SysOrganization, SysUser, SysMember,
        { name: 'qa_vault', label: 'Vault', access: { default: 'private' }, fields: FIELDS },
      ],
    } as never);
    await engine.syncSchemas();
    engines.push(engine);

    for (const id of [ORG_A, ORG_C, ORG_D]) {
      await engine.insert('sys_organization', { id, name: id, slug: id }, { context: SYS_CTX } as never);
    }
    await engine.insert('sys_user', { id: DELEGATOR, name: DELEGATOR, email: 'delegator@example.test' }, { context: SYS_CTX } as never);
    for (const org of [ORG_A, ORG_C]) {
      await engine.insert('sys_member', { id: `mem_${org}`, user_id: DELEGATOR, organization_id: org, role: 'member' }, { context: SYS_CTX } as never);
    }
    // The delegator holds the member set through a stored grant in each of its
    // organizations, as a user does (the rows `resolveDelegatorContext` reads).
    const driverOf = (o: string) => (engine as unknown as { getDriver(x: string): { create(x: string, r: Record<string, unknown>): Promise<unknown> } }).getDriver(o);
    await driverOf('sys_permission_set').create('sys_permission_set', {
      id: 'ps_qa_vault_writer', name: 'qa_vault_writer', label: 'Vault writer', organization_id: null, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
    });
    for (const org of [ORG_A, ORG_C]) {
      await engine.insert('sys_user_permission_set', { id: `ups_${org}`, user_id: DELEGATOR, permission_set: 'qa_vault_writer', organization_id: org }, { context: SYS_CTX } as never);
    }

    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: engine,
      metadata: {
        get: async (type: string, name: string) =>
          type === 'permission'
            ? SETS.find((set) => (set as { name?: string }).name === name) ?? null
            : engine.getSchema(name) ?? null,
        list: async () => SETS,
      },
      'org-scoping': { name: 'com.objectstack.org-scoping' },
      tenancy: { posture },
    };
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

    const sightings: Sighting[] = [];
    engine.registerMiddleware((async (
      opCtx: { operation: string; postHookWriteImageCheck?: { judgesOrganization?: unknown } },
      next: () => Promise<void>,
    ) => {
      if (opCtx.operation === 'insert') {
        sightings.push({
          operation: opCtx.operation,
          installed: opCtx.postHookWriteImageCheck !== undefined,
          judgesOrganization: opCtx.postHookWriteImageCheck?.judgesOrganization,
        });
      }
      await next();
    }) as never);

    const insertReporting = async (data: unknown) => {
      const dropped: unknown[] = [];
      const outcome = await attempt(() => engine.insert('qa_vault', data as never, {
        context: OPERATOR_FOR_DELEGATOR,
        onFieldsDropped: (e: unknown) => dropped.push(e),
      } as never));
      return { outcome, dropped };
    };
    const vault = async () => {
      const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver('qa_vault');
      const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
      const rows = await knex('qa_vault').select('id', 'organization_id');
      return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    };
    return { sightings, insertReporting, vault };
  }

  const DELEGATOR_WALL_JUDGES = [{ operation: 'insert', installed: true, judgesOrganization: true }];
  const expectWallRefusal = (outcome: Outcome) => {
    expect(outcome.ok, 'expected the delegator\'s wall to refuse').toBe(false);
    expect(outcome.code).toBe('PERMISSION_DENIED');
    expect(outcome.status).toBe(403);
    expect(outcome.message).toContain("the insert would place 'qa_vault' in another tenant");
  };

  it('`group`: an organization the delegator holds is stored as sent, nothing reported, and the seam declares the delegator\'s judgement', async () => {
    const b = await bootDelegated('group');

    const { outcome, dropped } = await b.insertReporting({ id: 'r1', name: 'one', organization_id: ORG_C });

    expect(outcome.ok, outcome.message).toBe(true);
    expect(await b.vault(), 'stored where the caller named, not in the active organization').toEqual([{ id: 'r1', organization_id: ORG_C }]);
    expect(dropped).toEqual([]);
    expect(b.sightings).toEqual(DELEGATOR_WALL_JUDGES);
  });

  it('`group`: an organization the delegator does not hold is refused by the delegator\'s wall, and nothing is stored', async () => {
    const b = await bootDelegated('group');

    const { outcome } = await b.insertReporting({ id: 'r1', name: 'one', organization_id: ORG_D });

    expectWallRefusal(outcome);
    expect(await b.vault()).toEqual([]);
  });

  it('`group`: naming none is stamped with the active organization, as before', async () => {
    const b = await bootDelegated('group');

    const { outcome, dropped } = await b.insertReporting({ id: 'r1', name: 'one' });

    expect(outcome.ok, outcome.message).toBe(true);
    expect(dropped).toEqual([]);
    expect(await b.vault()).toEqual([{ id: 'r1', organization_id: ORG_A }]);
  });

  it('`isolated`: the active organization is stored as sent and not reported; another one is refused', async () => {
    const admitted = await bootDelegated('isolated');
    const sent = await admitted.insertReporting({ id: 'r1', name: 'one', organization_id: ORG_A });
    expect(sent.outcome.ok, sent.outcome.message).toBe(true);
    expect(sent.dropped).toEqual([]);
    expect(await admitted.vault()).toEqual([{ id: 'r1', organization_id: ORG_A }]);
    expect(admitted.sightings).toEqual(DELEGATOR_WALL_JUDGES);

    const refused = await bootDelegated('isolated');
    const other = await refused.insertReporting({ id: 'r1', name: 'one', organization_id: ORG_C });
    expectWallRefusal(other.outcome);
    expect(await refused.vault()).toEqual([]);
  });
});
