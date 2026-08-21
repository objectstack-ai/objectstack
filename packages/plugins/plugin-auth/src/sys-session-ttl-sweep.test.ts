// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7826] `sys_session`'s ADR-0057 TTL sweep, driven end to end: the REAL
// declaration (`@objectstack/platform-objects`) through the REAL Reaper
// (`@objectstack/objectql` `LifecycleService`) against a REAL SQL backend
// (`@objectstack/driver-sql`, live better-sqlite3), over a table this driver
// created from that same declaration.
//
// ## Why this suite exists at all
//
// The declaration it exercises is
//
//   ttl: { field: 'expires_at', expireAfter: '1d',
//          onlyWhen: { revoked_at: { $null: true } } }
//
// and the `onlyWhen` clause is the whole point. `reconcileSessionDelete` in
// `session-tombstone.ts` (#7732 / ADR-0069 D4) BACKDATES `expires_at` to
// `now - 1000` when it tombstones a revoked session, and clears nothing — so a
// tombstone is a strict SUPERSET of an ordinary row that looks MAXIMALLY
// expired. A TTL keyed on `expires_at` without the filter therefore reaps the
// audit records FIRST AND HARDEST. That backdating is pinned independently in
// `session-tombstone.test.ts`; here it is produced by that same function and
// then fed to the sweep, so the row under test is the one production writes
// rather than one this file imagined.
//
// ## The two controls, and why neither is sufficient alone
//
//   * SPARING  — the tombstone survives the sweep.
//   * POSITIVE — an ordinary expired row is deleted BY THE SAME SWEEP.
//
// Without the positive control the filter could be disabling the sweep
// outright and the sparing control would still pass; without the sparing
// control the sweep is just a sweep. They are made maximally discriminating by
// giving both rows the IDENTICAL `expires_at`: the only property that differs
// is `revoked_at`, so nothing but the filter can separate their fates.
//
// ⚠️ The honest before-state for the sparing control is NOT the pre-fix tree:
// on `origin/main` `sys_session` declared no `lifecycle` at all, so there was
// no sweep and a tombstone survived trivially. The control was proved to
// discriminate by ABLATING the declaration itself — dropping `onlyWhen` while
// keeping the `ttl`, rebuilding `@objectstack/platform-objects` (this package
// resolves it through `exports`, i.e. `dist/`) and watching the tombstone get
// reaped. See the PR body for that run.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { LifecycleService, assertEngineDeleteDispatch } from '@objectstack/objectql';
import type { LifecycleEngineLike, LifecycleObjectLike } from '@objectstack/objectql';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { runWithEndpointContext } from '@better-auth/core/context';
import { SysSession } from '@objectstack/platform-objects/identity';
import { reconcileSessionDelete } from './session-tombstone';

/** The instant the revocation happens; the sweep runs two days later. */
const REVOKED_AT_MS = Date.parse('2026-08-01T00:00:00.000Z');
const SWEEP_AT_MS = REVOKED_AT_MS + 2 * 86_400_000;

const openDrivers: SqlDriver[] = [];
afterEach(async () => {
  while (openDrivers.length) {
    const d = openDrivers.pop();
    try { await d?.disconnect(); } catch { /* noop */ }
  }
});

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

/**
 * The tombstone patch as the REAL writer composes it — `reconcileSessionDelete`
 * under a real better-auth endpoint context for an interactive revoke. Only the
 * `update` surface is needed: the function answers the delete by writing this
 * patch instead of deleting.
 */
async function realTombstonePatch(atMs = REVOKED_AT_MS): Promise<Record<string, any>> {
  const patches: Array<Record<string, any>> = [];
  const engine = { update: async (_o: string, p: any) => { patches.push(p); } };
  // The writer stamps from `Date.now()`. Pinning the clock to the simulated
  // revocation instant is what puts the row on the same timeline as the sweep,
  // WITHOUT rebasing (and so possibly flattening) the backdating this suite is
  // about — the offset is still the one the real function chose.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(atMs));
  try {
    const proceed = await runWithEndpointContext(
      { path: '/revoke-session', context: {} } as any,
      () => reconcileSessionDelete(engine as any, 'sys_session', { id: 'sess_tombstone', revoked_at: null }),
    );
    expect(proceed).toBe(false);          // answered by a tombstone, not a delete
  } finally {
    vi.useRealTimers();
  }
  expect(patches).toHaveLength(1);
  return patches[0];
}

/**
 * `LifecycleEngineLike` over a live `SqlDriver`. `delete` opens with ObjectQL's
 * own dispatch predicate so this double refuses exactly what the real engine
 * refuses (#4550) rather than re-deriving the rule.
 */
function sweepEngine(driver: SqlDriver, objects: LifecycleObjectLike[]): LifecycleEngineLike {
  return {
    registry: { getAllObjects: () => objects },
    getDriverForObject: () => driver,
    async find(object: string, options: any) {
      // Typed rather than erased to `any`: the driver silently DROPS an
      // unrecognised query key, so `tsc` is the only channel that can reject a
      // misspelt one here (#4918).
      const query: DriverQuery = { where: options?.where, limit: options?.limit };
      return driver.find(object, query);
    },
    async delete(object: string, options: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      if (dispatch.kind === 'by-id') return (await driver.delete(object, dispatch.id)) ? 1 : 0;
      const query: DriverQuery = { where: options?.where };
      return driver.deleteMany(object, query);
    },
  };
}

/**
 * Live `sys_session` table, created by the driver from the REAL object
 * declaration, seeded with the three rows the policy has to tell apart.
 *
 * `lifecycle` is the declaration under test unless `override` replaces it —
 * that parameter is what lets the ablation be expressed as a case in this file
 * as well as being run for real against a rebuilt `dist/` (see the header).
 */
async function seeded(override?: any) {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  openDrivers.push(driver);
  await driver.initObjects([SysSession as any]);

  const patch = await realTombstonePatch();
  const tombstoneExpiry = new Date(patch.expires_at).toISOString();

  await driver.create('sys_session', {
    id: 'sess_tombstone',
    user_id: 'usr_1',
    token: 'tok_tombstone',
    // Exactly what the real tombstone writer produced.
    expires_at: tombstoneExpiry,
    revoked_at: new Date(patch.revoked_at).toISOString(),
    revoke_reason: patch.revoke_reason,
  });
  await driver.create('sys_session', {
    id: 'sess_expired',
    user_id: 'usr_1',
    token: 'tok_expired',
    // IDENTICAL expiry to the tombstone — `revoked_at` is the only difference.
    expires_at: tombstoneExpiry,
    revoked_at: null,
  });
  await driver.create('sys_session', {
    id: 'sess_live',
    user_id: 'usr_1',
    token: 'tok_live',
    expires_at: new Date(SWEEP_AT_MS + 7 * 86_400_000).toISOString(),
    revoked_at: null,
  });

  const object: LifecycleObjectLike = {
    name: SysSession.name,
    lifecycle: (override === undefined ? (SysSession as any).lifecycle : override),
    fields: SysSession.fields as any,
  };
  const service = new LifecycleService({
    getEngine: () => sweepEngine(driver, [object]),
    logger: silentLogger,
    now: () => SWEEP_AT_MS,
    initialDelayMs: 1,
    sweepIntervalMs: 10,
  } as any);

  return { driver, service, patch, tombstoneExpiry };
}

const ALL_ROWS: DriverQuery = {};
const survivors = async (driver: SqlDriver) =>
  (await driver.find('sys_session', ALL_ROWS)).map((r: any) => r.id).sort();

describe('[#7826] sys_session TTL sweep — real declaration, real Reaper, live SQL', () => {
  it('the hazard is real: the tombstone writer backdates expires_at below the revocation instant', async () => {
    const patch = await realTombstonePatch();
    expect(patch.revoked_at).toBeInstanceOf(Date);
    expect(patch.revoke_reason).toBeTruthy();
    // The defining property: the tombstone looks MORE expired than a session
    // that merely lapsed, which is why a naive TTL reaps tombstones first.
    expect(new Date(patch.expires_at).getTime()).toBeLessThan(new Date(patch.revoked_at).getTime());
  });

  it('SPARING CONTROL — the revoked tombstone survives the sweep', async () => {
    const { driver, service } = await seeded();

    const report = await service.sweep();

    expect(await survivors(driver)).toContain('sess_tombstone');
    const tombstoneById: DriverQuery = { where: { id: 'sess_tombstone' } };
    const row: any = await driver.findOne('sys_session', tombstoneById);
    expect(row).toBeTruthy();
    expect(row.revoke_reason).toBeTruthy();      // the audit content is intact
    expect(report.errors).toEqual([]);
  });

  it('POSITIVE CONTROL — an ordinary expired session IS deleted by that same sweep', async () => {
    const { driver, service } = await seeded();

    const report = await service.sweep();

    // One sweep, three rows, two verdicts: the expired row is gone, the
    // tombstone and the live session remain.
    expect(await survivors(driver)).toEqual(['sess_live', 'sess_tombstone']);
    const ttl = report.swept.find((s: any) => s.object === 'sys_session' && s.policy === 'ttl');
    expect(ttl).toBeTruthy();
    expect(ttl!.deleted).toBe(1);
  });

  it('ABLATION — without `onlyWhen` the same sweep reaps the tombstone too', async () => {
    // The declaration minus its filter: the naive policy #10165 existed to
    // make avoidable. This is the case the sparing control has to discriminate
    // against, so the control is not vacuous.
    const { driver, service } = await seeded({
      class: 'transient',
      ttl: { field: 'expires_at', expireAfter: '1d' },
    });

    await service.sweep();

    expect(await survivors(driver)).toEqual(['sess_live']);
  });
});
