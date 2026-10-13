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
 * WHAT THIS PIN ASSERTS, and why it spawns vitest instead of asserting inline.
 * The failure happens during worker teardown, i.e. strictly AFTER every test in
 * the file has finished — no assertion inside the affected file can observe it.
 * So the pin drives a real vitest process over a fixture that deliberately
 * leaks a logging callback (`test/fixtures/late-console-teardown/`):
 *
 *   - the ABLATION leg runs it under vitest's defaults and requires the
 *     teardown rejection to still be produced — a positive control, so this
 *     pin can never go quietly green because the fixture stopped provoking
 *     anything;
 *   - the GUARDED leg runs the SAME fixture under this app's real
 *     `vitest.config.ts` and requires no rejection and exit 0.
 *
 * Delete `disableConsoleIntercept: true` from that config and the guarded leg
 * turns red. Both legs also assert `Test Files  1 passed (1)`, because a run
 * that collected NOTHING exits 0 too and would read as a pass.
 *
 * WHY IT READ AS LOAD-DEPENDENT, AND WHY THIS PIN NO LONGER IS. The race has
 * TWO windows, both vitest's, and a green run exits 1 only when both open:
 *
 *   1. in the WORKER, a console RPC still unacknowledged when the teardown
 *      sweep runs — created after `rpcDone()` took its snapshot;
 *   2. in the MAIN process, the worker's report of that rejection arriving
 *      before vitest reads its unhandled errors for the exit code. The worker
 *      sends it only AFTER it reports the file finished, so a busy box loses
 *      this one too.
 *
 * Idle, both open nearly every time; under concurrent node processes — what a
 * full-repo `turbo run test` is made of — neither reliably does. This pin used
 * to live with that: up to eight ablation attempts, four guarded repetitions,
 * a premise probe to tell "did not fire" from "cannot fire", and a SKIP when
 * the race stayed shut. That cost 12 child vitest runs on a loaded runner,
 * which is how this file came to be the slowest in its package (20.8 s).
 *
 * Now both legs run their child with a HARNESS REPORTER
 * (`test/fixtures/late-console-teardown/hold-console-acks.reporter.ts`) that
 * replaces both clocks with ordering facts, and its docblock carries the
 * argument in full:
 *
 *   - window 1 is HELD OPEN: the main process acknowledges console log N only
 *     when log N+1 arrives, so the newest console RPC is always unacknowledged
 *     and the sweep always finds one pending — no load, no luck;
 *   - window 2 is READ, not raced: at main-process exit every worker has
 *     answered `stop`, after sending its rejection report on the same ordered
 *     channel, so the reporter's verdict file records every rejection the run
 *     produced (`delivered`) beside the ones vitest's exit code saw (`graded`).
 *
 * Measured on this container (4 vCPU), one child run per attempt, each arm
 * under the shared verify lock with its control in the same window:
 *
 *                                       teardown rejection    exit 1
 *     idle, vitest defaults, no hold          20/20            20/20
 *     idle, ablation config + hold            40/40            40/40
 *     4 concurrent vitest, defaults           4/20             4/20
 *     4 concurrent vitest, ablation + hold    40/40            32/40
 *     4 concurrent vitest, app config + hold  0/10             0/10
 *     4 concurrent vitest, guard removed      20/20            19/20
 *       (app config + hold, interception re-armed)
 *
 * The last column is window 2 doing what it always did; the middle column is
 * the defect, and it no longer depends on the box. So each leg runs ONCE, the
 * ablation grades on `delivered`, the exit code is held to `graded`, and there
 * is no skip: a premise-intact ablation that delivers nothing is a broken
 * instrument, and fails as one.
 *
 * WHAT THE PREMISE PROBE IS FOR NOW. It still reads the installed vitest and
 * asserts, deterministically, that every link the race walks is there — now
 * including the main-process link the hold leans on (the console RPC handler
 * awaiting the reporters). When the ablation fails it says WHICH of the two
 * moved, vitest or this pin:
 *
 *     premise intact + rejection delivered  → pass
 *     premise intact + nothing delivered    → FAIL: the hold no longer opens
 *                                             window 1 — repair the instrument
 *     premise BROKEN + nothing delivered    → FAIL: vitest changed underneath
 *                                             us; this pin's defect may be
 *                                             fixed upstream
 *     premise BROKEN + rejection delivered  → FAIL: the probe is stale
 *
 * ⛔ And none of it relaxes the GUARDED leg, which is the one that protects the
 * merge queue: it requires zero delivered rejections AND exit 0. With the hold
 * on that leg too, deleting `disableConsoleIntercept: true` from the app
 * config reddens it on the first run, every run — where four unheld
 * repetitions used to miss a removed guard on a loaded runner more often than
 * they caught it.
 *
 * ⚠️ WHY THE CHILD'S OUTPUT IS NORMALISED BEFORE ANYTHING READS IT. Every
 * predicate below is a substring of a REPORTER line, and vitest 4 decides both
 * the colour and the reporter from the environment it finds itself in:
 * `std-env`'s `isAgent` — true when `AI_AGENT`, `CLAUDECODE` and friends are
 * set, i.e. in the shell an agent authors this from — makes it call
 * tinyrainbow's `disableDefaultColors()` and select the `agent` reporter. A CI
 * runner has none of those variables, so the SAME summary line arrives with
 * escapes sitting BETWEEN `Test Files` and its count, and a regex written
 * against the plain line matches in an agent shell and can never match in CI.
 * Measured, on this pin's own first red: the anti-vacuity guard below refused
 * to grade a run it could not read, and was right to. So the child is asked for
 * plain bytes AND the captured text is stripped before it is read — the guard
 * is never the thing that bends.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';

import {
  FORWARDED_METHOD,
  TEARDOWN_ERROR,
  TEARDOWN_MESSAGE_TEMPLATE,
  VERDICT_OUTPUT_KEY,
  VERDICT_SCHEMA,
  type HoldVerdict,
} from './fixtures/late-console-teardown/hold-console-acks.reporter.js';

// `process.cwd()` is this package's established seed for its own files
// (`test/coverage.test.ts`, `test/inert-wirings.test.ts`) and the one the
// `types/node-shim.d.ts` surface is cut for. `import.meta.url` is NOT available
// here: this package compiles as CommonJS under `module: NodeNext`, so
// `tsc --noEmit` rejects it with TS1470.
const PACKAGE_ROOT = process.cwd();

const VITEST_BIN = `${PACKAGE_ROOT}/node_modules/.bin/vitest`;
const APP_CONFIG = `${PACKAGE_ROOT}/vitest.config.ts`;
const FIXTURE_ROOT = `${PACKAGE_ROOT}/test/fixtures/late-console-teardown`;
const ABLATION_CONFIG = `${FIXTURE_ROOT}/vitest.unguarded.config.ts`;
const HOLD_REPORTER = `${FIXTURE_ROOT}/hold-console-acks.reporter.ts`;

// The premise probe reads the SAME vitest the child runs — reached through this
// package's own `node_modules`, the way `VITEST_BIN` above is, so the two can
// never end up describing different installs. rollup content-hashes the chunk
// names, so each is found by prefix rather than named.
const VITEST_CHUNKS = `${PACKAGE_ROOT}/node_modules/vitest/dist/chunks`;

// `TEARDOWN_MESSAGE_TEMPLATE`, `FORWARDED_METHOD` and the derived
// `TEARDOWN_ERROR` come from the hold reporter, which classifies the child's
// unhandled errors by the very same string this probe and these assertions use
// — one spelling, so the two can never drift apart silently.

/** The forwarding call whose returned promise `sendLog` throws away. */
const FORWARDING_CALL = `state().rpc.${FORWARDED_METHOD}(`;

/**
 * The main-process link the hold leans on: the console RPC handler awaits the
 * test run's log, which awaits every reporter's `onUserConsoleLog`. Both lines
 * verbatim from `cli-api.*.js`.
 */
const HANDLER_AWAITS_LOG = 'await vitest._testRun.log(log)';
const LOG_AWAITS_REPORTERS = `await this.vitest.report("${FORWARDED_METHOD}", log)`;

interface Leg {
  readonly status: number | null;
  /** The child's combined stdout+stderr, ALREADY stripped of ANSI escapes. */
  readonly output: string;
  /** What the hold reporter wrote at the child's exit; `null` when it wrote nothing readable. */
  readonly verdict: HoldVerdict | null;
  /** Teardown rejections the child's main process received, late ones included (0 when no verdict). */
  readonly delivered: number;
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
 *
 * It also pins the child to PLAIN, ENVIRONMENT-INDEPENDENT output, for the
 * reason in this file's docblock:
 *   - `NO_COLOR` is the one switch tinyrainbow short-circuits on, ahead of
 *     every enabling condition, so it turns colour off wherever the child runs.
 *     `FORCE_COLOR` is DELETED rather than set to `'0'`, because tinyrainbow
 *     tests its PRESENCE (`'FORCE_COLOR' in env`) — the disabling spelling
 *     would have switched colour ON.
 *   - `--reporter=default` NAMES the reporter instead of letting vitest pick it
 *     from `isAgent`, which is how the author and CI came to read two different
 *     summary formats out of the same fixture.
 * Then `stripVTControlCharacters` runs over the captured bytes anyway: belt and
 * braces, so an escape arriving from some other source cannot quietly
 * un-measure this pin the way one already did.
 *
 * BOTH legs carry the hold reporter, so the one variable between them stays
 * the guard. Its verdict file lives in a fresh temporary directory per run and
 * is removed with it; a run that leaves no verdict, or one in another schema,
 * reads as `verdict: null` — measured nothing — never as zero rejections.
 */
function runFixture(config: string): Leg {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITEST')) delete env[key];
  }
  delete env.NODE_V8_COVERAGE;
  delete env.FORCE_COLOR;
  env.NO_COLOR = '1';

  const scratch = mkdtempSync(`${tmpdir()}/teardown-race-`);
  const verdictFile = `${scratch}/verdict.json`;
  try {
    const result = spawnSync(
      VITEST_BIN,
      [
        'run',
        '-c',
        config,
        '--root',
        FIXTURE_ROOT,
        '--reporter=default',
        `--reporter=${HOLD_REPORTER}`,
        `--outputFile.${VERDICT_OUTPUT_KEY}=${verdictFile}`,
      ],
      {
        encoding: 'utf8',
        timeout: 120_000,
        env,
      },
    );

    const output = stripVTControlCharacters(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    let verdict: HoldVerdict | null = null;
    if (existsSync(verdictFile)) {
      const parsed = JSON.parse(readFileSync(verdictFile, 'utf8')) as Partial<HoldVerdict>;
      verdict = parsed.schema === VERDICT_SCHEMA ? (parsed as HoldVerdict) : null;
    }
    return {
      status: result.status,
      output,
      verdict,
      delivered: verdict?.delivered ?? 0,
      collectedOneFile: /Test Files\s+1 passed \(1\)/.test(output),
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * THE PREMISE PROBE (#11939).
 *
 * Facts about the installed vitest, each one a link in the chain the ablation
 * walks at run time, each readable without running anything. Together they
 * answer the question a silent ablation cannot answer by itself: did vitest
 * change, or did this pin's instrument break? A broken link is deterministic,
 * and no retry budget touches it.
 *
 * The chunks are UNMINIFIED in a published vitest, which is why the markers can
 * be this specific. Each is a statement about SHAPE, not formatting: what
 * `sendLog` does with the promise, what `rpcDone` awaits, what runs after it,
 * how the rejection is worded — and [#23185] whether the main process still
 * holds a console RPC open until the reporters settle, which is the one link
 * the hold reporter adds rather than finds.
 */
interface ChunkSources {
  readonly consoleFile: string;
  readonly consoleSource: string;
  readonly rpcFile: string;
  readonly rpcSource: string;
  readonly initFile: string;
  readonly initSource: string;
  readonly cliApiFile: string;
  readonly cliApiSource: string;
}

interface PremiseMarker {
  readonly name: string;
  readonly chunk: string;
  readonly holds: boolean;
  /** What its absence would MEAN — the sentence a failing run needs. */
  readonly meaning: string;
}

interface Premise {
  readonly intact: boolean;
  readonly markers: readonly PremiseMarker[];
}

/** The one `<prefix>.<hash>.js` chunk, or a failure that names what it saw. */
function readChunk(prefix: string): { file: string; source: string } {
  const matches = readdirSync(VITEST_CHUNKS, { withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(`${prefix}.`) && name.endsWith('.js'));

  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one "${prefix}.*.js" chunk under ${VITEST_CHUNKS}, found ` +
        `${matches.length} (${matches.join(', ') || 'none'}). vitest's dist layout moved, so ` +
        `this pin can no longer read the mechanism it guards — repoint the probe, do NOT ` +
        `relax either leg.`,
    );
  }

  return { file: matches[0], source: readFileSync(`${VITEST_CHUNKS}/${matches[0]}`, 'utf8') };
}

function readChunks(): ChunkSources {
  const consoleChunk = readChunk('console');
  const rpcChunk = readChunk('rpc');
  const initChunk = readChunk('init');
  const cliApiChunk = readChunk('cli-api');
  return {
    consoleFile: consoleChunk.file,
    consoleSource: consoleChunk.source,
    rpcFile: rpcChunk.file,
    rpcSource: rpcChunk.source,
    initFile: initChunk.file,
    initSource: initChunk.source,
    cliApiFile: cliApiChunk.file,
    cliApiSource: cliApiChunk.source,
  };
}

/**
 * Pure, so the control test below can feed it a MUTATED copy of the real chunks
 * and prove each marker reports BROKEN when the shape it names is fixed. A
 * probe whose only observed value is "intact" is green three ways — the shape
 * is there, the predicate matches nothing, or the file it reads moved — and
 * this one is not allowed to be.
 */
function evaluatePremise(chunks: ChunkSources): Premise {
  // 1. `sendLog` calls the forwarder as a BARE STATEMENT: nothing on the line
  //    before it (no `await`, no `return`, no assignment) and no `.then`/
  //    `.catch` on the statement. That is what leaves the rejection unhandled;
  //    handle it anywhere and the defect is gone.
  const callAt = chunks.consoleSource.indexOf(FORWARDING_CALL);
  const lineStart = callAt < 0 ? 0 : chunks.consoleSource.lastIndexOf('\n', callAt) + 1;
  const beforeCall = callAt < 0 ? '' : chunks.consoleSource.slice(lineStart, callAt);
  const statementEnd = callAt < 0 ? -1 : chunks.consoleSource.indexOf(';', callAt);
  const statement =
    callAt < 0
      ? ''
      : chunks.consoleSource.slice(
          callAt,
          statementEnd < 0 ? chunks.consoleSource.length : statementEnd,
        );
  const discardsForwardingPromise =
    callAt >= 0 && /^\s*$/.test(beforeCall) && !/\.(then|catch|finally)\s*\(/.test(statement);

  // 2. `rpcDone()` awaits a SNAPSHOT rather than draining until empty. This is
  //    the link that lets a call created a moment later be missed entirely.
  const rpcDoneAt = chunks.rpcSource.indexOf('async function rpcDone()');
  const rpcDoneEnd = rpcDoneAt < 0 ? -1 : chunks.rpcSource.indexOf('\n}', rpcDoneAt);
  const rpcDoneBody =
    rpcDoneAt < 0
      ? ''
      : chunks.rpcSource.slice(rpcDoneAt, rpcDoneEnd < 0 ? chunks.rpcSource.length : rpcDoneEnd);
  const drainsASnapshot = rpcDoneAt >= 0 && rpcDoneBody.includes('Array.from(promises)');

  // 3. The teardown still drains and THEN runs its cleanups — the ordering that
  //    puts the rejection sweep after the snapshot was taken.
  const drainAt = chunks.initSource.indexOf('await rpcDone()');
  const afterDrain = drainAt < 0 ? '' : chunks.initSource.slice(drainAt, drainAt + 200);
  const sweepFollowsDrain = drainAt >= 0 && afterDrain.includes('cleanups.map(');

  // 4. The sweep REJECTS what is still pending, rather than settling it.
  const sweepRejectsPendingCalls = chunks.initSource.includes('$rejectPendingCalls(');

  // 5. And it words the rejection the way the ablation's grep expects. If this
  //    is the only broken marker, the defect is untouched and only the string
  //    moved — a one-line repair, and one that is invisible without this check.
  const rejectionWordingUnchanged = chunks.initSource.includes(TEARDOWN_MESSAGE_TEMPLATE);

  // 6. [#23185] The MAIN process answers a console RPC only once every
  //    reporter's `onUserConsoleLog` has settled: the handler awaits the test
  //    run's log, and the log awaits the reporters. That is what lets the hold
  //    reporter keep the newest console RPC unacknowledged — and so what makes
  //    the ablation deterministic. Answer the RPC first and the hold holds
  //    nothing: the race is back to the box's mercy.
  const ackAwaitsReporters =
    chunks.cliApiSource.includes(HANDLER_AWAITS_LOG) && chunks.cliApiSource.includes(LOG_AWAITS_REPORTERS);

  const markers: readonly PremiseMarker[] = [
    {
      name: 'sendLog discards the forwarding promise',
      chunk: chunks.consoleFile,
      holds: discardsForwardingPromise,
      meaning:
        'vitest now holds, awaits or catches the console-forwarding promise, so a rejected ' +
        'console RPC can no longer surface as an unhandled error',
    },
    {
      name: 'rpcDone awaits a snapshot of pending calls',
      chunk: chunks.rpcFile,
      holds: drainsASnapshot,
      meaning:
        'vitest no longer drains a snapshot, so a call created after the drain began is no ' +
        'longer missed',
    },
    {
      name: 'the cleanup sweep runs after the drain',
      chunk: chunks.initFile,
      holds: sweepFollowsDrain,
      meaning: 'teardown no longer drains the RPC and then runs its cleanups in that order',
    },
    {
      name: 'the sweep rejects still-pending calls',
      chunk: chunks.initFile,
      holds: sweepRejectsPendingCalls,
      meaning: 'teardown no longer rejects what is still pending when it closes the channel',
    },
    {
      name: 'the rejection wording still yields the grepped string',
      chunk: chunks.initFile,
      holds: rejectionWordingUnchanged,
      meaning:
        `vitest reworded the rejection, so the hold reporter's count of "${TEARDOWN_ERROR}" can ` +
        'never match again — the mechanism may be entirely intact',
    },
    {
      name: 'the console RPC is acknowledged only after the reporters settle',
      chunk: chunks.cliApiFile,
      holds: ackAwaitsReporters,
      meaning:
        'the main process now answers a console RPC without awaiting its reporters, so the hold ' +
        "reporter can no longer keep one open across the teardown sweep — the ablation's " +
        'determinism rests on exactly this',
    },
  ];

  return { intact: markers.every((marker) => marker.holds), markers };
}

function describePremise(premise: Premise): string {
  return premise.markers
    .map(
      (marker) =>
        `\n  ${marker.holds ? 'intact' : 'BROKEN'}  ${marker.name} [${marker.chunk}]` +
        (marker.holds ? '' : `\n          ⇒ ${marker.meaning}`),
    )
    .join('');
}

/**
 * The anti-vacuity guards below grade the CHILD, whose output is captured and
 * therefore never reaches the job log on its own. Saying only "measured
 * nothing" leaves a CI-only failure undiagnosable from the log it fails in —
 * measured, at the cost of one round trip. So every graded run names its exit
 * status and its verdict, and shows the tail of what it actually wrote.
 */
function describeRun(leg: Leg): string {
  const tail = leg.output.trimEnd().split('\n').slice(-15).join('\n');
  return (
    `\n--- child run: exit=${leg.status}, collectedOneFile=${leg.collectedOneFile}, ` +
    `verdict=${leg.verdict ? JSON.stringify(leg.verdict) : 'NONE (the hold reporter wrote nothing readable)'}\n` +
    `${tail === '' ? '(the child wrote nothing at all)' : tail}`
  );
}

describe('[#10293] vitest console-forwarding teardown race', () => {
  it('has a fixture, an ablation config and the hold reporter to measure with', () => {
    expect(existsSync(VITEST_BIN), `vitest binary missing at ${VITEST_BIN}`).toBe(true);
    expect(existsSync(`${FIXTURE_ROOT}/leaked-console.test.ts`)).toBe(true);
    expect(existsSync(ABLATION_CONFIG)).toBe(true);
    expect(existsSync(HOLD_REPORTER)).toBe(true);
  });

  it('PREMISE: the installed vitest still has the shape this pin exploits', () => {
    const premise = evaluatePremise(readChunks());

    expect(
      premise.intact,
      `vitest's console-forwarding teardown shape CHANGED. This is deterministic, not a ` +
        `flake, and no retry budget touches it:${describePremise(premise)}\n\n` +
        `If the mechanism really is gone upstream, this pin's defect is fixed and the whole ` +
        `file — including \`disableConsoleIntercept\` in vitest.config.ts — should be retired ` +
        `deliberately, in one considered change. Until then, do NOT relax the GUARDED leg: it ` +
        `is what keeps the merge queue safe, and a changed premise is not evidence about it.`,
    ).toBe(true);
  });

  it('PREMISE CONTROL: the probe reports BROKEN when the shape it pins is fixed', () => {
    const real = readChunks();
    expect(evaluatePremise(real).intact, 'the control needs an intact baseline to mutate').toBe(
      true,
    );

    // Each case is a MINIMAL edit modelling the upstream fix that would kill
    // one link, applied to the real chunk text. `mutate` returning an unchanged
    // string is the failure this whole file exists to notice, so it is asserted
    // rather than assumed: a no-op edit would make every case below pass while
    // measuring nothing at all.
    const cases: ReadonlyArray<{
      readonly marker: string;
      readonly mutate: (chunks: ChunkSources) => ChunkSources;
    }> = [
      {
        marker: 'sendLog discards the forwarding promise',
        mutate: (chunks) => ({
          ...chunks,
          consoleSource: chunks.consoleSource.replace(
            FORWARDING_CALL,
            `await ${FORWARDING_CALL}`,
          ),
        }),
      },
      {
        marker: 'sendLog discards the forwarding promise',
        mutate: (chunks) => {
          // `...onUserConsoleLog({ … }).catch(() => {});` — the other shape the
          // fix takes, and the one a line-anchored check would miss.
          const at = chunks.consoleSource.indexOf(FORWARDING_CALL);
          const end = chunks.consoleSource.indexOf(';', at);
          return {
            ...chunks,
            consoleSource:
              chunks.consoleSource.slice(0, end) +
              '.catch(() => {})' +
              chunks.consoleSource.slice(end),
          };
        },
      },
      {
        marker: 'rpcDone awaits a snapshot of pending calls',
        mutate: (chunks) => ({
          ...chunks,
          rpcSource: chunks.rpcSource.replace('Array.from(promises)', 'drainUntilEmpty(promises)'),
        }),
      },
      {
        marker: 'the cleanup sweep runs after the drain',
        mutate: (chunks) => ({
          ...chunks,
          initSource: chunks.initSource.replace('await rpcDone()', 'await Promise.resolve()'),
        }),
      },
      {
        marker: 'the sweep rejects still-pending calls',
        mutate: (chunks) => ({
          ...chunks,
          initSource: chunks.initSource.replace('$rejectPendingCalls(', '$settlePendingCalls('),
        }),
      },
      {
        marker: 'the rejection wording still yields the grepped string',
        mutate: (chunks) => ({
          ...chunks,
          initSource: chunks.initSource.replace(
            TEARDOWN_MESSAGE_TEMPLATE,
            'Closing rpc while "${method}" was in flight',
          ),
        }),
      },
      {
        // The upstream change that would end the hold: report the log without
        // holding the RPC open for it.
        marker: 'the console RPC is acknowledged only after the reporters settle',
        mutate: (chunks) => ({
          ...chunks,
          cliApiSource: chunks.cliApiSource.replace(LOG_AWAITS_REPORTERS, LOG_AWAITS_REPORTERS.replace('await ', '')),
        }),
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const mutated = testCase.mutate(real);

      const changed =
        mutated.consoleSource !== real.consoleSource ||
        mutated.rpcSource !== real.rpcSource ||
        mutated.initSource !== real.initSource ||
        mutated.cliApiSource !== real.cliApiSource;
      expect(
        changed,
        `case ${index} ("${testCase.marker}") edited nothing — its anchor no longer occurs in ` +
          `the installed vitest, so this case has been measuring a probe against an unmodified ` +
          `input and passing for the wrong reason.`,
      ).toBe(true);

      const premise = evaluatePremise(mutated);
      const broken = premise.markers.filter((marker) => !marker.holds).map((marker) => marker.name);
      expect(
        broken,
        `case ${index} should break exactly "${testCase.marker}" and nothing else`,
      ).toEqual([testCase.marker]);
      expect(premise.intact).toBe(false);
    }
  });

  it(
    'ABLATION: the fixture still provokes the teardown rejection under vitest defaults',
    { timeout: 240_000 },
    () => {
      const premise = evaluatePremise(readChunks());
      const leg = runFixture(ABLATION_CONFIG);

      // A run that collected no test file exits 0, and one whose hold reporter
      // wrote no verdict says nothing about the rejection either way. Grade
      // both before grading the harm.
      expect(
        leg.collectedOneFile && leg.verdict !== null,
        `the ablation measured nothing — no collected file, or no verdict from the hold reporter. ` +
          `What the child run actually wrote:${describeRun(leg)}`,
      ).toBe(true);
      expect(leg.output, 'every assertion in the fixture must pass — the harm is a GREEN run').toContain(
        'Tests  1 passed (1)',
      );

      const reproduced = leg.delivered > 0;

      // The grading matrix. The hold makes the rejection deterministic, so a
      // silent run is never a load flake: the premise probe says whether vitest
      // moved or this pin's instrument did.
      expect(
        premise.intact,
        reproduced
          ? `the PREMISE PROBE IS STALE, not vitest: the child's main process received ` +
              `${leg.delivered} "${TEARDOWN_ERROR}" rejection(s) while the probe reads the mechanism ` +
              `as changed:${describePremise(premise)}\n\nRepair the probe to match the installed ` +
              `vitest. Nothing about either leg's assertion is in question here.`
          : `the INSTRUMENT IS DEAD: no "${TEARDOWN_ERROR}" rejection reached the child's main ` +
              `process AND the mechanism no longer reads as present in the installed ` +
              `vitest:${describePremise(premise)}\n\nTreat it as an upstream change. Do NOT relax ` +
              `the GUARDED leg on the strength of this.${describeRun(leg)}`,
      ).toBe(true);
      expect(
        reproduced,
        `every link of the mechanism reads as INTACT, yet no "${TEARDOWN_ERROR}" rejection reached ` +
          `the child's main process. With the hold reporter that is not the box being too busy — ` +
          `it means the hold no longer keeps a console RPC open across the teardown sweep (or the ` +
          `fixture stopped logging after its test). Repair the instrument; never retry it ` +
          `green.${describeRun(leg)}`,
      ).toBe(true);

      // Window 2 (see the hold reporter): a rejection vitest's run-end report
      // saw must have turned the green run red — every assertion passed, and
      // the run still failed. That conjunction is the whole defect. A rejection
      // that reached the main process only AFTER vitest graded the run is the
      // same defect losing vitest's own second race; it is counted in
      // `delivered` above and owes no exit code.
      expect(leg.verdict?.graded, `vitest's run never reached its run-end report:${describeRun(leg)}`).not.toBeNull();
      if ((leg.verdict?.graded ?? 0) > 0) {
        expect(leg.status, `vitest graded the rejection but exited 0:${describeRun(leg)}`).not.toBe(0);
        expect(leg.output).toContain(TEARDOWN_ERROR);
      }
    },
  );

  it(
    'GUARDED: the same fixture exits 0 under this app’s real vitest config',
    { timeout: 240_000 },
    () => {
      const leg = runFixture(APP_CONFIG);

      expect(
        leg.collectedOneFile && leg.verdict !== null,
        `the guarded leg measured nothing — no collected file, or no verdict from the hold ` +
          `reporter. What the child run actually wrote:${describeRun(leg)}`,
      ).toBe(true);

      // Counted at the child's exit, so a rejection that lost vitest's own
      // grading race is caught here too — the exit code alone would read it as
      // a pass.
      expect(
        leg.delivered,
        `the teardown race fired under the app's own config: ${leg.delivered} "${TEARDOWN_ERROR}" ` +
          `rejection(s) reached the child's main process. If disableConsoleIntercept was removed ` +
          `from vitest.config.ts, restore it — the docblock there explains why.${describeRun(leg)}`,
      ).toBe(0);
      expect(leg.status, `the guarded run exited non-zero:${describeRun(leg)}`).toBe(0);
    },
  );
});
