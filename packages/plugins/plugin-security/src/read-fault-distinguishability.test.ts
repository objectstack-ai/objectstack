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
 * ⚠️ These cases pinned what the tree DID, as the input to a decision that had
 * not been made. THE DECISION IS MADE: #15840 is ruled to option A (decision
 * batch #105 item 5) — per-site separation of "read failed" from "read empty",
 * ⛔ not a uniform sweep. The pins below moved accordingly, and this diff is the
 * record of the ruling. What each seam now says:
 *
 *   - `normalize-managed-by.ts` refused a read fault for its batch; its
 *     reading 1 retired with the module (ADR-0131 D3: no boot pass rewrites
 *     catalog rows any more).
 *   - `auto-org-admin-grant.ts` — a fault on the `sys_member` read that feeds
 *     the revoke branch SKIPS that user for the round, never enters the revoke
 *     branch, and reports at `error`.
 *   - ⭐ Both sites keep today's behaviour EXACTLY on a genuine empty read. The
 *     positive controls below are half of the fix: without them the change is
 *     indistinguishable from "make everything refuse", which is the option the
 *     maintainer refused.
 *   - `auto-org-admin-grant.ts`'s OTHER reads, and `claim-seed-ownership.ts`,
 *     are untouched — the not-swept controls that keep this A and not C.
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
import { ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS } from '@objectstack/spec';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition } from './objects/sys-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

import { reconcileOrgAdminGrant, backfillOrgAdminGrants } from './auto-org-admin-grant.js';
import { claimSeedOwnership } from './claim-seed-ownership.js';

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
    get(target, prop) {
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
  // [#15840] `error` alone takes the Error in its OWN second argument — the
  // platform `Logger` contract's shape, not a convenience of this harness.
  const atError = (message: string, error?: Error, meta?: unknown) =>
    void lines.push(
      `error: ${message}${error === undefined ? '' : ` ${error.message}`}` +
        `${meta === undefined ? '' : ` ${JSON.stringify(meta)}`}`,
    );
  return {
    lines,
    logger: { info: at('info'), warn: at('warn'), debug: at('debug'), error: atError },
  };
}

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
    { id: 'ups_standing', user_id: ADMIN, permission_set: ORGANIZATION_ADMIN_NO_BYPASS, organization_id: ORG, granted_by: null },
    SYS,
  );
}

/** Count every `delete` the reconciler issues, and fault `sys_member` reads on demand. */
function watchDeletes(engine: any, opts: { faultMemberRead?: 'throw' | 'envelope' } = {}) {
  const deletes: Array<{ object: string; where: any }> = [];
  const proxy = withFault(engine, {
    find: async (o: string, q?: any, opt?: any) => {
      if (o === 'sys_member' && opts.faultMemberRead === 'throw') throw READ_FAULT();
      const page = await engine.find(o, q, opt);
      if (o === 'sys_member' && opts.faultMemberRead === 'envelope') return { records: page };
      return page;
    },
    delete: async (o: string, options?: any) => {
      deletes.push({ object: o, where: options?.where });
      return engine.delete(o, options);
    },
  });
  return { proxy, deletes };
}

describe('[#15840] reading 2 — auto-org-admin-grant tryFind', () => {
  it('a control: the demotion revoke DOES land when the grant table is readable', async () => {
    const engine = await boot();
    await seedStandingGrantAwaitingRevoke(engine);
    const { logger } = recordingLogger();

    const res = await reconcileOrgAdminGrant(engine, ADMIN, ORG, { logger: logger as any });

    expect(res).toEqual({ action: 'revoked' });
    const left = await (engine as any).find('sys_user_permission_set', { where: { user_id: ADMIN } }, SYS);
    expect(left.length).toBe(0);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────
  // [RULED] the p1 leg: a faulted `sys_member` read must NOT reach the revoke
  // branch. The call count is the assertion — an outcome alone cannot tell
  // "did not revoke" from "revoked and the delete happened to fail".
  // ─────────────────────────────────────────────────────────────────────────

  it('[RULED p1] a faulted sys_member read SKIPS the user — the revoke branch is never entered', async () => {
    const engine = await boot();
    await seedStandingGrantAwaitingRevoke(engine);
    // The discriminator: this user IS a qualifying admin. Only the read is
    // broken. Before the ruling, `[]` from the fault read as "not a member" and
    // the standing grant of a sitting admin was DELETED by a transient fault.
    await (engine as any).insert('sys_member', { user_id: ADMIN, organization_id: ORG, role: 'admin' }, SYS);
    const { lines, logger } = recordingLogger();
    const { proxy, deletes } = watchDeletes(engine, { faultMemberRead: 'throw' });

    const res = await reconcileOrgAdminGrant(proxy, ADMIN, ORG, { logger: logger as any });

    // ⭐ THE CALL COUNT, not just the outcome: no delete was even attempted.
    expect(deletes).toEqual([]);
    expect(res).toEqual({ action: 'skipped', reason: 'membership_unreadable' });
    // The standing grant of a sitting admin survives the fault.
    const still = await (engine as any).find('sys_user_permission_set', { where: { user_id: ADMIN } }, SYS);
    expect(still.length).toBe(1);
    // Reported at `error`, once, naming the consequence.
    const errors = lines.filter((l) => l.startsWith('error:'));
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('cannot tell "not a member" from "could not ask"');
    expect(errors[0]).toContain('injected read fault');
    // ⛔ and never as the healthy verdicts.
    expect(lines.some((l) => l.includes('revoked org-admin capability'))).toBe(false);
  }, 120_000);

  it('[RULED p1] the same skip when the pair genuinely has no membership — the fault is undecidable', async () => {
    // The other half of the same fault: a faulted read cannot tell this case
    // from the one above, which is exactly why it must decline both.
    const engine = await boot();
    await seedStandingGrantAwaitingRevoke(engine);
    const { lines, logger } = recordingLogger();
    const { proxy, deletes } = watchDeletes(engine, { faultMemberRead: 'throw' });

    const res = await reconcileOrgAdminGrant(proxy, ADMIN, ORG, { logger: logger as any });

    expect(deletes).toEqual([]);
    expect(res).toEqual({ action: 'skipped', reason: 'membership_unreadable' });
    expect(lines.filter((l) => l.startsWith('error:')).length).toBe(1);
  }, 120_000);

  it('[RULED] a NON-ARRAY sys_member answer skips too — an envelope is not "not a member"', async () => {
    const engine = await boot();
    await seedStandingGrantAwaitingRevoke(engine);
    await (engine as any).insert('sys_member', { user_id: ADMIN, organization_id: ORG, role: 'admin' }, SYS);
    const { lines, logger } = recordingLogger();
    const { proxy, deletes } = watchDeletes(engine, { faultMemberRead: 'envelope' });

    const res = await reconcileOrgAdminGrant(proxy, ADMIN, ORG, { logger: logger as any });

    expect(deletes).toEqual([]);
    expect(res).toEqual({ action: 'skipped', reason: 'membership_unreadable' });
    const errors = lines.filter((l) => l.startsWith('error:'));
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('"why":"not_an_array"');
  }, 120_000);

  it('⭐ POSITIVE CONTROL — a GENUINE empty sys_member read still revokes, exactly as today', async () => {
    // ⛔ This is the case that separates the ruling (A) from "make everything
    // refuse" (C, refused). The read answers; it answers nothing; the demotion
    // must still land, with the same value, the same write and no `error`.
    const engine = await boot();
    await seedStandingGrantAwaitingRevoke(engine);
    const { lines, logger } = recordingLogger();
    const { proxy, deletes } = watchDeletes(engine);

    const res = await reconcileOrgAdminGrant(proxy, ADMIN, ORG, { logger: logger as any });

    expect(res).toEqual({ action: 'revoked' });
    expect(deletes.map((d) => d.object)).toEqual(['sys_user_permission_set']);
    const left = await (engine as any).find('sys_user_permission_set', { where: { user_id: ADMIN } }, SYS);
    expect(left.length).toBe(0);
    expect(lines.filter((l) => l.startsWith('error:'))).toEqual([]);
    expect(lines.some((l) => l.includes('revoked org-admin capability'))).toBe(true);
  }, 120_000);

  it('⭐ POSITIVE CONTROL — a GENUINE membership read still grants, exactly as today', async () => {
    const engine = await boot();
    await (engine as any).insert(
      'sys_permission_set',
      { id: 'ps_orgadmin', name: ORGANIZATION_ADMIN_NO_BYPASS, label: 'Org admin', managed_by: 'platform' },
      SYS,
    );
    await (engine as any).insert('sys_member', { user_id: ADMIN, organization_id: ORG, role: 'owner' }, SYS);
    const { lines, logger } = recordingLogger();

    const res = await reconcileOrgAdminGrant(engine, ADMIN, ORG, { logger: logger as any });

    expect(res).toEqual({ action: 'granted' });
    const granted = await (engine as any).find('sys_user_permission_set', { where: { user_id: ADMIN } }, SYS);
    expect(granted.length).toBe(1);
    expect(lines.filter((l) => l.startsWith('error:'))).toEqual([]);
  }, 120_000);

  it('[RULED, stated consequence] the superseded-revoke leg does not run on a skipped round either', async () => {
    // The ruling's disposition is "skips that user for the round" and "never
    // enters the revoke branch", so the early return lands BEFORE leg 1b — the
    // membership-independent leg that converges the OTHER posture's variant.
    // A round that could not read performs NO write at all. This is the one
    // behaviour delta beyond "do not wrongfully revoke", pinned here rather
    // than left to be discovered: nothing is granted, so nothing widens; the
    // superseded grant lingers one round and the next round removes it.
    const engine = await boot();
    await (engine as any).insert(
      'sys_permission_set',
      { id: 'ps_orgadmin', name: ORGANIZATION_ADMIN_NO_BYPASS, label: 'Org admin', managed_by: 'platform' },
      SYS,
    );
    await (engine as any).insert(
      'sys_permission_set',
      { id: 'ps_superseded', name: ORGANIZATION_ADMIN, label: 'Org admin (superseded)', managed_by: 'platform' },
      SYS,
    );
    await (engine as any).insert(
      'sys_user_permission_set',
      { id: 'ups_superseded', user_id: ADMIN, permission_set: ORGANIZATION_ADMIN, organization_id: ORG, granted_by: null },
      SYS,
    );

    // Healthy control first: the superseded grant IS converged away.
    const healthy = await reconcileOrgAdminGrant(engine, ADMIN, ORG, { logger: recordingLogger().logger as any });
    expect(healthy).toEqual({ action: 'noop' });
    expect((await (engine as any).find('sys_user_permission_set', { where: { user_id: ADMIN } }, SYS)).length).toBe(0);

    // Faulted round: re-seed the superseded grant, then fault the member read.
    await (engine as any).insert(
      'sys_user_permission_set',
      { id: 'ups_superseded2', user_id: ADMIN, permission_set: ORGANIZATION_ADMIN, organization_id: ORG, granted_by: null },
      SYS,
    );
    const { proxy, deletes } = watchDeletes(engine, { faultMemberRead: 'throw' });
    const res = await reconcileOrgAdminGrant(proxy, ADMIN, ORG, { logger: recordingLogger().logger as any });

    expect(res).toEqual({ action: 'skipped', reason: 'membership_unreadable' });
    expect(deletes).toEqual([]);
    expect((await (engine as any).find('sys_user_permission_set', { where: { user_id: ADMIN } }, SYS)).length).toBe(1);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────
  // ⛔ NOT-SWEPT CONTROLS. The ruling is per-site: it names the `sys_member`
  // read that feeds the revoke branch, and nothing else in this module. The two
  // cases below fault OTHER reads and their behaviour is UNCHANGED by this
  // card. They are kept exactly as PR #15998 measured them, and they are the
  // evidence that this delivery is option A and not option C.
  //
  // Both are MISSED revokes (a capability the platform decided to withdraw
  // stays in force), not the wrongful revoke #15840 was graded p1 for. Named in
  // the PR's acceptance notes rather than fixed here.
  // ─────────────────────────────────────────────────────────────────────────

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

// ⛔ UNCHANGED BY THE RULING — zero diff at this site. The card's third row is
// FALSIFIED: `idsFrom` has no `try` and no `catch`, so a read fault propagates
// to `claimSeedOwnership`'s own per-predicate handler, which reports at `warn`,
// names the object and states the consequence. That is a declared, in-file
// disposition and it is already the right one. `claim-seed-ownership.ts` is not
// touched by this PR; these three cases are kept verbatim as the proof.
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
