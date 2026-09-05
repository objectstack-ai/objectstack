// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15840] What the three surviving `find()` seams in this plugin SAY when the
 * read does not answer — one reading per seam, driven against a real engine.
 *
 * ## Why this file records rather than repairs
 *
 * #15598 removed six dead `{ records }` limbs and repaired the seventh block
 * (`security-plugin.ts`'s `sys_permission_set` loader). That seventh block was
 * repairable with confidence because its consumer already DECLARED the
 * handling: `PermissionEvaluator.resolvePermissionSets` catches a throwing
 * loader, stays fail-closed and reports it. #15840 asks the same question of
 * the three seams left behind, and the answer is not one answer — treating "N
 * instances" as evidence that one rule fits them all is the failure mode this
 * family has already been burned by, so each seam is measured on its own.
 *
 * ⚠️ These cases pin what the tree DOES today, as the input to a decision that
 * has not been made. They are deliberately not an endorsement: where a case
 * asserts that an unreadable read is indistinguishable from an empty one, the
 * assertion exists so the indistinguishability is stated out loud and cannot be
 * changed by accident. Whichever disposition #15840 is ruled to, it changes
 * these pins on purpose, and the diff is the record of the ruling.
 *
 * ## What is driven, and what is standing in
 *
 * A real `ObjectQL` over a real `SqlDriver`, exactly as
 * `engine-find-bare-array.pin.test.ts` boots it. The only thing standing in is
 * the FAULT: one verb, for one object, is made to throw or to answer an
 * envelope — the condition under measurement. Every other call, and every read
 * whose answer is the subject, reaches the real engine untouched.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ORGANIZATION_ADMIN_NO_BYPASS } from '@objectstack/spec';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition } from './objects/sys-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

import { reconcileOrgAdminGrant, backfillOrgAdminGrants } from './auto-org-admin-grant.js';
import { claimSeedOwnership } from './claim-seed-ownership.js';
import { normalizeManagedByVocab } from './normalize-managed-by.js';

const SYS = { context: { isSystem: true } } as any;
const ORG = 'org_a';
const ADMIN = 'usr_admin';

const PROBE_OBJECT: any = {
  name: 'probe_deal',
  label: 'Probe Deal',
  fields: {
    id: { type: 'text', label: 'Id', primary: true },
    name: { type: 'text', label: 'Name' },
    owner_id: { type: 'text', label: 'Owner' },
  },
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.read-fault-15840',
    name: 'Read fault',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet,
      SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, PROBE_OBJECT,
    ],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  await (engine as any).insert('sys_organization', { id: ORG, name: ORG }, SYS);
  await (engine as any).insert('sys_user', { id: ADMIN, name: 'admin', email: 'admin@example.test' }, SYS);
  return engine;
}

/**
 * The real engine with ONE verb overridden — a Proxy, never a hand-built
 * stand-in.
 *
 * Deliberately not an object literal forwarding each verb: a literal is a
 * second, hand-maintained idea of the engine's call shape, and the seam under
 * measurement here is precisely what the engine hands back. Every method not
 * named in `overrides` is `Reflect.get`'d off the real instance and bound to
 * it, so private state stays reachable and no call shape is re-declared.
 */
function withFault(engine: any, overrides: Record<string, (...args: any[]) => any>): any {
  return new Proxy(engine, {
    get(target, prop, receiver) {
      const key = String(prop);
      if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** A read fault that is unambiguously a fault and not an empty page. */
const READ_FAULT = () => new Error('SQLITE_IOERR: disk I/O error (injected read fault)');

/** Every line a seam emitted, at EVERY level, in order. */
function recordingLogger() {
  const lines: string[] = [];
  const at = (level: string) => (message: string, meta?: unknown) =>
    void lines.push(`${level}: ${message}${meta === undefined ? '' : ` ${JSON.stringify(meta)}`}`);
  return {
    lines,
    logger: { info: at('info'), warn: at('warn'), debug: at('debug'), error: at('error') },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Reading 1 — normalize-managed-by.ts `tryFind` (`catch { return []; }`)
// ───────────────────────────────────────────────────────────────────────────

describe('[#15840] reading 1 — normalize-managed-by tryFind', () => {
  it('a control: a legacy row IS healed, so the harness can tell a real difference', async () => {
    const engine = await boot();
    await (engine as any).insert('sys_position', { name: 'pos_legacy', label: 'Legacy', managed_by: 'system' }, SYS);
    const { lines, logger } = recordingLogger();

    const counts = await normalizeManagedByVocab(engine, { logger: logger as any });

    expect(counts).toEqual({ positions: 1, permissionSets: 0 });
    expect(lines.filter((l) => l.startsWith('info:')).length).toBe(1);
  }, 120_000);

  it('an unreadable catalog and a catalog with nothing to heal are BYTE-IDENTICAL, on both channels', async () => {
    // The healthy arm: a catalog that really is already canonical.
    const healthyEngine = await boot();
    const healthy = recordingLogger();
    const healthyCounts = await normalizeManagedByVocab(healthyEngine, { logger: healthy.logger as any });

    // The faulted arm: a catalog holding a row that DOES need healing, behind a
    // read that cannot answer. The row is the discriminator — it makes the two
    // arms differ in the world, so anything that still reports them alike is
    // reporting a state it did not read.
    const faultedEngine = await boot();
    await (faultedEngine as any).insert(
      'sys_position', { name: 'pos_legacy', label: 'Legacy', managed_by: 'system' }, SYS,
    );
    let faultsFired = 0;
    const faulted = recordingLogger();
    const faultedCounts = await normalizeManagedByVocab(
      withFault(faultedEngine, { find: async () => { faultsFired += 1; throw READ_FAULT(); } }),
      { logger: faulted.logger as any },
    );

    // The fault fired — once per legacy value this pass scans for, so every
    // read the reconciler makes was refused and none of them was retried.
    expect(faultsFired).toBe(4);
    // …and the row it was supposed to heal is untouched.
    const stillLegacy = await (faultedEngine as any).find('sys_position', { where: { name: 'pos_legacy' } }, SYS);
    expect(stillLegacy[0].managed_by).toBe('system');

    // The value channel does not separate the two arms.
    expect(healthyCounts).toEqual({ positions: 0, permissionSets: 0 });
    expect(faultedCounts).toEqual(healthyCounts);
    // Neither does the report channel — nothing at ANY level, on either run.
    expect(healthy.lines).toEqual([]);
    expect(faulted.lines).toEqual([]);
  }, 120_000);

  it('the seam never throws, so the consumer catch that WOULD report it is unreachable', async () => {
    // `security-plugin.ts` wraps this call in `try { … } catch { logger.warn(
    // '[security] managed_by vocab normalization failed (non-fatal)') }` — the
    // only handling any consumer declares. Nothing reaches it: the fault is
    // swallowed one frame below.
    const engine = await boot();
    await expect(
      normalizeManagedByVocab(withFault(engine, { find: async () => { throw READ_FAULT(); } }), {}),
    ).resolves.toEqual({ positions: 0, permissionSets: 0 });
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// Reading 2 — auto-org-admin-grant.ts `tryFind` (`catch` reports at `debug`)
// ───────────────────────────────────────────────────────────────────────────

/** Seed the org-admin set and a standing grant for (ADMIN, ORG), with NO membership. */
async function seedStandingGrantAwaitingRevoke(engine: any): Promise<void> {
  await engine.insert(
    'sys_permission_set',
    { id: 'ps_orgadmin', name: ORGANIZATION_ADMIN_NO_BYPASS, label: 'Org admin', managed_by: 'platform' },
    SYS,
  );
  await engine.insert(
    'sys_user_permission_set',
    { id: 'ups_standing', user_id: ADMIN, permission_set_id: 'ps_orgadmin', organization_id: ORG, granted_by: null },
    SYS,
  );
}

describe('[#15840] reading 2 — auto-org-admin-grant tryFind', () => {
  it('a control: the demotion revoke DOES land when the grant table is readable', async () => {
    const engine = await boot();
    await seedStandingGrantAwaitingRevoke(engine);
    const { lines, logger } = recordingLogger();

    const res = await reconcileOrgAdminGrant(engine, ADMIN, ORG, { logger: logger as any });

    expect(res).toEqual({ action: 'revoked' });
    const left = await (engine as any).find('sys_user_permission_set', { where: { user_id: ADMIN } }, SYS);
    expect(left.length).toBe(0);
  }, 120_000);

  it('an unreadable grant table reports `noop` — the same verdict as a pair that never held a grant', async () => {
    const faultedEngine = await boot();
    await seedStandingGrantAwaitingRevoke(faultedEngine);
    const faulted = recordingLogger();
    const faultedRes = await reconcileOrgAdminGrant(
      withFault(faultedEngine, {
        find: async (o: string, q?: any, opt?: any) => {
          if (o === 'sys_user_permission_set') throw READ_FAULT();
          return faultedEngine.find(o, q, opt);
        },
      }),
      ADMIN, ORG, { logger: faulted.logger as any },
    );

    // The genuine nothing: the set is seeded, no grant stands, no membership.
    const emptyEngine = await boot();
    await (emptyEngine as any).insert(
      'sys_permission_set',
      { id: 'ps_orgadmin', name: ORGANIZATION_ADMIN_NO_BYPASS, label: 'Org admin', managed_by: 'platform' },
      SYS,
    );
    const empty = recordingLogger();
    const emptyRes = await reconcileOrgAdminGrant(emptyEngine, ADMIN, ORG, { logger: empty.logger as any });

    // The value channel does not separate them.
    expect(faultedRes).toEqual({ action: 'noop' });
    expect(faultedRes).toEqual(emptyRes);
    // The grant the platform decided to take away is still in force.
    const still = await (faultedEngine as any).find('sys_user_permission_set', { where: { user_id: ADMIN } }, SYS);
    expect(still.length).toBe(1);
    // The report channel DOES separate them — at `debug`, and only there.
    expect(empty.lines).toEqual([]);
    expect(faulted.lines.every((l) => l.startsWith('debug:'))).toBe(true);
    expect(faulted.lines.some((l) => l.includes('org-admin reconcile read failed'))).toBe(true);
  }, 120_000);

  it('an installation-wide backfill whose member read failed reports "complete" at `info`', async () => {
    const faultedEngine = await boot();
    await (faultedEngine as any).insert(
      'sys_permission_set',
      { id: 'ps_orgadmin', name: ORGANIZATION_ADMIN_NO_BYPASS, label: 'Org admin', managed_by: 'platform' },
      SYS,
    );
    await (faultedEngine as any).insert('sys_member', { user_id: ADMIN, organization_id: ORG, role: 'admin' }, SYS);
    const faulted = recordingLogger();
    const faultedSummary = await backfillOrgAdminGrants(
      withFault(faultedEngine, {
        find: async (o: string, q?: any, opt?: any) => {
          if (o === 'sys_member') throw READ_FAULT();
          return faultedEngine.find(o, q, opt);
        },
      }),
      { logger: faulted.logger as any },
    );

    // The genuine nothing: the set is seeded and there are no members at all.
    const emptyEngine = await boot();
    await (emptyEngine as any).insert(
      'sys_permission_set',
      { id: 'ps_orgadmin', name: ORGANIZATION_ADMIN_NO_BYPASS, label: 'Org admin', managed_by: 'platform' },
      SYS,
    );
    const empty = recordingLogger();
    const emptySummary = await backfillOrgAdminGrants(emptyEngine, { logger: empty.logger as any });

    expect(faultedSummary).toEqual({ scanned: 0, granted: 0, revoked: 0, skipped: 0 });
    expect(faultedSummary).toEqual(emptySummary);
    // Both close with the same `info`. The member that WAS there is unreconciled.
    const completed = (ls: string[]) => ls.filter((l) => l.includes('org-admin grant backfill complete'));
    expect(completed(faulted.lines).length).toBe(1);
    expect(completed(empty.lines).length).toBe(1);
    expect(completed(faulted.lines)[0]).toEqual(completed(empty.lines)[0]);
    expect(faulted.lines.some((l) => l.startsWith('warn:') || l.startsWith('error:'))).toBe(false);
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// Reading 3 — claim-seed-ownership.ts `idsFrom` (no `catch` at all)
// ───────────────────────────────────────────────────────────────────────────

/** The budget refusal that is the ONLY path reaching the paging read. */
function budgetRefusal(): Error {
  return Object.assign(new Error('over the per-row-hook ceiling (trigger)'), {
    code: 'ERR_BULK_PER_ROW_HOOK_LIMIT',
  });
}

describe('[#15840] reading 3 — claim-seed-ownership idsFrom', () => {
  it('a control: the paging fallback DOES re-own the row when the page read answers', async () => {
    const engine = await boot();
    await (engine as any).insert('probe_deal', { id: 'd1', name: 'Deal', owner_id: null }, SYS);
    let refuseOnce = true;
    const { lines, logger } = recordingLogger();

    const res = await claimSeedOwnership(
      withFault(engine, {
        update: async (o: string, d: any, opt?: any) => {
          assertEngineUpdateDispatch(d, opt);
          if (refuseOnce && opt?.multi && opt?.where) { refuseOnce = false; throw budgetRefusal(); }
          return engine.update(o, d, opt);
        },
      }),
      ADMIN, { logger: logger as any },
    );

    expect(res).toEqual([{ object: 'probe_deal', count: 1 }]);
    expect(lines.filter((l) => l.startsWith('warn:'))).toEqual([]);
  }, 120_000);

  it('a THROWN page read is reported at `warn` and named — the fault is NOT swallowed here', async () => {
    const engine = await boot();
    await (engine as any).insert('probe_deal', { id: 'd1', name: 'Deal', owner_id: null }, SYS);
    let refuseOnce = true;
    const { lines, logger } = recordingLogger();

    const res = await claimSeedOwnership(
      withFault(engine, {
        find: async (o: string, q?: any, opt?: any) => {
          if (o === 'probe_deal') throw READ_FAULT();
          return engine.find(o, q, opt);
        },
        update: async (o: string, d: any, opt?: any) => {
          assertEngineUpdateDispatch(d, opt);
          if (refuseOnce && opt?.multi && opt?.where) { refuseOnce = false; throw budgetRefusal(); }
          return engine.update(o, d, opt);
        },
      }),
      ADMIN, { logger: logger as any },
    );

    // `idsFrom` is never reached: the throw leaves `readPage` and is caught by
    // `claimSeedOwnership`'s own per-predicate handler, which names the object
    // and states the consequence. This is a DECLARED disposition, in-file.
    expect(res).toEqual([]);
    const warns = lines.filter((l) => l.startsWith('warn:'));
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain('claimSeedOwnership failed for probe_deal');
    expect(warns[0]).toContain('those rows stay unowned');
    expect(warns[0]).toContain('injected read fault');
    const rows = await (engine as any).find('probe_deal', { where: { id: 'd1' } }, SYS);
    expect(rows[0].owner_id).toBe(null);
  }, 120_000);

  it('the NON-ARRAY arm reports too — but attributes a cause that is not the one that happened', async () => {
    // Not reachable on the measured engine (#15598 drove every seam and each
    // answered a bare array); this reads the arm itself, which is what a sweep
    // would rewrite blind.
    const engine = await boot();
    await (engine as any).insert('probe_deal', { id: 'd1', name: 'Deal', owner_id: null }, SYS);
    let refuseOnce = true;
    const { lines, logger } = recordingLogger();

    const res = await claimSeedOwnership(
      withFault(engine, {
        find: async (o: string, q?: any, opt?: any) => {
          const page = await engine.find(o, q, opt);
          return o === 'probe_deal' ? { records: page } : page;
        },
        update: async (o: string, d: any, opt?: any) => {
          assertEngineUpdateDispatch(d, opt);
          if (refuseOnce && opt?.multi && opt?.where) { refuseOnce = false; throw budgetRefusal(); }
          return engine.update(o, d, opt);
        },
      }),
      ADMIN, { logger: logger as any },
    );

    expect(res).toEqual([]);
    const warns = lines.filter((l) => l.startsWith('warn:'));
    expect(warns.length).toBe(1);
    // The row IS there and the envelope carried it; the message says otherwise.
    expect(warns[0]).toContain('the predicate matched no rows to page');
    const rows = await (engine as any).find('probe_deal', { where: { id: 'd1' } }, SYS);
    expect(rows[0].owner_id).toBe(null);
  }, 120_000);
});
