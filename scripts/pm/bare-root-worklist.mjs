#!/usr/bin/env node
//
// The INVISIBLE half of the bare-root species (#10840) — the worklist, derived.
//
//   node scripts/pm/bare-root-worklist.mjs              the worklist + its triage
//   node scripts/pm/bare-root-worklist.mjs --wide       the unrestricted contrast sweep
//   node scripts/pm/bare-root-worklist.mjs --self-test
//
// ── What this measures, and why it needed a tool ────────────────────────────
//
// The PM dispatch derivation (scripts/pm/dispatch-gates.mjs) builds every
// dispatch's gate list by scanning each gate's own source for the path literals
// it operates on. "Looks like a path" there means "carries a separator, or
// starts with a known dotted root" — `looksPathy` in `extractWatchHints`. A gate
// whose population is spelled as a bare single-segment word therefore builds no
// hint AT ALL:
//
//   extractWatchHints("const POPULATION = 'packages';")    -> []
//   extractWatchHints("const POPULATION = 'packages/';")   -> ["packages"]
//   extractWatchHints("const POPULATION = 'packages/**';") -> ["packages/**"]
//
// Only the second reaches the hint set, and only the second is visible to the
// shrink-only ledger #10705 landed for it (`ESCAPABLE_LITERAL_LEDGER`). That
// ledger's own comment says so, and names this sweep as the other half: an empty
// ledger is not "the species is gone". The first line is a gate that is
// unnameable by any dispatch brief and leaves no residue saying so — not a dead
// hint, not a silent verdict, nothing.
//
// ── Why this is a REPORT and not part of the derivation ─────────────────────
//
// Recognising this species needs a heuristic over constant NAMES, which is a
// judgement call baked into a regex. #10705's dispatch refused to put one on the
// path that runs for every PR's gate list, and that refusal is kept here: this
// file imports the derivation's predicates and never modifies them, nothing in
// `dispatch-gates.mjs` reads this file, and no verdict below reaches a dispatch
// prompt. What runs on every PR is only this file's `--self-test`, which asks
// whether the recorded triage still describes the tree.
//
// ── Why the constant-name restriction, measured ─────────────────────────────
//
// Dropping it (`--wide`) and flagging any bare top-level-dir literal is the
// sweep #10840 warned against, and the warning reproduces: the wide sweep finds
// roughly twice the rows across roughly twice the families, overwhelmingly
// literals that are `join()` path COMPONENTS in gates that never read those
// roots. Demanding a declaration for those is the +139084 fabrication that
// `hintCovers`' docblock prices, re-introduced one level up. The restricted
// sweep is the debt list; the wide one is kept runnable purely as the contrast
// that justifies the restriction, and is never triaged.
//
// ── The instrument's one limit, which decides most of the triage ────────────
//
// `collapseHint` strips globs, so a declared hint can only ever name a SUBTREE:
// every tracked file beneath a directory, or nothing. There is no way to declare
// "the package manifests under this root", "the test files", "the SKILL.md
// files". So a gate whose real population is a file-KIND or FILENAME filter
// inside a root has no honest declaration available — the only spellable claim
// is the whole subtree, which is false for most of what it would name. That is
// not a gap to be fixed later; it is the reason most rows below are refusals.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import {
  collapseHint,
  discoverFamilies,
  extractWatchHints,
  hintCovers,
  maskComments,
  maskSelfTests,
  trackedFiles,
} from './dispatch-gates.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;

/**
 * A constant name that DECLARES a population, as opposed to one that merely
 * holds a path fragment. This is the judgement call the card refused to put in
 * the derivation, and it is deliberately narrow: it selects the shape an author
 * uses when saying "this is what I walk". Widening it is how this becomes the
 * wide sweep, which is the thing not to build.
 */
const POPULATION_CONSTANT = /^(?:[A-Z0-9_]*_ROOTS?|[A-Z0-9_]*_DIRS?|POPULATION|[A-Z0-9_]*_SCOPE)$/;

/**
 * The recorded triage — the half of this file that a human decided and the tree
 * cannot re-derive. Keys are `family constant word`; the row half of every key
 * is checked against the live sweep by the self-test, in BOTH directions, so a
 * verdict cannot outlive the row it judges and a new row cannot land unjudged.
 *
 * ⚠️ The key format carries SPACES on purpose, the same spelling rule
 * `ESCAPABLE_LITERAL_LEDGER` follows: the extractor refuses a quoted span
 * containing a space, so no key here can enter this file's own hint set as a
 * path it does not read. A key spelled as a bare script path would.
 *
 * Verdicts, and what each one commits to:
 *
 *   DECLARED-NARROWER  the gate took the escape, at a strictly narrower subtree
 *                      than the bare word. The row stays in the sweep because
 *                      the bare root is still not covered — which is correct,
 *                      not outstanding debt.
 *   REFUSE-WIDE        the population really IS the whole top-level root. A
 *                      declaration would be TRUE, and is refused anyway: it
 *                      names the gate for every card under a root the fleet
 *                      already declares wholesale, so the matched column stops
 *                      discriminating and restates "run the farm", which CI
 *                      does regardless. Recall bought at the cost of precision,
 *                      on the one column whose whole value is precision.
 *   REFUSE-UNSPELLABLE the population is a file-KIND or FILENAME filter inside
 *                      the root. The subtree idiom can only say "all of it", at
 *                      the precision quoted. This is the +139084 shape.
 *
 * Every percentage below was measured on the tree, not estimated: numerator is
 * the files the gate's own walk filter admits, denominator the tracked files
 * under the subtree a declaration would name.
 */
const TRIAGE = new Map([
  // ── Taken: a strictly narrower subtree ────────────────────────────────────
  ['check:driver-conformance DRIVERS_DIR packages', {
    verdict: 'DECLARED-NARROWER',
    why: 'the literal is a join() component; the real population is the driver subtree, declared '
      + 'there at 259 of 291 files (89%) instead of 259 of 4903 (5.3%) at the bare root',
  }],
  // ── Refused: the population is the whole root, and the root is saturated ──
  ['check:authz-resolver SCAN_ROOTS packages', {
    verdict: 'REFUSE-WIDE',
    why: 'walks every non-test TS source under the root — 1898 of 4903 (39%). True, and it would '
      + 'name this gate for every card in the repo that touches a package',
  }],
  ['check:dispatcher-error-vocabulary SCAN_ROOT packages', {
    verdict: 'REFUSE-WIDE',
    why: 'non-test sources plus manifests, 1898 of 4903 (39%) — same trade',
  }],
  ['check:engine-double-contract SCAN_ROOTS packages', {
    verdict: 'REFUSE-WIDE',
    why: 'tests AND sources, 4408 of 4903 (90%): the most nearly-true declaration on this list, '
      + 'and the widest blast radius on it. Precision over the subtree is not the question — '
      + 'whether the matched column still tells a dev anything is',
  }],
  ['check:engine-double-contract SCAN_ROOTS examples', {
    verdict: 'REFUSE-WIDE',
    why: '199 of 238 (84%) over a small subtree, so this is the nearest miss on the whole list. '
      + 'Refused with the packages half rather than split from it: declaring only the smaller '
      + 'root would name the gate on example cards and stay silent on the package cards where '
      + 'test doubles actually land, which reads as a claim about where this gate bites',
  }],
  ['check:error-code-casing SCAN_ROOTS packages', {
    verdict: 'REFUSE-WIDE',
    why: 'tests included, 4408 of 4903 (90%) — same trade as engine-double-contract',
  }],
  ['check:error-status-conformance SCAN_ROOT packages', {
    verdict: 'REFUSE-WIDE',
    why: 'walks every non-test TS source under the root — 1898 of 4903 (39%)',
  }],
  ['check:optional-error-sink SCAN_ROOTS packages', {
    verdict: 'REFUSE-WIDE',
    why: '1898 of 4903 (39%). Its own failure text already prints the subtree spelling, which is '
      + 'how close this shape sits to declaring itself by accident',
  }],
  ['check:resume-authority-declared DEFAULT_SCAN_ROOTS packages', {
    verdict: 'REFUSE-WIDE',
    why: 'walks every non-test TS source under the root — 1898 of 4903 (39%)',
  }],
  ['check:resume-authority-declared DEFAULT_SCAN_ROOTS examples', {
    verdict: 'REFUSE-WIDE',
    why: '162 of 238 (68%), refused with its packages half for the reason above',
  }],
  ['check:runtime-services-index PACKAGES_DIR packages', {
    verdict: 'REFUSE-WIDE',
    why: 'walks every non-test TS source under the root — 1898 of 4903 (39%)',
  }],
  ['check:verify-stand-in SCAN_ROOTS packages', {
    verdict: 'REFUSE-WIDE',
    why: 'walks every non-test TS source under the root — 1898 of 4903 (39%)',
  }],
  ['check:verify-stand-in SCAN_ROOTS examples', {
    verdict: 'REFUSE-WIDE',
    why: '162 of 238 (68%), refused with its packages half for the reason above',
  }],
  ['check:ratchet-remedy-authority SCRIPTS_DIR scripts', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'reads the TOP LEVEL of the root only, and only two extensions — 115 of 226 (51%). The '
      + 'idiom has no non-recursive spelling: a subtree hint claims every nested directory too',
  }],
  ['scripts/check-declaration-mirrors.mjs SCRIPTS_DIR scripts', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'same top-level-only shape, 115 of 226 (51%)',
  }],
  // ── Refused: the population is a filter the idiom cannot spell ────────────
  ['check:driver-conformance CASE_SETS_DIR packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'a filename pattern inside one directory — 7 of 143 files (4.9%). Its sibling constant '
      + 'took the escape; this one has nothing honest to declare',
  }],
  ['check:meta-type-normalized SCAN_DIRS packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'the join() component resolves to one package source dir, but that dir is 133 test files '
      + 'to 21 sources — 21 of 154 (14%). Narrow enough to name, false 6 times in 7',
  }],
  ['check:examples-live-imports PACKAGES_ROOT packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'test files only, 2510 of 4903 (51%) — and already refused in that gate own docblock, '
      + 'measured there at 76 real couplings out of 4861 (1.6%)',
  }],
  ['check:where-matcher SCAN_ROOT packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'test files only, 2510 of 4903 (51%)',
  }],
  ['check:i18n-coverage EXAMPLES_DIR examples', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'one named config file per child directory — 3 of 238 (1.3%)',
  }],
  ['scripts/check-skills-token-ratchet.mjs SKILLS_DIR skills', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'one named file per child directory, 11 of 50 (22%). It already reaches its own cards '
      + 'through the artifact roster it names file by file, so the miss is smaller than the row',
  }],
  ['check:changeset-gate-self-tests PACKAGE_ROOTS packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'workspace manifests only — 73 of 4903 (1.5%)',
  }],
  ['check:changeset-gate-self-tests PACKAGE_ROOTS apps', {
    verdict: 'REFUSE-UNSPELLABLE', why: 'workspace manifests only — 1 of 35 (2.9%)',
  }],
  ['check:changeset-gate-self-tests PACKAGE_ROOTS examples', {
    verdict: 'REFUSE-UNSPELLABLE', why: 'workspace manifests only — 4 of 238 (1.7%)',
  }],
  ['scripts/check-adr-0087-registration.mjs PACKAGE_ROOTS packages', {
    verdict: 'REFUSE-UNSPELLABLE', why: 'workspace manifests only — 73 of 4903 (1.5%)',
  }],
  ['scripts/check-adr-0087-registration.mjs PACKAGE_ROOTS apps', {
    verdict: 'REFUSE-UNSPELLABLE', why: 'workspace manifests only — 1 of 35 (2.9%)',
  }],
  ['scripts/check-adr-0087-registration.mjs PACKAGE_ROOTS examples', {
    verdict: 'REFUSE-UNSPELLABLE', why: 'workspace manifests only — 4 of 238 (1.7%)',
  }],
  ['check:skill-compatibility PACKAGE_ROOTS packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'workspace manifests only — 73 of 4903 (1.5%). Refused BY NAME in that gate self-test, '
      + 'beside the skills root it did declare',
  }],
  ['check:skill-compatibility PACKAGE_ROOTS apps', {
    verdict: 'REFUSE-UNSPELLABLE', why: 'workspace manifests only — 1 of 35 (2.9%)',
  }],
  ['check:skill-compatibility PACKAGE_ROOTS examples', {
    verdict: 'REFUSE-UNSPELLABLE', why: 'workspace manifests only — 4 of 238 (1.7%)',
  }],
]);

// ---------------------------------------------------------------------------
// The sweep — derived at runtime. Nothing below is listed in this file.
// ---------------------------------------------------------------------------

/** Every top-level directory the tree actually has, from the tracked corpus. */
export function topLevelDirs(files) {
  const dirs = new Set();
  for (const f of files) {
    const i = f.indexOf('/');
    if (i > 0) dirs.add(f.slice(0, i));
  }
  return dirs;
}

/**
 * The literals in a masked module body that name a bare top-level directory the
 * derivation cannot see.
 *
 * Invisibility is decided by the EXTRACTOR ITSELF — the literal is put back
 * through `extractWatchHints` alone in a module body and must build nothing —
 * rather than by a local copy of `looksPathy`. That distinction is load-bearing:
 * the dotted top-level roots clear `looksPathy` on its second branch and were
 * never in this species, and a hand-copied separator test silently sweeps them
 * in. It also means this sweep cannot drift from the rule it is reporting on.
 */
export function bareRootLiterals(maskedBody, dirs) {
  const found = [];
  for (const m of maskedBody.matchAll(/['"`]([^'"`\n]{2,120})['"`]/g)) {
    const raw = m[1];
    if (/^(https?:|[A-Z_]+=|-{1,2}\w)/.test(raw)) continue;
    if (!/^[\w.@][\w.@/*-]*$/.test(raw)) continue;
    const s = raw.replace(/^(?:\.\.?(?:\/|$))+/, '');
    if (!s || !dirs.has(s)) continue;
    if (extractWatchHints(`const X = ${JSON.stringify(s)};`).length !== 0) continue;
    found.push({ word: s, index: m.index });
  }
  return found;
}

/**
 * The `const NAME = …;` spans in a masked body whose NAME declares a population.
 * The scan walks to the `;` that closes the initializer, tracking quote state so
 * a semicolon inside a string cannot end the span early.
 */
export function populationSpans(maskedBody) {
  const spans = [];
  for (const m of maskedBody.matchAll(/(?:^|[\s;{(])(?:const|let|var)[ \t]+([A-Za-z0-9_$]+)[ \t]*=/g)) {
    const name = m[1];
    if (!POPULATION_CONSTANT.test(name)) continue;
    let i = m.index + m[0].length;
    let quote = null;
    for (; i < maskedBody.length; i++) {
      const c = maskedBody[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === ';') break;
    }
    spans.push({ name, start: m.index, end: i });
  }
  return spans;
}

/** `family constant word`, the key format the triage is written in. */
export function rowKey({ check, constant, word }) {
  return `${check} ${constant} ${word}`;
}

/**
 * The sweep. `restrict: false` is the wide contrast sweep — kept runnable, never
 * triaged, and reported only so the restriction can be justified by measurement
 * instead of by assertion.
 */
export function sweep(families, files, { restrict = true } = {}) {
  const dirs = topLevelDirs(files);
  const rows = [];
  const seen = new Set();
  for (const [check, entry] of families) {
    // "Covered" asks the only question the tree can answer: can the derivation
    // name this gate for an arbitrary card under that root? A gate that declared
    // a strictly NARROWER subtree still answers no, correctly, so the recorded
    // triage — not this predicate — is what says such a row is settled.
    const covered = (word) => (entry.hints ?? []).some((h) => hintCovers(h, `${word}/probe.file`));
    for (const file of entry.files ?? []) {
      const abs = join(ROOT, file);
      if (!existsSync(abs)) continue;
      const body = maskSelfTests(maskComments(readFileSync(abs, 'utf8')));
      const spans = restrict ? populationSpans(body) : [];
      for (const { word, index } of bareRootLiterals(body, dirs)) {
        let constant = null;
        if (restrict) {
          const span = spans.find((s) => index > s.start && index < s.end);
          if (!span) continue;
          constant = span.name;
        }
        const row = { check, constant, word, file, covered: covered(word) };
        const key = restrict ? rowKey(row) : `${check} ${word}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ ...row, key });
      }
    }
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

function report({ wide = false } = {}) {
  const files = trackedFiles();
  const families = [...discoverFamilies().byCheck];
  const rows = sweep(families, files, { restrict: !wide });
  const open = rows.filter((r) => !r.covered);
  if (wide) {
    console.log(
      `bare-root sweep, UNRESTRICTED: ${rows.length} (family, word) pair(s) across `
        + `${new Set(rows.map((r) => r.check)).size} of ${families.length} families; `
        + `${open.length} not covered by any declaration.\n`
        + '⛔ Contrast only. These are overwhelmingly join() path components in gates that never '
        + 'read those roots — demanding a declaration for them is the fabrication this sweep '
        + 'exists to avoid, and no verdict is recorded for any of them.\n',
    );
    for (const r of rows) console.log(`  ${r.covered ? 'covered ' : 'OPEN    '} ${r.key}   (${r.file})`);
    return;
  }
  console.log(
    `bare-root worklist: ${rows.length} (family, constant, word) triple(s) across `
      + `${new Set(rows.map((r) => r.check)).size} of ${families.length} families, `
      + `${files.length} tracked files. ${rows.length - open.length} now reachable by declaration; `
      + `${open.length} still unreachable as spelled.\n`,
  );
  for (const r of rows) {
    const t = TRIAGE.get(r.key);
    const state = r.covered ? 'REACHABLE' : (t ? t.verdict : '⛔ UNTRIAGED');
    console.log(`  ${state.padEnd(19)} ${r.key}`);
    if (t) console.log(`  ${' '.repeat(19)}   ${t.why}`);
  }
  const untriaged = open.filter((r) => !TRIAGE.has(r.key));
  console.log(
    `\n${untriaged.length} untriaged row(s). Every verdict above is a judgement recorded once, `
      + 'not a rule; the sweep itself is re-derived from the tree on every run.',
  );
}

function selfTest() {
  const failures = [];
  const t = (label, ok) => { if (!ok) failures.push(label); };

  const files = trackedFiles();
  const dirs = topLevelDirs(files);
  const families = [...discoverFamilies().byCheck];
  const rows = sweep(families, files);
  const open = rows.filter((r) => !r.covered);
  const keys = new Set(rows.map((r) => r.key));

  // #4690 at zero rows: a quiet sweep must prove it can SPEAK. The recogniser is
  // asked directly, by splicing one synthetic family into the LIVE corpus, so
  // this holds whatever the tree happens to owe — the shape PR #10890 had to
  // rebuild ESCAPABLE_LITERAL_LEDGER's guard into when its last row came out.
  // The root is taken FROM THE TREE rather than spelled, so this file declares
  // no population of its own.
  const someRoot = [...dirs].filter((d) => !d.startsWith('.')).sort()[0];
  t('a top-level root exists to probe the recogniser with', Boolean(someRoot));
  // Driven through the predicates rather than through discoverFamilies, since a
  // synthetic family has no file on disk to read.
  const probeBody = `const SCAN_ROOTS = [${JSON.stringify(someRoot)}];`;
  t('a population constant holding a bare top-level root is recognised',
    bareRootLiterals(probeBody, dirs).length === 1 && populationSpans(probeBody).length === 1);
  t('…and the recogniser DISCRIMINATES: the same root with a separator is visible to the '
    + 'derivation already, so it is not in this species',
    bareRootLiterals(`const SCAN_ROOTS = [${JSON.stringify(`${someRoot}/`)}];`, dirs).length === 0);
  // The dotted roots are the live specimen for the other half of that rule, and
  // the reason invisibility is decided by the extractor rather than by a copied
  // separator test. Read from the tree, never spelled: a dotted literal here
  // WOULD build a hint, which is the trap this file must not fall into.
  const dottedRoot = [...dirs].filter((d) => d.startsWith('.')).sort()[0];
  t('a dotted top-level root is present to test with', Boolean(dottedRoot));
  t('…and it is NOT in this species — `looksPathy` accepts it on its dotted branch, so it '
    + 'reaches the hint set and was never invisible',
    bareRootLiterals(`const SCAN_ROOTS = [${JSON.stringify(dottedRoot)}];`, dirs).length === 0);
  t('the constant-name restriction actually restricts — a bare root outside a population '
    + 'constant yields no triple',
    populationSpans(`const somePath = ${JSON.stringify(someRoot)};`).length === 0);
  t('the live sweep is non-empty, so the cases below judge something', rows.length > 0);

  // ── The triage coupling, both directions ──────────────────────────────────
  //
  // STALE: a verdict that outlives its row. This is the shrink — when a gate
  // takes a declaration, or a family is renamed, the verdict must come out with
  // it. A verdict describing a row the sweep no longer finds is the shape that
  // rots into an allowlist nobody re-reads, which #10840 refused by name.
  const stale = [...TRIAGE.keys()].filter((k) => !keys.has(k)).sort();
  t(`no recorded verdict outlives its row${stale.length ? ` — STALE: ${stale.join(' · ')}. `
    + 'Delete the entry; do not re-point it at another row.' : ''}`, stale.length === 0);
  // FRESH: a row that landed unjudged. The remedy is ONE LINE — record a
  // verdict — and explicitly not "declare a subtree": a wrong declaration is a
  // fabricated lead in every future dispatch prompt, which `hintCovers`' docblock
  // prices above a missing one. Refusing, with the measured reason, is a
  // first-class outcome here and most rows below are one.
  const fresh = open.filter((r) => !TRIAGE.has(r.key)).map((r) => r.key).sort();
  t(`no gate has NEWLY joined the invisible bare-root species${fresh.length ? ` — FRESH: `
    + `${fresh.join(' · ')}. Record a verdict for it: REFUSE-WIDE, REFUSE-UNSPELLABLE, or a `
    + 'declaration beside the constant (the ROOT_DIR_WATCH_HINTS idiom — check-role-word.mjs, '
    + 'check-examples-live-imports.mjs, check-driver-conformance.mjs). ⛔ Declaring a root the '
    + 'gate does not read wholesale is the costlier error.' : ''}`, fresh.length === 0);

  // The spelling rule the triage docblock states, held mechanically: a key
  // spelled as a bare path would enter this file's own declared population.
  const asHints = (s) => extractWatchHints(`const L = ${JSON.stringify(s)};`);
  t('no triage key enters this file\'s own hint set as a path',
    [...TRIAGE.keys(), 'check:sample-gate SOME_ROOT someroot'].every((k) => asHints(k).length === 0));
  t('…and that rule can FAIL: the bare-path spelling it forbids does build a hint',
    asHints('scripts/check-x.mjs').length === 1);

  // This whole FILE must declare no population either — it reads gate sources,
  // never a repo subtree, and a stray path literal in it would name it for cards
  // it has nothing to say about. Read from disk, not from a copy in memory.
  const own = extractWatchHints(readFileSync(fileURLToPath(import.meta.url), 'utf8'));
  t(`this tool declares no population of its own${own.length ? ` — it names ${own.join(', ')}` : ''}`,
    own.length === 0);

  // Every verdict must be one of the three the docblock defines, and every
  // refusal must carry its measured reason — a bare verdict is the allowlist row
  // this file exists not to become.
  const VERDICTS = new Set(['DECLARED-NARROWER', 'REFUSE-WIDE', 'REFUSE-UNSPELLABLE']);
  t('every verdict is one of the three defined, and carries a stated reason',
    [...TRIAGE.values()].every((v) => VERDICTS.has(v.verdict) && typeof v.why === 'string' && v.why.length > 20));

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\nbare-root-worklist --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    `OK  self-test: ${rows.length} live row(s), ${open.length} unreachable as spelled, `
      + `${TRIAGE.size} recorded verdict(s) — none stale, none missing. The recogniser is proven `
      + 'to speak and to discriminate (a separator-carrying and a dotted root are both refused as '
      + 'already visible), the constant-name restriction is proven to restrict, and neither the '
      + 'triage keys nor this file declare any population of their own.',
  );
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else report({ wide: process.argv.includes('--wide') });
}
