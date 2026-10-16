#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// rerun-safety-verdict -- decide what the two passes of `Rerun Safety` actually
// measured, and SAY whether the rerun property was measured at all.
//
// ## The blind spot this closes
//
// `rerun-safety-nightly.yml` runs the full suite twice in one working tree to
// catch a suite that pollutes its own tree and therefore passes exactly once
// (#4065). Pass 2 is the assertion; pass 1 is only the baseline it is compared
// against.
//
// Until this script existed, a red pass 1 ENDED THE JOB -- `pass 2` never ran,
// so on every such night the rerun property was not measured at all. The job
// still went red, and that red is indistinguishable from the red it exists to
// report: "rerun safety is failing" and "rerun safety is unmeasured" printed
// the same colour. Measured over the 17-night red streak that ended 2026-08-31:
//
//   nights  step that died  failing task               kind
//   4       pass 1          @objectstack/cli#test      5000ms vitest timeouts
//   6       pass 1          @objectstack/verify#test   AssertionError
//   1       pass 1          @objectstack/plugin-auth#test
//   2       pass 1          @objectstack/cli#test
//   4       pass 2          @objectstack/core#test, @objectstack/objectql#test
//
// Read that table the way it has to be read: the pass-1 killer MOVED. It was
// `verify` for six nights, then `verify` was fixed on main and `cli` inherited
// the job. So "get pass 1 green and keep it green" is not a reachable end state
// on a trunk that is red from time to time like any other -- and every night it
// is not reached, the ONE measurement this workflow exists to take is skipped.
//
// The repair is to stop making the measurement conditional on the baseline
// being clean. Pass 2 now runs whatever pass 1 did, and this script compares
// the two, so a red trunk costs the instrument its baseline -- not its reading.
//
// ## What a pass's log says, and the two facts it used to blur (#23880)
//
// Turbo states two different facts about a task, in two different spellings:
//
//   FAILED       `Failed:    @objectstack/dogfood#test` (the summary footer) and
//                `@objectstack/dogfood#test:  ERROR  command (...) exited (1)`
//                (the per-task error line). Turbo prints these only for a task
//                that exited non-zero ON ITS OWN.
//   INTERRUPTED  `@objectstack/cli:test:  ELIFECYCLE  Test failed.` with no
//                ERROR line and no footer entry. Without `--continue`, turbo ends
//                the run at its first failed task and stops every task still
//                running; pnpm then prints ELIFECYCLE for each of them in the very
//                words a real failure uses. An interrupted task did not fail. It
//                was not allowed to finish, so it is UNMEASURED in that pass.
//
// This script used to take the union of all three spellings as the failing
// set, on the theory that the footer under-reports. Read against the job logs
// of the nights #23880 covers, the "under-reporting" was that interruption
// every time -- the extra ELIFECYCLE lines land 0.2-0.5 s after the real
// failure's, and one of the interrupted suites logs `Received SIGINT`:
//
//   night  pass  turbo's footer (FAILED)   ELIFECYCLE only (INTERRUPTED)
//   10-02  1     @objectstack/dogfood      @objectstack/cli
//   10-02  2     @objectstack/core         driver-sql, spec, lint
//   10-13  2     @objectstack/runtime      http-conformance, verify
//   10-14  1     @objectstack/dogfood      @objectstack/cli
//   10-14  2     @objectstack/core         spec, lint
//   10-15  2     @objectstack/runtime      verify, cli, organizations
//
// So `@objectstack/cli#test`, printed as a pass-1 failure on every one of those
// nights, was the suite turbo stopped when dogfood failed; and the "different
// package set each night" on pass 2 was each night's first real failure plus
// whatever happened to be running beside it.
//
// Three more facts are read for the same reason -- so the verdict never claims
// more than the passes measured:
//
//   FINISHED      turbo's closing ` Tasks:    N successful, M total`. A pass log
//                 without it did not finish -- stopped by its time budget, the
//                 job timeout or a crash -- and nothing it had not finished was
//                 measured. `M` counts the tasks turbo STARTED, so a pass that
//                 stopped at its first failure shows a smaller `M` than one that
//                 ran to the end (10-14: pass 1 started 143, pass 2 only 49).
//   RAN           a task that printed vitest's `Test Files` line finished its
//                 suite in that pass. A pass-1 failure that pass 2 never finished
//                 was NOT re-measured; it did not "recover".
//   TIMEOUT-ONLY  a failed task whose every failed test is vitest's
//                 `Error: Test timed out in Nms`. Every real failure on the nights
//                 above has this shape. A working-tree leak fails an assertion, not
//                 a clock, so a timeout-only task that fails only on pass 2 points
//                 at load before it points at a leak, and the verdict says how to
//                 tell the two apart.
//
// A leading ISO timestamp and ANSI colour codes are stripped from every line, so
// a log downloaded from the Actions API (which stamps each line, and keeps
// vitest's colours) reads the same as the stall guard's own tee.
//
// ## What it does NOT do
//
// It does not make the job green. A red pass 1 still fails the job: the
// workflow's own header calls that deliberate ("if pass 1 is red the suite is
// simply broken on main and that is worth failing on"), and nothing here
// relaxes it. What changes is only that the job now also reports whether the
// second pass agreed with the first, and how much of the suite either pass
// actually covered.
//
// ## Usage
//
//   node scripts/rerun-safety-verdict.mjs \
//     --pass1-log <file> --pass1-exit <n> \
//     --pass2-log <file> --pass2-exit <n>
//
// Exit status: 0 only for RERUN-SAFE; 75 for a stall (EX_TEMPFAIL, the same
// code run-with-stall-guard uses and for the same reason -- rerun it); 1 for
// every verdict that is a real red, INCOMPLETE included.

import { readFileSync } from 'node:fs';

import { isEntrypoint } from './invoked-as.mjs';

const STALL_EXIT_CODE = 75; // EX_TEMPFAIL -- matches run-with-stall-guard.mjs
// What `timeout` (coreutils) exits with when it stopped the command at the
// deadline, and what it exits with when the command then needed SIGKILL.
const BUDGET_EXIT_CODES = Object.freeze([124, 137]);

// ---------------------------------------------------------------------------
// Reading one pass out of its log
// ---------------------------------------------------------------------------

// The ESC-[...m colour sequences vitest prints, spelled with the escape -- never
// as the raw control byte (scripts/check-nul-bytes.mjs has the reason).
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;
const ISO_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s/;

const FAILED_FOOTER_RE = /^\s*Failed:\s+(.+?)\s*$/;
const TASK_ERROR_RE = /^\s*(\S+?)#(\S+?):\s+ERROR\s+command\b/;
const TASKS_SUMMARY_RE = /^\s*Tasks:\s+(\d+)\s+successful,\s+(\d+)\s+total\b/;
// turbo's streaming prefix: `<package>:<task>: <the task's own output>`.
const TASK_LINE_RE = /^(\S+?):([A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*?):\s(.*)$/;

const ELIFECYCLE_RE = /^\s*ELIFECYCLE\b/;
const VITEST_TEST_FILES_RE = /^\s*Test Files\s/;
// The rule characters around vitest's summary headers are U+23AF.
const VITEST_FAILED_TESTS_RE = /^\s*⎯+\s*Failed Tests (\d+)\s*⎯+\s*$/;
const VITEST_FAILED_SUITES_RE = /^\s*⎯+\s*Failed Suites (\d+)\s*⎯+\s*$/;
// Anchored at the start of the task's output on purpose: the github-actions
// reporter repeats the message inside a `::error file=...` annotation, and that
// copy must not count as a second timed-out test.
const VITEST_TIMEOUT_RE = /^\s*Error: Test timed out in \d+ms\b/;

function cleanLines(logText) {
  return String(logText ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(ANSI_RE, '').replace(ISO_PREFIX_RE, ''));
}

/**
 * Everything one pass's log states about its tasks. Every list is a sorted
 * array of `pkg#task` ids so two passes compare and print stably.
 *
 *   failing      turbo reported the task as failed (footer or ERROR line)
 *   interrupted  ELIFECYCLE only: turbo stopped it after another task failed
 *   ran          the task's vitest run printed its `Test Files` line
 *   timeoutOnly  failing tasks whose every failed test hit vitest's timeout
 *   finished     turbo printed its closing `Tasks:` summary
 *   started      that summary's `M total` (null when unfinished)
 *   successful   that summary's `N successful` (null when unfinished)
 */
export function readPass(logText) {
  const failing = new Set();
  const elifecycle = new Set();
  const ran = new Set();
  const counters = new Map();
  const counter = (id) => {
    if (!counters.has(id)) counters.set(id, { failedTests: 0, failedSuites: 0, timeouts: 0 });
    return counters.get(id);
  };
  let summary = null;

  for (const line of cleanLines(logText)) {
    let m = FAILED_FOOTER_RE.exec(line);
    if (m) {
      // turbo separates several ids with commas and/or whitespace.
      for (const id of m[1].split(/[,\s]+/)) {
        const trimmed = id.trim();
        if (trimmed.includes('#')) failing.add(trimmed);
      }
      continue;
    }
    m = TASK_ERROR_RE.exec(line);
    if (m) {
      failing.add(`${m[1]}#${m[2]}`);
      continue;
    }
    m = TASKS_SUMMARY_RE.exec(line);
    if (m) {
      summary = { successful: Number(m[1]), started: Number(m[2]) };
      continue;
    }
    m = TASK_LINE_RE.exec(line);
    if (!m) continue;
    const id = `${m[1]}#${m[2]}`;
    const output = m[3];
    if (ELIFECYCLE_RE.test(output)) {
      elifecycle.add(id);
      continue;
    }
    if (VITEST_TEST_FILES_RE.test(output)) ran.add(id);
    const tests = VITEST_FAILED_TESTS_RE.exec(output);
    if (tests) counter(id).failedTests += Number(tests[1]);
    const suites = VITEST_FAILED_SUITES_RE.exec(output);
    if (suites) counter(id).failedSuites += Number(suites[1]);
    if (VITEST_TIMEOUT_RE.test(output)) counter(id).timeouts += 1;
  }

  const timeoutOnly = [...failing].filter((id) => {
    const c = counters.get(id);
    return Boolean(c) && c.failedTests > 0 && c.failedSuites === 0 && c.timeouts === c.failedTests;
  });

  return {
    failing: [...failing].sort(),
    interrupted: [...elifecycle].filter((id) => !failing.has(id)).sort(),
    ran: [...ran].sort(),
    timeoutOnly: timeoutOnly.sort(),
    finished: summary !== null,
    started: summary?.started ?? null,
    successful: summary?.successful ?? null,
  };
}

/** The tasks turbo reported as FAILED in one pass's log (interruptions excluded). */
export function failingTasks(logText) {
  return readPass(logText).failing;
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

const without = (list, ...others) => list.filter((t) => !others.some((o) => o.includes(t)));

// A red pass is PARTIAL unless its own summary accounts for every task it
// started AND it started as many as the other pass did. Without `--continue`
// turbo stops scheduling at the first failure, so the tasks it never started
// appear in no count of that pass at all -- only the other pass's `M total`
// can show them missing.
function stoppedShort(pass, maxStarted) {
  if (!pass.finished || pass.exit === 0) return false;
  if (pass.interrupted.length > 0) return true;
  if (pass.started === null || pass.successful === null) return true;
  return pass.successful + pass.failing.length < pass.started || pass.started < maxStarted;
}

function timeoutAdvice(ids, timeoutOnly) {
  return ids
    .filter((id) => timeoutOnly.includes(id))
    .map((id) => {
      const [pkg, task] = id.split('#');
      return (
        `${id}: every failed test hit vitest's test timeout -- load-shaped. A leak fails an ` +
        `assertion, not a clock: run \`pnpm --filter ${pkg} run ${task}\` twice in one tree on ` +
        'its own; a leak fails the second run there, a load timeout does not.'
      );
    });
}

function coverageNotes(pass1, pass2, maxStarted) {
  const notes = [];
  for (const [n, p] of [[1, pass1], [2, pass2]]) {
    if (!stoppedShort(p, maxStarted)) continue;
    notes.push(
      p.started !== null && p.started < maxStarted
        ? `Pass ${n} stopped at its first failure (turbo runs without --continue) after starting ` +
            `${p.started} of the ${maxStarted} tasks the longer pass started; every task it did not ` +
            'finish is unmeasured in that pass.'
        : `Pass ${n} stopped at its first failure (turbo runs without --continue); the tasks still ` +
            'running then were interrupted and are unmeasured in that pass.',
    );
  }
  return notes;
}

/**
 * The verdicts, and the one question each answers.
 *
 * `coverage` is the field this whole script exists for -- `full`, `partial` or
 * `none` -- because "rerun safety is failing" and "rerun safety was never (or
 * only partly) measured" are different facts the exit code alone cannot carry.
 * `measured` is `coverage !== 'none'`.
 *
 * Each pass is `{ exit, ...readPass(log) }`.
 */
export function verdict({ pass1, pass2 }) {
  const result = (code, coverage, exit, headline, detail) => ({
    code,
    coverage,
    measured: coverage !== 'none',
    exit,
    headline,
    detail,
  });

  if (pass1.exit === STALL_EXIT_CODE || pass2.exit === STALL_EXIT_CODE) {
    return result('STALL', 'none', STALL_EXIT_CODE, 'STALLED -- frozen output, killed by run-with-stall-guard', [
      'This is NOT a rerun-safety verdict: a stall says nothing about',
      'working-tree pollution. Rerun the workflow; if it stalls again at the',
      'same file, note the occurrence on #4250.',
    ]);
  }

  const unfinished = [[1, pass1], [2, pass2]].filter(([, p]) => !p.finished);
  if (unfinished.length > 0) {
    const named = unfinished.map(([n, p]) =>
      `Pass ${n} (exit ${p.exit}) printed no turbo summary: it was stopped before it finished` +
        (BUDGET_EXIT_CODES.includes(p.exit) ? ', by its share of the job\'s time budget.' : ' (budget, job timeout or crash).'),
    );
    const found = [[1, pass1], [2, pass2]]
      .filter(([, p]) => p.failing.length > 0)
      .map(([n, p]) => `Failed in pass ${n} before it stopped: ${p.failing.join(', ')}`);
    return result('INCOMPLETE', 'none', 1, 'INCOMPLETE -- a pass did not finish, so the rerun property was NOT MEASURED', [
      ...named,
      'Running out of time is a capacity reading, not a suite reading: compare the',
      'two pass steps\' durations with the job\'s timeout before reading anything',
      'into the failures below.',
      ...found,
    ]);
  }

  const maxStarted = Math.max(pass1.started ?? 0, pass2.started ?? 0);
  const coverage =
    stoppedShort(pass1, maxStarted) || stoppedShort(pass2, maxStarted) ? 'partial' : 'full';
  const notes = coverageNotes(pass1, pass2, maxStarted);

  const newlyFailing = without(pass2.failing, pass1.failing);
  const recovered = pass1.failing.filter((t) => pass2.ran.includes(t) && !pass2.failing.includes(t));
  const notRemeasured = without(pass1.failing, pass2.failing, pass2.ran);
  const interruptedNote = [[1, pass1], [2, pass2]]
    .filter(([, p]) => p.interrupted.length > 0)
    .map(
      ([n, p]) =>
        `Interrupted by turbo in pass ${n} after another task failed (not failures, unmeasured): ${p.interrupted.join(', ')}`,
    );
  const notRemeasuredNote =
    notRemeasured.length > 0
      ? [`Failed on pass 1 and never finished by pass 2 (NOT re-measured, not recovered): ${notRemeasured.join(', ')}`]
      : [];
  const advice = timeoutAdvice(newlyFailing, pass2.timeoutOnly);

  if (pass1.exit === 0 && pass2.exit === 0) {
    return result('RERUN_SAFE', coverage, 0, 'RERUN-SAFE -- the second pass agreed with the first', [
      'Both passes of the full suite were green in one working tree.',
    ]);
  }

  if (pass1.exit === 0 && pass2.exit !== 0) {
    return result('RERUN_UNSAFE', coverage, 1, 'RERUN-UNSAFE -- the suite passes once and fails on a second run', [
      'Something under test writes state into the working tree and reads it',
      'back on the next run. Ordinary CI cannot see this -- every other job is',
      'a fresh clone, so every other job is always run #1.',
      `Newly failing on pass 2: ${newlyFailing.join(', ') || '(none named in the log)'}`,
      ...advice,
      ...interruptedNote,
      ...notes,
      'See the on-disk state reported above, and #4065 for the pattern.',
    ]);
  }

  if (pass1.exit !== 0 && pass2.exit === 0) {
    return result('BASELINE_FLAKY', coverage, 1, 'SUITE BROKEN ON MAIN (pass 1 only) -- and it passed on rerun', [
      'Pass 1 failed and pass 2 was green in the same tree, so this is NOT the',
      '#4065 rerun-unsafe pattern -- it is order-dependence or flake, pointing',
      'the opposite way down the same axis.',
      `Failed on pass 1, green on pass 2: ${pass1.failing.join(', ') || '(none named in the log)'}`,
      ...interruptedNote,
      ...notes,
    ]);
  }

  if (newlyFailing.length > 0) {
    return result(
      'RERUN_UNSAFE_ON_BROKEN_BASELINE',
      coverage,
      1,
      'RERUN-UNSAFE, on top of a suite that is already broken on main',
      [
        'Both passes failed, but pass 2 failed tasks that pass 1 did not. The',
        'extra ones are the rerun-safety CANDIDATES; the shared ones are ordinary',
        'breakage on main and belong to whoever owns them.',
        `Newly failing on pass 2: ${newlyFailing.join(', ')}`,
        ...advice,
        `Failing in both passes: ${pass1.failing.filter((t) => pass2.failing.includes(t)).join(', ') || '(none)'}`,
        ...notRemeasuredNote,
        ...interruptedNote,
        ...notes,
      ],
    );
  }

  const headline =
    coverage === 'full'
      ? 'SUITE BROKEN ON MAIN -- rerun property measured, and it is CLEAN'
      : 'SUITE BROKEN ON MAIN -- no task failed only on the rerun, as far as pass 2 got';
  return result('BASELINE_BROKEN', coverage, 1, headline, [
    'No task failed in pass 2 that had not already failed in pass 1. The red',
    'belongs to ordinary breakage on main, NOT to working-tree pollution -- do',
    'not go hunting for state leaks on the strength of this run.',
    `Failing in both passes: ${pass1.failing.filter((t) => pass2.failing.includes(t)).join(', ') || '(none)'}`,
    ...(recovered.length > 0 ? [`Failed on pass 1 only, green on pass 2: ${recovered.join(', ')}`] : []),
    ...notRemeasuredNote,
    ...interruptedNote,
    ...notes,
  ]);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const COVERAGE_WORDS = Object.freeze({ full: 'MEASURED', partial: 'PARTIALLY MEASURED', none: 'NOT MEASURED' });

function passLine(n, p) {
  const failed = p.failing
    .map((id) => (p.timeoutOnly.includes(id) ? `${id} (timeout-only)` : id))
    .join(', ');
  const lines = [`  pass ${n} exit ${p.exit}, failing tasks: ${failed || '(none)'}`];
  if (p.interrupted.length > 0) lines.push(`         interrupted by turbo (unmeasured): ${p.interrupted.join(', ')}`);
  lines.push(
    p.finished
      ? `         turbo: ${p.successful} successful of ${p.started} started`
      : '         turbo: no closing summary -- this pass did not finish',
  );
  return lines;
}

export function renderVerdict(v, { pass1, pass2 }) {
  const lines = [];
  lines.push('='.repeat(72));
  lines.push(`Rerun Safety verdict: ${v.code}`);
  lines.push('='.repeat(72));
  lines.push(v.headline);
  lines.push('');
  for (const d of v.detail) lines.push(`  ${d}`);
  lines.push('');
  lines.push(`  rerun property: ${COVERAGE_WORDS[v.coverage]}`);
  lines.push(...passLine(1, pass1));
  lines.push(...passLine(2, pass2));
  lines.push('='.repeat(72));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The self-test's own battery roster and floor (#13489)
// ---------------------------------------------------------------------------
//
// `failed === 0` is not a success condition on its own -- "every case held" and
// "the cases never ran" print the same line. What is pinned here is the
// registered NAMES with a per-battery floor, so a battery that stops running
// names ITSELF in the refusal instead of vanishing into a smaller total.

const SELF_TEST_BATTERIES = Object.freeze({
  'parse: turbo Failed: footer': 1,
  'parse: turbo per-task ERROR line': 1,
  'parse: an ELIFECYCLE line alone is INTERRUPTED, never failing': 2,
  'parse: 2026-10-14 pass 1 -- dogfood failed, cli interrupted by fail-fast': 5,
  'parse: 2026-10-15 pass 2 -- runtime failed; verify, cli, organizations interrupted': 3,
  'parse: an API-downloaded log with ISO timestamps reads the same': 1,
  'parse: a green log names no failing task and is finished': 2,
  'parse: timeout-only needs EVERY failed test to be a timeout': 2,
  'parse: the ::error annotation copy is not a second timeout': 1,
  'parse: a log without turbo\'s closing summary did not finish': 2,
  'verdict: both green -> RERUN_SAFE, measured, exit 0': 1,
  'verdict: pass1 green + pass2 red -> RERUN_UNSAFE, exit 1': 1,
  'verdict: pass1 red + pass2 green -> BASELINE_FLAKY, measured': 1,
  'verdict: both red, same set -> BASELINE_BROKEN, measured, CLEAN': 1,
  'verdict: both red, pass2 worse -> RERUN_UNSAFE_ON_BROKEN_BASELINE': 1,
  'verdict: a stall in pass 1 -> STALL, NOT MEASURED, exit 75': 1,
  'verdict: a stall in pass 2 -> STALL, NOT MEASURED, exit 75': 1,
  'verdict: a pass that did not finish -> INCOMPLETE, NOT MEASURED, exit 1': 2,
  'verdict: every finished, non-stall verdict reports measured=true': 1,
  'verdict: 2026-10-14 end to end -- no interrupted task is newly failing, coverage PARTIAL': 4,
  'verdict: a pass-1 failure pass 2 never finished is not re-measured, never recovered': 1,
  'render: the verdict line names MEASURED, PARTIALLY MEASURED or NOT MEASURED': 1,
  'render: a timeout-only newly failing task carries the twice-on-its-own instruction': 1,
});

const SELF_TEST_BATTERY_FLOOR = 23;

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` above that line prints nothing and still exits 0 -- a
// self-test that never finished, reported as one that passed.
let selfTestReachedVerdict = false;

// Fixture spellings. The colour codes and the U+23AF rules are written as
// escapes, exactly as the job log carries them once decoded.
const ESC = '\u001b';
const RULE = '⎯'.repeat(7);
const failedTestsHeader = (prefix, n) =>
  `${prefix} ${ESC}[31m${RULE}${ESC}[39m${ESC}[1m${ESC}[41m Failed Tests ${n} ${ESC}[49m${ESC}[22m${ESC}[31m${RULE}${ESC}[39m`;
const timedOut = (prefix) => `${prefix} ${ESC}[31m${ESC}[1mError${ESC}[22m: Test timed out in 5000ms.`;
const testFiles = (prefix, failed, passed) =>
  `${prefix} ${ESC}[2m Test Files ${ESC}[22m ${ESC}[1m${ESC}[31m${failed} failed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[1m${ESC}[32m${passed} passed${ESC}[39m`;
const elifecycle = (pkg) => `${pkg}:test:  ELIFECYCLE  Test failed. See above for more details.`;
const taskError = (pkg) => `${pkg}#test:  ERROR  command (/w/${pkg}) /x/pnpm run test exited (1)`;
const tasksSummary = (ok, total) => ` Tasks:    ${ok} successful, ${total} total`;

// The 2026-10-14 night (run 38509291145), cut to the lines this script reads.
const NIGHT_1014_PASS1 = [
  '@objectstack/dogfood:test:  ✓  shared-showcase  test/showcase-public-read-owd.dogfood.test.ts (3 tests) 1876ms',
  failedTestsHeader('@objectstack/dogfood:test:', 1),
  '@objectstack/dogfood:test:  FAIL   isolated  test/activity-text-predicate.dogfood.test.ts > [#21154] ... > control: the unmasking reader filters and groups by every column of a pinned parent, as before',
  timedOut('@objectstack/dogfood:test:'),
  testFiles('@objectstack/dogfood:test:', 1, 256),
  '@objectstack/dogfood:test: ::error file=/w/packages/qa/dogfood/test/activity-text-predicate.dogfood.test.ts,title=[isolated] test/activity-text-predicate.dogfood.test.ts::Error: Test timed out in 5000ms.',
  elifecycle('@objectstack/dogfood'),
  elifecycle('@objectstack/cli'),
  '##[error]command (/w/packages/qa/dogfood) /x/pnpm run test exited (1)',
  taskError('@objectstack/dogfood'),
  '',
  tasksSummary(141, 143),
  'Cached:    0 cached, 143 total',
  '  Time:    1h38m20.709s ',
  'Failed:    @objectstack/dogfood#test',
].join('\n');

const NIGHT_1014_PASS2 = [
  failedTestsHeader('@objectstack/core:test:', 1),
  '@objectstack/core:test:  FAIL   local  src/security/auth-gate.test.ts > auth-gate (ADR-0069 session gate) > BOUNDARY',
  timedOut('@objectstack/core:test:'),
  testFiles('@objectstack/core:test:', 1, 96),
  elifecycle('@objectstack/core'),
  '@objectstack/lint:test:  ✓ src/validate-expressions.field-conditional-formatting.test.ts (41 tests) 489ms',
  elifecycle('@objectstack/spec'),
  elifecycle('@objectstack/lint'),
  taskError('@objectstack/core'),
  tasksSummary(24, 49),
  'Failed:    @objectstack/core#test',
].join('\n');

// The 2026-10-15 night's pass 2 (run 38679312462), API-downloaded: stamped.
const NIGHT_1015_PASS2 = [
  failedTestsHeader('@objectstack/runtime:test:', 1),
  timedOut('@objectstack/runtime:test:'),
  testFiles('@objectstack/runtime:test:', 1, 382),
  '@objectstack/verify:test: 2026-10-15T06:47:11.224Z INFO Received SIGINT - initiating graceful shutdown',
  elifecycle('@objectstack/runtime'),
  elifecycle('@objectstack/verify'),
  elifecycle('@objectstack/cli'),
  elifecycle('@objectstack/organizations'),
  taskError('@objectstack/runtime'),
  tasksSummary(132, 142),
  'Failed:    @objectstack/runtime#test',
]
  .map((line, i) => `2026-10-15T06:47:${String(10 + i).padStart(2, '0')}.0000000Z ${line}`)
  .join('\n');

// A synthetic pass: `failing` tasks fail on their own, `ran` tasks finish
// green, and the summary accounts for every task unless `started` says more.
function logOf({ failing = [], interrupted = [], ran = [], started = 10, finished = true } = {}) {
  const lines = [];
  for (const id of [...ran, ...failing]) lines.push(testFiles(`${id.split('#')[0]}:test:`, failing.includes(id) ? 1 : 0, 3));
  for (const id of [...failing, ...interrupted]) lines.push(elifecycle(id.split('#')[0]));
  for (const id of failing) lines.push(taskError(id.split('#')[0]));
  if (finished) lines.push(tasksSummary(started - failing.length - interrupted.length, started));
  if (finished && failing.length > 0) lines.push(`Failed:    ${failing.join(', ')}`);
  return lines.join('\n');
}
const passOf = (exit, log) => ({ exit, ...readPass(log) });

function selfTest() {
  const registered = new Map();
  const registerCase = (label) => registered.set(label, (registered.get(label) ?? 0) + 1);
  let failed = 0;
  const check = (label, ok, note = '') => {
    registerCase(label);
    if (ok) {
      console.log(`  ok   ${label}`);
    } else {
      failed += 1;
      console.log(`  FAIL ${label}${note ? ` -- ${note}` : ''}`);
    }
  };

  // -- parsing -------------------------------------------------------------
  check('parse: turbo Failed: footer', failingTasks('Failed:    @objectstack/cli#test\n').join() === '@objectstack/cli#test');
  check(
    'parse: turbo per-task ERROR line',
    failingTasks(`${taskError('@objectstack/verify')}\n`).join() === '@objectstack/verify#test',
  );
  {
    const p = readPass(`${elifecycle('@objectstack/plugin-auth')}\n`);
    check('parse: an ELIFECYCLE line alone is INTERRUPTED, never failing', p.failing.length === 0, `failing ${p.failing}`);
    check(
      'parse: an ELIFECYCLE line alone is INTERRUPTED, never failing',
      p.interrupted.join() === '@objectstack/plugin-auth#test',
      `interrupted ${p.interrupted}`,
    );
  }
  {
    const p = readPass(NIGHT_1014_PASS1);
    const label = 'parse: 2026-10-14 pass 1 -- dogfood failed, cli interrupted by fail-fast';
    check(label, p.failing.join() === '@objectstack/dogfood#test', `failing ${p.failing}`);
    check(label, p.interrupted.join() === '@objectstack/cli#test', `interrupted ${p.interrupted}`);
    check(label, p.timeoutOnly.join() === '@objectstack/dogfood#test', `timeoutOnly ${p.timeoutOnly}`);
    check(label, p.ran.join() === '@objectstack/dogfood#test', `ran ${p.ran}`);
    check(label, p.finished && p.started === 143 && p.successful === 141, `summary ${p.successful}/${p.started}`);
  }
  {
    const p = readPass(NIGHT_1015_PASS2);
    const label = 'parse: 2026-10-15 pass 2 -- runtime failed; verify, cli, organizations interrupted';
    check(label, p.failing.join() === '@objectstack/runtime#test', `failing ${p.failing}`);
    check(
      label,
      p.interrupted.join() === '@objectstack/cli#test,@objectstack/organizations#test,@objectstack/verify#test',
      `interrupted ${p.interrupted}`,
    );
    check(label, p.timeoutOnly.join() === '@objectstack/runtime#test' && p.started === 142, `timeoutOnly ${p.timeoutOnly}`);
  }
  {
    const stamped =
      `2026-09-17T04:46:54.4228362Z ${taskError('@objectstack/cli')}\n` +
      '2026-09-17T04:46:54.4229431Z Failed:    @objectstack/cli#test\n';
    check(
      'parse: an API-downloaded log with ISO timestamps reads the same',
      failingTasks(stamped).join() === '@objectstack/cli#test',
      `got ${failingTasks(stamped).join(', ')}`,
    );
  }
  {
    const p = readPass(' Tasks:    140 successful, 140 total\n  Time:    39m50.01s\n');
    check('parse: a green log names no failing task and is finished', p.failing.length === 0 && p.interrupted.length === 0);
    check('parse: a green log names no failing task and is finished', p.finished && p.started === 140);
  }
  {
    const mixed = [
      failedTestsHeader('@objectstack/core:test:', 2),
      timedOut('@objectstack/core:test:'),
      '@objectstack/core:test: AssertionError: expected 4 to be 2',
      taskError('@objectstack/core'),
    ].join('\n');
    check('parse: timeout-only needs EVERY failed test to be a timeout', readPass(mixed).timeoutOnly.length === 0);
    const suite = [
      `@objectstack/core:test: ${RULE} Failed Suites 1 ${RULE}`,
      failedTestsHeader('@objectstack/core:test:', 1),
      timedOut('@objectstack/core:test:'),
      taskError('@objectstack/core'),
    ].join('\n');
    check('parse: timeout-only needs EVERY failed test to be a timeout', readPass(suite).timeoutOnly.length === 0);
  }
  {
    const annotated = [
      failedTestsHeader('@objectstack/core:test:', 2),
      timedOut('@objectstack/core:test:'),
      '@objectstack/core:test: AssertionError: expected 4 to be 2',
      '@objectstack/core:test: ::error file=/w/a.test.ts,title=a::Error: Test timed out in 5000ms.',
      taskError('@objectstack/core'),
    ].join('\n');
    check('parse: the ::error annotation copy is not a second timeout', readPass(annotated).timeoutOnly.length === 0);
  }
  {
    // What a pass looks like when its budget's SIGTERM reached turbo.
    const cut = readPass(`${testFiles('@objectstack/core:test:', 0, 96)}\nShutting down Turborepo tasks...\n`);
    check('parse: a log without turbo\'s closing summary did not finish', cut.finished === false && cut.started === null);
    check('parse: a log without turbo\'s closing summary did not finish', readPass('').finished === false);
  }

  // -- the verdict table ---------------------------------------------------
  const V = (p1, p2, f1 = [], f2 = []) =>
    verdict({
      pass1: passOf(p1, logOf({ failing: f1, ran: ['a#test', 'b#test', 'c#test'] })),
      pass2: passOf(p2, logOf({ failing: f2, ran: ['a#test', 'b#test', 'c#test'] })),
    });

  {
    const v = V(0, 0);
    check('verdict: both green -> RERUN_SAFE, measured, exit 0', v.code === 'RERUN_SAFE' && v.coverage === 'full' && v.exit === 0, v.code);
  }
  {
    const v = V(0, 1, [], ['@objectstack/core#test']);
    check(
      'verdict: pass1 green + pass2 red -> RERUN_UNSAFE, exit 1',
      v.code === 'RERUN_UNSAFE' && v.exit === 1 && v.detail.some((d) => d.includes('@objectstack/core#test')),
      v.code,
    );
  }
  {
    const v = V(1, 0, ['@objectstack/cli#test'], []);
    check(
      'verdict: pass1 red + pass2 green -> BASELINE_FLAKY, measured',
      v.code === 'BASELINE_FLAKY' && v.measured === true && v.exit === 1,
      v.code,
    );
  }
  {
    const same = ['@objectstack/cli#test'];
    const v = V(1, 1, same, same);
    check(
      'verdict: both red, same set -> BASELINE_BROKEN, measured, CLEAN',
      v.code === 'BASELINE_BROKEN' && v.coverage === 'full' && v.headline.includes('CLEAN'),
      `${v.code} ${v.coverage}`,
    );
  }
  {
    const v = V(1, 1, ['@objectstack/cli#test'], ['@objectstack/cli#test', '@objectstack/core#test']);
    check(
      'verdict: both red, pass2 worse -> RERUN_UNSAFE_ON_BROKEN_BASELINE',
      v.code === 'RERUN_UNSAFE_ON_BROKEN_BASELINE' &&
        v.detail.some((d) => d.includes('Newly failing on pass 2: @objectstack/core#test')),
      v.code,
    );
  }
  {
    const v = V(STALL_EXIT_CODE, 0);
    check(
      'verdict: a stall in pass 1 -> STALL, NOT MEASURED, exit 75',
      v.code === 'STALL' && v.measured === false && v.exit === STALL_EXIT_CODE,
      v.code,
    );
  }
  {
    const v = V(0, STALL_EXIT_CODE);
    check(
      'verdict: a stall in pass 2 -> STALL, NOT MEASURED, exit 75',
      v.code === 'STALL' && v.measured === false && v.exit === STALL_EXIT_CODE,
      v.code,
    );
  }
  {
    const pass1 = passOf(1, NIGHT_1014_PASS1);
    const cut = passOf(124, `${testFiles('@objectstack/core:test:', 0, 96)}\nShutting down Turborepo tasks...\n`);
    const v = verdict({ pass1, pass2: cut });
    check(
      'verdict: a pass that did not finish -> INCOMPLETE, NOT MEASURED, exit 1',
      v.code === 'INCOMPLETE' && v.coverage === 'none' && v.measured === false && v.exit === 1,
      `${v.code} ${v.coverage}`,
    );
    check(
      'verdict: a pass that did not finish -> INCOMPLETE, NOT MEASURED, exit 1',
      v.detail.some((d) => d.includes('Pass 2 (exit 124)') && d.includes('time budget')) &&
        v.detail.some((d) => d.includes('Failed in pass 1 before it stopped: @objectstack/dogfood#test')),
      v.detail.join(' | '),
    );
  }
  {
    // Every FINISHED, non-stall combination still reports a reading.
    const combos = [V(0, 0), V(0, 1, [], ['a#test']), V(1, 0, ['a#test'], []), V(1, 1, ['a#test'], ['a#test']), V(1, 1, ['a#test'], ['a#test', 'b#test'])];
    check(
      'verdict: every finished, non-stall verdict reports measured=true',
      combos.every((v) => v.measured === true),
      combos.map((v) => `${v.code}=${v.measured}`).join(' '),
    );
  }
  {
    const v = verdict({ pass1: passOf(1, NIGHT_1014_PASS1), pass2: passOf(1, NIGHT_1014_PASS2) });
    const label = 'verdict: 2026-10-14 end to end -- no interrupted task is newly failing, coverage PARTIAL';
    const newly = v.detail.find((d) => d.startsWith('Newly failing on pass 2:')) ?? '';
    check(label, v.code === 'RERUN_UNSAFE_ON_BROKEN_BASELINE', v.code);
    // The pre-#23880 reading named core, lint AND spec here.
    check(label, newly === 'Newly failing on pass 2: @objectstack/core#test', newly);
    check(label, v.coverage === 'partial' && v.measured === true, v.coverage);
    check(
      label,
      v.detail.some((d) => d.includes('Interrupted by turbo in pass 1') && d.includes('@objectstack/cli#test')),
      v.detail.join(' | '),
    );
  }
  {
    const v = verdict({ pass1: passOf(1, NIGHT_1014_PASS1), pass2: passOf(1, NIGHT_1014_PASS2) });
    check(
      'verdict: a pass-1 failure pass 2 never finished is not re-measured, never recovered',
      v.detail.some((d) => d.startsWith('Failed on pass 1 and never finished by pass 2') && d.includes('@objectstack/dogfood#test')) &&
        !v.detail.some((d) => d.includes('green on pass 2')),
      v.detail.join(' | '),
    );
  }

  // -- rendering -----------------------------------------------------------
  {
    const full = { pass1: passOf(1, logOf({ failing: ['a#test'] })), pass2: passOf(1, logOf({ failing: ['a#test'] })) };
    const partial = { pass1: passOf(1, NIGHT_1014_PASS1), pass2: passOf(1, NIGHT_1014_PASS2) };
    const stall = { pass1: passOf(STALL_EXIT_CODE, ''), pass2: passOf(0, logOf()) };
    const text = (args) => renderVerdict(verdict(args), args);
    check(
      'render: the verdict line names MEASURED, PARTIALLY MEASURED or NOT MEASURED',
      text(full).includes('rerun property: MEASURED') &&
        text(partial).includes('rerun property: PARTIALLY MEASURED') &&
        text(stall).includes('rerun property: NOT MEASURED'),
    );
  }
  {
    const args = { pass1: passOf(1, NIGHT_1014_PASS1), pass2: passOf(1, NIGHT_1014_PASS2) };
    const out = renderVerdict(verdict(args), args);
    check(
      'render: a timeout-only newly failing task carries the twice-on-its-own instruction',
      out.includes('pnpm --filter @objectstack/core run test') && out.includes('@objectstack/core#test (timeout-only)'),
      out,
    );
  }

  // -- the floor -----------------------------------------------------------
  const declared = Object.keys(SELF_TEST_BATTERIES);
  let floorBroken = 0;
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    console.log(
      `  FAIL roster floor: ${declared.length} declared batteries, pinned at ${SELF_TEST_BATTERY_FLOOR}`,
    );
    floorBroken += 1;
  }
  for (const [label, min] of Object.entries(SELF_TEST_BATTERIES)) {
    const ran = registered.get(label) ?? 0;
    if (ran < min) {
      console.log(`  FAIL battery "${label}" DID NOT RUN (registered ${ran}, floor ${min})`);
      floorBroken += 1;
    }
  }
  for (const label of registered.keys()) {
    if (!(label in SELF_TEST_BATTERIES)) {
      console.log(`  FAIL case "${label}" names no declared battery`);
      floorBroken += 1;
    }
  }

  const bad = failed + floorBroken;
  console.log(
    bad === 0
      ? `rerun-safety-verdict --self-test: OK (${declared.length} batteries, ${registered.size} registered)`
      : `rerun-safety-verdict --self-test: ${bad} FAILED`,
  );
  selfTestReachedVerdict = true;
  return bad === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readArg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const status = selfTest();
    if (!selfTestReachedVerdict) {
      console.error('rerun-safety-verdict: the self-test never reached its verdict -- refusing to report a pass.');
      return 1;
    }
    return status;
  }

  const pass1Log = readArg(argv, '--pass1-log');
  const pass2Log = readArg(argv, '--pass2-log');
  const pass1Exit = Number(readArg(argv, '--pass1-exit'));
  const pass2Exit = Number(readArg(argv, '--pass2-exit'));

  if (!pass1Log || !pass2Log || !Number.isInteger(pass1Exit) || !Number.isInteger(pass2Exit)) {
    console.error(
      'usage: rerun-safety-verdict.mjs --pass1-log <f> --pass1-exit <n> --pass2-log <f> --pass2-exit <n>',
    );
    return 2;
  }

  // A log this script cannot read is a reading it cannot stand behind -- say so
  // rather than reporting an empty failing set, which would read as "clean".
  const read = (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch (e) {
      console.error(`rerun-safety-verdict: cannot read ${path} -- ${e.message}`);
      return null;
    }
  };
  const t1 = read(pass1Log);
  const t2 = read(pass2Log);
  if (t1 === null || t2 === null) return 2;

  const args = { pass1: passOf(pass1Exit, t1), pass2: passOf(pass2Exit, t2) };
  const v = verdict(args);
  console.log(renderVerdict(v, args));
  if (v.exit !== 0) {
    console.log(`::error::Rerun Safety: ${v.code} -- ${v.headline}`);
    for (const d of v.detail) console.log(`::error::${d}`);
  }
  return v.exit;
}

// This module EXPORTS `readPass` / `failingTasks` / `verdict` / `renderVerdict`
// so the workflow's verdict step and any future reader can use them, so its top
// level must not run on import -- an importer would otherwise be ended
// mid-import by the dispatch below (`pnpm check:entry-guard`).
if (isEntrypoint(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
