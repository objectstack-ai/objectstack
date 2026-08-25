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
 *
 * ⚠️ A row's numbers date from the pass that WROTE that row, and the tree grows
 * under all of them — so they are not comparable across rows, and a denominator
 * here that disagrees with today's `trackedFiles()` is a stale reading, not a
 * different population. The failure this warns against is the one that produced
 * the `check-declaration-mirrors` row: its `why` was copied from the row above
 * it and was wrong in BOTH terms (a recursive extension filter recorded as
 * top-level-only, 2 files recorded as 115), and `--self-test` cannot catch it —
 * it audits keys and verdicts, never what a `why` SAYS, which is correct, since
 * a prose assertion cannot be mechanised. Only re-measuring catches this class.
 * ⛔ So never carry a sibling's numbers into a new row, and ⛔ never refresh a
 * denominator alone: pairing today's denominator with an older numerator mints a
 * ratio nothing ever measured, which is this defect wearing fresher digits.
 *
 * Re-derived on 2026-08-25 from each gate's own exported walk, and current as of
 * that tree: the two `scripts` rows (`corpusFiles()`, `mirrorFiles()`) and the
 * three `check:runner-env-posture` rows (`collectFiles()`); the
 * `check:skills-token-ratchet` row re-measured unchanged at 11 of 50. Every
 * other row still carries the numbers from the pass that wrote it, because its
 * gate exports no walk to drive and reproducing the filter by hand would be the
 * estimate this docblock refuses.
 *
 * The `check:runner-env-posture SCANNED_ROOTS packages` row was then re-derived
 * AGAIN later the same day, after #12300 changed how `hintCovers` judges a glob
 * in a non-final segment and left that row's stated mechanism describing a
 * collapse the function no longer performs (#12289). Its whole `why` — ratio,
 * coverage and cost alike — is one reading of the tree at that later point,
 * which is why its denominator is larger than the two SCANNED_ROOTS siblings
 * recorded beside it. That is the drift this docblock permits and not the
 * mixed-terms defect it forbids: no term of that row was refreshed alone.
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
    why: 'reads the TOP LEVEL of the root only, and only two extensions (`.mjs` and `.mts`) — 144 '
      + 'of 261 (55%), re-derived from the gate own corpusFiles() walk. The idiom has no '
      + 'non-recursive spelling: a subtree hint claims every nested directory too',
  }],
  ['scripts/check-declaration-mirrors.mjs SCRIPTS_DIR scripts', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'a RECURSIVE walk admitted by EXTENSION — every `scripts/**/*.d.mts`, 2 of 261 (0.77%), '
      + 'read from the gate own mirrorFiles(). NOT the shape of the row above it, and measured '
      + 'here rather than inherited from it: mirrorFiles() descends into every nested directory '
      + 'and its own docblock says so. What cannot be spelled here is the EXTENSION filter, not a '
      + 'non-recursive walk — `scripts/**` is spellable and TRUE of this walk, and refused anyway '
      + 'because it would name this gate for 261 files to reach 2. Same class as the '
      + 'check:driver-conformance CASE_SETS_DIR and check:skills-token-ratchet SKILLS_DIR rows '
      + 'below, so lifting the row-above non-recursive limit would leave this one exactly as '
      + 'refused',
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
  ['check:objectql-double-limit SCAN_ROOT packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'test files only — the walk admits `*.test.ts` and nothing else, 2696 of 5161 (52%), the '
      + 'same file-KIND filter as its check:where-matcher and check:examples-live-imports '
      + 'neighbours above and refused alike. Measured rather than assumed, in both directions: the '
      + 'only spellable claim, `packages/**`, covers all 2696 test files AND all 2465 non-test '
      + 'files under the root, so it would name this gate for 2465 files it never opens — the '
      + 'costlier error, since a find double can only land in a test file. Nothing narrower is '
      + 'spellable: every glob form of the real population collapses to a malformed '
      + 'double-separator prefix (`packages/**/*.test.ts` -> `packages//.test.ts`) that hintCovers '
      + 'matches against 0 of 2696, so a narrow declaration would not be a precise hint but a live '
      + 'hint covering nothing. No narrower SUBTREE exists either — the corpus is spread over 28 '
      + 'second-level directories, and 274 of the 2696 sit outside any `src` segment, so even the '
      + 'check:runner-env-posture `src`-segment shape would be false here as well as uncollapsible',
  }],
  ['check:i18n-coverage EXAMPLES_DIR examples', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'one named config file per child directory — 3 of 238 (1.3%)',
  }],
  ['check:i18n-coverage PACKAGES_DIR packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'files named i18n-extract.config.ts beneath a scripts segment — 9 of 5035 (0.18%), the '
      + 'narrowest row on this list. Same filename-filter shape as its EXAMPLES_DIR sibling above, '
      + 'and refused with it rather than split: a subtree hint would name this gate for 5035 files '
      + 'to reach 9. The root was ALWAYS this invisible — it reached the sweep only once the fix '
      + 'for #10907 gave the literal a population-constant name, so this row records a population '
      + 'that was previously unnameable rather than one the fix introduced',
  }],
  ['check:i18n PACKAGES_DIR packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'files named i18n-extract.config.ts beneath a scripts segment — 9 of 5093 (0.18%), tying '
      + 'its check:i18n-coverage sibling above for the narrowest row on this list. The two gates '
      + 'select the same nine configs by the same filename-and-segment test, so they are refused '
      + 'alike: a subtree hint would name this gate for 5093 files to reach 9. Nothing narrower is '
      + 'spellable, measured rather than assumed — every glob spelling of the real population '
      + 'collapses to a malformed double-separator prefix that hintCovers matches against NOTHING, '
      + 'so a narrow declaration would not be a precise hint but a live hint covering zero files. '
      + 'The miss is also smaller than the row: this gate already reaches the cards that can '
      + 'actually move a bundle through the convention triggers (a package that owns an extract '
      + 'config, and a metadata form module), both verified live, and a wholesale root declaration '
      + 'would drown that precision rather than add to it. The root reached the sweep only once the '
      + 'fix for #11647 gave the literal a population-constant name, so this row records a '
      + 'population that was previously unnameable rather than one the fix introduced',
  }],
  ['check:i18n-stale-fill PACKAGES_DIR packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'the THIRD gate on this list to reach its population through the shared '
      + 'findExtractConfigs walk, so it is refused with the two above rather than judged apart — '
      + 'files named i18n-extract.config.ts beneath a scripts segment, 9 of 5185 (0.17%). The walk '
      + 'IS recursive across the root, which is not the question these verdicts ask: what it '
      + 'ADMITS is a filename-and-segment test, and that is the unspellable shape. Re-measured '
      + 'here rather than inherited from the sibling rows — both star spellings of the real '
      + 'population collapse to the same malformed double-separator prefix, which hintCovers was '
      + 'checked against a real config path and matched NOTHING, while the only spellings that '
      + 'cover anything collapse to the bare root. So the choice is a live hint over zero files or '
      + 'a hint over 5185 files to reach 9. This gate additionally READS the 40 committed bundle '
      + 'files, but it reaches those through each config docstring and its documented out flag, '
      + 'never through this walk, so they widen what it opens and not what this constant names. '
      + 'The miss is smaller than the row for the same reason its siblings record: the cards that '
      + 'can actually strand a leaf reach this gate through the convention trigger for a package '
      + 'owning an extract config, which #11671 extended to name this gate alongside check:i18n',
  }],
  ['scripts/check-skills-token-ratchet.mjs SKILLS_DIR skills', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'one named file per child directory, 11 of 50 (22%). It already reaches its own cards '
      + 'through the artifact roster it names file by file, so the miss is smaller than the row',
  }],
  ['check:skill-docs SKILLS_DIR skills', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'one named file per child directory plus the root README — 12 of 50 (24%). '
      + 'build-skill-docs.ts:221 readdirSync-es the bare root and reconciles the listing against '
      + 'DISPLAY in both directions (:227-228), so a new or removed objectstack-*/SKILL.md moves '
      + 'the verdict and no fixed list can name it; but :222 admits a child only if it CARRIES '
      + 'SKILL.md, so the population is that filename filter, not the root. Recorded to match the '
      + 'check-skills-token-ratchet row above, which reads the SAME root the same way at the same '
      + 'scale — one root answered one way',
  }],
  ['check:skill-refs SKILLS_DIR skills', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'a named subdirectory per child, enumerated and pruned wholesale — 12 of 50 (24%), 9 of '
      + 'them the _index.md it emits. It never reads the bare root: build-skill-references.ts:304 '
      + 'iterates the authored SKILL_MAP (:43-127), resolves skills/<name>/, and manages '
      + 'skills/<name>/references/ via manageDir/ownsReferenceEntry (:288-294). The true population '
      + 'is skills/*/references/**, which collapseHint reduces to skills//references/** — a double '
      + 'slash no tree can hold (#12246) — so the only spellable claim left is the bare root',
  }],
  ['check:runner-env-posture SCANNED_ROOTS packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'non-test source beneath a `src` SEGMENT — 1812 of 5240 (35%), re-derived from the gate '
      + 'own collectFiles() walk together with every number below, so the row holds ONE tree. What '
      + 'is unspellable here is the file-KIND filter, NOT the segment. Since #12300 a glob in a '
      + 'non-final segment is MATCHED rather than collapsed, so `packages/**/src/**` is a live '
      + 'hint that reaches all 1812 of them; the earlier reading that collapseHint reduced it to '
      + '`packages` described a collapse hintCovers no longer performs for this shape, and the '
      + 'refusal never rested on it. It covers 4290 tracked files to reach those 1812, and 2465 '
      + 'of the 2478 it over-names are the test files this gate deliberately skips — the one '
      + 'filter no glob idiom can spell. So the narrowest LIVE spelling is 42% true where the '
      + 'bare root is 35%: the segment buys seven points, not a precise claim, and both spellings '
      + 'are false about the same non-test filter. Its nearest neighbour check:authz-resolver is '
      + 'REFUSE-WIDE at a similar 39% because ITS population really is every non-test source '
      + 'under the root, so the bare-root declaration there is TRUE and refused only for width; '
      + 'here the bare root is FALSE, and so is every narrower spelling the idiom offers',
  }],
  ['check:runner-env-posture SCANNED_ROOTS examples', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: '150 of 241 (62%), the same `src`-segment filter, refused with its packages half rather '
      + 'than split: declaring the smaller root would name the gate on example cards and stay '
      + 'silent on the package cards where product source actually lives',
  }],
  ['check:runner-env-posture SCANNED_ROOTS apps', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'MEASURED AT ZERO — 0 of 35. No `src` tree exists under this root today, so a subtree '
      + 'declaration here would not be imprecise but false: it would paste this gate into every '
      + 'apps card to reach nothing. The root stays in SCANNED_ROOTS deliberately, so an apps '
      + 'package that grows a src tree is covered the day it lands rather than the day someone '
      + 'remembers — which is the same silent-coverage-loss this gate exists to prevent',
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

  // ── The MECHANISM a repaired reason turns on, held mechanically ───────────
  //
  // A `why` is prose this tool never reads, so a recorded verdict can keep its
  // key, its reachability and its verdict while the DERIVATION moves out from
  // under the reason it states. #12300 did exactly that: it taught `hintCovers`
  // to MATCH a glob in a non-final segment instead of collapsing it, and every
  // row that refused on the grounds "the narrow spelling collapses to a double
  // separator and reaches nothing" was left describing a defect the tree no
  // longer has — silently, with this self-test green, because it audits keys and
  // verdicts and never what a `why` SAYS. The rows that still cite that collapse
  // are recorded in #12289 and deliberately left standing here: their reasons
  // died with the defect, so what they need is a re-decided VERDICT, which is
  // not something this file may change quietly under cover of a prose fix.
  //
  // ⛔ Deliberately NOT a prose scanner. Lifting the quoted values out of `why`
  // and re-running `collapseHint` over them was considered and refused twice
  // over: it wants a parser over English inside a governance tool, and it would
  // check the WRONG function — these reasons are REACHABILITY claims, which
  // `hintCovers` decides, so a collapseHint-equality check stays GREEN through
  // the very change that falsifies them. What is pinned instead is the DIRECTION
  // the repaired row depends on, in the terms `hintCovers` judges by. Segments
  // are joined rather than spelled, for the same reason the probes above take
  // their root from the tree: a glob literal here would hand this file a
  // population of its own.
  const PKG = 'packages';
  const seg = (f) => f.split('/');
  const underPkg = files.filter((f) => seg(f)[0] === PKG);
  const isTestPath = (f) => seg(f).pop().split('.').includes('test');
  const srcSegmentGlob = [PKG, '**', 'src', '**'].join('/');
  const srcSegmentHit = files.filter((f) => hintCovers(srcSegmentGlob, f));
  t('the check:runner-env-posture packages reason holds: its `src`-segment spelling is a LIVE '
    + 'hint, not the dead collapse that row used to cite', srcSegmentHit.length > 0);
  t('…and it is a real NARROWING rather than the bare root wearing a glob',
    underPkg.length > 0 && srcSegmentHit.length < underPkg.length);
  t('…and the segment is genuinely matched, not waved through: no packages file outside a '
    + '`src` segment is covered',
    underPkg.some((f) => !seg(f).includes('src'))
      && !srcSegmentHit.some((f) => !seg(f).includes('src')));
  t('…and it still OVER-NAMES the file kind the gate skips, which is what keeps the row '
    + 'REFUSED rather than declarable — the half of the reason a live hint does not settle',
    srcSegmentHit.some(isTestPath));

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
