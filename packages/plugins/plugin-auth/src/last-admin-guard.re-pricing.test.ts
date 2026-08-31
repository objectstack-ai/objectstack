// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11973 / #11663 migration step 5] The last-admin-guard RE-PRICING pins —
 * the reviewed step's evidence, direction by direction.
 *
 * The re-anchor left this guard's refusal SET untouched in code, and these
 * pins are what make that a measured verdict instead of an assumption: every
 * refusal is the output of the one `resolveAdminUserIds` enumeration, so
 * teaching the enumeration the config anchor (#11663 L2) re-priced the
 * refusals mechanically. Two directions, both load-bearing:
 *
 *  - **OBSOLETE where the config anchor stands.** Deleting, renaming or
 *    deactivating the `admin_full_access` `sys_permission_set` row — write
 *    shape (4), which used to un-make every platform admin in one write — no
 *    longer empties a population that contains a config-anchored
 *    administrator, so those writes are PERMITTED there. Same for deleting
 *    the legacy grant row itself.
 *  - **KEPT where the grant anchor is load-bearing.** With no declared
 *    administrators (`single` posture under Choice 4A, and P5's honoured
 *    legacy window) the identical writes still take the last administrator
 *    away and are still REFUSED. These counter-pins are what go red if a
 *    re-pricing edit — or the L3 re-point next door — ever leaks into the
 *    grant-anchored branch.
 *
 * Method as in `last-admin-guard.config-anchor.test.ts` (and for the same
 * reason): a REAL ObjectQL engine over better-sqlite3 `:memory:`, so the
 * engine dispatches the hooks and the store decides how booleans come back.
 *
 * Reverse verification, recorded: each PERMITTED pin asserts the write's
 * effect landed (row gone / column moved), so a guard that refused it — the
 * pre-re-anchor price — fails the test rather than merely logging.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';

import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';

const ENV = 'OS_PLATFORM_OWNER_EMAIL';
const SYSTEM = { context: { isSystem: true } } as const;
const OWNER = 'owner@corp.example';

const sysUser = {
  name: 'sys_user',
  label: 'User',
  managedBy: 'better-auth',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    email: { name: 'email', type: 'text' as const },
    email_verified: { name: 'email_verified', type: 'boolean' as const },
    banned: { name: 'banned', type: 'boolean' as const, readonly: true },
  },
};

const sysMember = {
  name: 'sys_member',
  label: 'Member',
  managedBy: 'better-auth',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    role: { name: 'role', type: 'text' as const },
  },
};

const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    label: { name: 'label', type: 'text' as const },
    active: { name: 'active', type: 'boolean' as const },
  },
};

const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    valid_from: { name: 'valid_from', type: 'datetime' as const },
    valid_until: { name: 'valid_until', type: 'datetime' as const },
  },
};

let engines: ObjectQL[] = [];
let ambient: string | undefined;

beforeEach(() => {
  ambient = process.env[ENV];
  delete process.env[ENV];
  resetPlatformAdminEmailMemo();
});

afterEach(async () => {
  if (ambient === undefined) delete process.env[ENV];
  else process.env[ENV] = ambient;
  resetPlatformAdminEmailMemo();
  const open = engines;
  engines = [];
  for (const e of open) {
    try { await e.destroy(); } catch { /* noop */ }
  }
});

/** Declare the deployment's administrators and drop the memo keyed on the raw value. */
function declare(value: string): void {
  process.env[ENV] = value;
  resetPlatformAdminEmailMemo();
}

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const o of [sysUser, sysMember, sysPermissionSet, sysUserPermissionSet]) {
    engine.registry.registerObject(o as never);
  }
  await engine.syncSchemas();
  registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, { packageId: 'test.last-admin-guard-re-pricing' });
  return engine;
}

/**
 * A grant-anchored administrator: verified user + active `admin_full_access`
 * row + an unscoped in-window grant. The pre-re-anchor shape of "the last
 * platform admin".
 */
async function seedGrantAdmin(engine: ObjectQL, userId = 'usr_grant'): Promise<void> {
  await engine.insert(
    'sys_user',
    { id: userId, name: userId, email: `${userId}@corp.example`, email_verified: true, banned: false },
    SYSTEM,
  );
  await engine.insert('sys_permission_set', { id: 'ps_admin', name: ADMIN_FULL_ACCESS, active: true }, SYSTEM);
  await engine.insert(
    'sys_user_permission_set',
    { id: 'ups_admin', user_id: userId, permission_set_id: 'ps_admin' },
    SYSTEM,
  );
}

/** A config-anchored administrator: a verified `sys_user` row on the declared list. */
async function seedConfigAdmin(engine: ObjectQL, userId = 'usr_owner'): Promise<void> {
  await engine.insert(
    'sys_user',
    { id: userId, name: userId, email: OWNER, email_verified: true, banned: false },
    SYSTEM,
  );
}

async function findOne(engine: ObjectQL, object: string, id: string): Promise<unknown> {
  return engine.findOne(object, { where: { id } }, SYSTEM);
}

describe('[#11973] OBSOLETE refusals — shape-(4) writes are permitted while a config-anchored administrator stands', () => {
  it('DELETING the admin_full_access row is permitted, and lands', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedConfigAdmin(engine);
    await seedGrantAdmin(engine); // the row also carries a live grant — still not the last anchor

    await expect(
      engine.delete('sys_permission_set', { where: { id: 'ps_admin' }, ...SYSTEM }),
    ).resolves.toBeDefined();
    expect(await findOne(engine, 'sys_permission_set', 'ps_admin')).toBeFalsy();
  });

  it('DEACTIVATING it (ADR-0049 spelling) is permitted, and lands', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedConfigAdmin(engine);
    await seedGrantAdmin(engine);

    await engine.update('sys_permission_set', { id: 'ps_admin', active: false }, SYSTEM);
    const row = (await findOne(engine, 'sys_permission_set', 'ps_admin')) as { active?: unknown };
    expect(row?.active).toBeFalsy();
  });

  it('RENAMING it is permitted, and lands', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedConfigAdmin(engine);
    await seedGrantAdmin(engine);

    await engine.update('sys_permission_set', { id: 'ps_admin', name: 'renamed_away' }, SYSTEM);
    const row = (await findOne(engine, 'sys_permission_set', 'ps_admin')) as { name?: unknown };
    expect(row?.name).toBe('renamed_away');
  });

  it('deleting the LAST legacy grant row is permitted, and lands', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedConfigAdmin(engine);
    await seedGrantAdmin(engine);

    await expect(
      engine.delete('sys_user_permission_set', { where: { id: 'ups_admin' }, ...SYSTEM }),
    ).resolves.toBeDefined();
    expect(await findOne(engine, 'sys_user_permission_set', 'ups_admin')).toBeFalsy();
  });
});

describe('[#11973] KEPT refusals — the same writes still refuse where the grant anchor is load-bearing (Choice 4A / P5)', () => {
  it('with NO declared administrators, deleting the admin_full_access row is still refused', async () => {
    const engine = await boot(); // ENV cleared in beforeEach — the `single` shape
    await seedGrantAdmin(engine);

    await expect(
      engine.delete('sys_permission_set', { where: { id: 'ps_admin' }, ...SYSTEM }),
    ).rejects.toThrow(/administrator/i);
    expect(await findOne(engine, 'sys_permission_set', 'ps_admin')).toBeTruthy();
  });

  it('…deactivating it is still refused', async () => {
    const engine = await boot();
    await seedGrantAdmin(engine);

    await expect(
      engine.update('sys_permission_set', { id: 'ps_admin', active: false }, SYSTEM),
    ).rejects.toThrow(/administrator/i);
    const row = (await findOne(engine, 'sys_permission_set', 'ps_admin')) as { active?: unknown };
    expect(row?.active).toBeTruthy();
  });

  it('…renaming it is still refused', async () => {
    const engine = await boot();
    await seedGrantAdmin(engine);

    await expect(
      engine.update('sys_permission_set', { id: 'ps_admin', name: 'renamed_away' }, SYSTEM),
    ).rejects.toThrow(/administrator/i);
    const row = (await findOne(engine, 'sys_permission_set', 'ps_admin')) as { name?: unknown };
    expect(row?.name).toBe(ADMIN_FULL_ACCESS);
  });

  it('…deleting the last grant row is still refused', async () => {
    const engine = await boot();
    await seedGrantAdmin(engine);

    await expect(
      engine.delete('sys_user_permission_set', { where: { id: 'ups_admin' }, ...SYSTEM }),
    ).rejects.toThrow(/administrator/i);
    expect(await findOne(engine, 'sys_user_permission_set', 'ups_admin')).toBeTruthy();
  });

  it('a DECLARED-but-unverified account does not re-price anything — the refusal holds', async () => {
    declare(OWNER);
    const engine = await boot();
    // The declared address exists but is NOT verified: it confers nothing at
    // the derivation site, so it must relax nothing here either.
    await engine.insert(
      'sys_user',
      { id: 'usr_owner', name: 'usr_owner', email: OWNER, email_verified: false, banned: false },
      SYSTEM,
    );
    await seedGrantAdmin(engine);

    await expect(
      engine.delete('sys_permission_set', { where: { id: 'ps_admin' }, ...SYSTEM }),
    ).rejects.toThrow(/administrator/i);
  });
});
