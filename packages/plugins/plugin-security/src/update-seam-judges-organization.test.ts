// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24822] Step 3.7 declares, on a single-payload update's stored-image seam,
 * that the seam judges the update's organization (`judgesOrganization`), as it
 * does on an insert's, and it declares that nowhere else. The insert half is
 * `insert-seam-judges-organization.test.ts`.
 *
 * ## Why the member is on the update seam too
 *
 * The wall has always judged an update's re-point of `organization_id`: the
 * payload as sent, and since #20013 the stored image (the prior row merged with
 * the final payload by id, every matched row merged with it by predicate). But
 * the engine's static-`readonly` strip then took the admitted re-point (the
 * platform's tenant column declares `readonly: true`), and the row kept its own
 * organization: a 2xx, with the row in another organization than the one the
 * caller named and the wall admitted. The engine reads this member, and nothing
 * else, to leave the re-point on the row for the wall's verdict.
 *
 * ## What this file pins
 *
 * Real `ObjectQL` (source), real `SqlDriver`, real `SecurityPlugin`; an
 * innermost probe middleware reads the seam once every other middleware ran.
 *
 * - SET: a walled update by id and by predicate, under `isolated` and `group`,
 *   alone or composed with a business `check`. An admitted re-point is then
 *   stored as sent.
 * - UNSET: the seam a business `check` installs under `single`, where no wall
 *   exists.
 * - NO SEAM: a platform operator crossing on a private object, a system
 *   context, and an ARRAY update payload (step 3.7 composes no seam for it).
 * - `sys_` SCOPE: step 3.7 composes its wall on a tenant-scoped `sys_` object
 *   and the member is set there too, but the engine spares the column only on
 *   an object the insert strip judges, so a `sys_` row keeps its organization
 *   and the drop is reported, as before. The organization-scoped grant tables
 *   declare a WRITABLE `organization_id` the strip never took: their re-point
 *   meets their own guards (the RBAC administration gate, the membership
 *   check), exactly as before.
 * - DELEGATED (ADR-0090 D10): a crossing operator acting for a walled
 *   delegator. The wall's parts are the delegator's alone, so the member is
 *   SET, and the re-point is held to the delegator's wall.
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
const FOREIGN_ORG = 'org_d';
const DELEGATOR = 'usr_delegator';
const GRANTEE = 'usr_grantee';

const FIELDS = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
};

/** A tenant-scoped object in the reserved namespace, carrying the injected read-only column. */
const SYS_OBJECT = 'sys_qa_ledger';

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

/** A private object is outside the `'*'` grant, so the delegator holds it by name. */
const DELEGATOR_SET: PermissionSet = {
  name: 'qa_vault_writer',
  label: 'Vault writer',
  objects: { qa_vault: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;
const SETS = [MEMBER, PLATFORM_ADMIN, DELEGATOR_SET];

const SYS_CTX = { isSystem: true, userId: 'usr_system', tenantId: OWN_ORG };
const MEMBER_CTX = { userId: 'usr_a', tenantId: OWN_ORG, positions: [], permissions: [], posture: 'MEMBER' };
const GROUP_CTX = { ...MEMBER_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
const ADMIN_CTX = { userId: 'usr_admin', tenantId: OWN_ORG, positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' };
const GROUP_ADMIN_CTX = { ...ADMIN_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
const OPERATOR_FOR_DELEGATOR = {
  userId: 'usr_operator',
  tenantId: OWN_ORG,
  positions: [],
  permissions: ['admin_full_access'],
  posture: 'PLATFORM_ADMIN',
  onBehalfOf: { userId: DELEGATOR },
};

type Posture = 'isolated' | 'group' | 'single';

interface Sighting { installed: boolean; judgesOrganization: unknown }

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
    id: 'com.objectstack.qa.update-seam-judges-organization',
    name: 'The update seam declares the organization judged',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember,
      { name: 'qa_account', label: 'Account', fields: FIELDS },
      { name: 'qa_checked', label: 'Checked', fields: FIELDS },
      { name: 'qa_vault', label: 'Vault', access: { default: 'private' }, fields: FIELDS },
      { name: SYS_OBJECT, label: 'Ledger', fields: FIELDS },
    ],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  for (const id of [OWN_ORG, SISTER_ORG, FOREIGN_ORG]) {
    await engine.insert('sys_organization', { id, name: id, slug: id }, { context: SYS_CTX } as never);
  }
  for (const user of [DELEGATOR, GRANTEE]) {
    await engine.insert('sys_user', { id: user, name: user, email: `${user}@example.test` }, { context: SYS_CTX } as never);
    for (const org of [OWN_ORG, SISTER_ORG]) {
      await engine.insert('sys_member', { id: `mem_${user}_${org}`, user_id: user, organization_id: org, role: 'member' }, { context: SYS_CTX } as never);
    }
  }
  const driverOf = (o: string) => (engine as unknown as { getDriver(x: string): { create(x: string, r: Record<string, unknown>): Promise<unknown>; knex: unknown } }).getDriver(o);
  for (const name of ['qa_vault_writer', 'member_default']) {
    await driverOf('sys_permission_set').create('sys_permission_set', {
      id: `ps_${name}`, name, label: name, organization_id: null, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
    });
  }
  await driverOf('sys_position').create('sys_position', { id: 'pos_clerk', name: 'pos_clerk', label: 'Clerk' });
  // The delegator holds its set through a stored grant in each organization.
  for (const org of [OWN_ORG, SISTER_ORG]) {
    await engine.insert('sys_user_permission_set', { id: `ups_${org}`, user_id: DELEGATOR, permission_set: 'qa_vault_writer', organization_id: org }, { context: SYS_CTX } as never);
  }
  // The grant rows whose organization the `sys_` scope cells re-point.
  await engine.insert('sys_user_permission_set', { id: 'ups_grantee', user_id: GRANTEE, permission_set: 'member_default', organization_id: OWN_ORG }, { context: SYS_CTX } as never);
  await engine.insert('sys_user_position', { id: 'upos_grantee', user_id: GRANTEE, position: 'pos_clerk', organization_id: OWN_ORG }, { context: SYS_CTX } as never);
  for (const object of ['qa_account', 'qa_checked', 'qa_vault', SYS_OBJECT]) {
    for (const id of ['r1', 'r2']) {
      await engine.insert(object, { id, name: 'seeded', organization_id: OWN_ORG }, { context: SYS_CTX } as never);
    }
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
    if (opCtx.operation === 'update') {
      sightings.push({
        installed: opCtx.postHookWriteImageCheck !== undefined,
        judgesOrganization: opCtx.postHookWriteImageCheck?.judgesOrganization,
      });
    }
    await next();
  }) as never);

  const table = async (name: string) => {
    const knex = driverOf(name).knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex(name).select('id', 'organization_id');
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  /** One update, collecting what the write reports. */
  const update = async (object: string, data: unknown, options: Record<string, unknown>) => {
    const dropped: Array<{ fields: string[]; reason: string }> = [];
    const outcome = await attempt(() => engine.update(object, data as never, {
      ...options,
      onFieldsDropped: (e: { fields: string[]; reason: string }) => dropped.push({ fields: e.fields, reason: e.reason }),
    } as never));
    return { outcome, dropped };
  };
  return { engine, sightings, table, update };
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

const JUDGED: Sighting = { installed: true, judgesOrganization: true };
const NO_SEAM: Sighting = { installed: false, judgesOrganization: undefined };
const SEEDED = (org: string = OWN_ORG) => [{ id: 'r1', organization_id: org }, { id: 'r2', organization_id: OWN_ORG }];
const READONLY_DROP = [{ fields: ['organization_id'], reason: 'readonly' }];
const byId = (organization: string) => ({ id: 'r1', organization_id: organization });
const predicateOptions = (context: object) => ({ where: { id: 'r1' }, multi: true, context });

const expectWallRefusal = (outcome: Outcome, object: string) => {
  expect(outcome.ok, 'expected the wall to refuse').toBe(false);
  expect(outcome.code).toBe('PERMISSION_DENIED');
  expect(outcome.status).toBe(403);
  expect(outcome.message).toContain(`the update would place '${object}' in another tenant`);
};

describe('[#24822] step 3.7 declares a single-payload update\'s organization judged only where the wall\'s parts are composed in', () => {
  it('`isolated`: an update that leaves the organization alone is SET, and the row keeps its organization', async () => {
    const b = await boot('isolated');

    const { outcome } = await b.update('qa_account', { id: 'r1', name: 'renamed' }, { context: MEMBER_CTX });

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([JUDGED]);
    expect(await b.table('qa_account')).toEqual(SEEDED());
  });

  it('`group`: a re-point to a sister organization is SET and stored there, by id and by predicate, with nothing reported', async () => {
    const one = await boot('group');
    const viaId = await one.update('qa_account', byId(SISTER_ORG), { context: GROUP_CTX });
    expect(viaId.outcome.ok, viaId.outcome.message).toBe(true);
    expect(viaId.dropped).toEqual([]);
    expect(one.sightings).toEqual([JUDGED]);
    expect(await one.table('qa_account')).toEqual(SEEDED(SISTER_ORG));

    const two = await boot('group');
    const viaPredicate = await two.update('qa_account', { organization_id: SISTER_ORG }, predicateOptions(GROUP_CTX));
    expect(viaPredicate.outcome.ok, viaPredicate.outcome.message).toBe(true);
    expect(viaPredicate.dropped).toEqual([]);
    expect(two.sightings).toEqual([JUDGED]);
    expect(await two.table('qa_account')).toEqual(SEEDED(SISTER_ORG));
  });

  it('`group`: a re-point outside the membership set is still refused, by id and by predicate, and nothing moves', async () => {
    const b = await boot('group');

    const viaId = await b.update('qa_account', byId(FOREIGN_ORG), { context: GROUP_CTX });
    const viaPredicate = await b.update('qa_account', { organization_id: FOREIGN_ORG }, predicateOptions(GROUP_CTX));

    expectWallRefusal(viaId.outcome, 'qa_account');
    expectWallRefusal(viaPredicate.outcome, 'qa_account');
    expect(await b.table('qa_account')).toEqual(SEEDED());
  });

  it('a walled update under a business `check`: the composed seam carries the member, and the check still runs', async () => {
    const b = await boot('group');

    const admitted = await b.update('qa_checked', { id: 'r1', name: 'fine', organization_id: SISTER_ORG }, { context: GROUP_CTX });
    const refused = await b.update('qa_checked', { id: 'r2', name: 'forbidden', organization_id: SISTER_ORG }, { context: GROUP_CTX });

    expect(admitted.outcome.ok, admitted.outcome.message).toBe(true);
    expect(refused.outcome.ok, 'the business check still refuses its own row').toBe(false);
    expect(refused.outcome.code).toBe('PERMISSION_DENIED');
    expect(refused.outcome.status).toBe(403);
    // The refused one never reaches the engine: step 3.6 refuses its by-id
    // image (the stored row merged with the change set) before `next()`.
    expect(b.sightings).toEqual([JUDGED]);
    expect(await b.table('qa_checked')).toEqual(SEEDED(SISTER_ORG));
  });

  it('`single` with a business `check`: the seam is installed and the member is UNSET, so a re-point is taken as before', async () => {
    const b = await boot('single');

    const { outcome, dropped } = await b.update('qa_checked', { id: 'r1', name: 'fine', organization_id: SISTER_ORG }, { context: MEMBER_CTX });

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([{ installed: true, judgesOrganization: undefined }]);
    expect(dropped).toEqual(READONLY_DROP);
    expect(await b.table('qa_checked'), 'the row keeps its organization').toEqual(SEEDED());
  });

  it('a platform operator crossing on a private object: no seam at all, and the re-point is taken as before', async () => {
    const b = await boot('group');

    const { outcome, dropped } = await b.update('qa_vault', byId(FOREIGN_ORG), { context: GROUP_ADMIN_CTX });

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([NO_SEAM]);
    expect(dropped).toEqual(READONLY_DROP);
    expect(await b.table('qa_vault')).toEqual(SEEDED());
  });

  it('a system context installs no seam, and stores what it sends', async () => {
    const b = await boot('group');

    const { outcome } = await b.update('qa_account', byId(FOREIGN_ORG), { context: SYS_CTX });

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([NO_SEAM]);
    expect(await b.table('qa_account')).toEqual(SEEDED(FOREIGN_ORG));
  });

  it('an ARRAY update payload: step 3.7 composes no seam for it, so nothing declares the organization judged, and nothing moves', async () => {
    const b = await boot('group');

    const { outcome } = await b.update('qa_account', [{ organization_id: SISTER_ORG }], { where: { id: 'r1' }, context: GROUP_CTX });

    expect(outcome.ok, 'an array payload is not a write the engine completes').toBe(false);
    expect(b.sightings).toEqual([NO_SEAM]);
    expect(await b.table('qa_account')).toEqual(SEEDED());
  });
});

describe('[#24822] the `sys_` scope: the update spare covers exactly the objects the insert spare covers', () => {
  it(`a tenant-scoped \`sys_\` object: step 3.7 sets the member, and the row still keeps its organization, reported as before`, async () => {
    const b = await boot('group');

    const viaId = await b.update(SYS_OBJECT, byId(SISTER_ORG), { context: GROUP_CTX });
    const viaPredicate = await b.update(SYS_OBJECT, { organization_id: SISTER_ORG }, predicateOptions(GROUP_CTX));
    const strict = await b.update(SYS_OBJECT, byId(SISTER_ORG), { context: GROUP_CTX, strictReadonlyWrites: true });

    expect(viaId.outcome.ok, viaId.outcome.message).toBe(true);
    expect(viaPredicate.outcome.ok, viaPredicate.outcome.message).toBe(true);
    expect(b.sightings, 'the wall judges the sys_ row and says so').toEqual([JUDGED, JUDGED, JUDGED]);
    expect(viaId.dropped).toEqual(READONLY_DROP);
    expect(viaPredicate.dropped).toEqual(READONLY_DROP);
    expect(strict.outcome.code, 'strict still refuses the strip it reports').toBe('ERR_READONLY_FIELD_REJECTED');
    expect(await b.table(SYS_OBJECT), 'the engine keeps the strip on a sys_ object').toEqual(SEEDED());
  });

  for (const [object, rowId] of [['sys_user_position', 'upos_grantee'], ['sys_user_permission_set', 'ups_grantee']] as const) {
    it(`${object}: a member's re-point is refused by the RBAC administration gate, as before`, async () => {
      const b = await boot('group');

      const { outcome } = await b.update(object, { id: rowId, organization_id: SISTER_ORG }, { context: GROUP_CTX });

      expect(outcome.ok).toBe(false);
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(outcome.status).toBe(403);
      expect(outcome.message).toContain('requires tenant-level administration');
      expect((await b.table(object)).find((row) => row.id === rowId)?.organization_id).toBe(OWN_ORG);
    });

    it(`${object}: the column is declared WRITABLE, so the strip never took it: an administrator's re-point meets the grant's own guards, as before`, async () => {
      const b = await boot('group');
      expect((b.engine.getSchema(object) as { fields?: Record<string, { readonly?: boolean }> })?.fields?.organization_id?.readonly, 'not read-only').not.toBe(true);

      const outside = await b.update(object, { id: rowId, organization_id: FOREIGN_ORG }, { context: GROUP_ADMIN_CTX });
      const inside = await b.update(object, { id: rowId, organization_id: SISTER_ORG }, { context: GROUP_ADMIN_CTX });

      expectWallRefusal(outside.outcome, object);
      expect(inside.outcome.ok, inside.outcome.message).toBe(true);
      expect(inside.dropped).toEqual([]);
      expect((await b.table(object)).find((row) => row.id === rowId)?.organization_id).toBe(SISTER_ORG);
    });
  }
});

/**
 * [#24822 · ADR-0090 D10] An ON-BEHALF-OF update whose CALLER crosses the wall
 * (a platform operator on a private object: its own Layer 0 is `null`) and
 * whose DELEGATOR is walled. Step 3.7's wall parts are then the delegator's
 * alone, so the seam judges the re-point against the delegator's wall and
 * declares it.
 */
describe('[#24822 · ADR-0090 D10] a delegated re-point by a crossing operator is held to the delegator\'s wall', () => {
  it('`group`: an organization the delegator holds is stored as sent, by id and by predicate, with nothing reported', async () => {
    const one = await boot('group');
    const viaId = await one.update('qa_vault', byId(SISTER_ORG), { context: OPERATOR_FOR_DELEGATOR });
    expect(viaId.outcome.ok, viaId.outcome.message).toBe(true);
    expect(viaId.dropped).toEqual([]);
    expect(one.sightings).toEqual([JUDGED]);
    expect(await one.table('qa_vault')).toEqual(SEEDED(SISTER_ORG));

    const two = await boot('group');
    const viaPredicate = await two.update('qa_vault', { organization_id: SISTER_ORG }, predicateOptions(OPERATOR_FOR_DELEGATOR));
    expect(viaPredicate.outcome.ok, viaPredicate.outcome.message).toBe(true);
    expect(await two.table('qa_vault')).toEqual(SEEDED(SISTER_ORG));
  });

  it('`group`: an organization the delegator does not hold is refused by the delegator\'s wall, and nothing moves', async () => {
    const b = await boot('group');

    const { outcome } = await b.update('qa_vault', byId(FOREIGN_ORG), { context: OPERATOR_FOR_DELEGATOR });

    expectWallRefusal(outcome, 'qa_vault');
    expect(await b.table('qa_vault')).toEqual(SEEDED());
  });

  it('`isolated`: the active organization is stored as sent and not reported; another one is refused', async () => {
    const b = await boot('isolated');

    const same = await b.update('qa_vault', byId(OWN_ORG), { context: OPERATOR_FOR_DELEGATOR });
    const other = await b.update('qa_vault', { id: 'r2', organization_id: SISTER_ORG }, { context: OPERATOR_FOR_DELEGATOR });

    expect(same.outcome.ok, same.outcome.message).toBe(true);
    expect(same.dropped).toEqual([]);
    expectWallRefusal(other.outcome, 'qa_vault');
    expect(await b.table('qa_vault')).toEqual(SEEDED());
  });
});
