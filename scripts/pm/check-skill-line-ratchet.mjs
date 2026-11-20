#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * pm instruction-surface BYTE ratchet (#7341 item 1, #5925 item 7; per-file
 * extension #8700; re-denominated in bytes by #35229) — shrink-only ceilings on
 * every file the PM protocol and the dev-agent definition are made of.
 *
 *   node scripts/pm/check-skill-line-ratchet.mjs               # the gate
 *   node scripts/pm/check-skill-line-ratchet.mjs --self-test   # verify the checker
 *
 * The file keeps its historical name (`line-ratchet`) because `package.json`,
 * `.github/workflows/lint.yml` and the gate censuses address it by path; the
 * unit it counts is BYTES.
 *
 * ## Why ceilings
 *
 * `.claude/skills/pm-dispatch/SKILL.md` is read in full by every seat session and every Routine fire, and so is every other file in the map below: its size is a token cost paid again on each read. Without a gate the intent to keep it small erodes one well-meaning paragraph at a time. The main file carries principles; `references/` carries on-demand detail; provenance is one line, stories live on cards, and incident case law lives in git history.
 *
 * ## Why bytes, not lines
 *
 * The ceiling prices a token read, and tokens track bytes, not lines. While the ceiling counted lines, a file could grow at a flat line count: one PR grew `references/platform-readings.md` from 16,953 to 22,559 bytes (+33%) at 134/134 lines, green on every run. The max-line-length rule (maintainer ruling 2026-08-23, option B) held every prose line to 120 bytes so that a line would track bytes again, and it turned the skills into text wrapped at 120 bytes. Maintainer ruling 2026-11-18 16:19Z, verbatim and untranslated: 「同意」, to the fleet skills review and its order of improvements, whose first step is this one (quoted in the body of card #35229): the ratchet counts bytes, and prose is no longer held to a 120-byte line.
 *
 * So each file has ONE number: its size in UTF-8 bytes, exactly what `wc -c <file>` prints. A full sentence on one line costs its bytes and nothing more, so a skill may be written in full sentences. A re-wrap that swaps a space for a newline is byte-neutral, so it neither pays for content nor costs any. An un-wrap can free a few bytes (joining a wrapped list continuation deletes its newline and indent; joining two CJK lines deletes the newline), and those are real bytes of the read: the count is the cost, and deletion stays the only currency.
 *
 * The per-file table-row pin ({@link MAX_TABLE_ROW_BYTES}) is NOT retired with the line rule: it stands on its own ruling, and it now meters a table row beside the byte ceiling rather than in place of a line rule that exempted it.
 *
 * ## What is covered — and the published catalog, which deliberately is not
 *
 * The CEILINGS map below is an ENUMERATION, never a root glob: the pm-dispatch surface (SKILL.md, its references/, the per-lane job descriptions), the four other `.claude/skills/` playbook SKILL.md files, the dev-agent definition `.claude/agents/os-dev.md`, and both root instruction files — `AGENTS.md` and `CLAUDE.md`. Read a file's absence from the map as a fact to check, not an oversight to infer — `.claude/hooks/` and `.claude/settings.json` carry no ceiling.
 *
 * The **published** `skills/` catalog — the one that ships to customer projects — is deliberately OUTSIDE this map (#9923). It is read by customer projects, not by this repo's seats, it is a governed, human-merge-only surface, and it has its own gate with its own unit, `scripts/check-skills-token-ratchet.mjs`. Extending THIS map to it is a policy change that needs its own card and a maintainer's ruling, not a row added in passing; the self-test pins the boundary, because enforcement cannot — a published-root entry would run perfectly green.
 *
 * ## The ratchet discipline (shrink-only, per file)
 *
 *   - A ceiling may be LOWERED by any PR that shrinks its file — lowering is always legitimate and encouraged.
 *   - RAISING one is authorized by the RULING OF RECORD that orders text into the file (maintainer ruling 2026-10-15, letter B, ruling record 6184799323): the raising PR quotes that ruling comment's id and the measured byte delta in its body and moves the CEILINGS row in the same PR by at most that delta. A raise quoting no ruling id stays RED; there is no tolerance band; content no ruling ordered is paid for by deletion (「新增以删减付账」); ceilings already landed are not revisited. The script cannot read rulings: the quote is checked by the seat's contract-review record and by the queue guard's reader, never here.
 *   - The headroom between a file's size and its ceiling is the budget for ordinary rule edits between compressions; it is deliberately small.
 *   - A same-PR CROSS-FILE MOVE is a raise an author may take without a per-instance ruling — under the three conditions below, and never as a way to grow the corpus.
 *   - A `readings-*.md` increment is the third raise path: it raises that file's row to the landed bytes with no decision card, the raising PR's body quoting the rule line that grants it and the measured byte delta (`.claude/skills/pm-dispatch/references/triage-duties.md`, 例外一).
 *
 * Missing file or empty read is RED, never a pass (#4690: a gate that cannot find its input must fail, not skip).
 *
 * ## The one raise an author may take alone: a same-PR CROSS-FILE MOVE
 *
 * Maintainer ruling, 2026-09-03, adopting the measured option A of the skills optimization programme's third decision batch — verbatim and untranslated: 「同意」, and the adopted text in the ruling comment's own words, which every declaration cites as {@link RULING_CITATION}:
 *
 *   the per-file line ratchet admits a cross-file move in one PR when the
 *   destination's allowance rises by no more than the source's net decrease and
 *   total lines do not increase, with the ruling cited in the ratchet comment
 *
 * The ruling was given in lines because lines were the unit then; the arithmetic is now read in bytes. A FACT can be in the wrong FILE, and consolidating it reduces the corpus, yet under a shrink-only per-file ceiling that was impossible without a per-instance ruling. ⛔ It is NOT a general raise: deletion at the source pays, restatement does not. Three conditions, all checked against {@link CROSS_FILE_MOVES}:
 *
 *   (a) the destination's raise is at most the NET DECREASE of the sources that move declares, per move;
 *   (b) the sum of ceilings over the whole map does not increase;
 *   (c) the raised entry declares the ruling that authorises it.
 *
 * The script reads the WORKING TREE and its own map, never the PR diff, so a declaration records the ceiling each participant carried BEFORE the move and the arithmetic is computable from the tree alone — deterministic, hermetic, and available in a shallow CI checkout. That is why the declaration is in-tree data and not a baseline diff: a baseline mode would read a ref that a shallow clone need not have and that a sibling's fetch moves under the run, and it would answer nothing at all once the move had landed. What stays with the reviewer is COMPLETENESS: that each recorded `was` is the value on `origin/main`, and that no OTHER entry moved in the same PR. (b) follows from (a) over disjoint declarations, which {@link crossFileMoveTotalVerdict} requires; it is written out because it is the ruling's own wording.
 *
 * An ORDINARY ruled raise taken on a destination after its move belongs to the ruling, not to the move: a declaration records it under `ruledRaises` (the ruling's own words, its date, its byte delta), and it is subtracted before the move's raise is measured, so `was` keeps meaning one thing. A record quoting no ruling is RED, and so is a set of records claiming more than the destination's ceiling stands above `was`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { isEntrypoint } from '../invoked-as.mjs';

const REPO_ROOT = new URL('../../', import.meta.url);

// Every ceiling below is its file's size in UTF-8 bytes (`wc -c`) at BASE =
// 74d3d831d, the merge-base of the re-basing PR, headroom 0. The rows were
// generated by one command over this map's keys (`git show "$BASE:<path>" |
// wc -c`), quoted in that PR's body so a reviewer can re-run it and diff the
// output against this map. Of the four rows marked below, three were then
// lowered to the size that PR's own edits landed (lowering is always
// legitimate); the fourth, `triage-duties.md`, was edited byte-neutral and
// equals the output. No number
// here is a raise and none is slack. The line-era row comments are not carried
// forward: they are in another unit, and they stay readable in git history
// (`git show 74d3d831d:scripts/pm/check-skill-line-ratchet.mjs`). A PR that
// moves a row later says why in its body; the row carries a one-line comment
// only when a reader needs the ruling at the row.
export const CEILINGS = new Map([
  ['.claude/skills/pm-dispatch/SKILL.md', 33872], // lowered 33934 → 33872 by the re-basing PR's own edit
  ['.claude/skills/pm-dispatch/references/dispatch-runbook.md', 20070],
  ['.claude/skills/pm-dispatch/references/state-machine.md', 4189],
  ['.claude/skills/pm-dispatch/references/contract-review.md', 6419],
  ['.claude/skills/pm-dispatch/references/decision-analysis.md', 4892],
  ['.claude/skills/pm-dispatch/references/platform-readings.md', 1082],
  ['.claude/skills/pm-dispatch/references/readings-queue.md', 9074],
  ['.claude/skills/pm-dispatch/references/readings-channels.md', 7138],
  ['.claude/skills/pm-dispatch/references/readings-page.md', 2126],
  ['.claude/skills/pm-dispatch/references/readings-search.md', 4413],
  ['.claude/skills/pm-dispatch/references/readings-issue-fields.md', 2597],
  ['.claude/skills/pm-dispatch/references/readings-write-shapes.md', 8410],
  ['.claude/skills/pm-dispatch/references/readings-ci.md', 4900],
  ['.claude/skills/pm-dispatch/references/readings-shell.md', 2492],
  ['.claude/skills/pm-dispatch/references/readings-session.md', 4874],
  ['.claude/skills/pm-dispatch/references/rest-channel.md', 7698],
  ['.claude/skills/pm-dispatch/references/l1-review-checklist.md', 6875],
  ['.claude/skills/pm-dispatch/references/review-checklist.md', 79],
  ['.claude/skills/pm-dispatch/references/landing-operations.md', 10717],
  ['.claude/skills/pm-dispatch/references/release-aftercare.md', 3526],
  ['.claude/skills/pm-dispatch/references/seat-post-protocol.md', 7722],
  ['.claude/skills/pm-dispatch/references/true-green.md', 2068],
  ['.claude/skills/pm-dispatch/references/compile-surfaces.md', 2488],
  ['.claude/skills/pm-dispatch/references/seat-lifecycle.md', 9071],
  ['.claude/skills/pm-dispatch/references/area-lease.md', 6401],
  ['.claude/skills/pm-dispatch/references/coordinator.md', 3781],
  ['.claude/skills/pm-dispatch/references/untrusted-text.md', 3280],
  ['.claude/skills/pm-dispatch/references/security-findings.md', 3934],
  ['.claude/skills/pm-dispatch/references/external-contributions.md', 2006],
  ['.claude/skills/pm-dispatch/references/reading-discipline.md', 3822],
  ['.claude/skills/pm-dispatch/references/cross-repo-coordination.md', 4959],
  ['.claude/skills/pm-dispatch/references/triage-duties.md', 13620], // edited byte-neutral by the re-basing PR (12399 → 12399); raised 12399 → 13343 (+944) by the rulings that order rows 2–7 of the fold/sweep/size rule card into it: ruling records 7031931263 (rows 2–5: 「adr接受你的建议」, 「只考虑合并没人认领的，没开始开发的，你负责处理」, 「影响评测的卡不能关，这个会影响到AI的开发效果」, 「adr和skills修改相对是重要的」), 7032145340 (row 6: 「同意」) and 7032418455 (row 7: 「你分诊的时候是不是应该同时评估大概的卡大小作为参考」); then 13343 → 13620 (+277) applying rows 2, 3 and 6 of those rulings (7031931263, 7032145340: the fold exclusions, one close reason for fold and ADR move, the sweep roll-over), triggered by review record 7038100802 (a trigger, not a ruling)
  ['.claude/skills/pm-dispatch/references/execution-duties.md', 20148], // raised 19810 → 20148 (+338) by ruling records 7031931263 (row 2, the weekly ADR card: 「adr接受你的建议」) and 7032145340 (row 6, the lane seat claims the weekly sweep card: 「同意」)
  ['.claude/skills/pm-dispatch/references/filing-gate.md', 8991], // raised 8386 → 8972 (+586) by the rule card's body ruling (row 1, a dedupe hit on an open same-mechanism card ends in a comment: 「感觉你的第二种方案也很好啊」) and ruling record 7032145340 (row 6, the weekly sweep card entry rule: 「同意」); then 8972 → 8991 (+19) applying rows 1 and 6 to the per-defect quota line and the review follow-ups line, triggered by review record 7038100802 (a trigger, not a ruling)
  ['.claude/skills/pm-dispatch/references/project-forms.md', 4669],
  ['.claude/skills/pm-dispatch/references/app-platform-boundary.md', 3928],
  ['.claude/skills/pm-dispatch/references/lanes/server.md', 4832],
  ['.claude/skills/pm-dispatch/references/lanes/devx.md', 2533],
  ['.claude/skills/pm-dispatch/references/lanes/skills.md', 2666], // lowered 2682 → 2666 by the re-basing PR's own edit
  ['.claude/skills/pm-dispatch/references/lanes/spec.md', 3299],
  ['.claude/skills/pm-dispatch/references/lanes/ui.md', 1041],
  ['.claude/skills/pm-dispatch/references/lanes/hotcrm.md', 1320],
  ['.claude/skills/pm-dispatch/references/lanes/mobile.md', 3990],
  ['.claude/skills/pm-dispatch/references/lanes/security.md', 4196],
  ['.claude/skills/pm-dispatch/references/lanes/director.md', 6958],
  ['.claude/skills/pm-dispatch/references/lanes/triage.md', 2526], // lowered 2530 → 2526 by the fold/sweep/size rule PR's own edit
  ['.claude/skills/pm-dispatch/references/lanes/l2-review.md', 1462],
  ['.claude/skills/pm-dispatch/references/lanes/review.md', 120],
  ['.claude/skills/pm-dispatch/references/lanes/qa.md', 2235],
  ['.claude/skills/pm-dispatch/references/lanes/eval.md', 2694],
  ['.claude/skills/pm-dispatch/references/lanes/queue.md', 2003],
  ['.claude/skills/pm-dispatch/references/lanes/cloud.md', 1232],
  ['.claude/skills/pm-dispatch/references/lanes/objectstack.md', 2270],
  ['.claude/agents/os-dev.md', 38848], // lowered 39008 → 38848 by the re-basing PR's own edit
  ['.claude/skills/checklist-test/SKILL.md', 19560],
  ['.claude/skills/checklist-author/SKILL.md', 3574],
  ['.claude/skills/dogfood-verification/SKILL.md', 9526],
  ['.claude/skills/spec-property-retirement/SKILL.md', 26922],
  ['AGENTS.md', 78106],
  ['CLAUDE.md', 273],
]);

/**
 * The ruling that authorises a cross-file move, spelled once. Every declaration
 * in {@link CROSS_FILE_MOVES} must name it; a raise that names nothing is a
 * raise, not a move, and the header's ordinary path (the ruling of record quoted
 * in the raising PR) is the only other way one lands.
 */
export const RULING_CITATION = '#14685 item 5 (comment 5520452691)';

/**
 * Declared same-PR CROSS-FILE MOVES — the raise path the header authorises.
 * Keyed by DESTINATION (the entry whose ceiling rose); one declaration per
 * destination, and no path appears twice across the map.
 *
 *   ruling   the authorising ruling — must name {@link RULING_CITATION}
 *   was      the destination's ceiling before the move, in bytes — its LITERAL
 *            pre-move value, never carried forward past a later ordinary raise
 *   sources  [path, ceiling-before-the-move] for every file that paid for it
 *   ruledRaises
 *            optional; one `{ruling, date, delta}` record per ORDINARY ruled
 *            raise taken on the destination SINCE the move, `delta` in bytes,
 *            `ruling` carrying the maintainer's own words as a verbatim
 *            quotation (「…」 or "…"). A record without one is RED.
 *
 * ⛔ NOT somewhere to record a raise no move paid for, and not the place an
 * ordinary raise on a file that is no move's destination is booked: that raise
 * is the header's ordinary path, quoted in the raising PR's body. A declaration
 * is a CLAIM about an arithmetic, and {@link crossFileMoveVerdict} re-derives it
 * from the live map on every run. A declaration keeps working after its PR
 * lands: lowering the destination later reads as PAID DOWN, while raising a
 * SOURCE later re-opens the move (the destination would keep what it was given
 * while the files that paid for it grow back).
 *
 * EMPTY at the byte re-base, deliberately. The three line-era declarations (into
 * `references/platform-readings.md`, `references/landing-operations.md` and
 * `references/lanes/director.md`) recorded `was` values and ruled raises in
 * LINES, which no byte ceiling can be compared with, and the re-base landed every
 * participant at headroom 0, so nothing remained for their arithmetic to guard.
 * Re-declaring them in bytes would be worse than dropping them: a zero-byte move
 * pins its sources at today's size, so any later ordinary ruled raise on a source
 * (`SKILL.md`, `triage-duties.md`, `rest-channel.md`, `lanes/server.md`) would
 * read as the move re-opening and go red for bytes no move ever took. The
 * platform-readings declaration also credited the map with lines that were moved
 * into the nine `readings-*.md` files rather than deleted; it goes with the rest.
 * The next move writes a fresh declaration, in bytes.
 */
export const CROSS_FILE_MOVES = new Map([]);

/**
 * Per-file MAX TABLE ROW BYTES — a second meter beside the byte ceiling, kept by
 * its own ruling (#11947).
 *
 * ## The ruling
 *
 * Maintainer ruling 2026-08-25 (issue #11947, comment 5406811814), verbatim and
 * untranslated: 「同意」 — accepting option 1, a shrink-only pin on each file's
 * widest table row, over option 2 (a whole-file byte ceiling on the two
 * table-heavy files) and option 3 (nothing). It was ruled while the ceiling
 * counted lines and the 120-byte line rule exempted a table row by shape, so a
 * widened cell cost nothing at all. The byte ceiling now meters every byte of a
 * row too; the pin stands beside it until a ruling retires it, and the
 * 2026-11-18 ruling that moved the ceiling to bytes does not name it.
 *
 * ## The discipline, which is the ceilings' discipline
 *
 * Seeded at each file's OWN widest table row on the day this landed, read from
 * {@link scanTableRows} rather than measured by hand — no invented constants,
 * the same idiom as the ceilings above. Shrink-only: lowering is always
 * legitimate and consolidation pays the pin down; raising one requires a
 * maintainer ruling quoted in the raising PR.
 *
 * ⚠️ A pin of 0 is a MEASUREMENT, not a disabled row: that file has no table row
 * today, so its widest is 0. It is deliberately not an omission — an uncovered
 * file is the one place a row could widen unmetered again, which is the whole
 * defect. Every key of {@link CEILINGS} carries a pin and the self-test holds the
 * two maps in step, because enforcement cannot: a missing pin would simply never
 * be consulted. Since every pin is seeded at headroom 0, ANY positive headroom
 * means a row has since been paid down and the pin should follow it — `run`
 * prints that as a hint rather than a failure.
 */
export const MAX_TABLE_ROW_BYTES = new Map([
  // The five files that carry a table row today, each seeded at its own widest.
  // The corpus's #1 longest LINE of any shape is the AGENTS.md row below.
  // Lowered 642 → 342 by the rules-only rewrite: the state-model and domain
  // rows lost their in-cell provenance and rationale; the widest survivor is
  // the `domain:engine` row. Landed width, headroom 0 (lowering is always
  // legitimate).
  // Lowered 342 → 341 by the domain:server lane merge (maintainer ruling
  // 2026-10-22, letter 乙): the engine, services and cli rows of the 域车道
  // table consolidated into one `domain:server` row that names package
  // families and points at lanes/server.md for the enumeration. The widest
  // survivor is that row. Landed width, headroom 0.
  ['.claude/skills/pm-dispatch/SKILL.md', 341],
  ['.claude/skills/pm-dispatch/references/dispatch-runbook.md', 0],
  ['.claude/skills/pm-dispatch/references/state-machine.md', 0],
  ['.claude/skills/pm-dispatch/references/contract-review.md', 0],
  ['.claude/skills/pm-dispatch/references/decision-analysis.md', 0],
  ['.claude/skills/pm-dispatch/references/platform-readings.md', 0],
  ['.claude/skills/pm-dispatch/references/readings-queue.md', 0],
  ['.claude/skills/pm-dispatch/references/readings-channels.md', 0],
  ['.claude/skills/pm-dispatch/references/readings-page.md', 0],
  ['.claude/skills/pm-dispatch/references/readings-search.md', 0],
  ['.claude/skills/pm-dispatch/references/readings-issue-fields.md', 0],
  ['.claude/skills/pm-dispatch/references/readings-write-shapes.md', 0],
  ['.claude/skills/pm-dispatch/references/readings-ci.md', 0],
  ['.claude/skills/pm-dispatch/references/readings-shell.md', 0],
  ['.claude/skills/pm-dispatch/references/readings-session.md', 0],
  ['.claude/skills/pm-dispatch/references/rest-channel.md', 0],
  ['.claude/skills/pm-dispatch/references/l1-review-checklist.md', 0],
  ['.claude/skills/pm-dispatch/references/review-checklist.md', 0],
  ['.claude/skills/pm-dispatch/references/landing-operations.md', 0],
  ['.claude/skills/pm-dispatch/references/release-aftercare.md', 0],
  ['.claude/skills/pm-dispatch/references/seat-post-protocol.md', 0],
  ['.claude/skills/pm-dispatch/references/true-green.md', 0],
  ['.claude/skills/pm-dispatch/references/compile-surfaces.md', 352],
  // The five per-phase references of the principle-only cut carry no table
  // row (their tables stayed in SKILL.md), so each pin is the measurement 0.
  ['.claude/skills/pm-dispatch/references/seat-lifecycle.md', 0],
  // area-lease.md carries no table row: the measurement 0.
  ['.claude/skills/pm-dispatch/references/area-lease.md', 0],
  ['.claude/skills/pm-dispatch/references/coordinator.md', 0],
  ['.claude/skills/pm-dispatch/references/untrusted-text.md', 0],
  // security-findings.md carries no table row (#29111): the measurement 0.
  ['.claude/skills/pm-dispatch/references/security-findings.md', 0],
  ['.claude/skills/pm-dispatch/references/external-contributions.md', 0],
  ['.claude/skills/pm-dispatch/references/reading-discipline.md', 0],
  ['.claude/skills/pm-dispatch/references/cross-repo-coordination.md', 0],
  ['.claude/skills/pm-dispatch/references/triage-duties.md', 0],
  ['.claude/skills/pm-dispatch/references/execution-duties.md', 0],
  ['.claude/skills/pm-dispatch/references/filing-gate.md', 0],
  ['.claude/skills/pm-dispatch/references/project-forms.md', 0],
  ['.claude/skills/pm-dispatch/references/app-platform-boundary.md', 219],
  ['.claude/skills/pm-dispatch/references/lanes/server.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/devx.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/skills.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/spec.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/ui.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/hotcrm.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/mobile.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/security.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/director.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/triage.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/l2-review.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/review.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/qa.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/eval.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/objectstack.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/queue.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/cloud.md', 0],
  ['.claude/agents/os-dev.md', 0],
  ['.claude/skills/checklist-test/SKILL.md', 221],
  ['.claude/skills/checklist-author/SKILL.md', 0],
  ['.claude/skills/dogfood-verification/SKILL.md', 0],
  ['.claude/skills/spec-property-retirement/SKILL.md', 326],
  // Lowered 1081 → 768 by the rules-only rewrite: the translations row lost its
  // in-cell narrative; the widest survivor is that same row. Landed width, headroom 0.
  ['AGENTS.md', 768],
  ['CLAUDE.md', 0],
]);

/**
 * The repo-ROOT files of the map above, spelled so `scripts/pm/dispatch-gates.mjs`
 * can derive this gate from a card that touches one.
 *
 * That tool reads a gate's population out of the path literals in the gate's own
 * source, and "looks like a path" there means "carries a separator". A repo-root
 * FILE has none, so before this list existed an AGENTS.md card derived ZERO
 * gates and the dev met this ratchet as red CI instead of as a local command.
 * `<file>/**` is the only form that reaches a repo-root file: dispatch-gates
 * collapses a hint's globs before comparing, which reduces each back to its bare
 * filename and matches that path alone. (Widening the extractor to bare
 * top-level `*.md` literals was measured and refused: 8 of the 17 pairs it adds
 * are fabricated, from gates that spell `README.md` as a basename.)
 *
 * This is provenance, NOT a lookup key: `run` opens files through CEILINGS, and a
 * key rewritten into the glob form would send the ratchet looking for a file that
 * does not exist. The self-test pins both halves.
 */
export const ROOT_FILE_WATCH_HINTS = ['AGENTS.md/**', 'CLAUDE.md/**'];

/** A file's size in the ratchet's unit: UTF-8 bytes, what `wc -c` prints. */
export function countBytes(text) {
  return Buffer.byteLength(text, 'utf8');
}

export function verdict(rel, byteCount, maxBytes) {
  if (byteCount === 0) return { ok: false, msg: `${rel} read as empty — refusing to treat a missing/empty input as a pass (#4690).` };
  if (byteCount > maxBytes) {
    return {
      ok: false,
      msg:
        `${rel} is ${byteCount} bytes; the ratchet ceiling is ${maxBytes} (${byteCount - maxBytes} over). ` +
        'Keep the surface compressed: principles in SKILL.md, on-demand detail in ' +
        '.claude/skills/pm-dispatch/references/ — provenance is one line, stories live on cards, ' +
        'not in operational text. Raising a ceiling is authorized only by the ruling of record that ' +
        'orders the text: its comment id and the measured byte delta quoted in the raising PR\'s body, ' +
        'the `CEILINGS` row moved in the same PR by at most that delta. A raise quoting no ruling id ' +
        'stays red, and there is no tolerance band.',
    };
  }
  return { ok: true, msg: `${rel} is ${byteCount} bytes (ceiling ${maxBytes}; headroom ${maxBytes - byteCount}).` };
}

/**
 * The per-file byte judgement `run` makes, as a pure function so the self-test
 * drives the same path the gate does. `text` is `null` when the file could not
 * be read.
 *
 * ⭐ Deliberately absent: any reading of LINE LENGTH. Prose may run any length
 * (header: why bytes); the self-test pins that a file of one long line is judged
 * by its bytes alone.
 *
 * @param {string} rel repo-relative path
 * @param {string | null} text the file's contents
 * @param {number} maxBytes its ceiling
 * @returns {{ok: boolean, msg: string, bytes?: number}}
 */
export function fileVerdict(rel, text, maxBytes) {
  if (text === null || text === undefined) {
    return { ok: false, msg: `cannot read ${rel} — red, not a skip (#4690).` };
  }
  const n = countBytes(text);
  return { ...verdict(rel, n, maxBytes), bytes: n };
}

/**
 * Above this much headroom `run` suggests lowering the ceiling. Informational
 * only: every ceiling is landed at headroom 0, so headroom means content has
 * since been paid down.
 */
export const HEADROOM_HINT_BYTES = 4096;

/**
 * A VERBATIM QUOTATION, in either spelling a ruling is quoted in: 「…」 for the
 * maintainer's own Chinese, "…" for the English text a ruling adopts. The bar
 * is the quotation, never the bracket.
 */
const VERBATIM_QUOTATION = /「[^」]+」|"[^"]+"|“[^”]+”/u;

/** When the ruling was given, `YYYY-MM-DD` — how a reader gets back to it. */
const RULED_RAISE_DATE = /^\d{4}-\d{2}-\d{2}$/;

const plural = (n) => (n === 1 ? '' : 's');

/**
 * The ORDINARY ruled raises recorded against a move's DESTINATION — validated,
 * then summed, so {@link crossFileMoveVerdict} can take them out of the rise
 * before it prices the move. Every bar exists because the subtraction is a
 * licence to grow: bytes it removes from the move's raise are bytes the sources
 * are never asked to pay for.
 *
 * @param {string} dest destination path, for the message
 * @param {{ruledRaises?: Array<{ruling?: string, date?: string, delta?: number}>}} move
 * @returns {{ok: true, total: number} | {ok: false, msg: string}}
 */
function ruledRaisesVerdict(dest, move) {
  const bad = (msg) => ({ ok: false, msg });
  const records = move?.ruledRaises ?? [];
  if (!Array.isArray(records)) {
    return bad(`cross-file move into ${dest} states its ordinary ruled raises as something other than a list, so they cannot be measured — red, not a skip (#4690).`);
  }
  let total = 0;
  for (const record of records) {
    const where = `cross-file move into ${dest}: an ordinary ruled raise recorded against the destination`;
    if (!Number.isInteger(record?.delta) || record.delta <= 0) {
      return bad(`${where} names no usable byte count ("delta"). A ruled raise is a positive number of bytes; lowering is always legitimate and is never recorded here.`);
    }
    if (!VERBATIM_QUOTATION.test(String(record?.ruling ?? ''))) {
      return bad(`${where} (${record.delta} bytes) quotes no ruling. A raise is the maintainer's or it is not a raise, so the record carries the ruling's own words verbatim — 「…」 or "…". Un-ruled, this subtraction would take bytes out of the move's raise that the sources were never asked to pay for.`);
    }
    if (!RULED_RAISE_DATE.test(String(record?.date ?? ''))) {
      return bad(`${where} (${record.delta} bytes) carries no ruling date (YYYY-MM-DD), which is how a reader gets from this record back to the ruling it quotes.`);
    }
    total += record.delta;
  }
  return { ok: true, total };
}

/**
 * The same sum with no verdict, for {@link crossFileMoveTotalVerdict}. A
 * malformed record is already RED in {@link crossFileMoveVerdict}, which reads
 * every declaration on every run.
 *
 * @param {{ruledRaises?: Array<{delta?: number}>}} move
 */
function ruledRaiseSum(move) {
  const records = Array.isArray(move?.ruledRaises) ? move.ruledRaises : [];
  return records.reduce((sum, r) => sum + (Number.isInteger(r?.delta) && r.delta > 0 ? r.delta : 0), 0);
}

/**
 * One declared cross-file move, re-derived from the live ceiling map —
 * conditions (a) and (c) of the ruling; (b) is map-wide and lives in
 * {@link crossFileMoveTotalVerdict}. Every failure names the arithmetic it read,
 * because the author's next move is to correct one of those numbers.
 *
 * @param {string} dest destination path — a key of `ceilings`
 * @param {{ruling?: string, was?: number, sources?: Array<[string, number]>}} move
 * @param {Map<string, number>} ceilings
 */
export function crossFileMoveVerdict(dest, move, ceilings) {
  const bad = (msg) => ({ ok: false, msg });
  if (!ceilings.has(dest)) {
    return bad(`cross-file move declares ${dest} as its destination, which carries no ceiling — red, not a skip (#4690). A move can only land between files this map covers.`);
  }
  if (!String(move?.ruling ?? '').includes(RULING_CITATION)) {
    return bad(`cross-file move into ${dest} cites no authorising ruling — it must name "${RULING_CITATION}". An undeclared raise is a raise, and raising a ceiling otherwise requires the ruling of record that orders the text: its comment id and the measured byte delta quoted in the raising PR's body, the \`CEILINGS\` row moved in the same PR by at most that delta.`);
  }
  if (!Number.isInteger(move.was) || move.was <= 0) {
    return bad(`cross-file move into ${dest} records no usable pre-move ceiling ("was"), so its raise cannot be measured — red, not a skip (#4690).`);
  }
  const sources = move.sources ?? [];
  if (sources.length === 0) {
    return bad(`cross-file move into ${dest} names no source file. The raise is paid by deletion somewhere else in this map, and a move with nothing to pay it is a raise.`);
  }
  for (const [src, wasSrc] of sources) {
    if (src === dest) return bad(`cross-file move into ${dest} names itself as a source; a file cannot pay its own raise.`);
    if (!ceilings.has(src)) return bad(`cross-file move into ${dest} names source ${src}, which carries no ceiling — red, not a skip (#4690).`);
    if (!Number.isInteger(wasSrc) || wasSrc <= 0) return bad(`cross-file move into ${dest} records no usable pre-move ceiling for source ${src}.`);
  }
  const gross = ceilings.get(dest) - move.was;
  const parts = sources.map(([src, wasSrc]) => `${src} ${wasSrc}→${ceilings.get(src)}`).join(', ');
  if (gross <= 0) {
    return { ok: true, msg: `cross-file move into ${dest} is paid down: its ceiling is ${ceilings.get(dest)}, at or below the ${move.was} it moved from (sources: ${parts}).` };
  }
  const ruled = ruledRaisesVerdict(dest, move);
  if (!ruled.ok) return ruled;
  if (ruled.total > gross) {
    return bad(`cross-file move into ${dest} states ${ruled.total} bytes of ordinary ruled raise on its destination, an over-claim: its ceiling stands only ${gross} above the ${move.was} it moved from. Lowering is always legitimate, but a ruled raise since given back is spent — retire its record, because leaving it here prices this move's own raise below what the move actually took.`);
  }
  const raise = gross - ruled.total;
  const less = ruled.total > 0 ? `, less ${ruled.total} byte${plural(ruled.total)} of ordinary ruled raise` : '';
  if (raise <= 0) {
    return { ok: true, msg: `cross-file move into ${dest} is paid down: its ceiling is ${ceilings.get(dest)}, and all ${gross} byte${plural(gross)} it stands above the ${move.was} it moved from are ordinary ruled raises recorded against it, so this move keeps none of them (sources: ${parts}).` };
  }
  const decrease = sources.reduce((sum, [src, wasSrc]) => sum + (wasSrc - ceilings.get(src)), 0);
  if (raise > decrease) {
    return bad(`cross-file move into ${dest} raises its ceiling ${move.was}→${ceilings.get(dest)}${less} (+${raise}) against a net source decrease of ${decrease} (${parts}). A move pays for itself by DELETION at the source, and a raise the sources do not cover is an ordinary raise, which needs the ruling of record that orders the text: its comment id and the measured byte delta quoted in the raising PR's body, the \`CEILINGS\` row moved in the same PR by at most that delta. If part of that rise IS such a raise, record it under \`ruledRaises\` with the ruling's own words instead of carrying \`was\` forward: an ordinary ruled raise and a move's raise are separate quantities, and this arithmetic measures only the second.`);
  }
  return { ok: true, msg: `cross-file move into ${dest}: +${raise} (${move.was}→${ceilings.get(dest)}${less}) against a net source decrease of ${decrease} (${parts}); authorised by ${RULING_CITATION}.` };
}

/**
 * Condition (b): the sum of ceilings over the whole map does not increase.
 * Computed as the declared participants' net movement against their pre-move
 * values (untouched entries cancel); a destination's ordinary ruled raises are
 * restored alongside its `was`, because those bytes were never the move's.
 * Disjoint participants are REQUIRED: a source named by two declarations would
 * have its single decrease counted twice by (a) and once here.
 *
 * @param {Map<string, {was?: number, sources?: Array<[string, number]>}>} moves
 * @param {Map<string, number>} ceilings
 */
export function crossFileMoveTotalVerdict(moves, ceilings) {
  const seen = new Map();
  let net = 0;
  for (const [dest, move] of moves) {
    for (const [path, was] of [[dest, move.was + ruledRaiseSum(move)], ...(move.sources ?? [])]) {
      if (seen.has(path)) {
        return { ok: false, msg: `${path} is a participant in two cross-file moves (${seen.get(path)} and ${dest}). Declarations must be disjoint: one file's single decrease cannot pay for two raises, and counting it twice is how a total that grew reads as a total that did not.` };
      }
      seen.set(path, dest);
      if (!ceilings.has(path) || !Number.isInteger(was)) continue;
      net += ceilings.get(path) - was;
    }
  }
  if (net > 0) {
    return { ok: false, msg: `the declared cross-file moves raise the map's total by ${net} byte${plural(net)}. The ruling admits a move only while the total does not increase: pay the difference by deleting more at a source, or take the raise the ordinary way — the ruling of record that orders the text: its comment id and the measured byte delta quoted in the raising PR's body, the \`CEILINGS\` row moved in the same PR by at most that delta.` };
  }
  return { ok: true, msg: `declared cross-file moves: ${moves.size}, total ceilings ${net === 0 ? 'unchanged' : `down ${-net} byte${plural(-net)}`}.` };
}

// ─────────────────────────────────────────────────────────────────────────────
// The max-table-row-bytes pin (#11947). See MAX_TABLE_ROW_BYTES for why.
// ─────────────────────────────────────────────────────────────────────────────

const isFence = (line) => /^\s*(```|~~~)/.test(line);
const isTableRow = (line) => /^\s*\|/.test(line);

/** The block state the table-row scan carries: inside a fence, inside front matter. */
export function initialState() {
  return { fence: false, frontMatter: false };
}

/** Advance the block state PAST `line` (index `i`, 0-based). Pure — returns a new state. */
export function advanceState(line, state, i) {
  const s = { ...state };
  if (i === 0 && line.trim() === '---') { s.frontMatter = true; return s; }
  if (state.frontMatter) { if (line.trim() === '---') s.frontMatter = false; return s; }
  if (isFence(line)) s.fence = !s.fence;
  return s;
}

/**
 * The widest markdown table row in `text`, in bytes, with its 1-based line
 * number. Fenced and front-matter regions are not table rows however they are
 * spelled. A file with no table row measures 0 — that is a MEASUREMENT, not a
 * sentinel, and it is what seeds the pin of every such file.
 */
export function scanTableRows(text) {
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  let state = initialState();
  let widest = 0;
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const before = state;
    state = advanceState(line, state, i);
    if (before.fence || isFence(line) || before.frontMatter) continue;
    if (!isTableRow(line)) continue;
    const b = countBytes(line);
    if (b > widest) { widest = b; at = i + 1; }
  }
  return { widest, line: at };
}

export function tableRowVerdict(rel, widest, at, pin) {
  if (pin === undefined) {
    return {
      ok: false,
      msg:
        `${rel} has no max-table-row-bytes pin — red, not a skip (#4690). Every file in the ` +
        'ceiling map carries one, seeded at its own widest table row, so an uncovered file is the ' +
        'one place a row could widen unmetered again.',
    };
  }
  if (widest > pin) {
    return {
      ok: false,
      msg:
        `${rel} has a ${widest}-byte table row at L${at}; the max-table-row-bytes pin is ${pin}. ` +
        'A table row\'s width is pinned per file by its own ruling, beside the file\'s byte ceiling — ' +
        'widening a cell is the measured defect that pin was ruled for. Move the row\'s detail into ' +
        'prose or a reference file, or consolidate two rows into one; either pays the pin down. ' +
        'There is no allowlist, and raising a pin requires a maintainer ruling quoted in the PR.',
    };
  }
  return { ok: true, msg: `${rel}: widest table row is ${widest} bytes (pin ${pin}; headroom ${pin - widest}).` };
}

function run() {
  let failed = 0;
  for (const [rel, maxBytes] of CEILINGS) {
    let text = null;
    try {
      text = readFileSync(new URL(rel, REPO_ROOT), 'utf8');
    } catch {
      text = null;
    }
    const v = fileVerdict(rel, text, maxBytes);
    if (text !== null) {
      const tr = scanTableRows(text);
      const tv = tableRowVerdict(rel, tr.widest, tr.line, MAX_TABLE_ROW_BYTES.get(rel));
      if (!tv.ok) {
        failed++;
        console.error(`✗ check-skill-line-ratchet: ${tv.msg}`);
      } else {
        const slack = MAX_TABLE_ROW_BYTES.get(rel) - tr.widest;
        if (slack > 0) {
          console.log(`ℹ️  ${rel}: max-table-row-bytes headroom is ${slack} — every pin is seeded at 0 headroom, so a row has been paid down; lower the pin to ${tr.widest} (shrink-only ratchets tighten opportunistically).`);
        }
        console.log(`✓ check-skill-line-ratchet: ${tv.msg}`);
      }
    }
    if (!v.ok) {
      failed++;
      console.error(`✗ check-skill-line-ratchet: ${v.msg}`);
      continue;
    }
    if (maxBytes - v.bytes > HEADROOM_HINT_BYTES) {
      console.log(`ℹ️  ${rel}: headroom is ${maxBytes - v.bytes} bytes — consider lowering its ceiling to ${v.bytes} (shrink-only ratchets tighten opportunistically).`);
    }
    console.log(`✓ check-skill-line-ratchet: ${v.msg}`);
  }
  for (const [dest, move] of CROSS_FILE_MOVES) {
    const mv = crossFileMoveVerdict(dest, move, CEILINGS);
    if (!mv.ok) {
      failed++;
      console.error(`✗ check-skill-line-ratchet: ${mv.msg}`);
    } else {
      console.log(`✓ check-skill-line-ratchet: ${mv.msg}`);
    }
  }
  const totals = crossFileMoveTotalVerdict(CROSS_FILE_MOVES, CEILINGS);
  if (!totals.ok) {
    failed++;
    console.error(`✗ check-skill-line-ratchet: ${totals.msg}`);
  } else {
    console.log(`✓ check-skill-line-ratchet: ${totals.msg}`);
  }
  if (failed) process.exit(1);
}

// -- The self-test's own battery roster and floor (#13489) ------------------
//
// `--self-test` reaching its verdict used to be its ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. This
// self-test is TABLE-DRIVEN — one `cases` table, one loop — so each row LABEL is
// a declared battery with a floor of 1, and `registerCase(name)` is the first
// statement of the loop body. The roster is a LITERAL the table is checked
// against (a roster derived from the table would let a deleted row delete its
// own floor), and every row is a literal `[label, actual, expected]` — no label
// is computed, so every row is floored.
//
// The counts are a FLOOR, not an equality: 1 is the honest floor for a table
// row, which the loop reaches exactly once per run.
const SELF_TEST_BATTERIES = Object.freeze({
  'under the ceiling -> green': 1,
  'at the ceiling -> green': 1,
  'over the ceiling -> red': 1,
  'red message names the file': 1,
  'red message names the remedy': 1,
  'red message names the ruled raise form: the ordering ruling\'s comment id and the measured byte delta in the raising PR body': 1,
  'red message bounds the raise by that measured delta': 1,
  'red message says a raise quoting no ruling id stays red, with no tolerance band': 1,
  'red message names the authoring rule': 1,
  'red message states the overage in bytes': 1,
  'empty read -> red, not a skip': 1,
  'unreadable file -> red, not a skip': 1,
  'the unit is UTF-8 bytes, exactly what `wc -c` prints': 1,
  'a CJK character costs its three bytes, not one unit': 1,
  'a trailing newline is a byte like any other': 1,
  'content added at a FLAT line count is metered — the drift the line unit could not see': 1,
  '...and the same growth fits once the ceiling has the bytes': 1,
  'a re-wrap (one space turned into a newline) is byte-neutral: it neither pays nor costs': 1,
  '...so a re-wrap of a file at its ceiling stays green, where a line count would have read it as growth': 1,
  'prose may run past 120 bytes: one 600-byte sentence under its ceiling is green': 1,
  '...and a 600-byte CJK prose line too': 1,
  '...and a wide table row is judged by the same byte count': 1,
  '...while the SAME long line over its ceiling is red, so the green above is the byte count and not a skip': 1,
  'the verdict names no line-length budget at all': 1,
  'every covered file has a positive ceiling': 1,
  'the map is denominated in bytes: every live ceiling exceeds its file\'s line count': 1,
  'SKILL.md is covered': 1,
  'the dev-agent definition is covered': 1,
  'all five compressed references are covered': 1,
  'every lane/seat job description in the tree carries a ceiling row': 1,
  '...and one carrying no row is RED, with the message naming that file': 1,
  '...and an EMPTY roster is RED, not vacuously green: a derived roster checks nothing when the read fails': 1,
  'the other four skills are covered (#9473)': 1,
  'root AGENTS.md is covered (#9792)': 1,
  'root CLAUDE.md is covered (#9965)': 1,
  'references/compile-surfaces.md is covered (#12098)': 1,
  'every separator-less ceiling declares a root-file watch hint': 1,
  'and the declaration names no file the map does not cover': 1,
  'both root instruction files are declared': 1,
  'the declared form is NOT a CEILINGS key': 1,
  'the published skills/ catalog is deliberately uncovered': 1,
  'a wide table row costs its bytes against the file ceiling like any other line': 1,
  '...and the same row is METERED by its file pin': 1,
  'at exactly the pin -> green': 1,
  'one byte wider -> RED (widening a cell is the measured defect)': 1,
  'narrower than the pin -> green': 1,
  'a pin of 0 is a measurement — a file with no table row passes it': 1,
  '...and the FIRST table row in such a file is RED': 1,
  'a missing pin is RED, not a skip (#4690)': 1,
  '...and says so rather than naming a width': 1,
  'the RED message names the width': 1,
  'the RED message names the line': 1,
  'the RED message names the remedy': 1,
  'the RED message names consolidation as the way to pay it down': 1,
  'the RED message offers NO allowlist': 1,
  'the RED message says raising needs a maintainer ruling': 1,
  'scanTableRows finds the widest row': 1,
  '...and reports its line number': 1,
  'a `|` line inside a FENCE is not a table row': 1,
  'a `|` line in FRONT MATTER is not a table row': 1,
  'a file with no table row measures 0': 1,
  'a table row AFTER a closed fence is measured: the fence state closes again': 1,
  'a table row AFTER closed front matter is measured: the front-matter state ends at its second ---': 1,
  'every ceilinged file carries a pin': 1,
  'and the pin map names no file the ceiling map does not cover': 1,
  'every pin is a non-negative integer': 1,
  'the published skills/ catalog is uncovered here too': 1,
  'the citation is the ruling this file was given': 1,
  'cross-file move — a raise covered by its sources\' net decrease PASSES': 1,
  '...and the green verdict states the arithmetic it read': 1,
  'cross-file move — a raise whose sources did NOT shrink is RED (the whole defect: a `move` that licenses an ordinary raise would run green forever)': 1,
  '...and the RED verdict names the raise and the net decrease it fell short of': 1,
  '...and sends the author to the ordinary path rather than to a bigger declaration': 1,
  '...and the ordinary path it names is the ruled form, not a per-instance maintainer word': 1,
  '...and the citation refusal names the same ruled form for the ordinary path': 1,
  '...and the RED total names the same ruled form for the ordinary path': 1,
  'none of the four ceiling refusals still sends the author to a per-instance maintainer ruling': 1,
  'none of the four ceiling refusals speaks of lines: the unit they name is bytes': 1,
  'cross-file move — a raise EXCEEDING the net decrease is RED, even by one byte': 1,
  '...while a raise exactly equal to it is legal': 1,
  'cross-file move — a declaration citing no ruling is RED, however sound its arithmetic': 1,
  '...and the RED verdict spells the citation it wanted': 1,
  'cross-file move — declarations whose net movement is 0 leave the map total unchanged': 1,
  'cross-file move — a declaration whose participants net POSITIVE fails the total (+2 here)': 1,
  '...and the RED total names the bytes it grew by': 1,
  '...and a net-negative move reports the corpus shrinking': 1,
  'cross-file move — one source may not pay for two destinations': 1,
  'cross-file move — a destination lowered back to or below its pre-move ceiling reads as PAID DOWN, never as red (lowering is always legitimate)': 1,
  '...and says so rather than reporting an arithmetic it can no longer measure': 1,
  'cross-file move — a SOURCE grown back past what it paid re-opens the move (the loophole: the destination keeps the bytes while the payers grow back)': 1,
  'cross-file move — an unknown destination is RED, not a skip (#4690)': 1,
  'cross-file move — an unknown source is RED, not a skip (#4690)': 1,
  'cross-file move — a file may not pay its own raise': 1,
  'cross-file move — a declaration naming no source at all is RED': 1,
  'every live declaration cites the ruling': 1,
  'every live declaration names its destination\'s pre-move ceiling and at least one source': 1,
  'every live participant is a file this map covers': 1,
  'ruled raise — a destination that later took an ordinary ruled raise PASSES with `was` at its literal pre-move value': 1,
  '...and the verdict prices the MOVE, not the ruling: +10 against the sources\' net 11': 1,
  '...and names the ruled bytes it took out, so the arithmetic can be read back': 1,
  '...while the SAME tree with the raise unrecorded is the double red this record ends': 1,
  '...whose first half reads the ruling as the move\'s: +44 against 11': 1,
  '...and which now sends the author to the record rather than to `was`': 1,
  'ruled raise — the map-wide total subtracts it too, and reads the corpus DOWN 1': 1,
  '...where the unrecorded twin reports the corpus growing by 33': 1,
  'ruled raise — a record quoting NO ruling is RED (the licence is the maintainer\'s or it does not exist)': 1,
  '...and the RED verdict says what it wanted': 1,
  '...while an ENGLISH ruling quoted the way this map already quotes one passes': 1,
  'ruled raise — a record with no byte count is RED': 1,
  'ruled raise — a NEGATIVE byte count is RED: lowering is always legitimate and is never recorded here': 1,
  'ruled raise — a record with no ruling DATE is RED': 1,
  'ruled raise — records claiming MORE bytes than the ceiling stands above `was` are RED': 1,
  '...which is the loophole that closes: an inflated record would otherwise read the move as paid down and pass forever': 1,
  'ruled raise — a destination whose whole rise is ruled keeps none of it for the move, and reads as paid down': 1,
  'ruled raise — a declaration carrying no record behaves exactly as before (every case above this group is one)': 1,
  'every live ruled-raise record quotes its ruling, dates it, and names a positive byte count': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a label collapse to ONE key in
// the literal above, so the roster falls below this number; the table
// cross-check in the floor block is the other half, and names WHICH label
// collided. Lowered 164 → 114 by the byte re-base. Left (77): the 66 rows of the
// max-line-length rule and its Han-punctuation break rule, retired with the
// rule; the pin row that read the line rule's table exemption; and 10 rows
// relabelled from lines to bytes. Arrived (27): those 10 relabels; the pin
// pair's new first half (the byte ceiling meters a wide row too); and 16
// byte-unit rows (the overage, the unreadable file, the twelve unit rows, the
// map denominated in bytes, the refusals speaking of bytes). Raised 114 → 116
// by the contract review's S1: two scanTableRows rows that pin a fence and
// front matter CLOSING, the job two retired line-rule scan rows used to do
// for the shared advanceState.
const SELF_TEST_BATTERY_FLOOR = 116;

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-skill-line-ratchet self-test reached its verdict';

// -- The lane roster, DERIVED from the tree (#15965) -------------------------
//
// The roster is read from the DIRECTORY, so the tree and the map are two
// independent sources checked against one another: a new lane file is pinned by
// construction. A derived roster has one failure mode of its own — `[].every()`
// is `true`, so an unreadable lanes/ directory would report perfect coverage of
// nothing — and the verdict therefore refuses an EMPTY roster outright.
const LANES_DIR = '.claude/skills/pm-dispatch/references/lanes/';

/**
 * The lane/seat job descriptions present in the tree, sorted. An unreadable
 * directory yields `[]`, which the verdict below reads as RED.
 *
 * @returns {string[]}
 */
export function laneFilesOnDisk() {
  try {
    return readdirSync(new URL(LANES_DIR, REPO_ROOT)).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

/**
 * Every lane file in the tree carries a ceiling row keyed by its repo-relative
 * path — the key spelling `CEILINGS` itself uses.
 *
 * @param {string[]} laneFiles lane file names, as read from the tree
 * @param {Map<string, number>} ceilings the ceiling map to hold them against
 * @returns {{ok: boolean, msg: string}}
 */
export function laneRosterVerdict(laneFiles, ceilings) {
  if (laneFiles.length === 0) {
    return {
      ok: false,
      msg: `${LANES_DIR} yielded no *.md lane job description — an empty roster checks nothing (every() over nothing is true), so it is red, not a skip.`,
    };
  }
  const uncovered = laneFiles.filter((f) => !ceilings.has(`${LANES_DIR}${f}`));
  if (uncovered.length > 0) {
    return {
      ok: false,
      msg: `${uncovered.map((f) => `${LANES_DIR}${f}`).join(', ')} — lane job description(s) in the tree carrying no ceiling row, so the ratchet does not read them at all. Give each one a row keyed by that path, or take the lane file out of the tree.`,
    };
  }
  return { ok: true, msg: `all ${laneFiles.length} lane/seat job descriptions in the tree carry a ceiling row.` };
}

/** Line count of a live covered file, for the unit pin; `0` when unreadable. */
function liveLineCount(rel) {
  try {
    const text = readFileSync(new URL(rel, REPO_ROOT), 'utf8');
    return text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  } catch {
    return 0;
  }
}

function selfTest() {
  const rel = '.claude/skills/pm-dispatch/SKILL.md';
  const red = verdict(rel, 9999, 3050);
  // Fixture for the derived roster's naming red path: a tree that carries
  // triage.md, against a map holding a row for engine.md only.
  const laneGap = laneRosterVerdict(['engine.md', 'triage.md'], new Map([[`${LANES_DIR}engine.md`, 32]]));
  const cases = [
    ['under the ceiling -> green', verdict(rel, 2900, 3050).ok, true],
    ['at the ceiling -> green', verdict(rel, 3050, 3050).ok, true],
    ['over the ceiling -> red', verdict(rel, 3051, 3050).ok, false],
    ['red message names the file', red.msg.includes(rel), true],
    ['red message names the remedy', red.msg.includes('references/'), true],
    // The ruled raise form (maintainer ruling 2026-10-15, letter B, ruling record
    // 6184799323): the ordering ruling's comment id and the measured delta,
    // quoted in the raising PR's body; the row moves by at most that delta.
    ['red message names the ruled raise form: the ordering ruling\'s comment id and the measured byte delta in the raising PR body', red.msg.includes('its comment id and the measured byte delta quoted in the raising PR\'s body'), true],
    ['red message bounds the raise by that measured delta', red.msg.includes('by at most that delta'), true],
    ['red message says a raise quoting no ruling id stays red, with no tolerance band', red.msg.includes('no ruling id stays red') && red.msg.includes('no tolerance band'), true],
    ['red message names the authoring rule', red.msg.includes('stories live on cards'), true],
    ['red message states the overage in bytes', red.msg.includes('9999 bytes') && red.msg.includes('6949 over'), true],
    ['empty read -> red, not a skip', fileVerdict(rel, '', 3050).ok, false],
    ['unreadable file -> red, not a skip', fileVerdict(rel, null, 3050).ok, false],
    // ── The unit: bytes, and nothing about lines ─────────────────────────────
    // Each row is a PAIR or a measured near-twin, so a case can only pass by the
    // unit actually being bytes: a line-counting implementation fails them.
    ...(() => {
      const asciiSentence = `${'This is one full sentence of skill prose that runs on. '.repeat(11).slice(0, 599)}\n`; // 600 bytes, one line
      const cjkSentence = `${'中文规则正文'.repeat(33)}内容`;                                             // 33 × 18 + 6 = 600 bytes, one line
      const wideRow = `| a | ${'中文内容'.repeat(25)} |\n`;                                             // 6 + 300 + 3 = 309 bytes
      const tenRules = `${Array.from({ length: 10 }, (_, i) => `- rule ${i}`).join('\n')}\n`;
      // The same ten lines, with content appended to one of them: line count
      // flat, bytes up. Exactly the drift the line unit could not see.
      const tenRulesGrown = tenRules.replace('- rule 3', `- rule 3 ${'and more text '.repeat(10).trim()}`);
      const wrapBefore = 'one long sentence that the author wraps\n';
      const wrapAfter = 'one long sentence\nthat the author wraps\n';
      return [
        ['the unit is UTF-8 bytes, exactly what `wc -c` prints', countBytes('abc\n'), 4],
        ['a CJK character costs its three bytes, not one unit', countBytes('中文'), 6],
        ['a trailing newline is a byte like any other', countBytes('x\n') - countBytes('x'), 1],
        ['content added at a FLAT line count is metered — the drift the line unit could not see', tenRulesGrown.split('\n').length === tenRules.split('\n').length && !fileVerdict('f.md', tenRulesGrown, countBytes(tenRules)).ok, true],
        ['...and the same growth fits once the ceiling has the bytes', fileVerdict('f.md', tenRulesGrown, countBytes(tenRulesGrown)).ok, true],
        ['a re-wrap (one space turned into a newline) is byte-neutral: it neither pays nor costs', countBytes(wrapAfter) - countBytes(wrapBefore), 0],
        ['...so a re-wrap of a file at its ceiling stays green, where a line count would have read it as growth', wrapAfter.split('\n').length > wrapBefore.split('\n').length && fileVerdict('f.md', wrapAfter, countBytes(wrapBefore)).ok, true],
        ['prose may run past 120 bytes: one 600-byte sentence under its ceiling is green', countBytes(asciiSentence) === 600 && fileVerdict('f.md', asciiSentence, 600).ok, true],
        ['...and a 600-byte CJK prose line too', countBytes(cjkSentence) === 600 && fileVerdict('f.md', cjkSentence, 600).ok, true],
        ['...and a wide table row is judged by the same byte count', countBytes(wideRow) > 120 && fileVerdict('f.md', wideRow, countBytes(wideRow)).ok, true],
        ['...while the SAME long line over its ceiling is red, so the green above is the byte count and not a skip', fileVerdict('f.md', asciiSentence, 599).ok, false],
        ['the verdict names no line-length budget at all', [fileVerdict('f.md', asciiSentence, 600).msg, fileVerdict('f.md', asciiSentence, 599).msg].some((m) => /120|per line|line length|wrap/i.test(m)), false],
      ];
    })(),
    ['every covered file has a positive ceiling', [...CEILINGS.values()].every((n) => Number.isInteger(n) && n > 0), true],
    // A re-base that left one row in lines would pass every other case here and
    // hand that file ~100x headroom. No file of this corpus averages a byte per
    // line, so a ceiling at or below the line count is a row nobody re-based.
    ['the map is denominated in bytes: every live ceiling exceeds its file\'s line count', [...CEILINGS].every(([k, n]) => n > liveLineCount(k)), true],
    ['SKILL.md is covered', CEILINGS.has('.claude/skills/pm-dispatch/SKILL.md'), true],
    ['the dev-agent definition is covered', CEILINGS.has('.claude/agents/os-dev.md'), true],
    ['all five compressed references are covered', ['dispatch-runbook', 'platform-readings', 'l1-review-checklist', 'landing-operations', 'seat-post-protocol'].every((n) => CEILINGS.has(`.claude/skills/pm-dispatch/references/${n}.md`)), true],
    ['every lane/seat job description in the tree carries a ceiling row', laneRosterVerdict(laneFilesOnDisk(), CEILINGS).ok, true],
    ['...and one carrying no row is RED, with the message naming that file', !laneGap.ok && laneGap.msg.includes('triage.md'), true],
    ['...and an EMPTY roster is RED, not vacuously green: a derived roster checks nothing when the read fails', laneRosterVerdict([], CEILINGS).ok, false],
    ['the other four skills are covered (#9473)', ['checklist-test', 'checklist-author', 'dogfood-verification', 'spec-property-retirement'].every((n) => CEILINGS.has(`.claude/skills/${n}/SKILL.md`)), true],
    ['root AGENTS.md is covered (#9792)', CEILINGS.has('AGENTS.md'), true],
    ['root CLAUDE.md is covered (#9965)', CEILINGS.has('CLAUDE.md'), true],
    ['references/compile-surfaces.md is covered (#12098)', CEILINGS.has('.claude/skills/pm-dispatch/references/compile-surfaces.md'), true],
    // The dispatch-gates declaration (#9964). Enforcement cannot hold any of
    // these: the declaration is read by another tool entirely.
    ['every separator-less ceiling declares a root-file watch hint', [...CEILINGS.keys()].filter((k) => !k.includes('/')).every((k) => ROOT_FILE_WATCH_HINTS.includes(`${k}/**`)), true],
    ['and the declaration names no file the map does not cover', ROOT_FILE_WATCH_HINTS.every((h) => CEILINGS.has(h.replace(/\/\*+$/, ''))), true],
    ['both root instruction files are declared', ROOT_FILE_WATCH_HINTS.join(',') === 'AGENTS.md/**,CLAUDE.md/**', true],
    ['the declared form is NOT a CEILINGS key', [...CEILINGS.keys()].some((k) => ROOT_FILE_WATCH_HINTS.includes(k)), false],
    // The boundary the header states, pinned (#9923): a ceiling on a real
    // published SKILL.md runs green like any other row.
    ['the published skills/ catalog is deliberately uncovered', [...CEILINGS.keys()].some((k) => k.startsWith('skills/')), false],
    // ── #11947: the per-file max-table-row-bytes pin, kept by its ruling ────
    ...(() => {
      const row = `| a | ${'中文内容'.repeat(20)} |`;      // 6 + 240 + 2 = 248 bytes
      const doc = `# t\n\n| a | b |\n|---|---|\n${row}\n`; // the row lands on line 5
      const fenced = `\`\`\`\n| a | ${'x'.repeat(200)} |\n\`\`\`\n`;
      const red = tableRowVerdict('f.md', 999, 3, 100);
      return [
        // The pairing: two meters on the SAME row. The byte ceiling counts every
        // byte of it (one past the ceiling is red), and the pin meters its width.
        // A case asserting only one half would pass under either control alone.
        ['a wide table row costs its bytes against the file ceiling like any other line', fileVerdict('f.md', `${row}\n`, countBytes(row)).ok, false],
        ['...and the same row is METERED by its file pin', tableRowVerdict('f.md', 248, 5, 247).ok, false],
        ['at exactly the pin -> green', tableRowVerdict('f.md', 248, 5, 248).ok, true],
        ['one byte wider -> RED (widening a cell is the measured defect)', tableRowVerdict('f.md', 249, 5, 248).ok, false],
        ['narrower than the pin -> green', tableRowVerdict('f.md', 100, 5, 248).ok, true],
        ['a pin of 0 is a measurement — a file with no table row passes it', tableRowVerdict('f.md', 0, 0, 0).ok, true],
        ['...and the FIRST table row in such a file is RED', tableRowVerdict('f.md', 30, 4, 0).ok, false],
        ['a missing pin is RED, not a skip (#4690)', tableRowVerdict('f.md', 0, 0, undefined).ok, false],
        ['...and says so rather than naming a width', tableRowVerdict('f.md', 0, 0, undefined).msg.includes('no max-table-row-bytes pin'), true],
        ['the RED message names the width', red.msg.includes('999-byte'), true],
        ['the RED message names the line', red.msg.includes('L3'), true],
        ['the RED message names the remedy', red.msg.includes('reference file'), true],
        ['the RED message names consolidation as the way to pay it down', red.msg.includes('consolidate'), true],
        ['the RED message offers NO allowlist', red.msg.includes('no allowlist'), true],
        ['the RED message says raising needs a maintainer ruling', red.msg.includes('maintainer ruling'), true],
        // scanTableRows — the seed instrument. The pins were read from it, so a
        // wrong scan would have written wrong pins that then ran green forever.
        ['scanTableRows finds the widest row', scanTableRows(doc).widest, 248],
        ['...and reports its line number', scanTableRows(doc).line, 5],
        ['a `|` line inside a FENCE is not a table row', scanTableRows(fenced).widest, 0],
        ['a `|` line in FRONT MATTER is not a table row', scanTableRows('---\n| a |\n---\n').widest, 0],
        ['a file with no table row measures 0', scanTableRows('中文内容\n').widest, 0],
        // The scan shares advanceState, so both CLOSING transitions are pinned
        // here: an advanceState that never closed a fence, or never left front
        // matter, would skip every later line and read 0, under the real pin.
        ['a table row AFTER a closed fence is measured: the fence state closes again', scanTableRows(`\`\`\`\n| f |\n\`\`\`\n| ${'w'.repeat(40)} |\n`).widest, 44],
        ['a table row AFTER closed front matter is measured: the front-matter state ends at its second ---', scanTableRows(`---\nname: x\n---\n| ${'m'.repeat(30)} |\n`).widest, 34],
        // The two maps must stay in step; enforcement cannot hold this, because
        // a file missing from the pin map is simply never consulted.
        ['every ceilinged file carries a pin', [...CEILINGS.keys()].every((k) => MAX_TABLE_ROW_BYTES.has(k)), true],
        ['and the pin map names no file the ceiling map does not cover', [...MAX_TABLE_ROW_BYTES.keys()].every((k) => CEILINGS.has(k)), true],
        ['every pin is a non-negative integer', [...MAX_TABLE_ROW_BYTES.values()].every((n) => Number.isInteger(n) && n >= 0), true],
        ['the published skills/ catalog is uncovered here too', [...MAX_TABLE_ROW_BYTES.keys()].some((k) => k.startsWith('skills/')), false],
      ];
    })(),
    // ── The cross-file move (the 2026-09-03 ruling), in bytes ───────────────
    // Every case is a PAIR or a near-twin of a legal declaration, because the
    // failure mode of a loose implementation is a `move` that licenses an
    // ordinary raise — which would run green forever and retire the ratchet.
    ...(() => {
      const ceil = (o) => new Map(Object.entries(o));
      const cited = `moved from a.md + b.md — ${RULING_CITATION}`;
      const decl = { ruling: cited, was: 100, sources: [['a.md', 30], ['b.md', 20]] };
      // Paid: dest +5 against sources that shed 3 and 4.
      const paid = ceil({ 'dest.md': 105, 'a.md': 27, 'b.md': 16 });
      // Same declaration, sources untouched — the raise nobody paid for.
      const unpaid = ceil({ 'dest.md': 105, 'a.md': 30, 'b.md': 20 });
      // Paid in part only: +5 against a net decrease of 3.
      const short = ceil({ 'dest.md': 105, 'a.md': 27, 'b.md': 20 });
      // The destination lowered again after the move landed.
      const paidDown = ceil({ 'dest.md': 98, 'a.md': 27, 'b.md': 16 });
      // A source grown back after the move landed: the payment undone.
      const regrown = ceil({ 'dest.md': 105, 'a.md': 33, 'b.md': 16 });
      const uncited = { ...decl, ruling: 'moved from a.md + b.md' };
      const mv = (map, d = decl) => crossFileMoveVerdict('dest.md', d, map);
      const total = (map, moves) => crossFileMoveTotalVerdict(new Map(moves), map);
      // A move whose destination later took an ORDINARY ruled raise; the pin
      // fails if the two quantities are ever folded back together.
      const readings = ceil({ 'dest.md': 358, 'a.md': 31, 'b.md': 28, 'c.md': 88 });
      const ruledRec = { ruling: 'maintainer, 2026-09-04, verbatim: 「同意」', date: '2026-09-04', delta: 34 };
      const moved = { ...decl, was: 314, sources: [['a.md', 35], ['b.md', 30], ['c.md', 93]] };
      const withRuled = { ...moved, ruledRaises: [ruledRec] };
      const rr = (over) => crossFileMoveVerdict('dest.md', { ...moved, ruledRaises: [{ ...ruledRec, ...over }] }, readings);
      const mvR = (d = withRuled) => crossFileMoveVerdict('dest.md', d, readings);
      const ORDINARY_PATH = 'its comment id and the measured byte delta quoted in the raising PR\'s body';
      const refusals = [red.msg, mv(unpaid).msg, mv(paid, uncited).msg, total(short, [['dest.md', decl]]).msg];
      return [
        ['the citation is the ruling this file was given', RULING_CITATION, '#14685 item 5 (comment 5520452691)'],
        // (1) A legal move passes — the assertion the other three are read against.
        ['cross-file move — a raise covered by its sources\' net decrease PASSES', mv(paid).ok, true],
        ['...and the green verdict states the arithmetic it read', mv(paid).msg.includes('+5') && mv(paid).msg.includes('decrease of 7'), true],
        // (2) A raise with no decrease behind it is an ordinary raise.
        ['cross-file move — a raise whose sources did NOT shrink is RED (the whole defect: a `move` that licenses an ordinary raise would run green forever)', mv(unpaid).ok, false],
        ['...and the RED verdict names the raise and the net decrease it fell short of', mv(unpaid).msg.includes('+5') && mv(unpaid).msg.includes('decrease of 0'), true],
        ['...and sends the author to the ordinary path rather than to a bigger declaration', mv(unpaid).msg.includes(ORDINARY_PATH), true],
        ['...and the ordinary path it names is the ruled form, not a per-instance maintainer word', mv(unpaid).msg.includes('by at most that delta') && !mv(unpaid).msg.includes('maintainer ruling quoted'), true],
        // (3) Partly paid is not paid — the boundary case, one byte short.
        ['cross-file move — a raise EXCEEDING the net decrease is RED, even by one byte', mv(short).ok, false],
        ['...while a raise exactly equal to it is legal', crossFileMoveVerdict('dest.md', { ...decl, was: 98 }, ceil({ 'dest.md': 105, 'a.md': 27, 'b.md': 16 })).ok, true],
        // (4) The citation. A raise that names no ruling is not a move at all.
        ['cross-file move — a declaration citing no ruling is RED, however sound its arithmetic', mv(paid, uncited).ok, false],
        ['...and the RED verdict spells the citation it wanted', mv(paid, uncited).msg.includes(RULING_CITATION), true],
        ['...and the citation refusal names the same ruled form for the ordinary path', mv(paid, uncited).msg.includes(ORDINARY_PATH), true],
        // (5) Condition (b), map-wide.
        ['cross-file move — declarations whose net movement is 0 leave the map total unchanged', total(paid, [['dest.md', decl]]).ok, true],
        ['cross-file move — a declaration whose participants net POSITIVE fails the total (+2 here)', total(short, [['dest.md', decl]]).ok, false],
        ['...and the RED total names the bytes it grew by', total(short, [['dest.md', decl]]).msg.includes('by 2 bytes'), true],
        ['...and the RED total names the same ruled form for the ordinary path', total(short, [['dest.md', decl]]).msg.includes(ORDINARY_PATH), true],
        ['none of the four ceiling refusals still sends the author to a per-instance maintainer ruling', refusals.some((m) => m.includes('maintainer ruling quoted')), false],
        ['none of the four ceiling refusals speaks of lines: the unit they name is bytes', refusals.some((m) => /\d+ lines?\b|line delta/.test(m)) || !refusals.every((m) => m.includes('byte')), false],
        ['...and a net-negative move reports the corpus shrinking', total(paidDown, [['dest.md', decl]]).msg.includes('down 9 bytes'), true],
        // (6) Disjointness — the one thing that makes (a) summed equal (b).
        ['cross-file move — one source may not pay for two destinations', total(ceil({ 'dest.md': 105, 'other.md': 105, 'a.md': 27, 'b.md': 16 }), [['dest.md', decl], ['other.md', { ruling: RULING_CITATION, was: 100, sources: [['a.md', 30]] }]]).ok, false],
        // (7) Lifecycle, both directions — asymmetric on purpose.
        ['cross-file move — a destination lowered back to or below its pre-move ceiling reads as PAID DOWN, never as red (lowering is always legitimate)', mv(paidDown).ok, true],
        ['...and says so rather than reporting an arithmetic it can no longer measure', mv(paidDown).msg.includes('paid down'), true],
        ['cross-file move — a SOURCE grown back past what it paid re-opens the move (the loophole: the destination keeps the bytes while the payers grow back)', mv(regrown).ok, false],
        // (8) Participants must be files this map covers — a typo is RED, not a skip.
        ['cross-file move — an unknown destination is RED, not a skip (#4690)', crossFileMoveVerdict('nope.md', decl, paid).ok, false],
        ['cross-file move — an unknown source is RED, not a skip (#4690)', mv(paid, { ...decl, sources: [['nope.md', 30]] }).ok, false],
        ['cross-file move — a file may not pay its own raise', mv(paid, { ...decl, sources: [['dest.md', 130]] }).ok, false],
        ['cross-file move — a declaration naming no source at all is RED', mv(paid, { ...decl, sources: [] }).ok, false],
        // (9) The live map. Enforcement covers the arithmetic; the fields every
        // declaration must carry are pinned here (vacuously true while the map
        // is empty, which is correct: there is no declaration to be malformed).
        ['every live declaration cites the ruling', [...CROSS_FILE_MOVES.values()].every((m) => String(m.ruling ?? '').includes(RULING_CITATION)), true],
        ['every live declaration names its destination\'s pre-move ceiling and at least one source', [...CROSS_FILE_MOVES.values()].every((m) => Number.isInteger(m.was) && Array.isArray(m.sources) && m.sources.length > 0), true],
        ['every live participant is a file this map covers', [...CROSS_FILE_MOVES].every(([d, m]) => CEILINGS.has(d) && m.sources.every(([s]) => CEILINGS.has(s))), true],
        // (10) An ORDINARY ruled raise on the destination is not this move's.
        ['ruled raise — a destination that later took an ordinary ruled raise PASSES with `was` at its literal pre-move value', mvR().ok, true],
        ['...and the verdict prices the MOVE, not the ruling: +10 against the sources\' net 11', mvR().msg.includes('+10') && mvR().msg.includes('decrease of 11'), true],
        ['...and names the ruled bytes it took out, so the arithmetic can be read back', mvR().msg.includes('less 34 bytes of ordinary ruled raise'), true],
        ['...while the SAME tree with the raise unrecorded is the double red this record ends', mvR(moved).ok, false],
        ['...whose first half reads the ruling as the move\'s: +44 against 11', mvR(moved).msg.includes('+44') && mvR(moved).msg.includes('decrease of 11'), true],
        ['...and which now sends the author to the record rather than to `was`', mvR(moved).msg.includes('ruledRaises'), true],
        ['ruled raise — the map-wide total subtracts it too, and reads the corpus DOWN 1', total(readings, [['dest.md', withRuled]]).ok && total(readings, [['dest.md', withRuled]]).msg.includes('down 1 byte'), true],
        ['...where the unrecorded twin reports the corpus growing by 33', total(readings, [['dest.md', moved]]).msg.includes('by 33 bytes'), true],
        // The subtraction is a licence to grow, so every bar on it is pinned.
        ['ruled raise — a record quoting NO ruling is RED (the licence is the maintainer\'s or it does not exist)', rr({ ruling: 'the intake-family raise, +34 bytes' }).ok, false],
        ['...and the RED verdict says what it wanted', rr({ ruling: 'the intake-family raise, +34 bytes' }).msg.includes('quotes no ruling'), true],
        ['...while an ENGLISH ruling quoted the way this map already quotes one passes', rr({ ruling: 'maintainer 2026-09-04, verbatim: "the ceiling is raised by the measured need, +34"' }).ok, true],
        ['ruled raise — a record with no byte count is RED', rr({ delta: undefined }).ok, false],
        ['ruled raise — a NEGATIVE byte count is RED: lowering is always legitimate and is never recorded here', rr({ delta: -34 }).ok, false],
        ['ruled raise — a record with no ruling DATE is RED', rr({ date: undefined }).ok, false],
        ['ruled raise — records claiming MORE bytes than the ceiling stands above `was` are RED', rr({ delta: 90 }).ok, false],
        ['...which is the loophole that closes: an inflated record would otherwise read the move as paid down and pass forever', rr({ delta: 90 }).msg.includes('over-claim'), true],
        ['ruled raise — a destination whose whole rise is ruled keeps none of it for the move, and reads as paid down', rr({ delta: 44 }).ok && rr({ delta: 44 }).msg.includes('paid down'), true],
        ['ruled raise — a declaration carrying no record behaves exactly as before (every case above this group is one)', mv(paid).ok && mv(paid).msg.includes('+5'), true],
        ['every live ruled-raise record quotes its ruling, dates it, and names a positive byte count', [...CROSS_FILE_MOVES.values()].every((m) => (m.ruledRaises ?? []).every((r) => VERBATIM_QUOTATION.test(String(r?.ruling ?? '')) && RULED_RAISE_DATE.test(String(r?.date ?? '')) && Number.isInteger(r?.delta) && r.delta > 0)), true],
      ];
    })(),
  ].map((c) => (Array.isArray(c[1]) || (c[1] && typeof c[1] === 'object') ? [c[0], JSON.stringify(c[1]), JSON.stringify(c[2])] : c));
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
  // -- The floor: every declared row RAN, and ran its case (#13489) --------
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
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  const rowLabels = cases.map(([name]) => name);
  const duplicated = [...new Set(rowLabels.filter((name, i) => rowLabels.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    floorBreached = true;
    floorFailure(
      `the cases table uses ${duplicated.map((n) => JSON.stringify(n)).join(', ')} as a row label more than once — `
        + 'two rows sharing a label are ONE battery, so the second can stop running while the first keeps the floor met.',
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed that case holds.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (a deleted row, a renamed label, a loop that no longer '
        + 'reaches it) and restore it.',
    );
  }

  if (failed) {
    console.error(`✗ check-skill-line-ratchet self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`✓ check-skill-line-ratchet self-test: ${cases.length} cases pass.`);

  return SELF_TEST_VERDICT;
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
    console.error(
      '\n✗ check-skill-line-ratchet self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test\n'
        + 'that never finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
} else run();
