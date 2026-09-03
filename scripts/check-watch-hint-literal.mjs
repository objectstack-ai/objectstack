#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-watch-hint-literal -- every watch-hint POPULATION declaration in this
 * repo, under any of its declaration names, is spelled as a LITERAL array
 * inside the declaration statement itself.
 *
 *   node scripts/check-watch-hint-literal.mjs              # scan the tree
 *   node scripts/check-watch-hint-literal.mjs --list       # every declarer and what it declares
 *   node scripts/check-watch-hint-literal.mjs --self-test  # verify the checker itself
 *
 * ## The mechanism this closes
 *
 * `extractWatchHints` in `scripts/pm/dispatch-gates.mjs` reads SOURCE TEXT. A
 * declaration written as a literal contributes its hints; the same declaration
 * computed from the gate's population constant contributes NOTHING -- the
 * runtime value is identical, every local assertion about that value stays
 * green, and the gate silently drops out of every dispatch brief. Measured
 * against the extractor, one declaration, two spellings:
 *
 *     literal                                   -> ["scripts/**"]
 *     computed from the population constant     -> []
 *
 * A gate that loses its hint is unnameable by the dispatch tool and scores a
 * quiet green for every card in the tree it walks. Rewriting the declaration
 * that way is a natural-looking tidy-up: in most cases the hint is literally
 * the population root plus a subtree glob, so `ROOTS.map((r) => `${r}/**`)`
 * reads like an improvement.
 *
 * ## Which NAMES are in scope, and why the scope is a SET
 *
 * `extractWatchHints` keys on NO constant name at all -- it scans the whole
 * module body for quoted path-shaped literals and collects them. So the silent
 * drop above is a property of the SPELLING, not of the spelling of one
 * particular constant: EVERY declaration name carrying this idiom loses its
 * hints the same way the moment it is computed. This gate was keyed to a single
 * name, which left the sibling names carrying the identical mechanism
 * unguarded -- unexamined reach rather than a decided boundary.
 *
 * The idiom is spelled four ways on this tree, and the name is not noise: it
 * records what KIND of root the population has, which is a claim a reader wants
 * to make from the constant name alone.
 *
 *     ROOT_DIR_WATCH_HINTS     directory subtrees      `scripts/**`
 *     ROOT_FILE_WATCH_HINTS    repo-ROOT files         `AGENTS.md/**`
 *     ROOT_WATCH_HINTS         mixed roots             `.claude/**`, `docs/**`
 *     DECLARED_WATCH_HINTS     a declared population   `pnpm-workspace.yaml/**`
 *
 * That distinction is why this gate learns the names rather than consolidating
 * them to one. Consolidating is a real option and it is NOT refused here on
 * taste: it is a change to ten other gates' declarations, so it belongs to a
 * card that owns those files, not to this one.
 *
 * ## The per-name floor, which is the whole risk of widening
 *
 * An empty population is REFUSED rather than passed, and once the scope is a
 * SET that refusal has to be PER NAME. "Every declaration is a literal" is
 * vacuously true over zero declarations, so a name whose constant was renamed
 * away finds nothing and would otherwise print the healthiest green this gate
 * has -- the very failure the widening exists to prevent, reintroduced BY the
 * widening. A single global floor does not catch it: three healthy names carry
 * the total well clear of zero while the fourth is silently gone.
 *
 * So `missingNames` runs before any verdict, and a rostered name with no
 * declarer anywhere fails the gate and is named in the failure. The remedy is
 * one line here -- either the constant was renamed (restore it, or roster the
 * new name) or the spelling was retired on purpose (drop it from `DECL_NAMES`,
 * which NARROWS this guard and should therefore be a decision rather than a
 * side effect).
 *
 * ## And the other direction: a name the roster has never heard of
 *
 * A floor catches a name that DISAPPEARS. It cannot catch one that APPEARS --
 * and that is not hypothetical: the fourth name above was added by a gate
 * written the same week this reach was measured, arriving outside the roster
 * with nothing red. A hand-maintained roster that rots silently is the same
 * species of defect as the single name it replaced, one level up.
 *
 * So the sweep also DISCOVERS: any declaration whose name ends in the idiom's
 * suffix but is not rostered is refused, by name, with the one-line remedy. The
 * suffix is the discovery key precisely because it is what every spelling of
 * the idiom already shares.
 *
 * ## Why a shared gate rather than a per-file pin
 *
 * The idiom had one own-source pin holding a declaration to a literal spelling
 * (`scripts/check-cli-command-ids.mjs`, statement-scoped since #12759). Every
 * other declaration in the tree had nothing local that would redden. Eleven
 * copies of a per-file pin is eleven chances to write the SEARCH wrong, and the
 * measured way to write it wrong is documented below.
 *
 * ## The scoping detail that is the whole difficulty
 *
 * Searching the WHOLE FILE for the hint is not sufficient, and that is measured
 * twice on this tree:
 *
 *   - a gate may spell its own hint again in a neighbouring RUNTIME assertion,
 *     so a whole-file `includes` finds THAT copy and stays green on the
 *     computed declaration (the defect #12472 was filed for);
 *   - a gate may spell it a third time in a COMMENT, which the same whole-file
 *     search also accepts -- the assembled-needle remedy in
 *     `scripts/check-objectql-double-limit.mjs` was measured green against
 *     exactly that mutation.
 *
 * So the search here is scoped to the declaration STATEMENT, and comments are
 * masked before the statement is located, through the repo's one comment
 * scanner (`scripts/js-comment-mask.mjs`).
 *
 * ## What is asserted, and what is deliberately NOT
 *
 * Asserted: the right-hand side of the declaration is an ARRAY OF QUOTED STRING
 * LITERALS and nothing else. That is stronger than "each declared hint appears
 * quoted inside the statement", and it needs no runtime value, so this gate
 * never imports the files it judges -- a gate that imported 14 modules to read
 * one constant would run their module bodies to do it.
 *
 * NOT asserted: that a declaration is CORRECT -- that it names the roots the
 * gate really walks, and only those. That claim is local to each gate and each
 * one already pins it from its own side, where the walked root is in scope.
 * This gate holds the one property none of them can hold about itself: that the
 * declaration is still READABLE BY A TEXT SCANNER.
 *
 * ALSO NOT asserted: that the roster is the RIGHT set of names -- that they
 * should all exist, or that four is the right number. The gate holds only that
 * each rostered name is still spelled somewhere (the floor) and that no
 * unrostered spelling of the idiom is in use (the discovery scan). Which names
 * SHOULD exist is a judgement about ten other gates' declarations, and this
 * gate deliberately declines to make it.
 *
 * ## A note for whoever adds a fixture here
 *
 * The scan masks comments but NOT string literals, so a fixture in the
 * self-test below that spelled a declaration verbatim would be found as a real
 * declaration site in this very file. Fixtures therefore assemble the constant
 * name from `DECL_NAMES` at run time, and a self-test case pins that this file
 * still holds exactly one site across ALL rostered names. The discovery scan
 * has the same hazard and the same remedy: never write the idiom's suffix
 * directly after a `const` in this file.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { maskComments } from './js-comment-mask.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// This self-test used to decide success by "no failure was recorded" and
// nothing else, so "every case held" and "the cases never ran" printed the same
// line. Closed the way PR #13487 validated on check-doc-authoring: what is
// pinned is the registered NAMES, not a number. Every section opens with
// `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3 keeps
// a total "right" the moment a sibling grows. A set difference says WHICH
// battery stopped; a count says only that something did.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
//
// The machinery lives HERE, at module scope, rather than inside the self-test:
// this self-test's assertion sink is not a block-bodied helper in its body (it
// is a concise arrow, or a module-scope function), so there is no in-body
// helper to thread a per-run ledger through. Module scope is safe because the
// self-test runs once per process, and it is what lets the existing sink route
// through `registerCase()` with no case rewritten and no assertion changed.
const SELF_TEST_BATTERIES = Object.freeze({
  'the computed spellings this gate exists to reject': 10,
  'shapes that are not a literal ARRAY': 3,
  'the literal spellings that must stay accepted': 6,
  'comments and prose are not declarations': 3,
  'EVERY rostered name is judged, not just the first': 10,
  'the per-name floor': 5,
  'discovery of an UNROSTERED spelling of the idiom': 5,
  'the empty population is refused, not passed': 1,
  'the live tree': 14,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 9;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// ⚠️ None of these helpers is named with a self-test spelling, deliberately and
// on the record: `check:pm-dispatch-gates` anchors on a top-level declaration
// whose NAME spells self-test, and every such name owes a row in that gate's
// COMPOUND_ANCHOR_LEDGER. These are the battery ROSTER's machinery -- they hold
// no fixtures to mask and read no path literal -- so the accurate name is the
// one that says `battery`, not the one that would owe a ledger row for a role
// this code does not have.

/** Cases registered per battery: `battery()` opens one, `registerCase()` files into it. */
const batteryCases = new Map();
let openBattery = null;

/** Open a battery. Every assertion after this line is attributed to it. */
function battery(name) {
  openBattery = name;
}

/** Called by the self-test's own assertion sink, once per assertion. */
function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

/**
 * The floor: every declared battery RAN, and ran its cases (#13489).
 *
 * Evaluated after every battery has had its chance and BEFORE the verdict, so
 * the success line can only be printed by a run in which the set of batteries
 * that registered assertions EQUALS the set declared.
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
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  return problems;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * The declaration names this gate is about, each spelled ONCE.
 *
 * Every entry carries a non-empty FLOOR: a rostered name with no declarer left
 * in the tree fails the gate rather than passing over its empty population.
 * Adding a name arms the floor for it; removing one narrows the guard.
 */
const DECL_NAMES = [
  'ROOT_DIR_WATCH_HINTS',
  'ROOT_FILE_WATCH_HINTS',
  'ROOT_WATCH_HINTS',
  'DECLARED_WATCH_HINTS',
];

/**
 * The suffix every spelling of the idiom shares, used to DISCOVER a declaration
 * name the roster has never heard of.
 *
 * Discovery is scoped to the IDENTIFIER position of a declaration, the same way
 * the literal test is scoped to the declaration statement -- so this file's own
 * roster entries, which are string literals and not declarations, are not read
 * back as unrostered names. A self-test case pins that.
 */
const IDIOM_SUFFIX = 'WATCH_HINTS';

/**
 * This gate's own declaration, and the reason it is narrower than the
 * population it walks.
 *
 * The population is every tracked source file that declares any rostered name
 * -- repo-wide, because the idiom is not confined to `scripts/` (
 * `packages/spec/scripts/build-skill-references.ts` carries one). But the
 * spellable claim for a repo-wide walk would be a wholesale `packages/**`,
 * which is the costlier error: declaring a root a gate does not read wholesale
 * pastes it into every card under that root. So the declaration names the
 * subtree where the declarations actually live -- 29 of the 33 on this tree --
 * and the sweep stays repo-wide so nothing outside it is missed SILENTLY: a
 * declarer that appears elsewhere is judged like any other, it just does not
 * put this gate on that card's brief.
 *
 * Widening the roster moved that ratio rather than the argument. All four
 * declarers outside `scripts/` sit under `packages/lint/scripts/` or
 * `packages/spec/scripts/` -- two of them were already there, two arrived with
 * the roster -- and naming `packages/**` to reach them is still the costlier
 * error. A self-test case pins the count so the ratio cannot go stale quietly.
 */
const ROOT_DIR_WATCH_HINTS = ['scripts/**'];

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', '.cache', '.git', 'out',
]);

/** Anything the repo authors in JS or TS. `.d.ts` is generated. */
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;

/** Every authored JS/TS file under `dir`, dot-directories included. */
export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (SOURCE_EXT.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * The right-hand side of every declaration statement for `name`, comments
 * masked.
 *
 * `[^;]*` is the statement terminator and also the guard: a right-hand side
 * carrying a `;` of its own (a block-bodied arrow, say) truncates here and
 * fails the literal test below, which is the safe direction to fail in.
 *
 * The name goes in unescaped because it comes from `DECL_NAMES`, which is a
 * literal roster in this file -- never from the tree being scanned.
 */
export function declarationSites(source, name) {
  const code = maskComments(source);
  const re = new RegExp(
    String.raw`\b(?:export\s+)?(?:const|let|var)\s+${name}\s*(?::[^=;]*)?=\s*([^;]*);`,
    'g',
  );
  return [...code.matchAll(re)].map((m) => m[1]);
}

/**
 * Every declaration name in `source` that ends in the idiom's suffix but is not
 * on the roster, comments masked.
 *
 * This is the other half of the floor. The floor catches a rostered name that
 * DISAPPEARS; this catches a spelling of the idiom that APPEARS without anyone
 * teaching this gate about it -- which is how the roster's fourth name arrived,
 * and how a fifth would.
 */
export function unrosteredNames(source) {
  if (!source.includes(IDIOM_SUFFIX)) return [];
  const code = maskComments(source);
  // The prefix is OPTIONAL so a constant named exactly the suffix is discovered
  // too -- the shortest way to invent a fifth spelling should not be the one
  // way to slip past discovery.
  const re = new RegExp(
    String.raw`\b(?:export\s+)?(?:const|let|var)\s+((?:[A-Za-z_$][\w$]*)?${IDIOM_SUFFIX})\s*(?::[^=;]*)?=`,
    'g',
  );
  const found = [...code.matchAll(re)].map((m) => m[1]);
  return [...new Set(found.filter((n) => !DECL_NAMES.includes(n)))];
}

/**
 * The hints a right-hand side spells as quoted literals, or `null` when the
 * right-hand side is anything other than an array of quoted string literals.
 *
 * Backticks are refused with the rest: a template is the computed spelling this
 * gate exists to catch, and `extractWatchHints` cannot read a value out of one.
 */
export function literalHints(rhs) {
  const s = rhs.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  let rest = s.slice(1, -1);
  const hints = [];
  const element = /^\s*(?:'([^'\\\n]*)'|"([^"\\\n]*)")\s*(,?)/;
  while (rest.trim() !== '') {
    const m = element.exec(rest);
    if (!m) return null;
    hints.push(m[1] ?? m[2]);
    rest = rest.slice(m[0].length);
    if (m[3] !== ',') break;
  }
  return rest.trim() === '' ? hints : null;
}

/**
 * One file's verdict for ONE rostered name. `null` means the file does not
 * declare that name at all -- it mentions it in prose, or reads someone else's.
 */
export function auditSourceName(rel, source, name) {
  if (!source.includes(name)) return null;
  const sites = declarationSites(source, name);
  if (sites.length === 0) return null;
  if (sites.length > 1) {
    return {
      rel,
      name,
      ok: false,
      why: `${sites.length} ${name} declaration sites -- this gate cannot judge a declaration it cannot locate`,
    };
  }
  const hints = literalHints(sites[0]);
  if (hints === null) {
    return {
      rel,
      name,
      ok: false,
      why: `the ${name} declaration is COMPUTED, not a literal array -- the hint extractor reads `
        + 'source text, so a computed declaration builds no hint at all and the gate leaves every '
        + `dispatch brief: ${sites[0].trim().replace(/\s+/g, ' ').slice(0, 120)}`,
    };
  }
  if (hints.length === 0) {
    return { rel, name, ok: false, why: `the ${name} declaration is EMPTY -- it names no subtree at all` };
  }
  return { rel, name, ok: true, hints };
}

/**
 * One file's rows -- one per rostered name it declares, so a file carrying two
 * spellings is judged on both rather than on whichever the scan reached first.
 * Empty when the file declares none.
 */
export function auditSource(rel, source) {
  const rows = [];
  for (const name of DECL_NAMES) {
    const row = auditSourceName(rel, source, name);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Every declarer under `files`, judged, plus every unrostered spelling found.
 *
 * `{ rows, strays }` rather than a bare array because the two are different
 * verdicts on different questions -- "is this declaration readable" and "does
 * this gate know this name at all" -- and each file is read ONCE to answer both.
 */
export function audit(files, read = (abs) => readFileSync(abs, 'utf8')) {
  const rows = [];
  const strays = [];
  for (const abs of files) {
    const rel = relative(REPO_ROOT, abs).split('\\').join('/');
    const source = read(abs);
    rows.push(...auditSource(rel, source));
    for (const name of unrosteredNames(source)) strays.push({ rel, name });
  }
  rows.sort((a, b) => (a.rel === b.rel ? (a.name < b.name ? -1 : 1) : a.rel < b.rel ? -1 : 1));
  strays.sort((a, b) => (a.rel === b.rel ? (a.name < b.name ? -1 : 1) : a.rel < b.rel ? -1 : 1));
  return { rows, strays };
}

/**
 * The rostered names with NO declarer among `rows` -- the per-name floor.
 *
 * Pure, and split out of `main` precisely so the self-test can drive it without
 * a filesystem: the vacuity this guards against is the one shape a live-tree
 * assertion can never exhibit while the tree is healthy.
 *
 * A name whose only declarer is UNREADABLE is present, not missing -- that row
 * fails the gate on its own path, and calling it missing too would name the
 * same defect twice under two different remedies.
 */
export function missingNames(rows) {
  const seen = new Set(rows.map((r) => r.name));
  return DECL_NAMES.filter((n) => !seen.has(n));
}

function list() {
  const { rows, strays } = audit(walk(REPO_ROOT));
  for (const r of rows) {
    console.log(`${r.ok ? '  ' : '✗ '}${r.rel}  ${r.name}  ${r.ok ? JSON.stringify(r.hints) : r.why}`);
  }
  for (const s of strays) console.log(`? ${s.rel}  ${s.name}  UNROSTERED`);
  return 0;
}

function main() {
  const { rows, strays } = audit(walk(REPO_ROOT));

  // The floor comes FIRST: a name that found nothing must not be able to reach
  // the pass below on the strength of the names that did.
  const missing = missingNames(rows);
  if (missing.length) {
    for (const n of missing) {
      console.error(
        `  ✗ ${n} -- NO declaration found anywhere in this tree. Refused rather than passed: `
        + '"every declaration is a literal" is vacuously true over an empty population, so this '
        + 'name would otherwise print the healthiest green this gate has.',
      );
    }
    console.error(
      `✗ check-watch-hint-literal: ${missing.length} of ${DECL_NAMES.length} rostered name(s) have `
      + 'an EMPTY population. Either the constant was renamed -- restore it, or roster the new '
      + 'name -- or the spelling was retired on purpose, in which case drop it from DECL_NAMES in '
      + 'this file, which narrows this guard and should be a decision rather than a side effect.',
    );
    return 1;
  }

  if (strays.length) {
    for (const s of strays) {
      console.error(`  ✗ ${s.rel} -- declares ${s.name}, which this gate has never heard of`);
    }
    console.error(
      `✗ check-watch-hint-literal: ${strays.length} declaration(s) spell the watch-hint idiom under `
      + 'a name that is not rostered, so nothing holds them to a literal spelling. Add the name to '
      + 'DECL_NAMES in this file (which arms the per-name floor for it too), or spell the '
      + `declaration with one of the ${DECL_NAMES.length} names already rostered.`,
    );
    return 1;
  }

  const bad = rows.filter((r) => !r.ok);
  for (const r of bad) console.error(`  ✗ ${r.rel} -- ${r.why}`);
  if (bad.length) {
    console.error(
      `✗ check-watch-hint-literal: ${bad.length} of ${rows.length} declaration(s) are not readable `
      + 'as literals. Spell the hints inside the declaration statement.',
    );
    return 1;
  }

  const perName = DECL_NAMES
    .map((n) => `${n} ${rows.filter((r) => r.name === n).length}`)
    .join(', ');
  console.log(
    `✓ check-watch-hint-literal: ${rows.length} declaration(s) across ${DECL_NAMES.length} rostered `
    + `name(s) -- ${perName} -- every one an array of quoted literals inside its own statement, `
    + 'every rostered name non-empty, and no unrostered spelling of the idiom in the tree.',
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test -- fixture sources, plus the live tree
// ---------------------------------------------------------------------------

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => {
    registerCase();
    return cases.push({ name, ok: Boolean(ok), detail });
  };
  const [DIR_NAME] = DECL_NAMES;
  /** A fixture that never spells the declaration verbatim in THIS file's text. */
  const decl = (rhs, extra = '', name = DIR_NAME) => `${extra}const ${name} = ${rhs};\n`;
  const rowsOf = (src) => auditSource('f.mjs', src);
  const verdict = (src) => rowsOf(src)[0] ?? null;
  const rejected = (src) => verdict(src) !== null && verdict(src).ok === false;
  const accepted = (src) => verdict(src) !== null && verdict(src).ok === true;

  // -- the computed spellings this gate exists to reject ---------------------
  battery('the computed spellings this gate exists to reject');
  const COMPUTED = [
    'ROOTS.map((r) => `${r}/**`)',
    '[`${SCAN_ROOT}/**`]',
    "[SCAN_ROOT + '/**']",
    "['scripts' + '/' + '*'.repeat(2)]",
    '[...OTHER_HINTS]',
    "['scripts/**'].map((h) => h)",
    'ROOTS.filter((r) => !r.includes(SEP)).map((r) => r + SUFFIX)',
    "[join('scripts', '**')]",
  ];
  COMPUTED.forEach((rhs, i) => t(
    `computed spelling ${i + 1} of ${COMPUTED.length} is rejected`,
    rejected(decl(rhs)),
    rhs,
  ));

  // ⭐ The case the whole gate turns on, and the one both earlier remedies got
  // wrong: the literal is still in the file -- in a neighbouring RUNTIME
  // assertion and again in a COMMENT -- and the declaration is still computed.
  // A whole-file search finds those copies and stays green. This must not.
  const scoped = decl('[`${SCAN_ROOT}/**`]', `// the declared subtree is 'packages/**'\n`)
    + `assert(${DIR_NAME}.includes('packages/**'));\n`;
  t('a computed declaration is rejected THROUGH a runtime copy of the literal beside it',
    rejected(scoped), 'whole-file `includes` is what this replaces');
  t('...and through a COMMENT copy of the literal beside it',
    rejected(decl('[`${SCAN_ROOT}/**`]', `// hint: 'packages/**'\n`)));

  // -- shapes that are not a literal ARRAY -----------------------------------
  battery('shapes that are not a literal ARRAY');
  t('an empty declaration is rejected -- it names no subtree', rejected(decl('[]')));
  t('a bare string declaration is rejected', rejected(decl("'scripts/**'")));
  t('two declaration sites are refused rather than judged',
    rejected(decl("['a/**']") + decl("['b/**']")));

  // -- the literal spellings that must stay accepted -------------------------
  battery('the literal spellings that must stay accepted');
  t('the canonical spelling is accepted', accepted(decl("['scripts/**']")));
  t('an exported declaration is accepted', accepted(decl("['a/**', \"b/**\"]", 'export ')));
  t('a multi-line array with a trailing comma is accepted',
    accepted(decl("[\n  'packages/*',\n  'apps/*',\n]")));
  t('an array carrying an inline comment is accepted',
    accepted(decl("[\n  'packages/*', // the workspace roots\n  'apps/*',\n]")));
  t('a TypeScript type annotation does not hide the declaration',
    accepted(`const ${DIR_NAME}: string[] = ['skills/**'];\n`));
  t('the hints are read back out of the statement',
    JSON.stringify(verdict(decl("['a/**', 'b/**']")).hints) === '["a/**","b/**"]');

  // -- comments and prose are not declarations -------------------------------
  battery('comments and prose are not declarations');
  t('a COMMENTED-OUT computed declaration does not shadow the real one',
    accepted(`// ${decl('ROOTS.map((r) => r)')}${decl("['skills/**']")}`));
  t('a file that only MENTIONS the constant is not a declarer',
    verdict(`// the ${DIR_NAME} idiom can only name a whole subtree\n`) === null);
  t('a file that reads someone else\'s declaration is not a declarer',
    verdict(`const spelled = mod.${DIR_NAME}.slice();\n`) === null);

  // -- EVERY rostered name is judged, not just the first ---------------------
  // ⭐ The defect this widening closes. Before it, the three names below
  // carried the identical silent-drop mechanism with nothing holding them to a
  // literal spelling. Each is exercised through the SAME computed spelling that
  // the first name rejects, so a name that is rostered but not wired would show
  // up here as an acceptance rather than as a missing case.
  battery('EVERY rostered name is judged, not just the first');
  for (const name of DECL_NAMES) {
    t(`a computed ${name} declaration is rejected`,
      rejected(decl('[`${SCAN_ROOT}/**`]', '', name)), name);
    t(`a literal ${name} declaration is accepted`,
      accepted(decl("['scripts/**']", '', name)), name);
  }
  t('a file declaring TWO different rostered names is judged on BOTH',
    rowsOf(decl("['a/**']", '', DECL_NAMES[0]) + decl('COMPUTED.map((r) => r)', '', DECL_NAMES[1]))
      .length === 2);
  t('...and the second name\'s computed declaration is the one that fails',
    rowsOf(decl("['a/**']", '', DECL_NAMES[0]) + decl('COMPUTED.map((r) => r)', '', DECL_NAMES[1]))
      .filter((r) => !r.ok).map((r) => r.name).join() === DECL_NAMES[1]);

  // -- the per-name floor ----------------------------------------------------
  // ⭐ The vacuity trap the widening would otherwise CREATE. A global floor
  // passes all three of these: the population is large and healthy, and one
  // name is silently gone.
  battery('the per-name floor');
  t('an empty population reports EVERY rostered name as missing',
    missingNames([]).join() === DECL_NAMES.join());
  const oneNameGone = DECL_NAMES.slice(1).map((name) => ({ rel: 'g.mjs', name, ok: true, hints: ['a/**'] }));
  t('a population missing ONE name reports exactly that name, however healthy the rest',
    missingNames(oneNameGone).join() === DECL_NAMES[0],
    `${oneNameGone.length} healthy rows and the floor still refuses`);
  t('a global "is the population non-empty" floor would NOT catch it -- which is why it is per-name',
    oneNameGone.length > 0 && missingNames(oneNameGone).length === 1);
  t('a full roster reports nothing missing',
    missingNames(DECL_NAMES.map((name) => ({ rel: 'g.mjs', name, ok: true, hints: ['a/**'] }))).length === 0);
  t('a name whose ONLY declaration is unreadable is present, not missing',
    missingNames(DECL_NAMES.map((name) => ({ rel: 'g.mjs', name, ok: false, why: 'x' }))).length === 0);

  // -- discovery of an UNROSTERED spelling of the idiom ----------------------
  battery('discovery of an UNROSTERED spelling of the idiom');
  const strayName = `SOME_OTHER_${IDIOM_SUFFIX}`;
  t('a declaration under an unrostered name ending in the idiom suffix is discovered',
    unrosteredNames(decl("['a/**']", '', strayName)).join() === strayName);
  t('a rostered name is NOT reported as a stray',
    unrosteredNames(decl("['a/**']", '', DIR_NAME)).length === 0);
  t('a constant named EXACTLY the suffix is discovered too',
    unrosteredNames(decl("['a/**']", '', IDIOM_SUFFIX)).join() === IDIOM_SUFFIX);
  t('an unrelated constant is not discovered',
    unrosteredNames("const SCAN_ROOTS = ['a/**'];\n").length === 0);
  t('a COMMENTED-OUT unrostered declaration is not discovered',
    unrosteredNames(`// ${decl("['a/**']", '', strayName)}`).length === 0);

  // -- the empty population is refused, not passed ---------------------------
  battery('the empty population is refused, not passed');
  t('an empty file list produces no rows, which the floor above refuses',
    audit([]).rows.length === 0 && missingNames(audit([]).rows).length === DECL_NAMES.length);

  // -- the live tree ---------------------------------------------------------
  battery('the live tree');
  const { rows: live, strays } = audit(walk(REPO_ROOT));
  const here = 'scripts/check-watch-hint-literal.mjs';
  t('the live sweep finds a real population, not a broken one', live.length >= 30,
    `${live.length} declaration(s)`);
  t('every live declaration is a literal', live.every((r) => r.ok),
    live.filter((r) => !r.ok).map((r) => `${r.rel}:${r.name}`).join(' · '));
  t('EVERY rostered name has a live declarer -- the floor is armed, not merely coded',
    missingNames(live).length === 0, `missing: ${missingNames(live).join(', ') || 'none'}`);
  for (const name of DECL_NAMES) {
    const n = live.filter((r) => r.name === name).length;
    t(`live population for ${name} is non-empty`, n > 0, `${n} declaration(s)`);
  }
  t('the tree spells the idiom under NO name this gate has never heard of',
    strays.length === 0, strays.map((s) => `${s.rel}:${s.name}`).join(' · '));
  t('this gate judges ITSELF -- its own declaration is in the population',
    live.some((r) => r.rel === here));
  t('and this file holds exactly ONE declaration site across ALL rostered names, '
    + 'so its fixtures stay out of the scan',
    DECL_NAMES
      .map((n) => declarationSites(readFileSync(fileURLToPath(import.meta.url), 'utf8'), n).length)
      .reduce((a, b) => a + b, 0) === 1);
  t('...and this file declares no unrostered spelling either, so its roster is not read back as one',
    unrosteredNames(readFileSync(fileURLToPath(import.meta.url), 'utf8')).length === 0);
  t('the population reaches OUTSIDE scripts/, which is why the sweep is repo-wide',
    live.some((r) => !r.rel.startsWith('scripts/')));
  t('the declared subtree is where most declarations live',
    ROOT_DIR_WATCH_HINTS.includes('scripts/**')
    && live.filter((r) => r.rel.startsWith('scripts/')).length >= 25);
  t('every declarer outside the declared subtree sits under a packages/ scripts dir, '
    + 'which is why naming packages/** to reach them is refused',
    live.filter((r) => !r.rel.startsWith('scripts/'))
      .every((r) => /^packages\/[^/]+\/scripts\//.test(r.rel)),
    live.filter((r) => !r.rel.startsWith('scripts/')).map((r) => r.rel).join(' · '));

  // The floor runs BEFORE the verdict below, so a success line can only be
  // printed by a run in which every declared battery registered its cases.
  for (const message of batteryFloorFailures()) cases.push({ name: message, ok: false });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-watch-hint-literal self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-watch-hint-literal self-test: ${cases.length} cases pass -- ${COMPUTED.length} computed `
    + 'spellings rejected, the statement-scoped search proved against runtime and comment copies of '
    + `the literal beside it, all ${DECL_NAMES.length} rostered names judged for both spellings, the `
    + 'per-name floor proved against a population that is healthy on every name but one, unrostered '
    + 'spellings of the idiom discovered, and the live repo-wide population judged.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv;
  if (argv.includes('--self-test')) {
    const selfTestCode = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-watch-hint-literal self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(selfTestCode);
  }
  process.exit(argv.includes('--list') ? list() : main());
}
