#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-handover — the pre-handover check: a departing seat session may write its `⏳ vacant` body only when
 * this exits 0 (#23396, ruling 6162084315, letter A).
 *
 *   node scripts/pm/check-handover.mjs --session=session_01… --account=LOGIN [--since=ISO] [--repo=OWNER/NAME]
 *                                      [--stay-behind=#N[,#N…] --body-file=PATH]
 *   node scripts/pm/check-handover.mjs --probe        # can the live read run HERE? (no board read)
 *   node scripts/pm/check-handover.mjs --self-test    # offline, no network, no token
 *
 * ## What it refuses, and the exact strings each predicate keys on
 *
 * The handover checklist (`.claude/skills/pm-dispatch/references/seat-post-protocol.md`, 交接收尾清单) gained
 * three steps on that ruling; two of them are mechanical, and these are their readings on the LIVE board:
 *
 *   (a) CLAIM UNRELEASED  an OPEN issue labelled `pm:dispatched`, whose assignees include `--account`, whose
 *                         NEWEST `Claim:` comment (`CLAIM_COMMENT_MARKER`, read through `markerMatches`) carries
 *                         `--session`, and after which no `Release:` comment (`RELEASE_COMMENT_MARKER`) carrying
 *                         `--session` was written. The release is an explicit act — `Release:` line plus the
 *                         assignee cleared in one write (`state-machine.md`, 释放者) — and a card the departing
 *                         session still holds this way is the measured half-state: the devx seat clocked out
 *                         with #23193 at `pm:dispatched`, its own assignee on it, and no `Release:`.
 *   (b) DECISION NOT IN   an OPEN issue on which the departing session's LATEST comment authored by
 *       THE INBOX         `objectstack-fleet[bot]` and carrying `--session` contains the four-facet marker
 *                         (`DECISION_FACET_MARKER`, `os-decision-facets`, read by `hasDecisionFacetMarker` over
 *                         the comment with its code blanked — `stripMarkdownCode` — so the plain line and its
 *                         HTML-comment form both read while a QUOTATION in code does not), with no ruling comment (`check-prior-rulings.mjs`'s `classifyRulingComment`)
 *                         newer than it, and whose state labels (`PM_EXCLUSIVE_STATE_LABELS`, the six
 *                         mutually exclusive states of `SKILL.md`) are anything but `needs-user-decision` alone.
 *
 * The sign-off hand-back rule (`seat-post-protocol.md`, 收班) names one refusal inside (a) and narrows (a)'s
 * stay-behind (section below):
 *
 *   (a′) NEEDS_DECISION   a card (a) holds whose NEWEST `os-dev-report` (`latestDevReport`, the patrol's newest-of
 *        HELD             reading) is newer than the claim and declares `"status": "needs_decision"`, while the card
 *                         is not `needs-user-decision`. Refused under its own name because its remedy differs: a
 *                         card whose dev asked a question is handed to the decision box, ⛔ never back to `pm:queue`,
 *                         where the question reaches no maintainer — the measured shape left such a card
 *                         `pm:dispatched` under a seat that had gone home.
 *
 * Two readings in those definitions go past the order's literal spelling, and both are why the check can be
 * passed by a seat that did everything right:
 *
 *   - (a) is scoped by the CLAIM, not by the assignee alone. Accounts are shared across seats, so a card at
 *     `pm:dispatched` under the departing account may be held by ANOTHER live session under the same login; the
 *     identity record is the `Claim:` comment (AGENTS.md, the claim rule), so "the departing session holds it"
 *     is read there. A card under the account whose newest claim names another session is LISTED, not refused;
 *     so is one with no claim at all (H2's half-state, which this check cannot attribute).
 *   - (b) declines a card whose ruling was recorded after the analysis. The director records `Ruling:` on the
 *     card and moves its state; the departing seat's analysis is then still its latest comment there, and the
 *     literal predicate would refuse every handover that followed a ruling made the ordinary way.
 *
 * ## What it reads, and the coverage it states
 *
 *   (a) every open `pm:dispatched` card (`pmLabelListingPath`, paged to exhaustion under the patrol's own
 *       `OPEN_LISTING_PAGE_CEILING`) and, for each one assigned to `--account`, its whole comment thread.
 *   (b) the repository's comment stream (`GET /repos/{repo}/issues/comments?since=…`) from `--since` (default:
 *       the last `DEFAULT_WINDOW_HOURS` hours), and for each card whose latest session comment carries the
 *       marker, the card itself. A session comment older than the window is UNREAD, and the verdict says so;
 *       pass `--since` at the seating time the seat post registers to cover a longer shift.
 *   (c) only when a held card is declared a stay-behind: the board's open pulls (one paged listing), then each pull
 *       that delivers such a card — its comment thread, and its timeline only when its labels and `auto_merge` did
 *       not already answer.
 *
 * A listing the ceiling bound, or a read that failed mid-run, is NOT a clean board (#4690): exit 4, never 0.
 *
 * ## Why a sibling and not a mode of `check-half-states.mjs`
 *
 * The ruling allows either. That file is REPORT-ONLY by its own header contract — "the workflow never fails a
 * build over findings" — and this one is a refusal whose whole point is a non-zero exit on a finding; a mode
 * flipping that contract inside a 35k-line patrol would be a second contract in one file. So the readers are
 * IMPORTED from it (and the ruling classifier from `check-prior-rulings.mjs`), ⛔ never restated here, and the
 * self-test pins that.
 *
 * ## Local, by ruling
 *
 * "Two local scripts, no CI time": no workflow runs this, and its `--self-test` is the author's and reviewer's
 * instrument. It writes nothing — every request below is a GET.
 *
 * ## What it cannot see, stated
 *
 * (b) keys on the facet marker, as ruled — and the round-2 ruling kept it so (Q2 → A): the two decision analyses the
 * card measured carried no marker, so (b) would not have fired on them; its recall is the four-facet filing duty's
 * (`decision-analysis.md`), and making the marker mandatory on a comment-anchored analysis is the director's card.
 *
 * The stay-behind reading asks whether the pull's NEWEST seat record is an ACCEPT, not whether that record was made
 * for the pull's current head (H69 patrols that half on Tier H). And (a′) reads HELD claims only: a card already
 * released to `pm:queue` while its dev's question is open has left (a)'s population; H52 (open questions unrouted)
 * is the reader that still sees it.
 *
 * ## A declared stay-behind is REPORTED only for an ACCEPTed pull that waits (round 2, Q1 → B; narrowed at sign-off)
 *
 * The default at sign-off is the hand-back (`seat-post-protocol.md`, 交接收尾清单 step 2): every claimed card goes
 * back to `pm:queue` in one write — `Release:` with `Resume-from:`, the assignee cleared, `pm:dispatched` →
 * `pm:queue`. Stay-behind (留守) is the one exception: a card whose pull request the seat has ACCEPTed and which now
 * waits on someone else. Such a card is still held at `pm:dispatched` under the seat's claim, and (a) reports it —
 * one `[stay-behind] #N` line — instead of refusing it, only when all three hold:
 *
 *   1. DECLARED TWICE  on the command line (`--stay-behind=#N[,#N…]`) and on the `Stay-behind:` line of the vacant
 *                      body about to be written (`--body-file=PATH`);
 *   2. ACCEPTED        an open pull request delivers the card (`deliveryEvidence`, the patrol's one reading of "this
 *                      pull delivers card N") and its NEWEST seat record (`## 席位核对`, `seat-record.mjs`) is ACCEPT;
 *   3. WAITING         that pull is in the merge queue (its timeline's newest queue event is `added_to_merge_queue`:
 *                      `enqueuerFromTimeline`, the queue guard's reading), has auto-merge armed (read only in this
 *                      finding-reducing direction, as H12 reads it), or awaits a human approval
 *                      (`needs-user-decision` on the pull, the label the seat writes beside the approval request).
 *
 * Short of any one, it stays `[claim-unreleased]` and says which one failed; the measured half-state (#23193, never a
 * declared tail) is refused exactly as before, and a card (a′) names is refused whatever it declares.
 *
 *   - The body comes from `--body-file`, ⛔ not from the live seat post (`--seat=#N` was the other offer): step 5 of the
 *     checklist runs this BEFORE the vacant body is written, so at that moment the live post is still the seated body
 *     and carries no stay-behind line to read. The file is also the smaller of the two — no request.
 *   - The body must itself be VACANT (`seatPostVacancy`, imported from `post-stamped.mjs`, the one reading of it).
 *   - The stay-behind line is `STAY_BEHIND_LINE`: a line whose text, list marker and emphasis stripped, opens with
 *     `Stay-behind` or the protocol's `留守` / `留守登记` and a colon — measured `- **Stay-behind:** none.` on two live
 *     vacant bodies (#21118, #6024). Its cards are the `#N` (or `owner/name#N` naming the swept board) outside code
 *     on that line.
 *
 * Exit: 0 handover clear · 1 usage · 2 REFUSED (a finding) · 3 PREREQUISITE NOT MET (no route; nothing read) ·
 * 4 the read failed or was truncated (no verdict).
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import {
  CLAIM_COMMENT_MARKER,
  DECISION_FACET_MARKER,
  GOVERNED_PR_DECISION_LABEL,
  OPEN_LISTING_PAGE_CEILING,
  OS_DEV_REPORT_MARKER,
  PM_EXCLUSIVE_STATE_LABELS,
  PROXY_FLAG,
  RELEASE_COMMENT_MARKER,
  SEAT_SESSION_ID,
  classifyTransportProbe,
  deliveryEvidence,
  describeTransportRoute,
  devReportPayloadCandidates,
  hasDecisionFacetMarker,
  labelNames,
  latestDevReport,
  latestMarkedComment,
  markerMatches,
  pmLabelListingPath,
  proxyRearmPlan,
  resolveSweepRepo,
  stripMarkdownCode,
} from './check-half-states.mjs';
import { enqueuerFromTimeline } from './check-governed-queue-guard.mjs';
import { classifyRulingComment } from './check-prior-rulings.mjs';
import { seatPostVacancy } from './post-stamped.mjs';
import { SEAT_RECORD_MARKER, seatRecordAccepts } from './seat-record.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_REFUSED = 2;
export const EXIT_PREREQUISITE_NOT_MET = 3;
export const EXIT_UNREAD = 4;

/** This tool's own re-exec guard — ⛔ never the patrol's name, whose inherited value would silence this one. */
export const PROXY_REARM_GUARD = 'OS_CHECK_HANDOVER_PROXY_REARMED';

/** The identity every relay write carries; (b) reads the departing session's comments by this author only. */
export const FLEET_BOT_LOGIN = 'objectstack-fleet[bot]';

/** The decision inbox label, and the one state a card awaiting the maintainer may carry. */
export const DECISION_INBOX_LABEL = 'needs-user-decision';

/** (b)'s default window: a seat shift measured 41 h and 49 h in the two vacant bodies the card read; ×3 headroom. */
export const DEFAULT_WINDOW_HOURS = 168;

/** The comment stream's backstop — 20,000 comments; one 41-hour shift read 1,846. A bound that binds is exit 4. */
export const STREAM_PAGE_CEILING = 200;

// ---------------------------------------------------------------------------
// Pure core — every function below is offline and is what `--self-test` pins.
// ---------------------------------------------------------------------------

const carries = (body, session) => String(body ?? '').includes(session);
const stampOf = (row) => {
  const ms = Date.parse(row?.created_at ?? '');
  return Number.isFinite(ms) ? ms : null;
};
const isNewer = (a, b) => {
  const sa = stampOf(a);
  const sb = stampOf(b);
  return sa !== null && sb !== null && sa !== sb ? sa > sb : Number(a?.id ?? 0) > Number(b?.id ?? 0);
};

/**
 * Predicate (a) over one card and its whole thread (REST rows, thread order).
 * @returns {{ verdict: 'out'|'unclaimed'|'other-session'|'released'|'held', claim?: object, release?: object }}
 *   `held` is the refusal; `other-session` and `unclaimed` are listed, never refused.
 */
export function claimHolding(issue, comments, { session, account }) {
  if (issue?.pull_request || issue?.state !== 'open') return { verdict: 'out' };
  if (!labelNames(issue).includes('pm:dispatched')) return { verdict: 'out' };
  const login = String(account ?? '').toLowerCase();
  if (!(issue.assignees ?? []).some((a) => String(a?.login ?? '').toLowerCase() === login)) return { verdict: 'out' };
  const rows = Array.isArray(comments) ? comments : [];
  const newest = latestMarkedComment(rows, CLAIM_COMMENT_MARKER);
  if (newest === null) return { verdict: 'unclaimed' };
  const claim = rows[newest.index];
  if (!carries(claim?.body, session)) return { verdict: 'other-session', claim };
  const release = rows
    .filter((c) => carries(c?.body, session) && markerMatches(RELEASE_COMMENT_MARKER, String(c?.body ?? '')))
    .reduce((best, c) => (best === null || isNewer(c, best) ? c : best), null);
  if (release !== null && isNewer(release, claim)) return { verdict: 'released', claim, release };
  return { verdict: 'held', claim };
}

/**
 * The `status` an `os-dev-report` comment's payload declares, or `null` when the comment is no report or no payload
 * reads. WHERE a payload sits is the patrol's reading (`devReportPayloadCandidates`: fenced blocks, then an unfenced
 * object opening its own line), called rather than restated; only the field is read here.
 */
export function reportedStatus(body) {
  const text = String(body ?? '');
  if (!OS_DEV_REPORT_MARKER.test(text)) return null;
  for (const candidate of devReportPayloadCandidates(text)) {
    let doc;
    try {
      doc = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (doc && typeof doc === 'object' && !Array.isArray(doc) && typeof doc.status === 'string') return doc.status;
  }
  return null;
}

/**
 * (a′) over a card (a) HOLDS: the thread's newest `os-dev-report` (`latestDevReport`, the patrol's newest-of reading),
 * when it is newer than the claim and reports `needs_decision` while the card is not `needs-user-decision` — that
 * report's row; otherwise `null`. A report older than the claim belongs to an earlier dispatch, whose question was
 * answered before this claim was made.
 */
export function decisionReportHeld(issue, comments, claim) {
  if (labelNames(issue).includes(DECISION_INBOX_LABEL)) return null;
  const report = latestDevReport(comments);
  if (report === null || !isNewer(report.row, claim)) return null;
  return reportedStatus(report.row?.body) === 'needs_decision' ? report.row : null;
}

/**
 * Predicate (b) over one card, the departing session's fleet-bot comments on it, and every comment on it that the
 * stream holds (for the ruling-after test). `null` when the card is not pending a decision from this session, or
 * when it sits in the inbox alone; otherwise the row.
 */
export function decisionOutsideInbox(issue, sessionComments, cardComments) {
  if (issue?.pull_request || issue?.state !== 'open') return null;
  const mine = (Array.isArray(sessionComments) ? sessionComments : []).filter((c) => c?.user?.login === FLEET_BOT_LOGIN);
  const latest = mine.reduce((best, c) => (best === null || isNewer(c, best) ? c : best), null);
  if (latest === null || !carriesFacetMarker(latest.body)) return null;
  const ruled = (Array.isArray(cardComments) ? cardComments : []).find((c) => isNewer(c, latest) && classifyRulingComment(c?.body) !== null);
  if (ruled) return null;
  const labels = labelNames(issue);
  const states = PM_EXCLUSIVE_STATE_LABELS.filter((l) => labels.includes(l));
  if (states.length === 1 && states[0] === DECISION_INBOX_LABEL) return null;
  return { number: issue.number, title: issue.title ?? '', states, comment: latest };
}

/**
 * Does this comment CARRY the four-facet marker, rather than quote it? `hasDecisionFacetMarker` over the comment with
 * fenced and inline code blanked (`stripMarkdownCode`). H62's literal grep is right for a report-only reader, whose
 * accepted error is a quoting card read as clean; in a REFUSAL the same reading refuses a seat for quoting the token.
 * Measured on two days of the comment stream: the 20 real markers are a bare `os-decision-facets` line or its
 * HTML-comment wrapping, never in code; the 3 other hits are quotations in code (the reading, the ruling and the dev
 * report on #23396 — the last one refused a live run of this check before this reading existed).
 */
export function carriesFacetMarker(body) {
  return hasDecisionFacetMarker(stripMarkdownCode(String(body ?? '')));
}

/** The comment stream grouped by card number: the departing session's fleet-bot comments, and every comment. */
export function groupStream(stream, session) {
  const byCard = new Map();
  for (const c of Array.isArray(stream) ? stream : []) {
    const number = Number(String(c?.issue_url ?? '').split('/').pop());
    if (!Number.isInteger(number) || number <= 0) continue;
    if (!byCard.has(number)) byCard.set(number, { all: [], session: [] });
    const entry = byCard.get(number);
    entry.all.push(c);
    if (c?.user?.login === FLEET_BOT_LOGIN && carries(c?.body, session)) entry.session.push(c);
  }
  return byCard;
}

/** Cards whose latest session comment carries the marker — the only ones (b) buys a card read for. */
export function decisionCandidates(byCard) {
  const out = [];
  for (const [number, entry] of byCard) {
    if (entry.session.length === 0) continue;
    const latest = entry.session.reduce((best, c) => (best === null || isNewer(c, best) ? c : best), null);
    if (carriesFacetMarker(latest.body)) out.push(number);
  }
  return out.sort((a, b) => a - b);
}

/** A stay-behind registration line (`seat-post-protocol.md`: 留守登记 = one line), read after its list marker and emphasis. */
export const STAY_BEHIND_LINE = /^(?:stay-behind|留守(?:登记)?)[ \t]*[:：]/iu;

const STAY_BEHIND_CARD = /(?:^|[^\w&#/])#(\d+)(?!\w)|([\w.-]+\/[\w.-]+)#(\d+)(?!\w)/gu;

/**
 * What the vacant body about to be written declares as its stay-behind tails.
 * @returns {{ vacant: boolean, cards: Set<number>, lines: string[] }} — `cards` from every stay-behind line, code blanked.
 */
export function stayBehindDeclared(body, repo) {
  const raw = String(body ?? '');
  const cards = new Set();
  const lines = [];
  for (const line of stripMarkdownCode(raw).split('\n')) {
    const text = line.replace(/^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?/u, '').replace(/^[*_]+/u, '');
    if (!STAY_BEHIND_LINE.test(text)) continue;
    lines.push(line.trim());
    for (const m of text.matchAll(STAY_BEHIND_CARD)) {
      if (m[1] !== undefined) cards.add(Number(m[1]));
      else if (String(m[2]).toLowerCase() === String(repo ?? '').toLowerCase()) cards.add(Number(m[3]));
    }
  }
  return { vacant: seatPostVacancy(raw).vacant, cards, lines };
}

/** `--stay-behind=#N[,#N…]` → card numbers, or the usage error. */
export function parseStayBehind(value) {
  const parts = String(value ?? '').split(',').map((p) => p.trim()).filter((p) => p !== '');
  const cards = [];
  for (const part of parts) {
    const m = /^#?(\d+)$/u.exec(part);
    if (!m) return { ok: false, error: `--stay-behind takes card numbers, \`#N[,#N…]\`; ${JSON.stringify(part)} is not one` };
    cards.push(Number(m[1]));
  }
  if (cards.length === 0) return { ok: false, error: '--stay-behind names no card' };
  return { ok: true, cards };
}

/**
 * Conditions 2 and 3 of a stay-behind over ONE open pull request that delivers the card. Pure; `timeline` is
 * `undefined` until it is read, and it is read only when the cheaper readings did not answer.
 * @returns {{ state: 'waiting', how: string } | { state: 'no-accept' } | { state: 'not-waiting' } | { state: 'needs-timeline' }}
 */
export function acceptedPullWait(pr, comments, timeline) {
  const rows = Array.isArray(comments) ? comments : [];
  const record = latestMarkedComment(rows, SEAT_RECORD_MARKER);
  if (record === null || !seatRecordAccepts(rows[record.index]?.body)) return { state: 'no-accept' };
  if (labelNames(pr ?? {}).includes(GOVERNED_PR_DECISION_LABEL)) {
    return { state: 'waiting', how: `awaiting a human approval (\`${GOVERNED_PR_DECISION_LABEL}\` on the pull)` };
  }
  if (pr?.auto_merge != null) return { state: 'waiting', how: 'armed for auto-merge' };
  if (timeline === undefined) return { state: 'needs-timeline' };
  if (enqueuerFromTimeline(timeline).state === 'read') return { state: 'waiting', how: 'in the merge queue' };
  return { state: 'not-waiting' };
}

/** Why a declared stay-behind's pulls do not make it one — the sentence the refusal prints. */
export function waitShortfall(pulls) {
  if (!Array.isArray(pulls)) return 'no reading shows an ACCEPTed pull that waits';
  if (pulls.length === 0) return 'no open pull request delivers it';
  return pulls
    .map((p) =>
      p.state === 'no-accept'
        ? `pull #${p.number} carries no ACCEPT as its newest \`## 席位核对\` record`
        : `pull #${p.number} is ACCEPTed but is neither in the merge queue, armed for auto-merge, nor awaiting a human approval`,
    )
    .join('; ');
}

/**
 * The verdict over what the live read found — pure, so every arm is pinned offline. A held card is REPORTED only
 * when it is listed on the command line, declared on the vacant body's stay-behind line, AND its `wait` reading names
 * an ACCEPTed pull that waits; a held card carrying a `needs_decision` report (`decisionReport`, (a′)) is refused by
 * that name whatever it declares; every other held card, and every decision outside the inbox, is refused.
 */
export function handoverVerdict({ held = [], decisions = [], stayBehind = [], declared = new Set() } = {}) {
  const listed = new Set(stayBehind);
  const refused = [];
  const reported = [];
  for (const h of held) {
    const n = h.issue.number;
    const twice = listed.has(n) && declared.has(n);
    if (h.decisionReport) refused.push({ kind: 'needs-decision', ...h });
    else if (twice && h.wait) reported.push(h);
    else {
      const arm = twice ? 'not-waiting' : listed.has(n) ? 'listed-undeclared' : declared.has(n) ? 'declared-unlisted' : null;
      refused.push({ kind: 'held', ...h, stayBehind: arm });
    }
  }
  for (const row of decisions) refused.push({ kind: 'decision', row });
  const heldNumbers = new Set(held.map((h) => h.issue.number));
  return { exit: refused.length > 0 ? EXIT_REFUSED : EXIT_OK, refused, reported, notHeld: [...listed].filter((n) => !heldNumbers.has(n)) };
}

/** The `[stay-behind]` lines — printed on a clear run and beside a refusal alike. */
export function stayBehindText(reported) {
  return reported
    .map(
      (h) =>
        `  [stay-behind] #${h.issue.number} ${JSON.stringify(h.issue.title ?? '')} — held under this session's claim, declared on the ` +
        `vacant body's \`Stay-behind:\` line, and its pull #${h.wait?.pr} is ACCEPTed and ${h.wait?.how}: reported, not refused. ` +
        'The tail stays this session\'s to land.',
    )
    .join('\n');
}

export function parseArgs(argv) {
  const options = { session: null, account: null, since: null, repo: null, stayBehind: null, bodyFile: null, selfTest: false, probe: false };
  for (const arg of argv) {
    if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--probe') options.probe = true;
    else if (arg === '--help' || arg === '-h') return { ok: false, help: true };
    else {
      const m = /^--(session|account|since|repo|stay-behind|body-file)=(.*)$/u.exec(arg);
      if (!m) return { ok: false, error: `unknown argument ${JSON.stringify(arg)} (spell options as --key=value)` };
      options[{ 'stay-behind': 'stayBehind', 'body-file': 'bodyFile' }[m[1]] ?? m[1]] = m[2].trim();
    }
  }
  if (options.selfTest || options.probe) return { ok: true, options };
  if (!options.session || !new RegExp(`^${SEAT_SESSION_ID.source}$`, 'u').test(options.session)) {
    return { ok: false, error: '--session must be ONE session id, `session_01` plus 22 characters — the id the claims and releases carry' };
  }
  if (!options.account || !/^[A-Za-z0-9-]+(?:\[bot\])?$/u.test(options.account)) {
    return { ok: false, error: '--account must be the departing seat\'s GitHub login — the assignee its claims set' };
  }
  if (options.since !== null && !Number.isFinite(Date.parse(options.since))) {
    return { ok: false, error: `--since=${JSON.stringify(options.since)} is not an instant (write e.g. 2026-10-12T13:57Z)` };
  }
  if (options.repo !== null && !/^[^/\s]+\/[^/\s]+$/u.test(options.repo)) {
    return { ok: false, error: `--repo=${JSON.stringify(options.repo)} is not \`owner/name\`` };
  }
  if (options.stayBehind !== null) {
    const sb = parseStayBehind(options.stayBehind);
    if (!sb.ok) return { ok: false, error: sb.error };
    if (!options.bodyFile) {
      return { ok: false, error: '--stay-behind needs --body-file=PATH: a tail is declared on the `Stay-behind:` line of the vacant body about to be written, and read there' };
    }
    options.stayBehindCards = sb.cards;
  }
  return { ok: true, options };
}

/**
 * The refusal a departing seat reads. Rows: `{ kind: 'held', issue, claim, stayBehind?, pulls? }`,
 * `{ kind: 'needs-decision', issue, claim, decisionReport }` or `{ kind: 'decision', row }`.
 */
export function refusalText(findings, { session, account, repo }) {
  const lines = findings.map((f, i) =>
    f.kind === 'held'
      ? `  ${i + 1}. [claim-unreleased] #${f.issue.number} ${JSON.stringify(f.issue.title ?? '')} — \`pm:dispatched\`, assignee ` +
        `\`${account}\`, newest \`Claim:\` (comment ${f.claim?.id}) carries this session, and no \`Release:\` from this session follows it.\n` +
        '     Land it, or hand it back in ONE write: `Release:` (session · reason · next, with `Resume-from: BRANCH@SHA` when work was\n' +
        '     pushed), the assignee cleared, `pm:dispatched` → `pm:queue`. Only a card whose pull is ACCEPTed and waits on the merge\n' +
        '     queue or a human approval stays behind: declare it on the vacant body\'s `Stay-behind:` line and pass\n' +
        '     `--stay-behind=#N --body-file=PATH`.' +
        (f.stayBehind === 'listed-undeclared'
          ? '\n     It is listed in --stay-behind, but the vacant body\'s `Stay-behind:` line does not declare it.'
          : f.stayBehind === 'declared-unlisted'
            ? '\n     The vacant body\'s `Stay-behind:` line declares it, but --stay-behind does not list it.'
            : f.stayBehind === 'not-waiting'
              ? `\n     It is declared a stay-behind on both, but ${waitShortfall(f.pulls)}: no ACCEPTed pull waits, so hand it back.`
              : '')
      : f.kind === 'needs-decision'
        ? `  ${i + 1}. [needs-decision-unreleased] #${f.issue.number} ${JSON.stringify(f.issue.title ?? '')} — \`pm:dispatched\` under ` +
          `this session's unreleased claim (comment ${f.claim?.id}), and its dev's newest \`os-dev-report\` (comment ${f.decisionReport?.id}) ` +
          `reports \`needs_decision\` while the card is not \`${DECISION_INBOX_LABEL}\`.\n` +
          `     Hand it to the decision box, ⛔ not back to \`pm:queue\`: \`Release:\` and the assignee cleared in ONE write, ` +
          `\`pm:dispatched\` → \`${DECISION_INBOX_LABEL}\`,\n` +
          '     with the four-facet analysis on the card. Declaring it a stay-behind does not excuse it.'
      : `  ${i + 1}. [decision-outside-inbox] #${f.row.number} ${JSON.stringify(f.row.title)} — this session's latest comment ` +
        `(${f.row.comment?.id}) carries the four-facet block and no ruling follows it, but the card's states are ` +
        `${f.row.states.length === 0 ? 'none' : f.row.states.map((s) => `\`${s}\``).join(' + ')}.\n` +
        `     A card awaiting the maintainer carries \`${DECISION_INBOX_LABEL}\` and no other state — replace, ⛔ never add.`,
  );
  return (
    `check-handover: REFUSED — ${findings.length} handover problem(s) for ${session} (account ${account}) on ${repo}.\n` +
    `${lines.join('\n')}\n\n` +
    '  The vacant body is not written until this exits 0. ⛔ No flag turns it off.'
  );
}

// ---------------------------------------------------------------------------
// Live layer — GETs only.
// ---------------------------------------------------------------------------

async function rest(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { accept: 'application/vnd.github+json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
  });
  if (!res.ok) {
    const err = new Error(`GET ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Every page of a listing, in the API's order; a listing that fills `ceiling` pages is truncated — exit 4, never 0. */
async function readPages(path, what, ceiling = OPEN_LISTING_PAGE_CEILING * 5) {
  const rows = [];
  const joiner = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= ceiling; page++) {
    const batch = await rest(`${path}${joiner}per_page=100&page=${page}`);
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  const err = new Error(`${what} filled ${ceiling} pages — not read to its end`);
  err.truncated = true;
  throw err;
}

const readThread = (repo, number) => readPages(`/repos/${repo}/issues/${number}/comments`, `the thread of #${number}`);
const readTimeline = (repo, number) => readPages(`/repos/${repo}/issues/${number}/timeline`, `the timeline of #${number}`);
const readOpenPulls = (repo) => readPages(`/repos/${repo}/pulls?state=open`, 'the open pull listing', OPEN_LISTING_PAGE_CEILING);

async function probeOnce(path, token = TOKEN) {
  try {
    const res = await fetch(`${API}${path}`, { headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    return { status: res.status, rateLimitRemaining: Number(res.headers.get('x-ratelimit-remaining') ?? NaN) };
  } catch (err) {
    return { networkError: err?.cause?.code ?? err?.message ?? 'fetch failed' };
  }
}

/** The patrol's own classifier over the same two readings it takes — one place where a transport verdict is named. */
async function probeTransport(repo) {
  const transport = describeTransportRoute({ env: process.env, execArgv: process.execArgv });
  const first = await probeOnce('/rate_limit');
  const account = TOKEN
    ? classifyTransportProbe({ token: TOKEN, authed: first, anon: first.status === 200 ? null : await probeOnce('/rate_limit', ''), transport })
    : classifyTransportProbe({ token: '', anon: first, transport });
  if (account?.kind !== 'reachable') return account;
  const repoRead = await probeOnce(`/repos/${repo}`);
  return TOKEN ? classifyTransportProbe({ token: TOKEN, authed: first, repo: repoRead, transport }) : classifyTransportProbe({ token: '', anon: first, repo: repoRead, transport });
}

function prerequisiteText(v) {
  return (
    `check-handover: PREREQUISITE NOT MET — ${v?.headline ?? 'the transport probe returned no verdict'}\n` +
    (v?.detail ?? []).map((l) => (l ? `  ${l}` : '')).join('\n') +
    `\n  Fix:  ${(v?.fix ?? ['run this where node\'s fetch reaches api.github.com with a token that can read issues']).join('\n        ')}\n` +
    '  NOTHING WAS READ: this is no verdict about the handover, neither clear nor refused.'
  );
}

async function run(options) {
  const repoRes = options.repo ? { repo: options.repo, valid: true } : resolveSweepRepo(process.env);
  if (!repoRes.valid) {
    console.error(`check-handover: ${JSON.stringify(repoRes.repo)} is not \`owner/name\`; refusing to read a different board.`);
    return EXIT_USAGE;
  }
  const repo = repoRes.repo;
  let declared = { vacant: false, cards: new Set(), lines: [] };
  if (options.bodyFile) {
    let body;
    try {
      body = readFileSync(options.bodyFile, 'utf8');
    } catch (err) {
      console.error(`check-handover: could not read --body-file (${err.message}).`);
      return EXIT_USAGE;
    }
    declared = stayBehindDeclared(body, repo);
    if (!declared.vacant) {
      console.error(
        `check-handover: --body-file=${JSON.stringify(options.bodyFile)} is not a VACANT seat post — its Current-PM section's first status ` +
          'token is not `⏳ vacant`. A stay-behind tail is declared on the vacant body about to be written, so that is the body this reads.',
      );
      return EXIT_USAGE;
    }
  }
  const probe = await probeTransport(repo);
  if (probe?.kind !== 'reachable') {
    console.error(prerequisiteText(probe));
    return EXIT_PREREQUISITE_NOT_MET;
  }
  const sinceMs = options.since !== null ? Date.parse(options.since) : Date.now() - DEFAULT_WINDOW_HOURS * 3600_000;
  const since = new Date(sinceMs).toISOString();
  const coverage = [];
  const listed = [];
  try {
    // (a) every open pm:dispatched card, then the departing account's threads.
    let page = 1;
    let exhausted = false;
    const dispatched = [];
    for (; page <= OPEN_LISTING_PAGE_CEILING; page++) {
      const batch = await rest(pmLabelListingPath(repo, 'pm:dispatched', page));
      dispatched.push(...batch.filter((i) => !i.pull_request));
      if (batch.length < 100) {
        exhausted = true;
        break;
      }
    }
    if (!exhausted) throw Object.assign(new Error(`the \`pm:dispatched\` listing filled its ${OPEN_LISTING_PAGE_CEILING}-page ceiling`), { truncated: true });
    const login = options.account.toLowerCase();
    const mine = dispatched.filter((i) => (i.assignees ?? []).some((a) => String(a?.login ?? '').toLowerCase() === login));
    const held = [];
    const decisions = [];
    for (const issue of mine) {
      const thread = await readThread(repo, issue.number);
      const holding = claimHolding(issue, thread, options);
      if (holding.verdict === 'held') held.push({ issue, claim: holding.claim, decisionReport: decisionReportHeld(issue, thread, holding.claim) });
      else if (holding.verdict === 'other-session' || holding.verdict === 'unclaimed') listed.push(`#${issue.number} (${holding.verdict === 'unclaimed' ? 'no `Claim:` at all' : 'held by another session'})`);
    }
    coverage.push(`(a) ${dispatched.length} open \`pm:dispatched\` card(s), ${mine.length} assigned to \`${options.account}\`, every one of their threads read`);

    // (c) the stay-behind reads — bought only for a held card declared twice that (a′) does not already refuse.
    const listedTails = new Set(options.stayBehindCards ?? []);
    const tails = held.filter((h) => !h.decisionReport && listedTails.has(h.issue.number) && declared.cards.has(h.issue.number));
    if (tails.length > 0) {
      const pulls = await readOpenPulls(repo);
      let threads = 0;
      let timelines = 0;
      for (const h of tails) {
        h.pulls = [];
        h.wait = null;
        for (const pr of pulls.filter((p) => deliveryEvidence(p, h.issue.number) !== null)) {
          const comments = await readThread(repo, pr.number);
          threads += 1;
          let reading = acceptedPullWait(pr, comments);
          if (reading.state === 'needs-timeline') {
            reading = acceptedPullWait(pr, comments, await readTimeline(repo, pr.number));
            timelines += 1;
          }
          h.pulls.push({ number: pr.number, ...reading });
          if (h.wait === null && reading.state === 'waiting') h.wait = { pr: pr.number, how: reading.how };
        }
      }
      coverage.push(
        `(c) ${tails.length} declared stay-behind card(s): ${pulls.length} open pull(s) listed, ${threads} delivering pull ` +
          `thread(s) and ${timelines} timeline(s) read`,
      );
    }

    // (b) the comment stream since the window opened, then the candidates' cards.
    const stream = [];
    let streamPages = 0;
    let streamDone = false;
    for (let p = 1; p <= STREAM_PAGE_CEILING; p++) {
      const batch = await rest(`/repos/${repo}/issues/comments?since=${encodeURIComponent(since)}&sort=created&direction=asc&per_page=100&page=${p}`);
      streamPages = p;
      stream.push(...batch);
      if (batch.length < 100) {
        streamDone = true;
        break;
      }
    }
    if (!streamDone) throw Object.assign(new Error(`the comment stream since ${since} filled its ${STREAM_PAGE_CEILING}-page ceiling`), { truncated: true });
    const byCard = groupStream(stream, options.session);
    const sessionCount = [...byCard.values()].reduce((n, e) => n + e.session.length, 0);
    const candidates = decisionCandidates(byCard);
    for (const number of candidates) {
      const issue = await rest(`/repos/${repo}/issues/${number}`);
      const entry = byCard.get(number);
      const row = decisionOutsideInbox(issue, entry.session, entry.all);
      if (row !== null) decisions.push(row);
    }
    coverage.push(
      `(b) ${streamPages} page(s) of the comment stream since ${since} — ${stream.length} comment(s), ${sessionCount} by the fleet ` +
        `carrying this session on ${[...byCard.values()].filter((e) => e.session.length > 0).length} card(s), ${candidates.length} whose latest carries the ` +
        `four-facet block; a session comment older than the window is UNREAD (widen with --since)`,
    );
    const context = { session: options.session, account: options.account, repo };
    const verdict = handoverVerdict({ held, decisions, stayBehind: options.stayBehindCards ?? [], declared: declared.cards });
    const tail =
      `  Read: ${coverage.join('; ')}.` +
      (listed.length > 0 ? `\n  Listed, not refused: ${listed.join(', ')}.` : '') +
      (verdict.notHeld.length > 0 ? `\n  In --stay-behind but not held under this session's claim: ${verdict.notHeld.map((n) => `#${n}`).join(', ')}.` : '');
    const stayed = verdict.reported.length > 0 ? `\n${stayBehindText(verdict.reported)}` : '';
    if (verdict.exit !== EXIT_OK) {
      console.error(`${refusalText(verdict.refused, context)}${stayed}\n${tail}`);
      return verdict.exit;
    }
    console.log(`✓ check-handover: clear — no unreleased claim and no decision outside the inbox for ${options.session} on ${repo}.${stayed}\n${tail}`);
    return EXIT_OK;
  } catch (err) {
    console.error(
      `check-handover: NO VERDICT — ${err.message}. ${coverage.length > 0 ? `Read before it stopped: ${coverage.join('; ')}. ` : ''}` +
        'A read that failed or was truncated is not a clean board, and it is not a refusal either.',
    );
    return EXIT_UNREAD;
  }
}

function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({ env: process.env, execArgv: process.execArgv, flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG), guard: PROXY_REARM_GUARD });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], { stdio: 'inherit', env: { ...process.env, [PROXY_REARM_GUARD]: '1' } });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — every request will bypass the proxy.`);
  return null;
}

const USAGE = [
  'check-handover — refuse a seat handover while the departing session still holds a claim or a decision outside the inbox.',
  '',
  '  node scripts/pm/check-handover.mjs --session=session_01… --account=LOGIN [--since=ISO] [--repo=OWNER/NAME]',
  '    [--stay-behind=#N[,#N…] --body-file=PATH]   a tail this seat stays behind on — an ACCEPTed pull waiting on the queue or a',
  '                                                human approval — declared on the vacant body\'s Stay-behind: line',
  '  node scripts/pm/check-handover.mjs --probe | --self-test',
  '',
  `  Exit: ${EXIT_OK} clear · ${EXIT_USAGE} usage · ${EXIT_REFUSED} REFUSED · ${EXIT_PREREQUISITE_NOT_MET} prerequisite not met (nothing read) · ${EXIT_UNREAD} no verdict (a read failed or was truncated).`,
].join('\n');

// ---------------------------------------------------------------------------
// --self-test — offline; fixtures are the measured shapes.
// ---------------------------------------------------------------------------

let selfTestReachedVerdict = false;

export function selfTest() {
  const cases = [];
  const t = (name, ok) => cases.push({ name, ok: Boolean(ok) });
  const S = 'session_012zwsLMxQBwHUYJgPyrpEvx';
  const OTHER = 'session_01LqNgdPZB2Jnr5HpGbaqLeB';
  const at = (m) => `2026-10-13T${String(8 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00Z`;
  const comment = (id, m, body, login = FLEET_BOT_LOGIN, number = 23193) => ({ id, created_at: at(m), body, user: { login }, issue_url: `https://api.github.com/repos/o/r/issues/${number}` });
  const card = (labels, assignees = ['zhuangjianguo'], extra = {}) => ({ number: 23193, title: 'PD15 amendment', state: 'open', labels: labels.map((name) => ({ name })), assignees: assignees.map((login) => ({ login })), ...extra });
  const ctx = { session: S, account: 'zhuangjianguo' };
  const CLAIM = comment(1, 0, `Claim: PM loop round 3\nSession: \`${S}\`\nBranch: \`claude/issue-23193-x\``);

  // (a)
  t('⭐ (a) THE MEASURED SHAPE: `pm:dispatched`, the departing account assigned, this session\'s claim newest, no `Release:` — held', claimHolding(card(['pm:dispatched']), [CLAIM], ctx).verdict === 'held');
  t('⭐ (a) the same card after `Release:` from this session — the measured remedy — is released', claimHolding(card(['pm:dispatched']), [CLAIM, comment(2, 60, `Release: \`${S}\` · reason: clock-out · next: \`pm:blocked\``)], ctx).verdict === 'released');
  t('(a) a bolded `**Release:**` line reads, through the patrol\'s own decoration reading', claimHolding(card(['pm:dispatched']), [CLAIM, comment(2, 60, `**Release:** \`${S}\` · next: \`pm:queue\``)], ctx).verdict === 'released');
  t('⛔ (a) a `Release:` written BEFORE a re-claim does not release it', claimHolding(card(['pm:dispatched']), [comment(0, 0, `Release: \`${S}\``), comment(1, 30, `Claim: again\nSession: \`${S}\``)], ctx).verdict === 'held');
  t('⛔ (a) a `Release:` from ANOTHER session does not release this session\'s claim', claimHolding(card(['pm:dispatched']), [CLAIM, comment(2, 60, `Release: \`${OTHER}\``)], ctx).verdict === 'held');
  t('⭐ (a) a card under the shared account whose newest claim names another session is LISTED, never refused', claimHolding(card(['pm:dispatched']), [CLAIM, comment(3, 90, `Claim: re-dispatch\nSession: \`${OTHER}\``)], ctx).verdict === 'other-session');
  t('(a) a card with no claim at all is listed as unclaimed', claimHolding(card(['pm:dispatched']), [comment(1, 0, 'a note')], ctx).verdict === 'unclaimed');
  t('(a) out of the population: another state, another assignee, a closed card, a pull request', ['pm:blocked'].every((l) => claimHolding(card([l]), [CLAIM], ctx).verdict === 'out') && claimHolding(card(['pm:dispatched'], ['os-justin']), [CLAIM], ctx).verdict === 'out' && claimHolding(card(['pm:dispatched'], undefined, { state: 'closed' }), [CLAIM], ctx).verdict === 'out' && claimHolding(card(['pm:dispatched'], undefined, { pull_request: {} }), [CLAIM], ctx).verdict === 'out');
  t('(a) the account matches case-insensitively, as GitHub logins do', claimHolding(card(['pm:dispatched'], ['ZhuangJianguo']), [CLAIM], ctx).verdict === 'held');

  // (b)
  const ANALYSIS = (id, m, marker = true) => comment(id, m, `## 决策:… · \`${S}\`\n\n${marker ? `${DECISION_FACET_MARKER}\n` : ''}**长远合理性** …`);
  t('⭐ (b) a decision analysis on a card at `pm:dispatched` is outside the inbox', decisionOutsideInbox(card(['pm:dispatched']), [ANALYSIS(5, 10)], [ANALYSIS(5, 10)])?.states.join() === 'pm:dispatched');
  t('⭐ (b) the same card at `needs-user-decision` alone is in the inbox', decisionOutsideInbox(card([DECISION_INBOX_LABEL]), [ANALYSIS(5, 10)], [ANALYSIS(5, 10)]) === null);
  t('⛔ (b) `needs-user-decision` beside another state is not alone — six states, one of them', decisionOutsideInbox(card([DECISION_INBOX_LABEL, 'pm:blocked']), [ANALYSIS(5, 10)], [ANALYSIS(5, 10)])?.states.length === 2);
  t('(b) a card carrying no state at all is outside the inbox too', decisionOutsideInbox(card(['domain:devx']), [ANALYSIS(5, 10)], [ANALYSIS(5, 10)])?.states.length === 0);
  t('(b) the HTML-comment spelling of the marker reads — the shape makes the two spellings equal', decisionOutsideInbox(card(['pm:blocked']), [comment(5, 10, `<!-- ${DECISION_FACET_MARKER} -->\n\`${S}\``)], []) !== null);
  t('⭐ (b) a ruling recorded AFTER the analysis answers it — the card is not pending, whatever its state', decisionOutsideInbox(card(['pm:queue']), [ANALYSIS(5, 10)], [ANALYSIS(5, 10), comment(6, 50, 'Ruling: batch #5 item 1 · letter A', 'objectstack-fleet[bot]')]) === null);
  t('⛔ (b) …while a ruling from BEFORE the analysis does not', decisionOutsideInbox(card(['pm:queue']), [ANALYSIS(5, 10)], [comment(4, 5, 'Ruling: batch #4 item 2 · letter B'), ANALYSIS(5, 10)]) !== null);
  t('⛔ (b) only the session\'s LATEST comment decides: a later comment without the block ends the pending state', decisionOutsideInbox(card(['pm:queue']), [ANALYSIS(5, 10), comment(7, 70, `Release: \`${S}\``)], []) === null);
  t('⛔ (b) a comment by another author carrying the session id and the marker is not the seat\'s', decisionOutsideInbox(card(['pm:dispatched']), [{ ...ANALYSIS(5, 10), user: { login: 'zhuangjianguo' } }], []) === null);
  t('⛔ (b) THE MEASURED ANALYSES carried no marker — so (b), as ruled, does not fire on them; the recall gap is stated, not hidden', decisionOutsideInbox(card(['pm:blocked']), [ANALYSIS(5, 10, false)], []) === null);
  t('(b) a closed card and a pull request are out', decisionOutsideInbox(card(['pm:dispatched'], undefined, { state: 'closed' }), [ANALYSIS(5, 10)], []) === null && decisionOutsideInbox(card(['pm:dispatched'], undefined, { pull_request: {} }), [ANALYSIS(5, 10)], []) === null);

  t('⛔ (b) a QUOTATION of the token in code is not the marker — the measured shape of this card\'s own dev report, which a live run refused', decisionOutsideInbox(card(['pm:dispatched']), [comment(6, 10, `os-dev-report\n\n\`\`\`json\n{ "predicate": "contains the \`${DECISION_FACET_MARKER}\` token", "session": "${S}" }\n\`\`\``)], []) === null && decisionOutsideInbox(card(['pm:dispatched']), [comment(6, 10, `The check keys on \`${DECISION_FACET_MARKER}\`. \`${S}\``)], []) === null);
  t('(b) …while the bare marker line, as every measured facet block writes it, still reads', decisionOutsideInbox(card(['pm:dispatched']), [comment(6, 10, `${DECISION_FACET_MARKER}\n\`${S}\``)], []) !== null && carriesFacetMarker(`<!-- ${DECISION_FACET_MARKER} -->`) === true);
  // the stream
  const STREAM = [ANALYSIS(5, 10), comment(8, 20, `note \`${S}\``, FLEET_BOT_LOGIN, 23169), comment(9, 30, 'another seat', FLEET_BOT_LOGIN, 23169), { ...ANALYSIS(10, 40), issue_url: 'https://api.github.com/repos/o/r/issues/23300', user: { login: 'zhuangjianguo' } }];
  const grouped = groupStream(STREAM, S);
  t('the stream groups by card, every comment kept, the session\'s fleet comments apart', grouped.get(23169).all.length === 2 && grouped.get(23169).session.length === 1 && grouped.get(23193).session.length === 1);
  t('…and a candidate is a card whose LATEST session comment carries the block — the non-fleet author buys no read', decisionCandidates(grouped).join() === '23193');

  // the declared stay-behind (round 2, Q1 → B)
  const VACANT_BODY = (stay) => ['## 1. Current PM — ⏳ vacant', '', '- **Previous holder:** `session_x`.', ...(stay === null ? [] : [stay]), '', '## 2. Ledger', '', '- #24001 → the next reading.'].join('\n');
  const declaredOf = (stay) => stayBehindDeclared(VACANT_BODY(stay), 'o/r');
  const HELD = { issue: card(['pm:dispatched']), claim: CLAIM };
  const RCTX = { session: S, account: 'zhuangjianguo', repo: 'o/r' };
  t('stay-behind: the measured spelling `- **Stay-behind:** none.` is a stay-behind line declaring nothing', declaredOf('- **Stay-behind:** none.').lines.length === 1 && declaredOf('- **Stay-behind:** none.').cards.size === 0);
  t('stay-behind: tails are read off that line — `#N`, and `owner/name#N` only when it names the swept board', [...declaredOf('- **Stay-behind:** #23193 (ACCEPTed, queued); o/r#23209; other/repo#99').cards].sort().join() === '23193,23209');
  t('stay-behind: the protocol word reads too (`留守登记:`), while a `#N` inside a code span does not', declaredOf('留守登记:#23193').cards.has(23193) && declaredOf('- **Stay-behind:** `#23193`').cards.size === 0);
  t('⛔ stay-behind: "no stay-behind items" mid-sentence is no stay-behind line', declaredOf('- Seat 1 signed off with no stay-behind items, #23193 closed.').lines.length === 0);
  t('⛔ stay-behind: a seated body is not the vacant body about to be written', stayBehindDeclared('## Current PM\n\n🟢 **x**\n\n- **Stay-behind:** #23193', 'o/r').vacant === false && declaredOf(null).vacant === true);
  const WAITING = { ...HELD, wait: { pr: 25427, how: 'in the merge queue' } };
  const both = handoverVerdict({ held: [WAITING], stayBehind: [23193], declared: declaredOf('- **Stay-behind:** #23193').cards });
  t('⭐ ARM 1 — listed AND declared, its pull ACCEPTed and waiting: REPORTED as `[stay-behind] #N` naming the pull and the wait, exit 0', both.exit === EXIT_OK && both.refused.length === 0 && both.reported.length === 1 && stayBehindText(both.reported).includes('[stay-behind] #23193') && stayBehindText(both.reported).includes('pull #25427 is ACCEPTed and in the merge queue'));
  const idle = handoverVerdict({ held: [{ ...HELD, pulls: [{ number: 25427, state: 'not-waiting' }], wait: null }], stayBehind: [23193], declared: declaredOf('- **Stay-behind:** #23193').cards });
  t('⭐ SIGN-OFF NARROWING — listed AND declared, but no ACCEPTed pull waits: still `[claim-unreleased]`, exit 2, naming the failed condition and the hand-back', idle.exit === EXIT_REFUSED && idle.reported.length === 0 && idle.refused[0]?.stayBehind === 'not-waiting' && refusalText(idle.refused, RCTX).includes('pull #25427 is ACCEPTed but is neither in the merge queue') && refusalText(idle.refused, RCTX).includes('so hand it back'));
  const unread = handoverVerdict({ held: [HELD], stayBehind: [23193], declared: new Set([23193]) });
  t('⛔ …and a declared card with no wait reading at all is refused the same way — absence never reads as waiting', unread.exit === EXIT_REFUSED && unread.refused[0]?.stayBehind === 'not-waiting' && refusalText(unread.refused, RCTX).includes('no reading shows an ACCEPTed pull that waits'));
  const undeclared = handoverVerdict({ held: [HELD], stayBehind: [23193], declared: declaredOf('- **Stay-behind:** none.').cards });
  t('⭐ ARM 2 — listed but NOT declared on the body: still `[claim-unreleased]`, exit 2, saying why', undeclared.exit === EXIT_REFUSED && undeclared.refused[0]?.stayBehind === 'listed-undeclared' && refusalText(undeclared.refused, RCTX).includes('[claim-unreleased] #23193') && refusalText(undeclared.refused, RCTX).includes('does not declare it'));
  const unlisted = handoverVerdict({ held: [HELD], stayBehind: [], declared: declaredOf('- **Stay-behind:** #23193').cards });
  t('⛔ declared on the body but not listed: still refused, exit 2 — the flag is the explicit act', unlisted.exit === EXIT_REFUSED && unlisted.refused[0]?.stayBehind === 'declared-unlisted' && refusalText(unlisted.refused, RCTX).includes('does not list it'));
  t('⭐ the measured half-state — no stay-behind at all — is refused as before, and its remedy names the two flags', handoverVerdict({ held: [HELD] }).exit === EXIT_REFUSED && refusalText(handoverVerdict({ held: [HELD] }).refused, RCTX).includes('--stay-behind=#N --body-file=PATH'));
  t('⛔ a declared stay-behind does not excuse a decision outside the inbox', handoverVerdict({ held: [WAITING], decisions: [{ number: 23169, title: 't', states: ['pm:queue'], comment: { id: 5 } }], stayBehind: [23193], declared: new Set([23193]) }).refused.map((r) => r.kind).join() === 'decision');
  t('a listed card this session does not hold is named apart, and refuses nothing', handoverVerdict({ held: [], stayBehind: [24009] }).notHeld.join() === '24009' && handoverVerdict({ held: [], stayBehind: [24009] }).exit === EXIT_OK);
  t('arguments: --stay-behind needs --body-file, takes `#N[,#N…]`, and refuses anything else', parseArgs([`--session=${S}`, '--account=x', '--stay-behind=#23193']).ok === false && parseArgs([`--session=${S}`, '--account=x', '--stay-behind=#23193,24001', '--body-file=b.md']).options?.stayBehindCards.join() === '23193,24001' && parseArgs([`--session=${S}`, '--account=x', '--stay-behind=pr-5', '--body-file=b.md']).ok === false);
  {
    const ownSource = readFileSync(SELF_PATH, 'utf8');
    t('structural: the vacancy reading is IMPORTED from post-stamped, ⛔ never restated here', ownSource.includes("import { seatPostVacancy } from './post-stamped.mjs';") && !/function\s+seatPostVacancy\b/u.test(ownSource));
    t('structural: the body file is read BEFORE the transport probe — a usage error costs no request', ownSource.indexOf('readFileSync(options.bodyFile') > 0 && ownSource.indexOf('readFileSync(options.bodyFile') < ownSource.indexOf('const probe = await probeTransport(repo);'));
  }

  // (a′) — the sign-off hand-back: a held card whose dev reported `needs_decision`
  const SIG = `domain:skills#2 · os-justin · ${S}`;
  const REPORT = (id, m, status, { fenced = true, signed = true } = {}) => {
    const json = JSON.stringify({ issue: 23193, status, pr: null, open_questions: status === 'needs_decision' ? [{ question: 'A or B?' }] : [] }, null, 2);
    return comment(id, m, `${signed ? `${SIG}\n\n` : ''}os-dev-report\n\n${fenced ? `\`\`\`json\n${json}\n\`\`\`` : json}`);
  };
  t('(a′) the report status reads signed or not, fenced or not — the patrol\'s payload reading, not a second one', [reportedStatus(REPORT(9, 1, 'needs_decision').body), reportedStatus(REPORT(9, 1, 'needs_decision', { signed: false }).body), reportedStatus(REPORT(9, 1, 'done', { fenced: false }).body)].join() === 'needs_decision,needs_decision,done');
  t('⛔ (a′) no status from a comment the marker does not open, nor from a payload that does not parse', reportedStatus('The os-dev-report said:\n```json\n{"status":"needs_decision"}\n```') === null && reportedStatus('os-dev-report\n\n```json\n{ status: needs_decision }\n```') === null && reportedStatus(null) === null);
  const DISPATCHED = card(['pm:dispatched']);
  t('⭐ (a′) THE MEASURED SHAPE: the dev reported `needs_decision` after this session\'s claim, the card still `pm:dispatched` — that report is named', decisionReportHeld(DISPATCHED, [CLAIM, REPORT(9, 120, 'needs_decision')], CLAIM)?.id === 9);
  const RECLAIM = comment(20, 200, `Claim: re-dispatch after the ruling\nSession: \`${S}\``);
  t('⛔ (a′) a `needs_decision` report OLDER than the claim belongs to an earlier dispatch, answered before this claim', decisionReportHeld(DISPATCHED, [CLAIM, REPORT(9, 120, 'needs_decision'), RECLAIM], RECLAIM) === null);
  t('⛔ (a′) only the NEWEST report decides: a later `done` report ends it', decisionReportHeld(DISPATCHED, [CLAIM, REPORT(9, 120, 'needs_decision'), REPORT(10, 150, 'done')], CLAIM) === null);
  t('⛔ (a′) a card already carrying `needs-user-decision` is not refused by this name', decisionReportHeld(card(['pm:dispatched', DECISION_INBOX_LABEL]), [CLAIM, REPORT(9, 120, 'needs_decision')], CLAIM) === null);
  const nd = handoverVerdict({ held: [{ ...WAITING, decisionReport: REPORT(9, 120, 'needs_decision') }], stayBehind: [23193], declared: new Set([23193]) });
  t('⭐ (a′) refused BY NAME, exit 2, even declared and waiting — the remedy is the decision box, ⛔ not `pm:queue`', nd.exit === EXIT_REFUSED && nd.reported.length === 0 && nd.refused[0]?.kind === 'needs-decision' && refusalText(nd.refused, RCTX).includes('[needs-decision-unreleased] #23193') && refusalText(nd.refused, RCTX).includes(`→ \`${DECISION_INBOX_LABEL}\``) && refusalText(nd.refused, RCTX).includes('not back to `pm:queue`'));

  // the narrowed stay-behind: conditions 2 and 3 over one delivering pull
  const PR = (extra = {}) => ({ number: 25427, state: 'open', draft: false, auto_merge: null, labels: [], body: 'Fixes #23193', head: { ref: 'claude/issue-23193-x' }, ...extra });
  const LABELLED = PR({ labels: [{ name: GOVERNED_PR_DECISION_LABEL }] });
  const ACCEPT_REC = comment(30, 300, '## 席位核对\n\n**ACCEPT** · domain:devx seat 1 · head `7cc88889`', FLEET_BOT_LOGIN, 25427);
  const REWORK_REC = comment(31, 330, '## 席位核对 — REWORK · tests owed', FLEET_BOT_LOGIN, 25427);
  const QUEUED = [{ event: 'added_to_merge_queue', actor: { login: 'os-justin' }, created_at: at(340) }];
  const DEQUEUED = [...QUEUED, { event: 'removed_from_merge_queue', actor: { login: 'github-merge-queue[bot]' }, created_at: at(350) }];
  t('⭐ wait: ACCEPTed and in the merge queue — the timeline\'s newest queue event is the add', acceptedPullWait(PR(), [ACCEPT_REC], QUEUED).how === 'in the merge queue');
  t('wait: ACCEPTed and awaiting a human approval (`needs-user-decision` on the pull) answers without the timeline', acceptedPullWait(LABELLED, [ACCEPT_REC]).state === 'waiting');
  t('wait: ACCEPTed with auto-merge armed answers without the timeline', acceptedPullWait(PR({ auto_merge: { merge_method: 'squash' } }), [ACCEPT_REC]).how === 'armed for auto-merge');
  t('wait: ACCEPTed, unlabelled and unarmed asks for the timeline before it judges', acceptedPullWait(PR(), [ACCEPT_REC]).state === 'needs-timeline');
  t('⛔ wait: ACCEPTed, but the newest queue event is a removal, or there is none — not waiting', acceptedPullWait(PR(), [ACCEPT_REC], DEQUEUED).state === 'not-waiting' && acceptedPullWait(PR(), [ACCEPT_REC], []).state === 'not-waiting');
  t('⛔ wait: no seat record, or a REWORK newer than the ACCEPT, is no ACCEPT — whatever the pull\'s label or queue says', acceptedPullWait(LABELLED, [comment(5, 10, 'LGTM')], QUEUED).state === 'no-accept' && acceptedPullWait(LABELLED, [ACCEPT_REC, REWORK_REC], QUEUED).state === 'no-accept');
  t('wait: an ACCEPT newer than a REWORK accepts', acceptedPullWait(PR(), [REWORK_REC, comment(32, 360, '## 席位核对 — ACCEPT · re-reviewed', FLEET_BOT_LOGIN, 25427)], QUEUED).state === 'waiting');
  t('the shortfall names each pull\'s failed condition, and the case no pull delivers', waitShortfall([]) === 'no open pull request delivers it' && waitShortfall([{ number: 25427, state: 'no-accept' }]).includes('pull #25427 carries no ACCEPT') && waitShortfall([{ number: 25428, state: 'not-waiting' }]).includes('pull #25428 is ACCEPTed but is neither'));
  t('the pull that delivers a card is the patrol\'s reading: a pull closing another card does not', deliveryEvidence(PR(), 23193) !== null && deliveryEvidence(PR({ body: 'Fixes #24001' }), 23193) === null);
  {
    const ownSource = readFileSync(SELF_PATH, 'utf8');
    const head = ownSource.slice(ownSource.indexOf('import process'), ownSource.indexOf('const SELF_PATH'));
    t('structural: the hand-back readers are IMPORTED from their owners, ⛔ none restated here', ['latestDevReport', 'devReportPayloadCandidates', 'deliveryEvidence', 'enqueuerFromTimeline', 'seatRecordAccepts'].every((name) => new RegExp(`\\b${name}\\b`, 'u').test(head) && !new RegExp(`function\\s+${name}\\b`, 'u').test(ownSource)) && head.includes("import { enqueuerFromTimeline } from './check-governed-queue-guard.mjs';") && head.includes("import { SEAT_RECORD_MARKER, seatRecordAccepts } from './seat-record.mjs';") && !/const\s+(?:OS_DEV_REPORT_MARKER|SEAT_RECORD_MARKER)\b/u.test(ownSource));
    t('structural: the pull reads are bought only for a declared tail — the open listing sits inside that branch', ownSource.indexOf('if (tails.length > 0) {') > 0 && ownSource.indexOf('await readOpenPulls(repo)') > ownSource.indexOf('if (tails.length > 0) {'));
  }

  // the CLI and the contract
  t('arguments: a session id and an account are required, each validated', parseArgs([`--session=${S}`, '--account=zhuangjianguo']).ok === true && parseArgs(['--account=x']).ok === false && parseArgs([`--session=${S}`]).ok === false && parseArgs(['--session=session_x', '--account=x']).ok === false);
  t('arguments: a bad --since and an unknown flag are usage errors, never a default', parseArgs([`--session=${S}`, '--account=x', '--since=yesterday']).ok === false && parseArgs(['--sesion=x']).ok === false);
  const text = refusalText([{ kind: 'held', issue: card(['pm:dispatched']), claim: CLAIM }, { kind: 'decision', row: { number: 23169, title: 't', states: ['pm:queue'], comment: { id: 5 } } }], { session: S, account: 'zhuangjianguo', repo: 'o/r' });
  t('the refusal names both kinds, the remedy of each, and that nothing turns it off', text.includes('[claim-unreleased] #23193') && text.includes('[decision-outside-inbox] #23169') && text.includes('Release:') && text.includes(DECISION_INBOX_LABEL) && text.includes('No flag turns it off'));
  t('the exit register keeps a refusal, no route and no verdict apart', new Set([EXIT_OK, EXIT_USAGE, EXIT_REFUSED, EXIT_PREREQUISITE_NOT_MET, EXIT_UNREAD]).size === 5 && EXIT_REFUSED === 2);
  t('the six states are the patrol\'s exclusive set, with the inbox in it', PM_EXCLUSIVE_STATE_LABELS.length === 6 && PM_EXCLUSIVE_STATE_LABELS.includes(DECISION_INBOX_LABEL));
  const own = readFileSync(SELF_PATH, 'utf8');
  const imports = own.slice(own.indexOf('import process'), own.indexOf('const SELF_PATH'));
  t('structural: the readers are IMPORTED from the patrol and the ruling search, ⛔ none restated here', ['latestMarkedComment', 'markerMatches', 'hasDecisionFacetMarker', 'labelNames', 'classifyRulingComment', 'pmLabelListingPath', 'proxyRearmPlan', 'classifyTransportProbe'].every((name) => new RegExp(`\\b${name}\\b`, 'u').test(imports) && !new RegExp(`function\\s+${name}\\b`, 'u').test(own)) && imports.includes("from './check-half-states.mjs';") && imports.includes("from './check-prior-rulings.mjs';"));
  t('structural: this tool writes nothing — no request below names a write verb', !/method:\s*'(?:POST|PATCH|PUT|DELETE)'/u.test(own));
  t('structural: the re-exec guard is this tool\'s own name, never the patrol\'s', PROXY_REARM_GUARD === 'OS_CHECK_HANDOVER_PROXY_REARMED');

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}`);
  selfTestReachedVerdict = true;
  if (failed.length > 0) {
    console.error(`✗ check-handover self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`✓ check-handover self-test: ${cases.length} cases pass — offline, no network, no token.`);
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    if (parsed.help) console.log(USAGE);
    else console.error(`check-handover: ${parsed.error}\n\n${USAGE}`);
    process.exit(parsed.help ? EXIT_OK : EXIT_USAGE);
  }
  if (parsed.options.selfTest) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error('✗ check-handover self-test: selfTest() returned without reaching its verdict — not a pass.');
      process.exit(1);
    }
    process.exit(code);
  }
  const rearmed = rearmThroughProxy(process.argv.slice(2));
  if (rearmed !== null) process.exit(rearmed);
  if (parsed.options.probe) {
    const repo = parsed.options.repo ?? resolveSweepRepo(process.env).repo;
    const v = await probeTransport(repo);
    if (v?.kind !== 'reachable') {
      console.error(prerequisiteText(v));
      process.exit(EXIT_PREREQUISITE_NOT_MET);
    }
    console.log(`✓ check-handover: transport prerequisite met — ${v.headline}.`);
    process.exit(EXIT_OK);
  }
  process.exit(await run(parsed.options));
}
