// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7842 — executes the ambient-vs-bare split that `MetadataManager`'s
 * `listCache` policy comment asserts.
 *
 * PR #7840 (#7708) re-anchored that comment onto a fresh measurement instead of
 * a retired witness, and the measurement NARROWED the hazard rather than
 * retiring it: on a real `ObjectQL` + real `SqlDriver` (better-sqlite3,
 * `:memory:`, knex pool max 1), a metadata read issued while a transaction is
 * open stalls out `acquireConnectionTimeout` — but ONLY when the transaction was
 * opened somewhere the engine's ambient `txStore` (ADR-0034) cannot see it. A
 * transaction opened through `engine.transaction()` is published into that store,
 * `buildDriverOptions` threads it onto the loader's read, and the read returns at
 * once on the connection the transaction already holds.
 *
 * That split lived only in a code comment and in PR prose, so nothing noticed if
 * `buildDriverOptions`' ambient fallback, `DatabaseLoader._find()`'s option
 * forwarding, or the SQLite pool config changed underneath it — at which point
 * the comment silently becomes the next stale witness, which is the defect #7708
 * existed to repair. This file is the executable half. It PINS current behaviour
 * and changes none of it.
 *
 * ## The 60-second problem, and what this fixture does about it
 *
 * The negative direction is an acquire timeout, and knex's default is 60s — a
 * 60-second test in the shared suite is worse than the gap it closes. The
 * fixture's driver therefore declares its own short `acquireConnectionTimeout`
 * ({@link ACQUIRE_MS}); `SqlDriverConfig` is `Knex.Config &` extras and the
 * constructor forwards everything it does not itself consume, so the knob
 * arrives at knex untouched. That shortens the WAIT, not the SHAPE: the read
 * still fails on connection acquisition, with knex's own message, exactly as it
 * does in production at 60s. `assertEffectiveTimeout` re-reads the value off the
 * live knex client so a driver that stopped forwarding it cannot leave this test
 * quietly measuring the default.
 *
 * ## Why the positive case asserts three things and not one
 *
 * "The read completed" passes trivially if no transaction was ever open — the
 * test would then guard nothing while appearing to guard the whole hazard. So
 * inside the callback all three of PR #7840's own false-negative checks are
 * asserted: the driver counts one open transaction, the ambient store carries a
 * handle, and — the load-bearing one — the `sys_metadata` read is observed
 * ARRIVING AT THE DRIVER with that handle in its options. Only the third
 * distinguishes "the ambient store was threaded onto the loader's read" from
 * "the read happened to succeed on its own".
 *
 * Worked precedent: `sql-driver-sqlite-tx-guard.test.ts`, which keeps the
 * driver's own `parentTrx` contract honest the same way. This lives in
 * `packages/runtime` because it is the only package carrying `objectql` +
 * `driver-sql` + `metadata` in one dependency closure.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatabaseLoader } from '@objectstack/metadata';
import { SysMetadataObject } from '@objectstack/metadata-core';

/**
 * The fixture's acquire bound, replacing knex's 60s default.
 *
 * Long enough that a loaded CI box cannot mistake scheduling jitter for a
 * timeout, short enough that the negative case costs well under a second.
 */
const ACQUIRE_MS = 400;

/** Upper bound for the negative case — an order of magnitude under knex's 60s default. */
const STALL_CEILING_MS = 20_000;

/** The seeded row `list('object')` must come back with. */
const SEEDED_NAME = 'thing';

interface Fixture {
  engine: ObjectQL;
  driver: SqlDriver;
  loader: DatabaseLoader;
  /** Every `driver.find` the fixture has observed, and whether it carried a transaction. */
  reads: () => Array<{ object: string; hasTx: boolean }>;
}

let fixture: Fixture | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await fixture?.engine.destroy();
  } catch {
    /* teardown is best-effort — a stalled pool must not mask the assertion */
  }
  fixture = null;
});

async function boot(): Promise<Fixture> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    // See the header: shortens the wait, not the shape.
    acquireConnectionTimeout: ACQUIRE_MS,
  });
  await driver.initObjects([SysMetadataObject as any]);

  // Seeded through the driver rather than the engine: `sys_metadata` is
  // `managedBy: 'engine-owned'`, and this row is fixture state, not a write
  // whose path is under test.
  await driver.create('sys_metadata', {
    id: 'md_fixture_1',
    type: 'object',
    name: SEEDED_NAME,
    scope: 'platform',
    metadata: JSON.stringify({ name: SEEDED_NAME }),
  });

  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(SysMetadataObject as any);

  // `cache: { enabled: false }` is what makes every `list()` below a real
  // database read; with the loader's own read-through cache on, the second call
  // would be answered from memory and would never reach the pool at all.
  const loader = new DatabaseLoader({
    engine: engine as any,
    cache: { enabled: false },
  });

  // Flush `ensureSchema()` OUTSIDE any transaction. On the engine path it runs
  // the `project_id` → `environment_id` forward migration on a bare connection
  // and swallows its own failure, so leaving it to the measured call would put
  // one extra acquire timeout inside the number the negative case reports.
  // Doubles as the issue's `control` row: no transaction open, read returns.
  const control = await loader.list('object');
  expect(control).toEqual([SEEDED_NAME]);

  const spy = vi.spyOn(driver, 'find');
  fixture = {
    engine,
    driver,
    loader,
    reads: () =>
      spy.mock.calls.map((call) => ({
        object: call[0] as string,
        hasTx: (call[2] as { transaction?: unknown } | undefined)?.transaction !== undefined,
      })),
  };
  return fixture;
}

/**
 * The two facts the hazard is made of, re-read off the LIVE knex client.
 *
 * `pool.max === 1` is why a second connection is unobtainable; the acquire bound
 * is why this test costs 0.4s instead of 60s. Asserting both here means a change
 * to the SQLite pool config, or a driver that stops forwarding the knob, fails
 * with the reason named rather than as a mysterious green (nothing to stall) or
 * a mysterious hang (back at the default).
 */
function assertEffectiveTimeout(driver: SqlDriver): void {
  const client = (driver as any).knex.client;
  expect(client.pool.max).toBe(1);
  expect(client.config.acquireConnectionTimeout).toBe(ACQUIRE_MS);
}

describe('#7842 metadata list under an open transaction: ambient vs bare (real ObjectQL + real SqlDriver)', () => {
  it('AMBIENT — a transaction opened via engine.transaction() is threaded onto the loader read, which completes', async () => {
    const { engine, driver, loader, reads } = await boot();
    assertEffectiveTimeout(driver);

    const before = reads().length;
    let names: string[] = [];

    const started = Date.now();
    await engine.transaction(async () => {
      // ── False-negative guard 1: a transaction really is open on the driver.
      // Without this, "the read completed" also passes when `engine.transaction`
      // silently degraded to a no-transaction path and there was never a
      // single-connection hazard to survive.
      expect((driver as any).activeTransactions).toBe(1);

      // ── False-negative guard 2: it is published into the engine's ambient
      // store (ADR-0034), which is the only thing `buildDriverOptions` can find
      // when the caller passes no explicit handle — as the loader does not.
      const ambient = (engine as any).txStore.getStore();
      expect(ambient?.transaction).toBeDefined();

      names = await loader.list('object');
    });
    const elapsed = Date.now() - started;

    // The read returned real rows — not an empty degradation that would also
    // satisfy "it completed".
    expect(names).toEqual([SEEDED_NAME]);

    // ── False-negative guard 3, the load-bearing one. The other two prove a
    // transaction existed; only this proves the ambient store was THREADED onto
    // the loader's read. Everything else here stays green if
    // `buildDriverOptions` stops consulting `txStore` and the read merely runs
    // on some other connection.
    const inTx = reads().slice(before).filter((r) => r.object === 'sys_metadata');
    expect(inTx.length).toBeGreaterThan(0);
    expect(inTx.every((r) => r.hasTx)).toBe(true);

    // And it did not stall on the way: the whole ambient case finishes inside
    // the acquire bound the bare case exhausts.
    expect(elapsed).toBeLessThan(STALL_CEILING_MS);
  });

  it('BARE — a transaction opened directly on the driver is invisible to the ambient store, and the loader read stalls out connection acquisition', async () => {
    const { engine, driver, loader, reads } = await boot();
    assertEffectiveTimeout(driver);

    const before = reads().length;
    const trx = await driver.beginTransaction();
    try {
      // Same first guard as above: the transaction is genuinely open and
      // genuinely holding the pool's only connection.
      expect((driver as any).activeTransactions).toBe(1);
      // ...and nothing published it into the engine's ambient store, which is
      // the entire difference between the two cases.
      expect((engine as any).txStore.getStore()).toBeUndefined();

      const started = Date.now();
      await expect(loader.list('object')).rejects.toThrow(/Timeout acquiring a connection/i);
      const elapsed = Date.now() - started;

      // It failed by WAITING on the pool, not instantly for some other reason...
      expect(elapsed).toBeGreaterThanOrEqual(ACQUIRE_MS / 2);
      // ...and the fixture's bound, not knex's 60s default, is what ended the wait.
      expect(elapsed).toBeLessThan(STALL_CEILING_MS);

      // The negative direction's own false-negative guard: the read really was
      // attempted and really did reach the driver — WITHOUT a transaction
      // handle. A rejection alone cannot tell "nothing threaded the caller's
      // transaction" apart from "the read never went out".
      const bare = reads().slice(before).filter((r) => r.object === 'sys_metadata');
      expect(bare.length).toBeGreaterThan(0);
      expect(bare.every((r) => !r.hasTx)).toBe(true);
    } finally {
      await driver.rollback(trx);
    }
  });
});
