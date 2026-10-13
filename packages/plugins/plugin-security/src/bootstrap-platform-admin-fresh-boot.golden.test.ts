// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A fresh `single`-posture database promotes its first human — on an engine
 * that carries exactly the objects the security plugin registers, and nothing
 * an earlier release left behind.
 *
 * The bootstrap's "already have an administrator?" question has a leg for a
 * grant written before `sys_user_permission_set.permission_set` existed (it
 * names nothing yet, so the by-name legs cannot see it; ADR-0131 D4). That leg
 * used to reach such a grant through the legacy `admin_full_access` catalog
 * row, read with "refused is not absent": a read that threw withheld the
 * promotion. Once the catalog row objects are retired (ADR-0131 D3, C3 stage 8)
 * a read of that row throws on EVERY boot, so a leg that still asked it would
 * withhold the first administrator from every fresh deployment, forever. This
 * suite registers the plugin's own objects only — no legacy table — so that
 * regression is a red here.
 *
 * Its counterpart, the grant that names nothing and must still keep a second
 * administrator from being minted, is pinned in
 * `grant-readers-unnamed-grant.test.ts`.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SysUser, SysAccount } from '@objectstack/platform-objects/identity';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import { securityObjects } from './manifest.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { context: { isSystem: true } } as const;
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const POSTURE_ENV = 'OS_TENANCY_POSTURE';

const engines: ObjectQL[] = [];

beforeEach(() => {
  delete process.env[OWNER_ENV];
  delete process.env[POSTURE_ENV];
  resetPlatformAdminEmailMemo();
});

afterEach(async () => {
  while (engines.length) {
    try {
      await engines.pop()?.destroy();
    } catch {
      /* noop */
    }
  }
  resetPlatformAdminEmailMemo();
});

/** A fresh `:memory:` database holding the security plugin's own objects and the identity tables. */
async function freshEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.fresh-boot-promotion',
    name: 'Fresh boot promotion',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUser, SysAccount, ...securityObjects],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  return engine;
}

async function human(engine: ObjectQL, id: string, email: string, createdAt: string): Promise<void> {
  await engine.insert('sys_user', { id, email, name: id, created_at: createdAt }, SYS);
  await engine.insert('sys_account', { id: `acc_${id}`, user_id: id, account_id: email, provider_id: 'credential' }, SYS);
}

describe('[ADR-0131 D3/D4] a fresh single-posture database promotes its first human', () => {
  it('promotes the oldest account that can sign in, granting admin_full_access by name', async () => {
    const engine = await freshEngine();
    await human(engine, 'usr_first', 'first@fresh.example', '2026-01-01T00:00:00.000Z');
    await human(engine, 'usr_second', 'second@fresh.example', '2026-02-01T00:00:00.000Z');

    const report = await bootstrapPlatformAdmin(engine, defaultPermissionSets);

    expect(report).toMatchObject({ adminPromoted: true, adminUserId: 'usr_first' });
    const grants = (await engine.find('sys_user_permission_set', { where: {}, ...SYS })) as any[];
    expect(grants.map((g) => [g.user_id, g.permission_set, g.organization_id ?? null])).toEqual([
      ['usr_first', 'admin_full_access', null],
    ]);
  });

  it('a second pass finds the administrator it promoted and promotes nobody else', async () => {
    const engine = await freshEngine();
    await human(engine, 'usr_first', 'first@fresh.example', '2026-01-01T00:00:00.000Z');
    expect((await bootstrapPlatformAdmin(engine, defaultPermissionSets)).adminPromoted).toBe(true);
    await human(engine, 'usr_later', 'later@fresh.example', '2026-03-01T00:00:00.000Z');

    const again = await bootstrapPlatformAdmin(engine, defaultPermissionSets);

    expect(again).toMatchObject({ adminPromoted: false, reason: 'already_have_admin', adminUserId: 'usr_first' });
  });
});
