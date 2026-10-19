// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24409] A migrate-and-exit boot (`OS_MIGRATE_AND_EXIT=1`) never provisions
 * the dev admin, whatever `NODE_ENV` says.
 *
 * ## The defect
 *
 * `objectstack serve` reads `OS_MIGRATE_AND_EXIT` only after the kernel
 * bootstrap, and the dev-admin seed runs on `kernel:ready`, inside that
 * bootstrap. So a migration run with `NODE_ENV=development` seeded exactly as
 * a dev boot does. A deploy pipeline that migrates with `NODE_ENV=development`
 * on purpose, against an empty database, left a known-credential login in it.
 * Measured on a real `os serve` migrate-and-exit boot of an empty SQLite file
 * before the fix: one `sys_user` row and one `sys_account` row.
 *
 * ## Where the disarm lives, and why this file pins two readers
 *
 * `isDevAdminSeedArmed()` is the one place both the seed and the walled owner
 * check ask, so the clause lives there. The first describe pins the function's
 * clauses. The second runs exactly what the seed's `kernel:ready` hook runs,
 * over a real engine on an empty store: the same boot seeds without the flag
 * (the control, so the empty result is not vacuous) and seeds nothing with it.
 * The third pins the walled check's reading of the same answer: on a migration
 * run the seed is not a verification path, in either direction.
 *
 * ⛔ No credential is named here. The pins count rows; they never read the
 * seeded address or password.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { AuthPlugin } from './auth-plugin.js';
import {
  WALLED_OWNER_NO_VERIFICATION_PATH,
  isDevAdminSeedArmed,
  resolveWalledOwnerVerificationPathWarning,
  type WalledOwnerAccountState,
} from './walled-owner-verification-path.js';

const SECRET = 'test-secret-at-least-32-chars-long-24409';
const SYSTEM = { context: { isSystem: true } } as never;
const OWNER = 'operator@walled.example';

const ENV_KEYS = [
  'NODE_ENV',
  'OS_MIGRATE_AND_EXIT',
  'OS_SEED_ADMIN',
  'OS_SEED_ADMIN_EMAIL',
  'OS_SEED_ADMIN_PASSWORD',
  'OS_SEED_ADMIN_NAME',
  'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED',
  'OS_PLATFORM_OWNER_EMAIL',
] as const;
let savedEnv: Record<string, string | undefined> = {};
const engines: ObjectQL[] = [];

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  // The consumer's shape: a migration step run with NODE_ENV=development on
  // purpose, and no OS_SEED_ADMIN.
  process.env.NODE_ENV = 'development';
});

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

/** An EMPTY store carrying the objects a plugin-auth deployment registers. */
async function bootEmptyEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return engine;
}

async function countRows(engine: ObjectQL, object: string): Promise<number> {
  const raw = await engine.find(object, { limit: 200 }, SYSTEM);
  return Array.isArray(raw) ? raw.length : 0;
}

/**
 * Run exactly what the seed's `kernel:ready` hook runs —
 * `AuthPlugin.maybeSeedDevAdmin` — over a real engine and a real
 * `AuthManager`, the way `dev-admin-seed-credential-gate.test.ts` reaches it.
 */
async function runSeedHook(engine: ObjectQL): Promise<AuthManager> {
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine as never,
  } as never);
  const noop = () => undefined;
  const ctx = {
    getService: (name: string) => (name === 'objectql' ? engine : undefined),
    logger: { info: noop, warn: noop, error: noop, debug: noop },
  } as unknown as PluginContext;
  const plugin = new AuthPlugin({ secret: SECRET });
  (plugin as unknown as { authManager: AuthManager }).authManager = manager;
  await (
    plugin as unknown as { maybeSeedDevAdmin(c: PluginContext): Promise<void> }
  ).maybeSeedDevAdmin(ctx);
  return manager;
}

describe('[#24409] isDevAdminSeedArmed() is never armed on a migrate-and-exit boot', () => {
  it('control: NODE_ENV=development with no OS_SEED_ADMIN is armed', () => {
    expect(isDevAdminSeedArmed()).toBe(true);
  });

  it('OS_MIGRATE_AND_EXIT=1 disarms it under NODE_ENV=development', () => {
    process.env.OS_MIGRATE_AND_EXIT = '1';
    expect(isDevAdminSeedArmed()).toBe(false);
  });

  it('the migrate-and-exit clause wins over an explicit OS_SEED_ADMIN=1', () => {
    process.env.OS_MIGRATE_AND_EXIT = '1';
    process.env.OS_SEED_ADMIN = '1';
    expect(isDevAdminSeedArmed()).toBe(false);
  });

  it('only the spelling serve exits on disarms it: a boot serve keeps running stays armed', () => {
    // `serve` compares `=== '1'`; any other value is a boot that goes on to
    // serve, so it is a dev boot and keeps its seed.
    for (const value of ['0', 'true', '']) {
      process.env.OS_MIGRATE_AND_EXIT = value;
      expect(isDevAdminSeedArmed(), `OS_MIGRATE_AND_EXIT=${JSON.stringify(value)}`).toBe(true);
    }
  });

  it('the existing clauses are unchanged: OS_SEED_ADMIN=0 is off, and so is any other NODE_ENV', () => {
    process.env.OS_SEED_ADMIN = '0';
    expect(isDevAdminSeedArmed()).toBe(false);
    delete process.env.OS_SEED_ADMIN;
    process.env.NODE_ENV = 'production';
    expect(isDevAdminSeedArmed()).toBe(false);
  });
});

describe('[#24409] a migrate-and-exit boot of an empty database creates no sys_user', () => {
  it('control: the same seed hook on an empty dev store provisions a login (armed and seeding)', async () => {
    const engine = await bootEmptyEngine();
    expect(await countRows(engine, 'sys_user')).toBe(0);

    const manager = await runSeedHook(engine);

    expect(await countRows(engine, 'sys_user')).toBe(1);
    expect(await countRows(engine, 'sys_account')).toBe(1);
    expect(manager.devSeedResult, 'the dev boot arms the banner hint').toBeTruthy();
  });

  it('with OS_MIGRATE_AND_EXIT=1 the seed hook leaves the empty store empty', async () => {
    process.env.OS_MIGRATE_AND_EXIT = '1';
    const engine = await bootEmptyEngine();

    const manager = await runSeedHook(engine);

    expect(await countRows(engine, 'sys_user')).toBe(0);
    expect(await countRows(engine, 'sys_account')).toBe(0);
    expect(manager.devSeedResult, 'no banner hint on a migration run').toBeFalsy();
  });
});

describe('[#24409] the walled owner check reads the same disarm', () => {
  const nothingWired = (ownerAccountState: WalledOwnerAccountState) =>
    ({ hasEmailTransport: false, hasFederatedSignIn: false, ownerAccountState }) as const;

  it('fresh walled store, seed address not the owner: the dev boot warns, the migration run does not', () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER;
    // Control: the armed seed would spend the first-account window on its own
    // address, so the dev boot is a dead end and says so.
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('no-human-users'))).toContain(
      WALLED_OWNER_NO_VERIFICATION_PATH,
    );
    // A migration run seeds nothing, so the operator's own first account is
    // still ahead: no seed in the way, nothing to warn about.
    process.env.OS_MIGRATE_AND_EXIT = '1';
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('no-human-users'))).toBeNull();
  });

  it('seed address IS the owner, store unknowable: the seed no longer counts as a verification path on a migration run', () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_SEED_ADMIN_EMAIL = OWNER;
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER;
    // Control: an armed seed for the owner's own address verifies it.
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('unknown'))).toBeNull();
    // On a migration run it provisions nothing, so it verifies nothing.
    process.env.OS_MIGRATE_AND_EXIT = '1';
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('unknown'))).toContain(
      WALLED_OWNER_NO_VERIFICATION_PATH,
    );
  });
});
