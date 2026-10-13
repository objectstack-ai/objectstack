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
 * Two roots and two files. The internal corpus: every .md file under
 * .claude/skills/pm-dispatch/ (the PM operating protocol, including its
 * references/), plus .claude/agents/os-dev.md (the dev-side twin) and AGENTS.md
 * (the repo-wide agent instruction file, rewritten to the same principles-only
 * standard). The published catalog: every .md file under skills/ — the text
 * `npx skills add` and `@objectstack/skills` ship into customer projects. The
 * ruling above applies there a fortiori: that reader is a customer's agent, with
 * no tool that resolves an issue number into this repository's tracker, so a
 * citation is a lookup it cannot even attempt, in the one text it was handed to
 * act on. The maintainer added it on 2026-10-12 as a widening of THIS gate's
 * scan set, not as a new gate.
 *
 * The pattern is /#[0-9]{3,}/ — real issue/PR numbers in this repo are 3+
 * digits, while placeholders (`#<n>`, `#N`, `epic:#<n>`), Prime-Directive
 * cross-references (`#14`) and small literals (`#12 #34` in the
 * argument-syntax example) stay legal.
 *
 * ## The hex-colour boundary — published root only
 *
 * The pattern cannot tell a citation from a CSS hex colour whose first three
 * characters are digits, and the published catalog teaches colours. On the tree
 * that widened the scan set it carried two, and no citation at all:
 * `color: '#3498db'` (a select option, skills/objectstack-data) and
 * `primaryColor: '#4169E1'` (branding, skills/objectstack-ui). The bare pattern
 * would have landed the widening red on both.
 *
 * So under skills/ ONLY, a match whose digit run continues straight into a
 * letter or an underscore is not counted (`NOT_A_CITATION_TAIL`): the digits
 * are the head of a longer word and name no number. A citation keeps a
 * non-word neighbour (`#1234.`, `(#1234)`, `#1234,`, end of line) and stays
 * red. The internal corpus keeps the bare pattern — it teaches no colours, and
 * its semantics are not this widening's to change.
 *
 * ⚠️ The boundary that remains, named rather than excluded: a colour whose hex
 * digits are ALL decimal (`#000000`, `#333`) is byte-for-byte a citation and
 * stays red. The first real one in a published skill is the moment to decide
 * how to treat that shape, with the hit in hand. The self-test pins it red.
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
 * Missing file, unreadable root or empty read is RED, never a pass — a gate
 * that cannot find its input must fail, not skip. Both roots are held to it.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isEntrypoint } from '../invoked-as.mjs';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');

export const SCAN_ROOT = '.claude/skills/pm-dispatch';
// The published catalog (see "What it scans"). Walked with the same walker.
export const PUBLISHED_SCAN_ROOT = 'skills';
export const EXTRA_FILES = ['.claude/agents/os-dev.md', 'AGENTS.md'];
export const ID_PATTERN = /#[0-9]{3,}/g;
// Under PUBLISHED_SCAN_ROOT only: the character right after a match that makes
// it the head of a longer word (a hex colour), not a citation. See the header.
export const NOT_A_CITATION_TAIL = /^[A-Za-z_]$/;

/**
 * The published root, declared for `scripts/pm/dispatch-gates.mjs`.
 *
 * That tool derives a card's gate list from the path literals in each gate's
 * own source, and refuses a literal with no separator as too generic to match
 * with — so `PUBLISHED_SCAN_ROOT` above, a bare top-level word, reaches no card
 * at all. A declared subtree is the form that does, and this one names exactly
 * the population `run` reads: .md files under skills/, at any depth (the
 * catalog's README.md at its top included), and not the catalog's .json.
 *
 * ⚠️ Provenance, NOT a lookup key: nothing reads this array to walk; the glob
 * form handed to the walker would name a directory that does not exist. The
 * literal is written out because a computed one is invisible to the text scan
 * it exists for. The self-test pins both halves.
 */
export const ROOT_DIR_WATCH_HINTS = ['skills/**/*.md'];

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

// The citations in `text`, a file (or one line of a file) at repo path `rel`.
// The hex-colour boundary applies under the published root and nowhere else.
export function citationCount(text, rel) {
  const published = rel.startsWith(`${PUBLISHED_SCAN_ROOT}/`);
  let count = 0;
  for (const m of text.matchAll(ID_PATTERN)) {
    if (published && NOT_A_CITATION_TAIL.test(text.charAt(m.index + m[0].length))) continue;
    count++;
  }
  return count;
}

// The scan over any tree laid out like this repository: `run` hands it the
// repo root, the self-test a fixture tree — so the self-test drives the walk of
// each root, not only the per-file verdict.
export function lintTree(root) {
  const failures = []; // { msg, lines } — `lines` names the offending lines
  const scanned = [];
  const targets = [];
  for (const dir of [SCAN_ROOT, PUBLISHED_SCAN_ROOT]) {
    try {
      targets.push(...mdFilesUnder(join(root, dir)));
    } catch {
      failures.push({ msg: `cannot read ${dir} — red, not a skip.`, lines: [] });
    }
  }
  for (const extra of EXTRA_FILES) targets.push(join(root, extra));

  for (const abs of targets) {
    const rel = relative(root, abs).replace(/\\/g, '/');
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      failures.push({ msg: `cannot read ${rel} — red, not a skip.`, lines: [] });
      continue;
    }
    if (text.length === 0) {
      failures.push({ msg: `${rel} read as empty — red, not a skip.`, lines: [] });
      continue;
    }
    scanned.push(rel);
    const v = verdictFor(rel, citationCount(text, rel));
    if (!v.ok) {
      // name the first few offending lines so the fix needs no second scan
      const lines = [];
      const all = text.split('\n');
      for (let i = 0; i < all.length && lines.length < 5; i++) {
        if (citationCount(all[i], rel) > 0) lines.push(`${rel}:${i + 1}: ${all[i].trim().slice(0, 120)}`);
      }
      failures.push({ msg: v.msg, lines });
    }
  }
  return { failures, scanned };
}

function run() {
  const { failures, scanned } = lintTree(REPO_ROOT);
  for (const f of failures) {
    console.error(`✗ check-skill-id-lint: ${f.msg}`);
    for (const line of f.lines) console.error(`    ${line}`);
  }
  if (failures.length) process.exit(1);
  console.log(`✓ check-skill-id-lint: ${scanned.length} file(s) clean (pattern ${ID_PATTERN}).`);
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
  'published root: a .md carrying #1234 -> red': 1,
  'published root: a .md carrying none -> green, and walked': 1,
  'published root: a colour whose digits run into a letter -> green': 1,
  'published root: an all-decimal colour stays red (the named boundary)': 1,
  'internal corpus keeps the bare pattern: the same colour -> red': 1,
  'published root missing -> red, not a skip': 1,
  'the published root declares a root-dir watch hint': 1,
  'and that declaration names no root this gate does not walk': 1,
  'the declared form is NOT the walk root itself': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a label collapse to ONE key in
// the literal above, so the roster falls below this number; the table
// cross-check in the floor block is the other half, and names WHICH label
// collided.
const SELF_TEST_BATTERY_FLOOR = 23;

function selfTest() {
  // The walk over each root, driven through `lintTree` on throwaway trees: a
  // verdict on a bare count cannot show that skills/ is walked at all.
  const lintFixture = (files) => {
    const root = mkdtempSync(join(tmpdir(), 'skill-id-lint-'));
    try {
      for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), text);
      }
      return lintTree(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const internal = {
    '.claude/skills/pm-dispatch/SKILL.md': 'the protocol\n',
    '.claude/agents/os-dev.md': 'the dev twin\n',
    'AGENTS.md': 'the repo rules\n',
  };
  const redFor = (result, rel) => result.failures.some((f) => f.msg.startsWith(`${rel}:`));
  const cited = lintFixture({ ...internal, 'skills/demo/SKILL.md': 'clean\n', 'skills/demo/rules/x.md': 'fixed in #1234.\n' });
  const clean = lintFixture({ ...internal, 'skills/demo/rules/x.md': 'the lesson, self-contained\n' });
  const colour = lintFixture({ ...internal, 'skills/demo/SKILL.md': "color: '#3498db', primaryColor: '#4169E1'\n" });
  const decimal = lintFixture({ ...internal, 'skills/demo/SKILL.md': "color: '#000000'\n" });
  const internalColour = lintFixture({
    ...internal,
    '.claude/skills/pm-dispatch/SKILL.md': "color: '#3498db'\n",
    'skills/demo/SKILL.md': 'clean\n',
  });
  const missing = lintFixture(internal);

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
    // The published root, walked for real. The red row names the file, so a
    // red raised by some other fixture file cannot stand in for it.
    ['published root: a .md carrying #1234 -> red', redFor(cited, 'skills/demo/rules/x.md') && cited.failures.length === 1, true],
    ['published root: a .md carrying none -> green, and walked', clean.failures.length === 0 && clean.scanned.includes('skills/demo/rules/x.md') && clean.scanned.length === 4, true],
    ['published root: a colour whose digits run into a letter -> green', colour.failures.length === 0 && colour.scanned.includes('skills/demo/SKILL.md'), true],
    ['published root: an all-decimal colour stays red (the named boundary)', redFor(decimal, 'skills/demo/SKILL.md'), true],
    ['internal corpus keeps the bare pattern: the same colour -> red', redFor(internalColour, '.claude/skills/pm-dispatch/SKILL.md') && internalColour.failures.length === 1, true],
    ['published root missing -> red, not a skip', missing.failures.some((f) => f.msg === `cannot read ${PUBLISHED_SCAN_ROOT} — red, not a skip.`), true],
    // The dispatch-gates declaration for the published root. Read by another
    // tool entirely, so a wrong one runs green here and shows up only as a
    // skills/ card dispatched with this gate absent from the brief.
    ['the published root declares a root-dir watch hint', ROOT_DIR_WATCH_HINTS.includes(`${PUBLISHED_SCAN_ROOT}/**/*.md`), true],
    ['and that declaration names no root this gate does not walk', ROOT_DIR_WATCH_HINTS.every((h) => h.startsWith(`${PUBLISHED_SCAN_ROOT}/`)), true],
    ['the declared form is NOT the walk root itself', ROOT_DIR_WATCH_HINTS.includes(PUBLISHED_SCAN_ROOT), false],
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
