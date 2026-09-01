#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-clause2-carriers — makes the clause-② enqueue gate's limbs LEGIBLE:
 * the dual carrier is asserted by mechanism, and a limb nobody can read is
 * reported as a missing reading rather than passing for a decision
 * (#13922 · #12409 · #13914).
 *
 *   node scripts/pm/check-clause2-carriers.mjs              # live sweep, report-only
 *   node scripts/pm/check-clause2-carriers.mjs --pair 13910 # ONE PR: a pre-arm predicate
 *   node scripts/pm/check-clause2-carriers.mjs --json       # the sweep, for round reports
 *   node scripts/pm/check-clause2-carriers.mjs --self-test  # offline, no network
 *
 * ## The gate, and the three limbs it is supposed to stand on
 *
 * `scripts/pm/ensure-pm-labels.sh` states the gate in its own words: a PR whose
 * ACTUAL diff touches the contract surface — or whose CARD'S CLAIM COMMENT
 * declares `Clause-②: yes` (the content limb, judged from the card,
 * path-independent) — but which was dispatched below the contract-review tier
 * waits outside the queue under `needs:contract-review` until the review
 * sub-round clears it. So: ① a path limb, ② a declaration limb, ③ the label
 * itself, which the maintainer's ruling of 2026-08-22 puts on BOTH carriers
 * (「简化一点是否可以直接挂 PR 侧」「两边都挂好」).
 *
 * ## What already existed, and why this file is not it (measured, 2026-08-31)
 *
 * ⚠️ The filing card says the dual-carrier rule "has no enforcement at all" and
 * that "there is no check anywhere that a `needs:contract-review` on one
 * carrier implies it on the other". That is NOT true and the correction is the
 * reason this file has the shape it has: `h31ContractReviewCarrierSplit` in
 * `scripts/pm/check-half-states.mjs` is exactly that check, both directions, it
 * names the offending carrier, and it has a standing caller —
 * `.github/workflows/half-state-patrol.yml`, four times a day, last green
 * 2026-08-31T13:42:41Z. Building a second carrier comparison as though H31 did
 * not exist would have produced two predicates that can disagree about the same
 * pair, which is the drift this tree punishes everywhere else. So the split
 * comparison here IMPORTS H31's label constant and H31's delivery relation
 * rather than restating either.
 *
 * What H31 cannot do is the part the cards actually measured:
 *
 *   1. **Agreement on ABSENCE is H31's silent case, by construction.** It fires
 *      on a SPLIT. A pair carrying the gate on NEITHER carrier is, to H31,
 *      clean — and "silent on all three limbs at once" is precisely the shape
 *      #13922 measured live on PR #13910 / card #13476: the author had declared
 *      clause ② in their own PR body, and no limb was in a state to fire. A
 *      comparison of two carriers cannot report a gate that is missing from
 *      both of them.
 *   2. **Nothing reads limb ②.** The declaration lives in the card's claim
 *      comment in a FIXED machine spelling, and this repo had no reader for it
 *      at all — measured by grep over `scripts/` and `.github/workflows/`: the
 *      token appears in a label DESCRIPTION and in prose, never in a predicate.
 *      #13914 measured the consequence on the board: 2 of 3 cards in one review
 *      round carried the declaration as prose or in the PR body instead, and a
 *      card with no declaration is today indistinguishable from a card that
 *      declared `no`. One of those is a decision; the other is a missing
 *      reading, and they must not look the same.
 *   3. **Its delivery channel trims.** H31 is one row family among ~38 in a
 *      report rendered into one pinned issue body — measured on the 13:42Z run:
 *      231 findings, 74 rendered, "157 further row(s) omitted to fit GitHub's
 *      issue-body limit". A gate row competes for space on equal terms with
 *      board-hygiene rows, and the anchor then reads clean on the gate. This
 *      file answers one question and prints only its own rows, so nothing it
 *      finds can be crowded out by something else's inventory.
 *
 * ## What this file deliberately does NOT do
 *
 * **It does not evaluate limb ① (the path limb), and that is a boundary, not a
 * gap.** The contract surface is already declared once, in `SUSPECT_TIER_GLOBS`
 * in `scripts/pm/dispatch-gates.mjs`, whose own docblock insists the path
 * reading is "a HINT, never a verdict" because clause ② is judged from a card's
 * CONTENT. A second declaration of that surface here would be a hand copy of a
 * register — the exact drift `check:pm-governed-prose` exists to stop one
 * family over — and it would cost a changed-file listing per pair for a reading
 * that decides nothing this file reports. Every row below is derivable from the
 * declaration and the two carriers alone.
 *
 * **It relaxes no spelling.** `Clause-②: yes` / `Clause-②: no` are the only two
 * readings that count, and prose is not one of them. #12409 measured where the
 * tolerant direction ends: on its corpus a strict `Contract review: PASS`
 * marker matched 5 of 35 removals while an "any PASS token" reading matched 26
 * — a check that can barely fail. Decoration around the line is tolerated the
 * way H4 tolerates it (a leading blockquote, a list bullet, backticks, bold),
 * because that is markdown a seat writes without meaning anything by it; the
 * KEY and the VALUE are literal. A near-miss spelling is reported IN the row so
 * the residue is actionable, and it still does not count as a declaration.
 *
 * **It writes nothing.** No label, ever — hanging or clearing a review gate
 * from a checker would be issuing the review verdict, which is 自查放行 and is
 * the one thing the whole clause-② chain forbids. Same call H31 makes, for the
 * same reason.
 *
 * **It does not read verdict comments, and the PASS half of the recovery rule
 * stays human.** `references/contract-review.md` states the human reading as
 * 「PASS + 无标 + head 未动 = 已清标非被剥;head 后移或无结论才重挂」. C3
 * mechanizes the second and third conjuncts — 无标, from the labels, and
 * head 未动, from the head commit's date — and deliberately not the first:
 * #12409 measured a strict `Contract review: PASS` marker at 5 of 35 removals
 * against 26 for an "any PASS token" reading, i.e. a check that can barely fail,
 * and reading a verdict to clear a gate is the 自查放行 this file already
 * refuses. Consequence for a reader of exit 0: it means "the gate was bound by
 * the discipline and cleared, and nothing has moved since", NEVER "the review
 * passed". Precondition ① of the landing check is still a human reading a PASS
 * comment on the card.
 *
 * ## How a COMPLETED review is told from a gate that never ran (#14155)
 *
 * A `Clause-②: yes` declaration is HISTORY — it stays on the thread forever. The
 * label is STATE — a completed review clears it from both carriers, by rule. So
 * every clause-② pair that completes its review lands in exactly the shape C3
 * hunts: declared `yes`, gate on neither carrier. Measured 2026-09-01 on PR
 * #13864 / card #13657 — PASS at head `9af92aa3`, both carriers cleared nine
 * seconds apart, C3 fired on the legitimate clear. Read literally that made the
 * landing check's precondition ② unsatisfiable after its own clear: `--pair`
 * could only answer 0 in the window BETWEEN the PASS and the clear, which is the
 * wrong order, and every landed pair kept its C3 row on every later sweep.
 *
 * The evidence that separates the two needs no verdict comment: the **label
 * event stream** on each carrier. A gate that was bound leaves a `labeled`; a
 * review that completed leaves an `unlabeled`; a fail-open leaves neither. C3
 * therefore reads both carriers' streams and answers four distinguishable
 * states — never hung (the fail-open, the row as it was), hung-then-cleared with
 * the head unmoved (the completed state: clean), hung-then-cleared with the head
 * moved since (the 重挂-owed state), and bound on one carrier only (one removal
 * where a legitimate clear leaves two — the strip signature). An unreadable
 * stream is UNJUDGED, never clean.
 *
 * **The cost stays bounded**: streams are fetched for pairs already in C3's
 * candidate shape (declared `yes`, bare on both carriers) and for nobody else,
 * and the head commit only once both carriers read cleared. `needsGateHistory`
 * is the one predicate the reader and the UNJUDGED accounting share, so the set
 * that owes a stream and the set that gets one cannot drift apart.
 *
 * ## Exit codes — the refusal to read as clean, in one table
 *
 * Sweep mode (default, and `--json`):
 *   0  swept COMPLETELY. Zero rows and forty rows both exit 0: a board fact is
 *      not a fact about whichever PR happens to run CI next, so failing a build
 *      over it would punish the wrong actor (`check-half-states.mjs`'s header
 *      argues this at length, and this file is the same family).
 *   1  bad usage — could not sweep at all.
 *   2  swept, but INCOMPLETE: at least one pair whose card, labels or comments
 *      could not be read. An unread carrier is NOT a bare carrier and an unread
 *      thread is NOT an absent declaration (#4690): incomplete must never read
 *      as clean, which on a report-only tool is the sharper risk, because a
 *      quiet run looks exactly like a healthy board.
 *   3  PREREQUISITE NOT MET — the transport could not reach the API at all.
 *      The constant is imported from `check-half-states.mjs` so the family has
 *      ONE code for this, and that script's `--probe` is the one classifier;
 *      this file points at it rather than growing a second one.
 *
 * `--pair` is a PREDICATE about the pair named on the command line — a fact
 * about THAT PR, which is why it may answer adversely where the sweep may not.
 * It shares 1/2/3 with the sweep and adds one code of its own:
 *   0  the pair's clause-② limbs are legible and its carriers agree — which
 *      INCLUDES the completed state: a declared `yes` whose gate was hung on
 *      both carriers, cleared from both, and whose head has not moved since
 *      (#14155). ⚠️ 0 is not "the review passed"; the PASS reading is human and
 *      is precondition ① of the landing check, not this exit code.
 *   2  also the answer when a C3 candidate's event stream or head commit could
 *      not be read: an unread stream is not a never-hung gate, so it is UNJUDGED
 *      rather than either verdict.
 *   4  they do not. Deliberately NOT 3: a verdict about the PAIR must be
 *      impossible to confuse with "the environment could not answer", so a
 *      seat reading `$?` cannot turn a refusal into a clearance. And ⛔ never
 *      0-with-a-message: silence is what this whole file exists against.
 *
 * ## The standing caller
 *
 * On demand, and the PM round — the `check:pm-governed-merges` posture, whose
 * live half has no schedule either. The `check:pm-clause2-carriers` step in
 * `lint.yml` runs the SELF-TEST only: the sweep reads a shared board over the
 * network and its non-zero exits classify the ENVIRONMENT, which is not a
 * verdict about the PR running it. ⛔ Do not "promote" the sweep into that step
 * — that would be a new merge gate over board state, which is the thing the
 * family has already decided against three times.
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import {
  CLAIM_COMMENT_MARKER,
  CONTRACT_REVIEW_LABEL,
  EXIT_PREREQUISITE_NOT_MET,
  PROXY_FLAG,
  governingClaim,
  isGateSemanticLabel,
  labelNames,
  prDeliversCard,
  proxyRearmPlan,
  resolveSweepRepo,
} from './check-half-states.mjs';

const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const SELF_PATH = fileURLToPath(import.meta.url);
const PROXY_REARM_GUARD = 'OS_CLAUSE2_CARRIERS_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_INCOMPLETE = 2;
/** Re-exported so a caller reads ONE table, not two. Value owned by the sibling. */
export { EXIT_PREREQUISITE_NOT_MET };
/** `--pair` only: the pair's limbs are illegible or its carriers disagree. */
export const EXIT_PAIR_ADVERSE = 4;

// ---------------------------------------------------------------------------
// Limb ② — the declaration, read in the fixed spelling and nowhere near prose
// ---------------------------------------------------------------------------

/**
 * The two readings that ARE a declaration. Written out rather than derived from
 * a pattern so that a reader of this file sees the closed set the way
 * `SKILL.md` states it — 恰这两种拼写.
 */
export const CLAUSE2_VALUES = Object.freeze(['yes', 'no']);

/**
 * The key, and the decoration tolerated around it.
 *
 * Tolerated because a seat writes it without meaning anything by it, and
 * reading it as absent is how #10063 sat blocked in silence (the H4 lesson,
 * one item over): an optional leading blockquote `>` — SKILL.md's own claim
 * template is a blockquote — an optional list bullet, and backtick or bold
 * wrapping on the key. ⛔ NOT tolerated: a different key, a different case, a
 * full-width colon, or the space-separated prose form `Clause ②:` that two of
 * the three measured cards actually wrote. Those are near misses and are
 * reported as such below; they are not declarations.
 */
const CLAUSE2_KEY_LINE = /^[ \t]*(?:>[ \t]*)?(?:[-*][ \t]+)?(?:\*\*)?`?Clause-②`?(?:\*\*)?[ \t]*:(.*)$/;

/**
 * A line that MENTIONS the clause without being the machine declaration — used
 * only to make a "no reading" row actionable by quoting what was there instead.
 * ⛔ It never produces a verdict: widening the predicate to absorb these is the
 * tolerant-consumer direction #12409 bans by name.
 */
const CLAUSE2_NEAR_MISS_LINE = /^[ \t]*(?:>[ \t]*)?(?:[-*#][ \t]*)*(?:\*\*)?`?\s*Clause[ \t-]*(?:②|2|two)(?![\w]).*$/i;

/**
 * The value token, read immediately after the colon.
 *
 * ⚠️ Trailing text after the token is ACCEPTED, and the calibration is not
 * mine: #13914's own control case is described as "the PM claim comment on
 * #12297 carries `Clause-②: yes` **with reasoning**" and is recorded there as
 * the shape that is CORRECT. A reader that rejected a reason on the same line
 * would grade the card's own control as a defect — and on the live board
 * 2026-08-31 it rejected four real claims whose reasoning was parenthetical.
 * So the rule is: the token must be the FIRST thing after the colon, and it
 * must be exactly `yes` or `no`. What a seat writes after it is their argument,
 * which this file does not read and must not.
 *
 * ⛔ That is not a relaxation toward prose. `Clause-②: probably not`,
 * `Clause-②: YES`, `Clause-②: nope` and an empty value all stay MALFORMED,
 * because none of them opens with the token. The boundary is a character
 * class, not a judgement.
 */
function readValueToken(raw) {
  const rest = String(raw ?? '').replace(/^[ \t]+/, '');
  // Built from CLAUSE2_VALUES so the closed set is declared once: adding a
  // third reading would have to be a deliberate edit to that constant.
  const token = new RegExp(`^(?:\\*\\*)?(?:\`)?[ \\t]*(${CLAUSE2_VALUES.join('|')})(?![A-Za-z0-9_])`);
  const m = token.exec(rest);
  return m ? m[1] : null;
}

/** A quoted line for a finding row — capped, because a claim comment can be long. */
function quoteLine(line, cap = 160) {
  const s = String(line ?? '').trim().replace(/\s+/g, ' ');
  return s.length <= cap ? s : `${s.slice(0, cap)}…`;
}

/**
 * Read the declaration limb out of ONE comment or body.
 *
 * @param {string} text
 * @returns {{ kind: 'declared', value: 'yes'|'no', line: string }
 *          | { kind: 'malformed', value: string, line: string }
 *          | { kind: 'near-miss', line: string }
 *          | null}
 *
 * Four-valued on purpose. `declared` and `malformed` are different facts about
 * a line that IS the key; `near-miss` is a fact about a line that is not. Any
 * collapse of these into "no" is the defect #13914 filed.
 */
export function readClause2Line(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  let nearMiss = null;
  for (const line of lines) {
    const m = CLAUSE2_KEY_LINE.exec(line);
    if (m) {
      const value = readValueToken(m[1]);
      if (value !== null) return { kind: 'declared', value, line: quoteLine(line) };
      return { kind: 'malformed', value: quoteLine(m[1], 60), line: quoteLine(line) };
    }
    if (nearMiss === null && CLAUSE2_NEAR_MISS_LINE.test(line)) nearMiss = quoteLine(line);
  }
  return nearMiss === null ? null : { kind: 'near-miss', line: nearMiss };
}

/**
 * The declaration limb of one CARD, judged over its comment thread.
 *
 * The designated carrier is the card's governing CLAIM comment — SKILL.md puts
 * the line in the claim shape, and the enqueue gate's content limb is described
 * as "judged from the card". So a declaration living anywhere else on the
 * thread is a real, separate state (`misplaced`): the seat did the thinking and
 * wrote it down, in a place the gate's predicate does not read. Reporting that
 * as `absent` would blame the wrong thing, and reporting it as `declared` would
 * bless a carrier the gate cannot use.
 *
 * @param {{ body?: string, created_at?: string }[]|null} commentRows — the REST
 *   comment rows, or `null` when the thread could NOT be read.
 * @returns {{ state: 'declared'|'malformed'|'misplaced'|'absent'|'unreadable',
 *   value?: 'yes'|'no', detail?: string }}
 */
export function cardDeclaration(commentRows) {
  if (!Array.isArray(commentRows)) return { state: 'unreadable' };
  const claim = governingClaim(commentRows);
  const claimRows = commentRows.filter((row) => CLAIM_COMMENT_MARKER.test(String(row?.body ?? '')));
  // The governing claim is the one the board is waiting on; when no comment
  // names a branch, every claim-marked comment is still a claim carrier and is
  // read, so a claim written without a branch cannot make the declaration
  // invisible.
  const governing = claim
    ? claimRows.filter((row) => (row?.created_at ?? null) === claim.createdAt)
    : claimRows;
  const pool = governing.length > 0 ? governing : claimRows;

  let malformed = null;
  let nearMiss = null;
  for (const row of pool) {
    const read = readClause2Line(row?.body);
    if (read?.kind === 'declared') return { state: 'declared', value: read.value, detail: read.line };
    if (read?.kind === 'malformed' && malformed === null) malformed = read;
    if (read?.kind === 'near-miss' && nearMiss === null) nearMiss = read;
  }
  if (malformed) return { state: 'malformed', detail: malformed.line };

  // Not in the claim carrier. Is it on the thread at all? That distinction is
  // the whole point of this function.
  for (const row of commentRows) {
    const read = readClause2Line(row?.body);
    if (read?.kind === 'declared') return { state: 'misplaced', value: read.value, detail: read.line };
    if (read?.kind === 'malformed' && malformed === null) malformed = read;
    if (read?.kind === 'near-miss' && nearMiss === null) nearMiss = read;
  }
  if (malformed) return { state: 'malformed', detail: malformed.line };
  return { state: 'absent', detail: nearMiss?.line };
}

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

const NEVER_WRITES =
  'Report-only: ⛔ never a label written from this script — hanging or clearing a review gate ' +
  'from a checker would be issuing the verdict, which is 自查放行.';

/**
 * ⚠️ The two directions of the split are NOT ranked here, and the refusal is
 * deliberate: the two standing sources rank them OPPOSITELY, which is a real
 * disagreement rather than a wording accident.
 *
 *   `check-half-states.mjs` H31 calls the CARD-bare direction "the more
 *   dangerous half", because to the enqueue path an ungated card is a card that
 *   was never gated.
 *   #13922 calls the PR-bare direction the fail-open, because "it is the
 *   carrier the enqueue gate reads", and on #13910 it was the only limb left.
 *
 * Both readings are sound about their own consumer, and this file has no
 * standing to choose between them — picking one would print an adjudication as
 * a derivation. So each direction states its own consequence and neither is
 * called worse. WHICH carrier the enqueue gate actually reads is a protocol
 * question for the maintainer; until it is answered, a split is a split.
 */
const RANKING_UNSETTLED =
  '⚠️ Which direction is the worse one is NOT settled: H31 calls the card-bare direction the ' +
  'more dangerous half (an ungated card enqueues past a live gate) while #13922 calls the ' +
  'PR-bare direction the fail-open (the PR is the carrier the enqueue gate reads). This row ' +
  'ranks neither — a split is a split, and which carrier the gate reads is a protocol question.';

const DUAL_CARRIER =
  'The gate is a DUAL carrier (maintainer 2026-08-22, 「两边都挂好」), hung in one stroke and ' +
  'cleared in one stroke. The second carrier is not decoration: it is the only machine-readable ' +
  'evidence that a gate was CLEARED rather than STRIPPED — a legitimate clear leaves two removals ' +
  'seconds apart, a strip leaves one — and 「闸门被剥不是红灯是放行」, so 「被剥」 and 「从未挂过」 ' +
  'are indistinguishable in the evidence without it.';

/**
 * One pair, as this file reads it.
 *
 * @typedef {object} Pair
 * @property {number} pr
 * @property {boolean} [draft]
 * @property {number} card
 * @property {string[]|null} prLabels   null = could not be read
 * @property {string[]|null} cardLabels null = could not be read
 * @property {{ body?: string, created_at?: string }[]|null} cardComments null = could not be read
 */

/** Did this carrier's labels come back readable? */
function gated(labels) {
  return Array.isArray(labels) ? labels.includes(CONTRACT_REVIEW_LABEL) : null;
}

/**
 * C1 — the two carriers of one gate disagree.
 *
 * The same fact H31 reports, anchored on the PAIR rather than on the card, so a
 * seat can ask it about the one PR in front of it. Both directions, and the
 * dangerous one is named as such: an ungated card with a gated PR reads, to the
 * enqueue path, as a card that was never gated.
 */
export function c1CarrierSplit(pair) {
  const onCard = gated(pair?.cardLabels);
  const onPr = gated(pair?.prLabels);
  if (onCard === null || onPr === null) return null; // unreadable — accounted as UNJUDGED, not clean.
  if (onCard === onPr) return null;
  const draft = pair.draft ? ' (draft)' : '';
  if (onCard && !onPr) {
    return (
      `\`${CONTRACT_REVIEW_LABEL}\` on card #${pair.card} while its delivering open PR ` +
      `#${pair.pr}${draft} does NOT carry it — the pair was written half way: either the hang ` +
      'never reached the PR side (「PR 一存在即挂」, and the PR exists), or a PASS cleared the PR ' +
      'side and stopped there, leaving the card gated behind a review that has already passed. ' +
      'Consequence on this side: the PR carrier — the one a seat reads before flipping ready — ' +
      `is bare, so nothing on the PR itself says a review is outstanding. ${RANKING_UNSETTLED} ` +
      `${DUAL_CARRIER} ${NEVER_WRITES}`
    );
  }
  return (
    `\`${CONTRACT_REVIEW_LABEL}\` on delivering open PR #${pair.pr}${draft} while card ` +
    `#${pair.card} does NOT carry it — the same split, written from the other end. ` +
    'Consequence on this side: to the enqueue path an ungated card is a card that was never ' +
    'gated, so the review this PR is still waiting on is invisible to the queue and the card ' +
    'can be enqueued straight past a gate that is demonstrably live one carrier over — and it ' +
    'is equally invisible to the review round\'s own label query over the cards. ' +
    `${RANKING_UNSETTLED} ${DUAL_CARRIER} ${NEVER_WRITES}`
  );
}

/**
 * C2 — the declaration limb has no reading.
 *
 * ⭐ The row this file exists for. A card that declared `no` made a decision; a
 * card with nothing to read made none, and until now the two looked the same to
 * every consumer. The sentence therefore leads with which of the four states
 * this is, and never prescribes a value: ⛔ nobody may fill the line in on
 * another seat's behalf, because the declaration IS the judgement.
 */
export function c2DeclarationUnreadable(pair) {
  const d = cardDeclaration(pair?.cardComments ?? null);
  const head = `card #${pair.card} (delivering open PR #${pair.pr}${pair.draft ? ' (draft)' : ''})`;
  const fixed = `the fixed spelling is \`Clause-②: yes\` or \`Clause-②: no\`, exactly those two`;
  const notADecision =
    'A missing reading is NOT a declared `no`: one of those is a decision and the other is an ' +
    'absent one, and the enqueue gate\'s content limb — the ONLY limb that can fire for a PR ' +
    'whose diff touches no contract path — has nothing to read. ⛔ Do not fill the line in on ' +
    'the claiming seat\'s behalf; the declaration IS the judgement. ⛔ And do not relax the ' +
    'spelling to accept the prose: a predicate that reads prose is a heuristic, and the measured ' +
    'terminus of that direction is a check that can barely fail.';
  switch (d.state) {
    case 'declared':
      return null;
    case 'unreadable':
      return null; // accounted as UNJUDGED by the caller — never silently clean.
    case 'misplaced':
      return (
        `${head} — the \`Clause-②\` declaration is MISPLACED: the fixed spelling appears on the ` +
        `thread (${JSON.stringify(d.detail)}) but NOT in the card's claim comment, which is the ` +
        'carrier the enqueue gate\'s content limb reads. The thinking was done and written down; ' +
        `it is in a place the predicate does not look. Move the line into the claim comment — ` +
        `${fixed}. ${NEVER_WRITES}`
      );
    case 'malformed':
      return (
        `${head} — the \`Clause-②\` line is MALFORMED: ${JSON.stringify(d.detail)} carries the key ` +
        `but not one of the two values, so there is no reading. ${fixed}. ${notADecision} ` +
        `${NEVER_WRITES}`
      );
    default:
      return (
        `${head} — NO READING on the declaration limb: the card's claim comment carries no ` +
        `\`Clause-②:\` line in the fixed spelling` +
        (d.detail ? `, and the nearest thing on the thread is ${JSON.stringify(d.detail)}` : '') +
        `. ${fixed}. ${notADecision} ${NEVER_WRITES}`
      );
  }
}

// ---------------------------------------------------------------------------
// The gate's HISTORY — what tells a completed review from one that never ran
// ---------------------------------------------------------------------------

/**
 * The gate's history on ONE carrier, read from that carrier's own label events.
 *
 * ⚠️ The rows arrive OLDEST FIRST, so a caller that reads only the first page
 * of a long carrier gets the oldest events and never sees the removal — which
 * reads as "still hung" or "never hung" depending on the truncation point. The
 * live reader below therefore pages to exhaustion and hands `null` when it
 * could not; ⛔ a short read is never a history.
 *
 * Sorted here rather than trusted: the endpoint's order is documented, but this
 * function is also fed self-test fixtures, and a reading that depends on the
 * caller's ordering is a reading that breaks silently when the caller changes.
 *
 * @param {{event?: string, created_at?: string, label?: {name?: string},
 *          actor?: {login?: string}}[]|null} events — that carrier's event
 *   rows, or `null` when the stream could NOT be read.
 * @returns {{ state: 'never-hung' }
 *          | { state: 'hung', at: string, actor: string|null }
 *          | { state: 'cleared', at: string, actor: string|null }
 *          | { state: 'unreadable' }}
 */
export function carrierGateHistory(events) {
  if (!Array.isArray(events)) return { state: 'unreadable' };
  const gate = [];
  for (const e of events) {
    if (!e || (e.event !== 'labeled' && e.event !== 'unlabeled')) continue;
    // The SAME label constant H31 and H35 read, imported, never restated.
    if (!isGateSemanticLabel(e.label?.name)) continue;
    const ms = Date.parse(e.created_at ?? '');
    // ⛔ An undated gate event is not a droppable row: dropping it would move
    // the "last event" and could turn a live hang into a clear. Refuse instead.
    if (!Number.isFinite(ms)) return { state: 'unreadable' };
    gate.push({ verb: e.event, at: String(e.created_at), actor: e.actor?.login ?? null, ms });
  }
  if (gate.length === 0) return { state: 'never-hung' };
  gate.sort((a, b) => a.ms - b.ms);
  const last = gate[gate.length - 1];
  return { state: last.verb === 'labeled' ? 'hung' : 'cleared', at: last.at, actor: last.actor };
}

/**
 * Is this pair in C3's candidate shape — the ONLY shape whose event streams are
 * read?
 *
 * The cost bound, stated as a predicate so the live reader and the UNJUDGED
 * accounting cannot disagree about which pairs owe an event stream. A pair that
 * declared `no`, or that still carries the gate on either carrier, is answered
 * from the labels alone and costs nothing extra.
 */
export function needsGateHistory(pair) {
  const d = cardDeclaration(pair?.cardComments ?? null);
  if (d.state !== 'declared' || d.value !== 'yes') return false;
  const onCard = gated(pair?.cardLabels);
  const onPr = gated(pair?.prLabels);
  if (onCard === null || onPr === null) return false; // already UNJUDGED on labels.
  return !onCard && !onPr;
}

/**
 * What the two event streams say about the gate this declaration should bind.
 *
 * ⭐ The distinction #14155 filed: a `Clause-②: yes` declaration is HISTORY and
 * stays on the thread forever, while the label is STATE that a completed review
 * clears from both carriers by rule — so every pair that completes its review
 * lands in the same shape as the fail-open C3 hunts, and before this function
 * the two were indistinguishable. The label EVENTS separate them without going
 * anywhere near a verdict comment: a gate that was bound leaves a `labeled`, and
 * a review that completed leaves an `unlabeled` on each carrier.
 *
 * ⛔ This is NOT the PASS half. The recovery rule in `references/contract-review.md`
 * reads 「PASS + 无标 + head 未动 = 已清标非被剥」; the PASS conjunct stays human,
 * because #12409 measured PASS-token matching as a check that can barely fail
 * and this file's own header bans verdict-reading as 自查放行. What is
 * mechanized here is the other two conjuncts — 无标 and head 未动 — and a clean
 * answer therefore means "the gate was bound and cleared by the discipline, and
 * nothing has moved since", never "the review passed".
 *
 * @returns {{ state: 'not-candidate' }
 *          | { state: 'unreadable', gaps: string[] }
 *          | { state: 'never-hung' }
 *          | { state: 'still-hung' }
 *          | { state: 'half-bound', bound: 'card'|'pr', at: string }
 *          | { state: 'completed', clearedAt: string }
 *          | { state: 'moved-after-clear', clearedAt: string, headAt: string }}
 */
export function gateBindingState(pair) {
  if (!needsGateHistory(pair)) return { state: 'not-candidate' };
  const card = carrierGateHistory(pair?.cardEvents ?? null);
  const pr = carrierGateHistory(pair?.prEvents ?? null);

  const gaps = [];
  if (card.state === 'unreadable') gaps.push(`card #${pair?.card}'s label event stream`);
  if (pr.state === 'unreadable') gaps.push(`PR #${pair?.pr}'s label event stream`);
  if (gaps.length > 0) return { state: 'unreadable', gaps };

  if (card.state === 'never-hung' && pr.state === 'never-hung') return { state: 'never-hung' };
  // Both carriers are bare NOW (that is the candidate shape), so a trailing
  // `labeled` means the stream and the labels disagree — a read this file will
  // not reconcile by picking a winner.
  if (card.state === 'hung' || pr.state === 'hung') return { state: 'still-hung' };
  if (card.state === 'never-hung' || pr.state === 'never-hung') {
    const bound = card.state === 'cleared' ? 'card' : 'pr';
    return { state: 'half-bound', bound, at: bound === 'card' ? card.at : pr.at };
  }

  // Both cleared. The conservative anchor is the EARLIER removal: a review
  // concluded before either carrier was touched, so motion after the first
  // clear is motion after the conclusion.
  const clearedMs = Math.min(Date.parse(card.at), Date.parse(pr.at));
  const clearedAt = Date.parse(card.at) <= Date.parse(pr.at) ? card.at : pr.at;
  const headAt = pair?.headCommittedAt ?? null;
  const headMs = Date.parse(headAt ?? '');
  if (!Number.isFinite(headMs)) {
    return { state: 'unreadable', gaps: [`PR #${pair?.pr}'s head commit date`] };
  }
  if (headMs > clearedMs) return { state: 'moved-after-clear', clearedAt, headAt: String(headAt) };
  return { state: 'completed', clearedAt };
}

/**
 * C3 — a declared `yes` whose gate is on NEITHER carrier, refined by the event
 * stream into the states that shape actually covers.
 *
 * The fail-open direction is the one a carrier COMPARISON is structurally blind
 * to: agreement on absence is H31's silent case. Measured live on PR #13910 /
 * card #13476 (2026-08-31), where the author had identified their own change as
 * clause-② and written it down, and not one of the three mechanisms that exist
 * to catch that was in a state to fire.
 *
 * ⚠️ But bare-on-both is also where a LEGITIMATELY cleared pair lands, measured
 * on PR #13864 / card #13657 (2026-09-01, #14155): review PASS at head
 * `9af92aa3`, both carriers cleared in one stroke nine seconds apart, and C3
 * fired on the completed state. Read literally, that made the landing check's
 * ② unsatisfiable after its own clear — the check could only pass in the window
 * between PASS and clear, which is the wrong order. The event stream is what
 * tells the two apart, so this row now fires on three distinguishable adverse
 * states and stays silent on the completed one.
 */
export function c3DeclaredYesUngated(pair) {
  const binding = gateBindingState(pair);
  if (binding.state === 'not-candidate') return null;
  if (binding.state === 'unreadable') return null; // UNJUDGED by the caller — never silently clean.
  if (binding.state === 'completed') return null; // ⭐ #14155: the completed state, and the only clean one.

  const head = `card #${pair.card} declares \`Clause-②: yes\` while NEITHER it nor its delivering open PR #${pair.pr}${pair.draft ? ' (draft)' : ''} carries \`${CONTRACT_REVIEW_LABEL}\``;
  const readsEvents =
    'The label EVENT STREAM on both carriers is what separates this from a legitimately cleared ' +
    'pair — a completed review clears the gate from both carriers by rule, so the declaration ' +
    '(history, permanent) outliving the label (state, cleared) is the NORMAL end state and is not ' +
    'reported here. ⛔ No verdict comment is read to reach that: the PASS half stays human.';

  switch (binding.state) {
    case 'moved-after-clear':
      return (
        `${head} — the gate WAS bound and cleared (last removal ${binding.clearedAt}), but the PR's ` +
        `head has MOVED since: its head commit is dated ${binding.headAt}. The review that cleared ` +
        'this gate judged a different tree, so the clear no longer covers what would land. This is ' +
        'the 重挂-owed state the recovery rule already names — 「head 后移或无结论才重挂」 — and ' +
        `the re-hang is a seat's act, not this script's. ${readsEvents} ${NEVER_WRITES}`
      );
    case 'half-bound':
      return (
        `${head} — and the gate was bound on the ${binding.bound === 'card' ? 'CARD' : 'PR'} carrier ` +
        `only (cleared ${binding.at}), with no hang ever recorded on the other. ${DUAL_CARRIER} One ` +
        'removal where a legitimate clear leaves two is the strip signature, so this pair cannot be ' +
        'read as a completed review. ⚠️ The repo-wide, windowed form of this question is H35 in ' +
        '`check-half-states.mjs`, which judges removals against the 同笔 stroke window; this row is ' +
        'the per-pair form and is unbounded in time, so it also sees a pair gated long before that ' +
        `window opened. ${readsEvents} ${NEVER_WRITES}`
      );
    case 'still-hung':
      return (
        `${head} — yet the label event stream ends on a HANG for at least one carrier, so the two ` +
        'readings of the same gate disagree: the labels say bare, the events say hung. One of them ' +
        'is stale, and this file does not pick a winner by fiat — re-read both carriers before ' +
        `treating this pair as either gated or clear. ${readsEvents} ${NEVER_WRITES}`
      );
    default:
      return (
        `${head}, and the event stream shows the gate was NEVER HUNG on either carrier — the ` +
        'gate the declaration is supposed to bind was never bound at all, so the content limb fired ' +
        'in prose and nothing downstream is holding the door. ⚠️ A comparison of the two carriers ' +
        'cannot see this: agreement on ABSENCE is its silent case, which is why the declaration is ' +
        `read here rather than inferred from the labels. ${readsEvents} ${NEVER_WRITES}`
      );
  }
}

/** Every row for one pair, in reporting order. */
export function pairRows(pair) {
  const rows = [];
  const split = c1CarrierSplit(pair);
  if (split) rows.push({ code: 'C1', text: split });
  const decl = c2DeclarationUnreadable(pair);
  if (decl) rows.push({ code: 'C2', text: decl });
  const ungated = c3DeclaredYesUngated(pair);
  if (ungated) rows.push({ code: 'C3', text: ungated });
  return rows;
}

/**
 * What this pair could NOT be judged on — the #4690 half.
 *
 * Returned separately from the rows so a caller can never render an incomplete
 * pair as a clean one: the sweep counts these and exits 2 while still printing
 * whatever it did manage to read.
 */
export function pairUnjudged(pair) {
  const gaps = [];
  if (!Array.isArray(pair?.cardLabels)) gaps.push(`card #${pair?.card}'s labels`);
  if (!Array.isArray(pair?.prLabels)) gaps.push(`PR #${pair?.pr}'s labels`);
  if (!Array.isArray(pair?.cardComments)) gaps.push(`card #${pair?.card}'s comment thread`);
  // The gate history is owed by C3 CANDIDATES only — the cost bound and the
  // accounting read one predicate, so a pair can never owe a stream the live
  // reader was never going to fetch. An unread stream is not a never-hung gate.
  if (gaps.length === 0) {
    const binding = gateBindingState(pair);
    if (binding.state === 'unreadable') gaps.push(...binding.gaps);
  }
  if (gaps.length === 0) return null;
  return (
    `pair PR #${pair?.pr} / card #${pair?.card} — UNJUDGED: ${gaps.join(', ')} could not be read. ` +
    'An unread carrier is not a bare carrier and an unread thread is not an absent declaration; ' +
    'this pair is missing from the readings above, not clean in them.'
  );
}

// ---------------------------------------------------------------------------
// Pairing — derived, never recalled
// ---------------------------------------------------------------------------

/**
 * The card each open PR delivers, via `prDeliversCard` — the SAME relation H8
 * and H31 read, imported rather than restated so this file can never disagree
 * with them about which PR delivers which card.
 *
 * Measured on the 2026-08-31 board: every one of the seven pairs the filing
 * cards tabulated carries a closing or `Part of` keyword in its PR body naming
 * its card, and every branch name carries the fallback too — 7 of 7, both
 * channels. Pairing is a derivation here, not an assumption.
 *
 * @param {object[]} openPrs
 * @param {number[]} cardNumbers — the open cards the sweep holds.
 */
export function derivePairs(openPrs, cardNumbers) {
  const pairs = [];
  for (const pr of openPrs ?? []) {
    if (!pr || pr.merged_at) continue;
    for (const n of cardNumbers ?? []) {
      if (prDeliversCard(pr, String(n))) pairs.push({ pr: pr.number, card: Number(n), draft: Boolean(pr.draft), prRow: pr });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

async function rest(path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`GET ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Read one path, or `null` — used where a per-pair gap must not abort the
 * sweep.
 *
 * One retry, because the failure this sweep provokes is a SECONDARY rate limit
 * from issuing two reads per pair back to back, and a transient 403 that lands
 * as an UNJUDGED row costs a reader the same attention as a real one. Measured
 * on the 2026-08-31 board: 3 of 25 pairs came back unjudged on the first pass
 * with no retry. ⛔ One retry, not a loop: a sweep that keeps trying is a sweep
 * that hides an exhausted quota, and the UNJUDGED row is the correct answer
 * once the read has genuinely failed.
 */
async function restOrNull(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await rest(path);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

/** The #13544 re-exec, planned by the sibling and performed here. */
function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  if (process.env[PROXY_REARM_GUARD] === '1') return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning')
    ? ['--disable-warning=UNDICI-EHPA']
    : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(
    `⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); ` +
      'continuing in-process — every request will bypass the proxy.',
  );
  return null;
}

/**
 * Every open PR on the board, paged to exhaustion.
 *
 * Each page gets the same ONE retry the per-pair reads get, and for a sharper
 * reason: a failure here is TOTAL. Measured 2026-08-31 — a transient `HTTP 502`
 * on page 1 refused a whole `--pair` run that would otherwise have answered in
 * a second. The refusal itself was correct (exit 3, "0 pair(s) had been read",
 * ⛔ never a clean board), which is exactly why it should not be spent on a
 * blip. ⛔ Still one retry, not a loop: a second failure is the answer.
 */
async function listOpenPulls(repo) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const path = `/repos/${repo}/pulls?state=open&per_page=100&page=${page}`;
    let batch;
    try {
      batch = await rest(path);
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
      batch = await rest(path); // a second failure throws, and the caller refuses.
    }
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * The page cap on ONE carrier's label event stream.
 *
 * Events arrive OLDEST FIRST, so the reading needs the LAST page, not the
 * first: a stream read short does not merely lose detail, it loses the removal
 * and reads as a live hang or a never-hung gate. Ten pages is 1,000 events on a
 * single card, well past anything the board produces; a carrier that exceeds it
 * is answered `null` → UNJUDGED, never clean (#4690).
 */
export const EVENT_PAGE_CAP = 10;

/**
 * One carrier's gate history, paged to exhaustion — or `null`.
 *
 * ⛔ Never a partial array: a caller cannot tell a short read from a quiet
 * carrier, and the whole point of this stream is to distinguish "no hang" from
 * "hang I did not read".
 */
async function readCarrierEvents(repo, number) {
  const out = [];
  for (let page = 1; page <= EVENT_PAGE_CAP; page++) {
    const batch = await restOrNull(`/repos/${repo}/issues/${number}/events?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) return null;
    out.push(...batch);
    if (batch.length < 100) return out;
  }
  return null; // cap hit: the tail is unread, so the history is unread.
}

/**
 * The head commit's date, for the head-motion half — or `null`.
 *
 * ⚠️ The boundary, stated where the reading is taken: this is COMMIT METADATA,
 * not a push timestamp. A normal push writes the committer date at push time,
 * which is what makes the reading work; a force-push that lands a deliberately
 * backdated commit would read as unmoved. The unforgeable alternative
 * (`head_ref_force_pushed`) lives only on the TIMELINE endpoint, which caps at
 * 250 events and truncates SILENTLY — and a capped read backing a CLEAN verdict
 * is the fail-open shape this family refuses everywhere else, so the exact,
 * uncapped, one-request reading is preferred with its residual hole named. The
 * PASS conjunct of the recovery rule stays human and is what closes it.
 */
async function readHeadCommitDate(repo, sha) {
  if (!sha) return null;
  const commit = await restOrNull(`/repos/${repo}/commits/${sha}`);
  return commit?.commit?.committer?.date ?? null;
}

/**
 * Gather the pairs and everything each row needs.
 *
 * A PR's delivering card is read from the PR body/branch, so the card set is
 * whatever those name — no open-issue listing is paged for it. That keeps the
 * sweep's cost at one PR listing plus two reads per pair, plus — for the C3
 * candidates ALONE — their two event streams and one head commit.
 */
async function gather(repo, prFilter = null) {
  const pulls = (await listOpenPulls(repo)).filter((pr) => (prFilter ? pr.number === prFilter : true));
  const pairs = [];
  for (const pr of pulls) {
    const body = String(pr?.body ?? '');
    const named = new Set(
      [...body.matchAll(/#(\d{1,7})\b/g)].map((m) => m[1]).concat(String(pr?.head?.ref ?? '').match(/issue-(\d+)/)?.[1] ?? []),
    );
    for (const n of named) {
      if (!prDeliversCard(pr, n)) continue;
      const card = await restOrNull(`/repos/${repo}/issues/${n}`);
      const comments = await restOrNull(`/repos/${repo}/issues/${n}/comments?per_page=100`);
      pairs.push({
        pr: pr.number,
        draft: Boolean(pr.draft),
        card: Number(n),
        headSha: pr?.head?.sha ?? null,
        prLabels: Array.isArray(pr.labels) ? labelNames(pr) : null,
        cardLabels: card && Array.isArray(card.labels) ? labelNames(card) : null,
        cardComments: Array.isArray(comments) ? comments : null,
      });
    }
  }

  // Second pass — the gate history, for the C3 candidates and nobody else.
  // `needsGateHistory` is the SAME predicate the UNJUDGED accounting reads, so
  // the set that owes a stream and the set that gets one cannot drift apart.
  for (const pair of pairs) {
    if (!needsGateHistory(pair)) continue;
    pair.cardEvents = await readCarrierEvents(repo, pair.card);
    pair.prEvents = await readCarrierEvents(repo, pair.pr);
    // The head commit is owed only once both carriers read CLEARED — the one
    // state whose verdict turns on head motion.
    const card = carrierGateHistory(pair.cardEvents);
    const prHist = carrierGateHistory(pair.prEvents);
    if (card.state === 'cleared' && prHist.state === 'cleared') {
      pair.headCommittedAt = await readHeadCommitDate(repo, pair.headSha);
    }
  }
  return { pulls, pairs };
}

function renderSweep({ repo, pulls, pairs }, { json = false } = {}) {
  const rows = [];
  const unjudged = [];
  for (const pair of pairs) {
    for (const row of pairRows(pair)) rows.push({ pr: pair.pr, card: pair.card, ...row });
    const gap = pairUnjudged(pair);
    if (gap) unjudged.push({ pr: pair.pr, card: pair.card, text: gap });
  }
  if (json) {
    console.log(JSON.stringify({ repo, openPrs: pulls.length, pairs: pairs.length, rows, unjudged }, null, 2));
  } else {
    console.log(
      `check-clause2-carriers: ${pairs.length} card/PR pair(s) derived from ${pulls.length} open ` +
        `PR(s) in ${repo} — ${rows.length} clause-② finding(s), ${unjudged.length} pair(s) UNJUDGED. ` +
        'Report-only: findings are patrol input, not a gate verdict.',
    );
    for (const row of rows) console.log(`- **${row.code}** #${row.pr} / #${row.card} — ${row.text}`);
    for (const gap of unjudged) console.log(`- **UNJUDGED** ${gap.text}`);
    if (rows.length === 0 && unjudged.length === 0) {
      console.log('- (no findings, and every pair was fully read — a clean board, not a short read.)');
    }
  }
  return unjudged.length > 0 ? EXIT_INCOMPLETE : EXIT_OK;
}

function renderPair(pair) {
  const gap = pairUnjudged(pair);
  if (gap) {
    console.error(`✗ check-clause2-carriers --pair: ${gap}`);
    return EXIT_INCOMPLETE;
  }
  const rows = pairRows(pair);
  if (rows.length === 0) {
    console.log(
      `✓ check-clause2-carriers: PR #${pair.pr} / card #${pair.card} — the clause-② declaration is ` +
        'readable in the fixed spelling and both carriers agree.',
    );
    return EXIT_OK;
  }
  for (const row of rows) console.error(`✗ ${row.code} — ${row.text}`);
  console.error(
    `check-clause2-carriers: PR #${pair.pr} / card #${pair.card} is NOT clause-② legible ` +
      `(exit ${EXIT_PAIR_ADVERSE}). ⛔ This is a verdict about this pair, not about the environment.`,
  );
  return EXIT_PAIR_ADVERSE;
}

function reportTransportFailure(err, { swept }) {
  console.error(
    `check-clause2-carriers: PREREQUISITE NOT MET — ${err.message}. ${swept} pair(s) had been read ` +
      'when it failed, so this run is NOT a reading of a clean board. This file does not classify ' +
      'transport: run `node scripts/pm/check-half-states.mjs --probe`, which is the family\'s one ' +
      `classifier, and read its verdict. (Exit ${EXIT_PREREQUISITE_NOT_MET} — capture it BEFORE any ` +
      'pipe: `node scripts/pm/check-clause2-carriers.mjs > /tmp/c2.log 2>&1; echo "EXIT=$?"`.)',
  );
  return EXIT_PREREQUISITE_NOT_MET;
}

// ---------------------------------------------------------------------------
// Self-test — offline, and the fixtures are the measured board
// ---------------------------------------------------------------------------

const CLAIM = (extra) => ({
  created_at: '2026-08-31T17:00:00Z',
  body: `Claim: PM loop round R1\nBranch: \`claude/issue-13476-unresolvable-engine-403\`\n${extra ?? ''}`,
});

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });
  const says = (s, frag) => typeof s === 'string' && s.includes(frag);

  // -- the declaration reader: the fixed spelling, and everything that is not --
  t('the two fixed spellings read as declarations', readClause2Line('Clause-②: yes')?.value === 'yes' && readClause2Line('Clause-②: no')?.value === 'no');
  t('a blockquoted claim line still reads (SKILL.md writes the claim as a blockquote)', readClause2Line('> Clause-②: no')?.value === 'no');
  t('a bulleted, bolded, backticked line still reads — decoration is markdown, not meaning', readClause2Line('- **`Clause-②`**: **`yes`**')?.value === 'yes');
  t('the PROSE form is NOT a declaration', readClause2Line('## Clause ②: **yes**')?.kind === 'near-miss');
  t('…and it is reported as a near miss so the row can quote it', says(readClause2Line('## Clause ②: **yes**')?.line, 'Clause ②'));
  t('an uppercase VALUE is malformed, not a yes', readClause2Line('Clause-②: YES')?.kind === 'malformed');
  t('a prose value on the key line is malformed, not a reading', readClause2Line('Clause-②: probably not')?.kind === 'malformed');
  t('an empty value is malformed', readClause2Line('Clause-②:')?.kind === 'malformed');
  // The #12297 control shape: the token, then the seat's reasoning. #13914
  // records that comment as CORRECT, so a reader that rejected it would grade
  // the card's own control as the defect (measured: it rejected four real
  // claims on the 2026-08-31 board before this case was written).
  t('the token followed by REASONING is a declaration — #13914\'s control shape', readClause2Line('Clause-②: yes — widens the accept set')?.value === 'yes');
  t('…including the bold-wrapped, parenthesised form seats actually write', readClause2Line('**Clause-②: no**(仅移动 import/注释)')?.value === 'no');
  t('⛔ but a word merely STARTING with the token is not the token', readClause2Line('Clause-②: nope')?.kind === 'malformed' && readClause2Line('Clause-②: not applicable')?.kind === 'malformed');
  t('the closed set is read from CLAUSE2_VALUES, so a third reading needs an edit there', CLAUSE2_VALUES.length === 2 && CLAUSE2_VALUES.every((v) => readClause2Line(`Clause-②: ${v}`)?.value === v));
  t('a very long claim line is quoted back CAPPED, so one row cannot swamp the report', (readClause2Line(`Clause-②: maybe ${'x'.repeat(400)}`)?.line ?? '').length < 200);
  t('a card that never mentions the clause reads null', readClause2Line('Claim: whatever\nBranch: x') === null);
  t('⛔ the reader never invents a value from an adjacent word', readClause2Line('this card is clause 2 yes in substance')?.kind !== 'declared');

  // -- the card-level declaration: four states, none collapsed into another ---
  t('a claim comment carrying the line reads DECLARED', cardDeclaration([CLAIM('Clause-②: no')]).state === 'declared');
  t('…and keeps the value', cardDeclaration([CLAIM('Clause-②: yes')]).value === 'yes');
  t('a thread with no claim comment at all reads ABSENT', cardDeclaration([{ body: 'just a comment', created_at: '2026-08-31T10:00:00Z' }]).state === 'absent');
  t('the #13910 shape — a claim comment with no Clause-② line — reads ABSENT', cardDeclaration([CLAIM('Domain: `domain:engine`')]).state === 'absent');
  t('⛔ ABSENT is not `no`', cardDeclaration([CLAIM('Domain: x')]).state !== 'declared');
  t('the line in a NON-claim comment reads MISPLACED, not absent and not declared', cardDeclaration([CLAIM('Domain: x'), { body: 'Clause-②: yes', created_at: '2026-08-31T11:00:00Z' }]).state === 'misplaced');
  t('a malformed line in the claim comment reads MALFORMED', cardDeclaration([CLAIM('Clause-②: Yes')]).state === 'malformed');
  t('an UNREADABLE thread reads unreadable — never absent (#4690)', cardDeclaration(null).state === 'unreadable');
  t('the most recent claim governs — a re-claimed card is judged on the live claim', cardDeclaration([
    { created_at: '2026-08-30T09:00:00Z', body: 'Claim: old\nBranch: `claude/issue-13476-old`\nClause-②: yes' },
    { created_at: '2026-08-31T09:00:00Z', body: 'Claim: new\nBranch: `claude/issue-13476-new`\nClause-②: no' },
  ]).value === 'no');

  // -- C1, replaying the 2026-08-31 measured table ---------------------------
  const L = CONTRACT_REVIEW_LABEL;
  const pair = (o) => ({ pr: 13910, card: 13476, draft: true, prLabels: [], cardLabels: [], cardComments: [CLAIM('Clause-②: no')], ...o });
  // The seven pairs the filing cards tabulated, at the moment a human looked.
  const BOARD = [
    { pr: 13870, card: 13576, prLabels: [L], cardLabels: [L] },        // in sync
    { pr: 13834, card: 13651, prLabels: [L], cardLabels: [L] },        // in sync
    { pr: 13829, card: 13578, prLabels: [L], cardLabels: [] },         // card missing
    { pr: 13857, card: 13608, prLabels: [L], cardLabels: [] },         // card missing
    { pr: 13864, card: 13657, prLabels: [L], cardLabels: [] },         // card missing
    { pr: 13910, card: 13476, prLabels: [], cardLabels: [L] },         // PR missing — the fail-open
    { pr: 13923, card: 13762, prLabels: [L], cardLabels: [] },         // card missing (the 7th, minted later)
  ].map((p) => pair(p));
  const split = BOARD.map((p) => c1CarrierSplit(p));
  t('replaying the measured board flags exactly the 5 desynced pairs', split.filter(Boolean).length === 5, JSON.stringify(split.map(Boolean)));
  t('…and stays silent on the 2 pairs that were in sync', split[0] === null && split[1] === null);
  t('…naming the PR on the card-side-missing direction', says(split[2], '#13829') && says(split[2], '#13578'));
  t('…and stating the consequence of the PR-bare direction on its own terms', says(split[5], 'nothing on the PR itself says a review is outstanding'));
  t('…and the card-bare direction on its own', says(split[2], 'invisible to the queue'));
  t('⛔ neither direction is ranked — the two standing sources rank them oppositely', says(split[2], 'ranks neither') && says(split[5], 'ranks neither'));
  t('…and the row names both readings so the disagreement is visible, not resolved by fiat', says(split[5], 'H31 calls the card-bare direction') && says(split[5], '#13922 calls the'));
  t('a pair gated on neither carrier is NOT a split — agreement on absence is C1\'s silent case', c1CarrierSplit(pair({ prLabels: [], cardLabels: [] })) === null);
  t('an unreadable carrier never manufactures a split', c1CarrierSplit(pair({ prLabels: null, cardLabels: [L] })) === null);
  t('C1 states the dual-carrier rule it is asserting', says(split[5], '两边都挂好'));
  t('C1 says a strip and a never-hung gate are indistinguishable without the second carrier', says(split[5], '被剥'));
  t('C1 never prescribes a write from this script', says(split[5], '自查放行'));

  // -- C2, the row this file exists for --------------------------------------
  const absent = c2DeclarationUnreadable(pair({ cardComments: [CLAIM('Domain: x')] }));
  t('a card with no Clause-② line in its claim comment produces a C2 row', typeof absent === 'string');
  t('…and says NO READING in as many words', says(absent, 'NO READING'));
  t('…and states that it is not a declared `no`', says(absent, 'NOT a declared'));
  t('…and refuses to have the line filled in on the seat\'s behalf', says(absent, 'Do not fill the line in'));
  t('…and forbids relaxing the spelling to prose', says(absent, 'do not relax the'));
  t('…and quotes the fixed spelling so the remedy is executable', says(absent, 'Clause-②: yes'));
  const nearMiss = c2DeclarationUnreadable(pair({ cardComments: [CLAIM('## Clause ②: **yes**')] }));
  t('a prose declaration still produces the C2 row — prose is not a reading', typeof nearMiss === 'string');
  t('…and the row quotes what WAS there, so the residue is actionable', says(nearMiss, 'Clause ②'));
  const misplaced = c2DeclarationUnreadable(pair({ cardComments: [CLAIM('Domain: x'), { body: 'Clause-②: yes', created_at: '2026-08-31T11:00:00Z' }] }));
  t('a declaration outside the claim comment reads MISPLACED, with its own sentence', says(misplaced, 'MISPLACED'));
  t('…and says the thinking was done, only in the wrong carrier', says(misplaced, 'not in a place') || says(misplaced, 'place the predicate does not look'));
  t('a malformed value produces its own row rather than passing as `no`', says(c2DeclarationUnreadable(pair({ cardComments: [CLAIM('Clause-②: Yes')] })), 'MALFORMED'));
  t('a correctly declared card produces NO C2 row', c2DeclarationUnreadable(pair({ cardComments: [CLAIM('Clause-②: no')] })) === null);
  t('an unreadable thread produces no C2 row — it is UNJUDGED instead, never clean', c2DeclarationUnreadable(pair({ cardComments: null })) === null);
  t('…and the unjudged accounting names the thread that could not be read', says(pairUnjudged(pair({ cardComments: null })), 'comment thread'));

  // -- C3, the direction a carrier comparison cannot see ----------------------
  // A declared `yes`, bare on both carriers — C3's candidate shape. The event
  // stream is what says WHICH of the four states this is.
  const declaredYes = (o) => pair({ prLabels: [], cardLabels: [], cardComments: [CLAIM('Clause-②: yes')], ...o });
  const EV = (verb, at, actor = 'os-support-ai') => ({
    event: verb,
    created_at: at,
    label: { name: CONTRACT_REVIEW_LABEL },
    actor: { login: actor },
  });
  // The 2026-09-01 measurement (#14155), verbatim: PR #13864 / card #13657.
  const CARD_HUNG = EV('labeled', '2026-08-31T16:55:54Z', 'os-warren');
  const CARD_CLEARED = EV('unlabeled', '2026-09-01T08:54:47Z');
  const PR_HUNG = EV('labeled', '2026-08-31T15:19:53Z', 'claude[bot]');
  const PR_CLEARED = EV('unlabeled', '2026-09-01T08:54:56Z');
  const HEAD_AT_PASS = '2026-09-01T08:16:59Z'; // head 9af92aa3, the tree the review judged.

  const neverHung = declaredYes({ cardEvents: [], prEvents: [] });
  const ungated = c3DeclaredYesUngated(neverHung);
  t('a declared `yes` the events show was NEVER HUNG still produces a C3 row', typeof ungated === 'string');
  t('…and says why a carrier comparison cannot see it', says(ungated, 'agreement on ABSENCE'));
  t('…and says in as many words that the gate was never bound', says(ungated, 'NEVER HUNG'));
  t('a declared `no` with no gate anywhere is NOT a C3 row — that is a decision', c3DeclaredYesUngated(pair({ cardComments: [CLAIM('Clause-②: no')] })) === null);
  t('a declared `yes` WITH the gate hung is not a C3 row', c3DeclaredYesUngated(pair({ prLabels: [L], cardLabels: [L], cardComments: [CLAIM('Clause-②: yes')] })) === null);
  t('an ABSENT declaration is not a C3 row — C2 owns that fact, and no row owns it twice', c3DeclaredYesUngated(pair({ cardComments: [CLAIM('Domain: x')] })) === null);
  t('an unreadable carrier never manufactures a C3 row', c3DeclaredYesUngated(pair({ cardLabels: null, cardComments: [CLAIM('Clause-②: yes')] })) === null);

  // -- #14155: the COMPLETED state, and the three it must stay distinct from --
  const completed = declaredYes({
    pr: 13864,
    card: 13657,
    cardEvents: [CARD_HUNG, CARD_CLEARED],
    prEvents: [PR_HUNG, PR_CLEARED],
    headCommittedAt: HEAD_AT_PASS,
  });
  t('⭐ the measured 2026-09-01 clear (#13864/#13657) produces NO C3 row — the completed state is clean', c3DeclaredYesUngated(completed) === null, JSON.stringify(gateBindingState(completed)));
  t('…and the pair is CLEAN overall, not merely C3-silent', pairRows(completed).length === 0 && pairUnjudged(completed) === null);
  t('…and the disposition names it `completed`, anchored on the earlier removal', gateBindingState(completed).state === 'completed' && gateBindingState(completed).clearedAt === '2026-09-01T08:54:47Z');
  t('…which is exactly what the landing check\'s ② could never answer before', gateBindingState(completed).state !== 'never-hung');

  const movedAfter = declaredYes({
    cardEvents: [CARD_HUNG, CARD_CLEARED],
    prEvents: [PR_HUNG, PR_CLEARED],
    headCommittedAt: '2026-09-01T10:30:00Z', // a commit landed AFTER the clear.
  });
  const movedRow = c3DeclaredYesUngated(movedAfter);
  t('a cleared gate whose head MOVED afterwards is adverse, not clean', typeof movedRow === 'string');
  t('…and is named as the 重挂-owed state the recovery rule already carries', says(movedRow, '重挂') && says(movedRow, 'head 后移'));
  t('…and quotes both dates, so the reader can check the ordering', says(movedRow, '2026-09-01T10:30:00Z') && says(movedRow, '2026-09-01T08:54:47Z'));
  t('…and the re-hang is never performed from here', says(movedRow, '自查放行'));
  t('the head-motion comparison is against the EARLIER removal — motion after the first clear counts', gateBindingState(declaredYes({
    cardEvents: [CARD_HUNG, CARD_CLEARED],
    prEvents: [PR_HUNG, PR_CLEARED],
    headCommittedAt: '2026-09-01T08:54:50Z', // between the two removals.
  })).state === 'moved-after-clear');

  const halfBound = declaredYes({ cardEvents: [CARD_HUNG, CARD_CLEARED], prEvents: [] });
  const halfRow = c3DeclaredYesUngated(halfBound);
  t('a gate bound on ONE carrier only is adverse — one removal where a clear leaves two', typeof halfRow === 'string');
  t('…and names the strip signature the dual-carrier rule already states', says(halfRow, 'strip signature') && says(halfRow, '两边都挂好'));
  t('…and points at H35 rather than re-judging the windowed repo-wide form', says(halfRow, 'H35'));
  t('…in both directions', gateBindingState(declaredYes({ cardEvents: [], prEvents: [PR_HUNG, PR_CLEARED] })).bound === 'pr');

  t('an UNREADABLE stream is never a never-hung gate — it is UNJUDGED (#4690)', c3DeclaredYesUngated(declaredYes({ cardEvents: null, prEvents: [] })) === null);
  t('…and the unjudged accounting names the stream that could not be read', says(pairUnjudged(declaredYes({ cardEvents: null, prEvents: [] })), 'label event stream'));
  t('…so an unread stream can never render as a clean pair', pairUnjudged(declaredYes({ cardEvents: [CARD_HUNG, CARD_CLEARED], prEvents: null })) !== null);
  t('a cleared pair whose HEAD COMMIT could not be read is UNJUDGED, not clean', says(pairUnjudged(declaredYes({ cardEvents: [CARD_HUNG, CARD_CLEARED], prEvents: [PR_HUNG, PR_CLEARED], headCommittedAt: null })), 'head commit date'));
  t('labels bare but the stream ending on a HANG is a disagreement, reported not resolved', says(c3DeclaredYesUngated(declaredYes({ cardEvents: [CARD_HUNG], prEvents: [PR_HUNG, PR_CLEARED] })), 'the labels say bare, the events say hung'));

  // -- the event reader itself ------------------------------------------------
  t('an empty stream reads NEVER HUNG — readable, and nothing was hung', carrierGateHistory([]).state === 'never-hung');
  t('a null stream reads UNREADABLE — the distinction the whole row turns on', carrierGateHistory(null).state === 'unreadable');
  t('the LAST event decides, and the reader sorts rather than trusting arrival order', carrierGateHistory([CARD_CLEARED, CARD_HUNG]).state === 'cleared' && carrierGateHistory([CARD_HUNG, CARD_CLEARED]).state === 'cleared');
  t('…so a newest-first page cannot invert the verdict', carrierGateHistory([CARD_CLEARED, CARD_HUNG]).at === CARD_CLEARED.created_at);
  t('a re-hung gate reads HUNG, not cleared', carrierGateHistory([CARD_HUNG, CARD_CLEARED, EV('labeled', '2026-09-01T09:30:00Z')]).state === 'hung');
  t('⛔ events for OTHER labels are not the gate\'s history', carrierGateHistory([{ event: 'labeled', created_at: '2026-08-31T08:00:18Z', label: { name: 'priority:p1' } }]).state === 'never-hung');
  t('⛔ non-label events are ignored', carrierGateHistory([{ event: 'ready_for_review', created_at: '2026-08-31T08:00:18Z' }]).state === 'never-hung');
  t('⛔ an UNDATED gate event refuses the whole reading — dropping it could move the last event', carrierGateHistory([CARD_HUNG, { event: 'unlabeled', created_at: null, label: { name: CONTRACT_REVIEW_LABEL } }]).state === 'unreadable');
  t('the gate label is the sibling\'s constant, not a second spelling', carrierGateHistory([EV('labeled', '2026-08-31T16:55:54Z')]).state === 'hung');

  // -- the cost bound, stated as one predicate both sides read ---------------
  t('a declared `no` owes NO event stream — the cost bound', needsGateHistory(pair({ cardComments: [CLAIM('Clause-②: no')] })) === false);
  t('a pair still carrying the gate owes none either', needsGateHistory(pair({ prLabels: [L], cardLabels: [L], cardComments: [CLAIM('Clause-②: yes')] })) === false);
  t('an ABSENT declaration owes none — C2 already owns that pair', needsGateHistory(pair({ cardComments: [CLAIM('Domain: x')] })) === false);
  t('only the C3 candidate shape owes one', needsGateHistory(declaredYes({})) === true);
  t('…and a pair that owes nothing is never UNJUDGED for a stream it was never going to be asked for', pairUnjudged(pair({ cardComments: [CLAIM('Clause-②: no')] })) === null);
  t('the page cap exists, because the stream arrives OLDEST FIRST and a short read loses the removal', Number.isInteger(EVENT_PAGE_CAP) && EVENT_PAGE_CAP > 0);

  // -- the #13910 specimen, end to end ---------------------------------------
  const specimen = pair({ pr: 13910, card: 13476, prLabels: [], cardLabels: [L], cardComments: [CLAIM('Domain: `domain:engine`')] });
  const specimenRows = pairRows(specimen).map((r) => r.code);
  t('the measured #13910 specimen produces BOTH the split row and the no-reading row', specimenRows.includes('C1') && specimenRows.includes('C2'), JSON.stringify(specimenRows));
  t('…and no C3 row, because that card declared nothing at all', !specimenRows.includes('C3'));

  // -- pairing, derived from the same relation H8/H31 read --------------------
  const prRow = (n, card, ref) => ({ number: n, draft: true, labels: [], body: `Fixes #${card}\n`, head: { ref } });
  t('a PR body naming its card pairs with it', derivePairs([prRow(13910, 13476, 'claude/issue-13476-x')], [13476]).length === 1);
  t('a PR body naming another card does NOT pair on a stale branch name', derivePairs([prRow(13910, 9999, 'claude/issue-13476-x')], [13476]).length === 0);
  t('a branch name is the fallback when the body says nothing', derivePairs([{ number: 1, labels: [], body: 'no refs here', head: { ref: 'claude/issue-13476-x' } }], [13476]).length === 1);

  // -- the exit register is distinct in every direction it must be -----------
  const codes = [EXIT_OK, EXIT_USAGE, EXIT_INCOMPLETE, EXIT_PREREQUISITE_NOT_MET, EXIT_PAIR_ADVERSE];
  t('every exit code is distinct — a verdict can never be read as an environment complaint', new Set(codes).size === codes.length, JSON.stringify(codes));
  t('the adverse-pair code is NOT the prerequisite code', EXIT_PAIR_ADVERSE !== EXIT_PREREQUISITE_NOT_MET);
  t('the prerequisite code is the sibling\'s, imported rather than re-picked', EXIT_PREREQUISITE_NOT_MET === 3);

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-clause2-carriers self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-clause2-carriers self-test: ${cases.length} cases pass (fixed-spelling reader, the ` +
      'four declaration states, the 2026-08-31 seven-pair replay, the four gate-binding states ' +
      'replayed from the 2026-09-01 clear, and the exit register).',
  );
  return 0;
}

// ---------------------------------------------------------------------------

async function main(argv) {
  if (argv.includes('--self-test')) return selfTest();

  const repoRes = resolveSweepRepo(process.env);
  if (!repoRes.valid) {
    console.error(
      `check-clause2-carriers: ${repoRes.source}=${JSON.stringify(repoRes.repo)} is not an ` +
        '`owner/name` repository. Refusing to fall back to a different board — a report about the ' +
        'wrong repo reads exactly like a report about this one.',
    );
    return EXIT_USAGE;
  }
  const repo = repoRes.repo;

  const pairFlag = argv.indexOf('--pair');
  let only = null;
  if (pairFlag !== -1) {
    only = Number(argv[pairFlag + 1]);
    if (!Number.isInteger(only) || only <= 0) {
      console.error('check-clause2-carriers: --pair needs a PR number. ⛔ Silence is not a clearance.');
      return EXIT_USAGE;
    }
  }

  let swept = 0;
  try {
    const { pulls, pairs } = await gather(repo, only);
    swept = pairs.length;
    if (only !== null) {
      if (pairs.length === 0) {
        console.error(
          `check-clause2-carriers: PR #${only} is not open, or names no card this file can derive ` +
            '(no closing/`Part of` keyword in its body and no `issue-N` branch name). ⛔ Not a ' +
            'clearance — the pair could not be formed, so nothing about it was judged.',
        );
        return EXIT_INCOMPLETE;
      }
      let worst = EXIT_OK;
      for (const p of pairs) {
        const code = renderPair(p);
        if (code !== EXIT_OK) worst = code === EXIT_INCOMPLETE && worst === EXIT_PAIR_ADVERSE ? worst : code;
      }
      return worst;
    }
    return renderSweep({ repo, pulls, pairs }, { json: argv.includes('--json') });
  } catch (err) {
    return reportTransportFailure(err, { swept });
  }
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest());
  } else {
    const rearmed = rearmThroughProxy(process.argv.slice(2));
    if (rearmed !== null) process.exit(rearmed);
    main(process.argv.slice(2)).then((code) => process.exit(code));
  }
}
