// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11663 L2 / cloud ADR-0024 D5.2] The break-glass guard's FIFTH write shape:
 * an ordinary `sys_user` profile write that moves the row off the deployment's
 * declared administrator list.
 *
 * The platform-admin re-anchor gave `resolveAuthzContext` a second anchor
 * beside the unscoped `admin_full_access` grant — a `sys_user` row whose own
 * `email` is on `OS_PLATFORM_OWNER_EMAIL` AND whose `email_verified` reads
 * verified. Two consequences this file pins, because they are the two halves of
 * one invariant and each is silently wrong without the other:
 *
 *  1. **The enumeration must SEE those administrators.** `resolveAdminUserIds`
 *     counts them through the resolver's own `matchesConfiguredPlatformAdmin`,
 *     so an environment whose only administrator is config-derived is not read
 *     as an environment with none.
 *  2. **The guard must JUDGE the writes that revoke them.** A change of address
 *     and an `email_verified` reset each take the standing away with no ban, no
 *     delete and no grant table touched — invisible to all four earlier halves.
 *
 * Same method as `last-admin-guard.test.ts` next door and for the same reason:
 * a REAL {@link ObjectQL} engine over better-sqlite3 `:memory:`, so the engine
 * dispatches the hook, the SQL builder compiles the `$in`, and sqlite decides
 * how the booleans come back (`email_verified` stores 0/1 here, which is
 * exactly the representation `isEmailVerifiedUserRow`'s allow-list exists for).
 * A fake engine would put the fixture, not the product, in charge of which rows
 * the guard sees.
 *
 * Reverse verification, recorded because the direction is not obvious: with
 * `registerLastAdminGuard` NOT called, every refusal below is a write that
 * SUCCEEDS — the row comes back with the new address, or with
 * `email_verified = 0`. The `unguarded` cases at the bottom re-run it on the
 * same fixtures rather than describing it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';

import { registerLastAdminGuard, USER_STANDING_KEYS, type LastAdminGuardEngine } from './last-admin-guard.js';

const ENV = 'OS_PLATFORM_OWNER_EMAIL';
const SYSTEM = { context: { isSystem: true } } as const;
const OWNER = 'owner@corp.example';
const SECOND = 'second@corp.example';

const sysUser = {
  name: 'sys_user',
  label: 'User',
  managedBy: 'better-auth',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    email: { name: 'email', type: 'text' as const },
    // The column the config anchor gates on. Declared `boolean`, so on this
    // real sqlite database it stores as 0/1.
    email_verified: { name: 'email_verified', type: 'boolean' as const },
    ai_access: { name: 'ai_access', type: 'boolean' as const },
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
function declare(value: string | undefined): void {
  if (value === undefined) delete process.env[ENV];
  else process.env[ENV] = value;
  resetPlatformAdminEmailMemo();
}

async function boot(opts: { unguarded?: boolean } = {}): Promise<ObjectQL> {
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
  if (!opts.unguarded) {
    registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, { packageId: 'test.last-admin-guard' });
  }
  return engine;
}

async function seedUser(
  engine: ObjectQL,
  id: string,
  email: string,
  verified: boolean,
): Promise<void> {
  await engine.insert(
    'sys_user',
    { id, name: id, email, email_verified: verified, banned: false },
    SYSTEM,
  );
}

async function readUser(engine: ObjectQL, id: string): Promise<Record<string, unknown> | undefined> {
  return (await engine.findOne(
    'sys_user',
    { where: { id }, fields: ['id', 'email', 'email_verified'] },
    SYSTEM,
  )) as Record<string, unknown> | undefined;
}

describe('[#11663 L2] the enumeration counts CONFIG-derived administrators', () => {
  it('an environment whose only administrator is config-derived is not "empty"', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    await seedUser(engine, 'usr_other', 'other@corp.example', true);

    // With the owner counted, deleting an ORDINARY user leaves an
    // administrator behind and is allowed. If the enumeration could not see
    // the config anchor it would read zero administrators here, and the
    // bootstrap exemption would wave every write through — the failure mode
    // #6084 already paid for once.
    await expect(engine.delete('sys_user', { where: { id: 'usr_other' }, ...SYSTEM })).resolves.toBeDefined();
    expect(await readUser(engine, 'usr_other')).toBeFalsy();

    // …and deleting the administrator themselves is refused.
    await expect(
      engine.delete('sys_user', { where: { id: 'usr_owner' }, ...SYSTEM }),
    ).rejects.toThrow(/last administrator/i);
    expect(await readUser(engine, 'usr_owner')).toBeTruthy();
  });

  it('an UNVERIFIED account holding the configured address is NOT counted', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, false);
    await seedUser(engine, 'usr_grant', 'granted@corp.example', true);
    await engine.insert('sys_permission_set', { id: 'ps_a', name: ADMIN_FULL_ACCESS, active: true }, SYSTEM);
    await engine.insert(
      'sys_user_permission_set',
      { id: 'ups_1', user_id: 'usr_grant', permission_set_id: 'ps_a' },
      SYSTEM,
    );

    // The grant holder is the ONLY administrator: the unverified owner confers
    // nothing, exactly as the resolver reads it. Deleting the grant holder must
    // therefore be refused — if the unverified row were miscounted, this write
    // would sail through and the environment would be left with nobody.
    await expect(
      engine.delete('sys_user', { where: { id: 'usr_grant' }, ...SYSTEM }),
    ).rejects.toThrow(/last administrator/i);
  });
});

describe('[#11663 L2] the FIFTH write shape is judged', () => {
  it('refuses a change of address that moves the last administrator off the list', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);

    await expect(
      engine.update('sys_user', { id: 'usr_owner', email: 'personal@example.com' }, SYSTEM),
    ).rejects.toThrow(/last administrator/i);
    expect((await readUser(engine, 'usr_owner'))?.email).toBe(OWNER);
  });

  it('refuses an email_verified reset on the last administrator', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);

    await expect(
      engine.update('sys_user', { id: 'usr_owner', email_verified: false }, SYSTEM),
    ).rejects.toThrow(/last administrator/i);
    // Still verified — the refusal has to leave the row as it was.
    expect((await readUser(engine, 'usr_owner'))?.email_verified).toBeTruthy();
  });

  it('names the CONFIGURATION as the remedy, not this guard', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    await expect(
      engine.update('sys_user', { id: 'usr_owner', email: 'personal@example.com' }, SYSTEM),
    ).rejects.toThrow(/OS_PLATFORM_OWNER_EMAIL/);
  });

  it('ALLOWS the same write while a second administrator survives it', async () => {
    declare(`${OWNER}, ${SECOND}`);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    await seedUser(engine, 'usr_second', SECOND, true);

    await expect(
      engine.update('sys_user', { id: 'usr_owner', email: 'personal@example.com' }, SYSTEM),
    ).resolves.toBeDefined();
    expect((await readUser(engine, 'usr_owner'))?.email).toBe('personal@example.com');
  });

  it('ALLOWS it when the same user also holds the legacy grant', async () => {
    // Standing that survives the write through the OTHER anchor is standing
    // that survives — the enumeration is one function over both.
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    await engine.insert('sys_permission_set', { id: 'ps_a', name: ADMIN_FULL_ACCESS, active: true }, SYSTEM);
    await engine.insert(
      'sys_user_permission_set',
      { id: 'ups_1', user_id: 'usr_owner', permission_set_id: 'ps_a' },
      SYSTEM,
    );

    await expect(
      engine.update('sys_user', { id: 'usr_owner', email_verified: false }, SYSTEM),
    ).resolves.toBeDefined();
  });

  it('costs NO reads for an ordinary profile write', async () => {
    // The cheap-path pin. A payload touching neither standing key provably
    // cannot move the enumeration, so `name` / `ai_access` edits — every
    // profile save in the product — never pay for one.
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    expect(USER_STANDING_KEYS).toEqual(['email', 'email_verified']);
    await expect(
      engine.update('sys_user', { id: 'usr_owner', name: 'Renamed', ai_access: true }, SYSTEM),
    ).resolves.toBeDefined();
  });

  it('is inert when the deployment declares no administrators', async () => {
    // Every deployment that has not adopted the config anchor sees this guard
    // behave exactly as it did: `emails` is empty, the enumeration reads no
    // `sys_user` rows for it, and there is no config-derived standing to lose.
    declare(undefined);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    await expect(
      engine.update('sys_user', { id: 'usr_owner', email: 'personal@example.com' }, SYSTEM),
    ).resolves.toBeDefined();
  });
});

describe('[#11663 L2] reverse verification — the same writes on an UNGUARDED engine', () => {
  it('a change of address succeeds and takes the standing with it', async () => {
    declare(OWNER);
    const engine = await boot({ unguarded: true });
    await seedUser(engine, 'usr_owner', OWNER, true);
    await expect(
      engine.update('sys_user', { id: 'usr_owner', email: 'personal@example.com' }, SYSTEM),
    ).resolves.toBeDefined();
    expect((await readUser(engine, 'usr_owner'))?.email).toBe('personal@example.com');
  });

  it('an email_verified reset succeeds', async () => {
    declare(OWNER);
    const engine = await boot({ unguarded: true });
    await seedUser(engine, 'usr_owner', OWNER, true);
    await expect(
      engine.update('sys_user', { id: 'usr_owner', email_verified: false }, SYSTEM),
    ).resolves.toBeDefined();
    expect((await readUser(engine, 'usr_owner'))?.email_verified).toBeFalsy();
  });
});
