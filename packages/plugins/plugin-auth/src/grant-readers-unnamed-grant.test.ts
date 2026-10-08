// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] The grant that names nothing, as each `plugin-auth` grant
 * reader treats it once the readers key on `sys_user_permission_set.permission_set`.
 *
 * A grant written before the name column existed carries `NULL` until the
 * one-time backfill (`plugin-security`, `kernel:bootstrapped`) names it; on an
 * upgraded deployment's first boot every grant is unnamed when the
 * `kernel:ready` passes run, and the backfill leaves some unnamed for good (an
 * id with no set row, or a set row of another organization). Each reader takes
 * its fail-closed direction:
 *
 * - **the last-administrator guard** counts no administrator through it, and
 *   reads it as evidence that the environment is NOT fresh — so the bootstrap
 *   window never opens on an environment whose administrator holds one;
 * - **the default-organization bootstrap** does not read it as the platform
 *   administrator: it confers an owner membership, and an unnamed grant
 *   confers nothing.
 *
 * And the guard's simulation of a write that re-points a grant's id without
 * its name: the platform derives that name after the guard runs, so the guard
 * reads it as taking the standing away — while an id echoed unchanged keeps it.
 *
 * Real ObjectQL over the SQL driver with the real `SecurityPlugin` (its objects
 * and its name hooks); a grant is unnamed by writing `NULL` with the name hooks
 * unbound, the state the backfill leaves.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SecurityPlugin, bootstrapPlatformAdmin } from '@objectstack/plugin-security';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';

import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { ensureDefaultOrganization } from './ensure-default-organization.js';

const SYS = { context: { isSystem: true } } as any;
const NAME_HOOKS = 'plugin-security:grant-permission-set-name';
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
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [...((manifest.permissions as unknown[]) ?? [])],
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
    objects: [
      SysUser, SysAccount, SysMember, SysOrganization,
      ...(manifest.objects ?? []).filter((o: any) =>
        ['sys_position', 'sys_user_position', 'sys_permission_set', 'sys_position_permission_set', 'sys_user_permission_set']
          .includes(o?.name)),
    ],
  } as any);
  await engine.syncSchemas();
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
  const boot = await bootstrapPlatformAdmin(engine, (manifest.permissions ?? []) as any[]);
  expect(boot).toMatchObject({ adminPromoted: true });
  return { engine };
}

const adminGrant = async (engine: ObjectQL): Promise<any> =>
  ((await engine.find('sys_user_permission_set', { where: { user_id: 'usr_admin' }, ...SYS })) as any[])[0];

/**
 * The state the backfill leaves on a grant it has not named. Written past both
 * hooks that would refuse it: the name hooks, and the guard itself — clearing
 * the sole administrator's grant name takes the standing away, which the guard
 * refuses like any other revocation. The guard is bound again afterwards.
 */
async function unnameAdminGrant(engine: ObjectQL): Promise<void> {
  (engine as any).unregisterHooksByPackage(NAME_HOOKS);
  (engine as any).unregisterHooksByPackage(GUARD_PACKAGE);
  await engine.update('sys_user_permission_set', { permission_set: null }, { where: { user_id: 'usr_admin' }, multi: true, ...SYS });
  registerGuard(engine);
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

  it('re-pointing the sole administrator’s grant by id is read as taking the standing away', async () => {
    const { engine } = await soleGrantAnchoredAdmin();
    const grant = await adminGrant(engine);
    const [viewer] = (await engine.find('sys_permission_set', { where: { name: 'viewer_readonly' }, ...SYS })) as any[];
    await expect(engine.update('sys_user_permission_set', { id: grant.id, permission_set_id: viewer.id }, SYS))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect((await adminGrant(engine)).permission_set).toBe('admin_full_access');
  });

  it('echoing the grant’s own id keeps the standing: the write is permitted', async () => {
    const { engine } = await soleGrantAnchoredAdmin();
    const grant = await adminGrant(engine);
    await engine.update(
      'sys_user_permission_set',
      { id: grant.id, permission_set_id: grant.permission_set_id, reason: 'renewed' },
      SYS,
    );
    expect((await adminGrant(engine)).reason).toBe('renewed');
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
