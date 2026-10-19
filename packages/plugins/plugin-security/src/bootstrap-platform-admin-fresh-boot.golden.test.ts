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
import { SysUser, SysAccount, SysOrganization } from '@objectstack/platform-objects/identity';
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

/**
 * A fresh `:memory:` database holding the security plugin's own objects and the
 * identity tables — and the Default Organization a `single` boot creates before
 * any `kernel:ready` hook runs (ADR-0131 D3, plugin-auth's boot invariant),
 * which owns the promotion's grant (D5).
 */
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
    objects: [SysUser, SysAccount, SysOrganization, ...securityObjects],
  } as any);
  await engine.syncSchemas();
  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' }, SYS);
  engines.push(engine);
  return engine;
}

async function human(engine: ObjectQL, id: string, email: string, createdAt: string): Promise<void> {
  await engine.insert('sys_user', { id, email, name: id, created_at: createdAt }, SYS);
  await engine.insert('sys_account', { id: `acc_${id}`, user_id: id, account_id: email, provider_id: 'credential' }, SYS);
}

describe('[ADR-0131 D3/D4] a fresh single-posture database promotes its first human', () => {
  it('promotes the oldest account that can sign in, granting admin_full_access by name, owned by the Default Organization', async () => {
    const engine = await freshEngine();
    await human(engine, 'usr_first', 'first@fresh.example', '2026-01-01T00:00:00.000Z');
    await human(engine, 'usr_second', 'second@fresh.example', '2026-02-01T00:00:00.000Z');

    const report = await bootstrapPlatformAdmin(engine, defaultPermissionSets);

    expect(report).toMatchObject({ adminPromoted: true, adminUserId: 'usr_first' });
    const grants = (await engine.find('sys_user_permission_set', { where: {}, ...SYS })) as any[];
    // [ADR-0131 D5] The row is the Default Organization's — ⛔ never a NULL organization.
    expect(grants.map((g) => [g.user_id, g.permission_set, g.organization_id ?? null])).toEqual([
      ['usr_first', 'admin_full_access', 'org_default'],
    ]);
  });

  it('a second pass finds the administrator it promoted and promotes nobody else', async () => {
    const engine = await freshEngine();
    await human(engine, 'usr_first', 'first@fresh.example', '2026-01-01T00:00:00.000Z');
    expect((await bootstrapPlatformAdmin(engine, defaultPermissionSets)).adminPromoted).toBe(true);
    await human(engine, 'usr_later', 'later@fresh.example', '2026-03-01T00:00:00.000Z');

    const again = await bootstrapPlatformAdmin(engine, defaultPermissionSets);

    expect(again).toMatchObject({ adminPromoted: false, reason: 'already_have_admin', adminUserId: 'usr_first' });
    const grants = (await engine.find('sys_user_permission_set', { where: {}, ...SYS })) as any[];
    expect(grants).toHaveLength(1);
  });

  it('an upgraded database whose administrator\'s grant the ceremony gave the Default Organization promotes nobody else', async () => {
    // ADR-0131 D10 attributes a `single` database's organization-less grants to
    // the Default Organization. A holder scan reading only the NULL row found
    // nobody on such a database and minted a second grant on every boot.
    const engine = await freshEngine();
    await human(engine, 'usr_admin', 'admin@fresh.example', '2026-01-01T00:00:00.000Z');
    await human(engine, 'usr_older', 'older@fresh.example', '2025-01-01T00:00:00.000Z');
    await engine.insert('sys_user_permission_set', {
      id: 'ups_attributed', user_id: 'usr_admin', permission_set: 'admin_full_access', organization_id: 'org_default',
    }, SYS);

    const report = await bootstrapPlatformAdmin(engine, defaultPermissionSets);

    expect(report).toMatchObject({ adminPromoted: false, reason: 'already_have_admin', adminUserId: 'usr_admin' });
    const grants = (await engine.find('sys_user_permission_set', { where: {}, ...SYS })) as any[];
    expect(grants.map((g) => g.id)).toEqual(['ups_attributed']);
  });

  it('⛔ a database that names no Default Organization is not promoted, says so at error, and writes no grant', async () => {
    const engine = await freshEngine();
    await engine.insert('sys_organization', { id: 'org_second', name: 'Second', slug: 'second' }, SYS);
    await engine.update('sys_organization', { slug: 'first' }, { where: { id: 'org_default' }, ...SYS } as any);
    await human(engine, 'usr_first', 'first@fresh.example', '2026-01-01T00:00:00.000Z');
    const errors: string[] = [];

    const report = await bootstrapPlatformAdmin(engine, defaultPermissionSets, {
      logger: { info: () => {}, warn: () => {}, error: (m: string) => errors.push(m) },
    });

    expect(report).toMatchObject({ adminPromoted: false, reason: 'default_organization_unresolved' });
    expect(errors).toHaveLength(1);
    expect(await engine.find('sys_user_permission_set', { where: {}, ...SYS })).toEqual([]);
  });
});
