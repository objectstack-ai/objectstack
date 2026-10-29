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
 * 〈复核归属与资格〉) says the lane reviews its own pull requests and the triage
 * seat takes a contract review only when nobody is doing it; the triage duties
 * run this list first in their review step. Before it existed the list was a
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
 *   record     `current` (a record on this head — PASS / FAIL as the record's
 *              VERDICT line states it, and by whom), `stale` (the newest record
 *              names an earlier head: the delta re-review stays with that
 *              reviewer), `none`, or `unjudged` (the read could not be made).
 *   hand-off   the newest `Contract-review-handoff:` line, as `contractReviewHandoff`
 *              reads it: `triage` (it names the current head), `stale`, `absent`,
 *              `unreadable`.
 *   claim      the `Contract-review-claim:` lines: `live` (who holds the head,
 *              the lane winning a tie), `lapsed`, `none`.
 *   hold       the newest `Contract-review-hold:` line, as `contractReviewHold`
 *              reads it: `live` (it names the current head: trigger (b) does not
 *              fire, and its age is printed), `stale` (the head moved: cleared),
 *              `absent`, `unreadable` (it holds nothing). A live hold at
 *              `CONTRACT_REVIEW_HOLD_LIST_HOURS` or older on a WAIT row is LISTED,
 *              for the triage round record — the age is a reading, never a lapse.
 *   lane seat  the lane of the PR's card (`domain:*`) against the open seat
 *              posts: `seated`, `stood-down`, `absent`, `unknown`.
 *   status     `TAKE` (owed, nobody on it, a trigger holds), `WAIT` (owed,
 *              nobody on it, no trigger yet — the lane's own, a lane's live hold
 *              included), `HELD` (a live claim on this head), `DONE` (a record on
 *              this head). Four, ⛔ no fifth for a hold: a held head is the lane's
 *              own wait, and a `HOLD` beside `HELD` is one letter from a misread.
 *   trigger    the first that holds: (a) a hand-off line naming the current
 *              head, or the waiting label — taken the same round; (b) the head
 *              has waited a full triage round (`TRIAGE_ROUND_MINUTES`) and no
 *              live hold names it; (c) the lane's seat has stood down or is
 *              absent from the seat roster. A live hold holds (b) alone: the
 *              lane that holds ends it with (a), and a lane gone is (c).
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
import { CONTRACT_REVIEW_HEADING_MARKER, latestMarkedComment } from './check-half-states.mjs';
import { repoIdForSlug } from './check-governed-merges.mjs';
import { readClause2Line } from './clause2-line.mjs';
import { parseSeat } from './fleet-roster.mjs';
import { ghApi, readAllPages } from './gh-pages.mjs';
import {
  CONTRACT_REVIEW_HOLD_LIST_HOURS,
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
/** The waiting label the dispatching seat hangs at ACCEPT (`references/contract-review.md` 〈等复核标记〉). */
export const WAITING_LABEL = 'needs:contract-review';
/** One full triage round — the rule's 「一轮分诊(约 60 分钟)」, trigger (b). */
export const TRIAGE_ROUND_MINUTES = 60;
/** The seat posts' label (`seat-post-protocol.md`); `parseSeat` reads each one. */
export const SEAT_LABEL = 'pm:seat';

const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const VERDICT_LINE = /^[ \t>]*(?:\*\*)?VERDICT:[ \t]*(PASS|FAIL)\b/im;
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

/** PASS / FAIL as the record's own `VERDICT:` line states it — a display, never a judgment. Pure. */
export function verdictOf(body) {
  return VERDICT_LINE.exec(String(body ?? ''))?.[1] ?? 'unstated';
}

/**
 * The record on this head, or the newest one on another head, or none. Pure
 * over the threads. `locateReviewOfRecord` decides "on this head" — the queue
 * guard's own reading; it is handed no git reader, so a `Regen-provenance:`
 * carry is `unjudged` here rather than guessed.
 */
export function recordReading(pull) {
  const pair = {
    pr: pull.number,
    card: pull.card ?? null,
    headSha: pull.head?.sha ?? null,
    prComments: pull.comments,
    cardComments: pull.card === null || pull.card === undefined ? [] : pull.cardComments,
  };
  const located = locateReviewOfRecord(pair);
  if (located.state === 'unreadable') return { state: 'unjudged', gaps: located.gaps };
  const rows = [...(Array.isArray(pair.prComments) ? pair.prComments : []), ...(Array.isArray(pair.cardComments) ? pair.cardComments : [])];
  if (located.state === 'found' || located.state === 'unsigned') {
    const row = rows.find((r) => (r?.id ?? null) === located.id) ?? null;
    return { state: 'current', id: located.id, where: located.where, by: reviewedByOf(row?.body), verdict: verdictOf(row?.body), signed: located.state === 'found' };
  }
  const newest = latestMarkedComment(rows, CONTRACT_REVIEW_HEADING_MARKER);
  if (!newest) return { state: 'none' };
  const row = rows[newest.index];
  return { state: 'stale', id: row?.id ?? null, by: reviewedByOf(row?.body), verdict: verdictOf(row?.body) };
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
  const triggers = [];
  if (handoff.state === 'triage') triggers.push('(a) hand-off');
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
    handoff: { state: handoff.state, id: handoff.id ?? null },
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
    },
    lane: lane.lane,
    laneSeat: lane.seat,
    status,
    trigger: status === 'TAKE' || status === 'WAIT' ? (triggers[0] ?? 'none yet') : null,
    gaps: Array.isArray(pull.gaps) ? pull.gaps : [],
  };
}

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
  const holder = row.claim.holder;
  const claim = holder === null
    ? row.claim.state
    : `live ${holder.session} (${holder.side}${row.claim.tie ? ', lane wins the tie' : ''}, ${holder.id}, ${holder.time})`;
  const parts = [
    `${row.status}  #${row.pr} ${row.draft ? 'draft' : 'ready'}`,
    `face ${row.face.join('+')}`,
    `head ${short(row.head)} (${row.waited === null ? '? min' : `${row.waited} min`})`,
    `record ${record}`,
    `hand-off ${row.handoff.state}${row.handoff.id === null ? '' : ` (${row.handoff.id})`}`,
    `claim ${claim}`,
    `hold ${holdText(row.hold)}`,
    `lane ${row.lane ?? '?'} ${row.laneSeat}`,
  ];
  const tail = row.trigger === null ? '' : ` → ${row.trigger}`;
  const listed = row.hold.listed ? `  ⏳ HOLD ${holdAge(row.hold)} — list it in the triage round record` : '';
  const gaps = row.gaps.length > 0 ? `  ⚠️ UNREAD: ${row.gaps.join('; ')}` : '';
  return `${parts.join(' · ')}${tail}${listed}${gaps}`;
}

/** The hold's age as printed: hours, or that it could not be timed. Pure. */
function holdAge(hold) {
  return hold.ageMinutes === null ? 'age unknown' : `${Math.floor(hold.ageMinutes / 60)} h old`;
}

/** The hold part of a row: who holds, since when, until what, and the (b) it holds. Pure. */
function holdText(hold) {
  if (hold.state === 'live') {
    const holds = hold.holds === null ? '' : `, holds ${hold.holds}`;
    return `live ${hold.session} (${hold.id}, ${holdAge(hold)}${holds}) until ${hold.until}`;
  }
  if (hold.state === 'stale' || hold.state === 'unreadable') return `${hold.state}${hold.id === null ? '' : ` (${hold.id})`}`;
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
  lines.push('', 'Report-only: exit 0, nothing written. The rule is `references/contract-review.md` 〈复核归属与资格〉.');
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
  if (!seatsRead.ok) gaps.push(`the seat posts on ${board} (${seatsRead.error}) — trigger (c) is not judged`);
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
  '  hand-off and claim on the current head and the trigger that lets the triage seat take it.',
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
  'the record: on this head (by whom, as stated), on an earlier head, none, unjudged': 6,
  'the triggers: (a) hand-off or label the same round, (b) a full round, (c) the lane seat': 8,
  'a live claim holds the head and a record settles it; a lapsed claim holds nothing': 5,
  'the live instance: two Tier H drafts with a hand-off on the current head list as TAKE under (a)': 4,
  'the live read: every read through one reader; a failed read is INCOMPLETE, never clean': 6,
  'the report: one line per owing PR, TAKE first, exit 0': 5,
  'the hold: a live hold on this head holds (b) alone, (a) and (c) still fire; a new head clears it; at 24 hours it is listed, still WAIT': 13,
});
const SELF_TEST_BATTERY_FLOOR = 9;
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
  const handoff = (head, at) => ({ id: 6463525633, created_at: at, body: `## Seat note · contract review owed\n\nContract-review-handoff: triage — CONTRACT_REVIEW_TIER unavailable (ceiling model out for the fleet since 2026-10-27, seat runs at TIER_DEFAULT, ${at.slice(0, 16)}Z) · head \`${head}\`` });
  const claimRow = (session, head, at, sig) => ({ id: 6468788431, created_at: at, body: `${sig}\n\nContract-review-claim: \`${session}\` · head \`${head}\` · ${at.slice(0, 16)}Z\n\nTaking the review.` });
  const recordRow = (head, verdict = 'PASS', id = 6469007202) => ({ id, created_at: '2026-10-28T12:29:43Z', body: `## Contract review\n\nServed-tier: \`CONTRACT_REVIEW_TIER\`\nHead-sha: \`${head}\`\nLocal-runs: none\n\nReviewed-by: \`${TRIAGE}\`\n\n**VERDICT: ${verdict}**` });
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

  battery('the triggers: (a) hand-off or label the same round, (b) a full round, (c) the lane seat');
  const fresh = '2026-10-28T12:30:00Z';
  t('⭐ (a) a hand-off naming the current head ⇒ TAKE the same round, even 30 minutes in', (() => { const r = row({ headCommittedAt: fresh, comments: [handoff(HEAD, '2026-10-28T12:40:00Z')] }); return r.status === 'TAKE' && r.trigger === '(a) hand-off' && r.handoff.state === 'triage'; })());
  t('⭐ (a) the waiting label ⇒ TAKE the same round', (() => { const r = row({ headCommittedAt: fresh, labels: [{ name: WAITING_LABEL }] }); return r.status === 'TAKE' && r.trigger === '(a) label'; })());
  t('a hand-off on an EARLIER head is no (a) — stale', (() => { const r = row({ headCommittedAt: fresh, comments: [handoff(HEAD2, '2026-10-28T12:40:00Z')] }); return r.handoff.state === 'stale' && r.status === 'WAIT'; })());
  t('⭐ (b) the head has waited a full triage round with no record and no claim ⇒ TAKE', (() => { const r = row({ headCommittedAt: '2026-10-28T11:59:00Z' }); return r.status === 'TAKE' && r.trigger === '(b) waited 61 min'; })());
  t('under a full round, nothing else holding ⇒ WAIT (the lane\'s own), trigger none yet', (() => { const r = row({ headCommittedAt: '2026-10-28T12:01:00Z' }); return r.status === 'WAIT' && r.trigger === 'none yet' && r.waited === 59; })());
  t('⭐ (c) the lane seat stood down, or absent from the roster ⇒ TAKE', row({ headCommittedAt: fresh }, [{ lane: 'domain:ui', status: 'paused' }]).trigger === '(c) lane seat stood-down' && row({ headCommittedAt: fresh }, [{ lane: 'domain:skills', status: 'seated' }]).trigger === '(c) lane seat absent');
  t('an unread roster or a card with no lane judges no (c)', row({ headCommittedAt: fresh }, null).laneSeat === 'unknown' && row({ headCommittedAt: fresh, cardLabels: [] }).laneSeat === 'unknown');
  t('an unknown commit time judges no (b); a PR opened after its head commit waits from its opening', row({ headCommittedAt: null }).waited === null && row({ headCommittedAt: null }).status === 'WAIT' && row({ headCommittedAt: '2026-10-28T07:30:00Z', created_at: '2026-10-28T12:30:00Z' }).waited === 30);

  battery('a live claim holds the head and a record settles it; a lapsed claim holds nothing');
  t('⭐ a live claim on the current head ⇒ HELD, naming the holder — whatever trigger holds', (() => { const r = row({ labels: [{ name: WAITING_LABEL }], comments: [claimRow(TRIAGE, HEAD, '2026-10-28T12:18:56Z', `triage#1 · os-zhuang · ${TRIAGE}`)] }); return r.status === 'HELD' && r.claim.holder.session === TRIAGE && r.trigger === null; })());
  t('⭐ the lane wins a tie: triage first, lane later ⇒ the lane holds', (() => { const r = row({ comments: [claimRow(TRIAGE, HEAD, '2026-10-28T12:18:56Z', `triage#1 · os-zhuang · ${TRIAGE}`), { ...claimRow(LANE, HEAD, '2026-10-28T12:20:00Z', `domain:ui#1 · os-bill · ${LANE}`), id: 2 }] }); return r.status === 'HELD' && r.claim.holder.session === LANE && r.claim.tie === true; })());
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
  t('⭐ both list, both TAKE, both under (a) by their hand-off line — drafts, the case the rebuilt scan skipped', live.length === 2 && live.every((r) => r.status === 'TAKE' && r.trigger === '(a) hand-off' && r.draft === true));
  t('the workflow draft owes on the rules face, the retirement on the narrowing face and the label', live.find((r) => r.pr === 27136).face.join('+') === 'rules+label' && live.find((r) => r.pr === 27042).face.join('+') === 'narrowing+label');
  t('the renewed hand-off governs: the newest line names the current head', live.find((r) => r.pr === 27042).handoff.id === 6468695894);
  t('once the triage seat posts its claim, both read HELD and nobody else starts', owedReviewRows({ repo: DEFAULT_REPO, pulls: [{ ...ci, comments: [...ci.comments, claimRow(TRIAGE, HEAD, '2026-10-28T12:18:56Z', `triage#1 · os-zhuang · ${TRIAGE}`)] }], seats: SEATED }, { now: Date.parse('2026-10-28T12:20:00Z') })[0].status === 'HELD');

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
  t('an unread seat roster is a gap and judges no (c)', noSeats.seats === null && noSeats.gaps.some((g) => g.includes('trigger (c) is not judged')));

  battery('the report: one line per owing PR, TAKE first, exit 0');
  const printed = [];
  const code = main(['--repo', DEFAULT_REPO, '--now', '2026-10-28T13:00:00Z'], { get: fake(routes), log: (l) => printed.push(l), error: (l) => printed.push(l) });
  t('⭐ exit 0, and the one owing PR prints as one TAKE line under (a)', code === EXIT_OK && printed.filter((l) => /^(TAKE|WAIT|HELD|DONE) {2}#/.test(l)).length === 1 && printed.some((l) => l.startsWith('TAKE  #27136 draft') && l.includes('→ (a) hand-off')));
  t('the header counts what was read and what is owed', printed[0].includes('2 open PR(s) read (1 draft)') && printed[0].includes('1 owe a contract review — 1 to take'));
  t('rows sort TAKE, WAIT, HELD, DONE, then by number', owedReviewRows({ pulls: [pull({ number: 3, comments: [recordRow(HEAD)] }), pull({ number: 2, headCommittedAt: '2026-10-28T12:59:00Z' }), pull({ number: 1, labels: [{ name: WAITING_LABEL }] })], seats: SEATED }, { now: NOW }).map((r) => `${r.status}${r.pr}`).join() === 'TAKE1,WAIT2,DONE3');
  const jsonOut = [];
  t('--json prints the rows as one JSON document, still exit 0', main(['--repo', DEFAULT_REPO, '--json', '--now', '2026-10-28T13:00:00Z'], { get: fake(routes), log: (l) => jsonOut.push(l) }) === EXIT_OK && JSON.parse(jsonOut.join('\n')).rows[0].pr === 27136);
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
      + 'the Clause-② line and the label, drafts included; the record on this head, an earlier head, none, unjudged; '
      + 'the (a) / (b) / (c) triggers; claims holding and lapsing, the lane winning a tie; the two live drafts as TAKE; '
      + 'every read through one reader with failures as gaps; the report, exit 0; a lane\'s live hold holding (b) alone, '
      + 'cleared by a new head, listed at 24 hours and still WAIT).',
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
