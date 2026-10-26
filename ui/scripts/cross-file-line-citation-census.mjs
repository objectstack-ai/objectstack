#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Cross-file line-address citation census (objectui#8875).
 *
 * ## What this answers, and what it deliberately does not
 *
 * objectui#7853 ruled the class -- CITE THE ASSERTION BY CONTENT, NOT BY LINE
 * ADDRESS. objectui#8047 mechanized it as the `no-line-address-in-test-name`
 * ESLint rule, but for TEST NAMES only; it carves out comments and failure
 * messages on the stated reasoning that "a human reads them beside the code
 * they annotate". objectui#8875 observes that the justification holds for a
 * SAME-FILE citation and does not hold for a CROSS-FILE one: the reader of
 * `packages/types/src/crud.ts` is not looking at
 * `packages/core/src/actions/ActionRunner.ts`, nothing puts the cited line in
 * front of them, and nothing tells them it moved.
 *
 * That card rules on nothing. It names three possible directions -- extend the
 * ESLint rule to comments and message strings, add a report-only census, or
 * rule the form out and repair on sight -- and says the choice "needs the
 * tree-wide population that has NOT been measured".
 *
 * THIS SCRIPT IS THAT MEASUREMENT AND NOTHING ELSE. It prints a number. It
 * repairs nothing, it is not wired into CI, and it takes no position on which
 * of the three directions the number favours. Deciding that is objectui#8875's
 * next step and is reserved to it.
 *
 * ## Why a `census:*` script and not a `check:*` gate
 *
 * The form follows this tree's own convention, and the convention is load
 * bearing rather than cosmetic. Two `census:*` scripts already exist
 * (`census:body-dialect`, `census:tsconfig-test-parity`); measured on this
 * tree, `census:body-dialect` appears in NO file under `.github/workflows/`
 * while the control `check:entry-guard` resolves to `lint.yml`. So `census:*`
 * is the spelling that already means "runnable, reported, not blocking", and
 * choosing it is how this change stays report-only WITHOUT a reader having to
 * take that on trust. A `check:*` name would invite the next sweep to wire it
 * into a workflow, which objectui#8875 explicitly reserved.
 *
 * It also keeps a second obligation out of the way: objectui#3653 pins
 * `content/docs/guide/ci-cd-pipeline.md`'s table BY COMMAND, so a CI step here
 * would owe a matching documentation row for a gate nobody has decided to have.
 *
 * ## What counts as a citation -- five syntaxes, and why each is here
 *
 * objectui#8875 measured four spellings in PR #8867's blast radius and named a
 * fifth that no basename-anchored probe can see. All five are read here,
 * because the card's own evidence is that a single-syntax probe under-reads
 * this class by construction -- the filing seat's first probe was `path:line`
 * only and missed a `#L` permalink among its own 73 hits.
 *
 *   1. `name.ext:NNN`      -- the dominant spelling. The name may carry
 *                            directories (`packages/core/src/x.ts:12`) or be a
 *                            bare basename (`ActionRunner.ts:112`).
 *   2. `name.ext#LNNN`     -- the GitHub permalink form, including inside a
 *                            full `https://github.com/...` URL, where suffix
 *                            resolution below strips the `blob/<ref>/` prefix.
 *   3. `line NNN of/in/at NAME` -- the address written before the name.
 *   4. `NAME line NNN`     -- the address written after the name.
 *   5. THE CONTINUATION ADDRESS -- a bare `:NNN` or `#LNNN` carrying NO
 *      filename, inheriting the file from whatever put one in scope nearby.
 *      `packages/types/src/crud.ts` writes
 *      `` `ActionRunner.ts:1788` and `:1794` ``; a `basename:[0-9]+` probe
 *      cannot match the second one. The card caught it only because a human
 *      read the site the probe did hit. It is the syntax most likely to be
 *      missed and the reason a count from a one-syntax probe is not a census.
 *
 *      ⚠️ SCOPE OPENS TWO WAYS, and until objectui#9026 only the first was
 *      read: a full `NAME:NNN`, and -- the one that was missing -- a bare
 *      FILENAME with no address of its own, as in "`` `…/ObjectKanban.tsx` ``
 *      reads `schema.groupBy` at" followed by `` `:601`, `:625`, `:640` ``.
 *      That second form is what `ObjectKanbanSchema.groupBy` used for six
 *      addresses that had ALL rotted, and this file scored the docblock zero.
 *      ⇒ It was not report-only about that class, it was SILENT on it, which
 *      is worse: a reader who knows the number is report-only still reads a
 *      clean sheet as nothing new to look at.
 *
 *      ⛔ WHAT THIS SYNTAX STILL DOES NOT COVER, stated so it cannot be cited
 *      as coverage it does not have. TWO rules end scope and they do ⛔ NOT
 *      cover the same ground -- reading them as one mechanism is the defect
 *      objectui#9216 found here. DISTANCE (`CONT_WINDOW`) applies everywhere.
 *      The blank-line break in `carryScope` applies ONLY where a separator line
 *      really is empty, so it holds in Markdown prose and is INERT inside a
 *      block comment: a JSDoc separator trims to `*`, ⛔ never to the empty
 *      string.
 *
 *      ⇒ an address restated further down with no filename near it is NOT
 *      read, and inside a block comment DISTANCE ALONE is the reason. The
 *      docblock above is read five of six on distance; the fixture that pins it
 *      contains no line that trims to empty, so ⛔ the paragraph break must not
 *      be credited for that sixth. Both facts -- the inertness and its firing
 *      control, and the blind sixth -- are pinned by name in this file's test.
 *
 * The extension list (`SOURCE_EXT`) is what makes `NAME.ext:NNN` a SOURCE
 * ADDRESS rather than a coincidence, and it is copied in spirit from
 * `eslint-rules/no-line-address-in-test-name.js` so the two instruments agree
 * on what an address is: a version number (`1.2.3`) has no `:`, a clock time
 * (`12:30`) has no extension, and a host:port (`example.com:3000`) is excluded
 * because `com` is not in the list.
 *
 * ## What is carved out, and why the carve-outs are printed rather than hidden
 *
 * RELEASED CHANGELOG SECTIONS. `packages/plugin-form/CHANGELOG.md`'s hits sit
 * under the released heading `## 17.6.0`. A changelog entry is a DATED RECORD
 * OF WHAT WAS TRUE AT THAT RELEASE, regenerated from changesets -- re-addressing
 * it to today's tree would make it false AS HISTORY. So every line at or after
 * a `CHANGELOG.md`'s first released-version heading is excluded. Anything ABOVE
 * that heading is not yet a dated record and stays in the population.
 *
 * THIS SCRIPT AND ITS TEST. Both carry addresses as FIXTURE DATA -- including
 * the two controls below -- so counting them would be the instrument reading
 * itself.
 *
 * AN ADDRESS THE CITING FILE DECLARES AS FIXTURE DATA (objectui#9865). The
 * carve-out above is right about WHY and wrong about HOW FAR: "carries
 * addresses as fixture data" is a property of many instruments in this tree,
 * and `SELF_FILES` names four files. objectui#9865 read every false citation
 * under `scripts/`, `scripts/__tests__/`, `scripts/pm/` and `eslint-rules/` and
 * found that a substantial minority are not pointers at all -- they are
 * addresses standing in as DATA: a RuleTester `code:` string, a self-test
 * fixture, a control body a differ must judge, a path in a synthetic fixture
 * tree, a quoted build-log transcript. Repairing them is at best churn and at
 * worst breaks the assertion that reads them.
 *
 * ⛔ THE SHARE IS NOT WRITTEN DOWN HERE, per AGENTS.md #9 and for the reason
 * `CONT_WINDOW` gives below: a figure in a comment is derived once and never
 * re-checked. Re-derive it -- `--json --list-false`, group `rows` by `bucket`,
 * and read each citing site -- and ⛔ do not reason from any number this
 * docblock hands you.
 *
 * ⛔ The answer is ⛔ NOT more names in `SELF_FILES`: a by-name list over a
 * property that holds of many files is the same drift one level up, and it
 * carves out WHOLE FILES when what is fixture data is ONE ADDRESS inside them.
 * So the class is DECLARED, per address, by the citing file itself, in the
 * window around the address -- `fixture-address: <reason>`. The declaration
 * travels with the fixture, a reader meets it beside the thing it describes,
 * and nothing has to remember to extend a list.
 *
 * ⚠️ ITS DIRECTION OF ERROR, stated rather than hidden. A declaration can
 * silence a genuinely rotted pointer, and this census cannot tell that from the
 * outside -- which is exactly why every declared address is PRINTED with the
 * reason it gives and the line that gives it. An unaudited mute button and an
 * audited one differ only in whether the output names what it dropped. And a
 * declaration with no reason is a mute button, so a bare marker does ⛔ not fire.
 *
 * ⛔ The reach is TEXT, ⛔ not syntax: this file reads no AST anywhere, so a
 * marker inside a string literal declares just as one inside a comment does.
 * ⚠️ And the window covers a NEIGHBOURING address within `DECLARATION_WINDOW`
 * lines, which is what a block of fixture rows needs and is also how one
 * declaration can reach an address its author did not mean. Both are visible
 * in the printed list; neither is inferred.
 *
 * Every carve-out here is COUNTED AND PRINTED, never silently dropped. A
 * carve-out whose size is not reported is indistinguishable from a scanner that
 * cannot see the file at all, and this card's whole subject is a zero nobody
 * audited.
 *
 * ⚠️ PENDING CHANGESETS ARE NOT CARVED OUT, and that is a judgement this census
 * declines to make FOR the reader rather than one it has taken. `.changeset/*.md`
 * is the largest single directory in the population. A pending changeset is the
 * SOURCE of a future dated changelog entry, so the released-changelog argument
 * arguably reaches it -- but it is not dated yet, it is still editable, and
 * objectui#8875 carved out released sections only. So the rows stay in, and the
 * `.changeset` line of the by-directory table is what lets anyone who disagrees
 * subtract them without re-running anything.
 *
 * SAME-FILE citations are excluded from the population, counted separately.
 * objectui#8047's carve-out reasoning -- "a human reads them beside the code
 * they annotate" -- is exactly what still holds there, and objectui#8875
 * questions only the cross-file case.
 *
 * ## TEST NAMES are out of scope, and the split is measured rather than assumed
 *
 * objectui#8047's rule owns citations that reach a test name and runs at
 * `error` in `eslint.config.js`, so that sub-population is kept at zero by lint
 * rather than by this script. This census does not re-implement the rule's AST
 * reading. Instead every hit is CLASSIFIED with a cheap line-anchored heuristic
 * (`in_test_name`) and the count is printed: if the ESLint rule is doing its
 * job that number is zero, and if it ever is not, the census says so instead of
 * quietly overlapping. Hits inside test FILES that are not test NAMES stay in
 * the population on purpose -- objectui#8875's own site list contains two
 * (`action-forward-parity.test.tsx:156`, `action-forward-precedence.test.tsx:139`).
 *
 * ## How a citation is judged FALSE -- and why "moved" is not the question
 *
 * objectui#8875's central reading is that 10 of the 14 references a PR's line
 * shifts moved were ALREADY FALSE before that branch existed. So movement is
 * necessary but not sufficient, and this census never asks whether a diff
 * shifted an address. It asks only what is AT THE CITED LINE TODAY.
 *
 * Four verdicts, in the order they are decided:
 *
 *   `out-of-range`    the cited line is past the end of the cited file.
 *                     Mechanically certain. FALSE.
 *   `non-substantive` the cited line is blank or carries nothing but
 *                     delimiters -- a docblock's closing star-slash, a bare
 *                     `});`, a `---` rule. A citation whose target
 *                     is a closing brace is rot; this is the shape the card's
 *                     own off-by-one control has. FALSE.
 *   `drifted`         the cited line carries none of the citation's own
 *                     content anchors, but at least one of them IS somewhere
 *                     else in the cited file. The census reports where. FALSE.
 *   `resolves`        at least one content anchor is on the cited line.
 *
 * plus three UNJUDGED outcomes that are reported separately and never folded
 * into the false count: `no-anchor` (the citing prose offered nothing to match
 * on), `anchor-absent` (the anchors appear nowhere in the cited file, so the
 * prose is probably not naming a symbol) and the two resolution failures
 * `no-such-file` / `ambiguous-basename`.
 *
 * The two resolution failures are findings in their own right and are the reason
 * they are named rather than merged. `no-such-file` is dominated by citations
 * into BUILD ARTIFACTS -- `packages/types/dist/overlay.d.ts:334`, `form.d.ts:1376`
 * -- which are untracked, regenerated, and cannot be checked by anything ever.
 * `ambiguous-basename` is a BARE BASENAME (`index.ts:255`, `ObjectView.tsx:37`)
 * that names several tracked files at once, so no instrument can decide which
 * one it meant. Neither is counted false, because neither has been shown wrong;
 * both are counted as citations no reader and no tool can resolve.
 *
 * CONTENT ANCHORS come only from places where this tree writes code rather than
 * English: backticked spans, quoted strings, and bare camelCase/PascalCase
 * identifiers, inside a +/-2 line window around the citation. Atoms belonging to
 * the cited path itself are dropped -- a file's own name appears on its own
 * lines, and matching that would score every citation `resolves`. There is no
 * English stopword list anywhere in here, deliberately: a stopword list is a
 * second thing to keep honest, and the three anchor sources are already
 * code-shaped by construction.
 *
 * ⚠️ The judged verdicts are a HEURISTIC over prose, and the direction of each
 * error is worth stating. A spuriously matched anchor scores `resolves` and
 * UNDER-reports; a citation to a whole block rather than a single line scores
 * `drifted` and OVER-reports. Both buckets are printed with their sites so a
 * reader can audit either direction, and the controls below are what keep the
 * instrument from collapsing into "flags everything" or "flags nothing".
 *
 * ## The two controls, both printed, both fatal
 *
 * objectui#8875's acceptance: a census that flags everything is as useless as
 * one that flags nothing, so the instrument has to be shown firing AND not
 * firing, on this tree, in its own output.
 *
 *   FIRING     `scripts/check-doc-component-types.mjs` cites the action
 *              vocabulary at `ActionRunner.ts:112`. Verified by content, not by
 *              number: line 112 is the closing delimiter of a docblock and
 *              `ActionDef` opens at 113. This citation MUST be reported false.
 *
 *   NON-FIRING `packages/types/src/crud.ts` cites `register('detail'` as
 *              resolving to `plugin-detail/src/index.tsx:387`. Verified by
 *              content: that line is the `ComponentRegistry.register('detail',`
 *              call. This citation MUST NOT be reported false.
 *
 * Either control failing exits non-zero, and so does an EMPTY POPULATION: a
 * census that reads nothing because it is blind is indistinguishable from a
 * clean tree, which is the failure this whole card is about. The controls are
 * addressed BY CONTENT (the citing file plus the cited symbol), never by their
 * own line numbers -- a control pinned by line address would be an instance of
 * the defect being measured.
 *
 * Usage:
 *   node scripts/cross-file-line-citation-census.mjs
 *   node scripts/cross-file-line-citation-census.mjs --json
 *   node scripts/cross-file-line-citation-census.mjs --list-false
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';
import { uiRoot } from './ui-root.mjs';

/**
 * Extensions that make `NAME.ext:NNN` a source address. Kept in step with
 * `eslint-rules/no-line-address-in-test-name.js`'s list of the same name so the
 * gate and the census cannot disagree about what an address is.
 */
const SOURCE_EXT = [
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'md', 'mdx', 'yml', 'yaml',
  'css', 'scss', 'html', 'vue', 'svelte', 'snap', 'sh', 'py', 'toml',
];

/** Files this census reads. Anything else is not scanned, and says so. */
const SCANNED_EXT = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'md', 'mdx', 'yml', 'yaml', 'txt',
  'css', 'scss', 'html', 'vue', 'svelte', 'sh', 'py', 'toml',
]);

/** Generated or vendored text nothing authors by hand. */
const SKIP_FILES = new Set(['pnpm-lock.yaml', 'skills-lock.json']);

/**
 * The instrument may not count itself: every file here carries addresses as
 * FIXTURE DATA -- controls, worked examples, the shapes a syntax must and must
 * not match. Counting them would be the instrument reading itself.
 *
 * ⚠️ It is one list for BOTH readers. The differential gate
 * (`check-new-cross-file-line-citations.mjs`, objectui#8875 clause 2) imports
 * this set rather than keeping a second copy: two carve-out lists over one
 * population drift, and the direction they drift in is silent -- a file carved
 * out of one reader and counted by the other makes the two answers disagree
 * with no error anywhere.
 */
export const SELF_FILES = new Set([
  'scripts/cross-file-line-citation-census.mjs',
  'scripts/__tests__/cross-file-line-citation-census.test.ts',
  'scripts/check-new-cross-file-line-citations.mjs',
  'scripts/__tests__/check-new-cross-file-line-citations.test.ts',
]);

/**
 * LONGEST EXTENSION FIRST, and a trailing non-word guard. Both are needed, and
 * the first was found by this census misreading its own tree: a naive
 * `ts|tsx` alternation matched `.ts` inside `ListView.tsx`, and the ONE
 * `line NNN of NAME` instance in the repository was reported against a file
 * called `ListView.ts` that does not exist. The `path:line` syntaxes hid the
 * bug -- their required `:` forces the engine to backtrack into `tsx` -- so the
 * defect was visible only in the syntax with nothing after the name. That is
 * this card's own subject one level up: a probe that answers confidently about
 * a file it never looked at.
 */
const EXT_ALT = [...SOURCE_EXT].sort((a, b) => b.length - a.length).join('|');
const NAME = String.raw`[A-Za-z0-9_@$./-]*[A-Za-z0-9_$-]\.(?:${EXT_ALT})(?![A-Za-z0-9])`;

/** Syntax 1 -- `name.ext:NNN`. */
const RE_COLON = new RegExp(String.raw`(${NAME}):(\d+)`, 'g');
/** Syntax 2 -- `name.ext#LNNN`, permalink form, URL or bare. */
const RE_PERMALINK = new RegExp(String.raw`(${NAME})#L(\d+)`, 'g');
/** Syntax 3 -- `line NNN of|in|at NAME`, address written first. */
const RE_LINE_BEFORE = new RegExp(
  String.raw`\blines?\s+(\d+)(?:\s*[-–]\s*\d+)?\s+(?:of|in|at|from)\s+\`?(${NAME})`,
  'gi',
);
/** Syntax 4 -- `NAME line NNN`, address written second. */
const RE_LINE_AFTER = new RegExp(String.raw`(${NAME})\`?[\s,(]+(?:at\s+)?\blines?\s+(\d+)`, 'gi');
/**
 * Syntax 5 -- the continuation address. A bare `:NNN` / `#LNNN` with no
 * filename. The lookbehind rejects anything that would make it part of a larger
 * token: a clock time (`12:30`), a decimal, a path, and an address already
 * matched by syntax 1 or 2.
 */
const RE_CONT_COLON = /(?<![A-Za-z0-9_$./#-]):(\d+)\b/g;
const RE_CONT_PERMALINK = /(?<![A-Za-z0-9_$./-])#L(\d+)\b/g;
/**
 * A source filename written with NO address of its own -- the OTHER way syntax
 * 5's scope opens, and the one this file could not read until objectui#9026.
 *
 * ⚠️ Measured, not assumed. `ObjectKanbanSchema.groupBy` carried six bare
 * addresses into `plugin-kanban`'s renderer under the line
 * "`…/ObjectKanban.tsx` reads `schema.groupBy` at", and scope was opened ONLY
 * by a full `NAME:NNN`, so a filename with no number of its own put nothing in
 * scope and all six read as a colon and a number. Every one of them had rotted
 * and this file scored the docblock EMPTY -- not report-only about the class,
 * SILENT on it, which is the failure the census exists to make impossible.
 *
 * ⛔ The ±2 window is NOT what caused that, and widening it is ⛔ not the fix:
 * with the window at 999999 and this trigger absent, that docblock still reads
 * 0 of 6. The defect was what OPENS scope, so that is the only thing that moved.
 */
const RE_NAME_ONLY = new RegExp(String.raw`(${NAME})`, 'g');

/**
 * How far a bare `:NNN` may sit below the thing that put its file in scope.
 *
 * DELIBERATE, and left at its shipped value on purpose: a bare `:NNN` on its
 * own really is a colon and a number, and this is the guard that keeps it from
 * becoming a citation. Widening it buys real citations and pays in false ones;
 * that trade is a judgement about a false-positive guard, ⛔ not something
 * objectui#9026 was asked to make, so the number stayed. objectui#9083 owns the
 * width and ⛔ nothing here decides it.
 *
 * ⛔ THE PRICE OF WIDENING IS NOT WRITTEN DOWN HERE, per AGENTS.md #9. This
 * docblock shipped carrying a one-time count of what a width of 5 would admit,
 * and objectui#9216 re-derived it: it had already moved, in size AND in
 * composition, while reading exactly as live. ⇒ re-derive it instead --
 * `pnpm census:cross-file-line-citations --json` with this constant at 2 and
 * again at 5, and diff the `rows` -- and ⛔ do not reason from any figure a
 * comment hands you.
 *
 * ⚠️ Its consequence is stated rather than hidden: an address more than this
 * many lines below the last thing that named a file is NOT read. In the
 * docblock above, five of the six are read and the sixth -- restated eight
 * lines lower, with no filename of its own anywhere near it -- is not.
 *
 * ⛔ DISTANCE IS THE WHOLE REASON FOR THAT SIXTH, and this docblock used to
 * credit `carryScope`'s paragraph break for it (objectui#9216). It cannot be:
 * the pinned fixture is a JSDoc body and contains ZERO lines that trim to
 * empty, so that guard never fires on it -- and it fires in no block comment at
 * all, for the same reason. `scripts/__tests__/cross-file-line-citation-census.test.ts`
 * pins the residual blindness AND its true cause by name, each beside a firing
 * control, so neither can be mistaken for coverage again.
 */
export const CONT_WINDOW = 2;

/**
 * The DECLARATION that an address is fixture data, and the reason it must carry
 * (objectui#9865). Spelled `fixture-address: <reason>` -- the marker names what
 * the thing IS, the reason says why, and the census prints both.
 *
 * ⛔ THE REASON IS NOT DECORATION. A bare marker is a mute button: it removes a
 * row from the count and tells a reader nothing about whether the removal was
 * right. Requiring a reason is the only thing separating this from the by-name
 * carve-out the card ⛔ ruled out, because the reason is what an auditor reads.
 * Hence the capture is REQUIRED and a marker without one does not fire -- a
 * case pinned in `DECLARATION_CASES` below and in this file's test.
 *
 * The leading boundary keeps a longer token (`not-a-fixture-address:`) from
 * declaring anything, and the reason stops at the end of the line: a JSDoc or a
 * trailing STAR-SLASH is stripped (spelled in words here: writing that pair
 * literally inside this block comment would end it), and a reason that wraps
 * is read only as far as the marker's own line, which is the half a reader's
 * eye lands on anyway. A reason longer than `REASON_MAX` is cut, and the cut is
 * SHOWN -- a silent truncation reads as an author who stopped mid-sentence.
 */
const DECLARATION = /(?:^|[^A-Za-z0-9_-])fixture-address:[ \t]*(\S[^\n]{2,})/;

/** How much of a reason is printed before it is cut, and the cut is SHOWN. */
export const REASON_MAX = 120;

/**
 * How far from the address a declaration may sit.
 *
 * DELIBERATELY the same geometry as the anchor window in `anchorsFor`: one
 * notion of "near this citation" in this file, so a reader who has understood
 * one has understood the other. It is 2 for the same reason `CONT_WINDOW` is --
 * a block of fixture rows wants one declaration above it, and anything wider
 * starts reaching sentences the author was not talking about.
 *
 * ⚠️ Its consequence is the over-reach direction named in the header: a
 * declaration DOES cover a neighbouring address within this many lines. That is
 * required for a fixture TABLE and is visible in the printed list, ⛔ never
 * inferred.
 */
export const DECLARATION_WINDOW = 2;

/**
 * The declaration covering the address on `lines[lineIndex]`, or `null`.
 *
 * ⛔ Text, not syntax. Nothing in this file reads an AST, so a marker inside a
 * string literal declares exactly as one inside a comment does -- stated so it
 * cannot be read as a comment-only mechanism it never was.
 */
export function declarationNear(lines, lineIndex, window = DECLARATION_WINDOW) {
  const from = Math.max(0, lineIndex - window);
  const to = Math.min(lines.length - 1, lineIndex + window);
  for (let i = from; i <= to; i += 1) {
    const m = DECLARATION.exec(lines[i]);
    if (!m) continue;
    const full = m[1].replace(/\*\/\s*$/, '').trim();
    if (full.length < 3) continue;
    // Truncation is SHOWN, ⛔ never silent: a reason cut mid-word with nothing
    // saying so reads as an author who stopped mid-sentence, and the reason is
    // the only thing an auditor of this carve-out has to go on.
    const reason = full.length > REASON_MAX ? `${full.slice(0, REASON_MAX - 1)}…` : full;
    return { reason, line: i + 1 };
  }
  return null;
}

/**
 * The declaration reader's own control set, run on EVERY census, in the shape
 * `CLASSIFIER_CASES` already established here: a zero in the declared column is
 * a reading only if the reader is shown firing in the same run. Each case goes
 * through the real `scanFile`, ⛔ never through a second copy of the predicate.
 */
export const DECLARATION_CASES = [
  {
    name: 'a marker WITH a reason, on the address\'s own line, declares it',
    path: 'packages/example/src/notes.ts',
    text: '// fixture-address: RuleTester input, the rule under test reads it\n'
      + '// see packages/core/src/actions/ActionRunner.ts:112 for the vocabulary\n',
    want: (r) => r.hits.length === 0 && r.declared.length === 1
      && r.declared[0].declaredReason === 'RuleTester input, the rule under test reads it',
  },
  {
    name: 'a marker a full window away still reaches the address',
    path: 'packages/example/src/notes.ts',
    text: '// fixture-address: the self-test feeds this string to the extractor\n'
      + '//\n'
      + '// see packages/core/src/actions/ActionRunner.ts:112 for the vocabulary\n',
    want: (r) => r.hits.length === 0 && r.declared.length === 1,
  },
  {
    name: '⛔ a marker BEYOND the window declares nothing -- the address is counted',
    path: 'packages/example/src/notes.ts',
    text: '// fixture-address: the self-test feeds this string to the extractor\n'
      + '//\n//\n//\n'
      + '// see packages/core/src/actions/ActionRunner.ts:112 for the vocabulary\n',
    want: (r) => r.hits.length === 1 && r.declared.length === 0,
  },
  {
    name: '⛔ a marker with NO reason is a mute button, not a declaration',
    path: 'packages/example/src/notes.ts',
    text: '// fixture-address:\n'
      + '// see packages/core/src/actions/ActionRunner.ts:112 for the vocabulary\n',
    want: (r) => r.hits.length === 1 && r.declared.length === 0,
  },
  {
    name: '⛔ an undeclared address in the same shape is still counted',
    path: 'packages/example/src/notes.ts',
    text: '// see packages/core/src/actions/ActionRunner.ts:112 for the vocabulary\n',
    want: (r) => r.hits.length === 1 && r.declared.length === 0,
  },
];

export function evaluateDeclaration() {
  return DECLARATION_CASES.map((c) => {
    let ok = false;
    let detail = '';
    try {
      const r = scanFile(c.path, c.text);
      ok = c.want(r) === true;
      detail = `${r.hits.length} counted, ${r.declared.length} declared`
        + (r.declared.length > 0 ? ` (\`${r.declared[0].declaredReason}\`)` : '');
    } catch (error) {
      ok = false;
      detail = `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    return { ...c, ok, detail };
  });
}

/** A released changelog heading -- `## 1.2.3`, with or without a link wrapper. */
const RELEASED_HEADING = /^##\s+\[?v?\d+\.\d+\.\d+/;

/** A line carrying no content of its own: blank, or delimiters only. */
const NON_SUBSTANTIVE = /^[\s*/{}()[\];,.'"`+\-|=<>#~&!?:]*$/;

/** Backticked code spans and quoted strings -- where this tree writes code in prose. */
const CODE_SPAN = /`([^`\n]{1,120})`|'([^'\n]{2,80})'|"([^"\n]{2,80})"/g;
/** Bare camelCase / PascalCase identifiers, which prose does not produce by accident. */
const CASED_IDENT = /\b[a-z][a-z0-9$]*[A-Z][A-Za-z0-9_$]*\b|\b[A-Z][a-z0-9$]+[A-Z][A-Za-z0-9_$]*\b/g;
/** Atoms inside a code span. */
const ATOM = /[A-Za-z_$][A-Za-z0-9_$]{2,}/g;

/**
 * A vitest/jest declaration reaching its TITLE STRING -- the root, an optional
 * modifier chain, an optional `each(...)` argument list, then the opening quote
 * of the title. The capture is the quote character, so the title's extent can be
 * walked from there.
 */
const TEST_DECL_TITLE = /^\s*(?:await\s+)?(?:it|test|describe|bench|suite)(?:\.[A-Za-z_$]+)*\s*(?:\([^()]*\)\s*)?\(\s*(['"`])/;

/**
 * Is the span `[start, end)` inside a test TITLE on this line?
 *
 * objectui#8047's ESLint rule owns that sub-population and runs at `error`, so
 * this census only needs to say whether it is overlapping with it. The FIRST
 * version of this predicate merely asked whether the line contained something
 * shaped like `it(`, and it reported 27 hits on this tree -- every one of them a
 * false positive: the prose `declare it (\`form.d.ts:1368\`)`, a markdown table
 * cell, and this rule's OWN header quoting the false positive it was written to
 * avoid. A number like that is worse than no number, because it reads as an
 * overlap with a gate that is in fact clean. Hence the extent walk here, and
 * hence CLASSIFIER_CASES below: a zero from this predicate is only a reading if
 * the predicate is shown firing in the same run.
 *
 * The declaration is anchored at the START OF THE STATEMENT, which is what
 * separates a real `it(` from the word "it" in a sentence. The cost is an
 * under-read on a declaration nested mid-line, and that direction is chosen
 * deliberately: an under-read leaves the citation in the main population, where
 * it is still counted and still visible, while an over-read invents an overlap
 * with a gate that is clean.
 */
export function inTestTitle(line, start, end) {
  const m = TEST_DECL_TITLE.exec(line);
  if (!m) return false;
  const quote = m[1];
  const open = m[0].length;
  let close = open;
  while (close < line.length) {
    if (line[close] === '\\') { close += 2; continue; }
    if (line[close] === quote) break;
    close += 1;
  }
  return start >= open && end <= close;
}

/**
 * The classifier's own control pair, run on every census. The positive case is
 * the shape objectui#8047's rule bans; the negative case is the exact prose that
 * fooled the first version of the predicate.
 */
export const CLASSIFIER_CASES = [
  { name: 'an address inside a test title IS classified as a test name', line: "  it('renders per SchemaRenderer.tsx:599', () => {});", find: 'SchemaRenderer.tsx:599', want: true },
  { name: 'prose containing `it (` is NOT classified as a test name', line: ' * declare it (`form.d.ts:1368`), so `command.mdx` keeps it.', find: 'form.d.ts:1368', want: false },
  { name: "a docblock quoting a test-like sentence is NOT classified as a test name", line: ' *     ("...reads and draws it (PageHeader.tsx:123...")  that merely looks like', find: 'PageHeader.tsx:123', want: false },
  { name: 'an `each` title still counts as a test name', line: "  it.each(ROWS)('adopts SchemaRenderer.tsx:599', () => {});", find: 'SchemaRenderer.tsx:599', want: true },
];

export function evaluateClassifier() {
  return CLASSIFIER_CASES.map((c) => {
    const start = c.line.indexOf(c.find);
    const got = start >= 0 && inTestTitle(c.line, start, start + c.find.length);
    return { ...c, ok: got === c.want, got };
  });
}

/** Anchors shorter or plainer than this cannot carry a citation on their own. */
function isStrongAtom(atom) {
  if (atom.length < 4) return false;
  if (/[a-z][A-Z]/.test(atom)) return true;
  if (/^[A-Z][a-z0-9$]+[A-Z]/.test(atom)) return true;
  if (atom.includes('_')) return true;
  return atom.length >= 6;
}

/** Every tracked path, as git sees them. */
function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

/**
 * Resolves a WRITTEN path -- which may be a bare basename, a partial path, or
 * the tail of a GitHub permalink URL -- to a tracked file, by taking the
 * LONGEST suffix of its segments that any tracked path ends with. A written
 * path suffix beats a bare basename, which is what keeps `src/index.ts:12` from
 * being scored against the wrong package.
 */
export function resolveCited(written, index) {
  const segs = written.split('/').filter((s) => s && s !== '.' && s !== '..');
  if (segs.length === 0) return { kind: 'no-such-file', candidates: [] };
  for (let k = segs.length; k >= 1; k -= 1) {
    const suffix = segs.slice(-k).join('/');
    const hits = index.get(segs[segs.length - 1]) ?? [];
    const matches = hits.filter((p) => p === suffix || p.endsWith(`/${suffix}`));
    if (matches.length === 1) return { kind: 'resolved', path: matches[0] };
    // Ambiguity at the LONGEST matching suffix is real ambiguity: a shorter
    // suffix can only match more files, never fewer, so there is nothing more
    // specific left to try.
    if (matches.length > 1) return { kind: 'ambiguous-basename', candidates: matches };
  }
  const byName = index.get(segs[segs.length - 1]) ?? [];
  if (byName.length > 1) return { kind: 'ambiguous-basename', candidates: byName };
  if (byName.length === 1) return { kind: 'resolved', path: byName[0] };
  return { kind: 'no-such-file', candidates: [] };
}

/** Content anchors for a citation: code-shaped tokens in a +/-2 line window. */
export function anchorsFor(lines, lineIndex, citedPath) {
  const window = lines.slice(Math.max(0, lineIndex - 2), lineIndex + 3).join('\n');
  const atoms = new Set();
  let m;
  CODE_SPAN.lastIndex = 0;
  while ((m = CODE_SPAN.exec(window)) !== null) {
    const span = m[1] ?? m[2] ?? m[3] ?? '';
    ATOM.lastIndex = 0;
    let a;
    while ((a = ATOM.exec(span)) !== null) atoms.add(a[0]);
  }
  CASED_IDENT.lastIndex = 0;
  while ((m = CASED_IDENT.exec(window)) !== null) atoms.add(m[0]);

  // A file's own name appears on its own lines, so scoring a citation against
  // the atoms of the path it cites would mark almost everything as resolving.
  const forbidden = new Set();
  for (const seg of citedPath.split(/[/.]/)) {
    ATOM.lastIndex = 0;
    let a;
    while ((a = ATOM.exec(seg)) !== null) forbidden.add(a[0]);
  }
  return [...atoms].filter((t) => isStrongAtom(t) && !forbidden.has(t));
}

/**
 * An anchor on more lines than this cannot locate anything. `string` occurs on
 * 40 lines of a types file: finding it "somewhere else" says only that the file
 * is written in TypeScript, and scoring a citation `drifted` on that evidence is
 * how a census turns into one that flags everything. Measured on this tree, the
 * threshold is what separates 618 false readings from the reported number --
 * see the header's note on error direction.
 */
export const MAX_ANCHOR_LINES = 5;

/**
 * Which anchors can actually discriminate inside the cited file, and where each
 * one is. An anchor absent from the file cannot judge a line in it; one spread
 * across the file cannot either.
 */
export function locateAnchors(citedLines, anchors) {
  const located = [];
  for (const a of anchors) {
    const lines = [];
    for (let i = 0; i < citedLines.length; i += 1) {
      if (citedLines[i].includes(a)) lines.push(i + 1);
      if (lines.length > MAX_ANCHOR_LINES) break;
    }
    if (lines.length >= 1 && lines.length <= MAX_ANCHOR_LINES) located.push({ anchor: a, lines });
  }
  return located;
}

/**
 * The LINES of a file's text. `split('\n')` is not that, and the difference is
 * exactly one line on nearly every tracked file: a file that ends in a newline
 * splits into a trailing empty element that is the TERMINATOR of the last line,
 * not a line of its own, so the array reads one longer than `wc -l` says the
 * file is. Two things went wrong on that extra element -- the printed
 * `file has N lines` was one too many, and a citation addressing the phantom
 * index passed the range check and was then scored on the empty string, so a
 * genuinely out-of-range address came back `non-substantive` instead.
 *
 * ⚠️ The repair is a single trailing-terminator pop and ⛔ never a blanket
 * `length - 1`: a file that does NOT end in a newline has no such element, and
 * its real last line is the one a blanket subtraction would delete. Whether
 * this tree still holds such files is re-derived rather than asserted here --
 * `git ls-files -z | xargs -0 -I{} sh -c '[ -s {} ] && [ -n "$(tail -c 1 {})" ] && echo {}'`
 * prints them, and ⛔ nothing re-runs it, which is why no count is written down.
 * Exactly one element is popped, which is also right for a file ending in a
 * blank line: `"a\n\n"` has a genuinely empty last line plus the terminator,
 * and only the terminator goes. (objectui#9890)
 */
export function fileLines(text) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Decides one citation against the tree AS IT IS TODAY. Never asks what moved. */
export function judge(hit, root, index, fileCache) {
  const resolution = resolveCited(hit.citedWritten, index);
  if (resolution.kind !== 'resolved') return { verdict: resolution.kind, candidates: resolution.candidates };
  const citedPath = resolution.path;
  if (citedPath === hit.file) return { verdict: 'same-file', citedPath };

  let citedLines = fileCache.get(citedPath);
  if (citedLines === undefined) {
    try {
      citedLines = fileLines(readFileSync(join(root, citedPath), 'utf8'));
    } catch {
      citedLines = null;
    }
    fileCache.set(citedPath, citedLines);
  }
  if (citedLines === null) return { verdict: 'no-such-file', citedPath };

  if (hit.citedLine < 1 || hit.citedLine > citedLines.length) {
    return { verdict: 'out-of-range', citedPath, citedLength: citedLines.length };
  }
  const target = citedLines[hit.citedLine - 1];
  if (NON_SUBSTANTIVE.test(target)) {
    return { verdict: 'non-substantive', citedPath, target: target.trim() };
  }
  if (hit.anchors.length === 0) return { verdict: 'no-anchor', citedPath, target: target.trim() };
  // The two directions take DIFFERENT evidence, and the asymmetry is the point.
  // An anchor sitting ON the cited line is direct positive evidence that the
  // address still describes what the prose says, however common that anchor is
  // elsewhere. Claiming DRIFT is the opposite: it asserts the content moved, so
  // it needs a witness that can actually locate something -- a promiscuous
  // anchor found "somewhere else" says only that the file is written in the
  // language it is written in.
  const onTarget = hit.anchors.find((a) => target.includes(a));
  if (onTarget) return { verdict: 'resolves', citedPath, anchor: onTarget, target: target.trim() };
  const located = locateAnchors(citedLines, hit.anchors);
  if (located.length === 0) {
    // Either the citing prose names nothing that is in the cited file at all,
    // or everything it names is spread across it. Neither judges a line.
    return { verdict: 'anchor-absent', citedPath, target: target.trim() };
  }
  const elsewhere = located[0];
  return {
    verdict: 'drifted',
    citedPath,
    target: target.trim(),
    actualLine: elsewhere.lines[0],
    anchor: elsewhere.anchor,
  };
}

/** Scans one file, returning raw citation hits before judging. */
export function scanFile(relPath, text) {
  const lines = text.split('\n');
  const isChangelog = basename(relPath) === 'CHANGELOG.md';
  let releasedFrom = Infinity;
  if (isChangelog) {
    for (let i = 0; i < lines.length; i += 1) {
      if (RELEASED_HEADING.test(lines[i])) { releasedFrom = i; break; }
    }
  }

  const hits = [];
  const carvedOut = [];
  const declared = [];
  /** The most recent full address, so a bare `:NNN` can inherit its file. */
  let lastAddress = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    /** Every source filename written on this line, with the column it starts at. */
    const namesOnLine = [];
    if (line.includes('.')) {
      RE_NAME_ONLY.lastIndex = 0;
      let nm;
      while ((nm = RE_NAME_ONLY.exec(line)) !== null) namesOnLine.push({ written: nm[1], start: nm.index });
    }

    /**
     * The file a bare `:NNN` at `col` inherits: the nearest filename to its
     * LEFT on this line, and only failing that whatever is still in scope from
     * above. Reading leftwards is what the prose means and it is measurable --
     * `(`ViewTabBar.tsx:564`, `:667`; `ManageViewsDialog.tsx:300`, `:361`)`
     * gave `:667` to ManageViewsDialog while the sentence gives it to
     * ViewTabBar, because scope was whatever the line's LAST match happened to
     * leave behind. Nothing announced that; it scored `out-of-range` and the
     * wrong file simply absorbed the blame.
     */
    const scopeFor = (col) => {
      for (let k = namesOnLine.length - 1; k >= 0; k -= 1) {
        if (namesOnLine[k].start < col) return namesOnLine[k].written;
      }
      return lastAddress && i - lastAddress.line <= CONT_WINDOW ? lastAddress.written : null;
    };

    /**
     * Hands scope to the lines below. A line that TRIMS TO EMPTY ends it: a
     * citation and its continuation belong to one piece of prose, and crossing
     * a paragraph is how a filename in one sentence captures a port number in
     * the next.
     *
     * ⛔ ITS REACH IS MARKDOWN PROSE, AND ⛔ NOT BLOCK COMMENTS. `'   *'`
     * trims to `'*'`, ⛔ not to `''`, so this branch CANNOT FIRE inside a JSDoc
     * or a `//` run -- and a JSDoc is where syntax 5's population actually
     * lives. What such a comment lays out as two paragraphs is one unbroken
     * prose unit to this scanner; only `CONT_WINDOW` ends scope there. ⛔ So do
     * not cite this guard as covering a block comment, and ⛔ do not credit it
     * for an address that distance alone put out of reach -- that
     * misattribution is what objectui#9216 was filed for, and it had reached
     * two docblocks in this file plus a reader reasoning about `CONT_WINDOW`.
     *
     * ⚠️ Whether it SHOULD reach a `*`-prefixed line is a live judgement
     * (objectui#9216), ⛔ not a repair to make on the way past, even though
     * `NON_SUBSTANTIVE` in this file already spells the delimiters-only
     * predicate such a change would need. Price it by re-running the census
     * with the predicate swapped; ⛔ no count is written down here, per
     * AGENTS.md #9.
     *
     * The inertness, the Markdown case it does hold for, and a firing control
     * for both are pinned in
     * `scripts/__tests__/cross-file-line-citation-census.test.ts`.
     *
     * Otherwise the line's LAST filename is what carries, by column and
     * ⛔ not by whatever matched last, for the reason `scopeFor` records.
     */
    const carryScope = () => {
      if (line.trim() === '') { lastAddress = null; return; }
      if (namesOnLine.length > 0) {
        lastAddress = { written: namesOnLine[namesOnLine.length - 1].written, line: i };
      }
      if (lastAddress && i - lastAddress.line > CONT_WINDOW) lastAddress = null;
    };

    if (!/[:#]/.test(line) && !/\bline\s+\d/i.test(line)) {
      // No address syntax can match here, but a bare filename on this line
      // still puts a file in scope for the ones below it -- which is exactly
      // the line the `ObjectKanban.tsx` docblock opened with.
      carryScope();
      continue;
    }
    /** Character spans already claimed on this line, so syntaxes cannot double-count. */
    const claimed = [];
    const overlaps = (s, e) => claimed.some(([cs, ce]) => s < ce && cs < e);

    const record = (syntax, written, num, start, end) => {
      if (overlaps(start, end)) return;
      claimed.push([start, end]);
      const citedLine = Number(num);
      if (!Number.isInteger(citedLine) || citedLine < 1) return;
      const entry = {
        file: relPath,
        line: i + 1,
        column: start + 1,
        syntax,
        citedWritten: written,
        citedLine,
        text: line.trim().slice(0, 200),
        inTestName: inTestTitle(line, start, end),
      };
      // Order matters and is stated: the released-changelog carve-out is
      // decided first, so a declaration inside dated history cannot move a row
      // from one carve-out to the other and change two printed numbers at once.
      const declaration = i >= releasedFrom ? null : declarationNear(lines, i);
      if (i >= releasedFrom) carvedOut.push({ ...entry, carveOut: 'released-changelog-section' });
      else if (declaration) {
        declared.push({ ...entry, declaredReason: declaration.reason, declaredOnLine: declaration.line });
      } else hits.push(entry);
      lastAddress = { written, line: i };
    };

    for (const [syntax, re, nameFirst] of [
      ['colon', RE_COLON, true],
      ['permalink', RE_PERMALINK, true],
      ['line-before-name', RE_LINE_BEFORE, false],
      ['name-before-line', RE_LINE_AFTER, true],
    ]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const written = nameFirst ? m[1] : m[2];
        const num = nameFirst ? m[2] : m[1];
        record(syntax, written, num, m.index, m.index + m[0].length);
      }
    }

    // Syntax 5 last, and only where a file is already in scope: a bare `:NNN`
    // on its own is a colon and a number, not a citation.
    for (const re of [RE_CONT_COLON, RE_CONT_PERMALINK]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const written = scopeFor(m.index);
        if (written) record('continuation', written, m[1], m.index, m.index + m[0].length);
      }
    }
    carryScope();
  }
  return { hits, carvedOut, declared, lines };
}

/** Verdicts that mean "this citation does not describe the tree as it is now". */
export const FALSE_VERDICTS = new Set(['out-of-range', 'non-substantive', 'drifted']);
/** Verdicts the census refuses to score in either direction. */
export const UNJUDGED_VERDICTS = new Set(['no-anchor', 'anchor-absent', 'no-such-file', 'ambiguous-basename']);

/** The bucket a citing file is reported under. */
export function bucketOf(relPath) {
  const segs = relPath.split('/');
  if (segs.length === 1) return '(repo root)';
  if (['packages', 'apps', 'examples'].includes(segs[0])) return `${segs[0]}/${segs[1]}`;
  if (segs[0] === 'scripts' && segs.length > 2) return `scripts/${segs[1]}`;
  return segs[0];
}

/**
 * The two controls, addressed BY CONTENT -- the citing file, the file it cites,
 * and a SUBJECT phrase lifted out of the citing prose -- and never by their own
 * line numbers. A control pinned by line address would be an instance of the
 * defect this census measures.
 *
 * ## Why the subject exists, and why it is the control's identity (objectui#9081)
 *
 * A FILE PAIR IS NOT A CITATION. Two sentences in one file may address the same
 * file, and until objectui#9081 a control was addressed by pair alone while
 * `evaluateControls` folded EVERY row matching that pair into one answer. Both
 * directions of that fold were wrong, quietly and in opposite ways:
 *
 *   - a NON-FIRING control was sunk by any second citation between the same two
 *     files, whatever that citation said. That is what happened. Two epitaphs in
 *     `packages/types/src/crud.ts` address `packages/plugin-detail/src/index.tsx`
 *     with one number between them, the number rotted, and this census answered
 *     `exit 1 -- NOT a reading` to every run on `main` for some 580 commits.
 *     ⭐ The refusal was CORRECT -- the pinned address really had rotted -- but
 *     no reading could be taken downstream either, which is the outage.
 *   - a FIRING control could be satisfied by a row that is NOT its subject. A
 *     rotted sibling citation would report the instrument as proven while the
 *     case the control was written for had silently stopped firing. That is the
 *     unearned green this family exists to prevent, and it has no symptom.
 *
 * ⇒ a control names ONE citation. A subject matching zero rows, or more than
 * one, is a FAILURE rather than something to fold away. ⛔ Neither direction is
 * tolerant of a false row: this is strictly narrower than the fold it replaced.
 *
 * How exposed the old shape was is a number this file deliberately does not
 * carry: run `--json --list-all` and group `rows` by `file` + `citedPath` to
 * re-derive the share of pairs that carry more than one citation.
 *
 * ⚠️ `want: 'resolves'`, ⛔ NOT `not-false`. `anchor-absent` and `no-anchor` are
 * this census DECLINING to judge, so a non-firing control that accepted them
 * would pass on a citation whose health it never established -- and one of the
 * two retired `crud.ts` rows judged exactly that, with its address rotted, at
 * the moment the other one failed. A non-firing control takes positive evidence
 * only: the anchor must sit ON the cited line.
 *
 * ## ⛔ When a control's subject rots, RE-PIN it -- never renumber it
 *
 * objectui#8875 clause 4 repairs an existing address "by converting it to a
 * content anchor, never by moving the number to a different number". A control
 * needs a live line address to score at all, so a converted citation leaves no
 * row behind and the control has to move to a different citation. ⛔ It may
 * never move to the same citation wearing a fresher number -- that is the
 * clause, and it is why the `crud.ts` pair below was retired rather than
 * re-addressed. Its rot stays in the population, where this census reports it.
 */
export const CONTROLS = [
  {
    id: 'firing',
    from: 'scripts/check-doc-component-types.mjs',
    to: 'packages/core/src/actions/ActionRunner.ts',
    subject: 'action vocabulary declared at',
    want: 'false',
    why: 'the docblock closes at the cited line and `ActionDef` opens on the next one (objectui#8875)',
  },
  {
    id: 'non-firing',
    from: 'packages/components/src/__tests__/layout-containers-declare-containment.test.tsx',
    to: 'packages/components/src/renderers/layout/page.tsx',
    subject: 'module-private, hence the four lines here',
    want: 'resolves',
    why: 'the cited line declares the `getJsxManifest` the citing docblock says it mirrors',
  },
];

/** How one row reads in a control's detail line. */
const controlRow = (r) => `${r.file}:${r.line} -> ${r.citedPath}:${r.citedLine} [${r.verdict}]`;

/**
 * Scores each control against the ONE citation its subject names. `want: 'false'`
 * accepts any FALSE verdict; every other `want` is the exact verdict required,
 * so a control asking for positive evidence cannot be satisfied by a verdict
 * this census declined to reach.
 */
export function evaluateControls(rows) {
  return CONTROLS.map((c) => {
    const pair = rows.filter((r) => r.file === c.from && r.citedPath === c.to);
    const matches = pair.filter((r) => r.text.includes(c.subject));
    if (matches.length === 0) {
      // Said separately, because "the citation is gone" and "the citation is
      // there but no longer says this" are different repairs.
      const others = pair.length > 0
        ? ` (${pair.length} citation(s) do run between these two files; none carries this subject)`
        : '';
      return { ...c, ok: false, detail: `NOT FOUND -- the census did not see this citation at all${others}` };
    }
    if (matches.length > 1) {
      return {
        ...c,
        ok: false,
        detail: `AMBIGUOUS -- ${matches.length} citations carry this subject, so it names no single one: `
          + matches.map(controlRow).join('; '),
      };
    }
    const [row] = matches;
    const ok = c.want === 'false' ? FALSE_VERDICTS.has(row.verdict) : row.verdict === c.want;
    return { ...c, ok, detail: controlRow(row) };
  });
}

function tally(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

/**
 * Whether a run may certify itself, and -- the part worth exporting -- in WHICH
 * ORDER its refusals are consulted.
 *
 * ⚠️ CERTIFICATION IS LAST, and that is a fact this file has already got wrong
 * once (objectui#9081). The first cut of the `IS a reading` line printed it
 * directly under the control check and ABOVE the empty-population guard, so a
 * blind run announced `✓ ... this run IS a reading.`, then printed
 * `✗ Empty population ...` and exited 1. A reader -- or a grep keying on that
 * string -- took a certificate off a run that had refused. In the one script
 * whose whole subject is that an instrument must not report a reading it did
 * not take, that is the unearned green arriving through the door marked "say
 * the good news out loud".
 *
 * ⇒ every refusal is consulted first, and a refusing verdict carries NO
 * certification string at all rather than a suppressed one: there is nothing
 * for a later edit to print by accident.
 */
export function finalVerdict({ controls, classifier, declaration = [], populationSize }) {
  const all = [...controls, ...classifier, ...declaration];
  const failed = all.filter((c) => !c.ok);
  if (failed.length > 0) {
    return {
      exit: 1,
      certification: null,
      refusal: [`\n✗ ${failed.length} of ${all.length} control(s) failed -- this run is NOT a reading.`],
    };
  }
  if (populationSize === 0) {
    return {
      exit: 1,
      certification: null,
      refusal: [
        '\n✗ Empty population. A census that reads nothing because it is blind is',
        '  indistinguishable from a clean tree, so this exits non-zero rather than',
        '  printing a silent zero.',
      ],
    };
  }
  return {
    exit: 0,
    refusal: null,
    certification: `✓ ${all.length} of ${all.length} control(s) passed -- this run IS a reading.`,
  };
}

function main(argv) {
  const root = uiRoot();
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const asJson = argv.includes('--json');
  const listAll = argv.includes('--list-all');

  const tracked = trackedFiles(root);
  const index = new Map();
  for (const p of tracked) {
    const b = basename(p);
    if (!index.has(b)) index.set(b, []);
    index.get(b).push(p);
  }

  const hits = [];
  const carvedOut = [];
  const declaredRows = [];
  let scanned = 0;
  let selfCarved = 0;

  for (const rel of tracked) {
    const ext = rel.includes('.') ? rel.slice(rel.lastIndexOf('.') + 1).toLowerCase() : '';
    if (!SCANNED_EXT.has(ext)) continue;
    if (SKIP_FILES.has(basename(rel))) continue;
    let text;
    try {
      if (statSync(join(root, rel)).size > 4 * 1024 * 1024) continue;
      text = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    scanned += 1;
    const r = scanFile(rel, text);
    if (SELF_FILES.has(rel)) {
      selfCarved += r.hits.length + r.carvedOut.length + r.declared.length;
      continue;
    }
    for (const h of r.hits) h.anchors = anchorsFor(r.lines, h.line - 1, h.citedWritten);
    hits.push(...r.hits);
    carvedOut.push(...r.carvedOut);
    declaredRows.push(...r.declared);
  }

  const fileCache = new Map();
  const judged = hits.map((h) => {
    const j = judge(h, root, index, fileCache);
    return { ...h, ...j, bucket: bucketOf(h.file), anchors: h.anchors.slice(0, 6) };
  });

  // A same-file citation is out of scope by definition: objectui#8047's
  // carve-out reasoning ("a human reads it beside the code it annotates") is
  // exactly what still holds there, and objectui#8875 questions only the
  // cross-file case. The count is printed so the boundary is visible.
  const sameFile = judged.filter((r) => r.verdict === 'same-file');
  const population = judged.filter((r) => r.verdict !== 'same-file');
  const falseRows = population.filter((r) => FALSE_VERDICTS.has(r.verdict));
  const unjudged = population.filter((r) => UNJUDGED_VERDICTS.has(r.verdict));
  const resolving = population.filter((r) => r.verdict === 'resolves');
  const controls = evaluateControls(population);
  const classifier = evaluateClassifier();
  const declaration = evaluateDeclaration();
  const inTestName = population.filter((r) => r.inTestName);

  if (asJson) {
    console.log(JSON.stringify({
      head,
      scannedFiles: scanned,
      trackedFiles: tracked.length,
      population: population.length,
      falseToday: falseRows.length,
      resolving: resolving.length,
      unjudged: unjudged.length,
      sameFileExcluded: sameFile.length,
      carvedOutReleasedChangelog: carvedOut.length,
      carvedOutSelf: selfCarved,
      carvedOutDeclaredFixture: declaredRows.length,
      inTestName: inTestName.length,
      bySyntax: Object.fromEntries(tally(population, 'syntax')),
      byDirectory: Object.fromEntries(tally(population, 'bucket')),
      byVerdict: Object.fromEntries(tally(population, 'verdict')),
      controls,
      classifierControls: classifier,
      declarationControls: declaration,
      // Always emitted in full, whatever `--list-all` says: an instrument that
      // reports how many rows it dropped without reporting WHICH has published
      // an unauditable number, and this class is a declaration a reader has to
      // be able to disagree with.
      declaredRows: declaredRows.map((r) => ({
        file: r.file,
        line: r.line,
        cited: `${r.citedWritten}:${r.citedLine}`,
        syntax: r.syntax,
        declaredReason: r.declaredReason,
        declaredOnLine: r.declaredOnLine,
      })),
      rows: listAll ? population : falseRows,
    }, null, 2));
  } else {
    console.log(`# Cross-file line-address citation census -- objectui#8875 (HEAD ${head})\n`);
    console.log(`Scanned ${scanned} of ${tracked.length} tracked files (extension whitelist; anything else is NOT SCANNED, which is not the same as zero).\n`);

    console.log('## Controls -- both must hold, or this census is not a reading\n');
    for (const c of controls) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id} (want ${c.want}): ${c.from} -> ${c.to}`);
      console.log(`      ${c.detail}`);
      console.log(`      why: ${c.why}`);
    }
    for (const c of classifier) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  test-name classifier (want ${c.want}): ${c.name}`);
    }
    for (const c of declaration) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  declaration reader: ${c.name}`);
      console.log(`      ${c.detail}`);
    }
    console.log('');

    console.log('## The number\n');
    console.log(`Cross-file citations in the population : ${population.length}`);
    console.log(`  of which FALSE against today's tree  : ${falseRows.length}`);
    console.log(`  of which resolve to their content    : ${resolving.length}`);
    console.log(`  of which this census does NOT judge  : ${unjudged.length}`);
    console.log('');
    console.log(`Excluded, same-file citations (#8047's carve-out still holds) : ${sameFile.length}`);
    console.log(`Excluded, released CHANGELOG sections (dated records)         : ${carvedOut.length}`);
    console.log(`Excluded, the two citation readers and their tests (fixtures): ${selfCarved}`);
    console.log(`Excluded, addresses the citing file DECLARES as fixture data : ${declaredRows.length}`);
    console.log('  ^ per address, ⛔ never per file, and a reading only because the declaration');
    console.log('    controls above fired. Every one is listed below with the reason it gives.');
    console.log(`Reaching a test name (objectui#8047's rule owns these)        : ${inTestName.length}`);
    console.log("  ^ this zero is a reading only because the classifier controls above fired.");
    console.log('');

    console.log('## By directory\n');
    console.log(`${'directory'.padEnd(34)}${'total'.padStart(7)}${'false'.padStart(7)}${'resolves'.padStart(10)}${'unjudged'.padStart(10)}`);
    for (const [b] of tally(population, 'bucket')) {
      const rows = population.filter((r) => r.bucket === b);
      console.log(
        `${b.padEnd(34)}${String(rows.length).padStart(7)}` +
        `${String(rows.filter((r) => FALSE_VERDICTS.has(r.verdict)).length).padStart(7)}` +
        `${String(rows.filter((r) => r.verdict === 'resolves').length).padStart(10)}` +
        `${String(rows.filter((r) => UNJUDGED_VERDICTS.has(r.verdict)).length).padStart(10)}`,
      );
    }
    console.log('');

    console.log('## By syntax\n');
    for (const [s, n] of tally(population, 'syntax')) console.log(`  ${String(s).padEnd(20)} ${n}`);
    console.log('');
    console.log('## By verdict\n');
    for (const [v, n] of tally(population, 'verdict')) console.log(`  ${String(v).padEnd(20)} ${n}`);
    console.log('');

    console.log(`## The ${falseRows.length} citation(s) that are false today\n`);
    console.log('⛔ This is a REPORT. objectui#8875 reserves the repair decision; shifting an');
    console.log('   already-false address by a hunk delta moves a wrong pointer to a differently');
    console.log('   wrong place while making the diff look diligent.\n');
    for (const r of falseRows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      const where = r.verdict === 'drifted' ? ` (anchor \`${r.anchor}\` is at :${r.actualLine})`
        : r.verdict === 'out-of-range' ? ` (file has ${r.citedLength} lines)`
          : ` (cited line reads \`${r.target}\`)`;
      console.log(`  ${r.file}:${r.line}  cites  ${r.citedPath}:${r.citedLine}  [${r.verdict}]${where}`);
    }
    console.log('');

    console.log(`## The ${declaredRows.length} address(es) DECLARED as fixture data, and the reason each gives\n`);
    console.log('⛔ A declaration can silence a genuinely rotted pointer, and this census cannot');
    console.log('   tell that from the outside. That is why the reason and the declaring line are');
    console.log('   printed: an audited mute button and an unaudited one differ only in whether');
    console.log('   the output names what it dropped.\n');
    for (const r of declaredRows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`  ${r.file}:${r.line}  declares  ${r.citedWritten}:${r.citedLine}  [${r.syntax}]`);
      console.log(`      declared at :${r.declaredOnLine} -- ${r.declaredReason}`);
    }
    console.log('');

    if (listAll) {
      console.log('## Every citation in the population\n');
      for (const r of population.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
        console.log(`  ${r.file}:${r.line}  ${r.syntax.padEnd(17)} -> ${r.citedWritten}:${r.citedLine}  [${r.verdict}]`);
      }
      console.log('');
    }
  }

  const verdict = finalVerdict({ controls, classifier, declaration, populationSize: population.length });
  if (verdict.refusal) {
    for (const line of verdict.refusal) console.error(line);
    return verdict.exit;
  }
  // Said out loud rather than left to be inferred from silence: a reader who
  // cannot tell "every control held" from "the script died before printing" has
  // no certification, only an exit code. ⛔ Printed HERE and nowhere earlier --
  // see `finalVerdict` for why the position is the point.
  if (!asJson) console.log(verdict.certification);
  return verdict.exit;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
