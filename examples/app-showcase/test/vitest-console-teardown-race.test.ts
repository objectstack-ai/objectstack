// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10293 / #10374] A green suite must not be reddened by a console.log that
 * outlives its test file.
 *
 * THE DEFECT, read out of the installed vitest (4.1.10). The worker replaces
 * `console` with one that forwards every write to the main thread over RPC, and
 * `sendLog` in `packages/vitest/dist/chunks/console.*.js` DISCARDS the promise
 * that forwarding returns. Teardown in `packages/vitest/dist/chunks/init.*.js`
 * then runs `await rpcDone()` and, immediately after, a cleanup that calls
 * `rpc.$rejectPendingCalls(...)` — and `rpcDone()` awaits a SNAPSHOT
 * (`Array.from(promises)`) taken at the moment it is called. Any console RPC
 * created after that snapshot is still pending when the rejection sweep runs,
 * is rejected with `EnvironmentTeardownError`, and — because `sendLog` kept no
 * reference — nobody handles it. vitest fails a run on an unhandled error even
 * when no assertion failed, so the signature is a fully green suite exiting 1:
 *
 *     Test Files  21 passed (21)
 *          Tests  342 passed (342)
 *         Errors  1 error
 *     EnvironmentTeardownError: [vitest-worker]: Closing rpc while
 *       "onUserConsoleLog" was pending
 *
 * That is what evicted PRs from the merge queue three times in one afternoon:
 * the dequeue forces every speculative build behind the PR to rebuild.
 *
 * WHY IT READS AS LOAD-DEPENDENT. The window is exactly the duration of
 * `rpcDone()` — the time to drain the RPC round-trips already in flight. Idle
 * that is about a millisecond; on a saturated runner it is wide enough for a
 * leaked timer, poll or fire-and-forget write to log inside it. Nothing about
 * the code under test changes between the green run and the red one, which is
 * why the two reproductions before this one both concluded "cannot reproduce".
 *
 * WHAT THIS PIN ASSERTS, and why it spawns vitest instead of asserting inline.
 * The failure happens during worker teardown, i.e. strictly AFTER every test in
 * the file has finished — no assertion inside the affected file can observe it,
 * and the only visible symptom is the process exit code. So the pin drives a
 * real vitest process over a fixture that deliberately leaks a logging callback
 * (`test/fixtures/late-console-teardown/`) and reads the exit code:
 *
 *   - the ABLATION leg runs it under vitest's defaults and requires the harm to
 *     still reproduce — a positive control, so this pin can never go quietly
 *     green because the fixture stopped provoking anything;
 *   - the GUARDED leg runs the SAME fixture under this app's real
 *     `vitest.config.ts` and requires exit 0.
 *
 * Delete `disableConsoleIntercept: true` from that config and the guarded leg
 * turns red. Both legs also assert `Test Files  1 passed (1)`, because a run
 * that collected NOTHING exits 0 too and would read as a pass.
 *
 * ⚠️ The ablation is a race, not a certainty: measured 8/10, 10/12 and 9/12 on
 * an idle 4-vCPU container across three fixture shapes. It is therefore
 * retried, and only the exhaustion of every attempt is a failure — reported as
 * "the instrument stopped reproducing", never as "the guard broke".
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const VITEST_BIN = resolve(HERE, '../node_modules/.bin/vitest');
const APP_CONFIG = resolve(HERE, '../vitest.config.ts');
const FIXTURE_ROOT = resolve(HERE, 'fixtures/late-console-teardown');
const ABLATION_CONFIG = resolve(FIXTURE_ROOT, 'vitest.unguarded.config.ts');

/** The exact message vitest 4.1.10 rejects a pending console RPC with. */
const TEARDOWN_ERROR = 'Closing rpc while "onUserConsoleLog" was pending';

/** Attempts allowed to the ablation leg before it is declared broken. */
const ABLATION_ATTEMPTS = 8;
/** Repetitions of the guarded leg. A removed guard reproduces ~80% per run. */
const GUARDED_REPETITIONS = 4;

interface Leg {
  readonly status: number | null;
  readonly output: string;
  readonly reproduced: boolean;
  readonly collectedOneFile: boolean;
}

/**
 * `-c` is resolved RELATIVE TO `--root`, so both paths are absolute here; a
 * relative config path silently becomes `<root>/<path>` and the run dies in
 * config loading rather than measuring anything.
 *
 * The child's environment drops vitest's own worker variables: this process IS
 * a vitest worker, and leaking `VITEST_POOL_ID` / `VITEST_WORKER_ID` into a
 * nested run makes the child believe it was spawned by a pool.
 */
function runFixture(config: string): Leg {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITEST')) delete env[key];
  }
  delete env.NODE_V8_COVERAGE;

  const result = spawnSync(VITEST_BIN, ['run', '-c', config, '--root', FIXTURE_ROOT], {
    encoding: 'utf8',
    timeout: 120_000,
    env,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return {
    status: result.status,
    output,
    reproduced: output.includes(TEARDOWN_ERROR),
    collectedOneFile: /Test Files\s+1 passed \(1\)/.test(output),
  };
}

describe('[#10293] vitest console-forwarding teardown race', () => {
  it('has a fixture and an ablation config to measure against', () => {
    expect(existsSync(VITEST_BIN), `vitest binary missing at ${VITEST_BIN}`).toBe(true);
    expect(existsSync(resolve(FIXTURE_ROOT, 'leaked-console.test.ts'))).toBe(true);
    expect(existsSync(ABLATION_CONFIG)).toBe(true);
  });

  it(
    'ABLATION: the fixture still reddens a green run under vitest defaults',
    { timeout: 240_000 },
    () => {
      const attempts: Leg[] = [];
      for (let i = 0; i < ABLATION_ATTEMPTS; i++) {
        const leg = runFixture(ABLATION_CONFIG);
        attempts.push(leg);
        if (leg.reproduced) break;
      }

      // A run that collected no test file exits 0 and would read as "the harm
      // is gone". Grade collection before grading the harm.
      expect(
        attempts.every((leg) => leg.collectedOneFile),
        'the fixture was not collected — the ablation measured nothing',
      ).toBe(true);

      const reproduced = attempts.find((leg) => leg.reproduced);
      expect(
        reproduced,
        `the instrument stopped reproducing: ${attempts.length} attempts under vitest ` +
          `defaults produced no "${TEARDOWN_ERROR}". Either vitest changed its console ` +
          `forwarding (check sendLog/rpcDone in its dist chunks) or the fixture stopped ` +
          `leaking. Do NOT relax the guarded leg on the strength of this.`,
      ).toBeDefined();

      // Every assertion in the fixture passed, and the run still failed. That
      // conjunction is the whole defect.
      expect(reproduced?.status).not.toBe(0);
      expect(reproduced?.output).toContain('Tests  1 passed (1)');
    },
  );

  it(
    'GUARDED: the same fixture exits 0 under this app’s real vitest config',
    { timeout: 240_000 },
    () => {
      const legs = Array.from({ length: GUARDED_REPETITIONS }, () => runFixture(APP_CONFIG));

      expect(
        legs.every((leg) => leg.collectedOneFile),
        'the fixture was not collected under the app config — this leg measured nothing',
      ).toBe(true);

      const teardownErrors = legs.filter((leg) => leg.reproduced);
      expect(
        teardownErrors.length,
        `${teardownErrors.length}/${legs.length} runs hit the teardown race under the app's ` +
          `own config. If disableConsoleIntercept was removed from vitest.config.ts, restore ` +
          `it — the docblock there explains why.\n${teardownErrors[0]?.output ?? ''}`,
      ).toBe(0);

      expect(legs.map((leg) => leg.status)).toEqual(legs.map(() => 0));
    },
  );
});
