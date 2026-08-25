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
 * ⚠️ The ablation is a race, not a certainty, and the rate is a function of the
 * BOX, not of the fixture. Measured on this container — 4 vCPU / 17 GB, every
 * arm serialized under the shared verify lock, each carrying its own control in
 * the same run:
 *
 *     idle, ablation config          20/20 reproduced, every child exit 1
 *     idle, this app's config         0/6  reproduced, every child exit 0  (control)
 *     under 4 concurrent vitest       3/40 reproduced in the measured arm
 *     those concurrent runs        248/1913 reproduced (~13%) in the same windows
 *
 * It is NOT a starvation effect. Load average held between 2.8 and 3.4 on 4
 * CPUs with 15 GB free throughout, so nothing was starved — and reproduction
 * still fell from 100% to ~13%. The card's own control had ruled starvation out
 * from the other side (the file alone under 8 synthetic CPU burners, load ~7,
 * stayed green). Nor is it contention on the fixture directory: repeated with
 * every concurrent process on its OWN copy of the fixture root, the suppression
 * survives (3/20). What closes the window is CONCURRENT NODE PROCESSES, which
 * is exactly what a full-repo `turbo run test` is made of — and what a lane
 * inside THIS package therefore cannot isolate the file from.
 *
 * WHY THAT MAKES A RETRY BUDGET THE WRONG INSTRUMENT (#11939). At ~13% per
 * attempt, eight attempts miss (1 - 0.13)^8 ≈ 33% of the time — and the
 * sequentially measured arms came in lower still (3/40), so the rate under a
 * real full-repo run may be worse than that. No budget that finishes inside a
 * test's lifetime makes a race with an environment-dependent rate reliable; it
 * only moves the red further out and pays for the move on every loaded run.
 *
 * WHAT THIS FILE ACTUALLY CLOSES, then. "The instrument did not fire this time"
 * and "the instrument is permanently dead" are different facts with different
 * responses, and a race that only ever reports "did not reproduce" cannot tell
 * them apart. So the dynamic race is no longer the only evidence: the PREMISE
 * probe below reads the installed vitest and asserts, DETERMINISTICALLY and
 * independently of load, that the shape this pin exploits is still there —
 * mechanising the very instruction the old assertion message gave a human
 * ("check sendLog/rpcDone in its dist chunks"). The two are then graded
 * together:
 *
 *     premise intact + race fired   → pass
 *     premise intact + race silent  → SKIP, loudly and countably: the window
 *                                     did not open on this box this time
 *     premise BROKEN + race silent  → FAIL: vitest changed underneath us; this
 *                                     pin's defect may be fixed upstream
 *     premise BROKEN + race fired   → FAIL: the probe is stale, not vitest
 *
 * ⛔ A skip is NOT a pass and must never be able to become one quietly. Two
 * things stop that: it is reported as skipped (so `Tests N passed | 1 skipped`
 * counts it, and the marker below greps out of a job log), and the premise
 * probe is a SEPARATE, always-run, deterministic assertion — the leg's floor is
 * never "measured nothing", it is "measured the mechanism statically".
 *
 * ⛔ And none of it relaxes the GUARDED leg, which is the one that protects the
 * merge queue. It still requires exit 0 on every repetition, unconditionally.
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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';

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

// The premise probe reads the SAME vitest the child runs — reached through this
// package's own `node_modules`, the way `VITEST_BIN` above is, so the two can
// never end up describing different installs. rollup content-hashes the chunk
// names, so each is found by prefix rather than named.
const VITEST_CHUNKS = `${PACKAGE_ROOT}/node_modules/vitest/dist/chunks`;

/**
 * vitest's rejection wording, verbatim from `init.*.js`, with its interpolation
 * left as source text so the probe can look for the template itself.
 *
 * `TEARDOWN_ERROR` is DERIVED from it rather than written out a second time: it
 * is the string the ablation greps for in the child's output, and the whole
 * failure mode this file guards against is those two drifting apart silently.
 */
const TEARDOWN_MESSAGE_TEMPLATE = 'Closing rpc while "${method}" was pending';
const FORWARDED_METHOD = 'onUserConsoleLog';

/** The exact message vitest rejects a pending console RPC with. */
const TEARDOWN_ERROR = TEARDOWN_MESSAGE_TEMPLATE.replace('${method}', FORWARDED_METHOD);

/** The forwarding call whose returned promise `sendLog` throws away. */
const FORWARDING_CALL = `state().rpc.${FORWARDED_METHOD}(`;

/**
 * Attempts allowed to the ablation leg before the run is declared DEGRADED.
 *
 * Deliberately unchanged at 8 (#11939). With the premise probe carrying the
 * "is the instrument alive" question, more attempts buy only a lower skip rate
 * — and they are paid on every loaded run, which is precisely the run that
 * cannot afford them. The measurement in this file's docblock prices it: no
 * budget makes an environment-dependent race reliable.
 */
const ABLATION_ATTEMPTS = 8;
/** Repetitions of the guarded leg. A removed guard reproduces ~80% per run. */
const GUARDED_REPETITIONS = 4;

/** Greppable, so a chronically degraded leg is countable out of a job log. */
const DEGRADED_MARKER = 'ABLATION-DEGRADED [#11939]';

interface Leg {
  readonly status: number | null;
  /** The child's combined stdout+stderr, ALREADY stripped of ANSI escapes. */
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
 */
function runFixture(config: string): Leg {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITEST')) delete env[key];
  }
  delete env.NODE_V8_COVERAGE;
  delete env.FORCE_COLOR;
  env.NO_COLOR = '1';

  const result = spawnSync(
    VITEST_BIN,
    ['run', '-c', config, '--root', FIXTURE_ROOT, '--reporter=default'],
    {
      encoding: 'utf8',
      timeout: 120_000,
      env,
    },
  );

  const output = stripVTControlCharacters(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  return {
    status: result.status,
    output,
    reproduced: output.includes(TEARDOWN_ERROR),
    collectedOneFile: /Test Files\s+1 passed \(1\)/.test(output),
  };
}

/**
 * THE PREMISE PROBE (#11939).
 *
 * Four facts about the installed vitest, each one a link in the chain the
 * ablation's race walks at run time, each readable without running anything.
 * Together they answer the question the race answers only probabilistically:
 * is the mechanism still there? A broken link is not a flake and no retry
 * budget touches it.
 *
 * The chunks are UNMINIFIED in a published vitest, which is why the markers can
 * be this specific. Each is a statement about SHAPE, not formatting: what
 * `sendLog` does with the promise, what `rpcDone` awaits, what runs after it,
 * and how the rejection is worded.
 */
interface ChunkSources {
  readonly consoleFile: string;
  readonly consoleSource: string;
  readonly rpcFile: string;
  readonly rpcSource: string;
  readonly initFile: string;
  readonly initSource: string;
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
  return {
    consoleFile: consoleChunk.file,
    consoleSource: consoleChunk.source,
    rpcFile: rpcChunk.file,
    rpcSource: rpcChunk.source,
    initFile: initChunk.file,
    initSource: initChunk.source,
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
        `vitest reworded the rejection, so the ablation's grep for "${TEARDOWN_ERROR}" can ` +
        'never match again — the mechanism may be entirely intact',
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
 * status and shows the tail of what it actually wrote.
 *
 * Bounded at three runs and fifteen lines each: a leg can grade eight, and when
 * they fail they fail the same way, so an unbounded dump buries the one thing
 * being read in seven copies of itself.
 */
const DESCRIBED_RUNS = 3;

function describeRuns(legs: readonly Leg[]): string {
  const blocks = legs.slice(0, DESCRIBED_RUNS).map((leg, index) => {
    const tail = leg.output.trimEnd().split('\n').slice(-15).join('\n');
    return (
      `\n--- child run ${index + 1}/${legs.length}: exit=${leg.status}, ` +
      `collectedOneFile=${leg.collectedOneFile}, reproduced=${leg.reproduced}\n` +
      `${tail === '' ? '(the child wrote nothing at all)' : tail}`
    );
  });
  const elided = legs.length - blocks.length;
  if (elided > 0) blocks.push(`\n--- ${elided} further run(s) not shown`);
  return blocks.join('\n');
}

describe('[#10293] vitest console-forwarding teardown race', () => {
  it('has a fixture and an ablation config to measure against', () => {
    expect(existsSync(VITEST_BIN), `vitest binary missing at ${VITEST_BIN}`).toBe(true);
    expect(existsSync(`${FIXTURE_ROOT}/leaked-console.test.ts`)).toBe(true);
    expect(existsSync(ABLATION_CONFIG)).toBe(true);
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
    ];

    for (const [index, testCase] of cases.entries()) {
      const mutated = testCase.mutate(real);

      const changed =
        mutated.consoleSource !== real.consoleSource ||
        mutated.rpcSource !== real.rpcSource ||
        mutated.initSource !== real.initSource;
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
    'ABLATION: the fixture still reddens a green run under vitest defaults',
    { timeout: 240_000 },
    (ctx) => {
      const premise = evaluatePremise(readChunks());

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
        `the fixture was not collected — the ablation measured nothing. What the ` +
          `child runs actually wrote:${describeRuns(attempts)}`,
      ).toBe(true);

      const reproduced = attempts.find((leg) => leg.reproduced);

      // The grading matrix (#11939). The race alone cannot separate "did not
      // fire" from "cannot fire ever again"; the premise probe can, so it is
      // the axis that decides whether a silent race is a failure at all.
      expect(
        premise.intact,
        reproduced
          ? `the PREMISE PROBE IS STALE, not vitest: the race still reproduces — the child ` +
              `printed "${TEARDOWN_ERROR}" — while the probe reads the mechanism as ` +
              `changed:${describePremise(premise)}\n\nRepair the probe to match the installed ` +
              `vitest. Nothing about either leg's assertion is in question here.`
          : `the INSTRUMENT IS DEAD, and this is not the load flake: ${attempts.length} ` +
              `attempts produced no "${TEARDOWN_ERROR}" AND the mechanism itself no longer ` +
              `reads as present in the installed vitest:${describePremise(premise)}\n\n` +
              `Treat it as an upstream change, not as a retry budget to raise. Do NOT relax ` +
              `the GUARDED leg on the strength of this.`,
      ).toBe(true);

      if (!reproduced) {
        // Premise intact, race silent: the window did not open on this box.
        // Loud (it is written straight to the worker's stdout — this app turns
        // console interception off) and countable (reported as SKIPPED, and the
        // marker greps out of a job log), because a leg that quietly stops
        // measuring is the failure mode this file was built to make impossible.
        const degraded =
          `${DEGRADED_MARKER} the teardown race did not open in ${attempts.length} attempts, ` +
          `and the premise probe reads all ${premise.markers.length} markers of the mechanism ` +
          `as INTACT in the installed vitest. So the instrument is alive and this run simply ` +
          `did not catch the window — measured cause: concurrent node processes suppress it ` +
          `(~13% per attempt under load versus 20/20 idle; see this file's docblock). This ` +
          `leg is SKIPPED, never passed. The GUARDED leg is unaffected and still ran.`;
        console.warn(degraded);
        ctx.skip(degraded);
        return;
      }

      // Every assertion in the fixture passed, and the run still failed. That
      // conjunction is the whole defect.
      expect(reproduced.status).not.toBe(0);
      expect(reproduced.output).toContain('Tests  1 passed (1)');
    },
  );

  it(
    'GUARDED: the same fixture exits 0 under this app’s real vitest config',
    { timeout: 240_000 },
    () => {
      const legs = Array.from({ length: GUARDED_REPETITIONS }, () => runFixture(APP_CONFIG));

      expect(
        legs.every((leg) => leg.collectedOneFile),
        `the fixture was not collected under the app config — this leg measured ` +
          `nothing. What the child runs actually wrote:${describeRuns(legs)}`,
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
