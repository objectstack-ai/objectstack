// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #17611 — the ruled declaration (director seat, decision batch #116 item 3,
// maintainer verbatim and untranslated: 「17611  同意」 to 「席位推荐 C 现在做,A
// 另立一卡」), driven end to end.
//
// The card: a tenant with no email transport dead-letters the `email` row of
// every fanned-out `notify` on its first attempt, and those rows then sat in
// the claim query's table for 90 days — 2,876 of them at +316/day on the
// reported production tenant, carrying no work anybody would ever do.
//
// The fix under test is a DECLARATION, so this suite is driven exactly as the
// two sibling sweeps next door (`plugin-auth/sys-session-ttl-sweep.test.ts`,
// `service-storage/sys-upload-session-ttl-sweep.test.ts`): the REAL
// declaration (`objects/notification-delivery.object.ts`) through the REAL
// provisioning pass (`applySystemFields`) through the REAL Reaper
// (`@objectstack/objectql` `LifecycleService`) against a REAL SQL backend
// (`@objectstack/driver-sql`, live better-sqlite3), over a table this driver
// created from that same declaration. Nothing here restates a window by hand —
// the policy under test is `NotificationDelivery.lifecycle` itself, so an edit
// that drops or narrows it reddens this file rather than silently voiding the
// ruling.
//
// ## The two sides the ruling asked to see pinned, and the third this adds
//
//   1. TERMINAL rows past 7d ARE selected  — `dead` and `suppressed`.
//   2. `pending` / `success` under 90d are NOT — the acceptance's own words.
//   3. ⚠️ …and a `success` row past 90d IS still reaped. Scoping `retention`
//      to terminal statuses would otherwise have UNBOUNDED the non-terminal
//      rows entirely (`retention` is one block), so this third leg is what
//      distinguishes "the table window was kept" from "the table window was
//      traded away on the card that exists to tighten it".
//
// ## Why the reading is discriminating
//
// `d_dead_30d` and `d_success_30d` carry the IDENTICAL `created_at`, so no age
// rule can separate their fates — only the `onlyWhen` status filter can. And
// `d_dead_2d` is terminal but inside the 7d window, so "everything terminal is
// reaped" fails too: both halves of the scoped policy are load-bearing.
//
// ## The counterfactual
//
// `seeded({ lifecycle: … })` hands the SAME service the same rows under an
// ABLATED declaration — the 7d retention with its `onlyWhen` removed — and the
// non-terminal rows are reaped along with the terminal ones. That is what
// rules out "the sweep would have produced this result anyway". ⚠️ It is
// deliberately NOT described as a dist-level ablation: the declaration under
// test is this package's own source, imported directly, so no rebuild is
// involved and none is claimed. The on-disk ablation of the shipped file is
// recorded in the PR body.

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { LifecycleService, applySystemFields, assertEngineDeleteDispatch } from '@objectstack/objectql';
import type { LifecycleEngineLike, LifecycleObjectLike } from '@objectstack/objectql';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { NotificationDelivery } from './objects/notification-delivery.object.js';

const DAY_MS = 86_400_000;
/** The instant the sweep runs. Every age below is expressed against it. */
const SWEEP_AT_MS = Date.parse('2026-09-12T00:00:00.000Z');
const agedDays = (days: number) => new Date(SWEEP_AT_MS - days * DAY_MS).toISOString();

/** Past the 7d terminal window, far inside the 90d table window. */
const AGE_30D = agedDays(30);
/** Inside BOTH windows. */
const AGE_2D = agedDays(2);
/** Past the 90d table window. */
const AGE_100D = agedDays(100);

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
      if (dispatch.kind === 'by-id') {
        const id = typeof dispatch.id === 'bigint' ? dispatch.id.toString() : dispatch.id;
        return (await driver.delete(object, id)) ? 1 : 0;
      }
      const query: DriverQuery = { where: options?.where };
      return driver.deleteMany(object, query);
    },
  } as LifecycleEngineLike;
}

/** The object as the platform actually registers it (tenant field: organization_id). */
function provisioned() {
  return applySystemFields(NotificationDelivery as any, { multiTenant: true }) as any;
}

/**
 * The six rows the policy has to tell apart. Every one of them is a shape the
 * ack paths really write: `SqlNotificationOutbox.ack` / `MemoryNotificationOutbox.ack`
 * produce exactly `success | suppressed | dead | pending`, and `claim()` writes
 * `in_flight`.
 */
const ROWS: Array<{ id: string; status: string; created_at: string; channel: string }> = [
  // ── past the 7d terminal window ──────────────────────────────────────────
  { id: 'd_dead_30d', status: 'dead', created_at: AGE_30D, channel: 'email' },
  { id: 'd_suppressed_30d', status: 'suppressed', created_at: AGE_30D, channel: 'email' },
  // ── terminal, but INSIDE the 7d window ───────────────────────────────────
  { id: 'd_dead_2d', status: 'dead', created_at: AGE_2D, channel: 'email' },
  // ── non-terminal, same age as the reaped terminal rows ───────────────────
  { id: 'd_success_30d', status: 'success', created_at: AGE_30D, channel: 'inbox' },
  { id: 'd_pending_30d', status: 'pending', created_at: AGE_30D, channel: 'inbox' },
  { id: 'd_in_flight_30d', status: 'in_flight', created_at: AGE_30D, channel: 'inbox' },
  // ── non-terminal, past the 90d TABLE window ──────────────────────────────
  { id: 'd_success_100d', status: 'success', created_at: AGE_100D, channel: 'inbox' },
];

async function seeded(opts?: { lifecycle?: unknown }) {
  const schema = provisioned();
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  openDrivers.push(driver);
  await driver.initObjects([schema]);

  for (const r of ROWS) {
    await driver.create('sys_notification_delivery', {
      id: r.id,
      // Distinct per row: the object declares `(notification_id, recipient_id,
      // channel)` UNIQUE, which is the real dedup key — one delivery per
      // (event × recipient × channel). Reusing one event id here would be a
      // shape production cannot produce.
      notification_id: `n_${r.id}`,
      recipient_id: 'usr_1',
      channel: r.channel,
      status: r.status,
      attempts: r.status === 'pending' ? 0 : 1,
      partition_key: 0,
      created_at: r.created_at,
      updated_at: r.created_at,
      organization_id: 'org_A',
    });
  }

  const object: LifecycleObjectLike = {
    name: NotificationDelivery.name,
    lifecycle:
      opts && 'lifecycle' in opts ? (opts.lifecycle as any) : (NotificationDelivery as any).lifecycle,
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
  (await driver.find('sys_notification_delivery', ALL_ROWS)).map((r: any) => r.id).sort();

describe('[#17611] sys_notification_delivery terminal retention — real declaration, real Reaper, live SQL', () => {
  it('is exactly the ruled declaration', () => {
    expect((NotificationDelivery as any).lifecycle).toEqual({
      class: 'telemetry',
      ttl: { field: 'created_at', expireAfter: '90d' },
      retention: {
        maxAge: '7d',
        onlyWhen: { status: { $in: ['dead', 'suppressed'] } },
      },
    });
  });

  it('scopes on statuses the field declares AND the ack paths really write', () => {
    // A filter naming a value the writers never produce would compile to a
    // predicate matching nothing — the sweep would silently reap nothing.
    const scoped: string[] = (NotificationDelivery as any).lifecycle.retention.onlyWhen.status.$in;
    const declared: string[] = (NotificationDelivery.fields as any).status.options.map(
      (o: any) => (typeof o === 'string' ? o : o.value),
    );
    for (const s of scoped) expect(declared).toContain(s);
    // `success` is terminal too, and is deliberately OUT of the scope: the
    // ruling keeps delivery history at the table window.
    expect(scoped).not.toContain('success');
  });

  it('POSITIVE — terminal rows past 7d are reaped, and the retention leg is recorded', async () => {
    const { driver, service } = await seeded();

    const report = await service.sweep();

    const left = await survivors(driver);
    expect(left).not.toContain('d_dead_30d');
    expect(left).not.toContain('d_suppressed_30d');
    expect(report.errors).toEqual([]);
    const retention = report.swept.find(
      (e: any) => e.object === 'sys_notification_delivery' && e.policy === 'retention',
    );
    expect(retention).toBeTruthy();
  });

  it('NEGATIVE — pending / success / in_flight rows of the SAME age are untouched', async () => {
    const { driver, service } = await seeded();

    await service.sweep();

    const left = await survivors(driver);
    // Identical `created_at` to the two rows just reaped, so nothing but the
    // `onlyWhen` status filter can be what spared them.
    expect(left).toContain('d_success_30d');
    expect(left).toContain('d_pending_30d');
    expect(left).toContain('d_in_flight_30d');
  });

  it('NEGATIVE — a terminal row INSIDE the 7d window is untouched', async () => {
    const { driver, service } = await seeded();

    await service.sweep();

    // Without this the suite would pass for a policy that reaped every
    // terminal row at any age.
    expect(await survivors(driver)).toContain('d_dead_2d');
  });

  it('the TABLE window survived — a non-terminal row past 90d is still reaped by the ttl leg', async () => {
    const { driver, service } = await seeded();

    const report = await service.sweep();

    expect(await survivors(driver)).not.toContain('d_success_100d');
    const ttl = report.swept.find(
      (e: any) => e.object === 'sys_notification_delivery' && e.policy === 'ttl',
    );
    expect(ttl).toBeTruthy();
  });

  it('one sweep, seven rows, the whole verdict in one assertion', async () => {
    const { driver, service } = await seeded();

    await service.sweep();

    expect(await survivors(driver)).toEqual([
      'd_dead_2d',
      'd_in_flight_30d',
      'd_pending_30d',
      'd_success_30d',
    ]);
  });

  it('COUNTERFACTUAL — drop `onlyWhen` and the same sweep takes the non-terminal rows too', async () => {
    // The naive policy: a 7d table-wide retention. This is what the negative
    // pins above have to discriminate against, so they are not vacuous.
    const { driver, service } = await seeded({
      lifecycle: {
        class: 'telemetry',
        ttl: { field: 'created_at', expireAfter: '90d' },
        retention: { maxAge: '7d' },
      },
    });

    await service.sweep();

    expect(await survivors(driver)).toEqual(['d_dead_2d']);
  });

  it('COUNTERFACTUAL — with no lifecycle declaration the same sweep reaps nothing', async () => {
    const { driver, service } = await seeded({ lifecycle: null });

    const report = await service.sweep();

    expect(await survivors(driver)).toEqual(ROWS.map((r) => r.id).sort());
    expect(report.swept.filter((e: any) => e.object === 'sys_notification_delivery')).toEqual([]);
  });
});
