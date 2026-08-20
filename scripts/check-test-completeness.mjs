#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-test-completeness -- two questions about one `turbo run test` log.
//
// Q1. WAS EVERY TEST vitest COUNTED ACTUALLY RUN? (#3812)
//
// A vitest worker can die at the process level -- native module segfault, OOM,
// an abort inside a binding. There is no JS error to catch, so the cases that
// worker owned never run, and the summary reports what survived:
//
//     Test Files  1 passed (40)
//           Tests  21 passed (401)
//
// That line leads with "passed". It is 380 tests short. #3812 hit exactly this
// (17 cases silently skipped, reported as "22 passed (23)") and it was caught
// by a human reading the log closely, which is not a control.
//
// The run does exit non-zero, so the gate goes red -- the failure mode is not a
// false green, it is a red that READS like a pass. Someone triaging sees
// "passed" and a plausible file count and concludes one file flaked. This turns
// that into a specific, quantified error naming the package and the shortfall.
//
// Q2. DID EVERY PACKAGE SCHEDULED ON THIS SHARD REPORT AT ALL? (#10032)
//
// Q1 is answered from summary lines PRESENT in the log, so it can only grade
// packages that reported. A package emitting NO summary line contributes no
// row: it is neither counted nor missed, it is invisible. Q1's green therefore
// means "every package that reported was internally consistent" and never
// "every package on the shard reported" -- and the two read identically.
//
// Measured, #10032: `Test Core (2/3)` failed with `Failed:
// @objectstack/example-showcase#test` and NOTHING else about that package --
// no `Test Files` line, no `Tests` line, no FAIL, no test name, in the whole
// 5083-line job log -- while this guard printed
// `OK (11 package(s), 3617 test(s) declared and all 3617 accounted for)`.
// ci.yml's own note read that green as "so these are real test failures" and
// triage went to a wrong hypothesis and stayed there. The underlying
// zero-output event was never reproduced and is NOT diagnosed here; this only
// makes CI able to say that it happened, and to which package.
//
// Q2 needs one input the log cannot supply -- who was SUPPOSED to report --
// so `--scheduled` takes ci.yml's `$RUNNER_TEMP/shard-packages.txt` and
// `--package-list` takes the `turbo ls --output=json` document it was sharded
// from (for each package's directory). Both, or neither.
//
// ⛔ TWO WAYS TO PRINT NO SUMMARY THAT ARE NOT DEFECTS. A naive
// scheduled-minus-reported join is a false-red machine; each of these was
// measured on this tree (2026-08-20) before the rules below were written.
//
//   NOTHING TO RUN -- `shard-packages.txt` lists every package on the shard,
//   including those turbo runs no `test` task for at all. 5 of this repo's 77
//   packages declare no `test` script, and 16 more run `vitest run
//   --passWithNoTests`, which prints no summary when a package has no test
//   files. So a package is expected to report only if it BOTH declares a
//   `test` script and owns at least one test file. (Today those two sets
//   coincide exactly -- 72 of 77 -- but they drift in opposite directions, so
//   both halves are checked rather than one being assumed from the other.)
//
//   NEVER REACHED -- turbo stops scheduling on the first failure, so an
//   ordinary red suite leaves later packages unrun and silent through no fault
//   of their own. Measured: one failing task in a 4-task run printed
//   `Tasks: 1 successful, 4 total`, and the two cancelled packages produced no
//   summary. Charging those to this guard would put noise on every red suite.
//
// So Q2 asks for a summary only where its absence is a real finding:
//
//   RULE A (the #10032 case) -- turbo named the package in its `Failed:` line
//   and the log holds no summary for it. The task ran and failed, so "see
//   above for more details" is a promise the log does not keep. Always red.
//
//   RULE B (the dangerous inverse) -- the run COMPLETED, every task succeeded
//   (`Tasks: N successful, N total`), and a package that should have reported
//   did not. Nothing was cancelled, so silence here is a suite that went green
//   having reported nothing. Always red.
//
//   NEITHER -- the run stopped early and the package was simply never reached.
//   Printed as a note, never red. This is a deliberate gap and the only one: on
//   an aborted run a genuinely-silent package is indistinguishable from a
//   cancelled one from the log alone, and Rule A already covers the package the
//   abort was about.
//
//   node scripts/check-test-completeness.mjs <turbo-test-log> \
//     [--scheduled <shard-packages.txt> --package-list <turbo-ls.json>]
//   node scripts/check-test-completeness.mjs --self-test
//
// Reads a saved `turbo run test` log rather than wrapping vitest, so it needs no
// change to the 60+ per-package vitest configs. In CI the test step tees its
// output here. NOTE the tee: `cmd | tee f` reports TEE's exit status, so the
// workflow sets `set -o pipefail` -- without it a failing test suite would look
// green because tee succeeded.
//
// ⛔ WHY THE SELF-TEST RUNS ON EVERY INVOCATION, not from a lint step. This
// repo has already paid for the alternative: `partition-test-shards.mjs`
// carried a `--self-test` that NOTHING ran from the day it was written, so
// every assertion in it evaluated never and `--union-into` wrote a `count: 0`
// document beside two items for as long as nobody looked ("a pin nobody runs
// is not a weaker pin, it is no pin", lint.yml). The rules above are pure
// functions over strings, so running all of them costs ~1ms of a job that
// takes minutes, and wiring them into the guard's own startup is the one
// placement from which they cannot become unrun. `--self-test` also stands
// alone for local use.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `@objectstack/cli:test:  Tests  381 passed | 3 skipped (384)`
//  ^ turbo prefix (absent when vitest runs directly)   ^ tallies   ^ declared
const SUMMARY = /^(?:(\S+?):test:)?\s*(Test Files|Tests)\s+(.+?)\s+\((\d+)\)\s*$/;

// turbo's end-of-run roster, both measured on turbo 2.10.10:
//   `Failed:    @objectstack/embedder-openai#test, @objectstack/sdui-parser#test`
//   ` Tasks:    2 successful, 4 total`
const FAILED = /^Failed:\s+(.+?)\s*$/;
const TASKS = /^\s*Tasks:\s+(\d+) successful, (\d+) total\s*$/;

// Strip ANSI first. vitest colours its summary, and the escape bytes sit
// between the number and its label, so every naive column-based parse of a raw
// log silently reads the wrong field.
export function stripAnsi(raw) {
  return raw.replace(/\x1B\[[0-9;]*m/g, '');
}

// HOW A SUMMARY LINE IS ATTRIBUTED TO A PACKAGE, and why one spelling is not
// enough. Measured on turbo 2.10.10, both shapes from real runs:
//
//   STREAM order (what you get running turbo by hand) prefixes every line:
//     `@objectstack/types:test:  Tests  356 passed (356)`
//
//   GROUPED order (what turbo switches to in GitHub Actions, and therefore the
//   ONLY shape CI ever writes) emits a group header and NO per-line prefix:
//     `::group::@objectstack/spec:test`      <- GitHub renders this `##[group]`
//     ` Test Files  415 passed (415)`
//     `       Tests  11045 passed (11045)`
//     `::endgroup::`
//
// Reading only the prefix therefore attributes NOTHING in CI: every summary
// arrives anonymous, every scheduled package looks silent, and the shard join
// reddens the whole shard. That is not hypothetical -- it is what the first
// version of this check did on its own PR (Test Core (1/3), run 32376757655:
// `@objectstack/spec` reported 415 files and 11045 tests, and the guard said it
// had reported nothing). The group header is turbo's own statement of whose
// output follows, so it is read as the primary attribution, not a heuristic.
const GROUP_OPEN = /^(?:::group::|##\[group\])(.+?)\s*$/;
const GROUP_CLOSE = /^(?:::endgroup::|##\[endgroup\])\s*$/;

export function parseSummaries(text) {
  const rows = [];
  let group = null;
  for (const line of text.split('\n')) {
    if (GROUP_CLOSE.test(line)) {
      group = null;
      continue;
    }
    const open = line.match(GROUP_OPEN);
    if (open) {
      // `@objectstack/spec:test` -> spec, but `@objectstack/spec:build` and
      // GitHub's own `Run <script>` groups attribute nothing. Package names
      // carry `@` and `/` but never `:`, so the last `:` is the task boundary.
      const label = open[1];
      const sep = label.lastIndexOf(':');
      group = sep > 0 && label.slice(sep + 1) === 'test' ? label.slice(0, sep) : null;
      continue;
    }
    const m = line.match(SUMMARY);
    if (!m) continue;
    const [, pkg, kind, tallies, declared] = m;

    // `381 passed | 3 skipped` -> 384. Every bucket counts as "accounted for";
    // a skipped test is a decision, an absent one is a hole.
    const counted = [...tallies.matchAll(/(\d+)\s+[a-z]+/g)].reduce((sum, t) => sum + Number(t[1]), 0);

    rows.push({
      pkg: pkg ?? group ?? '(vitest)',
      kind,
      counted,
      declared: Number(declared),
      line: line.trim(),
    });
  }
  return rows;
}

// Packages whose `test` task turbo reported as failed. Entries are `pkg#task`,
// so a `#build` failure is not mistaken for a suite that went silent.
export function parseFailedTestPackages(text) {
  const failed = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(FAILED);
    if (!m) continue;
    for (const entry of m[1].split(',')) {
      const task = entry.trim();
      const hash = task.lastIndexOf('#');
      if (hash > 0 && task.slice(hash + 1) === 'test') failed.add(task.slice(0, hash));
    }
  }
  return failed;
}

// true = every task turbo scheduled succeeded, so nothing was cancelled.
// false = it stopped early. null = turbo never printed its roster (it died, or
// the log was truncated) -- unknown, and treated as "not completed" by Rule B.
export function parseRunCompleted(text) {
  let completed = null;
  for (const line of text.split('\n')) {
    const m = line.match(TASKS);
    if (m) completed = Number(m[1]) === Number(m[2]);
  }
  return completed;
}

/**
 * Rules A and B over one shard. `describe(name)` returns
 * `{ hasTestScript, testFileCount }` for a scheduled package, or null if the
 * package list does not contain it -- which is a contradiction, not a default:
 * `shard-packages.txt` is derived FROM that document, so a name in one and not
 * the other means they are from different runs and neither can be trusted.
 */
export function classifyShard({ scheduled, reported, anonymousReports = 0, failed, runCompleted, describe }) {
  const silent = [];
  const notReached = [];
  const exempt = [];
  const expected = [];
  for (const name of scheduled) {
    const info = describe(name);
    if (!info) {
      throw new Error(
        `${name} is scheduled on this shard but the turbo ls document does not list it -- ` +
          'the two inputs are from different runs. Refusing to grade the shard.',
      );
    }
    if (!info.hasTestScript) {
      exempt.push({ name, why: 'declares no `test` script, so turbo ran no task for it' });
      continue;
    }
    if (info.testFileCount === 0) {
      exempt.push({ name, why: 'owns no test files, so vitest prints no summary' });
      continue;
    }
    expected.push(name);
  }

  // Summaries the parser could attribute to nobody -- no `<pkg>:test:` prefix
  // and no enclosing group. With both spellings understood this should be
  // empty, so it is a backstop for a THIRD log shape rather than a routine
  // path, and it deliberately refuses to guess: attributing a stray summary to
  // the wrong package would mark a silent package as having reported, which is
  // the one error worse than not attributing at all. One candidate is not a
  // guess (there is nothing else it could belong to); more than one is.
  const candidates = expected.filter((name) => !reported.has(name));
  let unattributable = [];
  let judged = candidates;
  if (anonymousReports > 0 && candidates.length === 1) {
    judged = [];
  } else if (anonymousReports > 0 && candidates.length > 1) {
    unattributable = candidates;
    judged = [];
  }

  for (const name of judged) {
    if (failed.has(name)) {
      silent.push({ name, why: 'turbo reported this task FAILED, and the log holds no vitest summary for it' });
    } else if (runCompleted === true) {
      silent.push({ name, why: 'the run completed with every task successful, and this package reported nothing' });
    } else {
      notReached.push(name);
    }
  }
  return { silent, notReached, exempt, unattributable };
}

function countTestFiles(dir) {
  const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
  const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.next']);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) n += countTestFiles(path.join(dir, e.name));
    } else if (TEST_FILE.test(e.name)) {
      n++;
    }
  }
  return n;
}

// Same base-resolution contract partition-test-shards.mjs pins: entries reach
// us repo-relative today and absolute historically, and resolving against
// process.cwd() is the one base that can silently be wrong.
function describeFromPackageList(listPath) {
  // Loud, never lenient: a shard whose scheduled set cannot be read is a shard
  // this guard cannot grade, and passing on input it could not read is the
  // exact #4690 anti-pattern the rest of this workflow is built to avoid.
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(listPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `cannot read the turbo ls document at ${listPath} -- ${err.message}. ` +
        'Refusing to grade shard completeness without it.',
    );
  }
  const items = parsed?.packages?.items;
  if (!Array.isArray(items)) {
    throw new Error(
      `${listPath}: expected \`turbo ls --output=json\` shape {packages:{items:[...]}} -- ` +
        'did an experimental-command upgrade change the output?',
    );
  }
  const byName = new Map();
  for (const it of items) {
    if (typeof it?.name !== 'string' || typeof it?.path !== 'string') {
      throw new Error(`${listPath}: package entry missing name/path: ${JSON.stringify(it)}`);
    }
    byName.set(it.name, path.resolve(REPO_ROOT, it.path));
  }
  return (name) => {
    const dir = byName.get(name);
    if (dir === undefined) return null;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch (err) {
      throw new Error(`${name}: cannot read package.json at ${dir} -- ${err.message}`);
    }
    return {
      hasTestScript: typeof pkg?.scripts?.test === 'string' && pkg.scripts.test.trim() !== '',
      testFileCount: countTestFiles(dir),
    };
  };
}

function selfTest({ quiet = false } = {}) {
  const eq = (actual, expected, what) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${what}: got ${a}, want ${e}`);
  };
  const threw = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  // -- stripAnsi / parseSummaries: the colouring is what breaks naive parses. --
  eq(stripAnsi('\x1B[32mTests\x1B[39m'), 'Tests', 'stripAnsi: colour codes survived');
  const colored = stripAnsi(
    '@objectstack/types:test: \x1B[2m      Tests \x1B[22m\x1B[1m\x1B[32m356 passed\x1B[39m\x1B[22m\x1B[90m (356)\x1B[39m',
  );
  eq(parseSummaries(colored), [{ pkg: '@objectstack/types', kind: 'Tests', counted: 356, declared: 356, line: colored.trim() }], 'summary: coloured turbo line');
  eq(parseSummaries('  Tests  21 passed | 3 skipped (24)').map((r) => [r.pkg, r.counted, r.declared]), [['(vitest)', 24, 24]], 'summary: unprefixed multi-bucket line');
  eq(parseSummaries('@objectstack/cli:test:  Tests  21 passed (401)').map((r) => r.counted - r.declared), [-380], 'summary: the #3812 shortfall');
  eq(parseSummaries('@objectstack/cli:test:  Test Files  1 passed (40)').map((r) => r.kind), ['Test Files'], 'summary: Test Files kind');
  eq(parseSummaries('nothing to see here'), [], 'summary: non-summary line matched');
  // A `Failed:` roster must never be read as a summary row.
  eq(parseSummaries('Failed:    @objectstack/example-showcase#test'), [], 'summary: Failed roster parsed as a summary');

  // -- parseFailedTestPackages: measured turbo 2.10.10 rosters. --
  eq([...parseFailedTestPackages('Failed:    @objectstack/example-showcase#test')], ['@objectstack/example-showcase'], 'failed: single entry');
  eq([...parseFailedTestPackages('Failed:    @objectstack/embedder-openai#test, @objectstack/sdui-parser#test')].sort(), ['@objectstack/embedder-openai', '@objectstack/sdui-parser'], 'failed: comma-separated roster');
  eq([...parseFailedTestPackages('Failed:    @objectstack/spec#build')], [], 'failed: a build failure was charged to the test task');
  eq([...parseFailedTestPackages('Failed:    @objectstack/spec#build, @objectstack/cli#test')], ['@objectstack/cli'], 'failed: mixed roster');
  eq([...parseFailedTestPackages('no roster here')], [], 'failed: invented an entry');

  // -- parseRunCompleted: the cancelled-vs-silent discriminator. --
  eq(parseRunCompleted(' Tasks:    4 successful, 4 total'), true, 'tasks: a complete run');
  eq(parseRunCompleted(' Tasks:    1 successful, 4 total'), false, 'tasks: an aborted run');
  eq(parseRunCompleted(' Tasks:    71 successful, 73 total'), false, 'tasks: the #10032 run');
  eq(parseRunCompleted('turbo never got there'), null, 'tasks: absent roster is not unknown');
  // Last roster wins: a log can carry an earlier turbo run's tail.
  eq(parseRunCompleted(' Tasks:    2 successful, 2 total\n Tasks:    1 successful, 4 total'), false, 'tasks: last roster did not win');

  // -- classifyShard. --
  const describe = (map) => (name) => map[name] ?? null;
  const runs = (over) =>
    classifyShard({
      scheduled: ['a', 'b'],
      reported: new Set(),
      failed: new Set(),
      runCompleted: false,
      describe: describe({ a: { hasTestScript: true, testFileCount: 1 }, b: { hasTestScript: true, testFileCount: 1 } }),
      ...over,
    });

  // Rule A: failed and silent -> red, whatever the run state.
  eq(runs({ failed: new Set(['a']) }).silent.map((s) => s.name), ['a'], 'rule A: a failed silent package was not flagged');
  // ...and a failed package that DID report is an ordinary test failure.
  eq(runs({ failed: new Set(['a']), reported: new Set(['a', 'b']) }).silent, [], 'rule A: an ordinary reported failure was flagged');
  // Rule B: complete run, nothing cancelled, so silence is a finding.
  eq(runs({ runCompleted: true }).silent.map((s) => s.name), ['a', 'b'], 'rule B: silence on a complete run was not flagged');
  eq(runs({ runCompleted: true, reported: new Set(['a', 'b']) }).silent, [], 'rule B: a complete, fully-reported run was flagged');
  // Neither: aborted run, package never reached -> a note, never red.
  eq(runs({ failed: new Set(['a']) }).notReached, ['b'], 'neither: an unreached package was not noted');
  eq(runs({ failed: new Set(['a']) }).silent.length, 1, 'neither: an unreached package was charged as silent');
  eq(runs({ runCompleted: null }).silent, [], 'neither: an unknown run state was treated as complete');
  eq(runs({ runCompleted: null }).notReached, ['a', 'b'], 'neither: an unknown run state lost its notes');

  // Exemptions -- the two measured false-red sources.
  const exempt = classifyShard({
    scheduled: ['noscript', 'nofiles', 'real'],
    reported: new Set(['real']),
    failed: new Set(),
    runCompleted: true,
    describe: describe({
      noscript: { hasTestScript: false, testFileCount: 0 },
      nofiles: { hasTestScript: true, testFileCount: 0 },
      real: { hasTestScript: true, testFileCount: 3 },
    }),
  });
  eq(exempt.silent, [], 'exempt: a package with nothing to run was flagged');
  eq(exempt.exempt.map((e) => e.name), ['noscript', 'nofiles'], 'exempt: the exemption roster is wrong');
  // A package with test files but no script is still exempt -- turbo runs nothing.
  eq(
    classifyShard({ scheduled: ['x'], reported: new Set(), failed: new Set(), runCompleted: true, describe: describe({ x: { hasTestScript: false, testFileCount: 9 } }) }).silent,
    [],
    'exempt: files without a script were charged',
  );
  // ...and a script with no files is exempt even when it FAILED (nothing to summarise).
  eq(
    classifyShard({ scheduled: ['x'], reported: new Set(), failed: new Set(['x']), runCompleted: false, describe: describe({ x: { hasTestScript: true, testFileCount: 0 } }) }).silent,
    [],
    'exempt: a no-files package was charged on failure',
  );

  // Contradictory inputs are refused, never defaulted around.
  if (!threw(() => classifyShard({ scheduled: ['ghost'], reported: new Set(), failed: new Set(), runCompleted: true, describe: describe({}) }))) {
    throw new Error('contradiction: a package absent from the turbo ls document was accepted');
  }

  // -- GROUPED log order: the shape CI actually writes. --
  // The exact three lines from Test Core (1/3), run 32376757655, which the
  // prefix-only version read as "@objectstack/spec reported nothing".
  const ciGrouped = [
    '##[group]@objectstack/spec:test',
    ' Test Files  415 passed (415)',
    '       Tests  11045 passed (11045)',
    '##[endgroup]',
  ].join('\n');
  eq(
    parseSummaries(ciGrouped).map((r) => [r.pkg, r.kind, r.counted, r.declared]),
    [['@objectstack/spec', 'Test Files', 415, 415], ['@objectstack/spec', 'Tests', 11045, 11045]],
    'grouped: the real CI summary was not attributed to its group',
  );
  // turbo's own spelling, before GitHub rewrites the marker.
  eq(
    parseSummaries('::group::@objectstack/spec:test\n       Tests  11045 passed (11045)\n::endgroup::').map((r) => r.pkg),
    ['@objectstack/spec'],
    'grouped: turbo\'s ::group:: spelling was not read',
  );
  // Several packages in one grouped log -- the multi-package CI shard.
  eq(
    parseSummaries(
      [
        '::group::@objectstack/sdui-parser:test',
        '      Tests  6 passed (6)',
        '::endgroup::',
        '::group::@objectstack/types:test',
        '      Tests  356 passed (356)',
        '::endgroup::',
      ].join('\n'),
    ).map((r) => [r.pkg, r.counted]),
    [['@objectstack/sdui-parser', 6], ['@objectstack/types', 356]],
    'grouped: a multi-package grouped log lost its attribution',
  );
  // A group must not leak past its end.
  eq(
    parseSummaries('::group::@objectstack/spec:test\n::endgroup::\n      Tests  5 passed (5)').map((r) => r.pkg),
    ['(vitest)'],
    'grouped: attribution leaked past ::endgroup::',
  );
  // Only the `test` task attributes: a build group and GitHub's own step
  // groups must never lend their name to a summary.
  eq(
    parseSummaries('::group::@objectstack/spec:build\n      Tests  5 passed (5)').map((r) => r.pkg),
    ['(vitest)'],
    'grouped: a build group was read as a test group',
  );
  eq(
    parseSummaries('##[group]Run if [ ! -f "$RUNNER_TEMP/test-core.log" ]; then\n      Tests  5 passed (5)').map((r) => r.pkg),
    ['(vitest)'],
    'grouped: a GitHub step group was read as a test group',
  );
  // An explicit prefix still wins -- stream order is unaffected.
  eq(
    parseSummaries('::group::@objectstack/spec:test\n@objectstack/cli:test:  Tests  5 passed (5)').map((r) => r.pkg),
    ['@objectstack/cli'],
    'grouped: an explicit prefix lost to the enclosing group',
  );

  // -- Anonymous summaries: attribute only when there is nothing to guess. --
  const anon = (over) =>
    classifyShard({
      scheduled: ['a', 'b'],
      reported: new Set(),
      failed: new Set(),
      runCompleted: true,
      describe: describe({ a: { hasTestScript: true, testFileCount: 1 }, b: { hasTestScript: true, testFileCount: 1 } }),
      ...over,
    });
  // Two candidates, one stray summary -> refuse to guess, and NEVER red.
  eq(anon({ anonymousReports: 1 }).silent, [], 'anonymous: guessed between two candidates');
  eq(anon({ anonymousReports: 1 }).unattributable, ['a', 'b'], 'anonymous: the ungraded pair was not surfaced');
  // One candidate, one stray summary -> unambiguous, so not a finding.
  eq(
    classifyShard({
      scheduled: ['a'],
      reported: new Set(),
      anonymousReports: 1,
      failed: new Set(),
      runCompleted: true,
      describe: describe({ a: { hasTestScript: true, testFileCount: 1 } }),
    }).silent,
    [],
    'anonymous: a single candidate with a stray summary was charged',
  );
  // ...and with NO stray summary the same single candidate is still red, so
  // the fallback cannot be used to launder a genuinely silent package.
  eq(
    classifyShard({
      scheduled: ['a'],
      reported: new Set(),
      anonymousReports: 0,
      failed: new Set(),
      runCompleted: true,
      describe: describe({ a: { hasTestScript: true, testFileCount: 1 } }),
    }).silent.map((x) => x.name),
    ['a'],
    'anonymous: the #10032 case stopped being red',
  );

  if (!quiet) console.log('check-test-completeness: self-test OK');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    selfTest();
    return;
  }
  // Every invocation, not a lint step -- see the header note on why.
  selfTest({ quiet: true });

  let logPath = null;
  let scheduledPath = null;
  let packageListPath = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--scheduled') scheduledPath = argv[++i];
    else if (arg === '--package-list') packageListPath = argv[++i];
    else if (!arg.startsWith('--') && logPath === null) logPath = arg;
    else {
      console.error(`check-test-completeness: unrecognized argument: ${arg}`);
      process.exit(1);
    }
  }
  if (!logPath) {
    console.error(
      'check-test-completeness: usage: check-test-completeness.mjs <turbo-test-log> ' +
        '[--scheduled <shard-packages.txt> --package-list <turbo-ls.json>]',
    );
    process.exit(1);
  }
  if (Boolean(scheduledPath) !== Boolean(packageListPath)) {
    console.error(
      'check-test-completeness: --scheduled and --package-list go together -- the scheduled ' +
        'list carries names only, and the turbo ls document is what resolves each to a directory.',
    );
    process.exit(1);
  }

  let raw;
  try {
    raw = readFileSync(logPath, 'utf8');
  } catch (err) {
    console.error(`check-test-completeness: cannot read ${logPath} -- ${err.message}`);
    process.exit(1);
  }

  const text = stripAnsi(raw);
  const rows = parseSummaries(text);
  const holes = rows.filter((r) => r.counted !== r.declared);

  let shard = null;
  if (scheduledPath) {
    let scheduled;
    try {
      scheduled = readFileSync(scheduledPath, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    } catch (err) {
      console.error(`check-test-completeness: cannot read ${scheduledPath} -- ${err.message}`);
      process.exit(1);
    }
    try {
      const testRows = rows.filter((r) => r.kind === 'Tests');
      shard = classifyShard({
        scheduled,
        reported: new Set(testRows.filter((r) => r.pkg !== '(vitest)').map((r) => r.pkg)),
        anonymousReports: testRows.filter((r) => r.pkg === '(vitest)').length,
        failed: parseFailedTestPackages(text),
        runCompleted: parseRunCompleted(text),
        describe: describeFromPackageList(packageListPath),
      });
    } catch (err) {
      console.error(`check-test-completeness: ${err.message}`);
      process.exit(1);
    }
    shard.scheduledCount = scheduled.length;
  }

  const silent = shard?.silent ?? [];
  if (shard) {
    for (const n of shard.notReached) {
      console.log(`check-test-completeness: note: ${n} was scheduled but never reached -- the run stopped before it.`);
    }
    if (shard.unattributable.length > 0) {
      console.log(
        `check-test-completeness: note: ${shard.unattributable.length} scheduled package(s) could not be ` +
          `matched to a summary, and the log holds unattributed summaries, so completeness is NOT graded for ` +
          `them: ${shard.unattributable.join(', ')}. Attributing a stray summary by guesswork would be worse ` +
          'than this gap. If you are seeing this, the log carries a shape neither the `<pkg>:test:` prefix nor ' +
          'turbo\'s `::group::<pkg>:test` header covers -- that is the bug to fix.',
      );
    }
  }

  if (holes.length === 0 && silent.length === 0) {
    if (shard) {
      const expected = shard.scheduledCount - shard.exempt.length - shard.notReached.length;
      console.log(
        `check-test-completeness: OK (${expected} of ${shard.scheduledCount} scheduled package(s) ` +
          `reported, ${shard.exempt.length} had nothing to run, ${shard.notReached.length} never reached; ` +
          `${rows.filter((r) => r.kind === 'Tests').reduce((s, r) => s + r.declared, 0)} test(s) declared and all accounted for).`,
      );
      process.exit(0);
    }
    if (rows.length === 0) {
      // Legitimate: `turbo run test --affected` runs nothing when a PR touches no
      // package. Say so out loud rather than reporting a vacuous pass.
      console.log(
        'check-test-completeness: no vitest summaries in the log -- nothing to verify ' +
          '(expected when --affected selects no packages).',
      );
      process.exit(0);
    }
    const tests = rows.filter((r) => r.kind === 'Tests');
    const total = tests.reduce((sum, r) => sum + r.declared, 0);
    console.log(
      `check-test-completeness: OK (${tests.length} package(s), ` +
        `${total} test(s) declared and all ${total} accounted for).`,
    );
    process.exit(0);
  }

  if (silent.length > 0) {
    const were = silent.length === 1 ? 'package was' : 'packages were';
    console.error(
      `check-test-completeness: ${silent.length} ${were} scheduled on this shard and reported no vitest summary\n`,
    );
    for (const s of silent) {
      console.error(`  • ${s.name} -- ${s.why}`);
    }
    console.error(`
The log therefore cannot say what those suites did. This is NOT the same finding
as a shortfall below: nothing under-reported, something did not report at all,
so this guard's green would otherwise have covered a package it never saw.

turbo streams each task's output into this log by default (no \`outputLogs\`
suppression is set on \`test\`), and a cache hit REPLAYS the summary it stored,
so a scheduled package with test files is expected to print one either way.
Absence means the output never reached the log: the task died at the process
level before writing a summary, or its captured output was lost.

Precedent: #10032, where \`Test Core (2/3)\` failed naming
@objectstack/example-showcase#test and the complete 5083-line job log contained
no other mention of that package -- no summary, no FAIL, no test name -- while
this guard printed OK. The mechanism was never reproduced and is still unknown;
what this red buys is that the next occurrence names itself instead of sending
triage to a wrong hypothesis.`);
  }

  if (holes.length > 0) {
    const plural = holes.length === 1 ? 'summary reports' : 'summaries report';
    console.error(`${silent.length > 0 ? '\n' : ''}check-test-completeness: ${holes.length} ${plural} fewer results than it counted\n`);
    for (const h of holes) {
      const missing = h.declared - h.counted;
      console.error(`  • ${h.pkg} -- ${h.kind}: ${h.counted} of ${h.declared} accounted for, ${missing} missing`);
      console.error(`    ${h.line}`);
    }
    console.error(`
vitest counted these and then did not report an outcome for all of them. The
usual cause is a worker dying at the process level -- a native module segfault,
OOM, or an abort inside a binding -- which produces no JS error, so the cases
that worker owned never ran and the summary still leads with "passed".

This is not a flake; re-running does not make those tests have run. Reproduce on
the runtime CI uses (see .nvmrc) and look for "Worker exited unexpectedly" or a
non-zero signal exit above the summary.

Precedent: #3812, where a test imported a native better-sqlite3 whose engines
required a newer Node than CI ran. It reported "22 passed (23)" while 17 cases
silently did not run.`);
  }

  process.exit(1);
}

main();
