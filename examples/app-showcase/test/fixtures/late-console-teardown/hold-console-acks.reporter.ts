// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * HARNESS REPORTER — not part of this app's suite. Loaded only into the CHILD
 * vitest that `test/vitest-console-teardown-race.test.ts` spawns, on BOTH of
 * its legs, through `--reporter=<this file>`. It turns the teardown race that
 * pin measures from a coin flip into a certainty, and it reports what it saw
 * in a verdict file instead of leaving the pin to infer it from an exit code.
 *
 * THE RACE HAS TWO WINDOWS, and a green-run-exits-1 needs both to open:
 *
 *   1. In the WORKER: a console RPC still unacknowledged when teardown's
 *      `$rejectPendingCalls` sweep runs, i.e. created after `rpcDone()` took
 *      its snapshot. That rejection is the defect.
 *   2. In the MAIN process: the worker reports the rejection AFTER it reports
 *      the file finished (the unhandled-rejection event fires only once the
 *      worker's microtasks drain), and vitest reads its unhandled errors for
 *      the exit code as soon as the pool settles. A report arriving after that
 *      read is recorded and never graded — the run exits 0.
 *
 * Measured on a 4-vCPU container with four concurrent vitest loops running
 * beside the measurement (this change's PR body carries the runs): vitest's
 * defaults alone reproduced 4/20 (both windows); with this reporter window 1
 * opened 40/40, and window 2 then decided the exit code — 32 of those 40 were
 * graded in time and exited 1, 8 arrived late and exited 0.
 *
 * WINDOW 1 — WHAT THE HOLD DOES. vitest's main process answers a console RPC
 * only after every reporter's `onUserConsoleLog` has settled (it awaits
 * `report('onUserConsoleLog', …)` inside the RPC handler — the pin's premise
 * probe checks that). So this reporter acknowledges console log N only when
 * log N+1 arrives. The invariant that follows needs no clock: the NEWEST
 * console RPC the worker has sent is always unacknowledged. `rpcDone()` cannot
 * resolve until its snapshot's newest member is acknowledged, which takes a
 * LATER log — one not in the snapshot, and itself unacknowledged until a log
 * later still. The sweep runs in the microtasks after that acknowledgment
 * lands, with no timer phase in between in which the worker could log again,
 * so it always finds that later log pending. The fixture's loop is what keeps
 * logging; without a log after the snapshot, teardown would wait here forever
 * (the pin's spawn timeout bounds that), which is why the fixture's leak IS
 * the instrument.
 *
 * WINDOW 2 — WHY IT IS READ, NOT CLOSED. It is vitest's own, and no reporter
 * hook runs between the pool settling and the exit-code read. But the worker
 * sends its rejection report before its `stopped` reply on the same ordered
 * channel, and vitest awaits every worker's stop before the main process
 * exits. So at process EXIT the unhandled-error set is final, and this
 * reporter writes it down then: `delivered` (every teardown rejection the main
 * process received) beside `graded` (the ones vitest's run-end report, and so
 * its exit code, saw). The pin grades the defect on `delivered`, and holds the
 * exit code to `graded`.
 *
 * Under this app's real config (`disableConsoleIntercept: true`) no console
 * write crosses the RPC at all, so nothing is held and `delivered` is 0 —
 * which is the whole guard.
 *
 * The verdict path arrives as `--outputFile.holdConsoleAcks=<path>` — vitest's
 * own per-reporter output-file option. A run without it refuses at init, so a
 * mis-spawned child fails loudly instead of measuring nothing.
 */

import { writeFileSync } from 'node:fs';
import type { Reporter, SerializedError, TestModule, Vitest } from 'vitest/node';

/**
 * vitest's rejection wording, verbatim from `init.*.js`, with its
 * interpolation left as source text so the pin's premise probe can look for
 * the template itself.
 *
 * `TEARDOWN_ERROR` is DERIVED from it rather than written out a second time,
 * and the pin imports all three from here: this reporter classifies errors by
 * the very string the pin's probe and assertions use, and the failure mode the
 * pin guards against is those drifting apart silently.
 */
export const TEARDOWN_MESSAGE_TEMPLATE = 'Closing rpc while "${method}" was pending';
export const FORWARDED_METHOD = 'onUserConsoleLog';

/** The exact message vitest rejects a pending console RPC with. */
export const TEARDOWN_ERROR = TEARDOWN_MESSAGE_TEMPLATE.replace('${method}', FORWARDED_METHOD);

/** The `--outputFile.<key>` this reporter reads its verdict path from. */
export const VERDICT_OUTPUT_KEY = 'holdConsoleAcks';

/** Bumped whenever a field's meaning changes, so a stale reader refuses. */
export const VERDICT_SCHEMA = 'hold-console-acks/1';

export interface HoldVerdict {
  readonly schema: typeof VERDICT_SCHEMA;
  /** Console RPCs the main process received from the worker. */
  readonly consoleLogs: number;
  /** Teardown rejections in vitest's run-end report — the ones its exit code saw. `null`: the run never ended. */
  readonly graded: number | null;
  /** Teardown rejections the main process received by the time it exited, late ones included. */
  readonly delivered: number;
}

function countTeardownRejections(errors: readonly unknown[]): number {
  return errors.filter((error) =>
    String((error as { message?: unknown } | null)?.message ?? '').includes(TEARDOWN_ERROR),
  ).length;
}

export default class HoldConsoleAcks implements Reporter {
  /** Acknowledges the newest console RPC, which is always the one held. */
  private releaseHeld: (() => void) | undefined;
  private consoleLogs = 0;
  private graded: number | null = null;

  onInit(vitest: Vitest): void {
    const outputFile = vitest.config.outputFile;
    const verdictPath =
      typeof outputFile === 'object' && outputFile !== null
        ? (outputFile as Record<string, unknown>)[VERDICT_OUTPUT_KEY]
        : undefined;
    if (typeof verdictPath !== 'string' || verdictPath === '') {
      throw new Error(
        `hold-console-acks: no --outputFile.${VERDICT_OUTPUT_KEY}=<path> was given, so this run ` +
          'would measure nothing anyone can read. It is spawned by ' +
          'test/vitest-console-teardown-race.test.ts, which always passes one.',
      );
    }

    // At exit every worker has answered `stop`, and each one sent its
    // rejection report before that answer — so the set read here is final.
    // `state` is vitest's experimental State API; if it moves, this throws
    // at exit, no verdict is written, and the pin refuses the run as one that
    // measured nothing — loud, never a pass.
    process.once('exit', () => {
      const verdict: HoldVerdict = {
        schema: VERDICT_SCHEMA,
        consoleLogs: this.consoleLogs,
        graded: this.graded,
        delivered: countTeardownRejections(vitest.state.getUnhandledErrors()),
      };
      writeFileSync(verdictPath, JSON.stringify(verdict));
    });
  }

  onUserConsoleLog(): Promise<void> {
    this.consoleLogs += 1;
    const previous = this.releaseHeld;
    const held = new Promise<void>((resolve) => {
      this.releaseHeld = resolve;
    });
    previous?.();
    return held;
  }

  onTestRunEnd(_testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<SerializedError>): void {
    this.graded = countTeardownRejections(unhandledErrors);
  }
}
