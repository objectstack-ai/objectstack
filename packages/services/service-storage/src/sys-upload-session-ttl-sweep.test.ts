// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #12928 — the RULED CONDITION, discharged.
//
// The maintainer ruled option A (forward stamp only) on 2026-08-29, verbatim
// and untranslated: 「同意」. The other half of that ruling is a NEGATIVE: no
// backfill — "existing NULL rows age out through the table's own TTL sweep".
// That is a load-bearing premise, not a remark: if the sweep does not run, the
// pre-#12928 population never ages out, and a backfill becomes owed. So the
// ruling attached a condition to the implementing PR — verify the sweep
// actually runs — and this file is that verification.
//
// It is driven end to end, the same doctrine as `sys-session-ttl-sweep.test.ts`
// next door in `plugin-auth`: the REAL declaration
// (`objects/system-upload-session.object.ts`) through the REAL registry
// provisioning pass (`applySystemFields`) through the REAL Reaper
// (`@objectstack/objectql` `LifecycleService`) against a REAL SQL backend
// (`@objectstack/driver-sql`, live better-sqlite3), over a table this driver
// created from that same declaration. Nothing here restates a window by hand:
// the policy under test is `SystemUploadSession.lifecycle` itself, so a future
// edit that drops or narrows it fails this suite rather than silently
// invalidating the ruling it supports.
//
// ## The three rows, and why the trio is what makes the reading discriminating
//
//   * LEGACY-NULL — expired, `organization_id` NULL. THE row the ruling is
//     about: the pre-#12928 population. It must be reaped.
//   * STAMPED — expired, `organization_id` set. Proves the forward stamp this
//     PR adds does not exempt a row from the sweep (a stamped row that outlived
//     the reap would trade one defect for another).
//   * LIVE — not yet expired. The sparing control. Without it a sweep that
//     deleted the whole table would pass.
//
// All three share one `created_at` and one non-terminal `status`, so the
// `retention` leg (`maxAge: '7d'`, `onlyWhen` terminal statuses) cannot be what
// separates their fates — only `ttl.expires_at + 1d` can.
//
// ## The counterfactual
//
// `seeded({ lifecycle: null })` hands the SAME service the same rows with no
// policy at all and asserts nothing is reaped. That is what rules out "the
// sweep deletes rows regardless of the declaration": the discriminator is
// expressed as a parameter on the declaration handed to the service, in-file
// and re-run on every CI pass. ⚠️ It is deliberately NOT described as a
// dist-level ablation — the declaration under test is this package's own
// source, imported directly, so no rebuild is involved and none is claimed.

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { LifecycleService, applySystemFields, assertEngineDeleteDispatch } from '@objectstack/objectql';
import type { LifecycleEngineLike, LifecycleObjectLike } from '@objectstack/objectql';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SystemUploadSession } from './objects/system-upload-session.object.js';

const DAY_MS = 86_400_000;
/** The instant the sweep runs. Every window below is expressed against it. */
const SWEEP_AT_MS = Date.parse('2026-08-29T00:00:00.000Z');
/** Two days stale: past `expires_at`, and past the declared `+1d` grace. */
const EXPIRED_AT = new Date(SWEEP_AT_MS - 2 * DAY_MS).toISOString();
/** Comfortably live. */
const LIVE_UNTIL = new Date(SWEEP_AT_MS + 7 * DAY_MS).toISOString();
/** One age for all three rows, so `retention.maxAge` cannot discriminate. */
const CREATED_AT = new Date(SWEEP_AT_MS - 2 * DAY_MS).toISOString();

const openDrivers: SqlDriver[] = [];
afterEach(async () => {
  while (openDrivers.length) {
    const d = openDrivers.pop();
    try {
      await d?.disconnect();
    } catch {
      /* noop */
    }
  }
});

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

/**
 * `LifecycleEngineLike` over a live `SqlDriver`. `delete` opens with ObjectQL's
 * own dispatch predicate so this double refuses exactly what the real engine
 * refuses rather than re-deriving the rule.
 */
function sweepEngine(driver: SqlDriver, objects: LifecycleObjectLike[]): LifecycleEngineLike {
  return {
    registry: { getAllObjects: () => objects },
    getDriverForObject: () => driver,
    async find(object: string, options: any) {
      // Typed rather than erased to `any`: the driver silently DROPS an
      // unrecognised query key, so `tsc` is the only channel that can reject a
      // misspelt one here.
      const query: DriverQuery = { where: options?.where, limit: options?.limit };
      return driver.find(object, query);
    },
    async delete(object: string, options: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      if (dispatch.kind === 'by-id') {
        const id = typeof dispatch.id === 'bigint' ? dispatch.id.toString() : dispatch.id;
        return (await driver.delete(object, id)) ? 1 : 0;
      }
      const query: DriverQuery = { where: options?.where };
      return driver.deleteMany(object, query);
    },
  } as LifecycleEngineLike;
}

/**
 * The object as the platform actually registers it: the shipped declaration
 * through `applySystemFields({ multiTenant: true })`.
 *
 * This is also where the card's first premise is re-verified mechanically
 * rather than by grep — the declaration carries no `tenancy` key, so the
 * provisioning pass gives it `organization_id` and the object IS tenant-scoped.
 * If that ever stopped being true, the whole card would be moot and this line
 * is what would say so.
 */
function provisioned() {
  return applySystemFields(SystemUploadSession as any, { multiTenant: true }) as any;
}

async function seeded(opts?: { lifecycle?: unknown }) {
  const schema = provisioned();
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  openDrivers.push(driver);
  await driver.initObjects([schema]);

  await driver.create('sys_upload_session', {
    id: 's_legacy_null',
    file_id: 'f_legacy',
    key: 'user/f_legacy.bin',
    filename: 'legacy.bin',
    total_size: 10,
    chunk_size: 5,
    total_chunks: 2,
    status: 'in_progress',
    expires_at: EXPIRED_AT,
    created_at: CREATED_AT,
    organization_id: null,
  });
  await driver.create('sys_upload_session', {
    id: 's_stamped',
    file_id: 'f_stamped',
    key: 'user/f_stamped.bin',
    filename: 'stamped.bin',
    total_size: 10,
    chunk_size: 5,
    total_chunks: 2,
    status: 'in_progress',
    expires_at: EXPIRED_AT,
    created_at: CREATED_AT,
    organization_id: 'org_A',
  });
  await driver.create('sys_upload_session', {
    id: 's_live',
    file_id: 'f_live',
    key: 'user/f_live.bin',
    filename: 'live.bin',
    total_size: 10,
    chunk_size: 5,
    total_chunks: 2,
    status: 'in_progress',
    expires_at: LIVE_UNTIL,
    created_at: CREATED_AT,
    organization_id: 'org_A',
  });

  const object: LifecycleObjectLike = {
    name: SystemUploadSession.name,
    lifecycle:
      opts && 'lifecycle' in opts ? (opts.lifecycle as any) : ((SystemUploadSession as any).lifecycle),
    fields: schema.fields,
  } as LifecycleObjectLike;

  const service = new LifecycleService({
    getEngine: () => sweepEngine(driver, [object]),
    logger: silentLogger,
    now: () => SWEEP_AT_MS,
    initialDelayMs: 1,
    sweepIntervalMs: 10,
  } as any);

  return { driver, service };
}

const ALL_ROWS: DriverQuery = {};
const survivors = async (driver: SqlDriver) =>
  (await driver.find('sys_upload_session', ALL_ROWS)).map((r: any) => r.id).sort();

describe('[#12928] the no-backfill premise: sys_upload_session TTL sweep really runs', () => {
  it('the declaration under test still declares the TTL the ruling relies on', () => {
    const lc = (SystemUploadSession as any).lifecycle;
    expect(lc?.class).toBe('transient');
    expect(lc?.ttl?.field).toBe('expires_at');
    expect(lc?.ttl?.expireAfter).toBeTruthy();
  });

  it('the object IS tenant-scoped — the provisioning pass gives it organization_id', () => {
    // The card's premise 1, re-derived from the shipped declaration rather than
    // recalled: no `tenancy` key ⇒ tenancy is NOT disabled ⇒ the column exists,
    // which is why an unstamped insert lands a NULL on a real column at all.
    expect((SystemUploadSession as any).tenancy).toBeUndefined();
    expect(Object.keys(provisioned().fields)).toContain('organization_id');
  });

  it('POSITIVE CONTROL — the legacy NULL-organization row IS reaped by the sweep', async () => {
    const { driver, service } = await seeded();

    const report = await service.sweep();

    expect(await survivors(driver)).not.toContain('s_legacy_null');
    expect(report.errors).toEqual([]);
    // Not just "the row is gone": the TTL policy is recorded as having run on
    // THIS object, which is the fact the ruling asked to see.
    const ttlEntry = report.swept.find(
      (e) => e.object === 'sys_upload_session' && e.policy === 'ttl',
    );
    expect(ttlEntry).toBeTruthy();
  });

  it('a STAMPED expired row is reaped by the same sweep — the forward stamp exempts nothing', async () => {
    const { driver, service } = await seeded();

    await service.sweep();

    expect(await survivors(driver)).not.toContain('s_stamped');
  });

  it('SPARING CONTROL — a live session survives that same sweep', async () => {
    const { driver, service } = await seeded();

    await service.sweep();

    // The whole trio in one assertion: expired rows gone regardless of their
    // organization, the live one untouched.
    expect(await survivors(driver)).toEqual(['s_live']);
  });

  it('COUNTERFACTUAL — with no lifecycle declaration the same sweep reaps nothing', async () => {
    const { driver, service } = await seeded({ lifecycle: null });

    const report = await service.sweep();

    expect(await survivors(driver)).toEqual(['s_legacy_null', 's_live', 's_stamped']);
    expect(report.swept.filter((e) => e.object === 'sys_upload_session')).toEqual([]);
  });
});
