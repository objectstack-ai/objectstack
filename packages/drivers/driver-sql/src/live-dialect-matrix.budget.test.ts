// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16434] The live-cell test budget, pinned to the two bounds it was DERIVED
 * from rather than to the literal it happens to be.
 *
 * `LIVE_CELL_TIMEOUT_MS`'s docblock states the derivation; this file makes it
 * executable, in the shape #13691 used for `MAX_SPAN_MS` — "the derivation is
 * pinned by arithmetic ... so the two halves cannot drift apart in silence".
 * Three things could move it and none of them would touch this constant:
 *
 *  - the driver's own connection bounds (`withConnectBound`), which the budget
 *    must stay ABOVE so a connect fault reports the driver's envelope and not
 *    vitest's stopwatch;
 *  - the live job's stall guard, which the budget must stay BELOW so a hung
 *    live test is NAMED instead of being swallowed as an unattributed stall;
 *  - vitest's own cascade rules, which are what makes one seam-level suite
 *    option reach 40 files' live cells while leaving their explicit per-`it`
 *    budgets alone.
 *
 * ⚠️ Every bound here is read from the thing it describes — a constructed knex
 * config, the workflow file — never re-typed. A pin that copies both sides of
 * an equality cannot fail. Each read carries a non-vacuity assertion for the
 * same reason: a regex that silently matches nothing is a phantom check.
 *
 * Runs on every runner: it constructs a driver but never connects, so no live
 * server is required and no cell of the matrix is involved.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from './index.js';
import { LIVE_CELL_TIMEOUT_MS } from './live-dialect-matrix.testkit.js';

/** The workspace root, found the way the testkit finds it — by its marker file. */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no pnpm-workspace.yaml above this file');
    dir = parent;
  }
}

/**
 * The connection bounds the driver ACTUALLY installs, read off a constructed
 * pg config rather than copied from `SqlDriver`'s private constants.
 *
 * Constructing a driver opens no socket — knex builds its pool lazily — so this
 * is a pure read of the config the driver would connect with.
 */
function installedConnectBounds(): { poolCreateMs: number; dialectConnectMs: number } {
  const driver = new SqlDriver({
    client: 'pg',
    connection: 'postgres://u:p@127.0.0.1:5432/never_connected',
  } as any);
  const config = (driver as any).knex.client.config;
  return {
    poolCreateMs: Number(config?.pool?.createTimeoutMillis),
    dialectConnectMs: Number(config?.connection?.connectionTimeoutMillis),
  };
}

describe('[#16434] the live-cell budget stays inside the corridor it was derived from', () => {
  it('sits ABOVE the longest wait the driver is entitled to for one connection', () => {
    const { poolCreateMs, dialectConnectMs } = installedConnectBounds();

    // Non-vacuity: if the driver stopped installing these, both reads would be
    // NaN and every comparison below would be vacuously false-y rather than red.
    expect(
      Number.isFinite(poolCreateMs),
      'the driver installed no `pool.createTimeoutMillis` — this pin read nothing, so it is ' +
        'measuring nothing (see `withConnectBound`)',
    ).toBe(true);
    expect(
      Number.isFinite(dialectConnectMs),
      'the driver installed no per-dialect connect timeout — this pin read nothing (see ' +
        '`DIALECT_CONNECT_TIMEOUT`)',
    ).toBe(true);

    // The floor. At or below the pool's create backstop, vitest kills the test
    // while the driver is still inside a wait it declares legal, and the
    // accurate connect message never prints.
    expect(
      LIVE_CELL_TIMEOUT_MS,
      `a live cell budget of ${LIVE_CELL_TIMEOUT_MS} ms does not clear the ${poolCreateMs} ms ` +
        `pool create backstop the driver installs, so a connect fault would be reported as ` +
        `"Test timed out" instead of by the driver's own envelope`,
    ).toBeGreaterThan(poolCreateMs);
    expect(LIVE_CELL_TIMEOUT_MS).toBeGreaterThan(dialectConnectMs);

    // ⭐ The status quo this card is about, asserted rather than recounted:
    // vitest's own default is below even the dialect connect bound.
    const VITEST_DEFAULT_TEST_TIMEOUT_MS = 5_000;
    expect(
      VITEST_DEFAULT_TEST_TIMEOUT_MS,
      'vitest’s default no longer sits below the driver’s connect bound — re-derive the ' +
        'floor above, because the reason an unbudgeted live cell could never report a connect ' +
        'fault has changed',
    ).toBeLessThan(dialectConnectMs);
  });

  it('sits BELOW the stall guard the live job wraps this suite in', () => {
    const ci = readFileSync(join(repoRoot(), '.github/workflows/ci.yml'), 'utf8');
    const guarded = /run-with-stall-guard\.mjs[^\n]*--stall-minutes\s+(\d+)[\s\S]{0,400}?driver-sql/;
    const match = guarded.exec(ci);

    // Non-vacuity: no match means the workflow moved and this pin is measuring
    // nothing — a louder failure than a green over a regex that matches nothing.
    expect(
      match,
      'no `run-with-stall-guard --stall-minutes N` step wrapping the driver-sql suite was found ' +
        'in .github/workflows/ci.yml — the ceiling half of this budget’s derivation now reads ' +
        'nothing, so re-derive it against wherever that guard moved to',
    ).not.toBeNull();

    const stallWindowMs = Number(match![1]) * 60_000;
    expect(stallWindowMs).toBeGreaterThan(0);
    expect(
      LIVE_CELL_TIMEOUT_MS,
      `a live cell budget of ${LIVE_CELL_TIMEOUT_MS} ms is not comfortably under the ` +
        `${stallWindowMs} ms stall window: at that size a hung live test is killed as an ` +
        `unattributed stall instead of being named by vitest`,
    ).toBeLessThan(stallWindowMs / 2);
  });
});

describe('[#16434] the seam-level suite option behaves the way the seam assumes', () => {
  const SUITE_BUDGET = 4_242;
  const OWN_BUDGET = 1_337;

  describe('a suite option', { timeout: SUITE_BUDGET }, () => {
    it('reaches a test declared directly in that suite', (ctx) => {
      expect(ctx.task.timeout).toBe(SUITE_BUDGET);
    });

    describe('and a describe nested inside it — the shape every matrix consumer writes', () => {
      it('reaches a test one level deeper too', (ctx) => {
        expect(ctx.task.timeout).toBe(SUITE_BUDGET);
      });

      it(
        'but does NOT override a budget the test declared for itself',
        (ctx) => {
          // The 62 explicit budgets already in this package (60 x 60_000, one
          // 40_000, one 120_000) keep the value their own site chose.
          expect(ctx.task.timeout).toBe(OWN_BUDGET);
        },
        OWN_BUDGET,
      );
    });
  });

  it('leaves a test OUTSIDE that suite on the runner default — the SQLite cells', (ctx) => {
    expect(
      ctx.task.timeout,
      'a suite option leaked out of its own suite — the whole "live cells only" claim rests on ' +
        'it not doing that',
    ).not.toBe(SUITE_BUDGET);

    // ⛔ The fence, executable: this package must keep inheriting the runner
    // default outside a live cell. It reds two ways, and both are the point —
    // a package-wide `testTimeout` added to `vitest.config.ts` (which is the
    // fix #16434 declined), or a vitest upgrade that moves the default out from
    // under the FLOOR argument in `LIVE_CELL_TIMEOUT_MS`'s docblock. Either one
    // needs a human to re-derive, not a number bumped here.
    expect(
      ctx.task.timeout,
      'a test outside every live cell no longer runs at vitest’s 5000 ms default — either this ' +
        'package grew a package-wide `testTimeout` (the fix #16434 declined, because it has no ' +
        'cell-level discrimination) or the runner default moved; re-derive LIVE_CELL_TIMEOUT_MS ' +
        'rather than editing this number',
    ).toBe(5_000);
  });
});
