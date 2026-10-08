// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The seed-ownership claim runs whenever a seed settles, on EVERY boot — the
 * first one and every later one.
 *
 * ## The defect these pins are written against
 *
 * The claim reached rows by two doors: `promote()` (inside the bootstrap that
 * runs at `kernel:ready`) and the `app:seeded` handler. On a later boot both
 * stayed shut for an in-budget seed replay:
 *
 *  - the bootstrap found the existing admin (`already_have_admin`), promoted
 *    nobody and never reached the claim;
 *  - the `app:seeded` handler read the target only from that bootstrap, and an
 *    in-budget seed settles inside `AppPlugin.start()` — BEFORE `kernel:ready`
 *    — so it returned with nobody to claim to;
 *  - and on a composition that registers the app before this plugin, the
 *    handler was not even subscribed yet: it subscribed in `start()`.
 *
 * So every row a later boot's seed replay inserted stayed `owner_id IS NULL`
 * for good — invisible to every `readScope: 'own'` grant. Measured on this
 * branch's base with the rig below (one SQLite file, two boots, a replay that
 * re-inserts one deleted seed row, one planted null): 2 ownerless rows after
 * `app:seeded` in every in-budget order, 0 only when the seed settled after
 * `kernel:ready`.
 *
 * ## Why a real engine over a real file, booted twice
 *
 * "Warm boot" is a property of a DATABASE that outlives the process: the grant
 * row the first boot minted is what the second boot's claim has to find. A
 * hand-built double would answer that read by construction. Each boot here is
 * a fresh `ObjectQL` + `SqlDriver` (better-sqlite3) over the same file and a
 * fresh `SecurityPlugin`, and the kernel's phases are driven in the order the
 * kernel runs them: every `init()`, then each `start()` in registration order,
 * then `kernel:ready`. Where `app:seeded` lands among those is the variable
 * each case sets.
 *
 * The first-boot path (`claim-seed-ownership-seed-settle-rerun.test.ts`) is
 * the control and stays as it is; the first boot below re-measures it on the
 * real engine before every warm boot.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUser, SysAccount, SysOrganization, SysMember } from '@objectstack/platform-objects/identity';
import { SEED_SETTLEMENT_SERVICE } from '@objectstack/spec/contracts';
import { SecurityPlugin } from './security-plugin.js';
import { securityObjects } from './manifest.js';
import { findExistingPlatformAdmin } from './bootstrap-platform-admin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { context: { isSystem: true } } as any;
const ADMIN = 'usr_admin_human';
const OTHER = 'usr_someone_else';
const APP = { appId: 'com.example.crm', overBudget: false };

/** A business object the claim walks: it declares the canonical `owner_id`. */
const CASE: any = {
  name: 'crm_case',
  label: 'Case',
  fields: {
    id: { type: 'text', label: 'Id', primary: true },
    name: { type: 'text', label: 'Name' },
    owner_id: { type: 'text', label: 'Owner' },
  },
};

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) {
    try {
      await cleanups.pop()!();
    } catch {
      /* noop */
    }
  }
});

/** A fresh database file that outlives every boot of one case. */
function databaseFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-claim-warm-boot-'));
  cleanups.unshift(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'boot.sqlite');
}

/** One process's engine over `file`, with the REAL shipped declarations. */
async function openEngine(file: string): Promise<any> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.example.claim-warm-boot',
    name: 'Claim warm boot',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [...securityObjects, SysUser, SysAccount, SysOrganization, SysMember, CASE],
  } as any);
  await engine.syncSchemas();
  cleanups.push(() => engine.destroy());
  await ensureDefaultOrganization(engine);
  return engine;
}

/**
 * [ADR-0131 D3] Every `single` boot finds or creates the Default Organization
 * before any seed settles — the auth plugin's boot invariant, which this
 * plugin-only rig does not compose. Spelled here with the columns the invariant
 * writes, so the rig gains no dependency edge onto `@objectstack/plugin-auth`.
 * It runs on EVERY boot, as the invariant does: the warm boot finds the row the
 * first boot created. Without it, a system insert into `crm_case` is refused
 * (D9) — the composition registers `sys_organization` and the install would
 * hold none, a shape no production `single` boot reaches.
 */
async function ensureDefaultOrganization(engine: any): Promise<void> {
  const found = await engine.find('sys_organization', { where: { slug: 'default' }, limit: 1 }, SYS);
  if (Array.isArray(found) && found.length > 0) return;
  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' }, SYS);
}

/**
 * One process's `SecurityPlugin` over `engine`, with the kernel's phases as
 * separate steps. `fire` runs the handlers subscribed SO FAR — a hook
 * subscribed after an event was triggered never hears it, as on the kernel.
 */
function securityProcess(engine: any) {
  let inFlight = 1;
  const hooks: Array<[string, (...a: any[]) => any]> = [];
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const services: Record<string, any> = {
    manifest: { register: () => {} },
    objectql: engine,
    metadata: { get: async () => null, list: async () => [] },
    [SEED_SETTLEMENT_SERVICE]: {
      snapshot: () => ({ pending: inFlight, inFlight, suppressed: [] }),
    },
  };
  const ctx: any = {
    logger,
    registerService: () => {},
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
    hook: (name: string, cb: any) => hooks.push([name, cb]),
  };
  const plugin = new SecurityPlugin();
  const fire = async (event: string, payload?: unknown) => {
    const subscribed = hooks.filter(([n]) => n === event);
    for (const [, cb] of subscribed) await cb(payload);
    return subscribed.length;
  };
  return {
    logger,
    fire,
    init: () => plugin.init(ctx),
    start: () => plugin.start(ctx),
    /** The runtime settles the source BEFORE it triggers `app:seeded`. */
    seedSettles: () => {
      inFlight = 0;
      return fire('app:seeded', APP);
    },
    /** Every claim pass's report, as `{ claimed, adminUserId }`. */
    claimReports: () =>
      [...logger.info.mock.calls, ...logger.warn.mock.calls]
        .filter(([message]) => String(message).includes('seeded record(s)'))
        .map(([, meta]) => ({ claimed: meta?.claimed, adminUserId: meta?.adminUserId })),
    /** The meta of each `platform bootstrap complete` line. */
    bootstrapReports: () =>
      logger.info.mock.calls
        .filter(([message]) => String(message).includes('platform bootstrap complete'))
        .map(([, meta]) => meta),
  };
}

async function owners(engine: any): Promise<Record<string, string | null>> {
  const rows = await engine.find('crm_case', { where: {} }, SYS);
  const out: Record<string, string | null> = {};
  for (const r of rows) out[r.id] = r.owner_id ?? null;
  return out;
}

const seedCase = (engine: any, id: string) => engine.insert('crm_case', { id, name: id }, SYS);

/**
 * The FIRST boot, in the order `objectstack dev` composes it (this plugin
 * registered before the app): the in-budget seed settles before anyone exists,
 * then a human signs up and is promoted. Then, between processes, the operator
 * deletes one seeded row (the next seed replay re-inserts it), a null is
 * planted on another, and a row owned by somebody else is added.
 *
 * The first half is the #17628 control on a real engine: the promotion's own
 * claim hands every seeded row to the admin.
 */
async function firstBoot(file: string) {
  const engine = await openEngine(file);
  const proc = securityProcess(engine);
  await proc.init();
  await proc.start();
  for (const id of ['c1', 'c2', 'c3']) await seedCase(engine, id);
  await proc.seedSettles();
  // No admin yet: the settle claims nothing and says nothing.
  expect(proc.claimReports()).toEqual([]);
  await proc.fire('kernel:ready');
  // The sign-up: the user row, then the login. The bootstrap replay promotes on
  // the login and its claim hands the seeded rows over.
  await engine.insert('sys_user', { id: ADMIN, email: 'admin@example.test', name: 'admin' }, SYS);
  await engine.insert(
    'sys_account',
    { id: 'acc_admin', user_id: ADMIN, account_id: 'admin@example.test', provider_id: 'credential' },
    SYS,
  );
  expect(await owners(engine)).toEqual({ c1: ADMIN, c2: ADMIN, c3: ADMIN });
  expect(proc.bootstrapReports().at(-1)).toMatchObject({ adminPromoted: true, ownershipClaimed: 3 });

  await engine.delete('crm_case', { where: { id: 'c2' }, context: { isSystem: true } } as any);
  await engine.update('crm_case', { owner_id: null }, { where: { id: 'c3' }, multi: true, context: { isSystem: true } });
  await engine.insert('crm_case', { id: 'c4', name: 'c4', owner_id: OTHER }, SYS);
  await engine.destroy();
}

/** What every warm boot must leave once its seed has settled. */
const SETTLED = { c1: ADMIN, c2: ADMIN, c3: ADMIN, c4: OTHER };

describe('seed-ownership claim on a WARM boot — an admin exists, the seed replays in budget', () => {
  it('claims the replayed rows when the seed settles BEFORE kernel:ready (plugin registered before the app)', async () => {
    const file = databaseFile();
    await firstBoot(file);

    const engine = await openEngine(file);
    const proc = securityProcess(engine);
    await proc.init();
    await proc.start();
    // AppPlugin.start(): the replay re-inserts the deleted row, then settles.
    await seedCase(engine, 'c2');
    expect((await owners(engine)).c2).toBeNull();
    await proc.seedSettles();

    // 0 ownerless after `app:seeded` — kernel:ready has not run.
    expect(await owners(engine)).toEqual(SETTLED);
    expect(proc.claimReports()).toEqual([{ claimed: 2, adminUserId: ADMIN }]);

    // The bootstrap that follows promotes nobody and claims nothing more.
    await proc.fire('kernel:ready');
    expect(proc.bootstrapReports().at(-1)).toMatchObject({ reason: 'already_have_admin', adminUserId: ADMIN });
    expect(await owners(engine)).toEqual(SETTLED);
    expect(proc.claimReports()).toHaveLength(1);
  }, 120_000);

  it('claims them when the seed settles before this plugin has even STARTED (app registered first)', async () => {
    const file = databaseFile();
    await firstBoot(file);

    const engine = await openEngine(file);
    const proc = securityProcess(engine);
    await proc.init();
    // AppPlugin.start() runs first: replay, settle — this plugin's start() has
    // not run yet.
    await seedCase(engine, 'c2');
    const heard = await proc.seedSettles();
    expect(heard).toBe(1);
    expect(await owners(engine)).toEqual(SETTLED);

    await proc.start();
    await proc.fire('kernel:ready');
    expect(await owners(engine)).toEqual(SETTLED);
    expect(proc.claimReports()).toEqual([{ claimed: 2, adminUserId: ADMIN }]);
  }, 120_000);

  it('claims them when the seed settles AFTER kernel:ready (over budget) — the bootstrap-named target', async () => {
    const file = databaseFile();
    await firstBoot(file);

    const engine = await openEngine(file);
    const proc = securityProcess(engine);
    await proc.init();
    await proc.start();
    await proc.fire('kernel:ready');
    await seedCase(engine, 'c2');
    await proc.seedSettles();

    expect(await owners(engine)).toEqual(SETTLED);
    expect(proc.claimReports()).toEqual([{ claimed: 2, adminUserId: ADMIN }]);
  }, 120_000);
});

describe('the claim target is the existing platform admin, by the bootstrap rule', () => {
  /**
   * A database with TWO unscoped human holders of `admin_full_access`, built
   * so that each candidate rule would answer differently: `usr_zed` holds the
   * grant row whose id sorts FIRST, while `usr_amy` is both the OLDER user and
   * the one whose user id sorts first.
   */
  async function twoAdmins(file: string) {
    const engine = await openEngine(file);
    await engine.insert('sys_permission_set', { id: 'ps_admin', name: 'admin_full_access', label: 'Admin', active: true }, SYS);
    for (const [id, createdAt] of [
      ['usr_amy', '2026-01-01T00:00:00.000Z'],
      ['usr_zed', '2026-06-01T00:00:00.000Z'],
    ] as const) {
      await engine.insert('sys_user', { id, email: `${id}@example.test`, name: id, created_at: createdAt }, SYS);
      await engine.insert('sys_account', { id: `acc_${id}`, user_id: id, account_id: id, provider_id: 'credential' }, SYS);
    }
    await engine.insert('sys_user_permission_set', { id: 'ups_1', user_id: 'usr_zed', permission_set_id: 'ps_admin', permission_set: 'admin_full_access', organization_id: null }, SYS);
    await engine.insert('sys_user_permission_set', { id: 'ups_2', user_id: 'usr_amy', permission_set_id: 'ps_admin', permission_set: 'admin_full_access', organization_id: null }, SYS);
    return engine;
  }

  it('with several admins, the claim and the bootstrap name the SAME one: the holder of the first grant row by id', async () => {
    const file = databaseFile();
    const engine = await twoAdmins(file);
    const proc = securityProcess(engine);
    await proc.init();
    await proc.start();
    await seedCase(engine, 'c1');
    await proc.seedSettles();

    expect(await owners(engine)).toEqual({ c1: 'usr_zed' });

    await proc.fire('kernel:ready');
    expect(proc.bootstrapReports().at(-1)).toMatchObject({ reason: 'already_have_admin', adminUserId: 'usr_zed' });
  }, 120_000);

  it('a walled posture names nobody — the claim never ran under a wall, and still does not', async () => {
    const file = databaseFile();
    const engine = await twoAdmins(file);
    const previous = process.env.OS_TENANCY_POSTURE;
    cleanups.push(() => {
      if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = previous;
    });

    expect(await findExistingPlatformAdmin(engine, defaultPermissionSets)).toBe('usr_zed');
    process.env.OS_TENANCY_POSTURE = 'isolated';
    expect(await findExistingPlatformAdmin(engine, defaultPermissionSets)).toBeUndefined();
  }, 120_000);
});
