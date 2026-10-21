// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] The grant that names nothing, as each `plugin-auth` grant
 * reader treats it once the readers key on `sys_user_permission_set.permission_set`.
 *
 * A grant written before the name column existed carries `NULL` until the v18
 * ceremony's verified rewrite (`os migrate organization-ownership --apply`,
 * ADR-0131 D10) names it from the legacy `permission_set_id`, a column no
 * runtime declares any more (C7b). Each reader takes its fail-closed
 * direction:
 *
 * - **the last-administrator guard** counts no administrator through it, and
 *   reads it as evidence that the environment is NOT fresh — so the bootstrap
 *   window never opens on an environment whose administrator holds one;
 * - **the default-organization bootstrap** does not read it as the platform
 *   administrator: it confers an owner membership, and an unnamed grant
 *   confers nothing.
 *
 * And a write naming the retired id is refused as an undeclared field before
 * it moves anything.
 *
 * Real ObjectQL over the SQL driver with the real `SecurityPlugin` (its objects
 * and its name hooks); a grant is unnamed by writing `NULL` with the name hooks
 * unbound, the state the ceremony's rewrite finds.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SecurityPlugin, bootstrapPlatformAdmin } from '@objectstack/plugin-security';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';

import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { ensureDefaultOrganization } from './ensure-default-organization.js';
import { seedLegacyPlatformBucket } from './__tests__/legacy-catalog-rows.testkit.js';
import { withLegacyPermissionSetTable } from './__tests__/legacy-catalog-objects.testkit.js';
import { relaxEveryRegisteredTenantColumn } from './pre-18-tenant-column.testkit.js';

const SYS = { context: { isSystem: true } } as any;
const GUARD_PACKAGE = 'test.grant-readers-unnamed';

function registerGuard(engine: ObjectQL): void {
  registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, {
    packageId: GUARD_PACKAGE,
    logger: { info: () => undefined, warn: () => undefined },
  });
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  resetPlatformAdminEmailMemo();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Rig {
  engine: ObjectQL;
}

/** `single` posture; the first user is promoted to platform administrator — the sole administrator. */
async function soleGrantAnchoredAdmin(): Promise<Rig> {
  resetPlatformAdminEmailMemo();
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engines.push(engine);
  let manifest: { objects?: unknown[]; permissions?: unknown[] } = {};
  const services: Record<string, unknown> = {
    manifest: { register: (m: any) => { manifest = m; } },
    objectql: engine,
    metadata: {
      // [ADR-0131 D3/D4] The bootstrap sets the manifest ships are the
      // catalog's `permission` definitions — what the security catalog the
      // plugin binds at `start()` resolves a grant's set name to.
      get: async (type: string, name: string) =>
        type === 'permission'
          ? ((manifest.permissions as any[]) ?? []).find((p) => p?.name === name) ?? null
          : engine.getSchema(name) ?? null,
      list: async (type?: string) =>
        type === undefined || type === 'permission' ? [...((manifest.permissions as unknown[]) ?? [])] : [],
    },
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
  engine.registerApp({
    id: 'com.objectstack.qa.grant-readers-unnamed-auth',
    name: 'Grant readers — unnamed grant (auth)',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    // The retired `sys_permission_set` table too: an existing database still
    // holds its platform-bucket rows (C3 stage 8 retires the object).
    objects: withLegacyPermissionSetTable([
      SysUser, SysAccount, SysMember, SysOrganization,
      ...(manifest.objects ?? []).filter((o: any) =>
        ['sys_position', 'sys_user_position', 'sys_permission_set', 'sys_position_permission_set', 'sys_user_permission_set']
          .includes(o?.name)),
    ]),
  } as any);
  await engine.syncSchemas();
  // The organization-less rows below (global sets, grants, identities) exist
  // only on a store built before 18.x (ADR-0131 D1 makes a fresh tenant column
  // NOT NULL): this is that store.
  await relaxEveryRegisteredTenantColumn(engine);
  // [ADR-0131 D3/D5] The Default Organization a `single` boot creates before
  // `kernel:ready` (AuthPlugin's invariant); it owns the promotion's grant.
  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' }, SYS);
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  registerGuard(engine);
  for (const [id, createdAt] of [['usr_admin', '2025-01-01T00:00:00.000Z'], ['usr_member', '2025-03-01T00:00:00.000Z']]) {
    await engine.insert(
      'sys_user', { id, email: `${id}@un.example`, name: id, created_at: createdAt, email_verified: true, banned: false }, SYS,
    );
    await engine.insert(
      'sys_account', { id: `acc_${id}`, user_id: id, account_id: `${id}@un.example`, provider_id: 'credential' }, SYS,
    );
  }
  // An existing database: the platform-bucket rows an earlier release seeded.
  await seedLegacyPlatformBucket(engine, (manifest.permissions ?? []) as any[]);
  const boot = await bootstrapPlatformAdmin(engine, (manifest.permissions ?? []) as any[]);
  expect(boot).toMatchObject({ adminPromoted: true });
  return { engine };
}

const adminGrant = async (engine: ObjectQL): Promise<any> =>
  ((await engine.find('sys_user_permission_set', { where: { user_id: 'usr_admin' }, ...SYS })) as any[])[0];

/**
 * The state of a legacy grant the ceremony's rewrite has not named. Written past both
 * hooks that would refuse it: the name hooks, and the guard itself — clearing
 * the sole administrator's grant name takes the standing away, which the guard
 * refuses like any other revocation. The guard is bound again afterwards.
 */
async function unnameAdminGrant(engine: ObjectQL): Promise<void> {
  // Beneath the engine: it refuses clearing a required name (ADR-0131 D4), and
  // the guard refuses taking the standing away.
  const driver: any = (engine as any).getDriver('sys_user_permission_set');
  await driver.knex('sys_user_permission_set').where({ user_id: 'usr_admin' }).update({ permission_set: null });
  expect((await adminGrant(engine)).permission_set ?? null).toBeNull();
}

const ban = (engine: ObjectQL, id: string) => engine.update('sys_user', { id, banned: true }, SYS);

describe('[ADR-0131 D4] a grant that names nothing — the last-administrator guard', () => {
  it('control — named, the grant is the last administrator: banning its holder is refused', async () => {
    const { engine } = await soleGrantAnchoredAdmin();
    expect((await adminGrant(engine)).permission_set).toBe('admin_full_access');
    await expect(ban(engine, 'usr_admin')).rejects.toThrow(/last administrator/i);
  });

  it('unnamed, it counts no administrator but is evidence: the bootstrap window does not open', async () => {
    const { engine } = await soleGrantAnchoredAdmin();
    await unnameAdminGrant(engine);
    await expect(ban(engine, 'usr_admin')).rejects.toThrow(/not the bootstrap window/i);
    await expect(ban(engine, 'usr_admin')).rejects.toThrow(/no permission-set name yet/);
    await expect(ban(engine, 'usr_member')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('clearing the sole administrator’s grant name is refused — the name is what the standing rides on', async () => {
    const { engine } = await soleGrantAnchoredAdmin();
    const grant = await adminGrant(engine);
    await expect(engine.update('sys_user_permission_set', { id: grant.id, permission_set: null }, SYS))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect((await adminGrant(engine)).permission_set).toBe('admin_full_access');
  });

  it('writing the retired id is refused 400 INVALID_FIELD (C7b) and moves no standing', async () => {
    const { engine } = await soleGrantAnchoredAdmin();
    const grant = await adminGrant(engine);
    let refused: any;
    try {
      await engine.update('sys_user_permission_set', { id: grant.id, permission_set_id: 'ps_viewer', reason: 'renewed' }, SYS);
    } catch (e) {
      refused = e;
    }
    expect([refused?.code, refused?.status]).toEqual(['INVALID_FIELD', 400]);
    expect(await adminGrant(engine)).toMatchObject({ permission_set: 'admin_full_access' });
    expect((await adminGrant(engine)).reason ?? null).not.toBe('renewed');
  });
});

describe('[ADR-0131 D4] a grant that names nothing — the default-organization bootstrap', () => {
  it('control — named, the grant holder is bound as the Default Organization owner', async () => {
    const { engine } = await soleGrantAnchoredAdmin();
    const res = await ensureDefaultOrganization(engine as any, { logger: { info: () => undefined, warn: () => undefined } });
    expect(res.memberCreated).toBe(true);
  });

  it('unnamed, nobody is read as the platform administrator: `no_admin`, nothing is bound', async () => {
    const { engine } = await soleGrantAnchoredAdmin();
    await unnameAdminGrant(engine);
    const res = await ensureDefaultOrganization(engine as any, { logger: { info: () => undefined, warn: () => undefined } });
    expect(res).toMatchObject({ memberCreated: false, reason: 'no_admin' });
    expect(await engine.find('sys_member', { where: { user_id: 'usr_admin' }, ...SYS })).toEqual([]);
  });
});
