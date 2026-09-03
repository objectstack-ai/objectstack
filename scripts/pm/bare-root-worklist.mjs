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
 *                      the root, and NO spelling of the idiom describes it. The
 *                      subtree idiom can only say "all of it", at the precision
 *                      quoted. This is the +139084 shape.
 *   SPELLABLE-UNDECLARED
 *                      a PRECISE live spelling of the population EXISTS, and the
 *                      declaration is deferred with the reason recorded. The row
 *                      stays in the sweep because the bare root is still not
 *                      covered. This verdict exists because the definitional
 *                      basis of the one above it moved: #12300 taught
 *                      `hintCovers` to MATCH a glob in a non-final segment
 *                      instead of collapsing it, so populations that genuinely
 *                      had no honest spelling in 2026-08 acquired one, and a
 *                      verdict NAMED "unspellable" describing them degraded from
 *                      "cannot be spelled" into "we chose not to spell it" —
 *                      the tolerance this repo refuses on the consumer side,
 *                      moved one level up. Maintainer ruling, 2026-08-26,
 *                      verbatim: 「同意」, splitting the class by MEASURED
 *                      downstream pull: rows with a recorded consumer get the
 *                      declaration (see the two DECLARED-NARROWER rows carrying
 *                      a `spelling`), rows without get this verdict.
 *                      ⛔ Every record MUST carry a `spelling` naming a
 *                      `SPELLINGS` entry, and `--self-test` MUST pin that
 *                      spelling's LIVENESS and PRECISION in `hintCovers`' own
 *                      terms. That pin is the whole licence for this value: an
 *                      unpinned vocabulary value is the allowlist rot #10840
 *                      refused by name, and the ruling rejects the option on it.
 *                      No pin, no verdict. The pin follows #12330's shape — the
 *                      mechanism a repaired row turns on, held mechanically,
 *                      rather than a prose scanner.
 *
 * ⚠️ The line between the last two is measured, not stylistic, and it runs
 * through PRECISION: a row is SPELLABLE-UNDECLARED only when a spelling exists
 * that covers the population and NOTHING ELSE. The three check:runner-env-posture
 * rows stay REFUSED with a live `packages/**\/src/**` spelling in hand precisely
 * because that spelling is 42% true — there is nothing there a precision pin
 * could hold, and recording "a precise spelling exists" would be the same lie
 * one value further along.
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
 * ⭐ RE-ADJUDICATED on 2026-08-26 (maintainer ruling on this file's own worklist,
 * verbatim 「同意」): seventeen rows carrying REFUSE-UNSPELLABLE were re-measured on
 * post-#12300 `main` and every one of those refusals was FALSE of the tree — a
 * precise, live, 100%-precise spelling existed for each. The map is SHRINK-ONLY
 * and this was a RE-DECISION, not a repair, which is why it needed a ruling: the
 * authorisation sentence granted there is that bringing a verdict back to truth
 * after its definitional basis moved is not loosening the map. ⛔ It authorises
 * nothing else — adding a row is still not a remedy for a stale one.
 *
 * Fifteen of the seventeen — the ones with no recorded downstream consumer —
 * became `SPELLABLE-UNDECLARED`, each pinned. The two with measured pull got
 * their spelling DECLARED in the gate's own source and their refusal withdrawn:
 * `check:skill-refs` (consumer #12310) and `check:objectql-double-limit`
 * (consumer #12322). Both landed as `DECLARED-NARROWER` rather than leaving the
 * map, because that verdict is defined for exactly this shape — the gate took
 * the escape, and the row STAYS in the sweep because the bare root is still not
 * covered. A withdrawn verdict that deleted the row would land it back as an
 * untriaged FRESH row on the next run, which is the assertion below saying so.
 *
 * ⭐ An EIGHTEENTH row was re-decided on 2026-08-29 under that same authorisation
 * sentence and no wider one: `check:where-matcher SCAN_ROOT packages`, whose refusal
 * rested on the identical retired collapse and whose population is the identical
 * `.test.ts` corpus as the `check:objectql-double-limit` row. It was left standing on
 * 2026-08-26 because it had no recorded consumer, which is the criterion that split that
 * class in two; #13163 is that consumer, and it is MEASURED rather than argued — the
 * derivation reached this gate for 0 of the test corpus, so a dev adding a
 * silently-wrong matcher ran a 30-of-30 green local union and lost a CI round anyway. So
 * this row takes the DECLARED-NARROWER half of the split rather than
 * SPELLABLE-UNDECLARED, and its gate now carries the declaration. ⛔ Its numbers are
 * re-measured on the 2026-08-29 tree and NOT carried from its sibling, which this
 * docblock forbids by name.
 *
 * ⭐ A NINETEENTH row was re-decided on 2026-09-01 under that same authorisation
 * sentence and no wider one: `check:ratchet-remedy-authority SCRIPTS_DIR scripts`.
 * Its refusal rested on the deletion-collapse too, in the variant that splices
 * WITHIN a final segment rather than across a separator — `scripts/*.mjs` became
 * `scripts/.mjs`, a string no tree can hold — so "the idiom has no non-recursive
 * spelling" was true of the derivation that wrote it and false of this one.
 * #13448 retired that collapse for the shape, which `dispatch-gates.mjs` states
 * in its own docblock as "the same defect as the non-final case one level
 * finer". So this is the identical retired mechanism, not a new licence, and it
 * is a RE-DECISION rather than a repair for the same reason the eighteen before
 * it were. Its consumer is #13813 and it is MEASURED: the family sat in the
 * residue's undetermined bucket, outside the matched list a brief prints, and a
 * PR that ran its whole derived family green locally lost a CI round to this
 * gate. ⛔ Its numbers are re-measured on the 2026-09-01 tree in BOTH terms and
 * NOT carried from the row they replace, which this docblock forbids by name.
 *
 * ⚠️ One row of that seventeen was re-measured into a DIFFERENT population, not
 * merely fresher digits: #12392 (PR #12423, `69d0e18`) made
 * `check-skills-token-ratchet`'s walk RECURSIVE over whole skill directories, so
 * the pre-merge reading of 11 of 50 described a filename filter the gate no
 * longer applies. Its numbers, its spelling AND its deferral reason are all new.
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
/**
 * The precise spellings the `SPELLABLE-UNDECLARED` and `DECLARED-NARROWER`
 * records below name, and the independent structural claim each one makes.
 *
 * ⚠️ Held as SEGMENT ARRAYS and joined at runtime, never spelled as a path
 * literal — the same rule the triage keys follow with their spaces, and the one
 * the `src`-segment pin below already obeys. A glob literal here would enter
 * this file's own hint set and hand a reporting tool a population it does not
 * read, which the self-test refuses in as many words.
 *
 * An entry's `segments` records either ONE hint (a flat array of path
 * segments, as above) or SEVERAL (a LIST of segment arrays) — #14233's
 * addition, for a gate whose declared population is spelled as more than one
 * glob (one hint per extension, or one per file kind at the same root). A
 * multi-hint entry's `hintCovers` reach is the UNION of its members, asked of
 * every hint in turn; its `holds` is written to accept whatever any member
 * covers, since the two-sided pin below (LIVE/PRECISE/COMPLETE/NARROWING)
 * still runs over that union. Every hint of a multi-hint entry is required to
 * share one root — the sweep below has exactly one denominator per entry, not
 * one per hint — and that is verified per entry when the row is written, not
 * pinned mechanically here (see the five rows #14233 added).
 *
 * `holds` is the spelling's claim written INDEPENDENTLY of `hintCovers` — a
 * plain segment test a reader can check by eye. It is not a copy of the matcher:
 * `hintCovers` reaches its answer through `globInNonFinalSegment`,
 * `zeroSegmentForms` and `triggerCovers`' regex over the whole string, so the
 * two can disagree, and the self-test asserting they do NOT is the pin. That is
 * what "precise in `hintCovers`' own terms" means here and it is the whole
 * reason a fourth verdict was allowed to exist: a vocabulary value recording
 * "a precise live spelling exists" whose spelling nothing re-measures is the
 * allowlist #10840 refused by name.
 *
 * ⛔ When a pin below reds, the answer is to RE-MEASURE the row and re-decide
 * its verdict — never to relax `holds` until it agrees again. `holds` is the
 * claim; the covered set is the tree; a divergence means the record stopped
 * describing the tree, which is the exact defect this file exists to catch.
 */
const SPELLINGS = new Map([
  ['packages manifests', {
    segments: ['packages', '**', 'package.json'],
    claim: 'every workspace manifest at any depth under the packages root',
    holds: (s) => s[0] === 'packages' && s.length >= 2 && s[s.length - 1] === 'package.json',
  }],
  ['apps manifests', {
    segments: ['apps', '**', 'package.json'],
    claim: 'every workspace manifest at any depth under the apps root',
    holds: (s) => s[0] === 'apps' && s.length >= 2 && s[s.length - 1] === 'package.json',
  }],
  ['examples manifests', {
    segments: ['examples', '**', 'package.json'],
    claim: 'every workspace manifest at any depth under the examples root',
    holds: (s) => s[0] === 'examples' && s.length >= 2 && s[s.length - 1] === 'package.json',
  }],
  ['i18n extract configs', {
    segments: ['packages', '**', 'scripts', 'i18n-extract.config.ts'],
    claim: 'the named extract config directly beneath a scripts segment, anywhere under packages',
    holds: (s) => s[0] === 'packages' && s.length >= 3
      && s[s.length - 1] === 'i18n-extract.config.ts' && s[s.length - 2] === 'scripts',
  }],
  ['example app configs', {
    segments: ['examples', '*', 'objectstack.config.ts'],
    claim: 'the named app config in each immediate child of the examples root',
    holds: (s) => s.length === 3 && s[0] === 'examples' && s[2] === 'objectstack.config.ts',
  }],
  ['published skill files', {
    segments: ['skills', '*', '**'],
    claim: 'every file inside a published skill directory, at any depth',
    holds: (s) => s[0] === 'skills' && s.length >= 3,
  }],
  ['skill entrypoints', {
    segments: ['skills', '*', 'SKILL.md'],
    claim: 'the SKILL.md in each immediate child of the skills root',
    holds: (s) => s.length === 3 && s[0] === 'skills' && s[2] === 'SKILL.md',
  }],
  ['package test files', {
    segments: ['packages', '**', '*.test.ts'],
    claim: 'every `.test.ts` file at any depth under the packages root',
    holds: (s) => s[0] === 'packages' && s.length >= 2 && s[s.length - 1].endsWith('.test.ts'),
  }],
  ['skill reference folders', {
    segments: ['skills', '*', 'references', '**'],
    claim: "every file inside a skill's references folder, at any depth",
    holds: (s) => s[0] === 'skills' && s.length >= 4 && s[2] === 'references',
  }],
  // ── Multi-hint entries (#14233) — a gate whose declared population is more
  // than one glob at the same root. `holds` accepts whatever any member hint
  // covers; see `hintsOf` and the pin loop below for how the union is asked.
  ['packages TypeScript source', {
    segments: [
      ['packages', '**', '*.ts'],
      ['packages', '**', '*.tsx'],
      ['packages', '**', '*.mts'],
    ],
    claim: 'every `.ts`, `.tsx` or `.mts` file at any depth under the packages root',
    holds: (s) => s[0] === 'packages' && s.length >= 2
      && ['.ts', '.tsx', '.mts'].some((ext) => s[s.length - 1].endsWith(ext)),
  }],
  ['examples TypeScript source', {
    segments: ['examples', '**', '*.ts'],
    claim: 'every `.ts` file at any depth under the examples root',
    holds: (s) => s[0] === 'examples' && s.length >= 2 && s[s.length - 1].endsWith('.ts'),
  }],
  ['apps TypeScript source', {
    segments: [
      ['apps', '**', '*.ts'],
      ['apps', '**', '*.tsx'],
    ],
    claim: 'every `.ts` or `.tsx` file at any depth under the apps root',
    holds: (s) => s[0] === 'apps' && s.length >= 2
      && ['.ts', '.tsx'].some((ext) => s[s.length - 1].endsWith(ext)),
  }],
  ['dual-build manifests and configs', {
    segments: [
      ['packages', '**', 'package.json'],
      ['packages', '**', 'tsup.config.ts'],
    ],
    claim: 'every workspace manifest or tsup config at any depth under the packages root',
    holds: (s) => s[0] === 'packages' && s.length >= 2
      && (s[s.length - 1] === 'package.json' || s[s.length - 1] === 'tsup.config.ts'),
  }],
  ['scripts top-level script files', {
    segments: [
      ['scripts', '*.mjs'],
      ['scripts', '*.mts'],
    ],
    claim: 'every `.mjs` or `.mts` file directly under the scripts root (non-recursive)',
    holds: (s) => s.length === 2 && s[0] === 'scripts'
      && (s[1].endsWith('.mjs') || s[1].endsWith('.mts')),
  }],
]);

/**
 * Normalises a `SPELLINGS` entry's `segments` to a LIST of segment arrays,
 * whether it records one hint (a flat array) or several (already a list) —
 * distinguished by whether the first element is itself an array. #14233.
 */
function hintsOf(segments) {
  return Array.isArray(segments[0]) ? segments : [segments];
}

/** The recorded spelling(s), assembled. Never a literal — see `SPELLINGS`. */
export function spellingOf(name) {
  const s = SPELLINGS.get(name);
  return s ? hintsOf(s.segments).map((seg) => seg.join('/')).join(' | ') : null;
}

const TRIAGE = new Map([
  // ── Taken: a strictly narrower subtree ────────────────────────────────────
  ['check:driver-conformance DRIVERS_DIR packages', {
    verdict: 'DECLARED-NARROWER',
    why: 'the literal is a join() component; the real population is the driver subtree, declared '
      + 'there at 259 of 291 files (89%) instead of 259 of 4903 (5.3%) at the bare root',
  }],
  ['check:logger-receiver-detach SCAN_ROOTS packages', {
    verdict: 'DECLARED-NARROWER',
    spelling: 'packages TypeScript source',
    why: 'the population is the non-test TypeScript source under the root, declared beside the '
      + 'constant at the three live extensions (4968 of 5485 tracked files, 90.6%) instead of '
      + 'the bare root. The remainder is manifests, JSON, markdown and fixtures the gate never '
      + 'opens, and the test files it deliberately does not read. #14233: the declared population '
      + 'needs three hints (`.ts`/`.tsx`/`.mts`), which the SPELLINGS harness could not hold before '
      + 'it grew a multi-hint entry — the union now pins the three declared hints LIVE, PRECISE and '
      + 'COMPLETE against a plain "ends with one of these extensions" claim (5240 of 5796 tracked '
      + 'files under the bare root, re-measured 2026-09-01 — a different, wider count than the '
      + "gate's own non-test figure above, since the pin holds the raw hints' literal reach and "
      + "the gate's own test-file exclusion is not something a hint can spell)",
  }],
  ['check:logger-receiver-detach SCAN_ROOTS examples', {
    verdict: 'DECLARED-NARROWER',
    spelling: 'examples TypeScript source',
    why: 'same declaration, same gate: the TypeScript source under the examples root, 204 of 241 '
      + 'tracked files (84.6%), rather than the bare word. The uncovered remainder carries no '
      + 'TypeScript for this gate to read. #14233: this root needs only the one hint the gate '
      + 'declares (`.ts`), now pinned LIVE, PRECISE and COMPLETE (206 of 243 tracked files under '
      + 'the bare root, re-measured 2026-09-01)',
  }],
  ['check:logger-receiver-detach SCAN_ROOTS apps', {
    verdict: 'DECLARED-NARROWER',
    spelling: 'apps TypeScript source',
    why: 'same declaration, same gate: 28 of 40 tracked files (70.0%) under the apps root, at the '
      + 'two extensions that exist there. The lowest ratio of the three and still a real '
      + 'narrowing — the uncovered dozen are config and content files, none of them TypeScript. '
      + '#14233: the two declared hints (`.ts`/`.tsx`) are now pinned as one multi-hint spelling, '
      + 'LIVE, PRECISE and COMPLETE (29 of 41 tracked files under the bare root, re-measured '
      + '2026-09-01)',
  }],
  ['check:objectql-double-limit SCAN_ROOT packages', {
    verdict: 'DECLARED-NARROWER',
    spelling: 'package test files',
    why: 'REFUSED as unspellable until 2026-08-26, and the refusal was FALSE of this tree: it '
      + 'rested on the reading that every glob form of the population collapses to a malformed '
      + 'double-separator prefix reaching 0 files. #12300 retired that collapse — a glob in a '
      + 'non-final segment is MATCHED now — so the recorded spelling is live and reaches 2755 of '
      + 'the 2755 `.test.ts` files the gate own testFilesUnder() walk admits, 100% precise and '
      + 'complete, re-measured on this tree. Declared beside SCAN_ROOT under the '
      + 'ROOT_DIR_WATCH_HINTS idiom, which is what #12310-class consumer #12322 asked for: before '
      + 'it, the derivation reached this gate for 0 of the test corpus and a dev adding a find '
      + 'double ran a green union with no local signal. The row STAYS in the sweep because the '
      + 'bare root is still not covered — the spelling reaches no arbitrary file at the top of '
      + 'the root — which is what this verdict says and is correct, not outstanding debt',
  }],
  ['check:where-matcher SCAN_ROOT packages', {
    verdict: 'DECLARED-NARROWER',
    spelling: 'package test files',
    why: 'REFUSED as unspellable on the reading that every glob form of this population '
      + 'collapses to a malformed double-separator prefix reaching nothing. #12300 retired that '
      + 'collapse — a glob in a non-final segment is MATCHED now — so the refusal was FALSE of '
      + 'this tree, in the same way and for the same reason as its identically-populated sibling '
      + 'check:objectql-double-limit above. Re-measured HERE rather than inherited from that row: '
      + 'the recorded spelling reaches 2889 of the 2889 files this gate own testFilesUnder() walk '
      + 'admits, SET-EQUAL in both directions — nothing walked left uncovered, nothing covered '
      + 'left unwalked — so 100% precise and complete, against 5509 tracked files under the bare '
      + 'root. Declared beside SCAN_ROOT under the ROOT_DIR_WATCH_HINTS idiom for consumer '
      + '#13163, the measured downstream pull this row lacked when the seventeen were '
      + 're-adjudicated: before it, extractWatchHints over the gate returned ONE hint, the gate '
      + 'own baseline JSON, so the derivation could name this gate only for a change set editing '
      + 'the files ALREADY KNOWN to be wrong and never for a NEW silently-wrong matcher — the '
      + 'inverse of what it guards, paid as a CI round trip by a PR that derived 30 of 30 green '
      + 'gates locally. The row STAYS in the sweep because the bare root is still not covered — '
      + 'the spelling reaches no arbitrary file at the top of the root — which is what this '
      + 'verdict says and is correct, not outstanding debt',
  }],
  ['check:skill-refs SKILLS_DIR skills', {
    verdict: 'DECLARED-NARROWER',
    spelling: 'skill reference folders',
    why: 'REFUSED as unspellable until 2026-08-26 on the grounds that collapseHint reduces the '
      + 'real population to a double slash no tree can hold (#12246). #12300 retired that '
      + 'collapse for this shape, so the recorded spelling is a live hint reaching 12 of the 12 '
      + 'tracked reference files — 100% precise and complete, and TRUE of what the gate does: '
      + 'build-skill-references.ts enumerates and prunes each skills/<name>/references/ wholesale '
      + 'through manageDir/ownsReferenceEntry, so it reads the folder entire and not merely the 9 '
      + '_index.md files it emits. Declared beside SKILLS_DIR under the ROOT_DIR_WATCH_HINTS '
      + 'idiom, for consumer #12310: the only literals the derivation could recover from that '
      + 'source were import specifiers and the emitted-surface string, which reached 9 of the 12 '
      + 'by accident and no card at all through the bare root. That generator carries no '
      + '--self-test to hold the declaration honest from its own side, so the coupling is held '
      + 'HERE, by the liveness and precision pins this record now carries — a declaration that '
      + 'can drift from the scan is worse than none. The row stays in the sweep: the bare root is '
      + 'still not covered',
  }],
  ['check:dual-build-cjs-loads SCAN_ROOT packages', {
    verdict: 'DECLARED-NARROWER',
    spelling: 'dual-build manifests and configs',
    why: 'the gate walks every publishable manifest under the root to find published `require` '
      + 'conditions, then reads only the dist/ those manifests point at — so the two literals it '
      + 'declares beside SCAN_ROOT under the ROOT_DIR_WATCH_HINTS idiom are the files whose '
      + 'CONTENT its verdict is a function of: packages/**/package.json at 74 tracked files '
      + '(1.0%) and packages/**/tsup.config.ts at 20 (0.3%), against 4903 under the bare root. '
      + 'A THIRD spelling was measured and REFUSED: #12971 arrived through a single source line, '
      + 'so packages/**/src/** has the best recall of the three, but it reaches 4482 files — '
      + '62.2% of the tracked tree, wider than the 39% rows refused below on exactly this trade — '
      + 'and the gate does not READ those files at all, which makes declaring them the costlier '
      + 'error this map names. The recall is not lost: the gate is a step in Build Core, a '
      + 'required context on every PR, so the omission costs one CI round trip rather than a '
      + 'missed defect. The row STAYS in the sweep because the bare root is still not covered — '
      + 'no arbitrary file at the top of packages/ is reached — which is what this verdict says. '
      + "#14233: the two declared hints could not be pinned before SPELLINGS held only one per "
      + 'entry; they are now one multi-hint spelling, LIVE, PRECISE and COMPLETE against the same '
      + '74/20 split, re-measured 2026-09-01 (94 of 5796 tracked files under the bare root)',
  }],
  ['check:ratchet-remedy-authority SCRIPTS_DIR scripts', {
    verdict: 'DECLARED-NARROWER',
    spelling: 'scripts top-level script files',
    why: 'RE-DECIDED 2026-09-01 (#13813) from REFUSE-UNSPELLABLE, whose stated reason — "the idiom '
      + 'has no non-recursive spelling" — was TRUE when written and is FALSE of this tree. It '
      + 'rested on the deletion-collapse: a glob carrying a literal SUFFIX in the final segment '
      + 'was spliced WITHIN the segment, so the only non-recursive spelling reduced to a string no '
      + 'tree can hold and reached nothing. #13448 retired that collapse for exactly this shape — '
      + 'judgedAsPattern routes it to triggerCovers now — which is the same retired collapse the '
      + 'seventeen rows of 2026-08-26 and the eighteenth of 2026-08-29 were re-decided under, one '
      + 'refinement finer, and this row is re-decided under that authorisation sentence and no '
      + 'wider one. Both terms re-measured together on this tree, never refreshed apart: the gate '
      + 'own corpusFiles() walk admits 183 files, against 310 tracked under the bare root (59%). '
      + 'The gate now declares ONE hint per admitted extension beside SCRIPTS_DIR under the '
      + 'ROOT_DIR_WATCH_HINTS idiom, and the pair is SET-EQUAL to that walk in both directions — '
      + '183 of 183, nothing read left uncovered, nothing covered left unread — so 100% precise '
      + 'and complete. The coupling described above was, at the time this row was decided, held '
      + "only in the gate's own --self-test (which pins the hints against SCRIPTS_DIR and "
      + 'CORPUS_EXTENSIONS and refuses both the subtree spelling and the brace form its own '
      + 'messages print), because SPELLINGS held ONE hint per entry and this population needs one '
      + 'per extension — the same shape as the check:logger-receiver-detach and '
      + 'check:dual-build-cjs-loads rows above, and the gap #14233 measured and closed: SPELLINGS '
      + 'now holds a LIST of segment arrays, so the pair is pinned HERE too, LIVE, PRECISE and '
      + 'COMPLETE (183 of 310 tracked files under the bare root, matching the gate own walk exactly, '
      + "re-measured 2026-09-01) — the gate's own pin and this one now independently corroborate "
      + 'the same declaration rather than only one of them re-measuring it. The consumer is '
      + 'MEASURED, not argued: before this, the derivation placed this family in the residue '
      + 'undetermined bucket, absent from the matched list a brief prints, and a PR that ran its '
      + 'whole derived family green locally lost a CI round to this gate. The row STAYS in the '
      + 'sweep because the bare root is still not covered — no arbitrary file at the top of the '
      + 'root is reached, and no nested script at any depth — which is what this verdict says and '
      + 'is correct, not outstanding debt',
  }],
  // ── Refused: the population is the whole root, and the root is saturated ──
  ['check:skill-identifier-liveness IMPL_ROOTS packages', {
    verdict: 'REFUSE-WIDE',
    why: 'the gate builds a WORD INDEX of the implementation tree and asks whether each identifier '
      + 'cited by a published skill row appears anywhere in it, so every source file under the '
      + 'root contributes and any one of them can be the only site keeping a citation live — '
      + '5405 of 5640 (96%), measured 2026-08-31; the 4% missed are non-source extensions and '
      + 'build output, not a subset a glob could name. The population is not a part of the root, '
      + 'it IS the root. A true declaration would name this gate on every card touching any '
      + 'package, which is the precision trade this verdict refuses — and the coupling it would '
      + 'buy is already carried by CI, which schedules this family on every PR (lint.yml has no '
      + 'paths filter, stated in the step comment for exactly this reason). Its OTHER root, '
      + 'skills, IS declared beside the constant: that one is small, is the surface the gate '
      + 'exists for, and naming a skills-only card is the discoverability this idiom is for',
  }],
  ['scripts/check-position-name-fold-loaders.mjs SCAN_ROOTS packages', {
    verdict: 'REFUSE-WIDE',
    why: 'every text file under the root is walked and any one of them could name the #13419 '
      + 'fixture — 5562 of 5625 (99%), measured 2026-08-31. The population is not a subset of the '
      + 'root that a narrower glob could describe; it IS the root. A true declaration here would '
      + 'name this gate on every card touching a package, which is the precision trade this '
      + 'verdict refuses',
  }],
  ['scripts/check-position-name-fold-loaders.mjs SCAN_ROOTS examples', {
    verdict: 'REFUSE-WIDE',
    why: '240 of 243 (99%). Refused with its packages half rather than split from it: the loader '
      + 'this gate hunts is a COMPOSITION site, and nothing says one lands under examples/ rather '
      + 'than packages/ — declaring only the small root would read as a claim about where that '
      + 'happens, which is exactly what is not known',
  }],
  ['scripts/check-position-name-fold-loaders.mjs SCAN_ROOTS apps', {
    verdict: 'REFUSE-WIDE',
    why: '36 of 40 (90%) — same trade, same reason as the examples half',
  }],
  ['scripts/check-position-name-fold-loaders.mjs SCAN_ROOTS scripts', {
    verdict: 'REFUSE-WIDE',
    why: '295 of 298 (99%). This root is where the gate own allowed readers live '
      + '(DECLARED_INSTRUMENTS), so it is walked wholesale for the same reason as the others: a '
      + 'new reader is found, then classified, never assumed absent',
  }],
  ['check:authz-resolver SCAN_ROOTS packages', {
    verdict: 'REFUSE-WIDE',
    why: 'walks every non-test TS source under the root — 1898 of 4903 (39%). True, and it would '
      + 'name this gate for every card in the repo that touches a package',
  }],
  ['check:dispatcher-error-vocabulary SCAN_ROOT packages', {
    verdict: 'REFUSE-WIDE',
    why: 'non-test sources plus manifests, 1898 of 4903 (39%) — same trade',
  }],
  ['check:swallow-census-controls SCAN_ROOT packages', {
    verdict: 'REFUSE-WIDE',
    why: 'FRESH on 2026-09-02, when #13919 wired the #12981 census own controls into CI for the '
      + 'first time; the constant is as old as the instrument and only the family is new. The '
      + 'census walk admits every non-test, non-declaration TypeScript source under the root at '
      + 'four extensions — 2193 of 5755 (38%), numerator from the instrument own printed scan '
      + 'count and denominator from git ls-files, both measured on this tree and NOT carried from '
      + 'the row above. Same class and nearly the same ratio as check:authz-resolver: the '
      + 'population is not a part of the root, it IS every source file in it, so a bare-root '
      + 'declaration would be TRUE and is refused for width alone — it would name this gate for '
      + 'every card in the repo that touches a package, and the coupling it would buy is already '
      + 'carried by CI, whose lint.yml job has no paths filter. ⚠️ What actually reddens the '
      + 'gated leg is narrower than the walk and is NOT a subtree either: ten named control files '
      + 'plus this instrument own source, and — through the zero-member floor alone — the corpus '
      + 'entire. A declaration naming the ten would be a hint the sweep judges FALSE of the walk, '
      + 'which is the costlier error this file prices by name',
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
  // ── Refused: the population is a filter the idiom cannot spell ────────────
  ['scripts/check-declaration-mirrors.mjs SCRIPTS_DIR scripts', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'a RECURSIVE walk admitted by EXTENSION — every `scripts/**/*.d.mts`, 2 of 261 (0.77%), '
      + 'read from the gate own mirrorFiles(). NOT the shape of the row above it, and measured '
      + 'here rather than inherited from it: mirrorFiles() descends into every nested directory '
      + 'and its own docblock says so. What cannot be spelled here is the EXTENSION filter, not a '
      + 'non-recursive walk — `scripts/**` is spellable and TRUE of this walk, and refused anyway '
      + 'because it would name this gate for 261 files to reach 2. Same class as the '
      + 'check:driver-conformance CASE_SETS_DIR row below, so lifting the row-above non-recursive '
      + 'limit would leave this one exactly as refused. ⚠️ Its former third neighbour, the '
      + 'check:skills-token-ratchet SKILLS_DIR row, LEFT this class on 2026-08-26 and is no '
      + 'longer the company it was cited as: #12392 made that walk recursive over whole skill '
      + 'directories, which is a subtree and not an extension filter',
  }],
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
  ['check:runner-env-posture SCANNED_ROOTS packages', {
    verdict: 'REFUSE-UNSPELLABLE',
    why: 'non-test source beneath a `src` SEGMENT — 1812 of 5241 (35%), re-derived from the gate '
      + 'own collectFiles() walk together with every number below, so the row holds ONE tree. What '
      + 'is unspellable here is the file-KIND filter, NOT the segment. Since #12300 a glob in a '
      + 'non-final segment is MATCHED rather than collapsed, so `packages/**/src/**` is a live '
      + 'hint that reaches all 1812 of them; the earlier reading that collapseHint reduced it to '
      + '`packages` described a collapse hintCovers no longer performs for this shape, and the '
      + 'refusal never rested on it. It covers 4291 tracked files to reach those 1812, and 2466 '
      + 'of the 2479 it over-names are the test files this gate deliberately skips — the one '
      + 'filter no glob idiom can spell. So the narrowest LIVE spelling is 42% true where the '
      + 'bare root is 35%: the segment buys seven points, not a precise claim, and both spellings '
      + 'are false about the same non-test filter. ⚠️ That is what keeps this row REFUSED rather '
      + 'than SPELLABLE-UNDECLARED, and it is the whole line between the two verdicts: this row '
      + 'has no 100%-precise spelling to record, so there is nothing here a liveness-and-precision '
      + 'pin could hold. Its nearest neighbour check:authz-resolver is REFUSE-WIDE at a similar '
      + '39% because ITS population really is every non-test source under the root, so the '
      + 'bare-root declaration there is TRUE and refused only for width; here the bare root is '
      + 'FALSE, and so is every narrower spelling the idiom offers',
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
  // ── Spellable, and the declaration deferred ───────────────────────────────
  //
  // Every row here was REFUSE-UNSPELLABLE until 2026-08-26 and every one of
  // those refusals was FALSE of this tree: #12300 retired the collapse they
  // rested on. What is recorded now is the measured spelling and the reason the
  // declaration is deferred, which is a different claim from "no honest
  // declaration exists" and the only one these rows can still make.
  ['check:i18n-coverage EXAMPLES_DIR examples', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'example app configs',
    why: 'one named config file per child directory — 3 of 241 tracked files under the root '
      + '(1.2%), re-measured 2026-08-26. The recorded spelling is live and reaches 3 of 3, 100% '
      + 'precise and complete. Deferred: no consumer has asked for this gate to be nameable, and '
      + 'the i18n family it belongs to would want one declaration per gate rather than one here',
  }],
  ['check:i18n-coverage PACKAGES_DIR packages', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'i18n extract configs',
    why: 'files named i18n-extract.config.ts beneath a scripts segment — 9 of 5275 (0.17%), '
      + 're-measured 2026-08-26. Its recorded reason USED to be that every glob spelling of the '
      + 'real population collapses to a malformed double-separator prefix matching NOTHING; '
      + '#12300 falsified that, and the spelling now reaches 9 of the 9 configs findExtractConfigs '
      + 'admits — 100% precise and complete. Deferred rather than declared: three gates reach this '
      + 'same population through the shared findExtractConfigs walk, so a declaration is a '
      + 'three-gate edit with no consumer asking for it, and the miss stays smaller than the row — '
      + 'the cards that can move a bundle already reach these gates through the convention trigger '
      + 'for a package owning an extract config',
  }],
  ['check:i18n PACKAGES_DIR packages', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'i18n extract configs',
    why: 'the same nine configs by the same filename-and-segment test as its check:i18n-coverage '
      + 'sibling above, so it is recorded with it rather than judged apart — 9 of 5275 (0.17%), '
      + 're-measured 2026-08-26 rather than inherited. Its old refusal cited the double-separator '
      + 'collapse #12300 retired; the spelling is live at 9 of 9, 100% precise. Deferred for the '
      + 'reason recorded above, and this gate additionally already reaches the cards that can '
      + 'actually move a bundle through the convention triggers (#11671), both verified live',
  }],
  ['check:i18n-stale-fill PACKAGES_DIR packages', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'i18n extract configs',
    why: 'the THIRD gate to reach its population through the shared findExtractConfigs walk — 9 '
      + 'of 5275 (0.17%), re-measured 2026-08-26 rather than inherited from its two siblings. The '
      + 'walk IS recursive across the root, which is not the question these verdicts ask: what it '
      + 'ADMITS is a filename-and-segment test, and since #12300 that test HAS a live spelling, '
      + 'reaching 9 of 9 at 100% precision — which is exactly what falsified the double-separator '
      + 'refusal this row used to carry. This gate additionally READS the committed bundle files, '
      + 'but it reaches those through each config docstring and its documented out flag, never '
      + 'through this walk, so they widen what it opens and not what this constant names. '
      + 'Deferred with its siblings',
  }],
  ['scripts/check-skills-token-ratchet.mjs SKILLS_DIR skills', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'published skill files',
    why: '⚠️ RE-MEASURED 2026-08-26 after #12392 (PR #12423, `69d0e18`) merged, and the row it '
      + 'replaces described a population this gate no longer has: discoverBundleFiles() now walks '
      + 'every published skill directory RECURSIVELY, so "one named file per child directory, 11 '
      + 'of 50" is stale in BOTH terms. The population is 49 files today, and the old '
      + 'one-SKILL.md-per-child spelling (the `skill entrypoints` row of SPELLINGS) reaches 11 '
      + 'of them, 22% — precise but 78% incomplete. ⚠️ Spelled by NAME and not as a path here, '
      + 'for the reason the triage keys carry spaces: a bare path spelling in this file enters '
      + 'its own hint set. The '
      + 'spelling recorded here is the recursive one, and it reaches 49 of 49: 100% precise AND '
      + 'complete, the walk being a subtree filter now rather than the filename filter the old '
      + 'refusal was written about. Deferred on the OTHER half of the trade, measured: those 49 '
      + 'files are 49 of the 50 tracked under the root, so declaring the precise spelling buys '
      + 'one file of discrimination over the bare root and restates "run the farm" for every '
      + 'skills card — the REFUSE-WIDE trade arriving at a row that is no longer unspellable. It '
      + 'also already reaches its own cards through the artifact roster it names file by file',
  }],
  ['check:skill-docs SKILLS_DIR skills', {
    verdict: 'DECLARED-NARROWER',
    spelling: 'skill entrypoints',
    why: 'RE-POINTED 2026-09-01 (#13519) from SPELLABLE-UNDECLARED, and the deferral it replaces '
      + 'is not merely overruled — its own premise stopped holding. That record read: the '
      + 'population is 12 of 50 (24%), the recorded spelling is 100% PRECISE and deliberately '
      + 'INCOMPLETE at 11 of the 12, "and the twelfth is skills/README.md, a file this generator '
      + 'WRITES and which sits outside any skill directory, so no single spelling of this idiom '
      + 'reaches both". That is a fact about ONE spelling. The gate now declares TWO literals '
      + 'beside its constants — the recorded spelling plus the root README it writes — reaching '
      + '12 of 12: 100% precise AND complete. ⛔ The row STAYS in the sweep, which is what this '
      + 'verdict commits to and not outstanding debt: the declaration is strictly narrower than '
      + 'the bare word, so the root remains uncovered at 12 of 50 and a card touching the other '
      + '38 files still derives nothing from it — correctly, because this gate opens none of '
      + 'them. ⛔ The wholesale spelling was measured and REFUSED on the way here: it names this '
      + 'gate for 38 files it never reads, which is the REFUSE-WIDE trade this file prices as '
      + 'the costlier error. ⛔ NOT re-pointed with its check-skills-token-ratchet neighbour '
      + 'above: that gate walks the same root RECURSIVELY at 49 of 50, where the precise '
      + 'spelling buys one file of discrimination and its deferral is untouched by this row',
  }],
  ['check:changeset-gate-self-tests PACKAGE_ROOTS packages', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'packages manifests',
    why: 'workspace manifests only — 74 of 5275 (1.4%), re-measured 2026-08-26. The recorded '
      + 'spelling is live and reaches 74 of 74, 100% precise and complete. Deferred: nine rows '
      + 'across three gates share this one population shape and no consumer has asked for any of '
      + 'them, so declaring here is a nine-edit expansion ahead of demand',
  }],
  ['check:changeset-gate-self-tests PACKAGE_ROOTS apps', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'apps manifests',
    why: 'workspace manifests only — 1 of 40 (2.5%), re-measured 2026-08-26; the spelling reaches '
      + '1 of 1, 100% precise and complete. Deferred with its packages half',
  }],
  ['check:changeset-gate-self-tests PACKAGE_ROOTS examples', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'examples manifests',
    why: 'workspace manifests only — 4 of 241 (1.7%), re-measured 2026-08-26; the spelling reaches '
      + '4 of 4, 100% precise and complete. Deferred with its packages half',
  }],
  ['scripts/check-adr-0087-registration.mjs PACKAGE_ROOTS packages', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'packages manifests',
    why: 'workspace manifests only — 74 of 5275 (1.4%), re-measured 2026-08-26 rather than '
      + 'inherited from the identically-shaped row above; the spelling reaches 74 of 74. Deferred '
      + 'for the reason recorded there',
  }],
  ['scripts/check-adr-0087-registration.mjs PACKAGE_ROOTS apps', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'apps manifests',
    why: 'workspace manifests only — 1 of 40 (2.5%), re-measured 2026-08-26; 1 of 1 covered',
  }],
  ['scripts/check-adr-0087-registration.mjs PACKAGE_ROOTS examples', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'examples manifests',
    why: 'workspace manifests only — 4 of 241 (1.7%), re-measured 2026-08-26; 4 of 4 covered',
  }],
  ['check:skill-compatibility PACKAGE_ROOTS packages', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'packages manifests',
    why: 'workspace manifests only — 74 of 5275 (1.4%), re-measured 2026-08-26; 74 of 74 covered. '
      + 'Refused BY NAME in that gate own self-test, beside the skills root it did declare — so '
      + 'this row records a deferral the gate itself already states, now with the spelling that '
      + 'deferral is about',
  }],
  ['check:skill-compatibility PACKAGE_ROOTS apps', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'apps manifests',
    why: 'workspace manifests only — 1 of 40 (2.5%), re-measured 2026-08-26; 1 of 1 covered',
  }],
  ['check:skill-compatibility PACKAGE_ROOTS examples', {
    verdict: 'SPELLABLE-UNDECLARED',
    spelling: 'examples manifests',
    why: 'workspace manifests only — 4 of 241 (1.7%), re-measured 2026-08-26; 4 of 4 covered',
  }],
]);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CENSUS_REFUSE_WIDE — REFUSE-WIDE rows #14325's WIDER census found, which
 * `sweep()` below can never discover (#14695)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `TRIAGE` above only ever holds a row `sweep()` can produce on the LIVE tree:
 * a `const X_ROOTS = ['packages']`-shaped bare literal, invisible to
 * `extractWatchHints` for the reason this file's own header explains
 * (`populationSpans` needs a `const`/`let`/`var` NAME matching
 * `POPULATION_CONSTANT` to even look for a bare word inside it). The rows
 * below are a DIFFERENT species, found by a WIDER instrument: #14325's
 * `--residue` + fs-trace census (#14131, PR #14323; the sitting that measured
 * these is PR #14692) walked every Silent family's ACTUAL file-open footprint
 * against the live corpus, independent of how — or whether — that family's
 * OWN source spells a root at all. Most of the twelve below hold no `const`
 * population literal anywhere in their source; where a bare `'packages'`
 * word exists (`check:route-envelope`, twice), it is a `join(ROOT,
 * 'packages')` CALL ARGUMENT, not an assignment `populationSpans` can find a
 * NAME for. Recording one of these as an ordinary `TRIAGE` row was tried and
 * self-reverts on this file's own `--self-test`: `sweep()` never produces the
 * key, so the row reads STALE the instant it lands — "a recorded verdict
 * outliving its row" — proven on this tree (the failing run is quoted in
 * #14695's dev report), not merely asserted. So these live in their OWN
 * table, pinned by their OWN battery below, coupled to nothing `sweep()`
 * derives — the shrink-only stale/fresh/contradicted machinery over `TRIAGE`
 * stays exactly as blind to this table as `sweep()` itself is.
 *
 * Every row states the SAME trade the REFUSE-WIDE verdict always states —
 * TRUE and refused for WIDTH, not for falsehood — at the SAME base commit,
 * `2aa8456cf`, #14325's own measurement used, so a share here is directly
 * comparable to a `TRIAGE` row's REFUSE-WIDE share above.
 *
 * ⚠️ Re-measured HERE rather than copied out of PR #14692's body: that body
 * (read in full, twice, before this table was written — the saved and the
 * live copy diff byte-for-byte but for a trailing newline) states an exact
 * figure for exactly ONE of these twelve, `check:route-envelope` (36.6%,
 * "2138 undeclared reads"); the other eleven are named with no percentage,
 * and the body's own bucket table states only the AGGREGATE "14 members,
 * 32–52%", never a per-member figure. #14695's own triage comment asserts
 * "Yours are at `2aa8456cf` by the card's own method" — true of the filing
 * session's own working notes, not of anything this dev session could read:
 * neither the issue, the PR body, nor its comments carry the other eleven
 * numbers. Carrying a share that isn't actually recorded anywhere reachable
 * would be exactly the "defect wearing fresher digits" this file's own
 * docblock prices as the costlier error, so each share below is INSTEAD
 * measured fresh, AT THE SAME BASE the filing named — never mixed with a
 * later tree — which this docblock's own rule reads as the honest resolution
 * between "carry the numbers" (impossible; they were never available here)
 * and "silently invent them" (refused by name, repeatedly, above).
 *
 * Method: `strace -f -e trace=openat` over that gate's own CLI entrypoint
 * (`node scripts/check-X.mjs`, its production leg, no flags), run against a
 * dedicated worktree checked out AT `2aa8456cf`, filtered to `openat` calls
 * that succeeded and landed on a tracked file under `packages/` (5837 tracked
 * files at that commit — the same denominator #14695's issue text states).
 * `openat` traces the SYSCALL, so it counts what the process actually opened
 * regardless of which Node API did the opening (`readFileSync`,
 * `execFileSync git ls-files`, the TypeScript parser) — this is the fs-trace
 * method #14325's own report names ("every enumerating candidate run under an
 * fs-tracing preload"), at the syscall layer rather than a JS-level shim. A
 * JS-level shim (monkey-patching `fs.readFileSync`/`fs.promises.readFile` via
 * `--import`) was tried FIRST and measured EMPTY — 0 reads recorded — against
 * `check:route-envelope`'s own known-nonzero population, because Node's ESM
 * binding for a core module's named export does not reliably re-resolve
 * through a later reassignment of the CJS-compat `fs` object's property; that
 * false-EMPTY run is why this is `strace`, not a patched `fs`, and it is
 * recorded here so the same dead end is not re-walked. `check:route-envelope`
 * traced at 2181 of 5837 tracked `packages/` files opened (37.4%) — within 2%
 * of PR #14692's cited 2138 "undeclared reads" (36.6%), the gap being that
 * figure's own subtraction of the handful of route paths this gate ALREADY
 * spells as literals elsewhere in its source (already visible to
 * `extractWatchHints`, hence "undeclared" excludes them) — corroborating this
 * method against the one stated figure available, without reproducing its
 * bookkeeping term for term.
 *
 * ⭐ All FOURTEEN members are recorded below (follow-up to this table's first
 * sitting, which shipped twelve — #14695's dev report at the time named the
 * remaining two as an open question, since the issue text's claim that they
 * were "named in PR #14692's body with their measured shares" did not hold
 * up against that body's actual text, which states only the aggregate row
 * above). The filing session (which ran the original census) supplied its
 * artifacts directly: `check:error-code-provenance` and
 * `check:objectui-pin-citations`, both `packages/spec`-scoped gates run via
 * `pnpm --filter @objectstack/spec run check:X`, sitting in that census's own
 * "root-wide, same class, no ledger row" bucket as members 13 and 14. Their
 * shares below are RE-MEASURED here by this table's own method (traced fresh
 * against the `2aa8456cf` worktree), not copied from the filing session's
 * numbers — the same "carry the base, never mix, measure rather than trust a
 * secondhand digit" discipline the twelve above already follow. The filing
 * session's own sitting-1 counts are cited in each row's `why` as a
 * cross-check, and both land within 1 file of this table's independent
 * measurement (2070 vs 2069, and an exact 1192 vs 1192) — corroborating the
 * method a second time, on a `tsx`-run gate rather than a plain `node` one.
 *
 * ⚠️ Six of the fourteen below measure OUTSIDE the issue's summarised
 * "32–52%" range for this bucket: FOUR above it (`check:driver-memory-census`
 * 91.7%, `check:parse-guard` 90.6%, `check:live-db-isolation` 90.3%,
 * `check:type-check-coverage`/`check:type-check-debt` 55.8%) and ONE below it
 * (`check:objectui-pin-citations`, 20.4% — recorded as measured, not forced
 * into the quoted band). Each is measured on this tree by the SAME method as
 * every other row here, and the ratio does not change the verdict either
 * direction — existing `TRIAGE` rows already span 39% (`check:authz-resolver`)
 * to 99% (`scripts/check-position-name-fold-loaders.mjs`) under the identical
 * REFUSE-WIDE trade, wide or narrow within that span is still the same
 * width-alone trade. Recorded as measured rather than clipped to the summary
 * range; the discrepancy against the issue's own "32–52%" framing is stated
 * in #14695's dev report for a maintainer to reconcile, not resolved by
 * quietly rounding the numbers to fit.
 *
 * `check:type-check-debt` shares its script (`check-type-check-coverage.mjs`)
 * and its file-population walk with `check:type-check-coverage`; its own
 * `--re-measure` mode could not be traced independently on this tree (exit 3,
 * PREREQUISITE NOT MET — it refuses to run without every ledgered package's
 * dependency closure built first, which this ledger-bookkeeping card does not
 * warrant building). The row below carries the SAME measured count as its
 * sibling for that reason, named explicitly rather than silently duplicated.
 */
export const CENSUS_REFUSE_WIDE = new Map([
  ['check:route-envelope packages', {
    verdict: 'REFUSE-WIDE',
    reads: 2181,
    of: 5837,
    base: '2aa8456cf',
    why: 'discoverHonoRoutes() parses every non-test file under packages/ (join(ROOT, \'packages\'), '
      + 'twice — the walk and the route-module read) looking for a written Hono context response; '
      + 'traced at 2181 of 5837 tracked files (37.4%). Same class as check:authz-resolver, recorded '
      + 'REFUSE-WIDE above at 39%: the population is not a subset of the root, it IS the root, so a '
      + 'declaration would be TRUE and is refused for the same width trade',
  }],
  ['check:driver-memory-census packages', {
    verdict: 'REFUSE-WIDE',
    reads: 5352,
    of: 5837,
    base: '2aa8456cf',
    why: 'candidateFiles() runs git ls-files over *.ts/*.tsx/*.mts/*.cts/package.json REPO-WIDE, with '
      + 'no root argument at all — traced at 5352 of 5837 tracked packages/ files (91.7%). The widest '
      + 'of the twelve: nearer the whole-tree class (check:skill-identifier-liveness, 96%) than the '
      + 'issue text\'s summarised 32–52%, and refused on the same width-alone ground either way',
  }],
  ['check:parse-guard packages', {
    verdict: 'REFUSE-WIDE',
    reads: 5289,
    of: 5837,
    base: '2aa8456cf',
    why: 'censusOutside() audits every source file under the root for a direct ts.createSourceFile / '
      + 'ts.createProgram call outside the two canonical entry points — traced at 5289 of 5837 (90.6%). '
      + 'A true declaration would name this gate on every card touching a package',
  }],
  ['check:live-db-isolation packages', {
    verdict: 'REFUSE-WIDE',
    reads: 5269,
    of: 5837,
    base: '2aa8456cf',
    why: 'traced at 5269 of 5837 tracked packages/ files (90.3%), the same whole-tree-adjacent class '
      + 'as check:driver-memory-census and check:parse-guard above',
  }],
  ['check:org-identifier packages', {
    verdict: 'REFUSE-WIDE',
    reads: 2211,
    of: 5837,
    base: '2aa8456cf',
    why: 'populationFiles() runs git ls-files over ROOTS = [\'examples\', \'apps\', \'packages\'] — '
      + 'traced at 2211 of 5837 tracked packages/ files (37.9%), the packages/ share of a walk that '
      + 'also names two other roots this row does not speak to',
  }],
  ['check:startup-registry-verdict packages', {
    verdict: 'REFUSE-WIDE',
    reads: 2182,
    of: 5837,
    base: '2aa8456cf',
    why: 'traced at 2182 of 5837 tracked packages/ files (37.4%) — the same non-test TypeScript-source '
      + 'count as check:wildcard-fallthrough, check:init-service-contract and '
      + 'check:settings-bind-window below, each walking the identical corpus',
  }],
  ['check:wildcard-fallthrough packages', {
    verdict: 'REFUSE-WIDE',
    reads: 2182,
    of: 5837,
    base: '2aa8456cf',
    why: 'walk(join(ROOT, \'packages\')) over non-test TypeScript source — traced at 2182 of 5837 '
      + '(37.4%), the same corpus as check:startup-registry-verdict above',
  }],
  ['check:init-service-contract packages', {
    verdict: 'REFUSE-WIDE',
    reads: 2182,
    of: 5837,
    base: '2aa8456cf',
    why: 'walk(join(ROOT, \'packages\')) over non-test TypeScript source — traced at 2182 of 5837 '
      + '(37.4%), the same corpus as check:startup-registry-verdict above',
  }],
  ['check:settings-bind-window packages', {
    verdict: 'REFUSE-WIDE',
    reads: 2182,
    of: 5837,
    base: '2aa8456cf',
    why: 'walk(join(ROOT, \'packages\')) over non-test TypeScript source — traced at 2182 of 5837 '
      + '(37.4%), the same corpus as check:startup-registry-verdict above',
  }],
  ['check:cli-command-ids packages', {
    verdict: 'REFUSE-WIDE',
    reads: 1951,
    of: 5837,
    base: '2aa8456cf',
    why: 'traced at 1951 of 5837 tracked packages/ files (33.4%) via a git ls-files-backed walk over '
      + 'the tracked corpus, the narrowest of the twelve and still the whole-root trade',
  }],
  ['check:type-check-coverage packages', {
    verdict: 'REFUSE-WIDE',
    reads: 3255,
    of: 5837,
    base: '2aa8456cf',
    why: 'tsc runs over every ledgered workspace package under the root plus its own DEBT/TEST_DEBT '
      + 'bookkeeping reads — traced at 3255 of 5837 tracked packages/ files (55.8%), narrowly above '
      + 'the issue text\'s summarised range and still the same width-alone trade',
  }],
  ['check:type-check-debt packages', {
    verdict: 'REFUSE-WIDE',
    reads: 3255,
    of: 5837,
    base: '2aa8456cf',
    why: 'shares its script and file-population walk with check:type-check-coverage above (only its '
      + '--re-measure flag differs); that mode could not be traced independently on this tree — exit '
      + '3, PREREQUISITE NOT MET, it refuses to run without every ledgered package\'s dependency '
      + 'closure built first — so this row carries the SAME traced count as its sibling, named rather '
      + 'than silently duplicated',
  }],
  ['check:error-code-provenance packages', {
    verdict: 'REFUSE-WIDE',
    reads: 2070,
    of: 5837,
    base: '2aa8456cf',
    why: 'packages/spec/scripts/check-error-code-provenance.ts scans every non-test .ts source under '
      + 'the (repo-root-relative) packages/ tree for a registered-code stamp site, run via `pnpm '
      + '--filter @objectstack/spec run check:error-code-provenance` — traced at 2070 of 5837 tracked '
      + 'packages/ files (35.5%), corroborated by the filing session\'s own sitting-1 census '
      + '(tracked_reads 2079, undeclared 2077, byRoot.packages 2069 — 1 file apart from this '
      + 'independent measurement). Squarely inside the issue\'s summarised 32–52% band. The gate '
      + 'declares 3 hints already (a comment-mask helper and its own ledger file, twice), none of them '
      + 'a subtree — a true packages/** declaration would name this gate for every card touching any '
      + 'package, the same width trade as every other row here',
  }],
  ['check:objectui-pin-citations packages', {
    verdict: 'REFUSE-WIDE',
    reads: 1192,
    of: 5837,
    base: '2aa8456cf',
    why: 'packages/spec/scripts/check-objectui-pin-citations.ts scans spec source for citations '
      + 'pinned against .objectui-sha, run via `pnpm --filter @objectstack/spec run '
      + 'check:objectui-pin-citations` — traced at 1192 of 5837 tracked packages/ files (20.4%), an '
      + 'EXACT match to the filing session\'s own sitting-1 census (tracked_reads 1200, undeclared '
      + '1200, byRoot.packages 1192). The narrowest of the fourteen, and BELOW the issue\'s summarised '
      + '32–52% band — recorded as measured rather than forced into the quoted range; the gate '
      + 'declares no hint at all today, and the population is still the whole non-test packages/ '
      + 'source tree it walks, so the width trade is unchanged by sitting below the band. The gap '
      + 'between the earlier report\'s "12 of 14, two unrecorded" and this row is closed here',
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

  console.log(
    `\n${CENSUS_REFUSE_WIDE.size} CENSUS row(s) — found by #14325's wider fs-trace census, not by `
      + 'the sweep above, and not coupled to it (#14695):',
  );
  for (const [key, row] of CENSUS_REFUSE_WIDE) {
    const pct = ((100 * row.reads) / row.of).toFixed(1);
    console.log(`  ${row.verdict.padEnd(19)} ${key}   (${row.reads} of ${row.of}, ${pct}%, base ${row.base})`);
    console.log(`  ${' '.repeat(19)}   ${row.why}`);
  }
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

  // CONTRADICTED: a refusal that outlived the reachability it refused. This is
  // the THIRD direction of the same coupling, and the one neither assertion
  // above can see, because both audit the KEY SET. A row whose gate later
  // declares its root is STILL A ROW, so its verdict is not stale; and it has
  // left `open`, so it is not fresh either. Both halves stay satisfied while
  // `report` prints REACHABLE directly above a recorded reason saying the
  // population cannot be spelled — one row asserting both that it is now
  // reachable and that it is not. This was PREDICTED in #11155's dev report and
  // then MEASURED on PR #12061, by declaring a hint on a gate carrying a
  // REFUSE-UNSPELLABLE verdict: the modified and unmodified trees both exited 0
  // here, which is why a green self-test could not be read as evidence.
  //
  // The pairing is general rather than restricted to the two refusals, because
  // EVERY verdict this file defines presupposes an UNCOVERED row: the refusals
  // say a declaration was refused, and DECLARED-NARROWER says in as many words
  // that the bare root is still not covered.
  //
  // ⛔ So the remedy is NOT "move the row to DECLARED-NARROWER". That is the
  // obvious repair, it is what the reporting card proposed, and it is wrong —
  // measured here rather than assumed. `covered` asks whether a hint reaches an
  // ARBITRARY file at the top of the root, so it turns true ONLY for the
  // spellings that collapse back to the bare word itself; every genuinely
  // narrower subtree, and every deeper segment filter, leaves the row uncovered.
  // A covered row is therefore the bare root wearing a separator or a glob,
  // which is the one thing DECLARED-NARROWER states it is not. No covered row
  // can honestly wear any of the three, and choosing between the two honest
  // resolutions RE-DECIDES a verdict on a shrink-only map — not something this
  // assertion may do quietly, so it names both and picks neither.
  const contradicted = rows
    .filter((r) => r.covered && TRIAGE.has(r.key))
    .map((r) => `${r.key} [recorded ${TRIAGE.get(r.key).verdict}]`)
    .sort();
  t(`no recorded verdict sits on a row the sweep now finds REACHABLE${contradicted.length
    ? ` — CONTRADICTED: ${contradicted.join(' · ')}. That gate now declares a hint reaching an `
      + 'arbitrary file at the top of the root, so the row claims BOTH that the population is '
      + 'reachable by declaration and, in its own recorded reason, that it is not. Two honest '
      + 'resolutions, differing in WHICH half is wrong. Withdraw the DECLARATION, if the recorded '
      + 'reason still holds and the hint names the gate for files it never opens — the usual '
      + 'answer under REFUSE-UNSPELLABLE, whose whole reason is that a wholesale hint would be '
      + 'FALSE, and the costlier error by the price hintCovers records. Or withdraw the VERDICT, '
      + 'if the declaration is deliberate and overrides the refusal, leaving the row to print '
      + 'REACHABLE with no reason beneath it: that is the shrink this map already permits, and the '
      + 'seven reachable rows carrying no verdict today are its live shape. ⛔ Do NOT re-point the '
      + 'row at DECLARED-NARROWER: that verdict is defined for a row that stays UNCOVERED, and a '
      + 'covered row is the bare root wearing a glob, not a narrower subtree.'
    : ''}`, contradicted.length === 0);

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

  // ── The RECORDED SPELLINGS, pinned: LIVENESS and PRECISION ────────────────
  //
  // The binding condition the SPELLABLE-UNDECLARED verdict exists under, and the
  // reason the maintainer's 2026-08-26 ruling could accept a fourth vocabulary
  // value at all: a value recording "a precise live spelling exists" whose
  // spelling nothing re-measures IS the allowlist #10840 refused by name. The
  // record would keep its prose while the tree moved out from under it —
  // exactly the failure that produced this whole card, one level further along.
  //
  // Pinned in `hintCovers`' OWN TERMS, following #12330's shape: not a scanner
  // over the `why` prose (refused there, for the reasons stated there), but the
  // MECHANISM each record depends on, asked of the live corpus. Three directions,
  // because each catches a different way a record can stop being true:
  //
  //   LIVE      the hint reaches at least one tracked file. A spelling that
  //             collapses to nothing is the dead-hint species #12246 was filed
  //             for, and the refusals these rows replaced were WRITTEN about it.
  //   PRECISE   every file `hintCovers` admits satisfies the spelling's own
  //             claim. This is the half that makes the verdict honest: without
  //             it the record says "precise" about a hint that over-names.
  //   COMPLETE  every file the claim names is reached. Without it a spelling
  //             could pass PRECISE by covering almost nothing.
  //
  // `holds` is written independently of `hintCovers` — a plain segment test —
  // so the two agreeing is EVIDENCE rather than a tautology: `hintCovers` routes
  // through globInNonFinalSegment, zeroSegmentForms and triggerCovers' regex,
  // and those genuinely can disagree with a segment walk (they do, on the
  // zero-segment forms of `**`). A divergence means the record stopped
  // describing the tree. ⛔ The remedy is to re-measure the ROW, never to relax
  // `holds` until it agrees again.
  const spellingRows = [...TRIAGE.entries()].filter(([, v]) => v.spelling);
  t('every SPELLABLE-UNDECLARED record names a spelling — the verdict is DEFINED only with one, '
    + 'and the ruling that created it rejects the whole option on an unpinned value',
    [...TRIAGE.values()].every((v) => v.verdict !== 'SPELLABLE-UNDECLARED' || Boolean(v.spelling)));
  t('every recorded spelling names a SPELLINGS entry',
    spellingRows.every(([, v]) => SPELLINGS.has(v.spelling)));
  t('the pins below judge something — at least one record carries a spelling',
    spellingRows.length > 0);
  const usedSpellings = new Set(spellingRows.map(([, v]) => v.spelling));
  t('no SPELLINGS entry sits unused — an entry no record names is the unread list this pin '
    + 'exists to prevent, arriving inside the pin itself',
    [...SPELLINGS.keys()].every((k) => usedSpellings.has(k)));

  for (const name of [...usedSpellings].sort()) {
    const { segments, claim, holds } = SPELLINGS.get(name);
    // A multi-hint entry's `hintCovers` reach is the UNION of its members —
    // asked of every hint in turn, never collapsed into one string first
    // (there is no glob idiom that would spell "either of these two globs").
    const hints = hintsOf(segments).map((s) => s.join('/'));
    const covered = files.filter((f) => hints.some((hint) => hintCovers(hint, f)));
    const over = covered.filter((f) => !holds(seg(f)));
    const claimed = files.filter((f) => holds(seg(f)));
    const under = claimed.filter((f) => !hints.some((hint) => hintCovers(hint, f)));
    const rootFiles = files.filter((f) => seg(f)[0] === hintsOf(segments)[0][0]);
    t(`the spelling recorded as "${name}" is LIVE — hintCovers reaches ${covered.length} tracked `
      + `file(s) with it, so no record below names a hint that covers nothing`, covered.length > 0);
    t(`…and it is PRECISE: every file hintCovers admits for "${name}" (${claim}) satisfies that `
      + `claim${over.length ? ` — OVER-NAMES ${over.length}: ${over.slice(0, 4).join(' · ')}. `
        + 'Re-measure the row and re-decide its verdict; do not widen the claim to match.' : ''}`,
      over.length === 0);
    t(`…and COMPLETE over its own claim: every one of the ${claimed.length} file(s) the claim `
      + `names is reached${under.length ? ` — MISSES ${under.length}: ${under.slice(0, 4).join(' · ')}` : ''}`,
      under.length === 0);
    t(`…and it is a real NARROWING rather than the bare root wearing a glob: it covers `
      + `${covered.length} of the ${rootFiles.length} tracked file(s) under its own root`,
      rootFiles.length > 0 && covered.length < rootFiles.length);
  }

  // Every verdict must be one of the four the docblock defines, and every one
  // must carry its measured reason — a bare verdict is the allowlist row this
  // file exists not to become.
  const VERDICTS = new Set([
    'DECLARED-NARROWER', 'REFUSE-WIDE', 'REFUSE-UNSPELLABLE', 'SPELLABLE-UNDECLARED',
  ]);
  t('every verdict is one of the four defined, and carries a stated reason',
    [...TRIAGE.values()].every((v) => VERDICTS.has(v.verdict) && typeof v.why === 'string' && v.why.length > 20));

  // ── CENSUS_REFUSE_WIDE, pinned on its OWN terms (#14695) ──────────────────
  //
  // This table is DELIBERATELY not audited by the stale/fresh/contradicted
  // triple above: `sweep()` cannot produce any of its keys (the docblock on
  // the table explains why), so asking whether `sweep()`'s output still
  // matches it is a question with no meaningful answer, not a question this
  // battery skips out of laziness. What CAN be held mechanically instead:
  // every row's own internal shape, and that this table never collides with
  // `TRIAGE`'s key space or contributes a population hint of its own.
  {
    const overlap = [...CENSUS_REFUSE_WIDE.keys()].filter((k) => TRIAGE.has(k)).sort();
    t(`no CENSUS_REFUSE_WIDE key collides with a TRIAGE key${overlap.length
      ? ` — COLLISION: ${overlap.join(' · ')}. The two tables must stay disjoint: a key in both is `
        + 'judged by two independent audits that can silently disagree.' : ''}`, overlap.length === 0);

    t('no CENSUS_REFUSE_WIDE key enters this file\'s own hint set as a path',
      [...CENSUS_REFUSE_WIDE.keys()].every((k) => asHints(k).length === 0));

    const shapeOk = [...CENSUS_REFUSE_WIDE.entries()].every(([k, v]) => (
      /^check:[\w-]+ packages$/.test(k)
      && v.verdict === 'REFUSE-WIDE'
      && Number.isInteger(v.reads) && v.reads > 0
      && Number.isInteger(v.of) && v.of > 0
      && v.reads <= v.of
      && typeof v.base === 'string' && /^[0-9a-f]{7,40}$/.test(v.base)
      && typeof v.why === 'string' && v.why.length > 20
    ));
    t('every CENSUS_REFUSE_WIDE row is well-formed: a `check:<name> packages` key, verdict '
      + 'REFUSE-WIDE, a positive integer read count no greater than its positive integer '
      + 'denominator, a base commit spelled as a short hex sha, and a stated reason over 20 chars',
      shapeOk);

    t('this table judges something', CENSUS_REFUSE_WIDE.size > 0);

    // Every row in this table was measured at the SAME base — mixing bases
    // silently is exactly what the table's own docblock refuses by name.
    const bases = new Set([...CENSUS_REFUSE_WIDE.values()].map((v) => v.base));
    t(`every CENSUS_REFUSE_WIDE row shares one base commit${bases.size > 1
      ? ` — MIXED: ${[...bases].join(' · ')}. Re-measure every row at one base, or name the base `
        + 'each row was actually measured at instead of one shared field.' : ''}`, bases.size === 1);
  }

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\nbare-root-worklist --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    `OK  self-test: ${rows.length} live row(s), ${open.length} unreachable as spelled, `
      + `${TRIAGE.size} recorded verdict(s) — none stale, none missing, none contradicted. `
      + `${spellingRows.length} record(s) carry a spelling and every one of ${usedSpellings.size} `
      + 'distinct spelling(s) is pinned LIVE, PRECISE and COMPLETE against the tracked corpus in '
      + "hintCovers' own terms. The recogniser is proven to speak and to discriminate (a "
      + 'separator-carrying and a dotted root are both refused as already visible), the '
      + 'constant-name restriction is proven to restrict, and neither the triage keys nor this '
      + `file declare any population of their own. ${CENSUS_REFUSE_WIDE.size} CENSUS row(s) `
      + '(#14695) are well-formed, disjoint from TRIAGE, contribute no hint of their own, and share '
      + 'one base commit.',
  );
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else report({ wide: process.argv.includes('--wide') });
}
