#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-spec-docblock-symbol-anchors (#17065) -- the `packages/spec/src/**`
 * registration of the shared symbol-anchor resolver.
 *
 *   node scripts/check-spec-docblock-symbol-anchors.mjs
 *   node scripts/check-spec-docblock-symbol-anchors.mjs --list
 *   node scripts/check-spec-docblock-symbol-anchors.mjs --list-unresolvable
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
 * ## ⚠️ `counts.symbol` is ZERO on this corpus, and that is a census result
 *
 * The whole of `packages/spec/src` contains exactly ONE span written in symbol
 * anchor form, and it does not resolve: `packages/spec/src/api/websocket.zod.ts`
 * anchors `RealtimeSubscriptionOptions` to a PACKAGE-RELATIVE spelling of the
 * contracts file, so no tracked file is at that path -- the symbol itself is
 * real and lives in `packages/spec/src/contracts/realtime-service.ts`. The
 * citation as written is pinned in `CENSUS_RESIDUAL` below, and ⛔ it is NOT
 * requoted in anchor form here: this header is itself swept by the `scripts/**`
 * corpus, so quoting a broken anchor verbatim makes THIS file a finding.
 *
 * So the live-corpus self-test here asserts `fileLevel`, ⛔ never `symbol > 0`
 * the way `scripts/**` can: a corpus the convention has not reached yet cannot
 * prove the extractor works by finding a resolved symbol in it. What stands in
 * for that positive control is the residual's exactness loop -- the one
 * symbol-shaped span in the tree must still be SEEN, every run, or its row goes
 * stale and this gate reds.
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
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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

export function runCheck(root = process.cwd()) {
  const { findings, counts } = sweepCorpus(CORPUS, root);
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
// exactness loop below runs three `check()`s over each row), so 21 of the 64
// are the 7 day-one rows, and REPAIRING a citation and deleting its row
// legitimately lowers this floor by 3 — that is the ONLY reason it may be
// lowered. Any other drop is cases that STOPPED RUNNING; find what stopped
// registering instead of moving the number.
const SELF_TEST_BATTERIES = Object.freeze({
  'check-spec-docblock-symbol-anchors self-test': 64,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

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
  //    ⚠️ `symbol > 0` is NOT assertable here and that is a census result, not
  //    an oversight: the whole tree holds exactly ONE symbol-anchor-shaped span
  //    and it does not resolve (see the header, and the `websocket.zod.ts`
  //    residual row). The file-level population is what proves the extractor
  //    ran; the residual's exactness loop below is what proves it still SEES
  //    that one symbol-shaped span.
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
  //    re-reads. This loop is also the positive control for the ONE
  //    symbol-shaped span in the corpus (case 4's note).
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
  else if (process.argv.includes('--list')) list();
  else runCheck();
}
