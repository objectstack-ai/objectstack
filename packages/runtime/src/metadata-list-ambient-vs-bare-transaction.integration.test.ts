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

/** The one table the BARE case's stalled read is issued against. */
const STALLED_OBJECT = 'sys_metadata';

// ═══════════════════════════════════════════════════════════════════════════
// [#10380] The BARE case's expected error output: WITHHELD from the shared
//          log, and ASSERTED instead
// ═══════════════════════════════════════════════════════════════════════════
//
// This test PASSES, and its subject is a failure — so it printed three
// ERROR-shaped features into the shared `Test Core` log on every run:
//
//   1. knex's own  `Acquire connection error: …` (+ a `tarn/PendingOperation`
//      stack), from the client's logger;
//   2. the driver's `[sql-driver] DATABASE_ERROR — the backend refused a read
//      on 'sys_metadata'…`, from `SqlDriver.backendStatementFault`;
//   3. the engine's `ERROR Find operation failed {"object":"sys_metadata",…}`
//      one frame up (`engine.ts`), carrying the same fault as a stack.
//
// Turbo interleaves package logs without attribution, so in that shard log
// these are indistinguishable from a real failure. Not a hypothetical: they
// were lifted VERBATIM into a p1 flake signature (#10293) and sent a whole
// dispatch cycle at the wrong mechanism. Expected-failure noise from a green
// test is a diagnosis tax on every future red shard.
//
// ⛔ What this is NOT is a mute. Silencing alone would make this file BLIND:
// if the stall ever stopped happening, the log would go quiet and NOTHING
// would notice — a live pin quietly demoted to a decoration. So each sink
// below does two things instead of one:
//
//   * it withholds ONLY the expected fault — named table AND named reason.
//     Any other table, any other reason, any other level and any other logger
//     method is forwarded to the real console untouched;
//   * it COUNTS what it withheld, and the tests assert the counts. BARE
//     asserts all three channels fired; AMBIENT asserts that none did, which
//     is a new false-negative guard in its own right — an ambient read that
//     silently started stalling would otherwise have its evidence swallowed.
//
// ⛔ The pin's own assertions are untouched by all of this. Nothing below
// reads or relaxes them; this is the console side-effect only.

/** Per-channel tally of what the fixture withheld from the shared log. */
interface WithheldNoise {
  /** knex's acquire-timeout notice. */
  knexAcquire: number;
  /** The driver's read-exit envelope for {@link STALLED_OBJECT}. */
  driverRefusal: number;
  /** The engine frame above it. */
  engineFind: number;
}

/**
 * The three predicates, each pinned to BOTH the table and the reason.
 *
 * `engineFind` is deliberately the narrowest of the three: it fires only for a
 * frame sitting directly above a driver refusal this fixture already
 * recognised (`pendingRefusals`), so an identically-shaped engine error that
 * did NOT come from the expected stall still reaches the log with its frame
 * intact.
 */
function newNoiseCapture() {
  const withheld: WithheldNoise = { knexAcquire: 0, driverRefusal: 0, engineFind: 0 };
  /** Recognised driver refusals not yet consumed by their engine frame. */
  let pendingRefusals = 0;

  return {
    withheld,

    /**
     * knex's `log.warn`. `SqlDriverConfig` is `Knex.Config &` extras and the
     * constructor forwards everything it does not itself consume, so this
     * arrives at knex's `Logger` untouched. ⛔ Only `warn` is overridden —
     * knex's `debug` / `error` / `deprecate` keep their defaults.
     */
    knexWarn: (message: unknown): void => {
      const line = typeof message === 'string' ? message : String(message);
      // knex's default `warn` sink is `console.log`; forwarding at `warn` is
      // if anything louder, never quieter.
      if (/^Acquire connection error:/.test(line) && /timed out/i.test(line)) {
        withheld.knexAcquire += 1;
        return;
      }
      console.warn(line);
    },

    /**
     * The driver's sink, mirroring the default's `{ warn, error }` shape so
     * `logDurabilityFailure` still finds an `error` channel to fall back to.
     */
    driverLogger: {
      warn: (msg: string, meta?: unknown): void => {
        const line = String(msg);
        if (
          line.includes(`the backend refused a read on '${STALLED_OBJECT}'`) &&
          /Timeout acquiring a connection/i.test(line)
        ) {
          withheld.driverRefusal += 1;
          pendingRefusals += 1;
          return;
        }
        console.warn(msg, meta ?? '');
      },
      error: (msg: string, meta?: unknown): void => console.error(msg, meta ?? ''),
    },

    /**
     * The engine's `error` channel, reached through a Proxy so every OTHER
     * logger method stays the engine's own.
     */
    engineError: (msg: string, err?: unknown, meta?: unknown): boolean => {
      if (pendingRefusals === 0 || msg !== 'Find operation failed') return false;
      if ((meta as { object?: string } | undefined)?.object !== STALLED_OBJECT) return false;
      const detail = String((err as { message?: string } | undefined)?.message ?? '');
      if (!detail.includes(`refused to run this query for object '${STALLED_OBJECT}'`)) return false;
      pendingRefusals -= 1;
      withheld.engineFind += 1;
      return true;
    },
  };
}

interface Fixture {
  engine: ObjectQL;
  driver: SqlDriver;
  loader: DatabaseLoader;
  /** Every `driver.find` the fixture has observed, and whether it carried a transaction. */
  reads: () => Array<{ object: string; hasTx: boolean }>;
  /** [#10380] What this fixture withheld from the shared log, per channel. */
  withheld: WithheldNoise;
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
  // [#10380] Installed BEFORE the driver exists, because knex's logger is
  // baked into the client at construction.
  const noise = newNoiseCapture();

  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    // See the header: shortens the wait, not the shape.
    acquireConnectionTimeout: ACQUIRE_MS,
    // [#10380] Channel 1 of 3 — knex's own `Acquire connection error`.
    log: { warn: noise.knexWarn },
  });
  // [#10380] Channel 2 of 3 — the driver's read-exit envelope. Assignment
  // rather than a constructor option because `logger` is a protected field
  // with a `console` default; this is the idiom the field's own doc comment
  // names ("Tests inject a spy") and that ~20 sibling driver suites use.
  (driver as unknown as { logger: unknown }).logger = noise.driverLogger;
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
  // [#10380] Channel 3 of 3 — the engine frame above the driver's exit. A
  // Proxy on `error` ALONE, the idiom `engine-readonly-when-parent.test.ts`
  // established: every other logger method resolves to the engine's own.
  const engineLogger = (engine as any).logger;
  (engine as any).logger = new Proxy(engineLogger, {
    get: (target: any, key: string) =>
      key === 'error'
        ? (msg: string, err?: unknown, meta?: unknown) => {
            if (noise.engineError(msg, err, meta)) return;
            target.error(msg, err, meta);
          }
        : target[key],
  });
  engine.registerDriver(driver, true);
  await engine.init();
  // The engine's own proxy, not `engine.registry.registerObject` — the registry
  // method requires a `packageId` and the proxy supplies one, so this keeps the
  // fixture out of the package's TEST_DEBT ledger (`check:type-check-debt`).
  engine.registerObject(SysMetadataObject as any);

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
    withheld: noise.withheld,
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
    const { engine, driver, loader, reads, withheld } = await boot();
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

    // ── [#10380] The capture's own anti-vacuity guard, on the side that is
    // expected to be SILENT. The ambient path must produce none of the three
    // features — so if it ever started stalling, the sinks installed for the
    // bare case would swallow the evidence and this case would still pass on
    // the assertions above. Asserting the absence closes that.
    expect(withheld, 'the AMBIENT path must emit no expected-failure noise at all')
      .toEqual({ knexAcquire: 0, driverRefusal: 0, engineFind: 0 });
  });

  it('BARE — a transaction opened directly on the driver is invisible to the ambient store, and the loader read stalls out connection acquisition', async () => {
    const { engine, driver, loader, reads, withheld } = await boot();
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
      // [#8931, maintainer ruling 2026-08-17] This used to read
      // `rejects.toThrow(/Timeout acquiring a connection/i)` — knex's own words,
      // reaching the caller because `driver-sql`'s read exits let an
      // unclassified dialect error out raw. They no longer do: every dialect
      // error the driver cannot attribute now leaves as the generic
      // backend-fault envelope (`DATABASE_ERROR` / 500), with the dialect's text
      // kept to the server log and carried on `cause`.
      //
      // ⛔ The DISCRIMINATION this assertion exists for is not weakened, only
      // re-homed. What it must still separate is "the read failed by waiting on
      // the pool" from "the read failed for some other reason" — a distinction
      // the elapsed-time bounds below cannot make on their own — so it is asked
      // of the same string, at the place that string now lives.
      const fault = await loader.list('object').then(
        () => undefined,
        (e: unknown) => e as { code?: string; status?: number; cause?: { message?: string } },
      );
      const elapsed = Date.now() - started;
      expect(fault, 'the bare-transaction read must fail, not quietly succeed').toBeDefined();
      expect(fault?.code).toBe('DATABASE_ERROR');
      expect(fault?.status).toBe(500);
      expect(String(fault?.cause?.message)).toMatch(/Timeout acquiring a connection/i);

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

      // ── [#10380] The capture is a PIN, not a mute. These three lines used
      // to reach the shared `Test Core` log out of a PASSING test and were
      // read there as a real failure; they are withheld now, and asserted
      // here instead. If the stall stops happening, the log goes quiet AND
      // these go red — which is exactly the failure mode a bare `console`
      // mute would have hidden. One assertion per channel so a silent one
      // names itself.
      expect(withheld.knexAcquire, "knex's acquire-timeout notice was never emitted")
        .toBeGreaterThan(0);
      expect(withheld.driverRefusal, `the driver's read refusal for '${STALLED_OBJECT}' was never emitted`)
        .toBeGreaterThan(0);
      expect(withheld.engineFind, "the engine's 'Find operation failed' frame was never emitted")
        .toBeGreaterThan(0);
    } finally {
      await driver.rollback(trx);
    }
  });
});
