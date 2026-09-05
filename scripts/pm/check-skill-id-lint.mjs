#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * pm-skill issue-ID lint — operative agent-protocol text must not cite issue
 * numbers.
 *
 *   node scripts/pm/check-skill-id-lint.mjs               # the gate
 *   node scripts/pm/check-skill-id-lint.mjs --self-test   # verify the checker
 *
 * ## Why
 *
 * Maintainer ruling, 2026-08-12 (verbatim, untranslated): 「立一张结构卡,我觉的
 * 处理 issue 时犯的错应该总结成经验,保留 issue id没有意义,如果ai去查原始issue,
 * 得不偿失。」 Incident learnings are distilled into the rules themselves as
 * self-contained lessons (failure mode + discipline + boundary); an issue-ID
 * citation invites the reader to dereference history, which costs more than it
 * returns. The scanned corpus carries rules only — no ruling dates, no quotations, no
 * issue numbers; a rule's provenance lives in the PR that landed it.
 *
 * ## What it scans
 *
 * Every .md file under .claude/skills/pm-dispatch/ (the PM operating protocol,
 * including its references/), plus .claude/agents/os-dev.md (the dev-side twin)
 * and AGENTS.md (the repo-wide agent instruction file, rewritten to the same
 * principles-only standard). The pattern is /#[0-9]{3,}/ — real issue/PR numbers
 * in this repo are 3+ digits, while placeholders (`#<n>`, `#N`, `epic:#<n>`),
 * Prime-Directive cross-references (`#14`) and small literals (`#12 #34` in the
 * argument-syntax example) stay legal.
 *
 * ## The legacy-waiver mechanism (LEGACY_EXACT), currently unused
 *
 * A file rewritten to this standard in a DIFFERENT PR than the one that adds it
 * to the scan set needs merge-order independence: an EXACT legacy count lets the
 * file pass only at its recorded pre-rewrite value (untouched legacy) or at 0
 * (rewritten) — any other count is red, so nobody can add an ID and a partial
 * cleanup must finish the job. os-dev.md used this for its own rewrite; its
 * entry became dead weight once that landed (worse: it would have re-admitted
 * exactly 81 IDs) and was deleted. AGENTS.md needs no entry — its rewrite and
 * its scan-set addition travel in the same PR. The mechanism stays for the next
 * split rewrite; the self-test exercises it with a synthetic entry.
 *
 * Missing file or empty read is RED, never a pass — a gate that cannot find its
 * input must fail, not skip.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isEntrypoint } from '../invoked-as.mjs';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');

export const SCAN_ROOT = '.claude/skills/pm-dispatch';
export const EXTRA_FILES = ['.claude/agents/os-dev.md', 'AGENTS.md'];
export const ID_PATTERN = /#[0-9]{3,}/g;

/**
 * The repo-ROOT files above, declared for `scripts/pm/dispatch-gates.mjs`
 * (#9979, applying #9964's pattern).
 *
 * That tool derives a card's gate list from the path literals in each gate's
 * own source, and "looks like a path" there means "carries a separator". Both
 * of the constants above satisfy that except `AGENTS.md` — a repo-root FILE has
 * no separator to be found by — so this gate contributed hints for its skill
 * tree and its os-dev.md twin, and an AGENTS.md card derived it not at all.
 * `<file>/**` is the form that reaches one: the extractor accepts it, and
 * `collapseHint` reduces it back to `AGENTS.md` and to nothing else. Nothing in
 * the tree lives under `AGENTS.md/`, so it claims no directory and no
 * same-named file inside one (`examples/AGENTS.md` stays out).
 *
 * ⚠️ Provenance, NOT a lookup key. `run` opens every path in `EXTRA_FILES`;
 * the glob spelling appearing there would send this gate looking for a file
 * that does not exist — red under the cannot-read rule, for a file that is
 * fine. The self-test pins both halves.
 */
export const ROOT_FILE_WATCH_HINTS = ['AGENTS.md/**'];

// Exact-count legacy waiver (see header): pass iff count === legacy || count === 0.
export const LEGACY_EXACT = new Map([]);

function mdFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...mdFilesUnder(p));
    else if (entry.endsWith('.md')) out.push(p);
  }
  return out;
}

export function verdictFor(rel, matchCount) {
  const legacy = LEGACY_EXACT.get(rel);
  if (legacy !== undefined) {
    if (matchCount === 0 || matchCount === legacy) return { ok: true };
    return {
      ok: false,
      msg:
        `${rel}: ${matchCount} issue-ID citation(s); the legacy waiver allows exactly ${legacy} ` +
        '(the untouched pre-rewrite file) or 0 (the principles-only rewrite). Do not add IDs; ' +
        'a partial cleanup must go to zero.',
    };
  }
  if (matchCount > 0) {
    return {
      ok: false,
      msg:
        `${rel}: ${matchCount} issue-ID citation(s) — operative text carries lessons ` +
        'self-contained (failure mode + discipline + boundary); rulings keep date + verbatim ' +
        'quote, numbers go (maintainer ruling 2026-08-12).',
    };
  }
  return { ok: true };
}

function run() {
  const targets = [];
  try {
    targets.push(...mdFilesUnder(join(REPO_ROOT, SCAN_ROOT)));
  } catch {
    console.error(`✗ check-skill-id-lint: cannot read ${SCAN_ROOT} — red, not a skip.`);
    process.exit(1);
  }
  for (const extra of EXTRA_FILES) targets.push(join(REPO_ROOT, extra));

  let failed = 0;
  let scanned = 0;
  for (const abs of targets) {
    const rel = relative(REPO_ROOT, abs).replace(/\\/g, '/');
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      console.error(`✗ check-skill-id-lint: cannot read ${rel} — red, not a skip.`);
      failed++;
      continue;
    }
    if (text.length === 0) {
      console.error(`✗ check-skill-id-lint: ${rel} read as empty — red, not a skip.`);
      failed++;
      continue;
    }
    scanned++;
    const count = (text.match(ID_PATTERN) ?? []).length;
    const v = verdictFor(rel, count);
    if (!v.ok) {
      failed++;
      console.error(`✗ check-skill-id-lint: ${v.msg}`);
      // name the first few offending lines so the fix needs no second scan
      let shown = 0;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && shown < 5; i++) {
        if (ID_PATTERN.test(lines[i])) {
          console.error(`    ${rel}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
          shown++;
        }
        ID_PATTERN.lastIndex = 0;
      }
    }
  }
  if (failed) process.exit(1);
  console.log(`✓ check-skill-id-lint: ${scanned} file(s) clean (pattern ${ID_PATTERN}).`);
}

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-skill-id-lint self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failed === 0` used to be this self-test's ONLY success condition, so "every
// case held" and "the cases never ran" printed the same line. Closed the PR
// #13487 way: what is pinned is the registered NAMES, not a number.
//
// This self-test is TABLE-DRIVEN — one literal `cases` table, one loop over it,
// and a sink (`failed++`) that writes only when a case FAILS. Routing THAT sink
// through `registerCase()` would register a case only when it fails: a fully
// green run would register 0 and every battery would read DID NOT RUN, the
// floor inverted rather than installed. So the roster is the table's own rows.
// Each row LABEL is a declared battery, verbatim, with a floor of 1, and
// `registerCase(name)` is the first statement of the driving loop body — so the
// case is attributed to the row actually being run, whatever that row asserts
// afterwards. There is no `battery()` opener: for a table-driven self-test the
// ROW is the battery, so attribution is the loop variable rather than a
// most-recently-opened section.
//
// ⛔ A pinned TOTAL is not the repair, and neither is a roster DERIVED from the
// table: `cases.length` moves with the table, so a deleted row would delete its
// own floor. The roster below is a LITERAL the table is checked against, which
// is what lets a deleted or renamed row name ITSELF in the refusal.
//
// The counts are a FLOOR, not an equality — a row that grows into several
// registrations must not red. 1 is the honest floor for a table row: the loop
// reaches it exactly once per run.
const SELF_TEST_BATTERIES = Object.freeze({
  'clean file -> green': 1,
  'one ID -> red': 1,
  'un-waived scanned files carry no waiver': 1,
  'legacy file at exact count -> green': 1,
  'legacy file at zero -> green': 1,
  'legacy file grew -> red': 1,
  'legacy file partially cleaned -> red': 1,
  'red message names the standard': 1,
  'placeholders stay legal': 1,
  'real IDs match': 1,
  'every separator-less scanned file declares a root-file watch hint': 1,
  'and the declaration names no file this gate does not scan': 1,
  'AGENTS.md is the root file it declares': 1,
  'the declared form is NOT an EXTRA_FILES entry': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a label collapse to ONE key in
// the literal above, so the roster falls below this number; the table
// cross-check in the floor block is the other half, and names WHICH label
// collided.
const SELF_TEST_BATTERY_FLOOR = 14;

function selfTest() {
  // The waiver mechanism is tested with a synthetic entry so it stays covered
  // while LEGACY_EXACT is empty (see header).
  LEGACY_EXACT.set('synthetic-legacy.md', 81);
  const cases = [
    ['clean file -> green', verdictFor('x.md', 0).ok, true],
    ['one ID -> red', verdictFor('x.md', 1).ok, false],
    ['un-waived scanned files carry no waiver', LEGACY_EXACT.has('.claude/agents/os-dev.md') || LEGACY_EXACT.has('AGENTS.md'), false],
    ['legacy file at exact count -> green', verdictFor('synthetic-legacy.md', 81).ok, true],
    ['legacy file at zero -> green', verdictFor('synthetic-legacy.md', 0).ok, true],
    ['legacy file grew -> red', verdictFor('synthetic-legacy.md', 82).ok, false],
    ['legacy file partially cleaned -> red', verdictFor('synthetic-legacy.md', 40).ok, false],
    ['red message names the standard', verdictFor('x.md', 2).msg.includes('self-contained'), true],
    ['placeholders stay legal', ('#<n> #N epic:#<n> #12 #34'.match(ID_PATTERN) ?? []).length, 0],
    ['real IDs match', ('see #4650 and #12345'.match(ID_PATTERN) ?? []).length, 2],
    // The dispatch-gates declaration (#9979). Enforcement cannot hold any of
    // these: the declaration is read by another tool entirely, so a wrong or
    // missing entry runs perfectly green here and shows up only as a dev
    // dispatched on an AGENTS.md card with this gate absent from the brief.
    ['every separator-less scanned file declares a root-file watch hint', EXTRA_FILES.filter((f) => !f.includes('/')).every((f) => ROOT_FILE_WATCH_HINTS.includes(`${f}/**`)), true],
    ['and the declaration names no file this gate does not scan', ROOT_FILE_WATCH_HINTS.every((h) => EXTRA_FILES.includes(h.replace(/\/\*+$/, ''))), true],
    ['AGENTS.md is the root file it declares', ROOT_FILE_WATCH_HINTS.includes('AGENTS.md/**'), true],
    // Provenance, never a lookup key: `run` opens every EXTRA_FILES entry, so
    // the glob form appearing there would make this gate read a path that does
    // not exist — red on a missing input, for a file that is fine.
    ['the declared form is NOT an EXTRA_FILES entry', EXTRA_FILES.some((f) => ROOT_FILE_WATCH_HINTS.includes(f)), false],
  ];
  // The ledger this self-test's floor is evaluated against (#13489).
  const batterySeen = new Map();
  const registerCase = (name) => {
    batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
  };

  let failed = 0;
  for (const [name, actual, expected] of cases) {
    registerCase(name);
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  LEGACY_EXACT.delete('synthetic-legacy.md');

  // ── The floor: every declared row RAN, and ran its case (#13489) ───────
  //
  // Evaluated after every row has had its chance and BEFORE the verdict, so the
  // success line below can only be printed by a run in which the set of rows
  // that registered EQUALS the set declared. A set difference names WHICH row
  // stopped; a count says only that something did.
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed++;
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  const rowLabels = cases.map(([name]) => name);
  const duplicated = [...new Set(rowLabels.filter((name, i) => rowLabels.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    floorBreached = true;
    floorFailure(
      `the cases table uses ${duplicated.map((n) => JSON.stringify(n)).join(', ')} as a row label more than once — ` +
        'two rows sharing a label are ONE battery, so the second can stop running while the first keeps the floor met.',
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed that case holds.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (a deleted row, a renamed label, a loop that no longer ' +
        'reaches it) and restore it.',
    );
  }

  if (failed) {
    console.error(`✗ check-skill-id-lint self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`✓ check-skill-id-lint self-test: ${cases.length} cases pass.`);

  return SELF_TEST_VERDICT;
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
    console.error(
      '\n✗ check-skill-id-lint self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test\n'
        + 'that never finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
} else run();
