#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-workflow-step-name-quoting -- an unquoted `- name:` step name must not
// contain ` #` (space + hash), because in YAML that begins a comment inside a
// plain scalar and silently truncates the step's real name.
//
//   node scripts/check-workflow-step-name-quoting.mjs
//   node scripts/check-workflow-step-name-quoting.mjs --self-test   # verify the checker itself
//   node scripts/check-workflow-step-name-quoting.mjs --list        # every step name, judged
//
// ## The defect (#15149)
//
// `.github/workflows/lint.yml` carried one step whose `name:` is an unquoted
// plain scalar containing ` #`:
//
//     - name: The #13419 name-fold fixture has no non-test loader
//
// A space followed by `#` begins a YAML comment inside a plain scalar, so
// everything from ` #13419` on is not part of the value. The step's real
// parsed name is the three-letter string `The`. The GitHub Actions log names
// the step `The`, and anything that resolves a step by its name text against
// the workflow source (scripts/pm/ci-failure.mjs) cannot find it.
//
// This repo names issue numbers in step names as a matter of style (667
// `- name:` lines across `.github/workflows/` as of this gate landing), so the
// keystroke that produces this is available to every future author and
// nothing red-flags it. The fix is one line -- quote the scalar:
//
//     - name: 'The #13419 name-fold fixture has no non-test loader'
//
// ## The judgement, and why it is grep-level (triage ruling, #15149)
//
// Look only at the first non-blank character after `- name:`. If it is `'`
// or `"`, the scalar is already quoted -- skip it, whatever follows. Otherwise
// search the REMAINING text for ` #`.
//
// Two things that judgement is deliberately NOT:
//
//   - NOT "the line contains ` #`". That would redden a legitimate trailing
//     YAML comment on any OTHER key in the file (`runs-on: ubuntu-latest  #
//     why`), because this gate only ever looks at `- name:` lines in the
//     first place -- there is nothing broader to accidentally sweep in.
//   - NOT "strip quote characters, then look for `#`". `check-links.yml`
//     carries a step name that is unquoted AND contains an embedded `"`,
//     which is completely legal YAML:
//
//         - name: Report a setup failure as "the link check did not run"
//
//     Stripping `'"` before judging would read that value as if it started
//     with the letter after the stripped quote, misclassify it, and false-
//     positive on a step name that is not broken. The negative-control battery
//     below pins exactly this fixture.
//
// A grep-level scan (not a YAML-parser-level name comparison) is sufficient
// here by ruling: of the two shapes that make YAML silently change a step's
// parsed name -- ` #` inside an unquoted scalar, and a leading `&` read as an
// anchor -- this repo's own style (issue numbers written into step names)
// only produces the first. Every other dangerous shape a workflow step name
// could take (an unmatched brace, an unclosed quote, a leading `*` alias
// reference) errors LOUDLY at YAML-parse time and reds CI on its own; it does
// not need a gate to notice.
//
// ## Scope: the population is `- name:` lines under .github/workflows/ only
//
// The population is spelled directly as the WORKFLOW_DIR literal below (the
// check-workflow-status-functions.mjs convention) -- narrow and named, so it
// needs no dispatch-gates population marker of its own.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const WORKFLOW_DIR = '.github/workflows';

/** A step-name line: `- name:` at the start of a mapping entry, with the rest of the line captured. */
const STEP_NAME_LINE = /^(\s*)-\s+name:(.*)$/;

// ── Scanning ────────────────────────────────────────────────────────────────

/**
 * Every `- name:` line under `<root>/.github/workflows/`, judged by the
 * triage-ruled criterion: first non-blank character after `- name:` decides
 * quoted-or-not; an unquoted value is a violation only if its remaining text
 * contains ` #`.
 *
 * @param {string} root repository root (or, in --self-test, a fixture root)
 * @returns {{
 *   violations: { file: string, line: number, name: string }[],
 *   quoted: { file: string, line: number, name: string }[],
 *   unquotedSafe: { file: string, line: number, name: string }[],
 *   problems: string[],
 *   files: number,
 *   stepNames: number,
 * }}
 */
export function scan(root) {
  const violations = [];
  const quoted = [];
  const unquotedSafe = [];
  const problems = [];
  let stepNames = 0;

  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    problems.push(`${WORKFLOW_DIR}/ does not exist -- nothing was scanned, so nothing was verified.`);
    return { violations, quoted, unquotedSafe, problems, files: 0, stepNames: 0 };
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
  if (files.length === 0) {
    problems.push(`${WORKFLOW_DIR}/ holds no .yml/.yaml file -- nothing was scanned, so nothing was verified.`);
    return { violations, quoted, unquotedSafe, problems, files: 0, stepNames: 0 };
  }

  for (const fileName of files) {
    const rel = `${WORKFLOW_DIR}/${fileName}`;
    const source = readFileSync(join(dir, fileName), 'utf8');
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const m = STEP_NAME_LINE.exec(lines[i]);
      if (!m) continue;

      const rest = m[2];
      const trimmed = rest.replace(/^\s+/, '');
      if (trimmed.length === 0) {
        // `- name:` with nothing after it on this line. Not a shape this repo
        // writes (verified when this gate landed), and nothing to judge: an
        // empty plain scalar has no ` #' to truncate.
        stepNames++;
        unquotedSafe.push({ file: rel, line: i + 1, name: '' });
        continue;
      }

      stepNames++;
      const first = trimmed[0];
      const entry = { file: rel, line: i + 1, name: trimmed };

      if (first === "'" || first === '"') {
        // Already quoted -- skip, per the triage-ruled criterion. Whatever
        // follows the opening quote (including a literal ` #`) is inside the
        // YAML string, not a comment.
        quoted.push(entry);
        continue;
      }

      if (trimmed.includes(' #')) {
        violations.push(entry);
      } else {
        unquotedSafe.push(entry);
      }
    }
  }

  return { violations, quoted, unquotedSafe, problems, files: files.length, stepNames };
}

// ── Reporting ───────────────────────────────────────────────────────────────

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function summarise({ files, stepNames, quoted, unquotedSafe }) {
  return `scanned ${files} workflow file(s), ${stepNames} step name(s) -- ${quoted.length} already quoted, ${unquotedSafe.length} unquoted-and-safe`;
}

function reportProblems(problems) {
  console.error(`check-workflow-step-name-quoting: ${problems.length} input problem(s) -- the scan is NOT a pass\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    '\nA gate that could not read its input has verified nothing. Reporting OK here would be the #4690 ' +
      'anti-pattern (a check that silently skipped and exited 0), so this exits non-zero instead.',
  );
}

function main() {
  const result = scan(repoRoot());
  const { violations, problems } = result;

  if (problems.length > 0) {
    reportProblems(problems);
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(`check-workflow-step-name-quoting: OK (${summarise(result)}).`);
    process.exit(0);
  }

  const plural = violations.length === 1 ? 'step name' : 'step names';
  console.error(
    `check-workflow-step-name-quoting: ${violations.length} unquoted ${plural} contain \` #\`, which YAML reads as a comment -- the parsed step name is NOT the text you see\n`,
  );
  for (const v of violations) {
    console.error(`  • ${v.file}:${v.line}`);
    console.error(`      - name: ${v.name}`);
  }
  console.error(`
Quote the scalar so the text after \` #\` stays part of the value:

    - name: '${violations[0].name}'

This is the only fix -- do not rewrite the name to remove the \`#\`, that changes
what the step is actually called.`);
  process.exit(1);
}

function list() {
  const result = scan(repoRoot());
  if (result.problems.length > 0) {
    reportProblems(result.problems);
    process.exit(1);
  }
  const rows = [
    ...result.violations.map((e) => ({ ...e, verdict: 'VIOLATION' })),
    ...result.quoted.map((e) => ({ ...e, verdict: 'quoted' })),
    ...result.unquotedSafe.map((e) => ({ ...e, verdict: 'ok' })),
  ].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  for (const r of rows) console.log(`${r.verdict.padEnd(9)} ${r.file}:${r.line}  - name: ${r.name}`);
  console.log(`\n${summarise(result)}`);
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// Fixture workflows in a temp dir, run through the SAME scan() main() calls --
// the check-nul-bytes.mjs / check-workflow-status-functions.mjs convention.

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 -- a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-workflow-step-name-quoting self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be a self-test's ONLY success condition
// throughout this repo, so "every case held" and "the cases never ran" printed
// the same line. Closed the way PR #13487 validated on check-doc-authoring:
// what is pinned is the registered NAMES, not a number. Every section opens
// with `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
const SELF_TEST_BATTERIES = Object.freeze({
  // #15149's own shape: the mandatory floor-raising case (#13799).
  '1. Flags this card\'s shape': 3,
  // Mandatory: an already-quoted `'... #123 ...'` stays green.
  '2. An already-quoted scalar carrying #123 stays green': 4,
  // Mandatory negative control: check-links.yml's real, legal, unquoted name
  // with an embedded `"`.
  '3. An unquoted name with an embedded double-quote stays green (negative control)': 3,
  // Mandatory: a normal trailing YAML comment elsewhere in the file (NOT on a
  // `- name:` line) must not be flagged -- this is the boundary the "line
  // contains ` #`" shape would have gotten wrong.
  '4. A normal trailing YAML comment on a non-name line stays green': 3,
  '5. Missing input must go red, in both shapes (#4690)': 2,
  '6. The real repository is what this gate actually guards': 3,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 6;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

function selfTest() {
  const seen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
  };
  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => {
    registerCase();
    checked++;
    if (!cond) failures.push(msg);
  };

  const roots = [];
  const makeRoot = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'check-workflow-step-name-quoting-'));
    roots.push(dir);
    for (const [rel, contents] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    return dir;
  };

  try {
    // ── 1. Flags this card's shape ────────────────────────────────────────
    battery("1. Flags this card's shape");
    const cardShape = makeRoot({
      '.github/workflows/lint.yml': `name: Lint
on: [push]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - name: The #13419 name-fold fixture has no non-test loader
        run: node scripts/check-position-name-fold-loaders.mjs
`,
    });
    const cardResult = scan(cardShape);
    assert(cardResult.problems.length === 0, `the fixture is well-formed, got ${cardResult.problems[0]}`);
    assert(cardResult.violations.length === 1, `the card's exact shape is flagged once, got ${cardResult.violations.length}`);
    assert(
      cardResult.violations[0]?.name === 'The #13419 name-fold fixture has no non-test loader',
      `the reported value is the full unquoted text, got ${cardResult.violations[0]?.name}`,
    );

    // ── 2. An already-quoted scalar carrying #123 stays green ─────────────
    battery('2. An already-quoted scalar carrying #123 stays green');
    const fixedShape = makeRoot({
      '.github/workflows/lint.yml': `name: Lint
on: [push]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - name: 'The #13419 name-fold fixture has no non-test loader'
        run: node scripts/check-position-name-fold-loaders.mjs
      - name: "Another #456 step, double-quoted"
        run: echo hi
`,
    });
    const fixedResult = scan(fixedShape);
    assert(fixedResult.violations.length === 0, `both quoting styles stay green, got ${fixedResult.violations.length} violation(s)`);
    assert(fixedResult.quoted.length === 2, `both step names are counted as quoted, got ${fixedResult.quoted.length}`);
    assert(fixedResult.stepNames === 2, `exactly two step names were seen, got ${fixedResult.stepNames}`);
    assert(fixedResult.problems.length === 0, `the fixed fixture is well-formed, got ${fixedResult.problems[0]}`);

    // ── 3. An unquoted name with an embedded double-quote stays green ─────
    //
    // The real check-links.yml specimen (#15149, R+152's own self-inflicted
    // false positive: stripping `'"` before judging misreads this as
    // "starts with a letter after a stripped quote" and flags it wrongly).
    battery('3. An unquoted name with an embedded double-quote stays green (negative control)');
    const negativeControl = makeRoot({
      '.github/workflows/check-links.yml': `name: Check Documentation Links
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Report a setup failure as "the link check did not run"
        run: echo failed
`,
    });
    const negativeResult = scan(negativeControl);
    assert(negativeResult.violations.length === 0, `the embedded-quote name stays green, got ${negativeResult.violations.length} violation(s)`);
    assert(negativeResult.unquotedSafe.length === 1, 'the embedded-quote name is counted as unquoted-and-safe');
    assert(
      negativeResult.unquotedSafe[0]?.name === 'Report a setup failure as "the link check did not run"',
      `the full unquoted value is preserved, got ${negativeResult.unquotedSafe[0]?.name}`,
    );

    // ── 4. A normal trailing YAML comment on a non-name line stays green ──
    //
    // Pins the boundary the naive "line contains ` #`" shape gets wrong: this
    // gate only ever looks at `- name:` lines, so an ordinary comment on
    // `runs-on:`, on its own line, or trailing a `run:` body must not surface
    // as a violation at all -- there is no population for it to belong to.
    battery('4. A normal trailing YAML comment on a non-name line stays green');
    const trailingComment = makeRoot({
      '.github/workflows/ci.yml': `name: CI
on: [push]  # trigger on every push
jobs:
  build:
    # a perfectly ordinary standalone comment
    runs-on: ubuntu-latest  # pinned image
    steps:
      - name: Build the project
        run: pnpm build  # #not a step name, just a shell comment
`,
    });
    const trailingResult = scan(trailingComment);
    assert(trailingResult.violations.length === 0, `ordinary comments elsewhere in the file are not flagged, got ${trailingResult.violations.length}`);
    assert(trailingResult.stepNames === 1, `only the one - name: line is counted as a step name, got ${trailingResult.stepNames}`);
    assert(trailingResult.unquotedSafe[0]?.name === 'Build the project', 'the step name itself carries no # and stays green');

    // ── 5. Missing input must go red, in both shapes (#4690) ──────────────
    battery('5. Missing input must go red, in both shapes (#4690)');
    const noDir = makeRoot({ 'README.md': '# no workflows here\n' });
    const missing = scan(noDir);
    assert(missing.problems.length === 1, `a missing ${WORKFLOW_DIR}/ is an input problem, got ${missing.problems.length}`);

    const emptyDir = makeRoot({ '.github/workflows/.gitkeep': '' });
    const empty = scan(emptyDir);
    assert(empty.problems.length === 1, `an empty ${WORKFLOW_DIR}/ is an input problem, got ${empty.problems.length}`);

    // ── 6. The real repository is what this gate actually guards ──────────
    battery('6. The real repository is what this gate actually guards');
    const real = scan(repoRoot());
    assert(real.problems.length === 0, `the repo's own workflows are readable, got ${real.problems[0]}`);
    assert(real.stepNames > 0, 'the repo scan actually reads step names');
    assert(
      real.violations.length === 0,
      `the repo is expected to be clean at self-test time -- got ${real.violations.length}: ${JSON.stringify(real.violations)}`,
    );
  } finally {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ───
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    failures.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of seen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    failures.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    failures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    failures.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (an early return, a deleted block, a guard that now ' +
        'skips) and restore it.',
    );
  }

  if (failures.length) {
    console.error(`✗ check-workflow-step-name-quoting --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    return null;
  }
  console.log(`✓ check-workflow-step-name-quoting --self-test: ${checked} assertions across ${declaredBatteries.length} batteries (real scan() path, temp fixture roots).`);
  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const verdict = selfTest();
    if (verdict !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-workflow-step-name-quoting self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test\n' +
          'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(0);
  } else if (process.argv.includes('--list')) {
    list();
  } else {
    main();
  }
}
