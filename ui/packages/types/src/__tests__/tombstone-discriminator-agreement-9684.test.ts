/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Agreement pin — the retire-vs-remove discriminator (objectui#9684).
 *
 * The rule this file guards is the retire-vs-remove discriminator the precedent
 * changesets state (objectui#5941, #7526) in the form objectui#7678 amended it
 * to. ⛔ It is NOT quoted here — it is stated in `../complex.ts`, at FOUR sites,
 * and the one `../mobile.ts` cites is on `ChatbotSchema`; read it there. The
 * `describe` blocks below fail if that one moves and if the four stop agreeing.
 *
 * ⭐ This file used to quote the rule and claim in the same sentence that it did
 * not restate it — and the quotation matched this file's own
 * `STATES_THE_RULE`, so the tree carried five statements while the pin guarded
 * four and the fifth denied being one (measured at the third in-seat review;
 * `sourceFiles` skips `__tests__`, so deleting the precondition from that
 * header passed). The claim is now enforced on this file rather than asserted
 * about it: see the `describe` that reads this very source.
 *
 * ## Why a pin and not a comment
 *
 * The rule was written out in full at eight sites across `../complex.ts` and
 * `../mobile.ts`. objectui#7678's amendment then had to be applied by hand at
 * every one of them, and the sites do not reference each other — so a missed
 * site went RED nowhere. Measured on objectui#9684's base: two of the eight
 * still lacked the precondition, both in `../mobile.ts`, and the finding that
 * measured the drift enumerated the population with a literal-phrase grep over
 * two hand-picked files and named neither of them — one is a paraphrase the
 * grep cannot see. ⇒ the failure mode is silence, and silence is what this
 * file removes.
 *
 * ## What it enforces, and what it cannot
 *
 * 1. Any comment block in this package that states the rule GENERICALLY must
 *    carry the precondition IN RULE VOICE — `CARRIES_PRECONDITION` reads the
 *    rule's own phrasings, ⛔ not the words "no carrier" wherever they fall in
 *    the block. That distinction is not pedantry: it was measured at the second
 *    in-seat review that an un-amended statement passed because its per-
 *    retirement ARGUMENT said "there is no carrier", while the same defect
 *    worded "no surviving object" was flagged.
 * 2. NO file in this package outside `../complex.ts` states the rule — no
 *    prong, no clause, nothing that matches `STATES_THE_RULE`, in a comment of
 *    any form. ⛔ Not `../mobile.ts` alone, which is what this was: at the
 *    fourth in-seat review a fully amended statement prepended to
 *    `../data-display.ts` PASSED — off the roster, held to its precondition
 *    alone, free to drift at the next amendment with nothing red. That is this
 *    card's own mechanism, one file over. ⛔ And not "comment-only lines"
 *    either: the same review appended a `//` statement to an `export
 *    interface` line and that passed too, because the population was runs of
 *    comment-only lines while this claim said "nothing that matches" — one
 *    word wider than the code. The code moved, ⛔ not the word; `blocksOf`
 *    admits a comment riding on a code line. ⛔ Nor is it "does not write the
 *    prongs out", which it was before both: a note restating the precondition
 *    with the prongs left unwritten passed, and put that file back on the
 *    amendment surface for that clause.
 * 3. The citation target still exists and still states the rule.
 * 4. `../complex.ts` states the rule at EXACTLY the recorded sites, and each
 *    carries exactly the clauses `CLAUSES` names, per the roster in
 *    `SURVIVING_STATEMENTS`. ⭐ 1 alone does NOT give this: a third prong added
 *    to the `ChatbotSchema` statement and nowhere else passed this file when 1
 *    was all there was. ⭐ And the count is exact because `>= 4` let a FIFTH
 *    fully amended statement pass, which made the "four sites" written here, in
 *    the `../mobile.ts` preamble and in the changeset a figure nothing
 *    re-derived (AGENTS.md #9).
 *
 * ⚠️ What re-derives what: the population below is derived at run time from
 * the source, so a site added later ANYWHERE in this package goes red without
 * anyone remembering this file — outside `../complex.ts` by claim 2, which is
 * now the whole package rather than one file, and inside it by claim 4's exact
 * count and roster. But it is derived by MARKERS, and a statement that
 * paraphrases past all of them is invisible here exactly as it was to the grep
 * on the card. The vacuity control is what stops those two from being the zero
 * a DEAD marker also prints: the population in `../complex.ts` is asserted to
 * be exactly the roster, so a marker that stops matching fails loudly there
 * instead of quietly emptying every other assertion.
 *
 * ⛔ What remains silent, stated as the PATTERNS and ⛔ no longer as a summary
 * of them. A third prong is caught when it is written `prong 3`, `third prong`,
 * `(3)`, or as `or` followed by `3`, `iii`, `third` or `thirdly`.
 * ⚠️ The `or` in that last item is an ANCHOR, which no earlier version of this
 * paragraph said: `3`, `iii`, `third` and `thirdly` are caught ONLY directly
 * behind `or`, with nothing in between but commas, whitespace and opening
 * parentheses — ANY NUMBER of them, in ANY ORDER. So `, or ( 3 ) …`,
 * `, or ,3 …`, `, or, (iii) …` and `, or (( 3 )) …` are each CAUGHT, while
 * `, and (iii) …`, `, or else (iii) …`, `; and, third, …` and `, or: (iii) …`
 * are each SILENT — every one of those eight measured through this pin. The
 * first three items carry no such anchor: `prong 3`, `third prong` and a
 * parenthesised `(3)` are caught however the clause is joined, `, and (3) …`
 * included — measured too, and the reason this paragraph does ⛔ NOT say "a
 * listed numbering behind any word other than `or`", which is one step WIDE.
 * Silent as well: a clause that numbers nothing at all, and a whole statement
 * worded past every `STATES_THE_RULE` marker.
 * ⚠️ FOUR earlier versions of this paragraph named a boundary one step off the
 * real one — it required `(3) it`, so `(3) the` was silent; then it called the
 * silent case "a clause that numbers nothing", so `(iii)`, `3.` and `thirdly`
 * were silent; then it split the silent set into "any other numbering" and
 * "numbers nothing", so a LISTED numbering joined by anything but `or` was in
 * neither and a reader amending the rule in that style believed the roster held
 * the other three sites. ⭐ The fourth is why the sentence above reads "in any
 * order": it named the three permitted characters as a SET while the pattern
 * required them in one SEQUENCE, so `, or ( 3 ) …` and `, or ,3 …` were silent
 * and no published sentence forbade either. ⛔ That one was not fixed by
 * describing the sequence — the PATTERN was widened to the set its sentence
 * always claimed, and this paragraph re-derived from the widened pattern.
 * ⇒ when you amend the rule, add the clause here; when you add a site, add the
 * marker; and when you widen a pattern, RE-DERIVE this paragraph from the
 * pattern rather than editing the sentence that summarises it — which is the
 * instruction this paragraph already carried, now followed rather than quoted.
 *
 * ⚠️ Markers are matched against the block with its comment punctuation and
 * line wrapping flattened. Matching raw lines is what makes a phrase probe miss
 * a hit that happens to wrap — measured on this card: the precondition clause
 * breaks across two lines at two of the four published sites, with the line end
 * falling inside the two-word name of the carrier condition, and `grep -inE`
 * over that file reports both as misses.
 * Which spans are comment at all is answered by `scripts/js-comment-mask.mjs`,
 * the one scanner in this tree that knows a string literal from a comment, and
 * ⛔ never by a private regex over the source.
 *
 * ## The `.d.ts` asymmetry this pin records structurally
 *
 * `../complex.ts` states the rule in JSDoc on exported members, which
 * declaration emit carries into the published `.d.ts`; `../mobile.ts`'s notes
 * are `//` comments, which it does not. ⛔ The dividing line is the comment
 * FORM, not where the comment sits: a `//` comment placed directly above an
 * exported declaration with no blank line also reaches the emitted `.d.ts`
 * zero times, measured on objectui#9684 — so "at module scope", which this
 * header and the changeset both said, named the wrong cause. That asymmetry is
 * why the two files are treated differently — a citation costs a consumer of
 * the published declarations nothing in one file and a jump in the other. The
 * structural half of the contrast (JSDoc vs `//`) is asserted below. ⛔ The reading of the
 * emitted `.d.ts` itself is NOT re-derived by anything here or in CI: it was
 * taken once, on objectui#9684, and the PR body prints the command to re-take
 * it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { scanSource } from '../../../../scripts/js-comment-mask.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '..');

/** A comment block, with the file it came from and its 1-based line span. */
interface Block {
  file: string;
  line: number;
  /** 1-based line the block's last line sits on. */
  endLine: number;
  /**
   * `jsdoc` and `line` are runs of comment-only lines of ONE kind — ended by a
   * blank line, by a `*\/`, and by a change of kind; `trailing` is a comment
   * riding on a code line, which is its own one-line block.
   */
  kind: 'jsdoc' | 'line' | 'trailing';
  /** Comment punctuation and line wrapping flattened to single spaces. */
  flat: string;
}

/**
 * A generic statement of the rule. Every alternative is a phrase that only
 * appears when the rule itself is being written out, never when a note merely
 * names which prong it relies on (`ai.ts` cites "PRONG 2 of the discriminator"
 * and is deliberately out of the population).
 */
const STATES_THE_RULE =
  /tombstone is available only on a|\beither prong\b|\bboth prongs\b|authors to a named live replacement|keeps? loud a key the docs taught as working|keep loud a key the docs taught as working|two-prong discriminator/i;

/**
 * The precondition objectui#7678 added — the clause that kept being missed —
 * matched in RULE VOICE only.
 *
 * ⛔ Not `/surviving carrier|no carrier/` over the whole block, which is what
 * this was and what the second in-seat review falsified: a block whose per-
 * retirement ARGUMENT happens to say "there is no carrier" satisfied it while
 * the statement above that argument had no precondition at all — the same
 * defect passing or failing on the author's choice of words, since the base
 * `MobileComponentConfig` note said "no surviving object" and was flagged.
 *
 * ⚠️ Failure direction, chosen on purpose: a statement that carries the
 * precondition in a phrasing not listed here goes RED rather than green. A
 * spurious red sends a human to read four blocks; a spurious green is the
 * defect this file exists for. Add the phrasing here when you introduce one.
 */
const CARRIES_PRECONDITION =
  /(available )?only on a surviving[- ]carrier|only where a carrier survives|only where the carrier survives/i;

/** The two prongs written out verbatim, which `mobile.ts` must no longer do. */
const WRITES_THE_PRONGS_OUT =
  /authors to a named live replacement|keeps? loud a key the docs taught as working|keep loud a key the docs taught as working/i;

const flatten = (source: string): string =>
  source
    .replace(/^\s*(\/\*\*|\*\/|\*|\/\/)/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(path, out);
    } else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
};

/**
 * Comment blocks, where "is this span a comment" is answered by the shared
 * scanner and never by a private regex — a `/*` inside a string opens a phantom
 * comment for a regex, and the reader then reports clean over source it never
 * looked at (`scripts/js-comment-mask.mjs` states the class).
 *
 * A block is a maximal run of CONSECUTIVE lines that are entirely comment: one
 * JSDoc, or one paragraph of `//` lines. A blank line ends a run on purpose —
 * joining across one would let a drifted note inherit a compliant neighbour's
 * precondition and pass.
 *
 * ⭐ A `*\/` ends a run too, and a change of kind starts a new one — and that is
 * the SAME sentence, applied where the fifth in-seat review found it was not.
 * A blank line was the only boundary here, so two ABUTTING comments were one
 * block: an un-amended `//` statement wedged between the `../complex.ts`
 * `ChatbotSchema` JSDoc's `*\/` and the declaration passed the whole pin, and so
 * did an un-amended JSDoc stacked directly above that JSDoc — each inheriting
 * its compliant neighbour's precondition and its roster slot, so a human read
 * five statements where this file counted four. The control that says the
 * instrument was not simply blind: the same stacked JSDoc WITH a blank line
 * reds 4. ⛔ The prose was already right — it is the code that now says it.
 *
 * ⚠️ This is a boundary rule, ⛔ not a rule about statements, so it re-cuts
 * every abutting pair in the package and ⛔ not only the two shapes that
 * escaped. Re-derived here rather than remembered, by this same oracle: at this
 * head `packages/types/src` holds 3 `*\/`→`//` pairs, 13 `*\/`→`/**`, 1
 * `*\/`→`/*`, 11 `//`→`/**` and 1 `//`→`/*`, 29 in all, and the block count
 * over the package goes 4696 → 4725 — one new cut per pair, exactly.
 * ⚠️ None of the 29 states the rule: `statements` is the same 4 blocks at the
 * same four line spans before and after, and `trailing` is 9 both ways ⇒ no
 * count anything here asserts moves. The `//`→`/**` shape was already caught
 * before this change and still is; ⛔ that is measured in both directions, not
 * inferred from the zero.
 *
 * ⭐ A comment RIDING ON a code line is its own one-line block, kind
 * `trailing`. It was outside every population this file enumerates until the
 * fourth in-seat review appended a `//` statement of the rule to an `export
 * interface` line and watched the whole pin pass: the code said "runs of
 * comment-only lines" while the header claimed "nothing that matches". ⛔ The
 * word was not narrowed to fit the code — the code was widened to fit the
 * word, because a statement of the rule is a statement of the rule whatever
 * punctuation it rides in on. Measured on this package while widening it: 9
 * such comments exist and none states the rule, so the widening moves no
 * count that anything else here asserts.
 */
const blocksOf = (file: string, text: string): Block[] => {
  const { comment } = scanSource(text);
  const out: Block[] = [];
  let run: Run | null = null;
  let offset = 0;
  let lineNumber = 0;

  for (const line of text.split('\n')) {
    lineNumber += 1;
    let flagged = 0;
    let bare = 0;
    let riding = '';
    for (let i = 0; i < line.length; i += 1) {
      const inComment = comment[offset + i];
      if (inComment) riding += line[i];
      if (/\s/.test(line[i])) continue;
      if (inComment) flagged += 1;
      else bare += 1;
    }
    const commentOnly = flagged > 0 && bare === 0;

    if (commentOnly) {
      const kind = kindOf(line);
      // A `*/` closed the previous line's run, or this line opens a different
      // kind ⇒ the run ends here and a new one starts, exactly as a blank line
      // would have ended it.
      if (run && (run.closed || run.kind !== kind)) {
        out.push(close(file, run, lineNumber - 1));
        run = null;
      }
      if (!run) run = { line: lineNumber, text: '', kind, closed: false };
      run.text += `${line}\n`;
      if (kind === 'jsdoc' && /\*\/$/.test(line.trimEnd())) run.closed = true;
    } else {
      if (run) {
        out.push(close(file, run, lineNumber - 1));
        run = null;
      }
      if (flagged > 0) {
        out.push({ file, line: lineNumber, endLine: lineNumber, kind: 'trailing', flat: flatten(riding) });
      }
    }
    offset += line.length + 1;
  }
  if (run) out.push(close(file, run, lineNumber));

  return out;
};

/** A run being accumulated: its kind is fixed by its first line, and `closed` marks a `*\/` already seen. */
interface Run {
  line: number;
  text: string;
  kind: 'jsdoc' | 'line';
  closed: boolean;
}

const close = (file: string, run: Run, endLine: number): Block => ({
  file,
  line: run.line,
  endLine,
  kind: run.kind,
  flat: flatten(run.text),
});

/**
 * The kind one comment-only LINE belongs to. `//` opens a `line` run;
 * everything else — `/**`, a bare `/*`, and a `*` continuation — is `jsdoc`.
 * ⛔ Read per LINE and ⛔ not per block: that is what makes a change of kind a
 * run boundary rather than something the first line silently decides for every
 * line glued behind it.
 */
const kindOf = (line: string): 'jsdoc' | 'line' => (line.trimStart().startsWith('//') ? 'line' : 'jsdoc');

const allBlocks: Block[] = sourceFiles(SRC).flatMap((file) =>
  blocksOf(file.slice(SRC.length + 1), readFileSync(file, 'utf8')),
);
const statements = allBlocks.filter((block) => STATES_THE_RULE.test(block.flat));
const label = (block: Block): string => `${block.file} (block opening on line ${block.line})`;

/**
 * The clauses of the rule this pin can name, one regex each.
 *
 * ⚠️ This list is what "the four agree" means here, and it is ⛔ not "every
 * clause a future amendment could add": a clause worded past all six is
 * invisible, exactly as `MobileComponentConfig`'s paraphrase was to the probe
 * on objectui#9684. `a-prong-beyond-the-two` exists because the measured
 * escape was a THIRD prong added at one site and nowhere else. It catches
 * `prong 3`, `third prong`, any `(3)`, and `or` followed by `3`, `iii`,
 * `third` or `thirdly`.
 *
 * ⛔ Read that list as the reach, ⛔ never a paraphrase of it. Stated exactly,
 * because FOUR summaries of it have now been falsified: `prong 3`, `third
 * prong` and a parenthesised `(3)` are caught wherever they fall in the block,
 * HOWEVER the clause is joined; `3`, `iii`, `third` and `thirdly` are caught
 * ONLY directly behind `or`, with nothing in between but commas, whitespace
 * and opening parentheses — ANY NUMBER of them, in ANY ORDER. Everything else
 * is silent — every other numbering, every clause that numbers nothing, and
 * those four numberings behind any other word.
 *
 * ⚠️ The four falsified summaries, in order: it required `(3) it`, so `(3) the`
 * was silent; then it called the silent case "a clause that numbers nothing",
 * so `(iii)`, `3.` and `thirdly` were silent; then it split the silent set into
 * "a different numbering" and "a clause that numbers nothing", so
 * `, and (iii) …` was in neither. ⭐ The fourth is the one that moved the
 * PATTERN rather than the sentence: the separator was written `,?\s*\(?`, which
 * admits a comma, then whitespace, then a parenthesis IN THAT ORDER ONLY, while
 * every sentence above it named a SET of permitted characters. So `, or ( 3 ) …`
 * (whitespace after the parenthesis) and `, or ,3 …` (a comma after whitespace)
 * contained nothing any published sentence forbade and passed — found at the
 * fifth in-seat review. ⛔ The sentence was not patched to describe the order:
 * an order nobody can restate from memory is the defect, ⛔ not the wording of
 * it, and this paragraph had already been rewritten three times around it. The
 * separator is now the set its sentence always claimed, `[\s,(]*`, which is a
 * strict SUPERSET of the old one ⇒ ⛔ no wording that was caught became silent,
 * and the four silent examples named in the header are silent still — each
 * re-measured through this pin rather than re-reasoned.
 */
const CLAUSES: Readonly<Record<string, RegExp>> = {
  'available-only-on-a-surviving-carrier': /tombstone is available only on a surviving[- ]carrier/i,
  'a-whole-type-name-has-no-carrier': /whole exported type name has no carrier/i,
  'used-when-either-prong-holds': /when either prong/i,
  'prong-1-a-named-live-replacement': /authors to a named live replacement/i,
  'prong-2-keeps-loud-a-taught-key': /keeps? loud a key the docs taught as working/i,
  'a-prong-beyond-the-two': /\bprong 3\b|\bthird prong\b|\(3\)|\bor[\s,(]*(?:3|iii|third(?:ly)?)\b/i,
};

const clausesOf = (block: Block): string[] =>
  Object.entries(CLAUSES)
    .filter(([, pattern]) => pattern.test(block.flat))
    .map(([name]) => name)
    .sort();

/**
 * The statements that SURVIVE in `complex.ts`, and the clause set each carries.
 *
 * Derived from the tree, not guessed, and recorded here on purpose: this is the
 * roster the next amendment has to move through. Amend one statement and its
 * set stops matching, so the edit cannot land at one site while its three peers
 * go quiet — which is the failure this whole card is about, and which the
 * precondition assertion alone does NOT catch (a clause added at one site and
 * nowhere else passes it).
 *
 * ⇒ when the rule is genuinely amended, this roster is the ONE place that has
 * to change, and changing it means looking at all four.
 */
const SURVIVING_STATEMENTS: ReadonlyArray<{ name: string; anchor: string; carries: string[] }> = [
  {
    name: 'KanbanColumn.color',
    anchor: 'RETIRED with the declarative face (objectui#7664',
    carries: [
      'a-whole-type-name-has-no-carrier',
      'available-only-on-a-surviving-carrier',
      'prong-1-a-named-live-replacement',
      'prong-2-keeps-loud-a-taught-key',
      'used-when-either-prong-holds',
    ],
  },
  {
    name: 'ChatbotSchema (the statement this package cites)',
    anchor: 'Chatbot component — the authoring face',
    carries: [
      'a-whole-type-name-has-no-carrier',
      'available-only-on-a-surviving-carrier',
      'prong-1-a-named-live-replacement',
      'prong-2-keeps-loud-a-taught-key',
      'used-when-either-prong-holds',
    ],
  },
  {
    name: 'displayMode',
    anchor: 'ADR-0049 RETIREMENT TOMBSTONE — `displayMode`',
    // ⚠️ Records a real asymmetry rather than hiding it: this statement does not
    // carry the whole-type-name half. Bringing it into line edits published
    // JSDoc, which is the open decision on objectui#9684.
    carries: [
      'available-only-on-a-surviving-carrier',
      'prong-1-a-named-live-replacement',
      'prong-2-keeps-loud-a-taught-key',
      'used-when-either-prong-holds',
    ],
  },
  {
    name: 'triggerIcon',
    anchor: 'ADR-0049 RETIREMENT TOMBSTONE — `triggerIcon`',
    // ⚠️ Same: this one abbreviates the prongs into the either-prong clause and names
    // only the one that applies, so it carries neither prong clause.
    carries: [
      'a-whole-type-name-has-no-carrier',
      'available-only-on-a-surviving-carrier',
      'used-when-either-prong-holds',
    ],
  },
];

/** The clauses every surviving statement carries — the agreement floor. */
const SHARED_BY_ALL = ['available-only-on-a-surviving-carrier', 'used-when-either-prong-holds'];

describe('objectui#9684 — the detector can fail, and does not fire on everything', () => {
  // A control that cannot fail is the instrument this card was filed about.
  const unamended =
    '// Removed outright rather than tombstoned, on this package\n' +
    '// two-prong discriminator: a tombstone exists (1) to steer\n' +
    '// authors to a named live replacement KEY, or (2) to keep\n' +
    '// loud a key the docs taught as working.\n';
  const amended =
    '// Removed outright: a `?: never` tombstone is available only on a\n' +
    '// SURVIVING CARRIER, and on such a carrier it is used when either\n' +
    '// prong holds.\n';
  const merelyMentions =
    '// RETIRED (objectui#0000): the key is gone. A tombstone would have\n' +
    '// kept the refusal loud, and this retirement did not need one.\n';

  it('a statement that omits the precondition is caught, even though it wraps mid-phrase', () => {
    const [block] = blocksOf('synthetic.ts', unamended);
    expect(STATES_THE_RULE.test(block.flat)).toBe(true);
    expect(CARRIES_PRECONDITION.test(block.flat)).toBe(false);
  });

  it('a statement that carries the precondition passes, wrapping and all', () => {
    const [block] = blocksOf('synthetic.ts', amended);
    expect(STATES_THE_RULE.test(block.flat)).toBe(true);
    expect(CARRIES_PRECONDITION.test(block.flat)).toBe(true);
  });

  it('prose that merely mentions a tombstone is not in the population', () => {
    const [block] = blocksOf('synthetic.ts', merelyMentions);
    expect(STATES_THE_RULE.test(block.flat)).toBe(false);
  });
});

describe('objectui#9684 — every statement of the rule carries its precondition', () => {
  it('VACUITY CONTROL: `complex.ts` states the rule at exactly the recorded sites', () => {
    // Both directions, and EXACTLY — an inequality is what let a FIFTH fully
    // amended statement pass at the second in-seat review, which is how "four
    // sites", written in this header, in the `mobile.ts` preamble and in the
    // changeset, came to be re-derived by nothing (AGENTS.md #9). One more
    // statement of one rule is the duplication this card is about, so it reds
    // and whoever adds it records it in the roster on purpose.
    const inComplex = statements.filter((block) => block.file === 'complex.ts');
    expect(
      inComplex.length,
      `complex.ts states the rule at ${inComplex.length} sites, the roster records ` +
        `${SURVIVING_STATEMENTS.length}: ${inComplex.map(label).join(', ')}. A site added — ` +
        'record it. A site converted to a citation — drop it. Neither — a marker in ' +
        'STATES_THE_RULE no longer matches and this file is measuring less than it says.',
    ).toBe(SURVIVING_STATEMENTS.length);
    expect(inComplex.every((block) => block.kind === 'jsdoc')).toBe(true);
  });

  it('every statement in `complex.ts` is one the roster names', () => {
    const inComplex = statements.filter((block) => block.file === 'complex.ts');
    const unrecorded = inComplex
      .filter((block) => !SURVIVING_STATEMENTS.some(({ anchor }) => block.flat.includes(anchor)))
      .map(label);
    expect(unrecorded, 'these statements of the rule are in no roster entry, so nothing holds them to their peers').toEqual(
      [],
    );
  });

  it('no file outside `complex.ts` states the rule AT ALL — not a prong, not a clause', () => {
    // ⭐ The scope is the PACKAGE, and it is the fourth in-seat review that
    // moved it there: a fully amended statement prepended to `data-display.ts`
    // passed every assertion in this file. Held to its precondition alone, off
    // the roster, invisible to `SHARED_BY_ALL` — which is checked over
    // `complex.ts` survivors only — it was free to drift at the next
    // amendment with nothing red. A fifth statement regrowing one file over is
    // the mechanism objectui#9684 was filed about, so the zero is asserted
    // rather than described. ⚠️ Non-vacuous by the exact-count control above,
    // not by itself: a dead marker prints this same empty list.
    const outside = statements.filter((block) => block.file !== 'complex.ts');
    expect(
      outside.map(label),
      'these blocks state the retire-vs-remove rule outside `complex.ts`, where nothing holds ' +
        'them to their peers — one more copy to amend, and silent when the next amendment ' +
        'misses it. State it in `complex.ts` and record it in the roster, or cite ' +
        '`ChatbotSchema` the way `mobile.ts` does.',
    ).toEqual([]);
  });

  it('no statement omits the surviving-carrier precondition (objectui#7678)', () => {
    const drifted = statements.filter((block) => !CARRIES_PRECONDITION.test(block.flat));
    expect(
      drifted.map(label),
      'these blocks state the retire-vs-remove rule without the precondition objectui#7678 ' +
        'added — a reader landing there concludes a whole exported type name is a tombstone ' +
        'candidate, which is what the amendment exists to deny',
    ).toEqual([]);
  });
});

describe('objectui#9684 — `mobile.ts` cites the rule instead of restating it', () => {
  const mobile = readFileSync(resolve(SRC, 'mobile.ts'), 'utf8');
  const mobileBlocks = blocksOf('mobile.ts', mobile);
  const retirements = ['MobileResponsiveConfig', 'MobileOverrides', 'GestureConfig', 'MobileComponentConfig'];

  const noteFor = (name: string): Block | undefined =>
    mobileBlocks.find(
      (block) => block.kind === 'line' && /RETIRED \(objectui#/.test(block.flat) && block.flat.includes(name),
    );

  it.each(retirements)('the `%s` note cites the statement on `ChatbotSchema`', (name) => {
    const note = noteFor(name);
    expect(note, `no retirement note naming ${name} found in mobile.ts`).toBeDefined();
    expect(note!.flat).toMatch(/`ChatbotSchema` in `complex\.ts`/);
  });

  it('no block in this file states the rule AT ALL — not a prong, not a clause', () => {
    // ⛔ Not "writes the prongs out", which is what this asserted and what the
    // second in-seat review walked through: a note restating the precondition
    // and the either-prong clause, with the prongs left unwritten, satisfied
    // the prong check and put this file back on the amendment surface for that
    // clause with nothing red. The claim was "never restates it"; the
    // assertion is now the claim.
    const restating = mobileBlocks.filter((block) => STATES_THE_RULE.test(block.flat));
    expect(
      restating.map(label),
      'mobile.ts states the rule again: it is back on the amendment surface and every ' +
        'amendment is an N-site hand edit once more',
    ).toEqual([]);
  });

  it('nor does any of the four write the prongs out', () => {
    // Kept beside the wider assertion for the message it prints: this is the
    // shape the conversion removed, so a re-inlined prong says so by name.
    const restating = mobileBlocks.filter((block) => WRITES_THE_PRONGS_OUT.test(block.flat));
    expect(restating.map(label), 'a prong is written out again in mobile.ts').toEqual([]);
  });

  it('the notes are `//` comments, which declaration emit does not carry into the `.d.ts`', () => {
    // The structural half of the `.d.ts` asymmetry: JSDoc on an exported member
    // is carried, a `//` comment is not — measured on objectui#9684 including a
    // `//` comment placed directly above an exported declaration, so the
    // dividing line is the comment FORM and ⛔ not where the comment sits.
    for (const name of retirements) {
      expect(noteFor(name)!.kind).toBe('line');
    }
  });
});

describe('objectui#9684 — the citation target is where the citations say it is', () => {
  const complex = readFileSync(resolve(SRC, 'complex.ts'), 'utf8');
  const complexBlocks = blocksOf('complex.ts', complex);

  it('`ChatbotSchema`’s own JSDoc states the rule, precondition included', () => {
    const declarationLine = complex.slice(0, complex.indexOf('export interface ChatbotSchema')).split('\n').length;
    expect(complex).toContain('export interface ChatbotSchema');

    // The block that ENDS on the line above the declaration is its JSDoc. Found
    // through the shared scanner like every other block here, never by a
    // private docblock regex over raw source — this file forbids that answer to
    // "is this span a comment" in its own header, and a lookup is no exception.
    const doc = complexBlocks.find((block) => block.endLine === declarationLine - 1);
    expect(doc, '`ChatbotSchema` has no JSDoc block directly above it to carry the rule').toBeDefined();
    expect(doc!.kind).toBe('jsdoc');
    expect(STATES_THE_RULE.test(doc!.flat)).toBe(true);
    expect(CARRIES_PRECONDITION.test(doc!.flat)).toBe(true);
  });
});

describe('objectui#9684 — this file does not state the rule either, and that is enforced here', () => {
  it('no comment block in this pin matches its own `STATES_THE_RULE`', () => {
    // ⭐ The claim used to sit in the header as prose while the header itself
    // matched this marker — five statements in the tree, four guarded, and the
    // fifth denying it was one. `sourceFiles` skips `__tests__` by design (a
    // pin quoting a fixture is not a site to amend), so nothing else reaches
    // this file: it holds itself to its own rule or the claim comes out.
    const self = fileURLToPath(import.meta.url);
    const own = blocksOf('the pin itself', readFileSync(self, 'utf8')).filter((block) =>
      STATES_THE_RULE.test(block.flat),
    );
    expect(
      own.map((block) => `line ${block.line}`),
      'this file quotes the rule it guards. Cite it instead — `../complex.ts` holds the ' +
        'statements, and a quotation here is one more copy to amend, invisible to the ' +
        'population because tests are outside it.',
    ).toEqual([]);
  });
});

describe('objectui#9684 — the four surviving statements move together, or go red', () => {
  const survivors = statements.filter((block) => block.file === 'complex.ts');

  it.each(SURVIVING_STATEMENTS)('the $name statement carries exactly its recorded clauses', ({ anchor, carries }) => {
    const block = survivors.find((candidate) => candidate.flat.includes(anchor));
    expect(block, `no statement in complex.ts opens with ${anchor}`).toBeDefined();
    expect(
      clausesOf(block!),
      'this statement of the rule no longer carries the clauses the roster records. If the ' +
        'rule was amended, amend all four and move the roster once — an amendment that lands ' +
        'at one site and leaves its peers alone is the exact failure objectui#9684 was filed ' +
        'for, and it is silent everywhere else.',
    ).toEqual([...carries].sort());
  });

  it('every surviving statement carries the clauses they all share', () => {
    const missing = survivors
      .filter((block) => !SHARED_BY_ALL.every((clause) => CLAUSES[clause].test(block.flat)))
      .map(label);
    expect(missing, 'these statements no longer agree with their peers on the shared clauses').toEqual([]);
  });

  it('VACUITY CONTROL: the roster still resolves to four distinct blocks', () => {
    // Without this, an anchor that stops matching would take its assertion out
    // of the run rather than fail it.
    const resolved = SURVIVING_STATEMENTS.map(({ anchor }) => survivors.find((b) => b.flat.includes(anchor))?.line);
    expect(resolved.filter((line) => line !== undefined)).toHaveLength(SURVIVING_STATEMENTS.length);
    expect(new Set(resolved).size).toBe(SURVIVING_STATEMENTS.length);
  });
});
