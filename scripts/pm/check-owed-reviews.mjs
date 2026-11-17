#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-owed-reviews — REPORT-ONLY list of the open pull requests, drafts
 * included, whose face owes a contract review, and whether anybody is doing it.
 *
 *   node scripts/pm/check-owed-reviews.mjs [--repo OWNER/NAME] [--board OWNER/NAME] [--now ISO] [--json]
 *   node scripts/pm/check-owed-reviews.mjs --self-test   # offline, no network
 *   node scripts/pm/check-owed-reviews.mjs --help
 *
 * ## Why it is a file in the repository
 *
 * The rule text (the pm-dispatch skill's `references/contract-review.md`,
 * 〈L2 归属与资格〉, and the L2 seat's charter `references/lanes/l2-review.md`)
 * says the dispatching seat reviews its own pull requests in its own seat — at
 * the tier, or by writing the hand-off line when it cannot reach it — and the
 * L2 SEAT (`l2-review#N`, a seat whose only job is the review, on any account
 * that reaches the tier) is the FALLBACK: it takes a head only when a hand-off
 * line names it, when the head is the delta of its own record, or when every
 * other seat able to review it is barred. An owed head that merely waited (b),
 * or whose lane seat left (c), stays with the lane; an L1 or `TIER_DEFAULT`
 * review is never the L2 seat's (SKILL.md 〈审核两级〉). ⛔ Never triage, which
 * takes no contract review and only counts the owed heads per lane in its
 * round record. Before it existed the list was a
 * session-local scratch script: lost when a container was replaced, rebuilt
 * without drafts and without the hand-off lines, and two Tier H drafts waited
 * about five rounds with a hand-off naming their head. A list every seat can
 * run from the tree is the cure, so ⛔ no round relies on a session-local copy.
 *
 * ## What one row says (one row per open pull request whose face owes a review)
 *
 *   face       why a review is owed: `schema` / `rules` (the path hits of
 *              `reviewFace`, the one function the queue guard decides the face
 *              with), `narrowing` / `declaration` (the PR body's `Clause-②:`
 *              line, read by `readClause2Line`), `clause2-unreadable` (a line
 *              nobody can grade, listed rather than dropped), `label` (the
 *              `needs:contract-review` waiting label). Drafts are IN: a Tier H
 *              pull request stays draft until its review is on file.
 *   head       the current head and the minutes it has waited: since its commit's
 *              committer date, or since the pull request was opened when that is
 *              later (a head committed long before its PR existed has not waited).
 *   record     `current` (a record on this head — PASS / FAIL as its one
 *              VERDICT line states it, `unstated` with none, `ambiguous` with
 *              two or more, and by whom), `stale` (the newest record names an
 *              earlier head: the delta re-review stays with that reviewer),
 *              `none`, or `unjudged` (the read could not be made). Read as the
 *              queue guard reads it: only comments by the relay or an account
 *              in `GOVERNED_APPROVERS`, and the verdict lines counted, never
 *              the first match (card #33705).
 *   hand-off   the newest `Contract-review-handoff:` line, as `contractReviewHandoff`
 *              reads it: `handed` (it names the current head, and the seat it hands
 *              to: `l2-review#N` (old spelling `review#N`) or `domain:<lane>#N`), `stale`, `absent`, `unreadable`
 *              (a line still naming `triage` is unreadable: it hands to nobody).
 *   claim      the `Contract-review-claim:` lines: `live` (who holds the head,
 *              the earliest live claim), `lapsed`, `none`.
 *   hold       the `Contract-review-hold:` lines, as `contractReviewHold` reads
 *              them, per head: `live` (a readable hold names the current head:
 *              trigger (b) does not fire, and its age is printed), `stale` (the
 *              head moved past every readable hold: cleared), `absent`,
 *              `unreadable` (every hold line is unreadable: it holds nothing). An
 *              unreadable line beside a live or stale reading voids nothing and is
 *              PRINTED on the row by comment id, so the gap is never silent. A live
 *              hold at `CONTRACT_REVIEW_HOLD_LIST_HOURS` or older on a WAIT row is
 *              LISTED, for the triage round record — the age is a reading, never a
 *              lapse.
 *   lane seat  the lane of the PR's card (`domain:*`) against the open seat
 *              posts: `seated`, `stood-down`, `absent`, `unknown`.
 *   L2 seat the L2 seats (`l2-review#N`, or `review#N`) against the same posts: `seated`
 *              (and which), `stood-down`, `absent`, `unknown` (roster unread).
 *              ⛔ No account is read: independence is per session, never per
 *              account (`lanes/l2-review.md` 独立性 — 「不限账号,派发账号亦可坐」),
 *              so a seat on the PR's own implementing or dispatching account is
 *              as seated as any other.
 *   status     `TAKE` (owed, nobody on it, a trigger holds), `WAIT` (owed,
 *              nobody on it, no trigger yet — the lane's own, a lane's live hold
 *              included), `HELD` (a live claim on this head), `DONE` (a record on
 *              this head). Four, ⛔ no fifth for a hold: a held head is the lane's
 *              own wait, and a `HOLD` beside `HELD` is one letter from a misread.
 *   trigger    the first that holds: (a) a hand-off line naming the current
 *              head, or the waiting label — taken the same round; (b) the head
 *              has waited a full round (`TRIAGE_ROUND_MINUTES`) and no
 *              live hold names it; (c) the lane's seat has stood down or is
 *              absent from the seat roster. A live hold holds (b) alone: the
 *              lane that holds ends it with (a), and a lane gone is (c).
 *   taker      on a TAKE row, who takes it: the seat the hand-off names; else
 *              a seated L2 seat on the delta of a record it signed; else the
 *              lane seat (its next seat on duty when (c) holds), which reviews
 *              at the tier or writes the hand-off. A row owed on the
 *              declaration face alone (`TIER_DEFAULT`) never names an L2 seat,
 *              a hand-off to one included. A bar is a per-session fact this
 *              reader never sees (every other seat able to review the head
 *              barred): it reaches the L2 seat the one way this reader can read,
 *              a hand-off line naming it. ⛔ Never triage.
 *
 * ## Report-only — the exit is 0 on every completed or incomplete read
 *
 * ⛔ Not a gate (the skill's 「新增门禁默认否」): it reads, prints and exits 0,
 * and it writes nothing — no comment, no label, no claim. A read that fails is
 * printed as `sweep INCOMPLETE` naming the pull request and the read, ⛔ never
 * dropped and never reported as clean; the exit stays 0 because a board fact is
 * no reason to fail whoever ran the list. Usage errors exit 2. The verdict on
 * a row — start the review, or not — is the reader's, under the rule text.
 */

import process from 'node:process';

import { isEntrypoint } from '../invoked-as.mjs';
import { CONTRACT_REVIEW_HEADING_MARKER, contractReviewVerdictLines, latestMarkedComment, readSignatureLine } from './check-half-states.mjs';
import { repoIdForSlug } from './check-governed-merges.mjs';
import { GOVERNED_APPROVERS, recordAuthorTrusted, recordTrustedAuthors } from './check-governed-queue-guard.mjs';
import { FLEET_BOT_LOGIN } from './check-handover.mjs';
import { readClause2Line } from './clause2-line.mjs';
import { parseSeat } from './fleet-roster.mjs';
import { isL2ReviewLane } from './mailbox-open.mjs';
import { ghApi, readAllPages } from './gh-pages.mjs';
import {
  CONTRACT_REVIEW_HOLD_LIST_HOURS,
  CONTRACT_REVIEW_HOLD_TEMPLATE,
  REVIEWED_BY_LINE,
  contractReviewClaims,
  contractReviewHandoff,
  contractReviewHold,
  deliveredCardNumber,
  locateReviewOfRecord,
  reviewFace,
} from './record-recognisers.mjs';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;

export const DEFAULT_REPO = 'objectstack-ai/objectstack';
/** The waiting label the dispatching seat hangs at ACCEPT (`references/contract-review.md` 〈等 L2 标记〉). */
export const WAITING_LABEL = 'needs:contract-review';
/** One full round — the rule's 「一轮(约 60 分钟)」, trigger (b). The name is kept: importers read it. */
export const TRIAGE_ROUND_MINUTES = 60;
/** The seat posts' label (`seat-post-protocol.md`); `parseSeat` reads each one. */
export const SEAT_LABEL = 'pm:seat';

const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/**
 * Who may post a record this list reads: the queue guard's own author binding (card #33705) — the
 * relay's identity and `GOVERNED_APPROVERS`, assembled by the guard's `recordTrustedAuthors` and
 * asked with its `recordAuthorTrusted`, ⛔ never a second login list. A comment by anyone else is
 * not read, so it is never the record and never shadows one: on a public repository anyone can
 * post a body shaped like a record, and the guard refuses to land on it.
 */
export const RECORD_AUTHORS = recordTrustedAuthors(FLEET_BOT_LOGIN);
const labelNames = (x) => (Array.isArray(x?.labels) ? x.labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean) : []);

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { repo: DEFAULT_REPO, board: null, now: null, json: false, selfTest: false, help: false, errors: [] };
  const args = [...argv];
  const value = (flag) => {
    const v = args.shift();
    if (v === undefined || v.startsWith('--')) {
      opts.errors.push(`${flag} needs a value`);
      return null;
    }
    return v;
  };
  while (args.length) {
    const a = args.shift();
    if (a === '--repo' || a === '--board') {
      const v = value(a);
      if (v !== null && !REPO_SHAPE.test(v)) opts.errors.push(`${a} takes OWNER/NAME, not ${v}`);
      // ⛔ The rules face is read off the governed register's rows for THIS repository, so a pull list
      // from a repository outside the register cannot be graded — refused, never graded as another's.
      else if (v !== null && a === '--repo' && repoIdForSlug(v) === null) opts.errors.push(`--repo ${v} is outside the governed register (check-governed-merges.mjs GOVERNED_REPOS)`);
      else if (v !== null) opts[a.slice(2)] = v;
    } else if (a === '--now') {
      const v = value(a);
      if (v !== null && !Number.isFinite(Date.parse(v))) opts.errors.push(`--now takes an ISO time, not ${v}`);
      else if (v !== null) opts.now = v;
    } else if (a === '--json') opts.json = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else opts.errors.push(`unknown argument ${a}`);
  }
  if (opts.selfTest && argv.length !== 1) opts.errors.push('--self-test takes no other argument');
  if (opts.board === null) opts.board = opts.repo;
  return opts;
}

/**
 * Why this pull request owes a contract review — the limbs, in the order a
 * reader is told them; empty means it owes none. Pure.
 *
 * ⭐ Composed from the fleet's readers, ⛔ never a second classification: the
 * path limbs are `reviewFace`'s `hits` (the queue guard's own reading), the
 * declaration limbs are `readClause2Line` on the PR body, and the face named
 * beside them is `reviewFace`'s answer for the same inputs.
 */
export function owedFace(pull, repo = DEFAULT_REPO) {
  const paths = Array.isArray(pull?.files) ? pull.files : [];
  const body = String(pull?.body ?? '');
  // `reviewFace` takes the register's repository ID; an unregistered slug reaches it as null and is refused there, loudly.
  const face = reviewFace(paths, repoIdForSlug(repo), { declaredOn: [body] });
  const limbs = [];
  if (face.hits.schema.length > 0) limbs.push('schema');
  if (face.hits.rules.length > 0) limbs.push('rules');
  const declared = readClause2Line(body);
  if (declared?.kind === 'declared' && declared.arm === 'narrowing') limbs.push('narrowing');
  else if (declared?.kind === 'declared' && declared.value === 'yes') limbs.push('declaration');
  else if (declared?.kind === 'malformed') limbs.push('clause2-unreadable');
  if (labelNames(pull).includes(WAITING_LABEL)) limbs.push('label');
  return { limbs, face: face.face, tierName: face.tierName };
}

/** The `Reviewed-by:` value of a record, decoration stripped, or null. Pure. */
export function reviewedByOf(body) {
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const m = REVIEWED_BY_LINE.exec(line);
    if (m) return m[1].replace(/[`*]/g, '').trim().split(/\s+/)[0] || null;
  }
  return null;
}

/**
 * The record's verdict as the queue guard reads it (card #33705): the word of its ONE `VERDICT:`
 * line, counted by the fleet's reader `contractReviewVerdictLines` — `unstated` with none (a
 * heading-inline or bare word alone included), `ambiguous` with two or more (a quoted earlier
 * verdict, a FAIL appended under a PASS), which the guard refuses because a record states exactly
 * one. ⛔ Never the first match. A display, never a judgment. Pure.
 */
export function verdictOf(body) {
  const words = contractReviewVerdictLines(body);
  if (words.length === 0) return 'unstated';
  return words.length === 1 ? words[0] : 'ambiguous';
}

/**
 * The record on this head, or the newest one on another head, or none. Pure
 * over the threads. `locateReviewOfRecord` decides "on this head" — the queue
 * guard's own reading; it is handed no git reader, so a `Regen-provenance:`
 * carry is `unjudged` here rather than guessed. As the guard does, a comment
 * whose author `trusted` does not hold is dropped from both threads BEFORE the
 * locator reads them (card #33705); `ignored` counts the drops.
 */
export function recordReading(pull, trusted = RECORD_AUTHORS) {
  let ignored = 0;
  const kept = (rows) => {
    if (!Array.isArray(rows)) return rows;
    const out = rows.filter((row) => recordAuthorTrusted(row, trusted));
    ignored += rows.length - out.length;
    return out;
  };
  const pair = {
    pr: pull.number,
    card: pull.card ?? null,
    headSha: pull.head?.sha ?? null,
    prComments: kept(pull.comments),
    cardComments: pull.card === null || pull.card === undefined ? [] : kept(pull.cardComments),
  };
  const located = locateReviewOfRecord(pair);
  if (located.state === 'unreadable') return { state: 'unjudged', gaps: located.gaps, ignored };
  const rows = [...(Array.isArray(pair.prComments) ? pair.prComments : []), ...(Array.isArray(pair.cardComments) ? pair.cardComments : [])];
  if (located.state === 'found' || located.state === 'unsigned') {
    const row = rows.find((r) => (r?.id ?? null) === located.id) ?? null;
    return { state: 'current', id: located.id, where: located.where, by: reviewedByOf(row?.body), seat: signerSeatOf(row?.body), verdict: verdictOf(row?.body), signed: located.state === 'found', ignored };
  }
  const newest = latestMarkedComment(rows, CONTRACT_REVIEW_HEADING_MARKER);
  if (!newest) return { state: 'none', ignored };
  const row = rows[newest.index];
  return { state: 'stale', id: row?.id ?? null, by: reviewedByOf(row?.body), seat: signerSeatOf(row?.body), verdict: verdictOf(row?.body), ignored };
}

/**
 * The seat that signed a record — its first line's seat signature (`readSignatureLine`), as `lane#N`,
 * the spelling `reviewSeatsOf` names a seat with — or null when it carries none. Pure.
 */
export function signerSeatOf(body) {
  const sig = readSignatureLine(body);
  return sig === null ? null : `${sig.lane}#${sig.seat}`;
}

/** The limbs owe on the declaration face ALONE (`Clause-②: yes`, no schema and no governed path): `TIER_DEFAULT`. Pure. */
export function declarationFaceOnly(limbs) {
  const list = Array.isArray(limbs) ? limbs : [];
  return list.includes('declaration') && !list.some((l) => l === 'schema' || l === 'rules' || l === 'narrowing');
}

/**
 * The PR's lane seat, read off the card's `domain:*` label and the open seat
 * posts. Pure. `seats` null means the roster could not be read.
 */
export function laneSeatOf(cardLabels, seats) {
  const lane = (Array.isArray(cardLabels) ? cardLabels : []).find((l) => /^domain:[a-z][a-z0-9-]*$/.test(l)) ?? null;
  if (lane === null) return { lane: null, seat: 'unknown' };
  if (!Array.isArray(seats)) return { lane, seat: 'unknown' };
  const rows = seats.filter((s) => s?.lane === lane);
  if (rows.some((s) => s.status === 'seated')) return { lane, seat: 'seated' };
  return { lane, seat: rows.length > 0 ? 'stood-down' : 'absent' };
}

/**
 * The L2 seats (`lanes/l2-review.md`: lane `l2-review`, seats `l2-review#N`; the old spelling `review` / `review#N` reads
 * the same — `isL2ReviewLane`, the opener's two words) on the open seat posts. Each is named by the word its own post spells. Pure.
 * `seats` null means the roster could not be read. `seated` names every seated one, canonically.
 */
export function reviewSeatsOf(seats) {
  if (!Array.isArray(seats)) return { state: 'unknown', seated: [] };
  const rows = seats.filter((s) => isL2ReviewLane(s?.lane));
  const name = (s) => `${String(s.lane).trim().toLowerCase()}#${Number(s.seat) > 0 ? Number(s.seat) : 1}`;
  // `lanes/l2-review.md` 独立性: the pair is two SESSIONS, ⛔ never two accounts (ruling A on #33258) —
  // a seat's account is not read, so one on the PR's own implementing or dispatching account is seated like any other.
  const seated = rows.filter((s) => s.status === 'seated').map(name).sort();
  if (seated.length > 0) return { state: 'seated', seated };
  return { state: rows.length > 0 ? 'stood-down' : 'absent', seated: [] };
}

/**
 * One row for one pull request, or null when its face owes no review. Pure.
 *
 * @param {object} pull  a REST pull row plus `files` (paths), `comments`, `card`, `cardComments`,
 *                       `cardLabels`, `headCommittedAt` (ISO) and `gaps` (reads that failed)
 * @param {{ now: number, seats: object[]|null, repo?: string }} context
 */
export function owedReviewRow(pull, { now, seats, repo = DEFAULT_REPO }) {
  const owed = owedFace(pull, repo);
  if (owed.limbs.length === 0) return null;
  const head = String(pull?.head?.sha ?? '');
  const committed = Date.parse(pull?.headCommittedAt ?? '');
  // The later of the head's commit and the PR's opening: a head cannot have waited longer than its PR has existed.
  const opened = Date.parse(pull?.created_at ?? '');
  const since = Number.isFinite(committed) ? Math.max(committed, Number.isFinite(opened) ? opened : committed) : Number.NaN;
  const waited = Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / 60000)) : null;
  const record = recordReading(pull);
  const handoff = contractReviewHandoff(pull.comments, head);
  const claim = contractReviewClaims(pull.comments, head, { now });
  const hold = contractReviewHold(pull.comments, head, { now });
  const lane = laneSeatOf(pull.cardLabels, seats);
  const review = reviewSeatsOf(seats);
  const triggers = [];
  if (handoff.state === 'handed') triggers.push('(a) hand-off');
  if (owed.limbs.includes('label')) triggers.push('(a) label');
  // (b) alone yields to a live hold: the lane said "not this head yet", and only (a) or (c) overrides that.
  const roundWaited = waited !== null && waited >= TRIAGE_ROUND_MINUTES ? `(b) waited ${waited} min` : null;
  if (roundWaited !== null && hold.state !== 'live') triggers.push(roundWaited);
  if (lane.seat === 'stood-down' || lane.seat === 'absent') triggers.push(`(c) lane seat ${lane.seat}`);
  let status;
  if (record.state === 'current') status = 'DONE';
  else if (claim.state === 'live') status = 'HELD';
  else status = triggers.length > 0 ? 'TAKE' : 'WAIT';
  // Listed for the round record: a live hold the age reading calls overdue — or cannot time — on a row it keeps waiting.
  const listed = status === 'WAIT' && hold.state === 'live' && hold.overdue !== false;
  return {
    pr: pull.number,
    draft: pull.draft === true,
    face: owed.limbs,
    tierName: owed.tierName,
    head,
    waited,
    record,
    handoff: { state: handoff.state, to: handoff.state === 'handed' ? handoff.to : null, id: handoff.id ?? null },
    claim: { state: claim.state, holder: claim.holder ?? null, tie: claim.tie ?? false, unreadable: claim.unreadable ?? [] },
    hold: {
      state: hold.state,
      id: hold.id ?? null,
      session: hold.session ?? null,
      reason: hold.reason ?? null,
      until: hold.until ?? null,
      at: hold.at ?? null,
      ageMinutes: hold.ageMinutes ?? null,
      overdue: hold.overdue ?? null,
      holds: hold.state === 'live' ? roundWaited : null,
      listed,
      gaps: hold.gaps ?? [],
      unreadable: hold.unreadable ?? [],
    },
    lane: lane.lane,
    laneSeat: lane.seat,
    reviewSeat: review.state,
    reviewSeats: review.seated,
    status,
    trigger: status === 'TAKE' || status === 'WAIT' ? (triggers[0] ?? 'none yet') : null,
    taker: takerOf(status, handoff, lane, review, { limbs: owed.limbs, record }),
    gaps: Array.isArray(pull.gaps) ? pull.gaps : [],
  };
}

/**
 * Who takes a TAKE row (null on every other status). Pure. The rule text (`contract-review.md`
 * 〈L2 归属与资格〉, `lanes/l2-review.md` 路由): the L2 seat is the FALLBACK, never the default taker.
 * It is named where a hand-off line on this head names it, and where the row is the delta of a
 * record it signed while it is seated (`lanes/l2-review.md`: the delta stays with the original L2
 * reviewer). Every other TAKE row — the waiting label, (b) a full round, (c) the lane seat gone —
 * is the lane's, which reviews at the tier itself or writes the hand-off. A row owed on the
 * declaration face alone (`TIER_DEFAULT`, SKILL.md
 * 〈审核两级〉) never names an L2 seat, a hand-off to one included. ⛔ Never triage.
 */
export function takerOf(status, handoff, lane, review = { state: 'unknown', seated: [] }, { limbs = [], record = null } = {}) {
  if (status !== 'TAKE') return null;
  const seat = lane?.lane ? `the ${lane.lane} seat` : 'the lane seat';
  const laneGone = lane?.seat === 'stood-down' || lane?.seat === 'absent';
  const laneTaker = laneGone ? `${seat} next on duty` : seat;
  const isL2 = (name) => typeof name === 'string' && isL2ReviewLane(name.split('#')[0]);
  const handedTo = handoff?.state === 'handed' && typeof handoff.to === 'string' ? handoff.to : null;
  if (declarationFaceOnly(limbs)) {
    if (handedTo !== null && !isL2(handedTo)) return handedTo;
    return `${laneTaker} (${TIER_DEFAULT_FACE_NOTE})`;
  }
  if (handedTo !== null) return handedTo;
  const signer = record?.state === 'stale' ? record.seat : null;
  // An unread card thread leaves the record itself `unjudged`, so no earlier-head signer is read and it never gets here.
  if (isL2(signer) && review?.state === 'seated' && review.seated.includes(signer)) return `${signer} (the delta of its own record ${record.id})`;
  return `${laneTaker} (${LANE_OWN_NOTE})`;
}

/** What the lane seat does with a row it takes — the rule's 「车道达档自审或交接」. */
export const LANE_OWN_NOTE = 'at the tier, or the hand-off line';
/** Why a declaration-face row names no L2 seat — SKILL.md 〈审核两级〉. */
export const TIER_DEFAULT_FACE_NOTE = 'TIER_DEFAULT face: the lane\'s own record, never an L2 seat\'s';

const STATUS_ORDER = Object.freeze(['TAKE', 'WAIT', 'HELD', 'DONE']);

/** Every owing row, TAKE first, then by PR number. Pure. */
export function owedReviewRows(snapshot, { now }) {
  const rows = (snapshot?.pulls ?? [])
    .map((pull) => owedReviewRow(pull, { now, seats: snapshot?.seats ?? null, repo: snapshot?.repo ?? DEFAULT_REPO }))
    .filter((row) => row !== null);
  return rows.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.pr - b.pr);
}

const short = (sha) => String(sha ?? '').slice(0, 12);

/** One printed line for one row. Pure. */
export function renderRow(row) {
  const record = row.record.state === 'current' || row.record.state === 'stale'
    ? `${row.record.state} ${row.record.verdict} by ${row.record.by ?? 'nobody named'} (${row.record.id})`
    : row.record.state;
  // The comments the author binding dropped are printed, never silent (card #33705).
  const untrusted = row.record.ignored > 0 ? ` (${row.record.ignored} by an untrusted author not read)` : '';
  const holder = row.claim.holder;
  const claim = holder === null
    ? row.claim.state
    : `live ${holder.session} (${holder.side}${row.claim.tie ? ', a triage claim yields' : ''}, ${holder.id}, ${holder.time})`;
  const parts = [
    `${row.status}  #${row.pr} ${row.draft ? 'draft' : 'ready'}`,
    `face ${row.face.join('+')}`,
    `head ${short(row.head)} (${row.waited === null ? '? min' : `${row.waited} min`})`,
    `record ${record}${untrusted}`,
    `hand-off ${row.handoff.state}${row.handoff.to ? ` ${row.handoff.to}` : ''}${row.handoff.id === null ? '' : ` (${row.handoff.id})`}`,
    `claim ${claim}`,
    `hold ${holdText(row.hold)}`,
    `lane ${row.lane ?? '?'} ${row.laneSeat}`,
    `L2 seat ${row.reviewSeat}${row.reviewSeats.length > 0 ? ` ${row.reviewSeats.join(',')}` : ''}`,
  ];
  const tail = row.trigger === null ? '' : ` → ${row.trigger}${row.taker ? ` · take: ${row.taker}` : ''}`;
  const listed = row.hold.listed ? `  ⏳ HOLD ${holdAge(row.hold)} — list it in the triage round record` : '';
  const gaps = row.gaps.length > 0 ? `  ⚠️ UNREAD: ${row.gaps.join('; ')}` : '';
  return `${parts.join(' · ')}${tail}${listed}${gaps}`;
}

/** The hold's age as printed: hours, or that it could not be timed. Pure. */
function holdAge(hold) {
  return hold.ageMinutes === null ? 'age unknown' : `${Math.floor(hold.ageMinutes / 60)} h old`;
}

/**
 * The hold part of a row: who holds, since when, until what, and the (b) it holds — and, beside a live
 * or stale reading, every hold line that could not be read, by comment id: it voided nothing, and
 * it is printed so the gap is seen. Pure.
 */
function holdText(hold) {
  const unread = hold.unreadable ?? [];
  const gap = hold.state !== 'unreadable' && unread.length > 0
    ? ` ⚠️ ${unread.length} unreadable hold line(s) (${unread.map((u) => u.id ?? '?').join(', ')})`
    : '';
  if (hold.state === 'live') {
    const holds = hold.holds === null ? '' : `, holds ${hold.holds}`;
    return `live ${hold.session} (${hold.id}, ${holdAge(hold)}${holds}) until ${hold.until}${gap}`;
  }
  if (hold.state === 'stale' || hold.state === 'unreadable') return `${hold.state}${hold.id === null ? '' : ` (${hold.id})`}${gap}`;
  return hold.state;
}

/** The printed report. Pure. */
export function renderReport(rows, { repo, now, read, gaps }) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  const lines = [
    `check-owed-reviews — ${repo}, ${new Date(now).toISOString().replace(/:\d\d\.\d{3}Z$/, 'Z')}: ${read.pulls} open PR(s) read (${read.drafts} draft); `
      + `${rows.length} owe a contract review — ${count('TAKE')} to take, ${count('WAIT')} waiting on the lane, ${count('HELD')} claimed, ${count('DONE')} reviewed on this head.`,
    '',
    ...rows.map(renderRow),
  ];
  const listed = rows.filter((r) => r.hold.listed);
  if (listed.length > 0) {
    lines.push(
      '',
      `⏳ ${listed.length} hold(s) ${CONTRACT_REVIEW_HOLD_LIST_HOURS} h or older keep a PR waiting — list each in the triage round record:`,
      ...listed.map((r) => `  - #${r.pr} held by ${r.hold.session} since ${r.hold.at ?? '?'} (${holdAge(r.hold)}) until ${r.hold.until}`),
    );
  }
  if (gaps.length > 0) {
    lines.push('', `⚠️ sweep INCOMPLETE — ${gaps.length} read(s) failed; the rows above are not the whole answer:`, ...gaps.map((g) => `  - ${g}`));
  }
  lines.push('', 'Report-only: exit 0, nothing written. The rule is `references/contract-review.md` 〈L2 归属与资格〉.');
  return lines;
}

// ---------------------------------------------------------------------------
// The live read — every read through one injected `get`, so the self-test drives it offline
// ---------------------------------------------------------------------------

/**
 * Read the board into the snapshot the pure core takes. ⛔ A failed read is
 * recorded as a GAP on its pull request (or on the sweep) and the read goes
 * on — never a partial list returned as whole, and never a throw that loses
 * the rows already read.
 */
export function readSnapshot({ repo, board, get = ghApi }) {
  const gaps = [];
  const list = (path) => readAllPages(path, { get });
  const pullsRead = list(`/repos/${repo}/pulls?state=open`);
  if (!pullsRead.ok) return { repo, pulls: [], seats: null, gaps: [`the open pull list (${pullsRead.error})`] };
  const seatsRead = list(`/repos/${board}/issues?state=open&labels=${encodeURIComponent(SEAT_LABEL)}`);
  const seats = seatsRead.ok ? seatsRead.value.map((post) => parseSeat(post, board)).filter((s) => s !== null) : null;
  if (!seatsRead.ok) gaps.push(`the seat posts on ${board} (${seatsRead.error}) — trigger (c) and the L2 seats are not judged`);
  const pulls = [];
  for (const raw of pullsRead.value) {
    const pull = { ...raw, files: [], comments: [], card: null, cardComments: [], cardLabels: [], headCommittedAt: null, gaps: [] };
    const files = list(`/repos/${repo}/pulls/${raw.number}/files`);
    if (files.ok) pull.files = files.value.flatMap((f) => [f.filename, f.previous_filename].filter((p) => typeof p === 'string'));
    else pull.gaps.push(`files (${files.error})`);
    pulls.push(pull);
    // Threads, card and commit only where a review is owed: the face is read first, from the paths, body and labels.
    if (files.ok && owedFace(pull, repo).limbs.length === 0) continue;
    const comments = list(`/repos/${repo}/issues/${raw.number}/comments`);
    if (comments.ok) pull.comments = comments.value;
    else {
      pull.comments = null;
      pull.gaps.push(`comments (${comments.error})`);
    }
    const delivered = deliveredCardNumber(raw);
    if (delivered.card !== null) {
      pull.card = delivered.card;
      const card = get(`/repos/${repo}/issues/${delivered.card}`);
      if (card.ok) pull.cardLabels = labelNames(card.value);
      else pull.gaps.push(`card #${delivered.card} (${card.error})`);
      const cardComments = list(`/repos/${repo}/issues/${delivered.card}/comments`);
      if (cardComments.ok) pull.cardComments = cardComments.value;
      else {
        pull.cardComments = null;
        pull.gaps.push(`card #${delivered.card} comments (${cardComments.error})`);
      }
    }
    const commit = get(`/repos/${repo}/commits/${raw.head?.sha}`);
    if (commit.ok) pull.headCommittedAt = commit.value?.commit?.committer?.date ?? null;
    else pull.gaps.push(`head commit (${commit.error})`);
  }
  for (const pull of pulls) for (const g of pull.gaps) gaps.push(`#${pull.number}: ${g}`);
  return { repo, pulls, seats, gaps };
}

const USAGE = [
  'usage: node scripts/pm/check-owed-reviews.mjs [--repo OWNER/NAME] [--board OWNER/NAME] [--now ISO] [--json]',
  '       node scripts/pm/check-owed-reviews.mjs --self-test | --help',
  '',
  '  Lists the open pull requests, drafts included, whose face owes a contract review, with the record,',
  '  hand-off and claim on the current head, the trigger, and who takes it: the seat the hand-off',
  '  names; else the L2 seat (`l2-review#N`) on the delta of its own record; else the lane seat, at',
  '  the tier or by a hand-off line — the L2 seat is the fallback, never the default; never triage.',
  `  --repo   the repository whose pulls are read (default ${DEFAULT_REPO}); --board, where the seat posts live`,
  '  --now    the clock (default: now); --json prints the rows as JSON',
  '  Report-only: reads through `gh api`, writes nothing, exits 0 on every read; 2 on a usage error.',
].join('\n');

export function main(argv, { get = ghApi, log = console.log, error = console.error } = {}) {
  const opts = parseArgs(argv);
  if (opts.errors.length > 0) {
    for (const e of opts.errors) error(`check-owed-reviews: ${e}`);
    error(`\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (opts.help) {
    log(USAGE);
    return EXIT_OK;
  }
  const now = opts.now === null ? Date.now() : Date.parse(opts.now);
  const snapshot = readSnapshot({ repo: opts.repo, board: opts.board, get });
  const rows = owedReviewRows(snapshot, { now });
  const read = { pulls: snapshot.pulls.length, drafts: snapshot.pulls.filter((p) => p.draft === true).length };
  if (opts.json) log(JSON.stringify({ repo: opts.repo, now: new Date(now).toISOString(), read, gaps: snapshot.gaps, rows }, null, 2));
  else for (const line of renderReport(rows, { repo: opts.repo, now, read, gaps: snapshot.gaps })) log(line);
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Self-test — battery roster, floor and handshake (AGENTS.md § Writing a `--self-test`)
// ---------------------------------------------------------------------------

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'arguments: modes and every refusal': 6,
  'the owed face: paths, the Clause-② line, the label — drafts included, nothing else owes': 9,
  // 8 → 13 (#33705): the queue guard's author binding (an untrusted PASS unread, unable to shadow a trusted FAIL, an
  // approver's read) and its counted verdict reading (two lines `ambiguous`, an inline word alone `unstated`).
  'the record: on this head (by whom, as stated), on an earlier head, none, unjudged': 13,
  'the triggers: (a) hand-off or label the same round, (b) a full round, (c) the lane seat': 10,
  // 10 → 14 → 16: S2 and S4 of PR #29967's contract review — an L2 seat on the PR's own account is barred (`lanes/l2-review.md` 独立性); an unread card thread leaves the bar unjudged.
  // 16 → 17 (#34003): the area-lease exception is named beside a barred seat, which stays barred — the maintainer's word is off GitHub.
  // 17 → 18: the L2 lane word `l2-review` beside its old spelling `review`, each seat named by the word its own post spells.
  // 18 → 24 (#34376): the L2 seat is the fallback — (b), (c) and the label are the lane's; the TIER_DEFAULT face never
  // names an L2 seat; an L2 seat takes the delta of its own record. The lane-joins-after-a-further-round case retired with the rule.
  // 24 → 18 (#34400, ruling A on #33258): the account bar is gone — its eight cases (S2, S4, the area-lease note, the
  // own delta of a now-barred signer) retire with it; one case pins same account, different session ⇒ seated and named,
  // and one keeps the unread-card-thread reading (the record unjudged, no own delta), which never needed the bar.
  'the L2 seat is the fallback: named by a hand-off or on its own delta, never on (b), (c), the label or the TIER_DEFAULT face': 18,
  'a live claim holds the head and a record settles it; a lapsed claim holds nothing': 6,
  'the live instance: two Tier H drafts with a hand-off on the current head list as TAKE under (a)': 4,
  'the live read: every read through one reader; a failed read is INCOMPLETE, never clean': 6,
  'the report: one line per owing PR, TAKE first, exit 0': 5,
  'the hold: a live hold on this head holds (b) alone, (a) and (c) still fire; a new head clears it; at 24 hours it is listed, still WAIT': 14,
});
const SELF_TEST_BATTERY_FLOOR = 10;
const UNATTRIBUTED_BATTERY = '(no battery open)';

export function selfTest() {
  const cases = [];
  const seen = new Map();
  let open = null;
  const battery = (name) => {
    open = name;
  };
  const t = (name, ok, detail) => {
    const b = open ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
    cases.push({ name: `[${b}] ${name}`, ok: Boolean(ok), detail });
  };

  const NOW = Date.parse('2026-10-28T13:00:00Z');
  const HEAD = '3beee64fe77741d07f035f1b80eeaa07e7280ab4';
  const HEAD2 = 'ff079cc066b82261e0827f995c83d075302f6798';
  const TRIAGE = 'session_01AavokzJ5DndAwitDXvKy4U';
  const LANE = 'session_01JQwxbZeBv2y91towxasSUT';
  const REVIEWER = 'session_01ReviewSeatFixture7Qx';
  const handoff = (head, at, to = 'review#1') => ({ id: 6463525633, created_at: at, body: `## Seat note · contract review owed\n\nContract-review-handoff: ${to} — CONTRACT_REVIEW_TIER unavailable (ceiling model out for the fleet since 2026-10-27, seat runs at TIER_DEFAULT, ${at.slice(0, 16)}Z) · head \`${head}\`` });
  const claimRow = (session, head, at, sig) => ({ id: 6468788431, created_at: at, body: `${sig}\n\nContract-review-claim: \`${session}\` · head \`${head}\` · ${at.slice(0, 16)}Z\n\nTaking the review.` });
  // Records are posted through the relay, so the fixtures carry its login: the author binding reads no other (#33705).
  const recordRow = (head, verdict = 'PASS', id = 6469007202, login = FLEET_BOT_LOGIN) => ({ id, created_at: '2026-10-28T12:29:43Z', user: { login }, body: `## Contract review\n\nServed-tier: \`CONTRACT_REVIEW_TIER\`\nHead-sha: \`${head}\`\nLocal-runs: none\n\nReviewed-by: \`${TRIAGE}\`\n\n**VERDICT: ${verdict}**` });
  const pull = (o = {}) => ({
    number: 27136,
    draft: true,
    body: 'Part of #25922\n\nClause-②: no\nMetadata-protocol: none',
    head: { sha: HEAD, ref: 'claude/project-thread-6d34fw' },
    labels: [],
    files: ['.github/workflows/ci.yml'],
    comments: [],
    card: null,
    cardComments: [],
    cardLabels: ['domain:ui'],
    headCommittedAt: '2026-10-28T07:30:00Z',
    gaps: [],
    ...o,
  });
  const SEATED = [{ lane: 'domain:ui', status: 'seated' }, { lane: 'domain:skills', status: 'seated' }];
  const row = (o, seats = SEATED) => owedReviewRow(pull(o), { now: NOW, seats });

  battery('arguments: modes and every refusal');
  const d = parseArgs([]);
  t('defaults: this repository, its own board, no clock, text', d.errors.length === 0 && d.repo === DEFAULT_REPO && d.board === DEFAULT_REPO && d.now === null && d.json === false);
  t('--repo moves the board with it unless --board is named', parseArgs(['--repo', 'objectstack-ai/objectui']).board === 'objectstack-ai/objectui' && parseArgs(['--repo', 'objectstack-ai/objectui', '--board', 'o/b']).board === 'o/b');
  t('a repo not shaped OWNER/NAME, or outside the governed register, is refused', parseArgs(['--repo', 'nope']).errors.some((e) => e.includes('OWNER/NAME')) && parseArgs(['--repo', 'o/a']).errors.some((e) => e.includes('governed register')));
  t('--now takes an ISO time; anything else is refused', parseArgs(['--now', '2026-10-28T13:00Z']).now === '2026-10-28T13:00Z' && parseArgs(['--now', 'soon']).errors.length === 1);
  t('an unknown flag is refused, never ignored, and a flag with no value says so', parseArgs(['--bogus']).errors.some((e) => e.includes('--bogus')) && parseArgs(['--repo']).errors.some((e) => e.includes('needs a value')));
  t('--self-test runs alone', parseArgs(['--self-test']).errors.length === 0 && parseArgs(['--self-test', '--json']).errors.length === 1);

  battery('the owed face: paths, the Clause-② line, the label — drafts included, nothing else owes');
  t('⭐ a governed path owes (the rules face, read by `reviewFace`) — on a DRAFT', (() => { const r = row({}); return r !== null && r.face.includes('rules') && r.draft === true; })());
  t('a published schema path owes the schema face', owedFace(pull({ files: ['packages/spec/src/data/field.zod.ts'] })).limbs.includes('schema'));
  t('⭐ a `Clause-②: no (narrowing)` body owes with no contract path (the narrowing face)', owedFace(pull({ files: ['ui/packages/plugin-ai/package.json'], body: 'Clause-②: no (narrowing)\nMetadata-protocol: narrowed' })).limbs.join() === 'narrowing');
  t('a `Clause-②: yes` body owes the declaration face', owedFace(pull({ files: ['packages/runtime/src/x.ts'], body: 'Clause-②: yes\nMetadata-protocol: added' })).limbs.join() === 'declaration');
  t('a malformed `Clause-②:` line is listed, never dropped', owedFace(pull({ files: ['packages/runtime/src/x.ts'], body: 'Clause-②: maybe' })).limbs.join() === 'clause2-unreadable');
  t('⭐ the waiting label alone owes', owedFace(pull({ files: ['packages/runtime/src/x.ts'], body: 'Clause-②: no', labels: [{ name: WAITING_LABEL }] })).limbs.join() === 'label');
  t('⛔ an ordinary runtime diff declaring `Clause-②: no` owes NOTHING — no row', row({ files: ['packages/runtime/src/x.ts'], body: 'Clause-②: no' }) === null);
  t('test files under the spec are no schema face (the suspect surface excepts them)', owedFace(pull({ files: ['packages/spec/src/data/field.test.ts'], body: '' })).limbs.length === 0);
  t('a ready PR owes exactly as a draft does', row({ draft: false }).face.join() === row({}).face.join() && row({ draft: false }).draft === false);

  battery('the record: on this head (by whom, as stated), on an earlier head, none, unjudged');
  const done = row({ comments: [recordRow(HEAD)] });
  t('⭐ a record on this head ⇒ DONE, current, PASS as stated, by the `Reviewed-by:` session', done.status === 'DONE' && done.record.state === 'current' && done.record.verdict === 'PASS' && done.record.by === TRIAGE && done.trigger === null);
  t('a FAIL record on this head is still DONE — the reviewer rendered; the delta stays theirs', row({ comments: [recordRow(HEAD, 'FAIL')] }).status === 'DONE');
  t('a record on the CARD thread counts as on the PR', row({ card: 25922, cardComments: [recordRow(HEAD)] }).status === 'DONE');
  const stale = row({ comments: [recordRow(HEAD2, 'PASS', 11)] });
  t('⭐ a record on an EARLIER head ⇒ stale, naming the earlier reviewer; the review is owed again', stale.record.state === 'stale' && stale.record.by === TRIAGE && stale.status !== 'DONE');
  t('no record at all ⇒ none', row({}).record.state === 'none');
  t('⛔ an unreadable thread is unjudged, never none', row({ comments: null }).record.state === 'unjudged');
  // ⭐ #27979, the measured instance (PR #27964, record 6516042954): a DELTA record on an earlier head whose prose
  // names this head three times. The whole-body span scan read it as `current` here and the queue guard cleared on
  // it; the `Head-sha:` line alone decides now, through the one locator both share.
  const deltaRow = { id: 6516042954, created_at: '2026-10-30T05:53:38Z', user: { login: FLEET_BOT_LOGIN }, body: `## Contract review\n\nServed-tier: \`CONTRACT_REVIEW_TIER\`\nHead-sha: \`${HEAD2}\`\nLocal-runs: none\n\nThis is a DELTA record. The PR has since moved to \`${HEAD.slice(0, 8)}\` (seat comment 6515952505); this record judges \`${HEAD2.slice(0, 8)}\` alone. The runs were cancelled by the push of \`${HEAD.slice(0, 8)}\`; landing waits on \`${HEAD}\` and that head's record.\n\nReviewed-by: \`${TRIAGE}\`\n\n**VERDICT: PASS**` };
  t('⛔ #27979: a delta record on an EARLIER head whose PROSE names this head is STALE for this head — the review is owed again', (() => { const r = row({ comments: [deltaRow] }); return r.record.state === 'stale' && r.record.id === 6516042954 && r.status !== 'DONE'; })());
  t('⭐ #27979: …and CURRENT for the head its `Head-sha:` line names', row({ head: { sha: HEAD2, ref: 'claude/project-thread-6d34fw' }, comments: [deltaRow] }).record.state === 'current');
  // #33705: the queue guard's author binding and its counted verdict reading, imported, never copied.
  const untrusted = row({ comments: [recordRow(HEAD, 'PASS', 6469007203, 'drive-by-commenter')] });
  t('⛔ #33705: a PASS record on this head posted by an author outside the relay and GOVERNED_APPROVERS is NOT read — none, still owed, and the drop is printed', untrusted.record.state === 'none' && untrusted.status !== 'DONE' && untrusted.record.ignored === 1 && renderRow(untrusted).includes('record none (1 by an untrusted author not read)'), JSON.stringify(untrusted.record));
  t('⛔ #33705: …nor does a newer untrusted PASS shadow a trusted FAIL on the same head, on either thread', (() => { const r = row({ card: 25922, comments: [recordRow(HEAD, 'FAIL', 11)], cardComments: [{ ...recordRow(HEAD, 'PASS', 12, 'drive-by-commenter'), created_at: '2026-10-28T12:50:00Z' }] }); return r.record.state === 'current' && r.record.id === 11 && r.record.verdict === 'FAIL' && r.record.ignored === 1; })());
  t('#33705: a record an account in GOVERNED_APPROVERS posted is read, and the binding is the guard\'s own set, relay first', row({ comments: [recordRow(HEAD, 'PASS', 13, GOVERNED_APPROVERS[0])] }).record.state === 'current' && JSON.stringify(RECORD_AUTHORS) === JSON.stringify([FLEET_BOT_LOGIN, ...GOVERNED_APPROVERS]));
  const twoLines = { ...recordRow(HEAD), body: `${recordRow(HEAD).body}\n\n> **VERDICT: FAIL**` };
  t('⛔ #33705: a record stating TWO `VERDICT:` lines reads `ambiguous` as the guard counts them, never its first match PASS', (() => { const r = row({ comments: [twoLines] }); return r.record.state === 'current' && r.record.verdict === 'ambiguous' && renderRow(r).includes('record current ambiguous by'); })());
  t('#33705: …a heading-inline word alone is `unstated` (the guard reads no `VERDICT:` line), and one line reads its word', [verdictOf('## Contract review (clause ②) — **PASS**\n\nPASS'), verdictOf(recordRow(HEAD).body), verdictOf(recordRow(HEAD, 'FAIL').body)].join() === 'unstated,PASS,FAIL');

  battery('the triggers: (a) hand-off or label the same round, (b) a full round, (c) the lane seat');
  const fresh = '2026-10-28T12:30:00Z';
  t('⭐ (a) a hand-off naming the current head ⇒ TAKE the same round, even 30 minutes in', (() => { const r = row({ headCommittedAt: fresh, comments: [handoff(HEAD, '2026-10-28T12:40:00Z')] }); return r.status === 'TAKE' && r.trigger === '(a) hand-off' && r.handoff.state === 'handed' && r.handoff.to === 'review#1' && r.taker === 'review#1'; })());
  t('⭐ (a) the waiting label ⇒ TAKE the same round, taken by the lane seat — the label names no seat', (() => { const r = row({ headCommittedAt: fresh, labels: [{ name: WAITING_LABEL }] }); return r.status === 'TAKE' && r.trigger === '(a) label' && r.taker === `the domain:ui seat (${LANE_OWN_NOTE})`; })());
  t('⭐ a hand-off to a sibling lane seat names that seat as the taker — the fallback while no L2 seat is seated', (() => { const r = row({ headCommittedAt: fresh, comments: [handoff(HEAD, '2026-10-28T12:40:00Z', 'domain:ui#2')] }); return r.status === 'TAKE' && r.taker === 'domain:ui#2' && renderRow(r).includes('hand-off handed domain:ui#2 (6463525633)') && renderRow(r).includes('→ (a) hand-off · take: domain:ui#2'); })());
  t('⛔ a hand-off line still naming `triage` hands to nobody: unreadable, no (a) from it, and the taker is never triage', (() => { const r = row({ headCommittedAt: fresh, labels: [{ name: WAITING_LABEL }], comments: [handoff(HEAD, '2026-10-28T12:40:00Z', 'triage')] }); return r.handoff.state === 'unreadable' && r.trigger === '(a) label' && r.taker === `the domain:ui seat (${LANE_OWN_NOTE})` && !/take: [^·]*triage/.test(renderRow(r)); })());
  t('a hand-off on an EARLIER head is no (a) — stale', (() => { const r = row({ headCommittedAt: fresh, comments: [handoff(HEAD2, '2026-10-28T12:40:00Z')] }); return r.handoff.state === 'stale' && r.status === 'WAIT'; })());
  t('⭐ (b) the head has waited a full triage round with no record and no claim ⇒ TAKE', (() => { const r = row({ headCommittedAt: '2026-10-28T11:59:00Z' }); return r.status === 'TAKE' && r.trigger === '(b) waited 61 min' && r.taker === `the domain:ui seat (${LANE_OWN_NOTE})`; })());
  t('under a full round, nothing else holding ⇒ WAIT (the lane\'s own), trigger none yet', (() => { const r = row({ headCommittedAt: '2026-10-28T12:01:00Z' }); return r.status === 'WAIT' && r.trigger === 'none yet' && r.waited === 59; })());
  t('⭐ (c) the lane seat stood down, or absent from the roster ⇒ TAKE, by the lane\'s next seat', row({ headCommittedAt: fresh }, [{ lane: 'domain:ui', status: 'paused' }]).trigger === '(c) lane seat stood-down' && row({ headCommittedAt: fresh }, [{ lane: 'domain:skills', status: 'seated' }]).trigger === '(c) lane seat absent' && row({ headCommittedAt: fresh }, [{ lane: 'domain:ui', status: 'paused' }]).taker === `the domain:ui seat next on duty (${LANE_OWN_NOTE})`);
  t('an unread roster or a card with no lane judges no (c)', row({ headCommittedAt: fresh }, null).laneSeat === 'unknown' && row({ headCommittedAt: fresh, cardLabels: [] }).laneSeat === 'unknown');
  t('an unknown commit time judges no (b); a PR opened after its head commit waits from its opening', row({ headCommittedAt: null }).waited === null && row({ headCommittedAt: null }).status === 'WAIT' && row({ headCommittedAt: '2026-10-28T07:30:00Z', created_at: '2026-10-28T12:30:00Z' }).waited === 30);

  battery('the L2 seat is the fallback: named by a hand-off or on its own delta, never on (b), (c), the label or the TIER_DEFAULT face');
  const WITH_REVIEW = [...SEATED, { lane: 'review', seat: 2, status: 'seated' }, { lane: 'review', seat: 1, status: 'seated' }];
  const rv = (o, seats = WITH_REVIEW) => owedReviewRow(pull(o), { now: NOW, seats });
  const LANE_TAKES = `the domain:ui seat (${LANE_OWN_NOTE})`;
  const oneRound = '2026-10-28T11:59:00Z';
  const twoRounds = '2026-10-28T10:59:00Z';
  const DECLARED = { files: ['packages/runtime/src/x.ts'], body: 'Clause-②: yes\nMetadata-protocol: added' };
  const signed = (head, sig, id = 6911000001, verdict = 'FAIL') => ({ ...recordRow(head, verdict, id), body: `${sig}\n\n${recordRow(head, verdict, id).body}` });
  const MICKEY = `review#1 · os-mickey · ${REVIEWER}`;
  t('⭐ the roster reads the L2 seats: the seated ones named canonically and sorted; stood-down; absent; unknown when the roster was not read; a post with no number is seat 1', (() => { const s = reviewSeatsOf(WITH_REVIEW); return s.state === 'seated' && s.seated.join() === 'review#1,review#2' && reviewSeatsOf([...SEATED, { lane: 'review', seat: 1, status: 'paused' }]).state === 'stood-down' && reviewSeatsOf(SEATED).state === 'absent' && reviewSeatsOf(SEATED).seated.length === 0 && reviewSeatsOf(null).state === 'unknown' && reviewSeatsOf([{ lane: 'review', status: 'seated' }]).seated.join() === 'review#1'; })());
  t('⭐ both spellings of the L2 lane word read — `l2-review` (new seats) and `review` (seats seated under the old word) — each seat named by the word its own post spells; a hand-off to the new word names it; a word that is neither is no L2 seat', (() => { const MIXED = [...SEATED, { lane: 'review', seat: 1, status: 'seated' }, { lane: 'l2-review', seat: 2, status: 'seated' }]; const s = reviewSeatsOf(MIXED); const r = rv({ headCommittedAt: fresh, comments: [handoff(HEAD, '2026-10-28T12:40:00Z', 'l2-review#2')] }, MIXED); return s.state === 'seated' && s.seated.join() === 'l2-review#2,review#1' && r.status === 'TAKE' && r.taker === 'l2-review#2' && reviewSeatsOf([...SEATED, { lane: 'l2', seat: 1, status: 'seated' }, { lane: 'reviews', seat: 1, status: 'seated' }]).state === 'absent'; })());
  t('⭐ (a) the waiting label with L2 seats seated ⇒ the LANE seat takes — the label names no seat; the same head with a hand-off naming review#1 ⇒ review#1', (() => { const r = rv({ headCommittedAt: fresh, labels: [{ name: WAITING_LABEL }] }); const h = rv({ headCommittedAt: fresh, labels: [{ name: WAITING_LABEL }], comments: [handoff(HEAD, '2026-10-28T12:40:00Z')] }); return r.status === 'TAKE' && r.reviewSeat === 'seated' && r.reviewSeats.join() === 'review#1,review#2' && r.taker === LANE_TAKES && h.taker === 'review#1'; })());
  t('⭐ (b) one round or two rounds waited with L2 seats seated ⇒ the LANE seat, the L2 seat never named; with a hand-off on the head ⇒ the seat it names', rv({ headCommittedAt: oneRound }).taker === LANE_TAKES && rv({ headCommittedAt: twoRounds }).taker === LANE_TAKES && !/review#/.test(rv({ headCommittedAt: twoRounds }).taker) && rv({ headCommittedAt: twoRounds, comments: [handoff(HEAD, '2026-10-28T12:40:00Z', 'review#2')] }).taker === 'review#2');
  t('⭐ no L2 seat seated ⇒ the lane\'s own seat takes, at (b) and after — never triage', (() => { const r = rv({ headCommittedAt: twoRounds }, SEATED); return r.status === 'TAKE' && r.reviewSeat === 'absent' && r.taker === LANE_TAKES && !/triage/.test(renderRow(r)); })());
  t('an L2 seat that stood down is no L2 seat: the lane seat takes, and the row says stood-down', (() => { const r = rv({ headCommittedAt: fresh, labels: [{ name: WAITING_LABEL }] }, [...SEATED, { lane: 'review', seat: 1, status: 'paused' }]); return r.reviewSeat === 'stood-down' && r.taker === LANE_TAKES; })());
  t('⭐ (c) the lane seat gone, an L2 seat seated ⇒ the lane\'s NEXT seat, never the L2 seat; none seated ⇒ the same', rv({ headCommittedAt: fresh }, [{ lane: 'review', status: 'seated' }]).taker === `the domain:ui seat next on duty (${LANE_OWN_NOTE})` && rv({ headCommittedAt: fresh }, [{ lane: 'domain:skills', status: 'seated' }]).taker === `the domain:ui seat next on duty (${LANE_OWN_NOTE})`);
  t('the roster unread ⇒ the lane seat, and the row says unknown', (() => { const r = rv({ headCommittedAt: oneRound }, null); return r.reviewSeat === 'unknown' && r.taker === LANE_TAKES; })());
  t('a hand-off names its seat whatever the roster says — a sibling lane seat under a seated L2 seat included', rv({ headCommittedAt: fresh, comments: [handoff(HEAD, '2026-10-28T12:40:00Z', 'domain:ui#2')] }).taker === 'domain:ui#2' && rv({ headCommittedAt: fresh, comments: [handoff(HEAD, '2026-10-28T12:40:00Z')] }, SEATED).taker === 'review#1');
  t('⭐ a live claim by an L2 seat ⇒ HELD on the review side, no taker, nobody else starts', (() => { const r = rv({ labels: [{ name: WAITING_LABEL }], comments: [claimRow(REVIEWER, HEAD, '2026-10-28T12:18:56Z', `review#1 · os-zhuang · ${REVIEWER}`)] }); return r.status === 'HELD' && r.claim.holder.side === 'review' && r.taker === null && renderRow(r).includes('(review,'); })());
  t('⭐ the TIER_DEFAULT face (the `Clause-②: yes` line alone) never names an L2 seat: a hand-off naming review#1 ⇒ the lane seat, saying why; the same hand-off on the rules face ⇒ review#1', (() => { const d = rv({ ...DECLARED, headCommittedAt: fresh, comments: [handoff(HEAD, '2026-10-28T12:40:00Z')] }); const g = rv({ headCommittedAt: fresh, comments: [handoff(HEAD, '2026-10-28T12:40:00Z')] }); return d.status === 'TAKE' && d.face.join() === 'declaration' && d.tierName === 'TIER_DEFAULT' && d.taker === `the domain:ui seat (${TIER_DEFAULT_FACE_NOTE})` && g.taker === 'review#1'; })());
  t('the TIER_DEFAULT face: a hand-off to a SIBLING lane seat still names it; its own delta and (b) name the lane; the face is read off the limbs — the label beside it keeps it, a schema or governed path beside it ends it', rv({ ...DECLARED, headCommittedAt: fresh, comments: [handoff(HEAD, '2026-10-28T12:40:00Z', 'domain:ui#2')] }).taker === 'domain:ui#2' && rv({ ...DECLARED, comments: [signed(HEAD2, MICKEY)] }).taker === `the domain:ui seat (${TIER_DEFAULT_FACE_NOTE})` && rv({ ...DECLARED, headCommittedAt: oneRound }).taker === `the domain:ui seat (${TIER_DEFAULT_FACE_NOTE})` && [['declaration'], ['declaration', 'label'], ['rules', 'declaration'], ['schema', 'declaration'], ['label'], [], null].map(declarationFaceOnly).join() === 'true,true,false,false,false,false,false');
  t('⭐ the delta of its OWN record: a record on an earlier head signed by a seated L2 seat ⇒ that seat takes the head; with no record on an earlier head the same row ⇒ the lane', (() => { const r = rv({ comments: [signed(HEAD2, MICKEY)] }); return r.status === 'TAKE' && r.record.state === 'stale' && r.record.seat === 'review#1' && r.taker === 'review#1 (the delta of its own record 6911000001)' && rv({}).taker === LANE_TAKES; })());
  t('⛔ not its own delta ⇒ the lane: the signer stood down or is not seated, the record signed by a lane seat, or carrying no signature; the signer read off the first line, a signature the reader refuses naming nobody', rv({ comments: [signed(HEAD2, MICKEY)] }, [...SEATED, { lane: 'review', seat: 1, status: 'paused' }, { lane: 'review', seat: 2, status: 'seated' }]).taker === LANE_TAKES && rv({ comments: [signed(HEAD2, `domain:ui#1 · os-bill · ${LANE}`)] }).taker === LANE_TAKES && rv({ comments: [recordRow(HEAD2, 'FAIL', 11)] }).taker === LANE_TAKES && signerSeatOf(signed(HEAD2, `review#2 · os-mickey · ${REVIEWER}`).body) === 'review#2' && signerSeatOf(signed(HEAD2, `Review#2 · os-mickey · ${REVIEWER}`).body) === null && signerSeatOf(recordRow(HEAD).body) === null);
  t('a record on THIS head is DONE — no taker at all, the signer\'s or anyone\'s', (() => { const r = rv({ comments: [signed(HEAD, MICKEY)] }); return r.status === 'DONE' && r.taker === null && r.record.seat === 'review#1'; })());
  const ATTR = '<!-- claude-projects-attribution: {"github_login":"OS-Support-AI"} -->\n_Requested by **Y**_\n\nPart of #25922\n\nClause-②: no\nMetadata-protocol: none';
  const CLAIMED = [{ id: 7, created_at: '2026-10-28T09:00:00Z', body: 'domain:skills#3 · os-zhuang · session_01Abcdefgh\n\nClaim: PM loop round 1 · 2026-10-28T09:00Z\nBranch: `claude/x`' }];
  // Ruling A on #33258 (6917060639): independence is per SESSION — an L2 seat on the PR's own implementing account (the
  // attribution login) and one on its dispatching account (the card claim's signer) are seated like any other.
  const OWN = [...SEATED, { lane: 'review', seat: 1, status: 'seated', account: 'os-support-ai' }, { lane: 'review', seat: 2, status: 'seated', account: 'OS-Zhuang' }];
  t('⭐ same account, different session ⇒ eligible: L2 seats on the PR\'s implementing and dispatching accounts are seated and named, nothing printed as barred, no note under the report; the label row stays the lane\'s, and the seat on the implementing account takes the delta of its own record', (() => { const r = rv({ body: ATTR, card: 25922, cardComments: CLAIMED, headCommittedAt: fresh, labels: [{ name: WAITING_LABEL }] }, OWN); const delta = rv({ body: ATTR, card: 25922, cardComments: CLAIMED, comments: [signed(HEAD2, MICKEY)] }, OWN); const report = renderReport([r, delta], { repo: DEFAULT_REPO, now: NOW, read: { pulls: 2, drafts: 0 }, gaps: [] }); return r.status === 'TAKE' && r.reviewSeat === 'seated' && r.reviewSeats.join() === 'review#1,review#2' && !('reviewBarred' in r) && r.taker === LANE_TAKES && delta.taker === 'review#1 (the delta of its own record 6911000001)' && !report.some((l) => /barred|area-lease|⚖️/.test(l)) && rv({ body: ATTR, headCommittedAt: fresh }, [{ lane: 'review', seat: 1, status: 'seated', account: 'os-support-ai' }]).taker === `the domain:ui seat next on duty (${LANE_OWN_NOTE})`; })());
  t('⛔ an unreadable card thread leaves the record unjudged, so no own delta names an L2 seat — the lane takes; the seats still read seated, never a state of their own', (() => { const delta = rv({ card: 25922, cardComments: null, comments: [signed(HEAD2, MICKEY)] }, OWN); return delta.record.state === 'unjudged' && delta.taker === LANE_TAKES && delta.reviewSeat === 'seated' && delta.reviewSeats.join() === 'review#1,review#2'; })());
  t('the printed row carries the L2-seat reading and the taker', renderRow(rv({ headCommittedAt: fresh, labels: [{ name: WAITING_LABEL }] })).includes(`L2 seat seated review#1,review#2 → (a) label · take: ${LANE_TAKES}`) && renderRow(rv({ headCommittedAt: fresh, labels: [{ name: WAITING_LABEL }] }, SEATED)).includes(`L2 seat absent → (a) label · take: ${LANE_TAKES}`));

  battery('a live claim holds the head and a record settles it; a lapsed claim holds nothing');
  t('⭐ a live claim on the current head ⇒ HELD, naming the holder — whatever trigger holds', (() => { const r = row({ labels: [{ name: WAITING_LABEL }], comments: [claimRow(TRIAGE, HEAD, '2026-10-28T12:18:56Z', `triage#1 · os-zhuang · ${TRIAGE}`)] }); return r.status === 'HELD' && r.claim.holder.session === TRIAGE && r.trigger === null; })());
  t('⭐ a legacy `triage#N`-signed claim yields: triage first (posted before triage stopped reviewing), lane later ⇒ the lane holds', (() => { const r = row({ comments: [claimRow(TRIAGE, HEAD, '2026-10-28T12:18:56Z', `triage#1 · os-zhuang · ${TRIAGE}`), { ...claimRow(LANE, HEAD, '2026-10-28T12:20:00Z', `domain:ui#1 · os-bill · ${LANE}`), id: 2 }] }); return r.status === 'HELD' && r.claim.holder.session === LANE && r.claim.tie === true; })());
  t('⭐ two live claims ⇒ the EARLIEST holds, no tie: an L2 seat first, the lane later ⇒ the L2 seat holds, and the row prints no tie', (() => { const r = row({ comments: [claimRow(REVIEWER, HEAD, '2026-10-28T12:18:56Z', `review#1 · os-zhuang · ${REVIEWER}`), { ...claimRow(LANE, HEAD, '2026-10-28T12:20:00Z', `domain:ui#1 · os-bill · ${LANE}`), id: 2 }] }); return r.status === 'HELD' && r.claim.holder.session === REVIEWER && r.claim.tie === false && !renderRow(r).includes('yields'); })());
  t('a record on the head settles it even beside a live claim ⇒ DONE', row({ comments: [claimRow(TRIAGE, HEAD, '2026-10-28T12:18:56Z', `triage#1 · os-zhuang · ${TRIAGE}`), recordRow(HEAD)] }).status === 'DONE');
  t('⛔ a claim two hours old with no record holds nothing ⇒ the trigger reads again', (() => { const r = row({ comments: [claimRow(TRIAGE, HEAD, '2026-10-28T10:30:00Z', `triage#1 · os-zhuang · ${TRIAGE}`)] }); return r.claim.state === 'lapsed' && r.status === 'TAKE'; })());
  t('⛔ a claim on an earlier head holds nothing — the head moved', row({ comments: [claimRow(TRIAGE, HEAD2, '2026-10-28T12:50:00Z', `triage#1 · os-zhuang · ${TRIAGE}`)] }).claim.state === 'none');

  battery('the live instance: two Tier H drafts with a hand-off on the current head list as TAKE under (a)');
  // Modelled on the two drafts that waited about five rounds: a root workflow step deleted (Tier H, draft,
  // hand-off on the current head since 07:43Z) and a published package retired as a narrowing (draft, its
  // first hand-off stale after a merge-forward, renewed at 12:13Z on the new head).
  const ci = pull({ number: 27136, comments: [handoff(HEAD, '2026-10-28T07:43:43Z')], labels: [{ name: WAITING_LABEL }] });
  const ai = pull({ number: 27042, head: { sha: HEAD2, ref: 'claude/project-thread-26wk5s' }, files: ['ui/packages/plugin-ai/package.json', 'pnpm-lock.yaml'], body: 'Clause-②: no (narrowing)\nMetadata-protocol: narrowed', headCommittedAt: '2026-10-28T07:34:00Z', labels: [{ name: WAITING_LABEL }], comments: [{ ...handoff('7040d92f78f504b1ef037d8451106c0be452f375', '2026-10-28T03:10:38Z'), id: 6459640213 }, { ...handoff(HEAD2, '2026-10-28T12:14:25Z'), id: 6468695894 }] });
  const live = owedReviewRows({ repo: DEFAULT_REPO, pulls: [ci, ai], seats: SEATED }, { now: Date.parse('2026-10-28T12:15:00Z') });
  t('⭐ both list, both TAKE, both under (a) by their hand-off line — drafts, the case the rebuilt scan skipped — each taken by the L2 seat the line names', live.length === 2 && live.every((r) => r.status === 'TAKE' && r.trigger === '(a) hand-off' && r.draft === true && r.taker === 'review#1'));
  t('the workflow draft owes on the rules face, the retirement on the narrowing face and the label', live.find((r) => r.pr === 27136).face.join('+') === 'rules+label' && live.find((r) => r.pr === 27042).face.join('+') === 'narrowing+label');
  t('the renewed hand-off governs: the newest line names the current head', live.find((r) => r.pr === 27042).handoff.id === 6468695894);
  t('once the L2 seat posts its claim, the row reads HELD, with no taker, and nobody else starts', (() => { const r = owedReviewRows({ repo: DEFAULT_REPO, pulls: [{ ...ci, comments: [...ci.comments, claimRow(REVIEWER, HEAD, '2026-10-28T12:18:56Z', `review#1 · os-zhuang · ${REVIEWER}`)] }], seats: SEATED }, { now: Date.parse('2026-10-28T12:20:00Z') })[0]; return r.status === 'HELD' && r.claim.holder.session === REVIEWER && r.taker === null; })());

  battery('the live read: every read through one reader; a failed read is INCOMPLETE, never clean');
  const paths = [];
  const fake = (routes) => (path) => {
    paths.push(path);
    // The LONGEST matching route answers, so a card's thread is never answered by the card itself.
    const key = Object.keys(routes).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (key === undefined) return { ok: false, error: `no route for ${path}` };
    return routes[key];
  };
  const owing = { number: 27136, draft: true, body: 'Part of #25922\nClause-②: no', head: { sha: HEAD, ref: 'x' }, labels: [] };
  const quiet = { number: 27200, draft: false, body: 'Fixes #27100\nClause-②: no', head: { sha: HEAD2, ref: 'claude/issue-27100-x' }, labels: [] };
  const routes = {
    '/repos/objectstack-ai/objectstack/pulls?': { ok: true, value: [owing, quiet] },
    '/repos/objectstack-ai/objectstack/issues?': { ok: true, value: [{ number: 1, title: '[PM seat] domain:ui — 🟢 os-bill', body: '' }] },
    '/repos/objectstack-ai/objectstack/pulls/27136/files': { ok: true, value: [{ filename: '.github/workflows/ci.yml' }] },
    '/repos/objectstack-ai/objectstack/pulls/27200/files': { ok: true, value: [{ filename: 'packages/runtime/src/x.ts' }] },
    '/repos/objectstack-ai/objectstack/issues/27136/comments': { ok: true, value: [handoff(HEAD, '2026-10-28T07:43:43Z')] },
    '/repos/objectstack-ai/objectstack/issues/25922': { ok: true, value: { labels: [{ name: 'domain:ui' }] } },
    '/repos/objectstack-ai/objectstack/issues/25922/comments': { ok: true, value: [] },
    '/repos/objectstack-ai/objectstack/commits/': { ok: true, value: { commit: { committer: { date: '2026-10-28T07:30:00Z' } } } },
  };
  const snap = readSnapshot({ repo: DEFAULT_REPO, board: DEFAULT_REPO, get: fake(routes) });
  t('the snapshot holds both pulls, the seat roster parsed, no gap', snap.pulls.length === 2 && snap.seats.length === 1 && snap.seats[0].lane === 'domain:ui' && snap.gaps.length === 0, JSON.stringify([snap.pulls.length, snap.seats, snap.gaps]));
  t('⭐ threads, card and commit are read ONLY for the pull that owes — the face is read first', paths.some((p) => p.startsWith('/repos/objectstack-ai/objectstack/issues/27136/comments')) && !paths.some((p) => p.startsWith('/repos/objectstack-ai/objectstack/issues/27200/comments')) && paths.some((p) => p.startsWith('/repos/objectstack-ai/objectstack/issues/25922/comments')));
  t('the card is the one the body delivers (`deliveredCardNumber`), and its lane label is read', snap.pulls[0].card === 25922 && snap.pulls[0].cardLabels.join() === 'domain:ui');
  const broken = readSnapshot({ repo: DEFAULT_REPO, board: DEFAULT_REPO, get: fake({ ...routes, '/repos/objectstack-ai/objectstack/issues/27136/comments': { ok: false, error: 'HTTP 502' } }) });
  t('⛔ a failed thread read is a GAP naming the PR and the read, and the record reads unjudged — never none', broken.gaps.some((g) => g.startsWith('#27136: comments')) && owedReviewRows(broken, { now: NOW })[0].record.state === 'unjudged');
  const noList = readSnapshot({ repo: DEFAULT_REPO, board: DEFAULT_REPO, get: fake({}) });
  t('⛔ a failed pull list is a gap and zero rows — never an empty board reported clean', noList.pulls.length === 0 && noList.gaps.length === 1 && renderReport([], { repo: DEFAULT_REPO, now: NOW, read: { pulls: 0, drafts: 0 }, gaps: noList.gaps }).some((l) => l.includes('sweep INCOMPLETE')));
  const noSeats = readSnapshot({ repo: DEFAULT_REPO, board: DEFAULT_REPO, get: fake({ ...routes, '/repos/objectstack-ai/objectstack/issues?': { ok: false, error: 'HTTP 403' } }) });
  t('an unread seat roster is a gap and judges no (c)', noSeats.seats === null && noSeats.gaps.some((g) => g.includes('trigger (c) and the L2 seats are not judged')));

  battery('the report: one line per owing PR, TAKE first, exit 0');
  const printed = [];
  const code = main(['--repo', DEFAULT_REPO, '--now', '2026-10-28T13:00:00Z'], { get: fake(routes), log: (l) => printed.push(l), error: (l) => printed.push(l) });
  t('⭐ exit 0, and the one owing PR prints as one TAKE line under (a)', code === EXIT_OK && printed.filter((l) => /^(TAKE|WAIT|HELD|DONE) {2}#/.test(l)).length === 1 && printed.some((l) => l.startsWith('TAKE  #27136 draft') && l.includes('→ (a) hand-off · take: review#1')) && !printed.some((l) => /take: [^·]*triage/.test(l)));
  t('the header counts what was read and what is owed', printed[0].includes('2 open PR(s) read (1 draft)') && printed[0].includes('1 owe a contract review — 1 to take'));
  t('rows sort TAKE, WAIT, HELD, DONE, then by number', owedReviewRows({ pulls: [pull({ number: 3, comments: [recordRow(HEAD)] }), pull({ number: 2, headCommittedAt: '2026-10-28T12:59:00Z' }), pull({ number: 1, labels: [{ name: WAITING_LABEL }] })], seats: SEATED }, { now: NOW }).map((r) => `${r.status}${r.pr}`).join() === 'TAKE1,WAIT2,DONE3');
  const jsonOut = [];
  t('--json prints the rows as one JSON document, still exit 0', main(['--repo', DEFAULT_REPO, '--json', '--now', '2026-10-28T13:00:00Z'], { get: fake(routes), log: (l) => jsonOut.push(l) }) === EXIT_OK && (() => { const doc = JSON.parse(jsonOut.join('\n')); return doc.rows[0].pr === 27136 && !('notes' in doc) && !('reviewBarred' in doc.rows[0]); })());
  t('a usage error exits 2 and prints the usage', main(['--bogus'], { get: fake({}), log: () => {}, error: () => {} }) === EXIT_USAGE);

  battery('the hold: a live hold on this head holds (b) alone, (a) and (c) still fire; a new head clears it; at 24 hours it is listed, still WAIT');
  // The lane's "not this head yet", posted as the lane posts it: signature, then the one line.
  const LANE_SIG = `domain:ui#1 · os-bill · ${LANE}`;
  const holdRow = (head, at, id = 6472451890) => ({ id, created_at: at, body: `${LANE_SIG}\n\nContract-review-hold: \`${LANE}\` · head \`${head}\` · the stack still lands under it · until the last sibling PR merges` });
  const ripe = '2026-10-28T11:59:00Z'; // committed 61 minutes before NOW: (b) holds when nothing holds it
  const heldAt = '2026-10-28T12:10:00Z';
  const held = row({ headCommittedAt: ripe, comments: [holdRow(HEAD, heldAt)] });
  t('⭐ a live hold on the current head holds (b): a full round waited, no record, no claim ⇒ WAIT, not TAKE — and with no hold the same row is TAKE under (b)', held.status === 'WAIT' && held.trigger === 'none yet' && held.hold.state === 'live' && held.hold.holds === '(b) waited 61 min' && row({ headCommittedAt: ripe }).status === 'TAKE' && row({ headCommittedAt: ripe }).trigger === '(b) waited 61 min', JSON.stringify(held.hold));
  t('the row prints the hold: who holds, the comment, its age, the (b) it holds and until what', renderRow(held).includes(`hold live ${LANE} (6472451890, 0 h old, holds (b) waited 61 min) until the last sibling PR merges`), renderRow(held));
  t('⛔ a hold on an EARLIER head holds nothing — the head moved, (b) fires ⇒ TAKE', (() => { const r = row({ headCommittedAt: ripe, comments: [holdRow(HEAD2, heldAt)] }); return r.hold.state === 'stale' && r.status === 'TAKE' && r.trigger === '(b) waited 61 min' && r.hold.holds === null; })());
  t('⭐ (a) still fires under a live hold — the label or a hand-off on this head is the holding lane ending its hold ⇒ TAKE', row({ headCommittedAt: ripe, labels: [{ name: WAITING_LABEL }], comments: [holdRow(HEAD, heldAt)] }).trigger === '(a) label' && row({ headCommittedAt: ripe, comments: [holdRow(HEAD, heldAt), handoff(HEAD, '2026-10-28T12:40:00Z')] }).trigger === '(a) hand-off');
  t('(c) still fires under a live hold — a lane seat that is gone holds nothing', row({ headCommittedAt: ripe, comments: [holdRow(HEAD, heldAt)] }, [{ lane: 'domain:ui', status: 'paused' }]).trigger === '(c) lane seat stood-down');
  t('⛔ an unreadable hold holds nothing ⇒ (b) fires, and the row names the hold comment as unreadable', (() => { const r = row({ headCommittedAt: ripe, comments: [{ id: 7701, created_at: heldAt, body: 'Contract-review-hold: soon' }] }); return r.hold.state === 'unreadable' && r.status === 'TAKE' && renderRow(r).includes('hold unreadable (7701)'); })());
  // A later comment quoting the template line at a line start (a round record, a seat note, a review) is unreadable.
  const quotedTemplate = { id: 7701, created_at: '2026-10-28T12:40:00Z', body: `triage#1 · os-zhuang · ${TRIAGE}\n\nRound record: lanes hold a head with\n- \`${CONTRACT_REVIEW_HOLD_TEMPLATE}\`` };
  const voided = row({ headCommittedAt: ripe, comments: [holdRow(HEAD, heldAt), quotedTemplate] });
  t('⭐ an unreadable hold line NEWER than a live hold on this head voids nothing — the row stays WAIT under the live hold and PRINTS the unreadable line by comment id; the control (no such line) is WAIT with no mark', voided.status === 'WAIT' && voided.trigger === 'none yet' && voided.hold.state === 'live' && voided.hold.id === 6472451890 && voided.hold.holds === '(b) waited 61 min' && voided.hold.unreadable.length === 1 && voided.hold.unreadable[0].id === 7701 && renderRow(voided).includes('until the last sibling PR merges ⚠️ 1 unreadable hold line(s) (7701)') && held.status === 'WAIT' && held.hold.unreadable.length === 0 && !renderRow(held).includes('unreadable'), renderRow(voided));
  t('a hold changes neither a live claim (HELD) nor a record on this head (DONE)', row({ headCommittedAt: ripe, comments: [holdRow(HEAD, heldAt), claimRow(TRIAGE, HEAD, '2026-10-28T12:18:56Z', `triage#1 · os-zhuang · ${TRIAGE}`)] }).status === 'HELD' && row({ headCommittedAt: ripe, comments: [holdRow(HEAD, heldAt), recordRow(HEAD)] }).status === 'DONE');
  const aged = row({ headCommittedAt: '2026-10-27T08:00:00Z', comments: [holdRow(HEAD, '2026-10-27T13:00:00Z')] });
  t('⭐ at 24 hours the hold reads overdue and STILL holds — the row stays WAIT, no fifth status — and the row is LISTED for the round record', aged.status === 'WAIT' && aged.hold.state === 'live' && aged.hold.overdue === true && aged.hold.listed === true && renderRow(aged).includes('⏳ HOLD 24 h old — list it in the triage round record'), renderRow(aged));
  const report = renderReport([aged], { repo: DEFAULT_REPO, now: NOW, read: { pulls: 1, drafts: 1 }, gaps: [] });
  t('⭐ the report lists it under the rows: the PR, the holder, when it was posted, its age and the condition', report.some((l) => l.startsWith('⏳ 1 hold(s) 24 h or older keep a PR waiting')) && report.includes(`  - #27136 held by ${LANE} since 2026-10-27T13:00:00Z (24 h old) until the last sibling PR merges`), report.join(' | '));
  t('under 24 hours nothing is listed; an overdue hold on a DONE or HELD row is not listed — nothing waits on it', held.hold.listed === false && !renderReport([held], { repo: DEFAULT_REPO, now: NOW, read: { pulls: 1, drafts: 1 }, gaps: [] }).some((l) => l.startsWith('⏳')) && row({ headCommittedAt: '2026-10-27T08:00:00Z', comments: [holdRow(HEAD, '2026-10-27T13:00:00Z'), recordRow(HEAD)] }).hold.listed === false && row({ headCommittedAt: '2026-10-27T08:00:00Z', comments: [holdRow(HEAD, '2026-10-27T13:00:00Z'), claimRow(TRIAGE, HEAD, '2026-10-28T12:18:56Z', `triage#1 · os-zhuang · ${TRIAGE}`)] }).hold.listed === false);
  t('⛔ a live hold whose age cannot be timed is LISTED as unknown, never dropped as young', (() => { const r = row({ headCommittedAt: ripe, comments: [{ id: 9, body: holdRow(HEAD, heldAt).body }] }); return r.status === 'WAIT' && r.hold.overdue === null && r.hold.listed === true && renderRow(r).includes('⏳ HOLD age unknown'); })());
  const holdJson = [];
  main(['--repo', DEFAULT_REPO, '--json', '--now', '2026-10-28T13:00:00Z'], { get: fake({ ...routes, '/repos/objectstack-ai/objectstack/issues/27136/comments': { ok: true, value: [holdRow(HEAD, '2026-10-27T13:00:00Z')] } }), log: (l) => holdJson.push(l) });
  t('--json carries the hold on the row, live and listed, through the one live reader — the status still one of the four', (() => { const r = JSON.parse(holdJson.join('\n')).rows[0]; return r.pr === 27136 && r.status === 'WAIT' && r.hold.state === 'live' && r.hold.listed === true && r.hold.session === LANE && STATUS_ORDER.includes(r.status); })());
  t('⛔ the status vocabulary stays exactly four, in order — a hold is the lane\'s own WAIT', STATUS_ORDER.join() === 'TAKE,WAIT,HELD,DONE');

  // Floor: the opened set equals the declared set, each battery at or above its pin.
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) cases.push({ name: `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`, ok: false });
  for (const [name, n] of seen) if (!declared.includes(name)) cases.push({ name: `battery "${name}" registered ${n} case(s) but is not declared`, ok: false });
  for (const name of declared) {
    const n = seen.get(name) ?? 0;
    if (n < SELF_TEST_BATTERIES[name]) cases.push({ name: `battery "${name}" registered ${n} case(s), below its floor of ${SELF_TEST_BATTERIES[name]} — cases stopped running`, ok: false });
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length > 0) {
    console.error(`✗ check-owed-reviews self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-owed-reviews self-test: ${cases.length} cases pass in ${declared.length} batteries (the owed face from paths, `
      + 'the Clause-② line and the label, drafts included; the record on this head, an earlier head, none, unjudged, read by the queue guard\'s author binding with its verdict lines counted; '
      + 'the (a) / (b) / (c) triggers and the taker — the seat a hand-off names, an L2 seat on the delta of its own record, else the lane seat, never triage; claims holding and lapsing, the earliest live claim holding; the two live drafts as TAKE; '
      + 'every read through one reader with failures as gaps; the report, exit 0; a lane\'s live hold holding (b) alone, '
      + 'cleared by a new head, an unreadable hold line voiding nothing and printed, listed at 24 hours and still WAIT).',
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--self-test') {
    let code;
    try {
      code = selfTest();
    } catch (error) {
      console.error(`\n✗ check-owed-reviews self-test threw: ${String(error?.stack ?? error)}\n`);
      process.exit(1);
    }
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-owed-reviews self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  }
  process.exit(main(argv));
}
