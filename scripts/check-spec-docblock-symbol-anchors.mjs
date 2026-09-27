#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-spec-docblock-symbol-anchors (#17065) -- the `packages/spec/src/**`
 * registration of the shared symbol-anchor resolver.
 *
 *   node scripts/check-spec-docblock-symbol-anchors.mjs
 *   node scripts/check-spec-docblock-symbol-anchors.mjs --list
 *   node scripts/check-spec-docblock-symbol-anchors.mjs --list-unresolvable
 *   node scripts/check-spec-docblock-symbol-anchors.mjs --present-tense
 *   node scripts/check-spec-docblock-symbol-anchors.mjs --self-test
 *
 * ⚠️ THE MECHANISM IS NOT HERE. The grammar, the extractor, the comment-prose
 * projection and the resolution rule all live in `scripts/symbol-anchors.mjs`,
 * whose header is authoritative and worth reading before this one. This file is
 * a `defineCorpus` call, a population declaration and an exit contract -- the
 * same deliberately thin shape as `scripts/check-adr-symbol-anchors.mjs` and
 * `scripts/check-scripts-symbol-anchors.mjs`, and ⛔ NOT a second resolver. The
 * 2026-09-01 ruling on #13556 is explicit that a corpus joins by registration:
 * 「与 #13788 已裁方向同构,**共享同一个 resolver**,⛔ 不造第二套」.
 *
 * ## The measured failure (#17065)
 *
 * A `path:NNN` written inside a `packages/spec/src` doc block was, until this
 * registration, in NEITHER direction of every corpus: not resolved, and not
 * refused. It is the same both-ways hole #15765 closed for `scripts/**`, and
 * the bill for leaving it open had already been paid by hand FOUR times --
 * #13003 (the liveness ledger's citations), #16441 (seven sites, seven for
 * seven), #16960 (three more, still open at registration) and the
 * `packages/spec/liveness/field.json` `_note` re-anchoring. Four separate
 * hand-conversions, all in the same direction, none of them mechanical. The
 * convention was never in question; the READER was missing.
 *
 * ## The census this gate was registered against
 *
 * ⭐ THE CENSUS CAME FIRST AND THE EXIT CONTRACT SECOND, on purpose. `#17065`
 * wrote the order hard -- *"The population is UNMEASURED and must not be
 * written as zero or guessed. … A gate switched on before the census is a first
 * run of unknown redness."* `CENSUS_17065` below is that measurement, taken in
 * `--list` / `--list-unresolvable` reporting mode before a single exit code was
 * chosen.
 *
 * The instrument matters more than the number, exactly as it did for
 * `scripts/**`, because three instruments give three answers on one tree:
 *
 *   198  raw `extractAnchors` over the whole file    -- includes CODE, so it
 *                                                       counts spec's own
 *                                                       fixtures and test data
 *   189  through `scripts/symbol-anchors.mjs#commentProse` -- doc prose only
 *     6  ...and the cited path names a TRACKED FILE  -- what this gate judges
 *
 * ⭐ AND THE HEADLINE IS HOW SMALL THE JUDGED POPULATION IS: 7 hard findings
 * across 6 of 1,317 files. That is a GATE, not a migration -- which is the
 * distinction `#17065`'s re-grade trigger asked to be measured, and it is the
 * opposite of what `docs/adr/**` found (243 of 337 broken, 72.1%, a one-way
 * LOWER bound, recorded in `scripts/check-scripts-symbol-anchors.mjs`).
 *
 * ⚠️ That answer is CONDITIONAL ON THE SCOPE CALL one paragraph down, and the
 * conditionality is part of the reading rather than a footnote to it: with
 * `judgeUntrackedLineAnchors` flipped to `true` the same tree yields 189
 * findings on day one, which WOULD be a migration. The small number is not a
 * claim that spec doc blocks are clean; it is a statement about the citations a
 * resolver living in THIS repo can bind.
 *
 * ## What this corpus judges, and what it declines to
 *
 * `judgeUntrackedLineAnchors: false`, the same call `scripts/**` made, and here
 * it is load-bearing rather than incidental: 183 of the 189 live citations name
 * no tracked file, and the dominant reason is that spec doc blocks cite the
 * SIBLING objectui repo (`SchemaRenderer.tsx:253,264`,
 * `packages/fields/src/widgets/SliderField.tsx:14`) and abbreviate in-repo
 * paths to a bare filename (`engine.ts:346`, `record-validator.ts:471`). A gate
 * living here cannot resolve either class, and a gate whose only remedy is
 * "stop writing that" is the permanently-red gate this repo retired.
 *
 * ⭐ DECLINING TO JUDGE IS NOT DECLINING TO SEE, and on this corpus that
 * distinction has a name attached: the three `objectql/engine.ts:NNNN` sites
 * that #16960 owns are written as a bare `objectql/engine.ts` -- no tracked
 * file at that path -- so they are DECLINED here, not judged. ⚠️ This gate
 * would not have caught them, and saying so in the header is the point: the
 * fourth set it stops from being found by hand is the set written with a
 * repo-root path. The abbreviated population is enumerated by
 * `--list-unresolvable` so it stays a worklist rather than a number, which is
 * the shape #15809 gave the same residual for `scripts/**`.
 *
 * `checkBarePaths: false`, and this one was measured rather than assumed:
 * judging every bare path code span here produces **2,290** findings out of
 * 2,635 spans. Of those spans 346 name a tracked file at the repo root and 610
 * resolve only when prefixed with `packages/spec/src/` -- spec doc blocks
 * habitually cite package-relative -- leaving 1,679 (758 distinct) that bind
 * against neither base. That is the same call `docs/adr/**` made at 1,056 and
 * `scripts/**` at 1,617.
 *
 * ⭐ What it DOES judge is the whole of the grammar otherwise: a `path:NNN`
 * naming a tracked file is REFUSED, a symbol anchor must have a declaration
 * site in the file it names, and a file-level anchor with a `#fragment` must
 * name a file the tree really has.
 *
 * ## The exit contract, and why it is a pinned residual rather than reporting
 *
 * `#17065` left the exit contract to the census, and the census forces this
 * shape. All 7 findings live in `packages/spec/**` TEXT, which that card ⛔
 * forbids this lane from editing -- repairing a spec doc block is `domain:spec`
 * work and belongs to a repair card (#16960 is one). So the two honest options
 * were a gate that can never fail, or a gate that fails on everything except a
 * dated, enumerated, shrink-only day-one residual.
 *
 * A gate that can never fail is the verifier AGENTS.md names as worse than no
 * verifier, so this one is ON: `CENSUS_RESIDUAL` pins the 7 sites the census
 * found and **every finding outside it is a hard red from day one**. That is
 * precisely the property #17065 asked for -- the fourth set does not have to be
 * found by hand.
 *
 * ⛔ `CENSUS_RESIDUAL` IS NOT AN EXEMPTION LIST. It is exact in both
 * directions, held there by the self-test: a row whose site no longer carries a
 * live finding is STALE and reds until it is DELETED, so repairing a citation
 * forces the row out in the same PR. It pins the citation TEXT rather than the
 * line, because a row keyed by line number would be a line anchor inside the
 * line-anchor gate -- rotting the first time anyone adds a paragraph above it.
 *
 * ## What a red means, and how to clear it
 *
 * [line-anchor]        A `path:NNN` naming a tracked file. Cite the symbol
 *                      instead -- `path#symbolName` -- or drop to a file-level
 *                      `path`. Both stay checked; a line number does not.
 *                      ⚠️ If the number is a DATED RECORD rather than a
 *                      pointer -- a census row, a measurement taken on a named
 *                      sha -- the repair is to keep every digit and stop
 *                      writing it in ANCHOR FORM: name the file as a
 *                      file-level anchor and put the number beside it as data.
 * [unresolved-symbol]  The file is there, the symbol is not.
 * [unresolved-path]    No tracked file at that path. In this corpus that is
 *                      usually a PACKAGE-RELATIVE spelling: write the path from
 *                      the repo root (`packages/spec/src/…`), which is the base
 *                      every corpus in this family resolves against.
 * [bad-exemption]      An `anchor-exempt` marker naming no valid class.
 * [stale-residual]     A `CENSUS_RESIDUAL` row whose site is clean now. Delete
 *                      the row.
 *
 * ⛔ MAINTAINER-ONLY: adding an `anchor-exempt` marker, and adding a
 * `CENSUS_RESIDUAL` row. Both make this gate quieter instead of satisfying it.
 * An author whose anchor will not resolve fixes the ANCHOR.
 *
 * ## Cross-repo anchors are REPORTED, never red
 *
 * Same ruled fallback as the other two corpora: an `objectui:`-prefixed anchor
 * is verified only when `$OBJECTUI_CHECKOUT` is set, and is otherwise listed as
 * skipped with the gate green.
 *
 * ⚠️ A corpus of TypeScript carries a shape the prose corpora do not: the
 * `repo:` prefix in the grammar is a bare lowercase word, so ANY convention
 * spelling a bare word, a colon and a path inside a doc block reads as a
 * cross-repo anchor -- written here in words rather than in the form itself,
 * because this header is swept by the `scripts/**` corpus and the form would
 * land as a finding against this file.
 * `packages/spec/src/shared/retired-key-migrate-sentence.test.ts` documents its
 * own corpus labels that way and lands 3 soft `cross-repo-skipped` rows. Soft
 * is the correct disposition -- they are reported and never red -- but the rows
 * are noise rather than signal, and the next author to read this report should
 * know why they are there.
 *
 * ## The present-tense report -- REPORT-ONLY, and it never touches the exit code
 *
 * A second, separate reading rides this corpus, ruled on #19017 (ruling record
 * `5805901449`, letter 甲 「只报告」). A doc block that states the repository's
 * own state in the PRESENT TENSE -- "always `true` this phase", "the real bit
 * is a follow-up" -- turns false the day the thing it describes lands, and no
 * reader reds. The shape recurred three times (#18991, #17487, #16208); on
 * #18991 the rotted sentence read as a licence to delete a live parameter.
 *
 * ⛔ REPORT-ONLY. Each hit prints as a `📝 [present-tense]` line naming the
 * file, the line and the phrase, under one summary line. Nothing in that pass
 * can exit: it runs inside a catch that prints NOT MEASURED instead of
 * throwing, and it runs BEFORE the anchor verdict, so it prints on a red run
 * too and moves neither verdict. ⛔ It is never a required check, and ⛔ no dev
 * is dispatched on its output: a seat that reads a hit it judges still true
 * dismisses it in one line. Promoting it to a failing gate needs the
 * maintainer's own word, not an edit here.
 *
 * WHAT IT READS is this corpus's own population and projection: the files
 * `sweepCorpus` walked (its `byDoc`), through `commentProse`, so "doc block"
 * means what it means for the anchor gate -- EVERY comment, line and block,
 * and never code or a string literal. Minus test sources, which this family
 * never excluded before; the definition is borrowed from the package's own
 * test runner, whose `local` project includes every `.test.ts` under `src/`
 * (`packages/spec/vitest.config.ts`). Comment delimiters and the JSDoc gutter
 * are blanked and whitespace is folded across lines, so a phrase wrapped over
 * two lines is one hit, reported at the line it starts on. Matching is
 * case-insensitive and whole-word.
 *
 * THE LIST is `PRESENT_TENSE_PHRASES`, exactly the four the ruling names, and
 * it GROWS ONLY BY A MEASURED NEAR-ZERO FALSE-POSITIVE READING: a new phrase
 * arrives with its own count in `PRESENT_TENSE_CENSUS`, taken with this
 * instrument at a named sha, and the self-test reds on a listed phrase that
 * carries no reading. ⛔ Wide phrases stay out: `there is no` alone reads 320
 * comment-prose hits today (`PRESENT_TENSE_REFUSED_WIDE`).
 *
 * TODAY'S READING (`PRESENT_TENSE_CENSUS.measuredOn`; 1,046 non-test sources
 * read, 504 test sources skipped), per phrase: `this phase` 0,
 * `is a follow-up` 0, `not yet implemented` 1, `currently no` 0. The one hit
 * is a trailing line comment glossing what the `NOT_IMPLEMENTED` error code
 * means, and it is still true. The same instrument on the card's own tree
 * reads 2, 1, 1, 0: the three #18991 sites, found -- the positive control. The
 * card's own probe also counted one `currently no`; that one sits in a string
 * literal, outside this projection.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitFreeEnv } from './git-env.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { ANCHOR_GRAMMAR, commentProse, defineCorpus, sweepCorpus } from './symbol-anchors.mjs';

/* ── The declared path population (#13519 / check-declared-population-live) ───
 * These literals ARE the population this gate reads, and the self-test holds
 * them against the corpus registration below, so a moved surface reddens here
 * rather than turning this gate silently inert. */
export const SPEC_SRC_DIR = 'packages/spec/src';
export const ROOT_DIR_WATCH_HINTS = ['packages/spec/src/**'];

/**
 * The census this gate was registered against, kept as data so the report can
 * state what the surface was when the corpus joined. ⛔ Historical
 * measurements, not a budget to spend.
 *
 * Reproduce any row with `--list` / `--list-unresolvable` at `measuredOn`.
 */
export const CENSUS_17065 = {
  measuredOn: '08e38c63771849c4e50fce9bac8e079c45e37b6a',
  tsFilesTotal: 1317,
  rawLineCitations: 198,
  commentProseLineCitations: 189,
  trackedTargetLineCitations: 6,
  trackedTargetFiles: 5,
  hardFindings: 7,
  hardFindingFiles: 6,
  declinedCitations: 183,
  declinedByShape: { 'bare-filename': 69, 'directory-qualified': 62, continuation: 52 },
  softCrossRepoRows: 3,
  /* The bare-path axis, measured for the `checkBarePaths: false` call. Spec doc
   * blocks cite package-relative far more often than they cite from the repo
   * root, which is why `barePathsResolvingOnlySpecRelative` is its own row. */
  barePathSpans: 2635,
  barePathsTrackedAtRepoRoot: 346,
  barePathsResolvingOnlySpecRelative: 610,
  barePathsBindingNeitherBase: 1679,
  barePathFindingsIfJudged: 2290,
  /* ⚠️ The comparison the re-grade trigger asked for, kept beside the number so
   * nobody has to reconstruct which instrument produced it. `docs/adr/**` was
   * 243 of 337, 72.1%. This corpus is 7 findings across 6 of 1,317 files. */
  adrPrecedentRotRate: '72.1%',
  /* What the SAME tree yields if the scope call is reversed -- the reading that
   * makes the small number honest rather than reassuring. */
  findingsIfUntrackedWereJudged: 189,
};

/**
 * ⚠️ THE RE-CENSUS (#17242) -- the DECLINED residual, taken again and
 * CLASSIFIED. `CENSUS_17065` above is frozen at its own sha and is ⛔ not
 * restated or corrected here; the two are separate readings of one surface.
 *
 * ⭐ THIS RECORD EXISTS AS DATA BECAUSE THIS GATE CANNOT RE-DERIVE IT. The
 * classification below needs a checkout of the sibling objectui repo, which
 * this gate is deliberately not given -- the same reason its cross-repo
 * anchors are reported rather than judged. `--list-unresolvable` enumerates
 * the residual, and that much any reader can reproduce.
 *
 * ⚠️ The two classifications are NOT equally reproducible, and saying "only an
 * outside reading can say what the rows ARE" flattered the weaker one. The
 * BINDING split is re-runnable: its predicate is written out below and carried
 * as data, so a reader holding both checkouts at the named shas lands on these
 * cells. The TENSE split is not: the classifier that produced its three rows
 * exists NOWHERE in this repository, so ⛔ NOTHING can re-derive it -- no
 * reader, no checkout, no instrument. Those three rows are one round's reading
 * and nothing more, and the row-level tense claim that DOES carry weight is
 * the enumerated one below, which was read by hand.
 *
 * ## The population grew, and the instrument did NOT move it
 *
 * The declined count read 183 at the `CENSUS_17065` sha, 217 two days later,
 * and 467 here. The shared resolver was rewritten between the second and third
 * readings, so this tree was swept with BOTH resolvers: they return the
 * identical 467, declined-by-shape included. ⇒ the growth is real population,
 * ⛔ NOT instrument drift, and the three numbers are comparable. The old
 * resolver also reproduced `commentProseLineCitations` and `declinedCitations`
 * verbatim at the `CENSUS_17065` sha, which is what licenses that comparison.
 *
 * ## ⭐ What the residual IS -- the headline, and it is not rot
 *
 * Every declined citation was bound against the sibling objectui checkout and
 * against this repo under a spec-relative base. 462 of 467 name a file that
 * REALLY EXISTS. ⇒ this residual is a SPELLING population -- abbreviated
 * cross-repo and package-relative citations -- ⛔ not the stale-citation rot
 * its headline number suggests, and ⛔ not the shape #17591 measured on the
 * bare-path axis.
 *
 * ⛔ A MOVING REF IS NOT AN ANCHOR. Both sibling trees are named by sha in the
 * record itself -- `objectuiPinSha` and `objectuiMainSha` -- beside the
 * objectstack tree the sweep ran on, `boundAgainstSha`. Naming "objectui's
 * main" and stopping there was the earlier form of this sentence and it was
 * not a reading. The two objectui trees agree ROW BY ROW, ⛔ not merely in the
 * totals: all 467 rows land on the same verdict against the pin and against
 * main (`objectuiPinAndMainAgreeRowwise`), so the split does not depend on
 * which sibling tree is read.
 *
 * ## The BINDING PREDICATE -- stated, so the cells can be re-run
 *
 * A round that publishes a three-way split owes the predicate that produced
 * it: two harnesses disagreeing on the cells while agreeing on the total
 * differ in their PREDICATE, never in their arithmetic.
 *
 *   1. TOKEN. A declined row carrying a path of its own uses it. A row
 *      carrying none -- a continuation -- inherits one by an ANTECEDENT WALK:
 *      project the source with `commentProse`, take the maximal run of lines
 *      non-blank after trimming that contains the citation (its own comment
 *      block), scan that block forward as far as the citation, and keep the
 *      LAST path-shaped token before it. `bindingTokenPattern` carries that
 *      token grammar verbatim. ⛔ The walk is BACKWARD-only and BLOCK-local, so
 *      a block naming its file only AFTER the continuation, or not at all,
 *      yields no token and the row binds nowhere.
 *   2. RESOLUTION, first hit wins, objectui before here within each tier:
 *      exact tracked path, then TAIL match -- a tracked path equal to the
 *      token, or ending in a slash followed by it. The tail tier is what binds
 *      the package-relative spellings on both sides, the spec-relative ones
 *      included.
 *   3. ⚠️ WHERE IT IS LENIENT, named because the leniency is what moves rows
 *      between repos: a token carrying NO slash has nothing but its basename
 *      to match on, so its tail match IS a basename match and a generic
 *      basename can attribute to the wrong repo. A token that DOES carry a
 *      directory keeps it -- this predicate ⛔ does NOT fall back to the
 *      basename there. `bindingUnderDirectoryLenientVariant` is the same
 *      reading with that fallback ON; it moves exactly one row.
 *   4. TIE-BREAK. A token resolving in BOTH trees is credited to objectui, and
 *      `ambiguousBothTrees` records how many rows that decides.
 *
 * ⚠️ These cells MOVED off the ones the first round published, and the
 * predicate above is the whole reason: it is stricter about directory-
 * qualified tokens and it walks comment BLOCKS rather than whole files. ⛔ The
 * earlier cells are not restated here as though they had been re-measured;
 * what stands is what this predicate yields.
 *
 * ## Tense -- the defect cell is EMPTY, and the rows are NAMED
 *
 * A citation naming no tracked file is a defect ONLY when the surrounding
 * sentence is LIVE-TENSE. The rows binding nowhere are ENUMERATED in
 * `bindingInNeitherRepoRows`, each carrying the coordinate it was read at in
 * the named tree, its citation text, why no tree binds it, and the tense of
 * the sentence around it. Not one is live-tense: one is a retirement record
 * naming a file in the `cloud` repo in prose (`packages/spec/src/ai/agent.zod.ts`);
 * three are continuations inside dated re-reads at a named objectui pin whose
 * own block names no file before them (`packages/spec/src/ui/component.zod.ts`);
 * and one is an objectui citation whose DIRECTORY spelling is stale while its
 * basename is not (`packages/spec/src/ui/dashboard.zod.ts`). ⇒ ZERO live-tense
 * defects -- held now by a list a reader can check, ⛔ not by a sentence that
 * could not be reconciled with the tree.
 *
 * ## ⛔ THE TRAP, measured -- repairing the PATH alone turns this gate RED
 *
 * The obvious cleanup is to rewrite a package-relative citation to its
 * repo-root spelling so it resolves. That makes the path TRACKED, which moves
 * the citation out of the declined set and into the judged one -- where a line
 * number is exactly what this gate refuses. One such repair was performed on a
 * single citation in `packages/spec/src/shared/union-author-message-pins.test.ts`
 * and this gate went from green to one hard finding, then was restored.
 *
 * ⇒ the path is only HALF the repair; the citation must also leave ANCHOR
 * FORM. A round that "works the residual down" by fixing spellings alone lands
 * one finding per repair.
 */
export const RECENSUS_17242 = {
  measuredOn: 'fa29803417cbb4853f4dbb54ae7a830457e11bb8',
  tsFilesTotal: 1518,
  commentProseLineCitations: 473,
  trackedTargetLineCitations: 6,
  declinedCitations: 467,
  declinedFiles: 39,
  declinedByShape: { 'bare-filename': 144, continuation: 191, 'directory-qualified': 132 },
  /* Same tree, the resolver `CENSUS_17065` was taken with. Equal by both
   * readings -- the control that makes 183 -> 467 a population statement. */
  declinedUnderPreviousResolver: 467,
  /* ── The cross-repo reading's ANCHORS ──────────────────────────────────────
   * ⛔ A moving ref is not an anchor, so every tree this split was taken
   * against is a sha here rather than a branch name in prose. The binding
   * sweep ran on the objectstack tree `boundAgainstSha`, whose `packages/spec`
   * subtree is byte-identical to `measuredOn`'s -- the only file differing
   * between the two commits is this gate -- so the declined population it read
   * is the same 467 rows recorded above.
   *
   * ⭐ That byte-identity is also what lets the self-test's reality pin read
   * `.objectui-sha` at `measuredOn` rather than here. It matters because the two
   * anchors have different LIFETIMES, not different contents: `measuredOn` is a
   * commit this branch was cut from, `boundAgainstSha` is a commit ON it, and a
   * squash merge leaves only the first resolvable. The pin block in `selfTest()`
   * states the consequence and takes both. Where both resolve, it requires
   * `.objectui-sha` to read `objectuiPinSha` at each; ⛔ it compares no other
   * file, so the byte-identity above is not checked by it. */
  boundAgainstSha: 'cdd68cf15ed863468ce6eecdd5c0824b760ea22a',
  objectuiPinSha: '87af769e9a3ee28ace099fdd653d3ebd79fe82e2',
  objectuiMainSha: '0cf2d6644bdb96a9a6784ef801ee6a60a5306bd8',
  /* ⭐ Stronger than "the totals matched": every one of the 467 rows lands on
   * the same verdict, with the same inherited token, against both trees. */
  objectuiPinAndMainAgreeRowwise: true,
  /* ── The split, under the predicate the header states ──────────────────────
   * ⭐ The split #17242 filed as NOT MEASURED. Continuations carry no path of
   * their own and are attributed by the header's antecedent walk: 188 of the
   * 191 continuations inherit a token that way, 3 inherit none and bind
   * nowhere, and the other 276 carry their own path. */
  namingAnExistingObjectuiFile: 409,
  namingAnExistingFileHere: 53,
  bindingInNeitherRepo: 5,
  /* ⛔ The same 467 rows split by HOW each one got the token it was bound by --
   * the sentence above, carried as data because a via-split stated in prose and
   * held by nothing is the defect this whole record exists to stop. The two
   * `antecedent` cells ARE the continuations, so they must sum to the
   * `continuation` shape count, and all three must exhaust the declined
   * population. The rows that inherit NO token are the three `via: 'antecedent'`
   * entries enumerated below -- which is what ties this cell to a list a reader
   * can check rather than to a number nobody can open. */
  bindingVia: Object.freeze({ ownPath: 276, antecedentInherited: 188, antecedentNoToken: 3 }),
  /* The token grammar the antecedent walk keeps the LAST match of. Carried as
   * data so the predicate is copyable rather than paraphrased.
   *
   * ⭐ What keeps a `tsx` citation from being eaten as `ts` -- which would
   * silently re-point the token at a file that does not exist -- is the
   * TRAILING NEGATIVE LOOKAHEAD, ⛔ NOT the longest-first alternation: a `ts`
   * arm FAILS that lookahead when the next character is `x`, and the engine
   * backtracks into the `tsx` arm. Measured on this pattern, both ways round: a
   * shortest-arm-first alternation returns the IDENTICAL token, and removing
   * the lookahead while keeping longest-first also truncates nothing -- only
   * removing BOTH truncates. ⇒ the ordering is a redundant second guard, and it
   * is the lookahead the self-test pins. */
  bindingTokenPattern: String.raw`(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.-]+\.(?:tsx|ts|mts|cts|jsx|js|mjs|cjs)(?![A-Za-z0-9_])`,
  /* How many rows resolve in BOTH trees and are decided by the objectui-first
   * tie-break alone. Every one of them is a bare basename. */
  ambiguousBothTrees: 5,
  /* The declared sensitivity: the same reading with the basename fallback
   * extended to directory-qualified tokens. It moves exactly one row out of
   * `bindingInNeitherRepo`, which is the whole distance between a strict and a
   * lenient reading of this corpus. */
  bindingUnderDirectoryLenientVariant: Object.freeze({ objectui: 410, here: 53, neither: 4 }),
  /* ⛔ THE ENUMERATION, because a cell nobody can list is a cell nobody can
   * check. `line` is a COORDINATE into `boundAgainstSha`, ⛔ not an anchor: a
   * row's identity is its document plus its citation TEXT, and the number is
   * here only so a reader can open the tree at the named sha and land on it.
   * ⚠️ What the self-test does with that identity, stated as what it DOES: it
   * requires every row to CARRY both, and it refuses two rows that share them.
   * It does ⛔ NOT key a live lookup off them the way `CENSUS_RESIDUAL`'s triage
   * does -- this reading is frozen at the shas above, so there is no live
   * finding for a row to be matched against. `tense` was read BY HAND, one row
   * at a time -- the classifier that produced the three tense totals above
   * exists nowhere and cannot be asked. */
  bindingInNeitherRepoRows: Object.freeze([
    {
      doc: 'packages/spec/src/ai/agent.zod.ts',
      line: 253,
      raw: 'knowledge-tools.ts:96',
      token: 'knowledge-tools.ts',
      via: 'own-path',
      why: 'the prose names the `cloud` repo, which is a third tree neither side of this reading holds',
      tense: 'record',
    },
    {
      doc: 'packages/spec/src/ui/component.zod.ts',
      line: 2921,
      raw: '`:227`',
      token: null,
      via: 'antecedent',
      why: 'its block names the file it continues only AFTER the citation, and the walk is backward-only',
      tense: 'dated-measurement',
    },
    {
      doc: 'packages/spec/src/ui/component.zod.ts',
      line: 2922,
      raw: '`:237`',
      token: null,
      via: 'antecedent',
      why: 'its block names the file it continues only AFTER the citation, and the walk is backward-only',
      tense: 'dated-measurement',
    },
    {
      doc: 'packages/spec/src/ui/component.zod.ts',
      line: 3921,
      raw: '`:359`',
      token: null,
      via: 'antecedent',
      why: 'its block cites a read point in the sibling repo without naming any file at all',
      tense: 'dated-measurement',
    },
    {
      doc: 'packages/spec/src/ui/dashboard.zod.ts',
      line: 1118,
      raw: 'plugin-view/ObjectView.tsx:989',
      token: 'plugin-view/ObjectView.tsx',
      via: 'own-path',
      why: 'the basename is live in objectui, the DIRECTORY spelling is not, and this predicate keeps directories',
      tense: 'dated-measurement',
    },
  ]),
  /* The tense axis, over the whole residual. `record` and `dated-measurement`
   * are both correct historical prose; only `live` can carry a defect, and it
   * carries none because every live-tense row names a file that exists.
   * ⛔ These three totals are the ONE part of this record nothing can re-derive
   * -- the classifier that produced them was never committed, so they are a
   * round's reading and must not be read as a measurement a reader can check.
   * The tense claim that IS checkable is the per-row one on
   * `bindingInNeitherRepoRows`, which is where `liveTenseDefects: 0` is held. */
  liveTenseCitations: 300,
  historicalRecordCitations: 38,
  datedMeasurementCitations: 129,
  liveTenseDefects: 0,
};

/**
 * The CLOSED tense vocabulary an enumerated `bindingInNeitherRepoRows` row may
 * carry. Closed on purpose: `liveTenseDefects: 0` is held by asserting that no
 * enumerated row is `live`, and an open vocabulary turns that assertion into a
 * spelling test -- a row typed `live-tense` or `current` would pass a
 * not-equal-to-`live` check while meaning exactly what the check exists to
 * catch.
 */
export const NEITHER_ROW_TENSES = Object.freeze(['record', 'dated-measurement', 'live']);

/**
 * The CLOSED `via` vocabulary an enumerated `bindingInNeitherRepoRows` row may
 * carry, and the counterpart of the tense vocabulary above. Closed for the same
 * reason: `bindingVia.antecedentNoToken` is held by COUNTING the rows typed
 * `antecedent`, so a row typed `antecedent-walk` would leave that count short
 * while reading, to a human, exactly like the rows it meant to join.
 */
export const NEITHER_ROW_VIAS = Object.freeze(['own-path', 'antecedent']);

/**
 * The trailing guard of `RECENSUS_17242.bindingTokenPattern`, carried as its
 * own constant so the self-test can pin its PRESENCE rather than restate the
 * mechanism in a message.
 *
 * ⭐ This is the part that does the work the record's comment describes: with
 * it, a shorter extension arm cannot match a longer extension's prefix, because
 * the character after that prefix is one this guard refuses. Without it, the
 * alternation's ORDER becomes load-bearing -- a far weaker guarantee, since
 * re-ordering an alternation reads as tidying.
 */
export const BINDING_TOKEN_TAIL_GUARD = String.raw`(?![A-Za-z0-9_])`;

/**
 * The repo-root file in which this repository records the sibling objectui
 * commit it is pinned to. Named once, as data, so the self-test's frozen
 * reality pin reads it at a sha rather than restating the path in prose.
 */
export const OBJECTUI_PIN_FILE = '.objectui-sha';

/**
 * ⚠️ THE DAY-ONE RESIDUAL -- the findings the census enumerated, pinned.
 *
 * This is NOT an exemption list and NOT a softening of the grammar. Every row
 * is a real finding, printed on every run, and its repair is named. What a row
 * buys is that a citation which was ALREADY THERE when this corpus joined does
 * not fail the build in the PR that merely registers the corpus -- because
 * repairing it means editing `packages/spec/**` text, which is `domain:spec`
 * work with its own card (#16960 is the live one), not this registration's.
 *
 * ⛔ A row is EXACT IN BOTH DIRECTIONS and the self-test holds it there:
 *
 *   - it must still match a LIVE finding, so the day the citation is repaired
 *     the row goes stale and this gate reds until it is DELETED. A residual
 *     nobody can retire is an exemption wearing a date.
 *   - it must name the repair, so the next reader inherits a worklist.
 *
 * ⛔ It is keyed by `doc` + `raw` + `count`, never by LINE. A row carrying a
 * line number would be a line anchor inside the gate that refuses line anchors,
 * and it would rot the first time anyone added a paragraph above the citation.
 * `count` is pinned so a SECOND copy of the same citation in the same file is a
 * new finding rather than something an existing row absorbs.
 *
 * ⛔ SHRINK-ONLY. Adding a row is maintainer-only; the remedy for a new finding
 * is to fix the anchor.
 */
export const CENSUS_RESIDUAL = Object.freeze([
  {
    doc: 'packages/spec/src/api/websocket.zod.ts',
    raw: '`contracts/realtime-service.ts#RealtimeSubscriptionOptions`',
    kind: 'unresolved-path',
    count: 1,
    dated: '2026-09-09',
    repair: 'the symbol is real — write the path from the repo root, '
      + '`packages/spec/src/contracts/realtime-service.ts#RealtimeSubscriptionOptions`',
  },
  {
    doc: 'packages/spec/src/conversions/registry.ts',
    raw: 'packages/rest/src/import-mapping.ts:115-167',
    kind: 'line-anchor',
    count: 1,
    dated: '2026-09-09',
    repair: 'cite the symbol in `packages/rest/src/import-mapping.ts`, or drop to a file-level anchor',
  },
  {
    doc: 'packages/spec/src/data/filter-array-declaration.test.ts',
    raw: 'examples/app-showcase/src/ui/pages/my-work.page.ts:52',
    kind: 'line-anchor',
    count: 1,
    dated: '2026-09-09',
    repair: 'cite the symbol in `examples/app-showcase/src/ui/pages/my-work.page.ts`, or drop to a file-level anchor',
  },
  {
    doc: 'packages/spec/src/kernel/metadata-plugin.zod.ts',
    raw: 'docs/adr/0005-metadata-customization-overlay.md:53-64',
    kind: 'line-anchor',
    count: 1,
    dated: '2026-09-09',
    repair: 'cite the ADR heading as a file-level anchor — an ADR section is not a symbol',
  },
  {
    doc: 'packages/spec/src/kernel/metadata-plugin.zod.ts',
    raw: 'docs/adr/0005-metadata-customization-overlay.md:57',
    kind: 'line-anchor',
    count: 1,
    dated: '2026-09-09',
    repair: 'cite the ADR heading as a file-level anchor — an ADR section is not a symbol',
  },
  {
    doc: 'packages/spec/src/system/http-server.zod.ts',
    raw: 'packages/runtime/src/middleware.ts:4,59',
    kind: 'line-anchor',
    count: 1,
    dated: '2026-09-09',
    repair: 'cite the two symbols in `packages/runtime/src/middleware.ts`, or drop to a file-level anchor',
  },
  {
    /* ⚠️ A DATED RECORD, not a pointer: the sentence writes the sha it was
     * measured on. The repair keeps every digit and stops writing it in anchor
     * form — the file as a file-level anchor, the number beside it as data. */
    doc: 'packages/spec/src/ui/action-params.zod.ts',
    raw: '`:1183`',
    kind: 'line-anchor',
    count: 1,
    dated: '2026-09-09',
    repair: 'a continuation carrying a sha-dated measurement — keep the digits as DATA beside the '
      + 'file-level anchor `packages/runtime/src/action-execution.ts`, not in anchor form',
  },
]);

export const CORPUS = defineCorpus({
  id: 'spec-docblocks',
  label: 'packages/spec/src/** (protocol schema doc blocks, comment prose only)',
  docRoots: [SPEC_SRC_DIR],
  docPattern: /\.ts$/,
  docProjection: commentProse,
  judgeUntrackedLineAnchors: false,
  crossRepos: { objectui: { checkoutEnv: 'OBJECTUI_CHECKOUT' } },
});

/** The key a residual row and a finding are matched on. ⛔ Never the line. */
export function residualKey(row) { return `${row.doc} :: ${row.raw}`; }

/**
 * Split a sweep's findings against the pinned residual.
 *
 * Returns `hard` (fails), `soft` (reported), `pinned` (findings a row covers)
 * and `stale` (rows nothing matches any more — those fail too, in the opposite
 * direction, which is what keeps the residual shrink-only in practice and not
 * merely in prose).
 */
export function triage(findings, residual = CENSUS_RESIDUAL) {
  const budget = new Map();
  for (const row of residual) budget.set(residualKey(row), { row, left: row.count, used: 0 });

  const hard = [];
  const soft = [];
  const pinned = [];
  for (const f of findings) {
    if (f.soft) { soft.push(f); continue; }
    const slot = budget.get(residualKey(f));
    if (slot && slot.left > 0) { slot.left -= 1; slot.used += 1; pinned.push({ ...f, row: slot.row }); continue; }
    hard.push(f);
  }
  const stale = [...budget.values()].filter((s) => s.used < s.row.count).map((s) => ({ row: s.row, matched: s.used }));
  return { hard, soft, pinned, stale };
}

/* ── The present-tense report (REPORT-ONLY; see the header) ─────────────────── */

/**
 * The phrases the report prints. Exactly the four the ruling names. ⛔ A phrase
 * joins only with a measured near-zero false-positive reading recorded in
 * `PRESENT_TENSE_CENSUS`; the self-test reds on a listed phrase without one.
 */
export const PRESENT_TENSE_PHRASES = Object.freeze(['this phase', 'is a follow-up', 'not yet implemented', 'currently no']);

/**
 * ⛔ Wide phrases the ruling keeps OUT, with the comment-prose reading that
 * keeps them out, taken with this instrument at `PRESENT_TENSE_CENSUS.measuredOn`.
 * The self-test holds this set disjoint from the list.
 */
export const PRESENT_TENSE_REFUSED_WIDE = Object.freeze({ 'there is no': 320 });

/**
 * A test source, by the package's own test runner's definition: the `local`
 * project in `packages/spec/vitest.config.ts` includes every `.test.ts` under
 * `src/`. The anchor gate above has no test exclusion, so this is the report's
 * alone.
 */
export const PRESENT_TENSE_TEST_SOURCE = /\.test\.ts$/;

/** The CLOSED judgement vocabulary a census row may carry. */
export const PRESENT_TENSE_JUDGEMENTS = Object.freeze(['still-true', 'rotted']);

/**
 * The readings the list was admitted on. ⛔ Historical measurements, frozen at
 * their shas and held only by the self-test's internal pins, never against the
 * live tree: pinning a reading to the tree would turn a report into a ratchet.
 * `line` is a COORDINATE into `measuredOn`, never an anchor. `judgement` was
 * read by hand, one row at a time.
 */
export const PRESENT_TENSE_CENSUS = Object.freeze({
  measuredOn: '5581d3000f27daa19991cf9d13d5ad1ed8cf8913',
  nonTestSources: 1046,
  testSourcesSkipped: 504,
  hits: Object.freeze({ 'this phase': 0, 'is a follow-up': 0, 'not yet implemented': 1, 'currently no': 0 }),
  rows: Object.freeze([
    {
      doc: 'packages/spec/src/api/errors.zod.ts',
      line: 114,
      phrase: 'not yet implemented',
      judgement: 'still-true',
      why: 'a trailing line comment glossing what the NOT_IMPLEMENTED error code means: a definition, not a claim about the repository',
    },
  ]),
  /* The same instrument on the tree the card's own census was taken on: the
   * positive control. The three `api-derivation.ts` rows are the sites #18991
   * repaired; the card's probe also counted one `currently no`, a string
   * literal this projection never reads. */
  cardTree: Object.freeze({
    measuredOn: '43f4766889e39d7a4590c5787d38e5956d0b4cb6',
    nonTestSources: 1000,
    hits: Object.freeze({ 'this phase': 2, 'is a follow-up': 1, 'not yet implemented': 1, 'currently no': 0 }),
    rows: Object.freeze([
      {
        doc: 'packages/spec/src/data/api-derivation.ts',
        line: 129,
        phrase: 'this phase',
        judgement: 'rotted',
        why: 'the user-level export bit this sentence called always true had already been wired',
      },
      {
        doc: 'packages/spec/src/data/api-derivation.ts',
        line: 130,
        phrase: 'is a follow-up',
        judgement: 'rotted',
        why: 'the same sentence, calling that already-landed wiring a follow-up',
      },
      {
        doc: 'packages/spec/src/data/api-derivation.ts',
        line: 196,
        phrase: 'this phase',
        judgement: 'rotted',
        why: 'the second copy of the always-true claim, on the option declaration itself',
      },
      {
        doc: 'packages/spec/src/api/errors.zod.ts',
        line: 114,
        phrase: 'not yet implemented',
        judgement: 'still-true',
        why: 'the same error-code gloss today reading still carries',
      },
    ]),
    refusedWide: Object.freeze({ 'there is no': 286 }),
  }),
});

/**
 * The comment prose of `source` folded to ONE line: `commentProse` first, then
 * comment delimiters and the JSDoc gutter blanked, then every whitespace run
 * (newlines included) collapsed to a single space. `offsets[i]` is the source
 * offset of `text[i]`, which is what lets a phrase wrapped over two lines be
 * reported at the line it starts on. The projection blanks and never deletes,
 * so every offset is an offset into the real file.
 */
export function foldCommentProse(source) {
  const prose = CORPUS.docProjection(source)
    .replace(/\/\*+|\*+\/|\/{2,}/g, (m) => ' '.repeat(m.length))
    .replace(/^([ \t]*)\*+/gm, (m, indent) => indent + ' '.repeat(m.length - indent.length));
  const parts = [];
  const offsets = [];
  for (const m of prose.matchAll(/\S+/g)) {
    if (parts.length > 0) { parts.push(' '); offsets.push(m.index - 1); }
    parts.push(m[0]);
    for (let k = 0; k < m[0].length; k += 1) offsets.push(m.index + k);
  }
  return { text: parts.join(''), offsets };
}

/** Case-insensitive, whole-word, global: `currently no` must not match `currently none`. */
function phrasePattern(phrase) {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
}

/**
 * Every hit of `phrases` in the non-test members of `docs` (paths relative to
 * `root`). Returns the hits sorted by file and line, plus how many sources
 * were read and how many test sources were skipped -- a skip is counted, so
 * "skipped" is told apart from "never handed over". Throws on an unreadable
 * source; `reportPresentTense` is the only caller that prints, and it catches.
 */
export function presentTenseHits(root, docs, phrases = PRESENT_TENSE_PHRASES) {
  const hits = [];
  let scanned = 0;
  let skippedTests = 0;
  for (const doc of docs) {
    if (PRESENT_TENSE_TEST_SOURCE.test(doc)) { skippedTests += 1; continue; }
    scanned += 1;
    const source = readFileSync(join(root, doc), 'utf8');
    const { text, offsets } = foldCommentProse(source);
    for (const phrase of phrases) {
      for (const m of text.matchAll(phrasePattern(phrase))) {
        const at = offsets[m.index];
        hits.push({
          doc,
          line: source.slice(0, at).split('\n').length,
          phrase,
          excerpt: text.slice(Math.max(0, m.index - 48), m.index + m[0].length + 48),
        });
      }
    }
  }
  hits.sort((a, b) => (a.doc === b.doc ? a.line - b.line : a.doc < b.doc ? -1 : 1));
  return { hits, scanned, skippedTests };
}

/**
 * Print the report. ⛔ REPORT-ONLY BY CONSTRUCTION: it has no exit path, sets
 * no exit code, and turns any throw into a NOT MEASURED line -- so it cannot
 * move the anchor gate's verdict in either direction. Returns the reading, or
 * `null` when none was taken.
 */
export function reportPresentTense(root, docs) {
  const notMeasured = (why) => console.log(
    `⚠️  present-tense report NOT MEASURED: ${why} — this report never fails the gate, so read a missing `
      + 'reading as missing, never as zero hits.',
  );
  try {
    const reading = presentTenseHits(root, docs);
    for (const h of reading.hits) {
      console.log(`📝 [present-tense] ${h.doc}:${h.line}  "${h.phrase}"\n      …${h.excerpt}…`);
    }
    if (reading.scanned === 0) {
      notMeasured(`0 non-test spec sources were read (${reading.skippedTests} test sources skipped), `
        + 'so the instrument is blind rather than the corpus clean');
      return reading;
    }
    const perPhrase = PRESENT_TENSE_PHRASES
      .map((p) => `"${p}" ${reading.hits.filter((h) => h.phrase === p).length}`).join(', ');
    console.log(
      `ℹ️  present-tense report (REPORT-ONLY, never fails): ${reading.hits.length} hit(s) over `
        + `${reading.scanned} non-test spec sources, ${reading.skippedTests} test sources skipped — ${perPhrase}. `
        + 'A hit judged still true is dismissed in one line; no hit is a failure.',
    );
    return reading;
  } catch (e) {
    notMeasured(e?.message ?? String(e));
    return null;
  }
}

/** `--present-tense`: the report alone, over the same population. Exits 0 whatever it reads. */
function presentTenseOnly(root = process.cwd()) {
  let docs;
  try {
    docs = [...sweepCorpus(CORPUS, root).byDoc.keys()];
  } catch (e) {
    console.log(`⚠️  present-tense report NOT MEASURED: the corpus sweep failed — ${e?.message ?? String(e)}`);
    return;
  }
  reportPresentTense(root, docs);
}

export function runCheck(root = process.cwd()) {
  const { findings, counts, byDoc } = sweepCorpus(CORPUS, root);
  const { hard, soft, pinned, stale } = triage(findings);

  if (counts.anchors === 0) {
    console.error(
      '❌ check-spec-docblock-symbol-anchors: the sweep found ZERO anchors in packages/spec/src/** — '
        + 'the extractor is broken, not the corpus clean.',
    );
    process.exit(1);
  }

  for (const f of soft) console.log(`ℹ️  [${f.kind}] ${f.doc}:${f.line}  ${f.raw}\n      ${f.detail}`);
  for (const f of pinned) {
    console.log(
      `⏳ [${f.kind}] ${f.doc}:${f.line}  ${f.raw}\n      ${f.detail}\n`
        + `      DAY-ONE RESIDUAL, dated ${f.row.dated} — repair: ${f.row.repair}\n`
        + '      Delete its CENSUS_RESIDUAL row in the same PR that repairs it.',
    );
  }

  // ⛔ REPORT-ONLY: printed before the verdict so a red run carries it too, and
  // `reportPresentTense` can neither exit nor throw, so `failed` below reads
  // exactly what it read before this line existed.
  reportPresentTense(root, [...byDoc.keys()]);

  const failed = hard.length > 0 || stale.length > 0;
  if (hard.length > 0) {
    console.error(`❌ check-spec-docblock-symbol-anchors: ${hard.length} finding(s) across ${counts.docs} spec sources.\n`);
    for (const f of hard) console.error(`  [${f.kind}] ${f.doc}:${f.line}  ${f.raw}\n      ${f.detail}`);
    console.error(`\nThe anchor grammar:\n  ${ANCHOR_GRAMMAR}`);
    console.error('\n⛔ MAINTAINER-ONLY: an `anchor-exempt` marker and a CENSUS_RESIDUAL row are not the remedy — fix the anchor.');
  }
  if (stale.length > 0) {
    console.error(`\n❌ check-spec-docblock-symbol-anchors: ${stale.length} STALE CENSUS_RESIDUAL row(s).\n`);
    for (const s of stale) {
      console.error(
        `  [stale-residual] ${s.row.doc}  ${s.row.raw}\n`
          + `      pinned ${s.row.count}, matched ${s.matched} — that citation is repaired or gone. DELETE the row.`,
      );
    }
  }
  if (failed) process.exit(1);

  console.log(
    `✅ check-spec-docblock-symbol-anchors: ${counts.anchors} anchors across ${counts.docs} spec sources resolve — `
      + `${counts.symbol} symbol (${counts.declaration} declaration, ${counts.literal} literal), `
      + `${counts.fileLevel} file-level, ${counts.crossRepo} cross-repo, ${counts.exempt} exempt, `
      + `${counts.continuation} continuation. 0 NEW line anchors on tracked targets survive `
      + `(${counts.unresolvableLineCitation} citations name no tracked file and are not judged; `
      + `${pinned.length} day-one residual finding(s) still pinned).`,
  );
}

function list(root = process.cwd()) {
  const { findings, counts, declined } = sweepCorpus(CORPUS, root);
  console.log(JSON.stringify({ counts, findings, declined, residual: CENSUS_RESIDUAL }, null, 2));
}

/**
 * The citations this corpus DECLINES to judge, enumerated.
 *
 * ⚠️ A listing, never a verdict: this exits 0 whatever it prints, exactly as
 * `--list` does. `runCheck()` is still the only arm that can fail.
 *
 * ⭐ On this corpus the residual is the interesting half of the census, and it
 * is where #16960's three `objectql/engine.ts:NNNN` sites live. The count alone
 * says a residual exists without saying where, so nobody can work it down and
 * nobody can tell a residual that SHRANK from one that moved. This prints
 * `file:line -- citation` per row and a tally by shape, which is what a
 * follow-up card needs to be closed rather than re-measured.
 */
function listUnresolvable(root = process.cwd()) {
  const { counts, declined } = sweepCorpus(CORPUS, root);
  const byShape = {};
  for (const d of declined) byShape[d.shape] = (byShape[d.shape] ?? 0) + 1;
  for (const d of declined) console.log(`${d.doc}:${d.line}  ${d.raw}   [${d.shape}]`);
  console.log(
    `\n${declined.length} citation(s) name no tracked file and are not judged `
      + `(counter: ${counts.unresolvableLineCitation}) — `
      + Object.entries(byShape).sort().map(([k, v]) => `${v} ${k}`).join(', '),
  );
}

/* ─────────────────────────────── self-test ─────────────────────────────── */

function assert(cond, msg) { if (!cond) { console.error(`❌ check-spec-docblock-symbol-anchors --self-test: ${msg}`); process.exit(1); } }

/**
 * The contents of `path` at `commit`, WITH THE CAUSE when there are none.
 *
 * ⛔ A single `null` was the previous shape and it is what made this readable as
 * one cause. `git show <commit>:<path>` fails in each of four cases -- git
 * missing, cwd not a repository, the commit absent, and the path absent at a
 * commit that is perfectly present -- so a caller handed one `null` can name a
 * cause only by guessing, and the caller here named the anchor's absence out loud
 * on a run where the anchor resolved fine. The four are separated here, before
 * the read, by two cheap probes:
 *
 *   'no-repo'        `git rev-parse --git-dir` fails: git is missing, or this
 *                    directory is not a repository. Nothing about any commit can
 *                    be established from here.
 *   'commit-absent'  the repository answers and `git cat-file -e <commit>^{commit}`
 *                    does not resolve: the literal names no commit of this
 *                    repository, or names one this clone does not hold. This
 *                    probe does not tell the two apart.
 *   'path-absent'    the commit IS an object here and `path` is not readable at it.
 *                    A hard failure, ⛔ never a skip: this is the state a renamed or
 *                    mistyped pin file produces, and reporting it as an unreachable
 *                    anchor switches the caller's guard off while telling the reader
 *                    to expect the skip.
 *   'ok'             `text` is the trimmed contents.
 *
 * ⛔ Callers must read every status but `'ok'` as NOT MEASURED, never as agreement,
 * and must name the status they were HANDED rather than whichever cause reads best.
 * It is spelled as a return rather than a throw because the caller decides, per
 * anchor, whether `'commit-absent'` is a skip.
 *
 * Spawned with `gitFreeEnv()` per the rule in `scripts/git-env.mjs`: these are
 * local reads that must resolve against the repository their `cwd` names, and an
 * inherited `GIT_DIR` would point them at a different one.
 *
 * @param {string} commit
 * @param {string} path
 * @returns {{ status: 'ok' | 'no-repo' | 'commit-absent' | 'path-absent', text: string | null }}
 */
function readTextAtCommit(commit, path) {
  const gitAnswers = (args) => {
    try {
      execFileSync('git', args, { env: gitFreeEnv(), stdio: ['ignore', 'ignore', 'ignore'] });
      return true;
    } catch {
      return false;
    }
  };
  if (!gitAnswers(['rev-parse', '--git-dir'])) return { status: 'no-repo', text: null };
  if (!gitAnswers(['cat-file', '-e', `${commit}^{commit}`])) return { status: 'commit-absent', text: null };
  try {
    return {
      status: 'ok',
      text: execFileSync('git', ['show', `${commit}:${path}`], {
        encoding: 'utf8',
        env: gitFreeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    };
  } catch {
    return { status: 'path-absent', text: null };
  }
}

/** `true` only when `git rev-parse --is-shallow-repository` answers `true`. */
function gitReportsShallow() {
  try {
    return execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() === 'true';
  } catch {
    return false;
  }
}

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// A module-level `assert()` that exits on the first failure used to be this
// shape's ONLY success condition, so "every case held" and "the cases never
// ran" printed the same line. What is pinned is the registered NAMES, not a
// number: the floor requires the OPENED set to equal the DECLARED set with
// each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
// ⛔ Three of these cases are registered PER `CENSUS_RESIDUAL` row (the
// exactness loop below runs three `check()`s over each row), so 21 of the 124
// are the 7 day-one rows, and REPAIRING a citation and deleting its row
// legitimately lowers this floor by 3 — that is the ONLY reason it may be
// lowered. Any other drop is cases that STOPPED RUNNING; find what stopped
// registering instead of moving the number.
//
// ⛔ A SECOND per-row loop registers seven cases per enumerated
// `bindingInNeitherRepoRows` row — 35 of the 124 — and it is NOT a second
// lowering reason. Those rows are a reading frozen at the shas the record
// names, so they are never repaired and never deleted; a drop there is the
// enumeration being edited away from the cell it is supposed to hold.
//
// ⛔ The number is READ OFF A PROBE, never derived from a diff: run the self-test
// with this entry raised to something unreachable and take the count its own floor
// message prints. 120 -> 124 was read that way.
//
// The present-tense report is its OWN battery, registered after every case
// above, so it cannot inflate the 124. Read off the same kind of probe: 38.
// None of its cases reads the live tree's hits, so no docblock edit anywhere
// can move this floor. A phrase added to the list adds cases here (its planted
// hit, its spawned line, and its row count in each of the two readings) — read
// the new number off the probe rather than adding it up.
const SELF_TEST_BATTERIES = Object.freeze({
  'check-spec-docblock-symbol-anchors self-test': 124,
  'present-tense report': 38,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 2;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-spec-docblock-symbol-anchors self-test reached its verdict';

export function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => { openBattery = name; };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  battery('check-spec-docblock-symbol-anchors self-test');
  const check = (cond, message) => { registerCase(); assert(cond, message); };

  // 1. ⭐ A synthetic corpus carrying one of EVERY finding class this
  //    registration can produce, plus the healthy forms and the shapes this
  //    corpus deliberately declines to judge — so "no findings" is told apart
  //    from "the rule stopped matching", and "declines" is told apart from
  //    "never saw it".
  const tmp = mkdtempSync(join(tmpdir(), 'check-spec-docblock-symbol-anchors-'));
  try {
    const write = (rel, body) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), body); };
    write('packages/spec/src/thing.ts', 'export function realSymbol() {}\nconst names = ["sys_thing"];\n// commentOnlySymbol is only named here\n');
    write('packages/spec/src/good.ts', [
      '/** A symbol anchor `packages/spec/src/thing.ts#realSymbol` resolves. */',
      '/* A data identifier `packages/spec/src/thing.ts#sys_thing` resolves as a literal. */',
      '/**',
      ' * A file-level anchor `packages/spec/src/thing.ts` resolves, and a continuation',
      ' * `packages/spec/src/thing.ts#realSymbol` then `#sys_thing`.',
      ' */',
      "const fixture = 'packages/spec/src/thing.ts:42';  // ⛔ CODE: a fixture, not a citation",
      'export const x = 1;',
    ].join('\n'));
    write('packages/spec/src/bad.ts', [
      '// A survived line anchor `packages/spec/src/thing.ts:42` must be found.',
      '/* A range `packages/spec/src/thing.ts:10-20` must be found. */',
      '// An en-dash range `packages/spec/src/thing.ts:30–40` must be found.',
      '// A missing symbol `packages/spec/src/thing.ts#noSuchSymbol` must be found.',
      '// A comment-only symbol `packages/spec/src/thing.ts#commentOnlySymbol` must be found.',
      '// A gone file `packages/spec/src/vanished.ts#whatever` must be found.',
      '// A bogus exemption `packages/spec/src/thing.ts:99` <!-- anchor-exempt: NOPE --> must be found.',
    ].join('\n'));
    // A SECOND failing source, so "a residual row covers only the citation it
    // names" is provoked against a corpus that still has something left to fail
    // on.
    write('packages/spec/src/also-bad.ts', '// Another survived line anchor `packages/spec/src/thing.ts:77` must be found.');
    write('packages/spec/src/declined.ts', [
      '// An untracked target `packages/spec/src/never-existed.ts:7` is NOT judged here.',
      '// A bare filename `thing.ts:8` is NOT judged here.',
      '// A PACKAGE-RELATIVE spelling `contracts/gone.ts:9` is NOT judged here — the live',
      '// corpus is full of them and no resolver here can bind one.',
      '// A bare path code span `some/abbreviated/spelling.ts` is NOT judged here.',
    ].join('\n'));
    write('packages/spec/src/exempt.ts', '// An excused anchor `packages/spec/src/gone.ts:7` <!-- anchor-exempt: HISTORICAL --> is silent.');
    /* The sweep reads `git ls-files`, so the fixture needs to be a repo — and
     * both children get an EXPLICIT, GIT_*-stripped environment (#16624). A
     * hook exports `GIT_DIR` into everything it runs and that outranks `cwd`,
     * so an inheriting `git init` here creates nothing and the inheriting
     * `git add -A` writes THE REPOSITORY's index instead. */
    execFileSync('git', ['init', '-q'], { cwd: tmp, env: gitFreeEnv() });
    execFileSync('git', ['add', '-A'], { cwd: tmp, env: gitFreeEnv() });

    const { findings, counts, declined } = sweepCorpus(CORPUS, tmp);
    const kinds = findings.map((f) => f.kind);
    const count = (k) => kinds.filter((x) => x === k).length;

    check(count('line-anchor') === 4, `4 line anchors (plain, hyphen range, EN DASH range, second file) must be found, got ${count('line-anchor')}`);
    check(count('unresolved-symbol') === 2, `2 unresolved symbols must be found, got ${count('unresolved-symbol')}`);
    check(count('bad-exemption') === 1, `an invalid exemption class must be a finding, got ${count('bad-exemption')}`);
    check(count('unresolved-path') === 1, `a vanished target must be a finding, got ${count('unresolved-path')}`);
    check(counts.exempt === 1, 'a valid exemption must be honoured exactly once');
    check(!findings.some((f) => f.doc.includes('good.ts')), 'the healthy source must produce no findings');
    check(counts.declaration >= 1 && counts.literal >= 1, 'both resolution classes must be exercised by the fixture');
    // ⭐ The projection, at CORPUS level rather than in the core's unit cases:
    // a citation living in a string literal is spec's own fixture data and must
    // not be a finding against the file that wrote it.
    check(!findings.some((f) => f.raw.includes('thing.ts:42') && f.doc.includes('good.ts')),
      'a citation inside a STRING LITERAL is code, not a doc citation — the corpus must sweep comment prose only');
    // ...and the DECLINED shapes are declined, not missed: they were seen and
    // counted, which is the difference between a scope call and a blind spot.
    check(!findings.some((f) => f.doc.includes('declined.ts')),
      'a citation naming no tracked file must not be a finding under judgeUntrackedLineAnchors: false');
    check(counts.unresolvableLineCitation === 3,
      `all three declined citations must be SEEN and counted, got ${counts.unresolvableLineCitation}`);
    check(declined.length === counts.unresolvableLineCitation,
      `the declined ENUMERATION must equal the declined COUNT, got ${declined.length} vs ${counts.unresolvableLineCitation}`);
    check(declined.every((d) => d.doc.includes('declined.ts') && Number.isInteger(d.line) && d.raw),
      'every declined row must carry the file, the line and the citation text it was declined for');
    // ⭐ The PACKAGE-RELATIVE spelling is this corpus's dominant declined shape
    // (610 of the live bare paths bind only against `packages/spec/src/`), so
    // it is pinned by shape rather than left to the general case.
    check(
      declined.map((d) => d.shape).sort().join(',') === 'bare-filename,directory-qualified,directory-qualified',
      `the declined rows must be classified by SHAPE, got ${declined.map((d) => d.shape).sort().join(',')}`,
    );

    // 2. The residual mechanism, in both directions, against the fixture.
    const fake = [{ doc: 'packages/spec/src/bad.ts', raw: 'packages/spec/src/thing.ts:42', kind: 'line-anchor', count: 1, dated: '2026-01-01', repair: 'fixture' }];
    const t = triage(findings, fake);
    check(t.pinned.length === 1, `a residual row must move exactly its own finding out of the failing set, got ${t.pinned.length}`);
    check(t.pinned.every((f) => f.doc === 'packages/spec/src/bad.ts'), 'a residual row must cover ONLY the citation it names');
    check(t.hard.every((f) => !(f.doc === 'packages/spec/src/bad.ts' && f.raw === 'packages/spec/src/thing.ts:42')), 'a pinned citation must not also fail');
    check(t.hard.length > 0, 'a residual row on one citation must not excuse the others — this corpus still reds');
    check(t.stale.length === 0, 'a row that matched must not be reported stale');
    const none = triage(findings, []);
    check(none.hard.length > t.hard.length, 'REMOVING the row must put that finding back — the row is load-bearing, not decorative');
    // ⛔ The OTHER direction, which is what keeps the residual shrink-only: a
    // row nothing matches is a finding of its own, not a silent pass.
    const ghost = triage(findings, [{ doc: 'packages/spec/src/bad.ts', raw: 'no/such/citation.ts:1', kind: 'line-anchor', count: 1, dated: '2026-01-01', repair: 'fixture' }]);
    check(ghost.stale.length === 1, `a row matching no live finding must be reported STALE, got ${ghost.stale.length}`);
    check(ghost.stale[0].matched === 0, 'a stale row must report how many findings it actually matched');
    // ...and a row is exact on its COUNT, so a second copy of the same citation
    // is a new finding rather than something an existing row absorbs.
    const twice = triage(
      [...findings, ...findings.filter((f) => f.doc === 'packages/spec/src/bad.ts' && f.raw === 'packages/spec/src/thing.ts:42')],
      fake,
    );
    check(twice.hard.some((f) => f.raw === 'packages/spec/src/thing.ts:42'),
      'a SECOND copy of a pinned citation must exceed the row\'s count and fail');
    // ⛔ And the key is the citation TEXT, never the line — a row must survive
    // the citation moving down the file, or the residual is a line anchor
    // inside the line-anchor gate.
    const moved = findings
      .filter((f) => f.doc === 'packages/spec/src/bad.ts' && f.raw === 'packages/spec/src/thing.ts:42')
      .map((f) => ({ ...f, line: f.line + 500 }));
    check(triage(moved, fake).pinned.length === 1, 'a residual row must still match after its citation moves line');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 3. The population guard: the declaration is read by ANOTHER tool
  //    (dispatch-gates / check-declared-population-live), so a wrong entry runs
  //    perfectly green here and shows up only as a dev who was never told this
  //    gate reads their surface.
  check(ROOT_DIR_WATCH_HINTS.every((h) => h.startsWith(SPEC_SRC_DIR)), 'every watch hint must be under the declared spec src dir');
  check(existsSync(SPEC_SRC_DIR), `the declared population must reach the tree: ${SPEC_SRC_DIR}`);
  check(CORPUS.docRoots.includes(SPEC_SRC_DIR), 'the corpus must sweep the population this gate declares');
  check(
    ROOT_DIR_WATCH_HINTS.every((h) => CORPUS.docRoots.includes(h.replace(/\/\*+$/, ''))),
    `the declared hints must name the roots the corpus sweeps: ${ROOT_DIR_WATCH_HINTS.join(', ')} vs ${CORPUS.docRoots.join(', ')}`,
  );

  // 4. ⭐ The live corpus is not empty, and the projection really is wired.
  //    This is the ONLY thing separating a clean tree from an extractor that
  //    silently matches nothing.
  const live = sweepCorpus(CORPUS);
  check(live.counts.anchors > 1000, `the live spec corpus must yield its anchors, got ${live.counts.anchors}`);
  check(live.counts.fileLevel > 1000, `the live corpus must resolve its file-level anchors, got ${live.counts.fileLevel}`);
  check(live.counts.docs > 1000, `the live corpus must sweep the spec sources, got ${live.counts.docs}`);
  check(CORPUS.docProjection === commentProse, 'the corpus must sweep COMMENT PROSE — a raw .ts corpus judges spec\'s own fixture data');
  check(CORPUS.docPattern.test('object.zod.ts') && !CORPUS.docPattern.test('object.zod.js'),
    'the corpus must select TypeScript sources — spec ships no .js source, and a .js pattern would sweep nothing');

  // 5. ⛔ Every residual row is EXACT IN BOTH DIRECTIONS against the LIVE tree.
  //    A row whose citation is repaired has done its job and must be DELETED;
  //    leaving it is how a dated residual becomes a permanent exemption nobody
  //    re-reads.
  const liveTriage = triage(live.findings);
  check(liveTriage.stale.length === 0,
    'every CENSUS_RESIDUAL row must still match a LIVE finding — a stale row is a repaired citation whose row was '
      + `not deleted: ${liveTriage.stale.map((s) => `${s.row.doc} ${s.row.raw}`).join(', ')}`);
  for (const row of CENSUS_RESIDUAL) {
    check(/^\d{4}-\d{2}-\d{2}$/.test(row.dated), `the residual row for \`${row.raw}\` must carry an ISO date, got \`${row.dated}\``);
    check(row.repair && row.repair.length > 20, `the residual row for \`${row.raw}\` must name its repair`);
    check(row.doc.startsWith(`${SPEC_SRC_DIR}/`), `a residual row may only name a file in this corpus, got \`${row.doc}\``);
  }
  // ...and it is the census's own number, so a row quietly added later reds.
  check(liveTriage.pinned.length === CENSUS_17065.hardFindings,
    `the pinned residual must equal the census's ${CENSUS_17065.hardFindings} hard findings, got ${liveTriage.pinned.length}`);
  check(liveTriage.hard.length === 0,
    `the live corpus must carry NO finding outside the day-one residual: ${liveTriage.hard.map((f) => `${f.doc} ${f.raw}`).join(', ')}`);

  // 6. The gate is wired to run. A gate nothing invokes is this repo's most
  //    carded defect class, and renaming a step silently detaches it.
  const workflow = readFileSync('.github/workflows/lint.yml', 'utf8');
  check(workflow.includes('node scripts/check-spec-docblock-symbol-anchors.mjs'), 'lint.yml must invoke this gate');
  check(workflow.includes('node scripts/check-spec-docblock-symbol-anchors.mjs --self-test'), 'lint.yml must invoke this gate\'s --self-test');

  // 7. The census declaration is intact, and its three instruments stay
  //    ordered — the ordering IS the reading (raw counts code, comment prose
  //    does not, and only some of those name a file this tree has).
  check(CENSUS_17065.rawLineCitations > CENSUS_17065.commentProseLineCitations, 'the raw instrument must count MORE than the comment-prose one');
  check(CENSUS_17065.commentProseLineCitations > CENSUS_17065.trackedTargetLineCitations, 'the comment-prose instrument must count more than the tracked-target one');
  // ⭐ The scope call's own arithmetic: judged + declined must exhaust the
  // comment-prose population, or one of the three numbers is a guess.
  check(
    CENSUS_17065.trackedTargetLineCitations + CENSUS_17065.declinedCitations === CENSUS_17065.commentProseLineCitations,
    `judged (${CENSUS_17065.trackedTargetLineCitations}) + declined (${CENSUS_17065.declinedCitations}) must exhaust `
      + `the comment-prose population (${CENSUS_17065.commentProseLineCitations})`,
  );
  check(
    Object.values(CENSUS_17065.declinedByShape).reduce((a, b) => a + b, 0) === CENSUS_17065.declinedCitations,
    'the declined shape tally must sum to the declined count',
  );
  // ⚠️ The conditional reading, pinned so it cannot be dropped from the header
  // while the reassuring number stays: reversing the scope call is a migration.
  check(CENSUS_17065.findingsIfUntrackedWereJudged > CENSUS_17065.hardFindings * 10,
    'the census must record what the SAME tree yields if the scope call is reversed — the small number is only '
      + 'honest beside it');
  // ...and the bare-path axis stays internally consistent.
  check(
    CENSUS_17065.barePathsTrackedAtRepoRoot + CENSUS_17065.barePathsResolvingOnlySpecRelative
      + CENSUS_17065.barePathsBindingNeitherBase === CENSUS_17065.barePathSpans,
    'the three bare-path resolution bases must exhaust the bare-path spans',
  );

  // 8. ⭐ THE RE-CENSUS, held exactly as case 7 holds the census above. Two
  //    records thirty lines apart in one file, one held by case 7's arithmetic
  //    and the other held by nothing, is how a record and the code it describes
  //    drift apart in silence — which is the defect class this whole corpus
  //    exists for. (⛔ Deliberately not "pinned N ways": a count of the pins
  //    above is itself an unheld number, and it was wrong in this comment's
  //    first spelling.)
  //    ⚠️ These pins are INTERNAL to the record, with ONE stated exception
  //    below, and that is deliberate: the reading is frozen at the shas it
  //    names, so holding a cell against the LIVE tree would turn a historical
  //    record into a ratchet that reds on every unrelated spec docblock edit.
  //    What they close is the other drift — a cell edited one at a time until
  //    the record says something no reading ever said.
  //    ⛔ What an internal pin CANNOT catch is a sentence ABOUT A TREE that
  //    nothing reading that tree holds — which is what the via sentence was. So
  //    where a pin against reality is both cheap and FROZEN, it is taken: the
  //    objectui-pin cases below are those, and they are the only ones here.
  //    ⚠️ "Cheap and FROZEN" does not by itself pick an anchor, and the previous
  //    spelling read that as if it did. Two of this record's shas are commits of
  //    this repository, and only `measuredOn` is an ancestor of main. The pin
  //    block below states which is which, and takes both.
  check(
    RECENSUS_17242.trackedTargetLineCitations + RECENSUS_17242.declinedCitations
      === RECENSUS_17242.commentProseLineCitations,
    `judged (${RECENSUS_17242.trackedTargetLineCitations}) + declined (${RECENSUS_17242.declinedCitations}) must `
      + `exhaust the re-census's comment-prose population (${RECENSUS_17242.commentProseLineCitations})`,
  );
  check(
    Object.values(RECENSUS_17242.declinedByShape).reduce((a, b) => a + b, 0) === RECENSUS_17242.declinedCitations,
    're-census: the declined shape tally must sum to the declined count',
  );
  check(RECENSUS_17242.declinedUnderPreviousResolver === RECENSUS_17242.declinedCitations,
    're-census: the previous resolver\'s reading is the control that makes 183 -> 467 a POPULATION statement — '
      + 'the two must stay equal or the control is gone');
  // ⭐ The cross-repo split's own arithmetic: the three binding cells must
  // exhaust the declined population, or one of them is a guess.
  check(
    RECENSUS_17242.namingAnExistingObjectuiFile + RECENSUS_17242.namingAnExistingFileHere
      + RECENSUS_17242.bindingInNeitherRepo === RECENSUS_17242.declinedCitations,
    `the three binding cells (${RECENSUS_17242.namingAnExistingObjectuiFile} / `
      + `${RECENSUS_17242.namingAnExistingFileHere} / ${RECENSUS_17242.bindingInNeitherRepo}) must exhaust the `
      + `declined population (${RECENSUS_17242.declinedCitations})`,
  );
  // ⭐ ...and so must the VIA split, which is the other arithmetic the record's
  // sentence makes. A row carrying no path of its own IS a continuation, so the
  // two antecedent cells must be exactly the `continuation` shape count — and
  // once they are, `ownPath` is forced to the other two shapes. Shipping that
  // split as prose with nothing holding it is how a wrong total (`279`) stood
  // twenty lines from the `declinedByShape` that contradicted it.
  const via = RECENSUS_17242.bindingVia;
  check(
    via.ownPath + via.antecedentInherited + via.antecedentNoToken === RECENSUS_17242.declinedCitations,
    `the via cells (${via.ownPath} own-path / ${via.antecedentInherited} inherited / ${via.antecedentNoToken} `
      + `inheriting none) must exhaust the declined population (${RECENSUS_17242.declinedCitations})`,
  );
  check(
    via.antecedentInherited + via.antecedentNoToken === RECENSUS_17242.declinedByShape.continuation,
    `the two antecedent cells (${via.antecedentInherited} + ${via.antecedentNoToken}) must be exactly the `
      + `continuations (${RECENSUS_17242.declinedByShape.continuation}) — a row with no path of its own is a `
      + 'continuation by definition, so any other total means the via split and the shape split were read over '
      + 'different rows',
  );
  // ...and so must the tense split, which is measured over the same rows.
  check(
    RECENSUS_17242.liveTenseCitations + RECENSUS_17242.historicalRecordCitations
      + RECENSUS_17242.datedMeasurementCitations === RECENSUS_17242.declinedCitations,
    `the three tense cells must exhaust the declined population (${RECENSUS_17242.declinedCitations})`,
  );
  // ⛔ A moving ref is not an anchor: every tree this split was taken against
  // must be a full sha, so a later reader can check it out. `measuredOn` is in
  // this list because the reality pin below READS AT IT — an anchor a case
  // depends on is one the format rule has to cover.
  for (const field of ['measuredOn', 'boundAgainstSha', 'objectuiPinSha', 'objectuiMainSha']) {
    check(/^[0-9a-f]{40}$/.test(RECENSUS_17242[field]),
      `\`${field}\` must be a full 40-character sha — a branch name, a short sha or a ref is not an anchor, `
        + `got \`${RECENSUS_17242[field]}\``);
  }
  // ⭐ THE REALITY PINS this battery takes, and there are TWO because the record
  // names two commits of this repository.
  //
  // The mechanism is one: this repo records the objectui commit it builds against
  // in its own pin file, so reading that file AT a tree the sweep stood on says
  // which sibling tree it was standing on. It must be `objectuiPinSha`.
  // ⛔ Read AT a sha, never from the working tree: the live pin moves, and a live
  // read would turn a frozen historical record into a ratchet that reds on every
  // unrelated objectui bump.
  //
  // ⚠️ WHICH sha decides whether the pin survives the merge, and the previous
  // spelling took the one that does not. `boundAgainstSha` is a commit on the
  // BRANCH carrying this record: a squash drops it from main's history, the read
  // stops resolving, and from then on `objectuiPinSha` is held by nothing but its
  // 40-hex format above. Measured, with a deliberately WRONG `objectuiPinSha` as
  // the lit control: it reds in a clone that fetched this branch, and passes in a
  // depth-1 clone of head and in a clone whose objects are main's.
  //
  // `measuredOn` is the other anchor the record already carries and it is an
  // ANCESTOR OF MAIN, so under `lint.yml`'s `fetch-depth: 0` checkout it resolves
  // on every run, before and after the squash. The pin file is byte-identical at
  // the two commits — the only file differing between them is this gate, which is
  // the record's own claim at `boundAgainstSha` — so reading at `measuredOn` reads
  // the same pin.
  //
  // ⇒ `measuredOn` is the PRIMARY pin: in a clone git does not report as shallow,
  // it is taken or this battery reds. `boundAgainstSha` is a SECOND one, skipped
  // wherever it names no commit in this clone.
  //
  // ⛔ NOT TAKEN is printed only for an anchor naming no commit in this clone, and
  // for the primary only when git reports the clone as shallow. Every other failed
  // read is a hard red: a renamed or mistyped pin file lands there at any anchor
  // that resolves, and so does a mistyped primary literal in a clone git does not
  // report as shallow.
  const realityPins = [
    ['primary', 'measuredOn', RECENSUS_17242.measuredOn],
    ['second', 'boundAgainstSha', RECENSUS_17242.boundAgainstSha],
  ].map(([role, field, commit]) => ({ role, field, commit, read: readTextAtCommit(commit, OBJECTUI_PIN_FILE) }));
  for (const { role, field, commit, read } of realityPins) {
    const shallow = read.status === 'commit-absent' && gitReportsShallow();
    const skipped = read.status === 'commit-absent' && (role === 'second' || shallow);
    if (skipped) {
      console.log(
        `   ⚠️ ${role} reality pin NOT TAKEN: \`${commit}\` (\`${field}\`) names no commit in this clone, which git `
          + `${shallow ? 'reports' : 'does not report'} as shallow, so \`${OBJECTUI_PIN_FILE}\` could not be read at it.`,
      );
    }
    // ⛔ Every failed read not `skipped` is a hard red, and the
    // message names the status it was HANDED rather than picking a cause — which
    // is the whole of what went wrong here. ⚠️ Measured: `no-repo` is not
    // reachable through `--self-test`, because the live-corpus sweep above asks
    // `git ls-files` and throws first; it is discriminated anyway so this caller
    // never has to infer it.
    check(read.status === 'ok' || skipped,
      `the ${role} reality pin was NOT taken, and not for a reason this battery skips: the read of `
        + `\`${OBJECTUI_PIN_FILE}\` at \`${commit}\` (\`${field}\`) answered \`${read.status}\`. \`commit-absent\` `
        + 'is a failure only for the primary anchor, in a clone git does not report as shallow — a mistyped '
        + '`measuredOn` in such a clone lands here. `path-absent` means the anchor RESOLVED and the pin file is not readable at it — a renamed or '
        + 'mistyped pin path lands here, and reporting that as an unreachable anchor is how this pin gets switched off '
        + 'while its own notice tells the reader to expect the skip. `no-repo` means `git rev-parse --git-dir` failed '
        + 'here. ⛔ In every case the pin is NOT MEASURED, and NOT MEASURED is not a pass.');
    check(read.status !== 'ok' || read.text === RECENSUS_17242.objectuiPinSha,
      `\`objectuiPinSha\` (${RECENSUS_17242.objectuiPinSha}) must be the objectui commit this repo was pinned to at `
        + `\`${field}\` — the pin file reads \`${read.text}\` there, so the binding sweep and this repo were standing `
        + 'on different sibling trees');
  }
  // ⭐ Where both anchors resolve, the loop above requires each to read
  // `objectuiPinSha`. ⛔ It compares no other file between them, so the record's
  // "the only file differing between the two commits is this gate" is not held
  // here.
  // ⛔ A further case comparing the two reads TO EACH OTHER was written here and
  // removed: it can only be reached once both have been asserted equal to the same
  // string, so it can never fail. That is a phantom check — a case that evaluates,
  // registers against the floor, and discriminates nothing — and this file is the
  // wrong place to keep one.
  // The DECLARED sensitivity must be a variant of the SAME reading: it sweeps
  // the same rows, so it exhausts the same population, and loosening the
  // predicate can only move rows INTO a repo, never out of one.
  const lenient = RECENSUS_17242.bindingUnderDirectoryLenientVariant;
  check(lenient.objectui + lenient.here + lenient.neither === RECENSUS_17242.declinedCitations,
    'the directory-lenient variant must exhaust the same declined population — a variant that does not is a '
      + 'different reading, not a sensitivity');
  check(
    lenient.neither <= RECENSUS_17242.bindingInNeitherRepo
      && lenient.objectui >= RECENSUS_17242.namingAnExistingObjectuiFile
      && lenient.here >= RECENSUS_17242.namingAnExistingFileHere,
    'relaxing a predicate can only move rows OUT of the unbound cell — a lenient variant binding FEWER rows means '
      + 'the two readings were not taken against the same trees',
  );
  // ⛔ The enumeration IS the cell. A count nobody can list is a count nobody
  // can check, and that is exactly what the previous round shipped.
  check(RECENSUS_17242.bindingInNeitherRepoRows.length === RECENSUS_17242.bindingInNeitherRepo,
    `the enumerated unbound rows (${RECENSUS_17242.bindingInNeitherRepoRows.length}) must equal the cell `
      + `(${RECENSUS_17242.bindingInNeitherRepo}) — a cell that outruns its list is a number without evidence`);
  // ⭐ ...and the via cell that HAS a list is held against that list.
  // `antecedentNoToken` is the only via cell small enough to enumerate, so it is
  // the one that can be checked against rows rather than against arithmetic.
  const inheritedNothing = RECENSUS_17242.bindingInNeitherRepoRows.filter((row) => row.via === 'antecedent');
  check(inheritedNothing.length === via.antecedentNoToken,
    `the enumerated rows the antecedent walk gave NO token (${inheritedNothing.length}) must equal `
      + `\`bindingVia.antecedentNoToken\` (${via.antecedentNoToken}) — that cell IS these rows, not a second count`);
  // A row's identity is its document plus its citation text, so two rows may not
  // share the pair: a duplicate is one row counted twice in a cell whose whole
  // point is that a reader can check it off one row at a time.
  const rowIdentities = RECENSUS_17242.bindingInNeitherRepoRows.map((row) => JSON.stringify([row.doc, row.raw]));
  check(new Set(rowIdentities).size === rowIdentities.length,
    `two enumerated rows share a document AND a citation text, which is a row's identity here: ${rowIdentities.join(', ')}`);
  for (const row of RECENSUS_17242.bindingInNeitherRepoRows) {
    check(row.doc.startsWith(`${SPEC_SRC_DIR}/`),
      `an enumerated unbound row may only name a file in this corpus, got \`${row.doc}\``);
    check(Number.isInteger(row.line) && row.line > 0 && typeof row.raw === 'string' && row.raw.length > 0,
      `the enumerated row in \`${row.doc}\` must carry the coordinate it was read at AND the citation text it was `
        + 'read for — the text is its identity, the coordinate is only how a reader finds it');
    check(NEITHER_ROW_TENSES.includes(row.tense),
      `the enumerated row for \`${row.raw}\` must carry a tense from the closed vocabulary `
        + `(${NEITHER_ROW_TENSES.join(' / ')}), got \`${row.tense}\``);
    check(row.tense !== 'live',
      `the enumerated row for \`${row.raw}\` in \`${row.doc}\` is LIVE-TENSE and names no file in either tree — `
        + 'that is a real defect and `liveTenseDefects: 0` no longer holds');
    check(typeof row.why === 'string' && row.why.length > 20,
      `the enumerated row for \`${row.raw}\` must say WHY no tree binds it — an unexplained row is the sentence `
        + 'nobody could reconcile, one indirection further down');
    check(NEITHER_ROW_VIAS.includes(row.via),
      `the enumerated row for \`${row.raw}\` must carry a via from the closed vocabulary `
        + `(${NEITHER_ROW_VIAS.join(' / ')}), got \`${row.via}\``);
    check(row.via === 'antecedent' ? row.token === null : typeof row.token === 'string' && row.token.length > 0,
      `the enumerated row for \`${row.raw}\` must agree with its own via — an \`antecedent\` row is one the walk gave `
        + 'NO token and so carries `token: null`, an `own-path` row carries the token it was read as. A row claiming '
        + 'one and holding the other is how `bindingVia.antecedentNoToken` gets counted off the wrong rows');
  }
  // ...and the predicate itself is carried as a usable pattern, not a paraphrase.
  const tokenUnder = (pattern, text) => new RegExp(pattern).exec(text)?.[0] ?? null;
  const qualified = 'plugin-grid/src/ObjectGrid.tsx';
  check(new RegExp(RECENSUS_17242.bindingTokenPattern).test(qualified),
    'the recorded token grammar must match a directory-qualified sibling-repo citation');
  // ⭐ The guard that stops a longer extension being eaten as its own prefix is
  // the TRAILING LOOKAHEAD, pinned here by PRESENCE and by BEHAVIOUR. ⛔ The
  // order of the alternation is not that guard, and the third case measures it:
  // a check whose message says otherwise describes a mechanism this pattern
  // does not have, which is the same unheld-sentence defect one layer down.
  check(RECENSUS_17242.bindingTokenPattern.endsWith(BINDING_TOKEN_TAIL_GUARD),
    `the recorded token grammar must END in \`${BINDING_TOKEN_TAIL_GUARD}\` — that guard is what makes a shorter `
      + 'extension arm FAIL on a longer extension, and without it the alternation order becomes load-bearing');
  check(tokenUnder(RECENSUS_17242.bindingTokenPattern, qualified) === qualified,
    'the recorded token grammar must keep the WHOLE extension — a token truncated to its two-letter prefix points at '
      + `a file that does not exist, got \`${tokenUnder(RECENSUS_17242.bindingTokenPattern, qualified)}\``);
  const shortestArmFirst = RECENSUS_17242.bindingTokenPattern.replace('tsx|ts|', 'ts|tsx|');
  check(shortestArmFirst !== RECENSUS_17242.bindingTokenPattern,
    'the order-independence case must actually RE-ORDER the alternation — if that substitution stops applying, the '
      + 'case below compares a pattern with itself and holds nothing');
  check(tokenUnder(shortestArmFirst, qualified) === tokenUnder(RECENSUS_17242.bindingTokenPattern, qualified),
    'a shortest-arm-first alternation must return the SAME token — ordering is not what prevents truncation, and '
      + 'this record must not claim it is');
  // ⚠️ The record's docblock states a THIRD leg — "removing the lookahead while
  // keeping longest-first also truncates nothing; only removing BOTH truncates" —
  // and ⛔ deliberately does not claim the battery pins it (`it is the lookahead
  // the self-test pins`). A case for it was written here and removed: every
  // mutation that would light it is caught first by the two guard cases above (the
  // pattern must end in the tail guard; the re-order substitution must apply), so
  // the leg's truth is ENTAILED by cases that already ran and a case for it could
  // not fail. The sentence is a recorded measurement, not an unheld claim about
  // this battery — so it stays prose, and the battery stays honest about what it
  // pins.

  // 9. ⭐ THE PRESENT-TENSE REPORT, its own battery so the 124 above stay exactly
  //    the cases they were. ⛔ Nothing here reads the LIVE tree's hits: a case
  //    holding today's reading would make a report-only instrument fail CI on an
  //    unrelated doc edit. Every case below reds only when the MECHANISM breaks.
  battery('present-tense report');
  const ptTmp = mkdtempSync(join(tmpdir(), 'check-spec-docblock-present-tense-'));
  try {
    const write = (rel, body) => { mkdirSync(dirname(join(ptTmp, rel)), { recursive: true }); writeFileSync(join(ptTmp, rel), body); };
    // The sentence #18991 repaired, verbatim and wrapped as it was: `this phase`
    // starts on line 3 and ends on line 4, so a matcher that does not fold
    // across the JSDoc gutter misses it.
    write('packages/spec/src/pt/rotted.ts', [
      '/**',
      ' * - `export` derives from `list` and the caller\'s export slot',
      ' *   (`ResolveApiOptions.userExportAllowed`, always `true` this',
      ' *   phase — the real permission bit is a follow-up, wiring it',
      ' *   changes no contract here).',
      ' */',
      'export const rotted = 1;',
    ].join('\n'));
    // The other two phrases, in the other two comment forms and in upper case.
    write('packages/spec/src/pt/more.ts', [
      '// Feature not yet implemented.',
      '/* Currently NO reader holds it. */',
      'export const more = 1;',
    ].join('\n'));
    // ⛔ What must NOT print: the wide phrase, whole-word near misses, and the
    // listed phrases inside a string literal, which is code, not prose.
    write('packages/spec/src/pt/refused.ts', [
      '// there is no reader for it yet, for now.',
      '// currently none; currently nothing; this phased rollout; it is a follow-upper.',
      "export const message = 'not yet implemented, currently no reader, this phase';",
    ].join('\n'));
    // ⛔ A test source carrying all four: skipped, and counted as skipped.
    write('packages/spec/src/pt/skipped.test.ts',
      '// this phase: the bit is a follow-up, not yet implemented, currently no reader.\n');
    execFileSync('git', ['init', '-q'], { cwd: ptTmp, env: gitFreeEnv() });
    execFileSync('git', ['add', '-A'], { cwd: ptTmp, env: gitFreeEnv() });

    // The population is the anchor corpus's own walk, the same call `runCheck` makes.
    const docs = [...sweepCorpus(CORPUS, ptTmp).byDoc.keys()];
    check(docs.includes('packages/spec/src/pt/skipped.test.ts'),
      'the test source must be IN the population the report is handed, or "skipped" cannot be told from "never seen"');
    const reading = presentTenseHits(ptTmp, docs);
    check(reading.skippedTests === 1 && reading.scanned === docs.length - 1,
      `exactly the one test source must be skipped and every other source read, got ${reading.skippedTests} skipped, `
        + `${reading.scanned} read of ${docs.length}`);
    const expected = [
      ['this phase', 'packages/spec/src/pt/rotted.ts', 3],
      ['is a follow-up', 'packages/spec/src/pt/rotted.ts', 4],
      ['not yet implemented', 'packages/spec/src/pt/more.ts', 1],
      ['currently no', 'packages/spec/src/pt/more.ts', 2],
    ];
    check(expected.map(([p]) => p).join('|') === PRESENT_TENSE_PHRASES.join('|'),
      'the fixture must plant exactly one hit per listed phrase — a phrase added to the list needs a planted hit here');
    for (const [phrase, doc, line] of expected) {
      const got = reading.hits.filter((h) => h.phrase === phrase);
      check(got.length === 1 && got[0].doc === doc && got[0].line === line,
        `the planted "${phrase}" must be ONE hit at ${doc} line ${line}, got `
          + `${JSON.stringify(got.map((h) => [h.doc, h.line]))}`);
    }
    check(reading.hits.length === expected.length,
      `the fixture must yield exactly its ${expected.length} planted hits, got ${reading.hits.length}: `
        + `${reading.hits.map((h) => `${h.doc} ${h.line} ${h.phrase}`).join(', ')}`);
    check(!reading.hits.some((h) => h.doc.endsWith('refused.ts')),
      'the wide phrase, the whole-word near misses and a string literal must print nothing');
    check(!reading.hits.some((h) => h.doc.endsWith('.test.ts')), 'a test source must print nothing');
    // ⛔ The wide phrase is kept out by the LIST, not by a blind matcher: asked
    // for it directly, the same instrument finds it.
    check(Object.keys(PRESENT_TENSE_REFUSED_WIDE).every((w) => !PRESENT_TENSE_PHRASES.includes(w)),
      'a refused wide phrase must never be on the list');
    check(presentTenseHits(ptTmp, docs, ['there is no']).hits.length === 1,
      'the instrument must SEE `there is no` when asked, so its absence from the report is the list, not blindness');

    // ⭐ REPORT-ONLY, measured as an exit status: the CLI arm, spawned over a tree
    // carrying hits, must exit 0 and print each one as file:line plus phrase.
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--present-tense'], {
      cwd: ptTmp, env: gitFreeEnv(), encoding: 'utf8',
    });
    check(run.status === 0, `the report arm must exit 0 WITH hits, got ${run.status}: ${run.stderr}`);
    for (const [phrase, doc, line] of expected) {
      check(run.stdout.includes(`📝 [present-tense] ${doc}:${line}  "${phrase}"`),
        `the spawned report must print ${doc}:${line} "${phrase}"`);
    }
    check(!/refused\.ts|skipped\.test\.ts/.test(run.stdout),
      'the spawned report must print nothing for the refused file or the test source');
    check(run.stdout.includes(`ℹ️  present-tense report (REPORT-ONLY, never fails): ${expected.length} hit(s)`),
      'the spawned report must print its summary line with the hit count');

    // ⛔ ...and in-process it cannot move an exit code or throw, even when the
    // read fails or reads nothing. Its output is captured, not printed.
    const captured = [];
    const realLog = console.log;
    const exitCodeBefore = process.exitCode;
    let unreadable;
    let blind;
    let withHits;
    console.log = (...args) => { captured.push(args.join(' ')); };
    try {
      withHits = reportPresentTense(ptTmp, docs);
      unreadable = reportPresentTense(ptTmp, [...docs, 'packages/spec/src/pt/vanished.ts']);
      blind = reportPresentTense(ptTmp, ['packages/spec/src/pt/skipped.test.ts']);
    } finally {
      console.log = realLog;
    }
    check(withHits?.hits.length === expected.length && process.exitCode === exitCodeBefore,
      'reporting hits must leave `process.exitCode` exactly as it found it');
    check(unreadable === null && captured.some((l) => l.includes('NOT MEASURED')),
      'an unreadable source must turn into a NOT MEASURED line and a null reading, never a throw');
    check(blind?.scanned === 0 && captured.filter((l) => l.includes('NOT MEASURED')).length === 2,
      'a population with no non-test source must say NOT MEASURED, never report zero hits');
    // A presence pin, not behaviour — the behaviour is the spawned arm above. It
    // catches the call being deleted from the gate run, which nothing else would.
    check(String(runCheck).includes('reportPresentTense(root, [...byDoc.keys()])'),
      'runCheck must print the report over its own sweep\'s population');
  } finally {
    rmSync(ptTmp, { recursive: true, force: true });
  }

  // The admission record, held INTERNALLY: every listed phrase carries a reading
  // at a named sha, every enumerated row adds up to its cell, and no row carries
  // a judgement outside the closed vocabulary.
  for (const [label, census] of [['today', PRESENT_TENSE_CENSUS], ['card tree', PRESENT_TENSE_CENSUS.cardTree]]) {
    check(Object.keys(census.hits).join('|') === PRESENT_TENSE_PHRASES.join('|'),
      `the ${label} reading must count exactly the listed phrases, in order — a phrase joins the list only with a `
        + `measured reading: ${Object.keys(census.hits).join(', ')}`);
    check(/^[0-9a-f]{40}$/.test(census.measuredOn), `the ${label} reading must name a full sha, got \`${census.measuredOn}\``);
    for (const phrase of PRESENT_TENSE_PHRASES) {
      check(census.rows.filter((r) => r.phrase === phrase).length === census.hits[phrase],
        `the ${label} rows for "${phrase}" must enumerate its count of ${census.hits[phrase]}`);
    }
    check(census.rows.every((r) => PRESENT_TENSE_JUDGEMENTS.includes(r.judgement) && r.why.length > 20
      && Number.isInteger(r.line) && r.doc.startsWith(`${SPEC_SRC_DIR}/`) && !PRESENT_TENSE_TEST_SOURCE.test(r.doc)),
    `every ${label} row must be a non-test spec source with a line, a closed-vocabulary judgement and a reason`);
  }
  check(Object.keys(PRESENT_TENSE_CENSUS.cardTree.refusedWide).join('|')
    === Object.keys(PRESENT_TENSE_REFUSED_WIDE).join('|'),
  'both readings must record the same refused wide phrases');
  console.log(
    `   ✓ present-tense report: ${PRESENT_TENSE_PHRASES.length} listed phrases provoked, wide phrase refused, `
      + 'test source skipped, exit 0 with hits (spawned)',
  );

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  const floorMessages = [];
  const floorFailure = (message) => { floorMessages.push(message); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  assert(!floorBreached, floorMessages.join('\n     '));

  console.log(
    '✅ check-spec-docblock-symbol-anchors --self-test: every finding class provoked, comment-prose projection '
      + 'wired, declined shapes counted not missed, residual rows exact both ways and keyed by citation text, '
      + `population live (${live.counts.anchors} live anchors across ${live.counts.docs} spec sources)`,
  );

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  // The `if` body is BRACED so the trailing `else if` cannot re-bind to the
  // inner refusal; the `else` arms stay unbraced, per the landed
  // `scripts/pm/check-label-desc-cap.mjs` precedent.
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-spec-docblock-symbol-anchors self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else if (process.argv.includes('--list-unresolvable')) listUnresolvable();
  else if (process.argv.includes('--present-tense')) presentTenseOnly();
  else if (process.argv.includes('--list')) list();
  else runCheck();
}
