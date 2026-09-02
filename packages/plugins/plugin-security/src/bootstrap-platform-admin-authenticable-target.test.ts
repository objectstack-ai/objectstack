// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14348 — `bootstrapPlatformAdmin` (`single` posture) promotes the oldest
 * human that can AUTHENTICATE, not the oldest `sys_user` row.
 *
 * ## The population this file exists for
 *
 * An app that declares people in `defineStack({ data })` stores ordinary human
 * `sys_user` rows with **no `sys_account`** — a directory, not a set of logins.
 * The declarative seed is awaited inside `AppPlugin.start()`, which is kernel
 * Phase 2, so those rows are ALWAYS older than any account created by a
 * `kernel:ready` seed or a later sign-up. Before this change the promotion
 * ranked candidates by age alone, so on such an app the platform-admin grant
 * went to a row nobody can sign in as.
 *
 * That was not a code reading by the time this file was written. It was
 * measured on a driven composed boot through `@objectstack/verify`'s
 * `bootStack` (AppPlugin -> AuthPlugin -> SecurityPlugin, the registration
 * order `objectstack dev` uses), on `origin/main` at 1dcb995f:
 *
 *   - `admin_full_access` -> `person0@demo.example`, `has_sys_account: false`,
 *     with the entire `sys_account` table EMPTY;
 *   - `claimSeedOwnership` handed that same row both seeded business records
 *     (`ownershipClaimed: 2`);
 *   - a later REAL sign-up holding a `credential` account was never promoted —
 *     the replay answered `already_have_admin`.
 *
 * ## Why these cases live on a real engine
 *
 * The selector asks a second question of the database (`sys_account` by
 * `user_id`) that a hand-built fake would answer by construction. Booting the
 * REAL shipped declarations over a real better-sqlite3 driver — the same rig
 * `bootstrap-platform-admin-seeded-provenance.test.ts` established, and the
 * same wiring `security-plugin.ts` hands the seeder — keeps "has an account"
 * a genuine reading of stored rows.
 *
 * ## The boundary this file also pins (the reserved fork)
 *
 * The repair may only change which row a FRESH bootstrap promotes. Re-pointing
 * an already-granted platform admin is a permission-boundary act and is NOT
 * this change's to make. Case D pins the short-circuit that makes that true:
 * an existing human, org-less `admin_full_access` grant returns
 * `already_have_admin` BEFORE any target selection runs, so no deployment that
 * already has an admin can be moved by the new selector.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUser, SysAccount } from '@objectstack/platform-objects/identity';
import { bootstrapPlatformAdmin, shouldReplayBootstrapFor } from './bootstrap-platform-admin.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYSTEM_CTX = { isSystem: true };

const engines: ObjectQL[] = [];

afterEach(async () => {
  while (engines.length) {
    try {
      await engines.pop()?.destroy();
    } catch {
      /* noop */
    }
  }
});

/**
 * A fresh engine on its own `:memory:` database carrying the REAL identity and
 * RBAC declarations. `demo_task` stands in for an app's business object — it is
 * the surface `claimSeedOwnership` re-owns, and it is deliberately NOT
 * `sys_`-prefixed because that prefix is exactly what the claim skips.
 */
async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.security-objects',
    name: 'Security Objects',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysPermissionSet, SysUserPermissionSet, SysUser, SysAccount],
  } as any);
  engine.registerApp({
    id: 'com.example.seeded-app',
    name: 'Seeded App',
    version: '1.0.0',
    type: 'app',
    objects: [
      {
        name: 'demo_task',
        label: 'Demo Task',
        fields: {
          name: { type: 'text', label: 'Name' },
        },
      },
    ],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  return engine;
}

/**
 * A credential-less directory row — what `defineStack({ data })` produces for a
 * declared person. `created_at` is written explicitly so the age order under
 * test is stated by the fixture rather than inferred from insert timing.
 */
async function seedDirectoryPerson(
  engine: ObjectQL,
  id: string,
  email: string,
  createdAt: string,
): Promise<void> {
  await (engine as any).insert(
    'sys_user',
    { id, email, name: email.split('@')[0], created_at: createdAt },
    { context: SYSTEM_CTX },
  );
}

/** A row that CAN sign in: a `sys_user` plus a `sys_account` linked to it. */
async function seedLoginableUser(
  engine: ObjectQL,
  id: string,
  email: string,
  createdAt: string,
  providerId = 'credential',
): Promise<void> {
  await seedDirectoryPerson(engine, id, email, createdAt);
  await (engine as any).insert(
    'sys_account',
    {
      id: `acc_${id}`,
      user_id: id,
      account_id: email,
      provider_id: providerId,
    },
    { context: SYSTEM_CTX },
  );
}

async function findRows(engine: ObjectQL, object: string, where: any = {}): Promise<any[]> {
  const rows = await (engine as any).find(object, { where, limit: 100 }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : [];
}

async function adminGrantHolders(engine: ObjectQL): Promise<string[]> {
  const sets = await findRows(engine, 'sys_permission_set', { name: 'admin_full_access' });
  const adminPsId = sets[0]?.id;
  expect(adminPsId, 'ANTI-VACUITY: admin_full_access must have been seeded').toBeTruthy();
  const links = await findRows(engine, 'sys_user_permission_set', { permission_set_id: adminPsId });
  return links.map((l) => String(l.user_id));
}

function collectingLogger() {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  return {
    info,
    warn,
    error,
    logger: {
      info: (m: string) => info.push(m),
      warn: (m: string) => warn.push(m),
      error: (m: string) => error.push(m),
    },
  };
}

describe('#14348 — the promotion target is the oldest human that can AUTHENTICATE', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // A. The card's population: seeded people + one later account
  // ───────────────────────────────────────────────────────────────────────────

  it('promotes the later ACCOUNT holder over older credential-less directory rows', async () => {
    const engine = await boot();
    // Directory rows first, exactly as AppPlugin.start()'s seed leaves them.
    await seedDirectoryPerson(engine, 'usr_person0', 'person0@demo.example', '2026-01-01T00:00:00.000Z');
    await seedDirectoryPerson(engine, 'usr_person1', 'person1@demo.example', '2026-01-01T00:00:01.000Z');
    // The account arrives later — a kernel:ready dev-admin seed or a sign-up.
    await seedLoginableUser(engine, 'usr_login', 'admin@demo.example', '2026-02-01T00:00:00.000Z');

    // ANTI-VACUITY: the wrong answer must really be the OLDEST row, or this
    // case would pass for a reason that has nothing to do with the fix.
    const users = await findRows(engine, 'sys_user');
    const oldest = [...users].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )[0];
    expect(oldest.id).toBe('usr_person0');

    const { info, logger } = collectingLogger();
    const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

    expect(report.adminPromoted).toBe(true);
    expect(await adminGrantHolders(engine)).toEqual(['usr_login']);
    expect(info.join('\n')).toContain('first user promoted to platform admin: admin@demo.example');
  });

  it('hands the seeded business records to the ACCOUNT holder, not to the directory row', async () => {
    const engine = await boot();
    await seedDirectoryPerson(engine, 'usr_person0', 'person0@demo.example', '2026-01-01T00:00:00.000Z');
    await seedLoginableUser(engine, 'usr_login', 'admin@demo.example', '2026-02-01T00:00:00.000Z');
    // Seeded business rows carry no owner — the state `claimSeedOwnership`
    // re-owns. This is the second half of the harm: a wrong promotion target
    // also mis-assigns every seeded record.
    for (const name of ['Seeded Task A', 'Seeded Task B']) {
      await (engine as any).insert('demo_task', { name }, { context: SYSTEM_CTX });
    }

    const { logger } = collectingLogger();
    const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

    expect(report.adminPromoted).toBe(true);
    expect(report.ownershipClaimed).toBe(2);
    const tasks = await findRows(engine, 'demo_task');
    expect(tasks).toHaveLength(2);
    for (const task of tasks) {
      expect(task.owner_id).toBe('usr_login');
    }
  });

  it('counts a FEDERATED account as a login (any provider_id, not only credential)', async () => {
    // H2, pinned: narrowing "can authenticate" to `provider_id === 'credential'`
    // would refuse to promote the admin of an SSO-only deployment — the same
    // defect this card fixes, aimed at a different population.
    const engine = await boot();
    await seedDirectoryPerson(engine, 'usr_person0', 'person0@demo.example', '2026-01-01T00:00:00.000Z');
    await seedLoginableUser(engine, 'usr_sso', 'sso@demo.example', '2026-02-01T00:00:00.000Z', 'okta');

    const { logger } = collectingLogger();
    const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

    expect(report.adminPromoted).toBe(true);
    expect(await adminGrantHolders(engine)).toEqual(['usr_sso']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B. Control: an install where every row came from sign-up — UNCHANGED
  // ───────────────────────────────────────────────────────────────────────────

  it('CONTROL: with no seeded directory rows the oldest login is still promoted', async () => {
    const engine = await boot();
    await seedLoginableUser(engine, 'usr_first', 'first@demo.example', '2026-01-01T00:00:00.000Z');
    await seedLoginableUser(engine, 'usr_second', 'second@demo.example', '2026-01-02T00:00:00.000Z');

    const { logger } = collectingLogger();
    const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

    expect(report.adminPromoted).toBe(true);
    expect(await adminGrantHolders(engine)).toEqual(['usr_first']);
  });

  it('CONTROL: an empty user table still reports `no_users` and writes no grant', async () => {
    const engine = await boot();
    const { info, logger } = collectingLogger();
    const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

    expect(report.adminPromoted).toBe(false);
    expect(report.reason).toBe('no_users');
    expect(await adminGrantHolders(engine)).toEqual([]);
    expect(info.join('\n')).toContain('no human users yet');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C. Seeded people and NO account anywhere: promote NOBODY
  // ───────────────────────────────────────────────────────────────────────────

  it('writes NO grant row when human rows exist but none can authenticate', async () => {
    const engine = await boot();
    await seedDirectoryPerson(engine, 'usr_person0', 'person0@demo.example', '2026-01-01T00:00:00.000Z');
    await seedDirectoryPerson(engine, 'usr_person1', 'person1@demo.example', '2026-01-01T00:00:01.000Z');
    await (engine as any).insert('demo_task', { name: 'Seeded Task A' }, { context: SYSTEM_CTX });

    const { info, warn, error, logger } = collectingLogger();
    const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

    expect(report.adminPromoted).toBe(false);
    expect(report.reason).toBe('no_authenticable_user');
    // The whole point: nothing unusable is WRITTEN.
    expect(await adminGrantHolders(engine)).toEqual([]);
    // ...and the seeded records are not handed to a row nobody can sign in as.
    const tasks = await findRows(engine, 'demo_task');
    expect(tasks[0]?.owner_id ?? null).toBeNull();
    // H3: the existing "no target" register is kept. `info`, and NO new
    // error-level site through a published sink shape.
    expect(info.join('\n')).toContain('none can authenticate');
    expect(error).toEqual([]);
    expect(warn).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // D. THE RESERVED FORK — an existing grant is never moved
  // ───────────────────────────────────────────────────────────────────────────

  it('FORK GUARD: an existing admin grant short-circuits BEFORE selection, even on the wrong row', async () => {
    // The deployment this case describes is the one the old code created: the
    // grant sits on a non-loginable directory row, and a loginable account
    // exists alongside it. The new selector would prefer the account holder —
    // and must NOT get the chance. Moving an already-granted platform admin is
    // reserved to the maintainer; this change only fixes FRESH bootstraps.
    const engine = await boot();
    await seedDirectoryPerson(engine, 'usr_person0', 'person0@demo.example', '2026-01-01T00:00:00.000Z');
    await seedLoginableUser(engine, 'usr_login', 'admin@demo.example', '2026-02-01T00:00:00.000Z');

    // First pass under the OLD world's outcome: hand-write the legacy grant.
    const { logger: seedLogger } = collectingLogger();
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger: seedLogger });
    const sets = await findRows(engine, 'sys_permission_set', { name: 'admin_full_access' });
    const adminPsId = sets[0]?.id;
    // Reset to the legacy state: the grant belongs to the directory row.
    for (const link of await findRows(engine, 'sys_user_permission_set', {
      permission_set_id: adminPsId,
    })) {
      await (engine as any).delete('sys_user_permission_set', link.id, { context: SYSTEM_CTX });
    }
    await (engine as any).insert(
      'sys_user_permission_set',
      {
        id: 'ups_legacy',
        user_id: 'usr_person0',
        permission_set_id: adminPsId,
        organization_id: null,
      },
      { context: SYSTEM_CTX },
    );
    expect(await adminGrantHolders(engine)).toEqual(['usr_person0']);

    const { logger } = collectingLogger();
    const report = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { logger });

    expect(report.adminPromoted).toBe(false);
    expect(report.reason).toBe('already_have_admin');
    // Untouched: same holder, and no second grant row minted alongside it.
    expect(await adminGrantHolders(engine)).toEqual(['usr_person0']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // E. The replay trigger must follow the selection's INPUTS
  // ───────────────────────────────────────────────────────────────────────────

  describe('shouldReplayBootstrapFor — the trigger set equals the answer\'s inputs', () => {
    it('fires on a sys_account insert', () => {
      // Measured on a real composed boot: a sign-up writes `sys_user.insert`
      // and only THEN `sys_account.insert`. So the sys_user arm fires while the
      // registrant is still account-less — reading them non-promotable — and
      // without this arm the account arriving one write later would trigger
      // nothing at all, leaving a people-seeded app with no admin forever.
      expect(shouldReplayBootstrapFor({ object: 'sys_account', operation: 'insert' })).toBe(true);
      expect(shouldReplayBootstrapFor({ object: 'sys_account', operation: 'create' })).toBe(true);
    });

    it('still fires on a sys_user insert', () => {
      expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'insert' })).toBe(true);
      expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'create' })).toBe(true);
    });

    it('does NOT fire on updates or on unrelated objects', () => {
      expect(shouldReplayBootstrapFor({ object: 'sys_account', operation: 'update' })).toBe(false);
      expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update' })).toBe(false);
      expect(shouldReplayBootstrapFor({ object: 'sys_session', operation: 'insert' })).toBe(false);
      expect(shouldReplayBootstrapFor({ object: 'demo_task', operation: 'insert' })).toBe(false);
    });
  });

  it('the replay promotes the first login on a people-seeded app', async () => {
    // The end-to-end consequence of case C plus the widened trigger, driven the
    // way `security-plugin.ts`'s middleware drives it: bootstrap, then a login
    // arrives, then bootstrap again.
    const engine = await boot();
    await seedDirectoryPerson(engine, 'usr_person0', 'person0@demo.example', '2026-01-01T00:00:00.000Z');

    const first = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, {});
    expect(first.reason).toBe('no_authenticable_user');
    expect(await adminGrantHolders(engine)).toEqual([]);

    // The sign-up: user row, then account row (the measured order).
    await seedDirectoryPerson(engine, 'usr_late', 'late@demo.example', '2026-03-01T00:00:00.000Z');
    const afterUserInsert = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, {});
    expect(afterUserInsert.reason).toBe('no_authenticable_user');

    await (engine as any).insert(
      'sys_account',
      { id: 'acc_late', user_id: 'usr_late', account_id: 'late@demo.example', provider_id: 'credential' },
      { context: SYSTEM_CTX },
    );
    expect(shouldReplayBootstrapFor({ object: 'sys_account', operation: 'insert' })).toBe(true);

    const afterAccountInsert = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, {});
    expect(afterAccountInsert.adminPromoted).toBe(true);
    expect(await adminGrantHolders(engine)).toEqual(['usr_late']);
  });
});
