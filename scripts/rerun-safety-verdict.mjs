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
// ## What it does NOT do
//
// It does not make the job green. A red pass 1 still fails the job: the
// workflow's own header calls that deliberate ("if pass 1 is red the suite is
// simply broken on main and that is worth failing on"), and nothing here
// relaxes it. What changes is only that the job now also reports whether the
// second pass agreed with the first.
//
// ## Usage
//
//   node scripts/rerun-safety-verdict.mjs \
//     --pass1-log <file> --pass1-exit <n> \
//     --pass2-log <file> --pass2-exit <n>
//
// Exit status: 0 only for RERUN-SAFE; 75 for a stall (EX_TEMPFAIL, the same
// code run-with-stall-guard uses and for the same reason -- rerun it); 1 for
// every verdict that is a real red.

import { readFileSync } from 'node:fs';

import { isEntrypoint } from './invoked-as.mjs';

const STALL_EXIT_CODE = 75; // EX_TEMPFAIL -- matches run-with-stall-guard.mjs

// ---------------------------------------------------------------------------
// Reading a pass's failing task set out of its log
// ---------------------------------------------------------------------------
//
// Three spellings carry the same fact, and the union of them is the answer.
// None alone is sufficient, which is why all three are read:
//
//   1. `Failed:    @objectstack/cli#test` -- turbo's summary footer. Under-
//      reports: on the 2026-09-08 run it named `@objectstack/verify#test`
//      alone while `plugin-auth`, `runtime` and `client` had each printed
//      ELIFECYCLE in the same run.
//   2. `@objectstack/cli#test:  ERROR  command (...) exited (1)` -- turbo's
//      per-task error line, already `pkg#task` shaped.
//   3. `@objectstack/plugin-auth:test:  ELIFECYCLE  Test failed.` -- the
//      STREAMING prefix (`pkg:task:`), which is how a task that failed while
//      turbo was still running others announces itself.
//
// A leading ISO timestamp is tolerated so that a log downloaded from the
// Actions API (which stamps every line) reads the same as the guard's own tee.

const TS = String.raw`(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+)?`;

const FAILED_FOOTER_RE = new RegExp(`^${TS}\\s*Failed:\\s+(.+?)\\s*$`, 'gm');
const TASK_ERROR_RE = new RegExp(`^${TS}\\s*(\\S+?)#(\\S+?):\\s+ERROR\\s+command\\b`, 'gm');
const ELIFECYCLE_RE = new RegExp(`^${TS}\\s*(\\S+?):([A-Za-z0-9:_-]+?):\\s+ELIFECYCLE\\b`, 'gm');

/**
 * The normalized `pkg#task` ids named as FAILING anywhere in one pass's log.
 *
 * Returned as a sorted array so two passes' sets compare and print stably.
 */
export function failingTasks(logText) {
  const out = new Set();

  for (const m of logText.matchAll(FAILED_FOOTER_RE)) {
    // turbo separates several ids with commas and/or whitespace.
    for (const id of m[1].split(/[,\s]+/)) {
      const trimmed = id.trim();
      if (trimmed.includes('#')) out.add(trimmed);
    }
  }
  for (const m of logText.matchAll(TASK_ERROR_RE)) out.add(`${m[1]}#${m[2]}`);
  for (const m of logText.matchAll(ELIFECYCLE_RE)) out.add(`${m[1]}#${m[2]}`);

  return [...out].sort();
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/**
 * The five verdicts, and the one question each answers.
 *
 * `measured` is the field this whole script exists for: it is the difference
 * between "rerun safety is failing" and "rerun safety was never measured",
 * which the job's exit code alone has never been able to express.
 */
export function verdict({ pass1Exit, pass2Exit, pass1Failing, pass2Failing }) {
  if (pass1Exit === STALL_EXIT_CODE || pass2Exit === STALL_EXIT_CODE) {
    return {
      code: 'STALL',
      measured: false,
      exit: STALL_EXIT_CODE,
      headline: 'STALLED -- frozen output, killed by run-with-stall-guard',
      detail: [
        'This is NOT a rerun-safety verdict: a stall says nothing about',
        'working-tree pollution. Rerun the workflow; if it stalls again at the',
        'same file, note the occurrence on #4250.',
      ],
    };
  }

  const newlyFailing = pass2Failing.filter((t) => !pass1Failing.includes(t));
  const recovered = pass1Failing.filter((t) => !pass2Failing.includes(t));

  if (pass1Exit === 0 && pass2Exit === 0) {
    return {
      code: 'RERUN_SAFE',
      measured: true,
      exit: 0,
      headline: 'RERUN-SAFE -- the second pass agreed with the first',
      detail: ['Both passes of the full suite were green in one working tree.'],
    };
  }

  if (pass1Exit === 0 && pass2Exit !== 0) {
    return {
      code: 'RERUN_UNSAFE',
      measured: true,
      exit: 1,
      headline: 'RERUN-UNSAFE -- the suite passes once and fails on a second run',
      detail: [
        'Something under test writes state into the working tree and reads it',
        'back on the next run. Ordinary CI cannot see this -- every other job is',
        'a fresh clone, so every other job is always run #1.',
        `Newly failing on pass 2: ${newlyFailing.join(', ') || '(none named in the log)'}`,
        'See the on-disk state reported above, and #4065 for the pattern.',
      ],
    };
  }

  if (pass1Exit !== 0 && pass2Exit === 0) {
    return {
      code: 'BASELINE_FLAKY',
      measured: true,
      exit: 1,
      headline: 'SUITE BROKEN ON MAIN (pass 1 only) -- and it passed on rerun',
      detail: [
        'Pass 1 failed and pass 2 was green in the same tree, so this is NOT the',
        '#4065 rerun-unsafe pattern -- it is order-dependence or flake, pointing',
        'the opposite way down the same axis.',
        `Failed on pass 1, green on pass 2: ${recovered.join(', ') || '(none named in the log)'}`,
      ],
    };
  }

  if (newlyFailing.length > 0) {
    return {
      code: 'RERUN_UNSAFE_ON_BROKEN_BASELINE',
      measured: true,
      exit: 1,
      headline: 'RERUN-UNSAFE, on top of a suite that is already broken on main',
      detail: [
        'Both passes failed, but pass 2 failed tasks that pass 1 did not. The',
        'extra ones are the rerun-safety finding; the shared ones are ordinary',
        'breakage on main and belong to whoever owns them.',
        `Newly failing on pass 2: ${newlyFailing.join(', ')}`,
        `Failing in both passes: ${pass1Failing.filter((t) => pass2Failing.includes(t)).join(', ') || '(none)'}`,
      ],
    };
  }

  return {
    code: 'BASELINE_BROKEN',
    measured: true,
    exit: 1,
    headline: 'SUITE BROKEN ON MAIN -- rerun property measured, and it is CLEAN',
    detail: [
      'Both passes failed the same set of tasks, so the second pass agreed with',
      'the first: no task failed only on the rerun. The red belongs to ordinary',
      'breakage on main, NOT to working-tree pollution -- do not go hunting for',
      'state leaks on the strength of this run.',
      `Failing in both passes: ${pass1Failing.join(', ') || '(none named in the log)'}`,
      ...(recovered.length > 0 ? [`Failed on pass 1 only: ${recovered.join(', ')}`] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function renderVerdict(v, { pass1Exit, pass2Exit, pass1Failing, pass2Failing }) {
  const lines = [];
  lines.push('='.repeat(72));
  lines.push(`Rerun Safety verdict: ${v.code}`);
  lines.push('='.repeat(72));
  lines.push(v.headline);
  lines.push('');
  for (const d of v.detail) lines.push(`  ${d}`);
  lines.push('');
  lines.push(`  rerun property: ${v.measured ? 'MEASURED' : 'NOT MEASURED'}`);
  lines.push(`  pass 1 exit ${pass1Exit}, failing tasks: ${pass1Failing.join(', ') || '(none)'}`);
  lines.push(`  pass 2 exit ${pass2Exit}, failing tasks: ${pass2Failing.join(', ') || '(none)'}`);
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
  'parse: streaming ELIFECYCLE prefix': 1,
  'parse: union under-reporting footer (2026-09-08 shape)': 1,
  'parse: an API-downloaded log with ISO timestamps reads the same': 1,
  'parse: a green log names no failing task': 1,
  'verdict: both green -> RERUN_SAFE, measured, exit 0': 1,
  'verdict: pass1 green + pass2 red -> RERUN_UNSAFE, exit 1': 1,
  'verdict: pass1 red + pass2 green -> BASELINE_FLAKY, measured': 1,
  'verdict: both red, same set -> BASELINE_BROKEN, measured, CLEAN': 1,
  'verdict: both red, pass2 worse -> RERUN_UNSAFE_ON_BROKEN_BASELINE': 1,
  'verdict: a stall in pass 1 -> STALL, NOT MEASURED, exit 75': 1,
  'verdict: a stall in pass 2 -> STALL, NOT MEASURED, exit 75': 1,
  'verdict: every non-stall verdict reports measured=true': 1,
  'render: the verdict line names MEASURED or NOT MEASURED': 1,
});

const SELF_TEST_BATTERY_FLOOR = 15;

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` above that line prints nothing and still exits 0 -- a
// self-test that never finished, reported as one that passed.
let selfTestReachedVerdict = false;

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
  check(
    'parse: turbo Failed: footer',
    failingTasks('Failed:    @objectstack/cli#test\n').join() === '@objectstack/cli#test',
  );
  check(
    'parse: turbo per-task ERROR line',
    failingTasks(
      '@objectstack/verify#test:  ERROR  command (/w/packages/verify) /x/pnpm run test exited (1)\n',
    ).join() === '@objectstack/verify#test',
  );
  check(
    'parse: streaming ELIFECYCLE prefix',
    failingTasks('@objectstack/plugin-auth:test:  ELIFECYCLE  Test failed.\n').join() ===
      '@objectstack/plugin-auth#test',
  );
  {
    // The measured 2026-09-08 shape: the footer names verify alone while three
    // more packages announced failure in the stream.
    const log = [
      '@objectstack/verify:test:  ELIFECYCLE  Test failed. See above for more details.',
      '@objectstack/plugin-auth:test:  ELIFECYCLE  Test failed. See above for more details.',
      '@objectstack/runtime:test:  ELIFECYCLE  Test failed. See above for more details.',
      '@objectstack/client:test:  ELIFECYCLE  Test failed. See above for more details.',
      '@objectstack/verify#test:  ERROR  command (/w/packages/verify) /x/pnpm run test exited (1)',
      'Failed:    @objectstack/verify#test',
    ].join('\n');
    const got = failingTasks(log);
    check(
      'parse: union under-reporting footer (2026-09-08 shape)',
      got.length === 4 && got.includes('@objectstack/client#test') && got.includes('@objectstack/runtime#test'),
      `got ${got.join(', ')}`,
    );
  }
  {
    const stamped =
      '2026-09-17T04:46:54.4228362Z @objectstack/cli#test:  ERROR  command (/w/packages/cli) /x/pnpm run test exited (1)\n' +
      '2026-09-17T04:46:54.4229431Z Failed:    @objectstack/cli#test\n';
    check(
      'parse: an API-downloaded log with ISO timestamps reads the same',
      failingTasks(stamped).join() === '@objectstack/cli#test',
      `got ${failingTasks(stamped).join(', ')}`,
    );
  }
  check(
    'parse: a green log names no failing task',
    failingTasks(' Tasks:    140 successful, 140 total\n  Time:    39m50.01s\n').length === 0,
  );

  // -- the verdict table ---------------------------------------------------
  const V = (p1, p2, f1 = [], f2 = []) =>
    verdict({ pass1Exit: p1, pass2Exit: p2, pass1Failing: f1, pass2Failing: f2 });

  {
    const v = V(0, 0);
    check(
      'verdict: both green -> RERUN_SAFE, measured, exit 0',
      v.code === 'RERUN_SAFE' && v.measured === true && v.exit === 0,
      v.code,
    );
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
      v.code === 'BASELINE_BROKEN' && v.measured === true && v.headline.includes('CLEAN'),
      v.code,
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
    // The property the whole change turns on: a red baseline no longer costs
    // the reading. Every non-stall combination must report measured=true.
    const combos = [V(0, 0), V(0, 1, [], ['a#test']), V(1, 0, ['a#test'], []), V(1, 1, ['a#test'], ['a#test']), V(1, 1, ['a#test'], ['a#test', 'b#test'])];
    check(
      'verdict: every non-stall verdict reports measured=true',
      combos.every((v) => v.measured === true),
      combos.map((v) => `${v.code}=${v.measured}`).join(' '),
    );
  }

  // -- rendering -----------------------------------------------------------
  {
    const args = { pass1Exit: 1, pass2Exit: 1, pass1Failing: ['a#test'], pass2Failing: ['a#test'] };
    const text = renderVerdict(verdict(args), args);
    const stall = { pass1Exit: STALL_EXIT_CODE, pass2Exit: 0, pass1Failing: [], pass2Failing: [] };
    const stallText = renderVerdict(verdict(stall), stall);
    check(
      'render: the verdict line names MEASURED or NOT MEASURED',
      text.includes('rerun property: MEASURED') && stallText.includes('rerun property: NOT MEASURED'),
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

  const args = {
    pass1Exit,
    pass2Exit,
    pass1Failing: failingTasks(t1),
    pass2Failing: failingTasks(t2),
  };
  const v = verdict(args);
  console.log(renderVerdict(v, args));
  if (v.exit !== 0) {
    console.log(`::error::Rerun Safety: ${v.code} -- ${v.headline}`);
    for (const d of v.detail) console.log(`::error::${d}`);
  }
  return v.exit;
}

// This module EXPORTS `failingTasks` / `verdict` / `renderVerdict` so the
// workflow's verdict step and any future reader can use them, so its top level
// must not run on import -- an importer would otherwise be ended mid-import by
// the dispatch below (`pnpm check:entry-guard`).
if (isEntrypoint(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
