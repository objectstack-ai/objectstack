#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * typecheck-configs -- the ONE answer to "which tsconfig files does this
 * package's `typecheck` script put in front of tsc?"
 *
 *   node scripts/typecheck-configs.mjs --self-test
 *
 * ## Why this is a shared module and not a copy in each gate
 *
 * Two gates need this predicate and they need the SAME one:
 *
 *   * `check-type-check-coverage.mjs` asks it to decide which programs
 *     ACCOUNT for a package's files -- a config no script invokes reads as
 *     coverage and delivers none (#5286).
 *   * `check-type-source-resolution.mjs` asks it to decide which programs are
 *     in its POPULATION at all. That gate read each package's `tsconfig.json`
 *     and only that one, so the sibling `tsconfig.test.json` this repo
 *     PRESCRIBES as the supported repair for a hidden test layer was a whole
 *     tsc program outside its declared population (#11490). Measured on
 *     `packages/triggers/trigger-record-change`: the same 7 test files with the
 *     same four dist-resolved type imports were REPORTED when put through the
 *     build config and SILENT through the prescribed sibling -- so following
 *     the house pattern was what made the exposure invisible.
 *
 * A second copy of the regex is how those two answers drift apart, and the
 * symptom of drift is a green gate on either side. One rule, one home, one set
 * of cases -- the shape `workspace-enumerator.mjs` and `invoked-as.mjs` use.
 *
 * ## What the answer IS, and the one property a consumer must handle
 *
 * A SET OF BASENAMES (`tsconfig.json`, `tsconfig.test.json`), never paths. The
 * match is `tsconfig[\w.-]*\.json`, whose character class excludes `/`, so a
 * reference written with a directory (`-p ../shared/tsconfig.test.json`) is
 * credited under its BASENAME as though it named the package's own file.
 *
 * That is a property, not a bug to route around here: both consumers resolve
 * the answer against the package directory, so a name with no file behind it
 * is dropped. It is stated out loud because the residual case is real -- a
 * package that BOTH reaches for a config in another directory AND carries a
 * same-named file of its own would credit the wrong one. Measured on this tree
 * while #11490 was implemented: 0 of the workspace's package.json files
 * reference any tsconfig with a directory prefix, so the case has no instance
 * today. Do not "fix" it by loosening the class to admit `/` without deciding
 * what a config OUTSIDE the package means to each caller -- the two callers do
 * not want the same thing there.
 */

import { isEntrypoint } from './invoked-as.mjs';

/**
 * The `typecheck` script, plus every same-package script it delegates to, as a
 * list of the script bodies in visit order.
 *
 * A LIST rather than a joined blob, because the two readers want different
 * things from it. `configsNamedByTypecheck` only ever asks "does this text
 * mention X" and a blob answers that; `check-type-check-coverage.mjs`'s
 * GENERATED_COVERED also asks "does X run BEFORE tsc", and that is only
 * decidable INSIDE one script body, where text order is shell order. Across
 * bodies the concatenation order is visit order, which has nothing to do with
 * execution order -- `typecheck: 'pnpm gen && tsc'` + `gen: 'next typegen'`
 * joins to `... tsc ... next typegen` while running the generator first, so a
 * blob would red a correct config. Keeping the bodies apart is what lets that
 * case ABSTAIN instead (#10880).
 *
 * @param {Record<string, unknown>} scripts  A package.json `scripts` object.
 * @returns {string[]}
 */
export function typecheckScriptChain(scripts) {
  const visited = new Set();
  const chain = [];
  const visit = (name, depth) => {
    if (depth > 4 || visited.has(name) || typeof scripts[name] !== 'string') return;
    visited.add(name);
    chain.push(scripts[name]);
    for (const m of scripts[name].matchAll(/\b(?:pnpm(?:\s+run)?|npm\s+run|yarn(?:\s+run)?)\s+([\w:.-]+)/g)) {
      visit(m[1], depth + 1);
    }
  };
  visit('typecheck', 0);
  return chain;
}

/**
 * Which tsconfig files does the `typecheck` script actually put in front of
 * tsc? Expanded through same-package `pnpm <script>` / `npm run <script>`
 * indirection, because a package that splits the work across two scripts is
 * still running both. A bare `tsc` reads `tsconfig.json`, so any mention of tsc
 * credits the default config; every other config must be NAMED (`-p
 * tsconfig.test.json`), which is what keeps a decorative sibling config from
 * reading as coverage (#5286).
 *
 * @param {Record<string, unknown>} scripts  A package.json `scripts` object.
 * @returns {Set<string>}  Config BASENAMES -- see this module's header.
 */
export function configsNamedByTypecheck(scripts) {
  const text = typecheckScriptChain(scripts).map((s) => ` ${s}`).join('');
  const named = new Set();
  for (const m of text.matchAll(/tsconfig[\w.-]*\.json/g)) named.add(m[0]);
  if (/\btsc\b/.test(text)) named.add('tsconfig.json');
  return named;
}

// ---------------------------------------------------------------------------
// Self-test -- the cases live with the rule, and both gates fold them in
// ---------------------------------------------------------------------------

const NAMED_CASES = [
  { label: 'a bare tsc credits the default config only', scripts: { typecheck: 'tsc --noEmit' }, expect: ['tsconfig.json'] },
  {
    label: 'an explicitly named sibling config counts',
    scripts: { typecheck: 'tsc --noEmit && tsc --noEmit -p tsconfig.test.json' },
    expect: ['tsconfig.json', 'tsconfig.test.json'],
  },
  {
    label: 'one level of `pnpm <script>` indirection is followed',
    scripts: { typecheck: 'tsc --noEmit && pnpm check:tests', 'check:tests': 'tsx x.mts --project tsconfig.test.json' },
    expect: ['tsconfig.json', 'tsconfig.test.json'],
  },
  {
    label: 'a config no script names is not coverage, however present the file is',
    scripts: { typecheck: 'tsc --noEmit', 'some:other': 'tsc -p tsconfig.test.json' },
    expect: ['tsconfig.json'],
  },
  { label: 'no typecheck script names nothing', scripts: {}, expect: [] },
  // #11490. The two ways a package can put its tests in front of tsc must come
  // back as DIFFERENT program sets, or the population widening that card asked
  // for has nothing to widen: the prescribed sibling route names a SECOND
  // config, dropping the build config's exclusion names one.
  {
    label: 'the prescribed sibling route names TWO programs',
    scripts: { typecheck: 'tsc --noEmit && tsc --noEmit -p tsconfig.test.json' },
    expect: ['tsconfig.json', 'tsconfig.test.json'],
  },
  // A directory-prefixed reference is credited under its BASENAME -- the
  // property this module's header states. Pinned rather than left to a reading,
  // because a consumer that stopped resolving names against the package
  // directory would silently start crediting another package's file.
  {
    label: 'a directory-prefixed reference comes back as a BASENAME',
    scripts: { typecheck: 'tsc --noEmit -p ../shared/tsconfig.test.json' },
    expect: ['tsconfig.json', 'tsconfig.test.json'],
  },
];

const CHAIN_CASES = [
  { label: 'no typecheck script is an empty chain', scripts: {}, expect: 0 },
  { label: 'a lone typecheck script is one body', scripts: { typecheck: 'tsc' }, expect: 1 },
  {
    label: 'delegation adds the delegate body',
    scripts: { typecheck: 'tsc && pnpm check:tests', 'check:tests': 'tsc -p tsconfig.test.json' },
    expect: 2,
  },
  { label: 'a cycle terminates instead of recursing', scripts: { typecheck: 'pnpm a', a: 'pnpm typecheck' }, expect: 2 },
];

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition,
// so "every case held" and "the cases never ran" printed the same line — and
// the `SELF_TEST_CASE_COUNT` the verdict prints is DERIVED from the two tables,
// so a deleted row shrinks the printed number with it and the gate stays green.
// Closed the way PR #13487 validated on check-doc-authoring: what is pinned is
// the registered NAMES, not a number.
//
// This self-test is TABLE-DRIVEN — two literal tables, one driving loop each,
// and a failure-only sink. Routing THAT sink through `registerCase()` would
// register a case only when it fails: a fully green run would register 0 and
// every battery would read DID NOT RUN, the floor inverted rather than
// installed. So the roster is the tables' own rows. Each row's `label` is a
// declared battery, verbatim, with a floor of 1, and `registerCase(label)` is
// the FIRST statement of each driving loop body — so the case is attributed to
// the row actually being run, whatever that row asserts afterwards. There is no
// `battery()` opener: for a table-driven self-test the ROW is the battery, so
// attribution is the loop variable rather than a most-recently-opened section.
//
// ONE roster spans BOTH tables. The two loops are two halves of one battery of
// cases, and a row that moved between the tables would otherwise leave and
// re-enter a roster without either half noticing.
//
// ⛔ A pinned TOTAL is not the repair, and neither is a roster DERIVED from the
// tables — that is exactly what `SELF_TEST_CASE_COUNT` already is. The roster
// below is a LITERAL the tables are checked against, which is what lets a
// deleted or renamed row name ITSELF in the refusal.
//
// The counts are a FLOOR, not an equality — a row that grows into several
// registrations must not red. 1 is the honest floor for a table row: the loop
// reaches it exactly once per run.
//
// ── Why the LEDGER is module-level and the CHECK sits at the verdict site ──
//
// `selfTest()` REGISTERS and returns its failures; the dispatch block below
// DECIDES — it prints the red line or the green one. There is no verdict site
// inside the registering body, so the floor is evaluated where the green line
// already is. The ledger it reads therefore has to outlive `selfTest()`'s frame
// — hence module scope rather than the local map the single-body recipe closes
// over. Only the CHECK's location moves; attribution and scope are untouched.
// This is the class-3 placement PR #15309 settled.
//
// ⚠️ This module is a LIBRARY: `check-type-check-coverage.mjs` folds this
// `selfTest()` into its own, and `check-type-source-resolution.mjs` imports the
// predicates. Those importers call `selfTest()`, which registers into the
// ledger below — harmlessly, because the FLOOR is evaluated only in this file's
// own `--self-test` dispatch, which an importer never reaches. Scoping the check
// to the dispatch is what keeps a fold-in from inheriting a refusal it cannot
// act on.
//
// ⛔ The floor is NOT placed at the end of `selfTest()` before its `return`: an
// early return anywhere above that line would skip the check entirely — the
// exact defect the #13798 verdict handshake exists to catch — coupling hole 1
// to hole 2 after the card ruled them orthogonal. It would also fire inside
// every importer's run. Evaluated at the verdict site, the same early return
// lands as a count BELOW the floor and reds, here and nowhere else.
const SELF_TEST_BATTERIES = Object.freeze({
  'a bare tsc credits the default config only': 1,
  'an explicitly named sibling config counts': 1,
  'one level of `pnpm <script>` indirection is followed': 1,
  'a config no script names is not coverage, however present the file is': 1,
  'no typecheck script names nothing': 1,
  'the prescribed sibling route names TWO programs': 1,
  'a directory-prefixed reference comes back as a BASENAME': 1,
  'no typecheck script is an empty chain': 1,
  'a lone typecheck script is one body': 1,
  'delegation adds the delegate body': 1,
  'a cycle terminates instead of recursing': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a label collapse to ONE key in
// the literal above, so the roster falls below this number; the table
// cross-check in `batteryFloorFailures()` is the other half, and names WHICH
// label collided.
const SELF_TEST_BATTERY_FLOOR = 11;

// The ledger `batteryFloorFailures()` reads from the OTHER body.
//
// ⚠️ Named for the roster's role, deliberately NOT with a self-test spelling:
// `check:pm-dispatch-gates` anchors on a top-level declaration whose NAME spells
// self-test and every such name owes a row in its COMPOUND_ANCHOR_LEDGER. This
// machinery holds no fixtures to mask and reads no path literal, so the accurate
// name is the one that says `battery`.
const batterySeen = new Map();

/** Called by each driving loop in `selfTest()`, once per row, before the row runs. */
function registerCase(label) {
  batterySeen.set(label, (batterySeen.get(label) ?? 0) + 1);
}

/**
 * The floor: every declared row RAN, and ran its case (#13489).
 *
 * Guards the registrations made by **`selfTest()`** — the body whose two
 * driving loops call `registerCase()`. It is called from the `--self-test`
 * dispatch block immediately before the success line, so that line can only be
 * printed by a run in which the set of rows that registered EQUALS the set
 * declared, each at or above its own count. A set difference says WHICH row
 * stopped; a count says only that something did.
 *
 * @returns {string[]} floor breaches; empty means the floor held
 */
function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  const rowLabels = [...NAMED_CASES, ...CHAIN_CASES].map((c) => c.label);
  const duplicated = [...new Set(rowLabels.filter((label, i) => rowLabels.indexOf(label) !== i))];
  if (duplicated.length > 0) {
    problems.push(
      `the cases tables use ${duplicated.map((n) => JSON.stringify(n)).join(', ')} as a row label more than once — `
        + 'two rows sharing a label are ONE battery, so the second can stop running while the first keeps the floor met.',
    );
  }
  for (const [label, count] of batterySeen) {
    if (declared.includes(label)) continue;
    problems.push(
      `self-test battery "${label}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const label of declared) {
    const count = batterySeen.get(label) ?? 0;
    if (count >= SELF_TEST_BATTERIES[label]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${label}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[label]} pinned. `
          + 'The verdict below would have claimed that case holds.'
        : `self-test battery "${label}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[label]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (a deleted row, a renamed label, a loop that no longer '
        + 'reaches it) and restore it.',
    );
  }
  return problems;
}

/** How many cases `selfTest` holds -- for a folding gate's printed tally. */
export const SELF_TEST_CASE_COUNT = NAMED_CASES.length + CHAIN_CASES.length;

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

/**
 * @returns {string[]}  One string per failed case; empty means pass.
 */
export function selfTest() {
  const failures = [];

  for (const c of NAMED_CASES) {
    registerCase(c.label);
    const got = [...configsNamedByTypecheck(c.scripts)].sort();
    if (JSON.stringify(got) !== JSON.stringify([...c.expect].sort())) {
      failures.push(
        `configsNamedByTypecheck -- ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`,
      );
    }
  }

  for (const c of CHAIN_CASES) {
    registerCase(c.label);
    const got = typecheckScriptChain(c.scripts).length;
    if (got !== c.expect) {
      failures.push(`typecheckScriptChain -- ${c.label}: expected ${c.expect} body/bodies, got ${got}`);
    }
  }

  selfTestReachedVerdict = true;
  return failures;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const failures = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ typecheck-configs self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    for (const failure of failures) console.error(`  - ${failure}`);
    if (failures.length > 0) {
      console.error(`typecheck-configs --self-test FAILED: ${failures.length} of ${SELF_TEST_CASE_COUNT} case(s)`);
      process.exit(1);
    }
    // ── The assertion floor, at the verdict site (#13489) ─────────────────
    // `selfTest()` registers but does not decide, so the floor over ITS
    // registrations is evaluated here, after both loops have had their chance
    // and immediately before the success line — the only place a run that
    // registered nothing can still be stopped from reporting that every case
    // held. It sits in the DISPATCH, not in `selfTest()`, so the importers that
    // fold this self-test in never reach it.
    const floorProblems = batteryFloorFailures();
    if (floorProblems.length > 0) {
      console.error(
        `typecheck-configs --self-test FAILED: the assertion floor over selfTest()'s registrations `
          + `was breached (${floorProblems.length} problem(s)); every case that DID run passed.`,
      );
      for (const problem of floorProblems) console.error(`  - ${problem}`);
      process.exit(1);
    }
    console.log(`typecheck-configs --self-test OK -- ${SELF_TEST_CASE_COUNT} cases hold.`);
  } else {
    console.log('usage: node scripts/typecheck-configs.mjs --self-test');
  }
}
