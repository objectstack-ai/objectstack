#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fleet-roster — regenerate the pinned 「车队总表」 issue: which account holds
 * which lane seat, and what each seat has in flight (#25416).
 *
 *   node scripts/pm/fleet-roster.mjs [--repos o/a,o/b,…] [--json]             # read GitHub, print the table (or the rows)
 *   node scripts/pm/fleet-roster.mjs [--repos …] --write <n> [--board o/r] [--dry-run]
 *   node scripts/pm/fleet-roster.mjs --fixture <file.json> [--json] [--now <iso>]   # offline, from a snapshot
 *   node scripts/pm/fleet-roster.mjs --health [--repos …] [--json] [--fixture <file.json>] [--now <iso>]   # read-only
 *   node scripts/pm/fleet-roster.mjs --self-test                                # offline, no network
 *
 * ## `--health` — the round report's five health indicators (read-only, never writes)
 *
 * `seat-lifecycle.md` 〈轮次报告与节奏〉 defines five indicators and `dispatch-runbook.md` 〈分诊两级盘点细则〉 how
 * each is read; a seat retyped both every round. `--health` prints them, one line each, under a header with the
 * reading time and the repos read (`HEALTH_RULE_FILES` pins every phrase it is built from):
 *
 *   1  可派发库存 — open `pm:queue` issues with no assignee, per repo and total. The TREND is never printed: it needs
 *      an earlier reading of the same count and none is durable (the roster body carries the inbox line only), so it
 *      is a named unread leg.
 *   2  决策箱 — `决策卡 N · 待您审合 PR M` by `inboxTotals`, never summed; and the decision cards an open card names
 *      on a `Blocked-by:` line, computed now by `blockerTargetsFor` (body of every open card, thread of every
 *      `pm:blocked` card), across every repo read.
 *   3  finding — the bare `finding` label count (= the ungraded count: a held card has changed label), median age.
 *   4  裸卡 — first-touch-sweep's disjunction ① from the sweep's OWN walk (no separate query, the runbook's bare-card
 *      exception), median age = first-touch debt; the ungraded count apart, from disjunction ④.
 *   5  发版阻塞 — open `priority:p0` issues summed over the repos read. Which three repos the rule means and what
 *      窗内 bounds are not machine-readable from the rule text, so both are named unread legs and the reading used
 *      is printed. The total open count is deliberately not an indicator.
 *
 * One walk per repo: `first-touch-sweep.mjs`'s `sweep()` runs with an injected reader that also keeps the rows it
 * walked, so ①/④ and every other indicator come off one enumeration that already equals the platform's open count.
 * Each label count is then checked against its platform reading, `GET /search/issues?q=…&per_page=1`'s
 * `total_count` (runbook 之三 and 「每条枚举比对返回数与 totalCount」): a gap, an unread thread, an unread leg of the
 * walk or an unreadable repo makes the run INCOMPLETE with the gap named — ⛔ never a clean-looking number.
 *
 * Exits under `--health`: 0 complete · 2 usage (`--health --write` included) · 3 no repo answered, or the fixture
 * has no `health` section · 4 INCOMPLETE (`EXIT_INCOMPLETE`; 4 is `EXIT_REFUSED` under `--write`, and the two modes
 * never run together).
 *
 * ## A view, never a second tracker
 *
 * Protocol rule 5 (`cross-repo-coordination.md`) forbids a second tracker: the
 * `pm:*` labels are the state machine and the seat posts are the seat record.
 * So every cell below is DERIVED from a GitHub fact at generation time, and the
 * roster issue's body is overwritten whole on every `--write` — the body opens
 * with `ROSTER_MARKER`, and a hand edit lasts until the next run. Nothing reads
 * the roster back as input; it is for the maintainer's eyes.
 *
 * ## Where each column comes from (per repo in `--repos`, all repo-scoped REST)
 *
 *   seat rows        open issues labelled `pm:seat`; the title is the status
 *                    board `[PM seat] <name> — <status>` (seat-post-protocol.md):
 *                    lane = the name's first token (`domain:x`, `repo:x`,
 *                    `director`, `triage`); seat = `· seat N` or `repo:x#N`,
 *                    else 1; repo = `repo:x`'s repo, else `@ <repo>`, else the
 *                    repo the post lives on.
 *   epic rows        an open `pm:epic` PARENT — sub-issues under it AND a
 *                    `session_…` registration in its body, the paired
 *                    delegation signal (`seat-lifecycle.md` 〈Epic 子树车道〉;
 *                    H45's `h45DelegationNodeSignals`, both halves) — or a
 *                    registered `pm:epic` issue an open mailbox names (a
 *                    parent delegated before its first sub-issue; a child is
 *                    never a seat's mailbox) is lane `epic:#<n>`, with no seat
 *                    post: one row per `epic:#<n>#<k>` seat holding an open
 *                    mailbox, matched by its slug `epic-<n>-<k>` as the mailbox
 *                    column is (seat k, seated by the mailbox's login — opened
 *                    at seating, closed at hand-over), else one row, seat 1,
 *                    status unknown, so an epic seat nobody can ring shows as
 *                    one. No epic in-flight or ruling is read, so an epic row
 *                    is never 「疑似撞墙」.
 *   account          the login after 🟢 in the title, else the post's first
 *                    assignee while seated. `🟢 Routine` reads as Routine.
 *   project          「由 X 账户的项目负责」 in the title or body — the line
 *                    a project-held seat carries.
 *   in flight        open `pm:dispatched` cards of the lane assigned to the
 *                    seat's account. A `repo:x` lane is every card of repo x
 *                    plus the post's own repo's cards labelled `repo:x`; a
 *                    `domain:x` row (a retired domain seat) owns no card — a
 *                    card's `domain:*` label no longer decides who holds it. An account
 *                    on two seats of one lane shows them on its lowest seat
 *                    only; the other reads `= seat N`. An `l2-review` seat (old spelling `review`)
 *                    (`lanes/l2-review.md`) holds no card: its in-flight is the
 *                    open pulls whose CURRENT head a live
 *                    `Contract-review-claim:` signed `l2-review#N` (or `review#N`) holds, read
 *                    off the signed-comment read below — per seat, so two
 *                    L2 seats never share and never read `= seat N`.
 *   awaiting ruling  open `needs-user-decision` cards of the lane (issues, not
 *                    pulls): on the seat whose account is assigned, else on
 *                    the lane's lowest seated seat number, else its lowest.
 *   awaiting merge   open pulls carrying `pm:awaiting-merge` — the PR half of
 *                    the maintainer's inbox (SKILL.md 复核 ②; PRs only, ⛔ never
 *                    an issue) — that close an in-flight card of the seat,
 *                    attributed exactly as awaiting landing is. No new read:
 *                    the labels ride on the open-pulls listing. The line under
 *                    the table counts the two inboxes apart, every repo in:
 *                    「决策卡 N · 待您审合 PR M」, never summed.
 *   awaiting landing open pulls on a `claude/` head that close an in-flight
 *                    card of the seat (`Fixes|Closes|Resolves #n`) and carry a
 *                    review verdict — a `## 席位核对` comment whose verdict
 *                    is ACCEPT, inline on the heading or on a line below it
 *                    (`seat-record.mjs`), or a `## Contract review` with
 *                    `VERDICT: PASS`. ⛔ `pm:mailbox` pulls never count
 *                    (`LEDGER_EXCLUSION`).
 *   wall note        a line-initial `Wall:` (or `撞墙:`) line in the post
 *                    body, the seat's own record of a usage wall.
 *   last activity    the newest of the seat's own traces: the post's
 *                    `updated_at`, its in-flight cards', its mailbox pull's
 *                    (the column below), and every comment of the last
 *                    `STALE_HOURS` signed `LANE#N · ACCOUNT · SESSION` on its
 *                    first line with THIS row's lane and seat — by seat, ⛔
 *                    never by account, so a seat whose account also holds a
 *                    lower seat of its lane (in flight `= seat N`) still reads
 *                    its own work. A seated seat older than `STALE_HOURS` with
 *                    no wall note is flagged 「疑似撞墙」. The comment read
 *                    stops at `STALE_HOURS`, so a flagged row's age can read
 *                    older than a signed comment past that window; the flag
 *                    is exact.
 *   mailbox          open `pm:mailbox` pulls of the SEAT, whichever account
 *                    holds it: the seat on the body's first line
 *                    `Mailbox-of: <seat> · <login>`, or the head
 *                    `mailbox/<login>/<seat-slug>` (`mailboxOwner`, the
 *                    opener's one reading). A legacy per-login mailbox names
 *                    no seat, and an account holds several seats, so which of
 *                    them reads it cannot be told: it is listed under the
 *                    table as assigned to no seat, ⛔ never shown on the
 *                    login's rows. So is a per-seat one whose seat no post
 *                    or epic parent carries.
 *
 * The footer names the generation time and every read made, so a reader can
 * re-run each one.
 *
 * ## `--write <n>` — one stroke, one body, no comment
 *
 * Reads issue n on `--board` (default objectstack-ai/objectstack) first and
 * REFUSES (exit 4) unless it is an open issue labelled `tracking` whose body is
 * empty or already opens with `ROSTER_MARKER`, so a mistyped number can never
 * overwrite a card. Then ONE relay stroke, `issue_patch` of the body, through
 * `fleet-write/dispatch.mjs` as `objectstack-fleet[bot]`. The roster issue is
 * created once by a seat through the relay and pinned by the maintainer; this
 * script never creates, pins or comments. It has no schedule: any
 * seat/takeover/handover calls it.
 *
 * ## Exit codes
 *
 *   0   printed (or written).
 *   2   usage, or the validator refused the stroke. Nothing was sent.
 *   3   prerequisite: a read failed, or the fixture could not be read.
 *   4   refused on the board's state: `--write` names no roster issue.
 *   5+  the relay's own exit (`fleet-write/dispatch.mjs` ladder), passed through.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { validateStroke } from './fleet-write/validate.mjs';
import { ghApi, PER_PAGE, readAllPages } from './gh-pages.mjs';
// The mailbox label, its ledger exclusion, its branch prefix and the reading of
// whose mailbox a pull is have ONE owner, the mailbox opener (#25417, keyed by
// seat since #27637); this file reads them, never re-spells them.
import * as mailboxOpen from './mailbox-open.mjs';
import { isL2ReviewLane, L2_REVIEW_LANE, LEDGER_EXCLUSION, MAILBOX_BRANCH_PREFIX, MAILBOX_LABEL, mailboxOwner, SEAT_EPIC_KIND, seatKey } from './mailbox-open.mjs';
// The seat signature line has ONE spelling, check-half-states' `SEAT_SIGNATURE_LINE`; this file reads it, never
// re-spells it. The relay that imports `ROSTER_MARKER` from here (`fleet-write/dispatch.mjs`) already imports
// check-half-states itself, so this import loads nothing new there. The opener's lane-word lists cannot import it
// (the patrol loads the opener lazily, so that edge would be a cycle); the self-test holds the two equal.
import { GOVERNED_PR_AWAITING_MERGE_LABEL, SEAT_SIGNATURE_LINE } from './check-half-states.mjs';
// `--health`'s reverse read and the inbox label: the shared `Blocked-by:` reader (body and thread, cross-repo keyed)
// and the decision label, imported, never re-spelled.
import { blockerTargetsFor, DECISION_INBOX_LABEL } from './check-half-states.mjs';
import { contractReviewClaimLapse, readContractReviewClaim } from './record-recognisers.mjs';
// The seat record's heading and verdict have ONE reading, shared with H69 in
// check-half-states; this file asks it, never re-spells the heading.
import * as seatRecord from './seat-record.mjs';
import { seatRecordAccepts } from './seat-record.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const PM_DIR = dirname(SELF_PATH);
const REPO_ROOT = join(PM_DIR, '..', '..');
const FIXTURE_PATH = join(PM_DIR, 'fleet-roster.fixture.json');

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = 3;
export const EXIT_REFUSED = 4;
/** `--health` only: a gap, an unread leg or an unreadable repo. Shares 4 with `EXIT_REFUSED`, which only `--write` answers. */
export const EXIT_INCOMPLETE = 4;

export const DEFAULT_REPOS = Object.freeze(['objectstack-ai/objectstack', 'objectstack-ai/objectui', 'objectstack-ai/hotcrm', 'objectstack-ai/mobile']);
export const DEFAULT_BOARD = 'objectstack-ai/objectstack';
export const ROSTER_LABEL = 'tracking';
export const ROSTER_MARKER = '<!-- fleet-roster: generated by scripts/pm/fleet-roster.mjs — every --write replaces this body; never edit by hand -->';
export const STALE_HOURS = 6;
export const SUSPECTED_WALL = '疑似撞墙';


const CARD_BRANCH_PREFIX = 'claude/';
const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const LOGIN_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const SESSION_SHAPE = /^(?:session|cse)_[A-Za-z0-9]+$/;
const NOT_A_LOGIN = new Set(['routine', 'held', 'vacant', 'paused']);
const STATUS_BY_MARK = Object.freeze({ '🟢': 'seated', '⏳': 'vacant', '🔴': 'vacant', '⏸️': 'paused', '⏸': 'paused' });

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { repos: [...DEFAULT_REPOS], reposGiven: false, board: DEFAULT_BOARD, write: null, fixture: null, now: null, json: false, dryRun: false, health: false, selfTest: false, help: false, errors: [] };
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
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--health') opts.health = true;
    else if (a === '--repos') {
      const v = value(a);
      if (v !== null) opts.repos = v.split(',').map((s) => s.trim()).filter(Boolean);
      opts.reposGiven = true;
    } else if (a === '--board') opts.board = value(a);
    else if (a === '--fixture') opts.fixture = value(a);
    else if (a === '--now') opts.now = value(a);
    else if (a === '--write') {
      const v = value(a);
      if (v !== null) opts.write = /^[1-9][0-9]*$/.test(v) ? Number(v) : NaN;
    } else opts.errors.push(`unrecognised argument \`${a}\``);
  }
  if (opts.help || opts.selfTest) return opts;
  if (!opts.repos.length) opts.errors.push('--repos names no repository');
  for (const r of opts.repos) if (!REPO_SHAPE.test(r)) opts.errors.push(`--repos entry ${JSON.stringify(r)} is not shaped owner/name`);
  if (new Set(opts.repos).size !== opts.repos.length) opts.errors.push('--repos names a repository twice');
  if (opts.board !== null && !REPO_SHAPE.test(opts.board)) opts.errors.push(`--board ${JSON.stringify(opts.board)} is not shaped owner/name`);
  if (Number.isNaN(opts.write)) opts.errors.push('--write takes an issue number');
  if (opts.health && opts.write !== null) opts.errors.push('--health is read-only and never writes; --write is a separate run');
  if (opts.write !== null && opts.json) opts.errors.push('--write writes the table; --json prints rows — pick one');
  if (opts.write !== null && opts.fixture !== null) opts.errors.push('--write never writes a fixture snapshot');
  if (opts.dryRun && opts.write === null) opts.errors.push('--dry-run only qualifies --write');
  if (opts.now !== null && Number.isNaN(Date.parse(opts.now))) opts.errors.push(`--now ${JSON.stringify(opts.now)} is not a timestamp`);
  return opts;
}

const labelNames = (x) => (Array.isArray(x?.labels) ? x.labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean) : []);
const assigneeLogins = (x) => (Array.isArray(x?.assignees) ? x.assignees.map((a) => (typeof a === 'string' ? a : a?.login)).filter(Boolean) : []);
const lc = (s) => String(s ?? '').toLowerCase();

/** A seat title's lane token: `kind:name`, the L2 seat's word (the one bare lane word that is not all letters), or a bare word. */
const SEAT_TITLE_TOKEN = new RegExp(`^([a-z]+:[A-Za-z0-9._-]+|${L2_REVIEW_LANE}|[a-z]+)`);

/** One seat post's title (and body) → its seat fields, or null when the title is not a status board. Pure. */
export function parseSeat(post, board) {
  const m = /^\[PM seat\]\s+(.+?)\s+—\s+(.+)$/u.exec(String(post?.title ?? ''));
  if (!m) return null;
  const [, name, statusText] = m;
  const owner = board.split('/')[0];
  const token = SEAT_TITLE_TOKEN.exec(name)?.[1] ?? name.split(/\s/)[0];
  const lane = token.replace(/#\d+$/, '');
  const seat = Number(/·\s*seat\s+(\d+)/.exec(name)?.[1] ?? /^repo:[A-Za-z0-9._-]+#(\d+)/.exec(name)?.[1] ?? 1);
  const at = /@\s*([A-Za-z0-9._/-]+)/.exec(name)?.[1] ?? null;
  const repo = lane.startsWith('repo:') ? `${owner}/${lane.slice(5)}` : at ? (at.includes('/') ? at : `${owner}/${at}`) : board;
  const mark = Object.keys(STATUS_BY_MARK).find((k) => statusText.startsWith(k)) ?? null;
  const status = mark ? STATUS_BY_MARK[mark] : 'unknown';
  let account = null;
  let routine = false;
  if (status === 'seated') {
    const word = /^🟢\s*([^\s·]+)/u.exec(statusText)?.[1] ?? '';
    if (lc(word) === 'routine') routine = true;
    else if (LOGIN_SHAPE.test(word) && !NOT_A_LOGIN.has(lc(word))) account = word;
    else account = assigneeLogins(post)[0] ?? null;
  }
  const project = projectOf(post.title) ?? projectOf(post.body);
  return { board, post: post.number, name, lane, seat, repo, status, mark, account, routine, project, wallNote: wallNoteOf(post.body), updatedAt: post.updated_at ?? null };
}

/**
 * The account named by 「由 X 账户的项目负责」, or null. A quoted occurrence (the
 * maintainer's order quoted as 「…「由XX账户的项目负责」」) and the XX placeholder
 * are not a holder. Pure.
 */
export function projectOf(text) {
  for (const m of String(text ?? '').matchAll(/(「?)由\s*(\S+?)\s*账户的项目负责/gu)) {
    if (m[1] || /^X+$/i.test(m[2])) continue;
    return m[2];
  }
  return null;
}

/** The seat's own usage-wall record: a line-initial `Wall:` / `撞墙:` line. Pure. */
export function wallNoteOf(body) {
  const m = /^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?(?:Wall|撞墙)(?:\*\*)?[ \t]*[:：](?:\*\*)?[ \t]*(\S.*?)[ \t]*$/imu.exec(String(body ?? ''));
  return m ? m[1] : null;
}

/** The cards a pull says it closes, as `owner/name#n` keys. Pure. */
export function closingRefs(body, repo) {
  const out = new Set();
  const re = /\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s*:?\s+(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#(\d+)\b/gi;
  for (const m of String(body ?? '').matchAll(re)) out.add(`${m[1] ?? repo}#${m[2]}`);
  return [...out];
}

/** Does this comment list carry a review verdict that lets the pull land? Pure. */
export function hasLandingVerdict(comments) {
  return (Array.isArray(comments) ? comments : []).some((c) => {
    const body = String(c?.body ?? '');
    if (seatRecordAccepts(body)) return true;
    return /^##[ \t]*Contract review\b/m.test(body) && /^[ \t]*(?:\*\*)?VERDICT:[ \t]*PASS\b/im.test(body);
  });
}

/**
 * Is this open `pm:epic` issue a delegated PARENT — sub-issues under it AND a `session_…` registration in its body?
 * Both halves of H45's `h45DelegationNodeSignals` (check-half-states), which the self-test holds this equal to; it is
 * not imported, so the relay (which imports `ROSTER_MARKER` from here) never loads the patrol. A child carries
 * `pm:epic` and a signature's session too, never sub-issues of its own. Pure.
 */
export const isEpicParent = (i) => Number(i?.sub_issues_summary?.total ?? 0) > 0 && isEpicRegistered(i);
/** H45's registration half alone: a `session_…` id in the body. Never a row on its own — every seat-filed child has one. Pure. */
const isEpicRegistered = (i) => /session_[A-Za-z0-9]{4,}/.test(String(i?.body ?? ''));
/**
 * The second condition for an epic row: a registered `pm:epic` issue that an open mailbox already names — a parent
 * delegated before its first sub-issue, whose PM opened `epic:#<n>#<k>` at seating. A child never has a mailbox named
 * after itself. `held` is that issue's seat → login map (`epicSeatsHeld`). Pure.
 */
export const isSeatedFreshEpic = (i, held) => held.size > 0 && isEpicRegistered(i);
/**
 * Epic `lane`'s seats holding an open mailbox, seat → login, matched by `seatKey`'s slug `epic-<n>-<k>` exactly as the
 * mailbox column matches — a `Mailbox-of:` line or a head-only `mailbox/<login>/epic-<n>-<k>` alike. Pure.
 */
export function epicSeatsHeld(lane, mailboxes) {
  const stem = seatKey(lane).slug.replace(/1$/, '');
  return new Map(mailboxes.flatMap((m) => {
    const k = m.slug?.startsWith(stem) ? m.slug.slice(stem.length) : null;
    return k !== null && seatKey(`${lane}#${k}`)?.slug === m.slug ? [[Number(k), m.login]] : [];
  }));
}
const isEpicLane = (lane) => lane.startsWith(`${SEAT_EPIC_KIND}:`);

/** The seat a body is signed by — its FIRST non-empty line, `readSignatureLine`'s reading — as `LANE#N`, or null. Pure. */
export function signedSeatOf(body) {
  const line = String(body ?? '').split(/\r?\n/).find((l) => l.trim() !== '');
  const m = line === undefined ? null : SEAT_SIGNATURE_LINE.exec(line.trim());
  return m ? `${m[1]}#${m[2]}` : null;
}

/** The newest signed-comment time per seat, `LANE#N` → ISO, over every repo's `recentComments`. Pure. */
export function signedActivity(snapshot) {
  const out = new Map();
  for (const repo of Object.keys(snapshot?.repos ?? {})) {
    for (const c of snapshot.repos[repo]?.recentComments ?? []) {
      const seat = signedSeatOf(c?.body);
      const at = c?.updated_at ?? c?.created_at ?? null;
      if (seat !== null && at && !(out.get(seat) >= at)) out.set(seat, at);
    }
  }
  return out;
}

/**
 * The L2 seats' in-flight (`lanes/l2-review.md`; the lane word is the opener's — `l2-review`, old spelling `review`,
 * both read by `isL2ReviewLane`): `l2-review#N` / `review#N` → the open pulls whose CURRENT head a live
 * `Contract-review-claim:` signed by that seat holds (`readContractReviewClaim`, lapse by
 * `contractReviewClaimLapse` from the comment's own `created_at`), over every repo's
 * `recentComments` — the claim lapses in 2 h and the read starts `STALE_HOURS` back, so no
 * live claim is ever past the read. An expired claim, one on a moved head, one on a closed
 * pull or one signed by any other seat is nothing here. Pure.
 */
export function reviewClaims(snapshot, { now }) {
  const nowMs = Date.parse(now);
  const out = new Map();
  for (const repo of Object.keys(snapshot?.repos ?? {})) {
    const s = snapshot.repos[repo] ?? {};
    const heads = new Map((s.pulls ?? []).filter((p) => p.state !== 'closed' && p?.head?.sha).map((p) => [p.number, p.head.sha]));
    for (const c of s.recentComments ?? []) {
      const seat = signedSeatOf(c?.body);
      if (seat === null || !isL2ReviewLane(seat.slice(0, seat.lastIndexOf('#')))) continue;
      const number = Number(/\/issues\/(\d+)$/.exec(String(c?.issue_url ?? ''))?.[1]);
      const claim = readContractReviewClaim(c?.body);
      if (!heads.has(number) || claim.state !== 'read') continue;
      if (contractReviewClaimLapse(claim, { headSha: heads.get(number), now: nowMs, postedAt: Date.parse(c?.created_at ?? '') }) !== 'live') continue;
      out.set(seat, [...(out.get(seat) ?? []), ref(repo, number)]);
    }
  }
  return out;
}

/** Where the signed-comment read starts: `STALE_HOURS` before `now` — no older comment can lift a flag. Pure. */
export const activitySince = (now) => new Date(Date.parse(now) - STALE_HOURS * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A seat row's mailbox slug — its `LANE#N` as the opener spells it in a ref — or null. Pure. */
const seatSlugOf = (row) => seatKey(`${row.lane}#${row.seat}`)?.slug ?? null;

/** Every open `pm:mailbox` pull in the snapshot, with whose it is (`mailboxOwner`), ordered by ref. Pure. */
export function readMailboxes(snapshot) {
  const out = [];
  for (const repo of Object.keys(snapshot?.repos ?? {}).sort()) {
    for (const pr of snapshot.repos[repo]?.pulls ?? []) {
      const owner = pr?.state === 'closed' ? null : mailboxOwner(pr);
      if (owner !== null) out.push({ ref: ref(repo, pr.number), ...owner });
    }
  }
  return out.sort((a, b) => byRef(a.ref, b.ref));
}

/**
 * The mailboxes no seat row reads — flagged under the table, ⛔ never attributed: a legacy per-login mailbox
 * (it names no seat, and its login holds several), or a per-seat one whose seat no seat post carries. Pure.
 */
export function unassignedMailboxes(snapshot, rows) {
  const read = new Set(rows.map(seatSlugOf).filter(Boolean));
  return readMailboxes(snapshot)
    .filter((m) => m.slug === null || !read.has(m.slug))
    .map((m) => ({ ...m, why: m.slug === null ? 'legacy per-login, names no seat' : 'no seat post or epic parent carries this seat' }));
}

// Which lane a card is on. A `repo:x` seat owns its repo's cards (and the post's own repo's cards labelled
// `repo:x`). ⛔ A `domain:x` seat row owns NO card: lanes are seats plus epics, the domain seats retired, and
// a card's `domain:*` label no longer decides who holds it — so the post still shows as a row, with empty
// card columns, until it is retitled or closed.
const cardLaneMatch = (card, row) => {
  if (row.lane.startsWith('repo:')) return card.repo === row.repo || (card.repo === row.board && card.labels.includes(row.lane));
  return false;
};
const ref = (repo, number) => ({ repo, number });
const keyOf = (r) => `${r.repo}#${r.number}`;
const byRef = (a, b) => (a.repo === b.repo ? a.number - b.number : a.repo < b.repo ? -1 : 1);

/**
 * snapshot = { repos: { 'owner/name': { seats, dispatched, rulings, pulls, comments: { '<n>': [...] }, recentComments } } }
 * → the roster rows, deterministically ordered (repo, lane, seat, post). Pure.
 */
export function buildRows(snapshot, { now }) {
  const nowMs = Date.parse(now);
  const repos = Object.keys(snapshot?.repos ?? {}).sort();
  const rows = [];
  const cards = [];
  const rulings = [];
  const pulls = [];
  const mailboxes = readMailboxes(snapshot);
  const signed = signedActivity(snapshot);
  const claimed = reviewClaims(snapshot, { now });
  const pullUpdatedAt = new Map(); // pull key → its updated_at, for the mailbox's share of last activity
  for (const repo of repos) {
    const s = snapshot.repos[repo] ?? {};
    for (const post of s.seats ?? []) {
      if (post.pull_request || !labelNames(post).includes('pm:seat')) continue;
      const seat = parseSeat(post, repo);
      if (seat) rows.push(seat);
    }
    for (const epic of s.epics ?? []) {
      if (epic.pull_request || epic.state === 'closed' || !labelNames(epic).includes('pm:epic')) continue;
      const lane = `${SEAT_EPIC_KIND}:#${epic.number}`;
      // Its seats are the ones holding a mailbox; none open ⇒ seat 1, unknown.
      const held = epicSeatsHeld(lane, mailboxes);
      if (!isEpicParent(epic) && !isSeatedFreshEpic(epic, held)) continue;
      for (const [seat, login] of held.size ? held : new Map([[1, null]])) {
        rows.push({ board: repo, post: epic.number, name: lane, lane, seat, repo, status: login ? 'seated' : 'unknown', mark: login ? '🟢' : null, account: login, routine: false, project: null, wallNote: null, updatedAt: epic.updated_at ?? null });
      }
    }
    const asCard = (i) => ({ repo, number: i.number, labels: labelNames(i), assignees: assigneeLogins(i).map(lc), updatedAt: i.updated_at ?? null });
    for (const i of s.dispatched ?? []) if (!i.pull_request && i.state !== 'closed') cards.push(asCard(i));
    for (const i of s.rulings ?? []) if (!i.pull_request && i.state !== 'closed') rulings.push(asCard(i));
    for (const p of s.pulls ?? []) {
      if (p.state === 'closed') continue;
      pulls.push({ repo, pr: p, comments: s.comments?.[String(p.number)] ?? [] });
      pullUpdatedAt.set(keyOf(ref(repo, p.number)), p.updated_at ?? null);
    }
  }
  rows.sort((a, b) => (a.repo !== b.repo ? (a.repo < b.repo ? -1 : 1) : a.lane !== b.lane ? (a.lane < b.lane ? -1 : 1) : a.seat !== b.seat ? a.seat - b.seat : a.post - b.post));

  const landing = new Map(); // card key → [pull refs]
  for (const { repo, pr, comments } of pulls) {
    // Every `pm:mailbox` pull is a mailbox, whosever it reads as, and ⛔ never counts as landing.
    if (mailboxOwner(pr) !== null || !String(pr?.head?.ref ?? '').startsWith(CARD_BRANCH_PREFIX) || !hasLandingVerdict(comments)) continue;
    for (const k of closingRefs(pr.body, repo)) landing.set(k, [...(landing.get(k) ?? []), ref(repo, pr.number)]);
  }
  const merging = new Map(); // card key → [pull refs carrying the awaiting-merge label]
  for (const { repo, pr } of pulls) {
    // The label IS the reading (a seat wrote it beside the approval request, SKILL.md 复核 ②): no verdict walk,
    // no head-prefix test. A mailbox pull never counts, whatever it carries.
    if (mailboxOwner(pr) !== null || !labelNames(pr).includes(GOVERNED_PR_AWAITING_MERGE_LABEL)) continue;
    for (const k of closingRefs(pr.body, repo)) merging.set(k, [...(merging.get(k) ?? []), ref(repo, pr.number)]);
  }

  const out = rows.map((row) => {
    const acct = lc(row.account);
    // An L2 seat's claims are signed per seat, so it never shares: its in-flight is the pulls its live claims hold.
    const claims = isL2ReviewLane(row.lane) ? (claimed.get(`${row.lane}#${row.seat}`) ?? []).sort(byRef) : null;
    // One account on two seats of one lane: the cards cannot say which seat, so the lowest seat shows them once.
    const first = row.account && claims === null ? rows.find((r) => r.repo === row.repo && r.lane === row.lane && lc(r.account) === acct) : row;
    const sharesWith = first !== row ? first.seat : null;
    const inFlight = row.account && sharesWith === null && claims === null ? cards.filter((c) => cardLaneMatch(c, row) && c.assignees.includes(acct)) : [];
    const awaitingLanding = inFlight.flatMap((c) => landing.get(keyOf(c)) ?? []);
    const awaitingMerge = inFlight.flatMap((c) => merging.get(keyOf(c)) ?? []);
    // Per seat, never per account: one account holds several seats, and each seat opens its own.
    const mailbox = mailboxes.filter((m) => m.slug !== null && m.slug === seatSlugOf(row)).map((m) => m.ref);
    // The seat's own traces: a seat sharing its lane's account with a lower seat has no in-flight cards of its own.
    const times = [row.updatedAt, ...inFlight.map((c) => c.updatedAt), ...(claims ?? []).map((m) => pullUpdatedAt.get(keyOf(m))), ...mailbox.map((m) => pullUpdatedAt.get(keyOf(m))), signed.get(`${row.lane}#${row.seat}`)].filter(Boolean).sort();
    const lastActivity = times.at(-1) ?? null;
    const ageHours = lastActivity && Number.isFinite(nowMs) ? (nowMs - Date.parse(lastActivity)) / 3_600_000 : null;
    return {
      ...row,
      sharesWith,
      inFlight: claims ?? inFlight.map((c) => ref(c.repo, c.number)).sort(byRef),
      awaitingRuling: [],
      awaitingLanding: awaitingLanding.sort(byRef),
      awaitingMerge: awaitingMerge.sort(byRef),
      lastActivity,
      suspectedWall: row.status === 'seated' && !isEpicLane(row.lane) && row.wallNote === null && ageHours !== null && ageHours > STALE_HOURS,
      mailbox,
    };
  });

  // A ruling card sits on one row: the lane seat its assignee holds, else the lane's lowest seated seat, else its lowest.
  for (const card of rulings) {
    const lane = out.filter((r) => cardLaneMatch(card, r));
    if (!lane.length) continue;
    const holder = lane.find((r) => r.account && r.sharesWith === null && card.assignees.includes(lc(r.account))) ?? lane.find((r) => r.status === 'seated') ?? lane[0];
    holder.awaitingRuling.push(ref(card.repo, card.number));
  }
  for (const r of out) r.awaitingRuling.sort(byRef);
  return out.map(({ updatedAt, ...r }) => r);
}

const shortRef = (r) => `${r.repo.split('/')[1]}#${r.number}`;
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const refs = (list) => (list.length ? list.map(shortRef).join(' ') : '—');

/** An age in hours as the roster prints it: `<1h`, `Nh` under two days, else `Nd`. Pure. */
const relAge = (h) => (h < 1 ? '<1h' : h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`);

function age(iso, now) {
  if (!iso) return '—';
  return `${iso.slice(0, 16).replace('T', ' ')}Z (${relAge((Date.parse(now) - Date.parse(iso)) / 3_600_000)})`;
}

/**
 * The maintainer's inbox in its two halves, every repo in — counted APART and never summed (maintainer ruling:
 * 「同意 pm:awaiting-merge」). Decision cards are open `needs-user-decision` ISSUES (a pull carrying that label is the
 * retired shape and counts nowhere); awaiting-merge pulls are every open pull carrying `pm:awaiting-merge`, exactly
 * the filter the maintainer opens — the column above is the per-seat attribution of the same pulls. Pure.
 */
export function inboxTotals(snapshot) {
  let decisionCards = 0;
  let awaitingMergePulls = 0;
  for (const s of Object.values(snapshot?.repos ?? {})) {
    for (const i of s.rulings ?? []) if (!i.pull_request && i.state !== 'closed') decisionCards++;
    for (const p of s.pulls ?? []) if (p.state !== 'closed' && labelNames(p).includes(GOVERNED_PR_AWAITING_MERGE_LABEL)) awaitingMergePulls++;
  }
  return { decisionCards, awaitingMergePulls };
}

/** The reads made for `repos`, in the order made — the footer's provenance. Pure. */
export function readsFor(repos) {
  return repos.flatMap((r) => [
    `GET /repos/${r}/issues?state=open&labels=pm:seat`,
    `GET /repos/${r}/issues?state=open&labels=pm:epic`,
    `GET /repos/${r}/issues?state=open&labels=pm:dispatched`,
    `GET /repos/${r}/issues?state=open&labels=needs-user-decision`,
    `GET /repos/${r}/pulls?state=open`,
    `GET /repos/${r}/issues/comments?since=(now − ${STALE_HOURS} h), each read for its first-line seat signature and, signed l2-review#N (old spelling review#N), for a live Contract-review-claim`,
    `GET /repos/${r}/issues/{n}/comments for each claude/ pull closing an in-flight card (${LEDGER_EXCLUSION} excluded)`,
  ]);
}

/** The roster body, markdown; `unassigned` is `unassignedMailboxes`' list. Pure. */
export function renderBody(rows, { now, repos, session = null, unassigned = [], inboxes = null }) {
  const lines = [
    ROSTER_MARKER,
    '# 车队总表 — fleet roster',
    '',
    'A generated view of the seat posts (`pm:seat`), the `pm:*` labels, assignees and open pulls — **never a second tracker**: the cards and seat posts are the record, and the next run overwrites this body.',
    '',
    '| repo | lane | seat | account | in flight | awaiting ruling | awaiting merge | awaiting landing | wall note | last activity | mailbox PR |',
    '|:--|:--|:-:|:--|:--|:--|:--|:--|:--|:--|:--|',
  ];
  for (const r of rows) {
    const who = r.routine ? 'Routine' : r.account ? `\`${r.account}\`` : '—';
    const account = `${r.mark ?? '?'} ${who}${r.project ? ` · 由 ${r.project} 账户的项目负责` : ''}`;
    const wall = r.wallNote ?? (r.suspectedWall ? `⚠️ ${SUSPECTED_WALL}` : '—');
    const inFlight = r.sharesWith !== null ? `= seat ${r.sharesWith}` : refs(r.inFlight);
    lines.push(
      `| ${r.repo.split('/')[1]} | ${cell(r.lane)} | [${r.seat}](https://github.com/${r.board}/issues/${r.post}) | ${cell(account)} | ${inFlight} | ${refs(r.awaitingRuling)} | ${refs(r.awaitingMerge)} | ${refs(r.awaitingLanding)} | ${cell(wall)} | ${age(r.lastActivity, now)} | ${refs(r.mailbox)} |`,
    );
  }
  const seated = rows.filter((r) => r.status === 'seated');
  lines.push(
    '',
    `${rows.length} seat rows (${rows.filter((r) => isEpicLane(r.lane)).length} epic) · ${seated.length} seated · ${rows.filter((r) => r.suspectedWall).length} ${SUSPECTED_WALL} (seated, no \`Wall:\` line, last activity older than ${STALE_HOURS} h).`,
    ...(inboxes
      ? ['', `决策卡 ${inboxes.decisionCards} · 待您审合 PR ${inboxes.awaitingMergePulls} — the maintainer's inbox in its two halves, every repo in: open \`needs-user-decision\` issues (a letter owed) and open \`pm:awaiting-merge\` pulls (a review and a click owed), never summed.`]
      : []),
    ...(unassigned.length
      ? ['', `⚠️ ${unassigned.length} mailbox PR(s) on no seat row — never attributed to an account's seats; close a legacy one and open one per seat: ${unassigned.map((m) => `${shortRef(m.ref)} (${[m.seat ?? m.slug, m.login].filter(Boolean).join(' · ') || 'no owner'}: ${m.why})`).join(' · ')}.`]
      : []),
    '',
    `Generated ${now} by \`node scripts/pm/fleet-roster.mjs --repos ${repos.join(',')}\` from:`,
    ...readsFor(repos).map((q) => `- \`${q}\``),
  );
  return lines.join('\n') + bodyFooter(session);
}

/** The footer in the form an issue BODY keeps: session-URL when the session is known. */
export function bodyFooter(session) {
  const id = typeof session === 'string' && SESSION_SHAPE.test(session) ? session.replace(/^cse_/, 'session_') : null;
  return `\n\n---\n_Generated by [Claude Code](https://claude.ai/code${id ? `/${id}` : ''})_`;
}

/** Why issue `n` may not be overwritten as the roster, or null when it may. Pure. */
export function writeRefusal(issue, n) {
  if (!issue || typeof issue !== 'object') return `#${n} could not be read`;
  if (issue.pull_request) return `#${n} is a pull request, not the roster issue`;
  if (issue.state !== 'open') return `#${n} is ${issue.state}, not open`;
  if (!labelNames(issue).includes(ROSTER_LABEL)) return `#${n} is not labelled \`${ROSTER_LABEL}\``;
  const body = String(issue.body ?? '').trim();
  if (body && !body.startsWith(ROSTER_MARKER)) return `#${n}'s body does not open with the roster marker — it is not a roster this script wrote`;
  return null;
}

export function planWrite({ board, issue, body }) {
  const actions = [{ op: 'issue_patch', issue, body }];
  return { board, issue, actions, errors: validateStroke(board, actions) };
}

// ---------------------------------------------------------------------------
// `--health` — the round report's five health indicators (read-only)
// ---------------------------------------------------------------------------

/** Where the five indicators and their reading are written, and the phrases this mode is built from (self-test pins each). */
export const HEALTH_RULE_FILES = Object.freeze({
  '.claude/skills/pm-dispatch/references/seat-lifecycle.md': [
    '健康指标五个:可派发库存(open `pm:queue` 未认领及趋势);决策箱:决策卡 N·待您审合 PR M',
    'M = open `pm:awaiting-merge` PR,两数 ⛔ 不合计;决策卡点名有开放下游者(`Blocked-by:` 反查现算)',
    'finding 数与中位年龄:裸标签数即未定级数,hold 已换标不在内',
    '裸卡数与中位年龄:sweep 析取①,未定级数另计析取④;老化 = 首触欠账',
    '发版阻塞 = 窗内三仓 open `priority:p0` 之和,归零 = 三张板都空;总 open 数刻意不在指标内',
    '`fleet-roster.mjs --health`',
  ],
  '.claude/skills/pm-dispatch/references/dispatch-runbook.md': [
    '之三,健康指标 = 逐标签 `perPage: 1` 只读 `totalCount`',
    '裸卡数例外:标签缺席无计数可读,取本轮析取①的枚举,⛔ 不另发查询',
    '每条枚举比对返回数与 `totalCount`',
    '`fleet-roster.mjs --health`',
  ],
  // The release-board neighbour the 「三仓」 leg quotes: it names TWO boards, so the rule's three are unread.
  '.claude/skills/pm-dispatch/references/seat-post-protocol.md': ['两仓两条查询 `label:priority:p0 is:open`'],
});

export const QUEUE_LABEL = 'pm:queue';
export const FINDING_LABEL = 'finding';
export const P0_LABEL = 'priority:p0';
export const BLOCKED_LABEL = 'pm:blocked';
const hasLabel = (i, name) => labelNames(i).map(lc).includes(name);

/**
 * Each label count's platform reading (`GET /search/issues?q=repo:R <q>&per_page=1` → `total_count`, runbook 之三)
 * beside the walk predicate it is checked against. `open` is the sweep's own count, listed so the fixture answers it.
 */
export const HEALTH_COUNTS = Object.freeze({
  queue: { q: `is:issue is:open label:${QUEUE_LABEL} no:assignee`, of: (i) => hasLabel(i, QUEUE_LABEL) && assigneeLogins(i).length === 0 },
  decision: { q: `is:issue is:open label:${DECISION_INBOX_LABEL}`, of: (i) => hasLabel(i, DECISION_INBOX_LABEL) },
  finding: { q: `is:issue is:open label:${FINDING_LABEL}`, of: (i) => hasLabel(i, FINDING_LABEL) },
  p0: { q: `is:issue is:open label:${P0_LABEL}`, of: (i) => hasLabel(i, P0_LABEL) },
});
export const OPEN_ISSUES_QUERY = 'is:issue is:open';
export const AWAITING_MERGE_QUERY = `is:pr is:open label:${GOVERNED_PR_AWAITING_MERGE_LABEL}`;
export const searchPath = (repo, q, perPage = 1) => `/search/issues?q=${encodeURIComponent(`repo:${repo} ${q}`)}&per_page=${perPage}`;

/** The legs `--health` cannot read, printed under every run so an absent leg never reads as clean. */
export const HEALTH_UNREAD_LEGS = Object.freeze([
  "the inventory's trend (可派发库存 …及趋势) — a trend needs an earlier reading of the same count and none is durable: the roster body carries the inbox line only and the round report lives in the chat channel; compare with the previous round's line by hand",
  "发版阻塞's 「三仓」 — the rule names no repos and its neighbour (`seat-post-protocol.md` 发版板运维) names two boards, the main repo and cloud; this run sums the repos it read (`--repos`; the default list holds no cloud board)",
  "the release window (窗内) — the rule names no machine reading of it; every open p0 counts, main-red anchors included, as the maintainer's own query lists them",
  "a `Blocked-by:` line in a comment of a card that is not `pm:blocked` — the body line is read on every open card, the thread only on `pm:blocked` cards",
  'a downstream card in a repository outside `--repos` — the reverse read sees only the repos read',
]);

/** The median of a list of numbers, or null for an empty one. Pure. */
export function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const ageHours = (i, nowMs) => (nowMs - Date.parse(i?.created_at ?? '')) / 3_600_000;
const medianAge = (list, nowMs) => median(list.map((i) => ageHours(i, nowMs)).filter(Number.isFinite));
const shortRepo = (r) => r.split('/')[1];

/**
 * The five indicators from the per-repo readings (`readHealthRepo`'s shape, or `{ repo, unreadable }`). Pure.
 * Every gap a reading carries, and every repo that did not answer, is a gap of the whole run.
 */
export function judgeHealth(readings, { nowMs }) {
  const read = readings.filter((r) => !r.unreadable);
  const gaps = [
    ...readings.filter((r) => r.unreadable).map((r) => `${r.repo} could not be read — ${r.unreadable}`),
    ...read.flatMap((r) => r.gaps.map((g) => `${r.repo}: ${g}`)),
  ];
  const perRepo = (fn) => read.map((r) => ({ repo: r.repo, n: fn(r) }));
  const total = (list) => list.reduce((a, b) => a + b.n, 0);
  const inbox = inboxTotals({ repos: Object.fromEntries(read.map((r) => [r.repo, { rulings: r.counts.decision.walk, pulls: r.pulls }])) });
  const decision = new Map(read.flatMap((r) => r.counts.decision.walk.map((i) => [`${r.repo}#${i.number}`, []])));
  for (const r of read) {
    for (const i of r.rows) {
      for (const t of blockerTargetsFor(i, r.comments.get(i.number), r.repo)) if (decision.has(t.key)) decision.get(t.key).push(`${r.repo}#${i.number}`);
    }
  }
  const findings = read.flatMap((r) => r.counts.finding.walk);
  const bare = read.flatMap((r) => r.sweep.found[1]);
  const queue = perRepo((r) => r.counts.queue.walk.length);
  const p0 = perRepo((r) => r.counts.p0.walk.length);
  return {
    repos: readings.map((r) => r.repo),
    walks: readings.map((r) => (r.unreadable ? { repo: r.repo, unreadable: r.unreadable } : { repo: r.repo, enumerated: r.sweep.enumerated, pages: r.sweep.pages, totalCount: r.sweep.totalCount })),
    inventory: { total: total(queue), perRepo: queue, trend: null },
    inbox: { decisionCards: inbox.decisionCards, awaitingMergePulls: inbox.awaitingMergePulls, downstream: [...decision].filter(([, deps]) => deps.length).map(([card, dependents]) => ({ card, dependents })) },
    findings: { total: findings.length, medianAgeHours: medianAge(findings, nowMs), perRepo: perRepo((r) => r.counts.finding.walk.length) },
    bare: { total: bare.length, medianAgeHours: medianAge(bare, nowMs), ungraded: read.reduce((a, r) => a + r.sweep.found[4].length, 0), perRepo: perRepo((r) => r.sweep.found[1].length), cards: read.flatMap((r) => r.sweep.found[1].map((i) => `${r.repo}#${i.number}`)) },
    releaseBlockers: { total: total(p0), perRepo: p0 },
    gaps,
    complete: gaps.length === 0,
    unanswered: read.length === 0,
  };
}

/** The exit `--health` answers for a judged report. Pure. */
export const healthExit = (h) => (h.unanswered ? EXIT_PREREQUISITE : h.complete ? EXIT_OK : EXIT_INCOMPLETE);

/** The text `--health` prints: a header, one line per indicator, the unread legs, the verdict. Pure. */
export function renderHealth(h, { now }) {
  const split = (list) => list.map((x) => `${shortRepo(x.repo)} ${x.n}`).join(' · ');
  const ageOf = (hrs) => (hrs === null ? 'no card' : relAge(hrs));
  const ref = (key) => key.replace(/^[^/]+\//, '');
  const lines = [
    `fleet-roster --health — read ${now} · repos ${h.repos.join(', ')} · read-only, nothing written`,
    `walk: ${h.walks.map((w) => (w.unreadable ? `${w.repo} UNREAD` : `${w.repo} ${w.enumerated} open issue(s) over ${w.pages} page(s) · the platform counts ${w.totalCount}`)).join(' · ')}`,
    `1 可派发库存 — open ${QUEUE_LABEL}, no assignee: ${h.inventory.total} (${split(h.inventory.perRepo)}) · trend unread (named below)`,
    `2 决策箱 — 决策卡 ${h.inbox.decisionCards} · 待您审合 PR ${h.inbox.awaitingMergePulls} (two inboxes, never summed) · decision cards an open card names on a Blocked-by: line (reverse read, now): ${h.inbox.downstream.length} of ${h.inbox.decisionCards}${h.inbox.downstream.length ? ` — ${h.inbox.downstream.map((d) => `${ref(d.card)} ← ${d.dependents.map(ref).join(', ')}`).join('; ')}` : ''}`,
    `3 finding — ${h.findings.total} open (the bare label is the ungraded count; a held card has changed label), median age ${ageOf(h.findings.medianAgeHours)} (${split(h.findings.perRepo)})`,
    `4 裸卡 — ${h.bare.total} bare (first-touch-sweep ①, off the sweep's own walk), median age ${ageOf(h.bare.medianAgeHours)} = first-touch debt · ungraded (④) ${h.bare.ungraded} (${split(h.bare.perRepo)})`,
    `5 发版阻塞 — open ${P0_LABEL} issues summed over the repos read: ${h.releaseBlockers.total} (${split(h.releaseBlockers.perRepo)}); zero means every board read is empty · the total open count is deliberately not an indicator`,
    'Not read by this reader — the seat reads these itself:',
    ...HEALTH_UNREAD_LEGS.map((l) => `  · ${l}`),
    h.unanswered
      ? `fleet-roster --health CAN'T READ — no repository answered: ${h.gaps.join('; ')}. ⛔ No indicator was read.`
      : h.complete
        ? 'fleet-roster --health COMPLETE — five indicators, every count checked against the platform\'s.'
        : `fleet-roster --health INCOMPLETE — ${h.gaps.length} gap(s): ${h.gaps.join('; ')}. ⛔ Not a clean reading: re-run when the reads answer.`,
  ];
  return lines.join('\n');
}

/** `--health --json`'s object. Pure. */
export function healthJson(h, { now }) {
  return { now, ...h, unreadLegs: HEALTH_UNREAD_LEGS, exit: healthExit(h) };
}

/**
 * One repo's health reading through `get` (`{ ok, value | error }`). The sweep (`first-touch-sweep.mjs`, imported
 * lazily so the relay that imports `ROSTER_MARKER` loads nothing new) walks the open issues; its reader keeps the rows
 * it walked, so every indicator comes off that one walk. `sweepFn` is injected by the self-test only.
 */
export async function readHealthRepo(repo, { get, nowMs, sweepFn = null }) {
  const sweep = sweepFn ?? (await import('./first-touch-sweep.mjs')).sweep;
  const gaps = [];
  const rows = [];
  let lastError = null;
  const walkPrefix = `/repos/${repo}/issues?`;
  const sweepGet = (path) => {
    const r = get(path);
    if (!r.ok) {
      lastError = r.error;
      return { status: 0, json: null };
    }
    if (path.startsWith(walkPrefix) && Array.isArray(r.value)) rows.push(...r.value.filter((x) => !x?.pull_request));
    return { status: 200, json: r.value };
  };
  const sw = await sweep({ repo, nowMs, get: sweepGet });
  if (sw.prerequisite) return { repo, unreadable: `${sw.prerequisite}${lastError ? ` (${lastError})` : ''}` };
  if (!sw.complete) gaps.push(`the walk is not whole — ${sw.why.join('; ')}`);
  if (rows.length !== sw.enumerated) gaps.push(`the sweep enumerated ${sw.enumerated} open issue(s) and this reader kept ${rows.length} of its walk, so no indicator is read off it`);
  const counts = {};
  for (const [key, { q, of }] of Object.entries(HEALTH_COUNTS)) {
    const walk = rows.filter(of);
    const t = get(searchPath(repo, q));
    if (!t.ok || typeof t.value?.total_count !== 'number') gaps.push(`${key}: the platform count did not answer (${t.ok ? 'no total_count' : t.error})`);
    else if (t.value.incomplete_results === true) gaps.push(`${key}: the platform count answered incomplete_results`);
    else if (t.value.total_count !== walk.length) gaps.push(`${key}: the walk holds ${walk.length} and the platform counts ${t.value.total_count}`);
    counts[key] = { walk };
  }
  let pulls = [];
  const m = get(searchPath(repo, AWAITING_MERGE_QUERY, PER_PAGE));
  if (!m.ok || !Array.isArray(m.value?.items)) gaps.push(`awaiting-merge pulls did not answer (${m.ok ? 'no items' : m.error})`);
  else {
    pulls = m.value.items;
    if (pulls.length !== m.value.total_count) gaps.push(`awaiting-merge pulls: listed ${pulls.length} and the platform counts ${m.value.total_count}`);
  }
  const comments = new Map();
  for (const i of rows.filter((x) => hasLabel(x, BLOCKED_LABEL))) {
    const r = readAllPages(`/repos/${repo}/issues/${i.number}/comments`, { get });
    if (!r.ok) gaps.push(`#${i.number}'s thread could not be read (${r.error}), so its comment-borne Blocked-by: lines are unread`);
    else comments.set(i.number, r.value.map((c) => String(c?.body ?? '')));
  }
  return { repo, rows, sweep: sw, counts, pulls, comments, gaps };
}

/**
 * The `get` a `--fixture`'s `health` section answers, path for path as the live reads ask. `health.repos[R]` is
 * `{ issues, pulls, comments: { n: [bodies] | null }, totals: { open|queue|decision|finding|p0|merge: n } }`, or
 * `null` (unreadable: HTTP 403). A search total defaults to the walk predicate's count; `totals` sets the platform's.
 */
export function healthFixtureGet(health) {
  return (path) => {
    const [bare, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    const page = Number(params.get('page') ?? 1);
    const slice = (list) => list.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const repoOf = (r) => (Object.hasOwn(health?.repos ?? {}, r) ? health.repos[r] : undefined);
    let m = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(bare);
    if (m) {
      const s = repoOf(m[1]);
      return s ? { ok: true, value: slice(s.issues ?? []) } : { ok: false, error: s === null ? 'HTTP 403' : 'HTTP 404' };
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/.exec(bare))) {
      const s = repoOf(m[1]);
      const bodies = s?.comments?.[m[2]];
      if (!s || bodies === null) return { ok: false, error: 'HTTP 502' };
      return { ok: true, value: slice((bodies ?? []).map((body) => ({ body }))) };
    }
    if (bare === '/search/issues') {
      const q = /^repo:(\S+) (.*)$/.exec(params.get('q') ?? '');
      const s = q ? repoOf(q[1]) : undefined;
      if (!s) return { ok: false, error: s === null ? 'HTTP 403' : 'HTTP 422' };
      const issues = s.issues ?? [];
      if (q[2] === AWAITING_MERGE_QUERY) {
        const items = (s.pulls ?? []).filter((p) => hasLabel(p, GOVERNED_PR_AWAITING_MERGE_LABEL));
        return { ok: true, value: { total_count: s.totals?.merge ?? items.length, incomplete_results: false, items } };
      }
      if (q[2] === OPEN_ISSUES_QUERY) return { ok: true, value: { total_count: s.totals?.open ?? issues.length, incomplete_results: false, items: [] } };
      const key = Object.keys(HEALTH_COUNTS).find((k) => HEALTH_COUNTS[k].q === q[2]);
      if (!key) return { ok: false, error: 'HTTP 422' };
      return { ok: true, value: { total_count: s.totals?.[key] ?? issues.filter(HEALTH_COUNTS[key].of).length, incomplete_results: false, items: [] } };
    }
    return { ok: false, error: `HTTP 404 (${bare})` };
  };
}

/**
 * Live search reads spaced `SEARCH_SPACING_MS` apart: the search API's secondary rate limit was measured firing on a
 * second repo's counts read back to back. A count still refused is a named gap, never retried into a number.
 */
export const SEARCH_SPACING_MS = 2500;
export function pacedSearch(get, sleep) {
  let last = -Infinity;
  return (path) => {
    if (path.startsWith('/search/')) {
      const wait = last + SEARCH_SPACING_MS - Date.now();
      if (wait > 0) sleep(wait);
      last = Date.now();
    }
    return get(path);
  };
}
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Read every repo and judge: the whole `--health` run as data. */
export async function readHealth(repos, { get, nowMs, sweepFn = null }) {
  const readings = [];
  for (const repo of repos) readings.push(await readHealthRepo(repo, { get, nowMs, sweepFn }));
  return judgeHealth(readings, { nowMs });
}

// ---------------------------------------------------------------------------
// The live edges — `gh api` reads (paged by `gh-pages.mjs`), the relay
// ---------------------------------------------------------------------------

function ghJson(path, { paginate = false } = {}) {
  return paginate ? readAllPages(path) : ghApi(path);
}

/** Read every repo into the snapshot shape `buildRows` takes; throws on the first failed read. */
function readLive(repos, { since }) {
  const need = (path, paginate = true) => {
    const r = ghJson(path, { paginate });
    if (!r.ok) throw new Error(`GET ${path} — ${r.error}`);
    return r.value;
  };
  const snapshot = { repos: {} };
  for (const repo of repos) {
    const s = {
      seats: need(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent('pm:seat')}&per_page=100`),
      epics: need(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent('pm:epic')}&per_page=100`),
      dispatched: need(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent('pm:dispatched')}&per_page=100`),
      rulings: need(`/repos/${repo}/issues?state=open&labels=needs-user-decision&per_page=100`),
      pulls: need(`/repos/${repo}/pulls?state=open&per_page=100`),
      comments: {},
      recentComments: need(`/repos/${repo}/issues/comments?since=${encodeURIComponent(since)}&per_page=100`),
    };
    snapshot.repos[repo] = s;
  }
  // Comments only for the pulls that could fill "awaiting landing": a claude/ head, not a mailbox, closing a dispatched card.
  const dispatched = new Set(Object.entries(snapshot.repos).flatMap(([repo, s]) => s.dispatched.map((i) => `${repo}#${i.number}`)));
  for (const [repo, s] of Object.entries(snapshot.repos)) {
    for (const p of s.pulls) {
      if (mailboxOwner(p) !== null || !String(p.head?.ref ?? '').startsWith(CARD_BRANCH_PREFIX)) continue;
      if (!closingRefs(p.body, repo).some((k) => dispatched.has(k))) continue;
      s.comments[String(p.number)] = need(`/repos/${repo}/issues/${p.number}/comments?per_page=100`);
    }
  }
  return snapshot;
}

function sendStroke(plan, { json }) {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-roster-'));
  try {
    const file = join(dir, 'actions.json');
    writeFileSync(file, `${JSON.stringify(plan.actions, null, 2)}\n`);
    const r = spawnSync(process.execPath, [join(PM_DIR, 'fleet-write', 'dispatch.mjs'), '--repo', plan.board, '--actions-file', file, ...(json ? ['--json'] : [])], { stdio: 'inherit', cwd: REPO_ROOT });
    return typeof r.status === 'number' ? r.status : EXIT_PREREQUISITE;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const USAGE = [
  'usage:',
  '  node scripts/pm/fleet-roster.mjs [--repos owner/a,owner/b,…] [--json]',
  '  node scripts/pm/fleet-roster.mjs [--repos …] --write <issue> [--board owner/name] [--dry-run]',
  '  node scripts/pm/fleet-roster.mjs --fixture <snapshot.json> [--json] [--now <iso>]',
  '  node scripts/pm/fleet-roster.mjs --health [--repos …] [--json] [--fixture <snapshot.json>] [--now <iso>]',
  '  node scripts/pm/fleet-roster.mjs --self-test',
  `  Exits: ${EXIT_OK} done · ${EXIT_USAGE} usage or refused stroke · ${EXIT_PREREQUISITE} prerequisite · ${EXIT_REFUSED} refused on board state · 5+ the relay's own exit`,
  `  --health exits: ${EXIT_OK} complete · ${EXIT_USAGE} usage · ${EXIT_PREREQUISITE} no repository answered · ${EXIT_INCOMPLETE} INCOMPLETE (a gap named)`,
].join('\n');

async function runHealth(opts) {
  let get = pacedSearch(ghApi, sleepMs);
  let repos = opts.repos;
  let nowIso = opts.now;
  if (opts.fixture !== null) {
    let health;
    try {
      health = JSON.parse(readFileSync(opts.fixture, 'utf8')).health;
    } catch (e) {
      console.error(`✗ fleet-roster --health: could not read the fixture ${opts.fixture} — ${e.message}.`);
      return EXIT_PREREQUISITE;
    }
    if (!health || typeof health !== 'object' || !health.repos) {
      console.error(`✗ fleet-roster --health: the fixture ${opts.fixture} carries no \`health\` section.`);
      return EXIT_PREREQUISITE;
    }
    get = healthFixtureGet(health);
    if (!opts.reposGiven) repos = Object.keys(health.repos);
    nowIso ??= health.now ?? null;
  }
  const now = new Date(nowIso ?? Date.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const h = await readHealth(repos, { get, nowMs: Date.parse(now) });
  console.log(opts.json ? JSON.stringify(healthJson(h, { now }), null, 2) : renderHealth(h, { now }));
  return healthExit(h);
}

export async function main(argv, { env = process.env } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (opts.selfTest) return selfTest();
  if (opts.errors.length) {
    for (const e of opts.errors) console.error(`fleet-roster: ${e}`);
    console.error(`\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (opts.health) return runHealth(opts);
  let snapshot;
  let repos = opts.repos;
  try {
    if (opts.fixture !== null) {
      snapshot = JSON.parse(readFileSync(opts.fixture, 'utf8'));
      repos = Object.keys(snapshot.repos ?? {}).sort();
    } else snapshot = readLive(repos, { since: activitySince(opts.now ?? new Date().toISOString()) });
  } catch (e) {
    console.error(`✗ fleet-roster: ${opts.fixture !== null ? `could not read the fixture ${opts.fixture}` : 'a read failed'} — ${e.message}. Nothing was written.`);
    return EXIT_PREREQUISITE;
  }
  const now = new Date(opts.now ?? snapshot.now ?? Date.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const rows = buildRows(snapshot, { now });
  const unassigned = unassignedMailboxes(snapshot, rows);
  if (opts.json) {
    console.log(JSON.stringify({ now, repos, rows, unassignedMailboxes: unassigned, inboxes: inboxTotals(snapshot) }, null, 2));
    return EXIT_OK;
  }
  const session = env.OS_FLEET_SESSION || env.CLAUDE_CODE_REMOTE_SESSION_ID || null;
  const body = renderBody(rows, { now, repos, session, unassigned, inboxes: inboxTotals(snapshot) });
  if (opts.write === null) {
    console.log(body);
    return EXIT_OK;
  }
  const plan = planWrite({ board: opts.board, issue: opts.write, body });
  if (plan.errors.length) {
    for (const e of plan.errors) console.error(`✗ fleet-roster: REFUSED by the relay validator — ${e}`);
    console.error('  Nothing was sent.');
    return EXIT_USAGE;
  }
  const read = ghJson(`/repos/${opts.board}/issues/${opts.write}`);
  if (!read.ok) {
    console.error(`✗ fleet-roster: could not read #${opts.write} on ${opts.board} — ${read.error}. Nothing was sent.`);
    return EXIT_PREREQUISITE;
  }
  const refusal = writeRefusal(read.value, opts.write);
  if (refusal) {
    console.error(`✗ fleet-roster: ${refusal}. Nothing was sent.`);
    return EXIT_REFUSED;
  }
  if (opts.dryRun) {
    console.log(`fleet-roster: DRY RUN — #${opts.write} on ${opts.board} is a roster issue; this stroke would be sent:\n${JSON.stringify(plan.actions, null, 2)}`);
    return EXIT_OK;
  }
  const code = sendStroke(plan, opts);
  if (code === EXIT_OK) console.log(`✓ fleet-roster: #${opts.write} on ${opts.board} regenerated (${rows.length} seat rows).`);
  return code;
}

// ---------------------------------------------------------------------------
// Self-test — battery roster, floor and handshake (AGENTS.md § Writing a `--self-test`)
// ---------------------------------------------------------------------------

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'arguments: modes and every refusal': 9,
  'seat titles: lane, seat, repo, status, account, project': 13,
  'wall notes, closing refs, verdicts and mailboxes': 13,
  // 25 → 29: the L2 seat's row, its claim reading, the lane-word pin (lanes/l2-review.md, #29242).
  // 29 → 24: a `domain:` row owns no card any more — nine ownership cases become four that pin it owning nothing,
  // and the positive ownership cases move, as five, to the repo-lane battery below.
  'the fixture snapshot: rows for the three repos': 24,
  'a repo-lane seat owns its repo\'s cards by account: in flight, landing, merge, ruling': 7,
  // 13 → 14: the lane-grammar pin (the signature alternation equals the opener's lane-word lists, `coordinator` aside).
  'one account on two seats of a lane: the second seat reads its own traces': 14,
  'the rendered body: marker, columns, footer, determinism': 11,
  'refusing to overwrite what is not the roster': 6,
  'the CLI: fixture runs offline, usage errors are exit 2': 6,
  'paging: a three-page read through the loop equals the slurped array': 4,
  'the health rule text: every phrase --health is built from is in the file that writes it': 4,
  '--health: five indicators off one walk, every count checked, every gap named': 22,
});
const SELF_TEST_BATTERY_FLOOR = 12;

async function selfTest() {
  let failed = 0;
  let current = null;
  const seen = new Map();
  const battery = (name) => {
    current = name;
  };
  const t = (name, got, want) => {
    seen.set(current, (seen.get(current) ?? 0) + 1);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      failed += 1;
      console.error(`✗ [${current}] ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
    }
  };

  battery('arguments: modes and every refusal');
  const d = parseArgs([]);
  t('defaults: the default repos, board objectstack, no write', [d.errors, d.repos, d.board, d.write], [[], [...DEFAULT_REPOS], DEFAULT_BOARD, null]);
  t('--repos splits on commas', parseArgs(['--repos', 'o/a, o/b']).repos, ['o/a', 'o/b']);
  t('a repo not shaped owner/name is refused', parseArgs(['--repos', 'nope']).errors.some((e) => e.includes('owner/name')), true);
  t('a repo named twice is refused', parseArgs(['--repos', 'o/a,o/a']).errors.some((e) => e.includes('twice')), true);
  t('--write takes a number', [parseArgs(['--write', '12']).write, parseArgs(['--write', '1x']).errors.some((e) => e.includes('issue number'))], [12, true]);
  t('--write with --json is refused', parseArgs(['--write', '3', '--json']).errors.some((e) => e.includes('pick one')), true);
  t('--write with --fixture is refused', parseArgs(['--write', '3', '--fixture', 'f.json']).errors.some((e) => e.includes('fixture')), true);
  t('--dry-run without --write is refused', parseArgs(['--dry-run']).errors.some((e) => e.includes('--dry-run')), true);
  t('an unknown flag is refused, never ignored', parseArgs(['--bogus']).errors.some((e) => e.includes('--bogus')), true);

  battery('seat titles: lane, seat, repo, status, account, project');
  const seat = (title, extra = {}) => parseSeat({ number: 1, title, body: '', labels: ['pm:seat'], assignees: [], ...extra }, 'objectstack-ai/objectstack');
  const devx = seat('[PM seat] domain:devx @ objectstack — 🟢 os-elon-musk · 由 os-elon-musk 账户的项目负责');
  t('domain lane @ its repo, seat 1, seated account and project', [devx.lane, devx.seat, devx.repo, devx.status, devx.account, devx.project], ['domain:devx', 1, 'objectstack-ai/objectstack', 'seated', 'os-elon-musk', 'os-elon-musk']);
  const s2 = seat('[PM seat] domain:skills · seat 2 — 🟢 os-elon-musk');
  t('· seat N is the seat number', [s2.lane, s2.seat], ['domain:skills', 2]);
  const ui = seat('[PM seat] domain:ui @ objectui · seat 5 — 🟢 os-tesla · session_01KUxVUa7');
  t('@ <name> moves the repo into the board owner', [ui.repo, ui.seat, ui.account], ['objectstack-ai/objectui', 5, 'os-tesla']);
  const cloud = seat('[PM seat] repo:cloud#1 — 🟢 baozhoutao · session_01FSg7JRUiTPo8GrgT38tAWP');
  t('repo:x#N is lane repo:x, seat N, repo x', [cloud.lane, cloud.seat, cloud.repo], ['repo:cloud', 1, 'objectstack-ai/cloud']);
  const vac = seat('[PM seat] domain:cli · seat 2 — ⏳ vacant', { assignees: [{ login: 'os-x' }] });
  t('⏳ vacant has no account even with a stale assignee', [vac.status, vac.account], ['vacant', null]);
  t('🔴 vacant reads as vacant', seat('[PM seat] repo:objectui — 🔴 vacant · last shift').status, 'vacant');
  const rt = seat('[PM seat] triage (objectstack-wide) — 🟢 Routine · session_01A · trig_01N (hourly)');
  t('🟢 Routine is a routine seat with no account, lane triage', [rt.routine, rt.account, rt.lane], [true, null, 'triage']);
  const sess = seat('[PM seat] domain:spec · seat 5 — 🟢 session_01Sfe5YjBLwB9J3y8fvm2xq1 · 落地 8', { assignees: [] });
  t('🟢 <session id> is not a login; no assignee ⇒ no account', sess.account, null);
  const held = seat('[PM seat] repo:www.objectos.ai — 🟢 held · hotlong', { assignees: [{ login: 'hotlong' }] });
  t('🟢 held falls back to the assignee', [held.account, held.repo], ['hotlong', 'objectstack-ai/www.objectos.ai']);
  t('由X账户 without spaces is read', seat('[PM seat] domain:cli — 🟢 os-sales · 由Sales账户的项目负责').project, 'Sales');
  t('a quoted order and the XX placeholder name no holder', [projectOf('order: 「坐席位贴，并注明「由XX账户的项目负责」」'), projectOf('由XX账户的项目负责'), projectOf(undefined)], [null, null, null]);
  t('director(项目总监) is lane director', seat('[PM seat] director(项目总监) — ⏳ vacant · 第 47 场').lane, 'director');
  t('a title that is not a status board is skipped', seat('Fleet seat registry'), null);

  battery('wall notes, closing refs, verdicts and mailboxes');
  t('Wall: line is the note', wallNoteOf('## 1\n- **Wall:** limit reached, resets at 18:00Z\n'), 'limit reached, resets at 18:00Z');
  t('撞墙： full-width colon is read', wallNoteOf('撞墙：等 20:00 重置'), '等 20:00 重置');
  t('a mid-line mention is not a note', wallNoteOf('we hit the Wall: no'), null);
  t('no body, no note', wallNoteOf(undefined), null);
  t('Fixes #n in the same repo', closingRefs('Fixes #25416', 'o/r'), ['o/r#25416']);
  t('cross-repo Closes owner/name#n', closingRefs('Closes objectstack-ai/hotcrm#12 and resolves #3', 'o/r'), ['objectstack-ai/hotcrm#12', 'o/r#3']);
  t('Refs #n does not close', closingRefs('Refs #9', 'o/r'), []);
  t('席位核对 with **ACCEPT** is a verdict', hasLandingVerdict([{ body: '## 席位核对\n\n**ACCEPT** · `repo:hotcrm` seat 1' }]), true);
  t('席位核对 with REJECT is not', hasLandingVerdict([{ body: '## 席位核对\n\nREJECT · rework' }]), false);
  t('Contract review VERDICT: PASS is a verdict', hasLandingVerdict([{ body: '## Contract review\n\nServed-tier: x\n\n**VERDICT: PASS**' }]), true);
  t('an ACCEPT outside a seat record is not', hasLandingVerdict([{ body: 'ACCEPT this please' }]), false);
  t('the live inline heading `## 席位核对 — ACCEPT · …` is a verdict', hasLandingVerdict([{ body: '## 席位核对 — ACCEPT · domain:skills#2 · session_01x · 2026-10-26T12:30Z\n\n1. 范围 ✓' }]), true);
  t('⛔ an inline REWORK heading is not, whatever a later line opens with', hasLandingVerdict([{ body: '## 席位核对 — REWORK · 补测试\n\nACCEPT once the test lands' }]), false);
  t('a blockquoted record is read as H69 reads it', hasLandingVerdict([{ body: '> ## 席位核对\n>\n> **ACCEPT** · seat 1' }]), true);
  t('⛔ an ACCEPT line ABOVE the heading is not the record\'s verdict', hasLandingVerdict([{ body: 'ACCEPT\n\n## 席位核对\n\nREWORK · rework' }]), false);
  t('the heading is H69\'s marker, imported not re-spelled: the three measured bodies read record alike', ['## 席位核对\n\n**ACCEPT** · x', '## 席位核对 — ACCEPT · x', '## Contract review\n\n**VERDICT: PASS**'].map((b) => `${seatRecord.SEAT_RECORD_MARKER.test(b)}/${hasLandingVerdict([{ body: b }])}`), ['true/true', 'true/true', 'false/true']);
  t('the mailbox constants are the opener\'s own, imported not re-spelled', [MAILBOX_LABEL, LEDGER_EXCLUSION, MAILBOX_BRANCH_PREFIX], [mailboxOpen.MAILBOX_LABEL, mailboxOpen.LEDGER_EXCLUSION, mailboxOpen.MAILBOX_BRANCH_PREFIX]);
  t('whose mailbox a pull is, and a seat row\'s slug, are the opener\'s own readings — imported, not re-spelled', [mailboxOwner === mailboxOpen.mailboxOwner, seatKey === mailboxOpen.seatKey, seatSlugOf({ lane: 'domain:ui', seat: 4 }), seatSlugOf({ lane: 'triage', seat: 1 }), seatSlugOf({ lane: 'security', seat: 1 })], [true, true, 'ui-4', 'triage-1', 'security-1']);

  battery('the fixture snapshot: rows for the three repos');
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const rows = buildRows(fixture, { now: fixture.now });
  const row = (post, repo = 'objectstack-ai/objectstack') => rows.find((r) => r.post === post && r.board === repo);
  t('order is (repo, lane, seat)', rows.map((r) => `${r.repo.split('/')[1]}:${r.lane}:${r.seat}`), [
    'hotcrm:repo:hotcrm:1',
    'hotcrm:repo:hotcrm:2',
    'objectstack:domain:devx:1',
    'objectstack:domain:devx:2',
    'objectstack:domain:skills:1',
    'objectstack:domain:skills:2',
    'objectstack:epic:#26676:1',
    'objectstack:epic:#27293:1',
    'objectstack:epic:#27293:2',
    'objectstack:epic:#28800:2',
    'objectstack:review:1',
    'objectstack:triage:1',
    'objectui:domain:ui:1',
    'objectui:domain:ui:4',
  ]);
  const laneListed = (lane) => (lane.includes(':') ? [...mailboxOpen.SEAT_LANE_KINDS, mailboxOpen.SEAT_EPIC_KIND].includes(lane.slice(0, lane.indexOf(':'))) : mailboxOpen.SEAT_BARE_LANES.includes(lane));
  t('every fixture lane is a kind or bare word from the opener\'s lane-word lists — imported, not re-spelled', [...new Set(rows.map((r) => r.lane))].map((lane) => `${lane}:${laneListed(lane)}`), ['repo:hotcrm:true', 'domain:devx:true', 'domain:skills:true', 'epic:#26676:true', 'epic:#27293:true', 'epic:#28800:true', 'review:true', 'triage:true', 'domain:ui:true']);
  const os = (number) => ({ repo: 'objectstack-ai/objectstack', number });
  const ep = (post) => (({ lane, seat, status, mark, account, mailbox, suspectedWall, inFlight }) => ({ lane, seat, status, mark, account, mailbox, suspectedWall, inFlight }))(row(post));
  t('⭐ an epic parent is a row: lane epic:#n, the seat its open mailbox names, seated by that login, the mailbox in its column — and, stale with no in-flight read, never 疑似撞墙', ep(27293), { lane: 'epic:#27293', seat: 1, status: 'seated', mark: '🟢', account: 'sunhaolin', mailbox: [os(25397)], suspectedWall: false, inFlight: [] });
  t('⭐ an epic parent with no mailbox open is one row, seat 1, status unknown — an epic seat nobody can ring shows as one', ep(26676), { lane: 'epic:#26676', seat: 1, status: 'unknown', mark: null, account: null, mailbox: [], suspectedWall: false, inFlight: [] });
  t('⛔ a pm:epic child (a session, no sub-issues, no mailbox named after it) and a parent with no session registration are no row', rows.filter((r) => r.post === 28647 || r.post === 27108).length, 0);
  t('⭐ a head-only epic mailbox (no `Mailbox-of:` line) seats its row by slug, as the mailbox column reads it', (({ post, seat, status, account, mailbox }) => ({ post, seat, status, account, mailbox }))(rows.find((r) => r.post === 27293 && r.seat === 2)), { post: 27293, seat: 2, status: 'seated', account: 'os-bill', mailbox: [os(25400)] });
  t('⭐ a parent delegated before its first sub-issue is a row once its PM opened a mailbox — seated, never flagged as on no seat row', [ep(28800), unassignedMailboxes(fixture, rows).some((m) => m.ref.number === 25399)], [{ lane: 'epic:#28800', seat: 2, status: 'seated', mark: '🟢', account: 'os-tesla', mailbox: [os(25399)], suspectedWall: false, inFlight: [] }, false]);
  t('the two conditions apart: registration + a held seat is a row without sub-issues; registration alone, or a held seat with no registration, is not', [isSeatedFreshEpic({ body: 'session_01Abcd' }, new Map([[1, 'a']])), isSeatedFreshEpic({ body: 'session_01Abcd' }, new Map()), isSeatedFreshEpic({ body: 'no id' }, new Map([[1, 'a']])), [...epicSeatsHeld('epic:#27293', readMailboxes(fixture)).keys()]], [true, false, false, [1, 2]]);
  t('isEpicParent is both halves of H45\'s delegation signals, over every fixture epic and a bare card', await (async () => { const { h45DelegationNodeSignals } = await import('./check-half-states.mjs'); return [...fixture.repos['objectstack-ai/objectstack'].epics, {}].map((i) => { const h = h45DelegationNodeSignals(i); return isEpicParent(i) === (h.subIssues && h.registration); }); })(), [true, true, true, true, true, true]);
  t('the non-seat issue in the seat list is skipped', rows.some((r) => r.post === 999), false);
  t('today’s three seats carry the right accounts', [row(19287).account, row(6023).account, row(1353, 'objectstack-ai/hotcrm').account], ['os-elon-musk', 'os-elon-musk', 'os-elon-musk']);
  t('⛔ a retired `domain:` seat row owns no card: its account\'s dispatched cards sit on no domain row, the label on them notwithstanding', [row(6023).inFlight, row(20163).inFlight, row(19287).inFlight], [[], [], []]);
  t('⛔ …nor on a sibling board\'s `domain:` row', [row(5560, 'objectstack-ai/objectui').inFlight, row(10243, 'objectstack-ai/objectui').inFlight], [[], []]);
  t('⛔ …so a domain row holds no landing, no merge and no ruling either', [row(19287).awaitingLanding, row(19287).awaitingMerge, row(6023).awaitingRuling, row(19287).awaitingRuling], [[], [], [], []]);
  t('…while the post still shows as a row, its lane, status and account read off the title', [row(6023).lane, row(6023).status, row(6023).account], ['domain:devx', 'seated', 'os-elon-musk']);
  t('a pm:mailbox PR closing a card never counts as landing', row(6023).awaitingLanding, []);
  t('a PR with no verdict does not count', row(1353, 'objectstack-ai/hotcrm').awaitingLanding, []);
  t('⛔ a pull labelled `needs-user-decision` (the retired shape) is awaiting merge nowhere, and awaiting ruling never counts a pull', [rows.some((r) => r.awaitingMerge.length && r.post !== 19287), rows.some((r) => r.awaitingRuling.some((x) => x.number === 25401))], [false, false]);
  t('the two inbox halves are counted apart, every repo in, and never summed', inboxTotals(fixture), { decisionCards: 2, awaitingMergePulls: 1 });
  t('⭐ the mailbox column is the SEAT\'s pm:mailbox PR — by body line on a --head branch, by head slug, by both', [row(6023).mailbox, row(19287).mailbox, row(20163).mailbox], [[os(25392)], [os(25393)], [os(25394)]]);
  t('⛔ one login on three seats: each seat shows only its own mailbox, and a seat that opened none shows none', [row(6023).mailbox.length, row(19287).mailbox.length, row(1353, 'objectstack-ai/hotcrm').mailbox], [1, 1, []]);
  t('⛔ a legacy per-login mailbox and a seat no post or open epic parent carries sit on no row — flagged, never attributed to the login\'s seats', [unassignedMailboxes(fixture, rows).map((m) => [m.ref.number, m.seat, m.login, m.why]), [row(5560, 'objectstack-ai/objectui').mailbox, row(10243, 'objectstack-ai/objectui').mailbox]], [[[25395, null, 'os-sales', 'legacy per-login, names no seat'], [25396, 'domain:spec#5', 'os-tesla', 'no seat post or epic parent carries this seat'], [25398, 'epic:#28130#1', 'os-zhuang', 'no seat post or epic parent carries this seat']], [[], []]]);
  t('stale and no wall note ⇒ 疑似撞墙; a wall note silences it; vacant never', [row(20163).suspectedWall, row(5560, 'objectstack-ai/objectui').suspectedWall, row(5560, 'objectstack-ai/objectui').wallNote, row(7623).suspectedWall], [true, false, 'limit reached, resets at 15:00Z', false]);
  const rv = (({ lane, seat, status, account, sharesWith, inFlight, awaitingLanding, awaitingRuling, mailbox, lastActivity, suspectedWall }) => ({ lane, seat, status, account, sharesWith, inFlight, awaitingLanding, awaitingRuling, mailbox, lastActivity, suspectedWall }))(row(25500));
  t('⭐ an L2 seat under the OLD lane word is still a row: lane `review`, seated by its login, never sharing; in flight = the open pulls whose current head its live Contract-review-claim holds, its mailbox in its column, and its last activity the claim comment', rv, { lane: 'review', seat: 1, status: 'seated', account: 'os-zhuang', sharesWith: null, inFlight: [os(25433)], awaitingLanding: [], awaitingRuling: [], mailbox: [os(25434)], lastActivity: '2026-10-23T13:30:00Z', suspectedWall: false });
  t('⛔ of the fixture\'s three review-signed claims only the live one on the current head counts: the expired one (2 h) and the one on a moved head hold nothing', [fixture.repos['objectstack-ai/objectstack'].recentComments.filter((c) => /^review#/.test(c.body)).length, [...reviewClaims(fixture, { now: fixture.now }).entries()].map(([k, v]) => `${k}=${v.map((r) => r.number)}`)], [3, ['review#1=25433']]);
  t('⛔ a claim signed by a lane seat, or by nobody, is no review in-flight; an L2 seat holds no dispatched card of the lanes', [reviewClaims({ repos: { r: { pulls: [{ number: 1, state: 'open', head: { sha: 'a'.repeat(40) } }], recentComments: [{ issue_url: 'x/issues/1', created_at: fixture.now, body: `domain:ui#1 · a · session_01Abcdef\n\nContract-review-claim: session_01Abcdef · head ${'a'.repeat(40)} · ${fixture.now}` }, { issue_url: 'x/issues/1', created_at: fixture.now, body: `Contract-review-claim: session_01Abcdef · head ${'a'.repeat(40)} · ${fixture.now}` }] } } }, { now: fixture.now }).size, rows.filter((r) => isL2ReviewLane(r.lane) && r.inFlight.some((p) => fixture.repos['objectstack-ai/objectstack'].dispatched.some((d) => d.number === p.number))).length], [0, 0]);
  t('the L2 lane words are the opener\'s — imported, not a third spelling — and both are bare lanes', [mailboxOpen.L2_REVIEW_LANE_WORDS.every((w) => mailboxOpen.SEAT_BARE_LANES.includes(w)), mailboxOpen.L2_REVIEW_LANE_WORDS.map(isL2ReviewLane), isL2ReviewLane('triage')], [true, [true, true], false]);
  t('⭐ a NEW L2 seat reads under its own word: the title `l2-review · seat 2` parses to lane `l2-review` seat 2 (never lane `l`), and a live claim signed `l2-review#2` is that seat\'s in-flight — keyed by the word it signed, beside a `review#1` claim on another pull', (() => { const s = seat('[PM seat] l2-review · seat 2 — 🟢 os-tesla'); const head = 'b'.repeat(40); const claim = (sig) => ({ created_at: fixture.now, body: `${sig} · os-tesla · session_01Abcdef\n\nContract-review-claim: session_01Abcdef · head ${head} · ${fixture.now}` }); const held = reviewClaims({ repos: { r: { pulls: [{ number: 1, state: 'open', head: { sha: head } }, { number: 2, state: 'open', head: { sha: head } }], recentComments: [{ issue_url: 'x/issues/1', ...claim('l2-review#2') }, { issue_url: 'x/issues/2', ...claim('review#1') }] } } }, { now: fixture.now }); return [s.lane, s.seat, s.status, s.account, [...held.entries()].map(([k, v]) => `${k}=${v.map((p) => p.number)}`).sort()]; })(), ['l2-review', 2, 'seated', 'os-tesla', ['l2-review#2=1', 'review#1=2']]);

  battery('a repo-lane seat owns its repo\'s cards by account: in flight, landing, merge, ruling');
  {
    // The fixture with its four objectstack domain seat posts retitled to the repo lane, the shape every live seat
    // post carries since lanes became seats plus epics. Same cards, same pulls: what moves is who holds them.
    const RETITLE = { 6023: '[PM seat] repo:objectstack — 🟢 os-elon-musk · 由 os-elon-musk 账户的项目负责 · area:build', 20163: '[PM seat] repo:objectstack · seat 2 — 🟢 os-sales · area:fleet', 7623: '[PM seat] repo:objectstack · seat 3 — ⏳ vacant', 19287: '[PM seat] repo:objectstack · seat 4 — 🟢 os-elon-musk · area:ai' };
    const OS = 'objectstack-ai/objectstack';
    const retitled = JSON.parse(JSON.stringify(fixture));
    retitled.repos[OS].seats = retitled.repos[OS].seats.map((p) => (RETITLE[p.number] ? { ...p, title: RETITLE[p.number] } : p));
    const rrows = buildRows(retitled, { now: retitled.now });
    const rr = (post) => rrows.find((r) => r.post === post && r.board === OS);
    t('⭐ in flight: each seat\'s account\'s dispatched cards on its repo, a `domain:*` label on the card read by nobody', [rr(6023).inFlight.map((c) => c.number), rr(20163).inFlight.map((c) => c.number)], [[25412, 25416, 25500], [25300]]);
    t('one account on two seats of a lane: cards on the lowest seat, the other reads = seat 1', [rr(19287).sharesWith, rr(19287).inFlight], [1, []]);
    t('awaiting landing: the ACCEPTed claude/ PR only — a pm:mailbox PR closing a card never counts', rr(6023).awaitingLanding, [os(25427)]);
    t('⭐ a pull carrying `pm:awaiting-merge` that closes an in-flight card sits on that card\'s seat, in its own column — the PR half of the inbox', rr(6023).awaitingMerge, [os(25427)]);
    t('a ruling sits on the seat its assignee holds, else the lane\'s lowest seated seat', [rr(6023).awaitingRuling.map((c) => c.number), rr(20163).awaitingRuling], [[25344, 25373], []]);
    t('last activity is the newest of post and in-flight cards', [rr(6023).lastActivity, rr(20163).lastActivity], ['2026-10-23T13:59:00Z', '2026-10-23T02:00:00Z']);
    t('⛔ a vacant repo-lane seat holds nothing', [rr(7623).inFlight, rr(7623).awaitingRuling, rr(7623).suspectedWall], [[], [], false]);
  }

  battery('one account on two seats of a lane: the second seat reads its own traces');
  {
    const NOW = '2026-11-02T04:00:00Z';
    const R = 'objectstack-ai/objectstack';
    const fresh = '2026-11-02T03:00:00Z'; // 1 h before NOW
    const stale = '2026-11-01T20:00:00Z'; // 8 h before NOW, past STALE_HOURS
    const sig = (laneSeat, account = 'os-pm') => `${laneSeat} · ${account} · session_01SharedSeatSess`;
    const snap = ({ mailboxAt = null, comments = [], seat1MailboxAt = null } = {}) => ({
      repos: {
        [R]: {
          seats: [
            { number: 100, title: '[PM seat] repo:objectstack — 🟢 os-pm', body: '', labels: ['pm:seat'], assignees: ['os-pm'], updated_at: '2026-10-30T00:00:00Z' },
            { number: 200, title: '[PM seat] repo:objectstack · seat 2 — 🟢 os-pm', body: '', labels: ['pm:seat'], assignees: ['os-pm'], updated_at: '2026-10-31T00:00:00Z' },
          ],
          dispatched: [{ number: 300, labels: ['pm:dispatched'], assignees: ['os-pm'], updated_at: fresh }],
          rulings: [],
          pulls: [
            ...(seat1MailboxAt ? [{ number: 401, state: 'open', head: { ref: 'mailbox/os-pm/repo-objectstack-1' }, body: 'Mailbox-of: repo:objectstack#1 · os-pm', labels: ['pm:mailbox'], updated_at: seat1MailboxAt }] : []),
            ...(mailboxAt ? [{ number: 402, state: 'open', head: { ref: 'mailbox/os-pm/repo-objectstack-2' }, body: 'Mailbox-of: repo:objectstack#2 · os-pm', labels: ['pm:mailbox'], updated_at: mailboxAt }] : []),
          ],
          comments: {},
          recentComments: comments,
        },
      },
    });
    const seat2 = (s) => (({ sharesWith, inFlight, mailbox, lastActivity, suspectedWall }) => ({ sharesWith, inFlight, mailbox, lastActivity, suspectedWall }))(buildRows(s, { now: NOW }).find((r) => r.post === 200));
    t('no trace of its own: seat 2 reads = seat 1, its post alone, and is flagged', seat2(snap()), { sharesWith: 1, inFlight: [], mailbox: [], lastActivity: '2026-10-31T00:00:00Z', suspectedWall: true });
    t('⭐ a fresh mailbox pull lifts the flag, and the in-flight cell still reads = seat 1', seat2(snap({ mailboxAt: fresh })), { sharesWith: 1, inFlight: [], mailbox: [{ repo: R, number: 402 }], lastActivity: fresh, suspectedWall: false });
    t('⭐ a fresh comment signed repo:objectstack#2 lifts the flag', seat2(snap({ comments: [{ body: `${sig('repo:objectstack#2')}\n\n## 席位核对 — ACCEPT`, updated_at: fresh }] })), { sharesWith: 1, inFlight: [], mailbox: [], lastActivity: fresh, suspectedWall: false });
    t('⛔ mailbox and signed comment both older than STALE_HOURS: flagged, last activity the newer of them', seat2(snap({ mailboxAt: stale, comments: [{ body: sig('repo:objectstack#2'), updated_at: '2026-11-01T19:00:00Z' }] })), { sharesWith: 1, inFlight: [], mailbox: [{ repo: R, number: 402 }], lastActivity: stale, suspectedWall: true });
    t('⛔ by seat, never by account: seat 1\'s fresh signed comment and fresh mailbox, same account, leave seat 2 flagged', seat2(snap({ seat1MailboxAt: fresh, comments: [{ body: sig('repo:objectstack#1'), updated_at: fresh }] })).suspectedWall, true);
    t('⛔ another lane\'s seat 2, or a seat-2 signature on a repo: lane, is not this seat', seat2(snap({ comments: [{ body: sig('domain:ui#2'), updated_at: fresh }, { body: sig('repo:server#2'), updated_at: fresh }] })).suspectedWall, true);
    t('⛔ a signature that is not the FIRST non-empty line, or is spelled wrong, signs nothing', seat2(snap({ comments: [{ body: `Claim: x\n${sig('repo:objectstack#2')}`, updated_at: fresh }, { body: 'repo:objectstack#2 - os-pm - session_01SharedSeatSess', updated_at: fresh }, { body: 'repo:objectstack#2 · os-pm · session_01x', updated_at: fresh }] })).suspectedWall, true);
    t('the newest of the four traces wins, and the comment\'s updated_at is its time', seat2(snap({ mailboxAt: '2026-11-02T01:00:00Z', comments: [{ body: sig('repo:objectstack#2'), created_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T03:30:00Z' }, { body: sig('repo:objectstack#2'), updated_at: '2026-11-02T02:00:00Z' }] })).lastActivity, '2026-11-02T03:30:00Z');
    t('seat 1 keeps its cards and reads its own traces too', (({ inFlight, lastActivity, suspectedWall }) => ({ inFlight, lastActivity, suspectedWall }))(buildRows(snap({ comments: [{ body: sig('repo:objectstack#1'), updated_at: '2026-11-02T03:45:00Z' }] }), { now: NOW }).find((r) => r.post === 100)), { inFlight: [{ repo: R, number: 300 }], lastActivity: '2026-11-02T03:45:00Z', suspectedWall: false });
    t('the rendered row keeps = seat 1 and drops the flag once a trace is fresh', (() => {
      const line = renderBody(buildRows(snap({ mailboxAt: fresh }), { now: NOW }), { now: NOW, repos: [R] }).split('\n').find((l) => l.includes('/issues/200)'));
      return [line.includes('| = seat 1 |'), line.includes(SUSPECTED_WALL)];
    })(), [true, false]);
    t('the comment read starts STALE_HOURS before now, and the footer names it', [activitySince(NOW), readsFor([R]).some((q) => q.startsWith(`GET /repos/${R}/issues/comments?since=`))], ['2026-11-01T22:00:00Z', true]);
    const { readSignatureLine } = await import('./check-half-states.mjs');
    t('the signature pattern is check-half-states\' SEAT_SIGNATURE_LINE, imported — no second spelling of the lane alternation in this file (and the awaiting-merge label rides the same import, no second spelling of it either)', [/^import \{ GOVERNED_PR_AWAITING_MERGE_LABEL, SEAT_SIGNATURE_LINE \} from '\.\/check-half-states\.mjs';$/mu.test(readFileSync(SELF_PATH, 'utf8')), readFileSync(SELF_PATH, 'utf8').includes(['triage', 'director', 'coordinator'].join('|')), readFileSync(SELF_PATH, 'utf8').includes(["'pm:", 'awaiting-merge', "'"].join(''))], [true, false, false]);
    // The lane grammar's two remaining owners, held equal here (the only file that imports both): the signature's
    // alternation and the opener's lane-word lists. `coordinator` is the one lane that signs and has no mailbox.
    const signatureLanes = (/^\^\(\(\?:([^()]*)\)\)#/u.exec(SEAT_SIGNATURE_LINE.source)?.[1] ?? '').split('|');
    t('⭐ the lane grammar is ONE set: the signature\'s kinds are the opener\'s kinds plus `epic`, its bare words the opener\'s bare lanes plus `coordinator` — a lane added to one side alone reds here', [signatureLanes.filter((a) => a.includes(':')).map((a) => a.slice(0, a.indexOf(':'))).sort(), signatureLanes.filter((a) => !a.includes(':')).sort(), signatureLanes.length], [[...mailboxOpen.SEAT_LANE_KINDS, SEAT_EPIC_KIND].sort(), [...mailboxOpen.SEAT_BARE_LANES, 'coordinator'].sort(), mailboxOpen.SEAT_LANE_KINDS.length + 1 + mailboxOpen.SEAT_BARE_LANES.length + 1]);
    const corpus = ['', sig('domain:server#2'), `\n\n  ${sig('domain:engine-core#3')}\r\nbody`, `body\n${sig('triage#1')}`, sig('security#1'), 'epic:#27293#1 · sunhaolin · session_017xRBcVBKAFk1ntXSjvPt7U', 'domain:server#0 · os-pm · session_01SharedSeatSess', 'domain:server#2 · os-pm · cse_01SharedSeatSess'];
    t('signedSeatOf reads every body as readSignatureLine does', corpus.map(signedSeatOf), corpus.map((b) => { const r = readSignatureLine(b); return r ? `${r.lane}#${r.seat}` : null; }));
  }

  battery('the rendered body: marker, columns, footer, determinism');
  const body = renderBody(rows, { now: fixture.now, repos: Object.keys(fixture.repos).sort(), session: 'cse_01ABC', inboxes: inboxTotals(fixture) });
  t('the body opens with the marker', body.split('\n')[0], ROSTER_MARKER);
  t('the header names the eleven columns', body.includes('| repo | lane | seat | account | in flight | awaiting ruling | awaiting merge | awaiting landing | wall note | last activity | mailbox PR |'), true);
  t('⭐ the inbox line spells both halves in the ruled words, apart and never summed', body.includes('决策卡 2 · 待您审合 PR 1'), true);
  t('…and a render handed no inbox totals prints no inbox line rather than a wrong one', renderBody(rows, { now: fixture.now, repos: Object.keys(fixture.repos).sort() }).includes('待您审合 PR'), false);
  t('one table row per seat post', body.split('\n').filter((l) => /^\| (?:hotcrm|objectstack|objectui) \|/.test(l)).length, rows.length);
  t('the footer names the generation time and each read', [body.includes(`Generated ${fixture.now}`), body.includes('`GET /repos/objectstack-ai/hotcrm/issues?state=open&labels=pm:seat`')], [true, true]);
  t('the suspected wall is spelled in the row', body.includes(`⚠️ ${SUSPECTED_WALL}`), true);
  t('a shared seat reads = seat N in the in-flight cell', body.includes('| = seat 1 |'), true);
  t('⭐ a review row renders its claimed pull in the in-flight cell, never `= seat N`', body.includes('| objectstack | review | [1](https://github.com/objectstack-ai/objectstack/issues/25500) | 🟢 `os-zhuang` | objectstack#25433 | — | — | — | — |'), true);
  t('the mailboxes on no seat row are flagged under the table, each with its owner and why', (() => {
    const flagged = renderBody(rows, { now: fixture.now, repos: Object.keys(fixture.repos).sort(), unassigned: unassignedMailboxes(fixture, rows) });
    return [flagged.includes('⚠️ 3 mailbox PR(s) on no seat row'), flagged.includes('objectstack#25395 (os-sales: legacy per-login, names no seat)'), flagged.includes('objectstack#25396 (domain:spec#5 · os-tesla: no seat post or epic parent carries this seat)'), body.includes('on no seat row')];
  })(), [true, true, true, false]);
  t('an epic row renders its lane, its parent card as the seat link, its seat holder or `? —`, and the summary counts it', [body.includes('| objectstack | epic:#27293 | [1](https://github.com/objectstack-ai/objectstack/issues/27293) | 🟢 `sunhaolin` |'), body.includes('| objectstack | epic:#26676 | [1](https://github.com/objectstack-ai/objectstack/issues/26676) | ? — |'), body.includes(`${rows.length} seat rows (4 epic) ·`)], [true, true, true]);
  t('the attribution footer closes the body', body.endsWith('\n\n---\n_Generated by [Claude Code](https://claude.ai/code/session_01ABC)_'), true);
  const shuffled = { ...fixture, repos: Object.fromEntries(Object.entries(fixture.repos).reverse().map(([k, v]) => [k, { ...v, seats: [...v.seats].reverse() }])) };
  t('the same facts in another read order render the same body', renderBody(buildRows(shuffled, { now: fixture.now }), { now: fixture.now, repos: Object.keys(fixture.repos).sort() }), renderBody(rows, { now: fixture.now, repos: Object.keys(fixture.repos).sort() }));

  battery('refusing to overwrite what is not the roster');
  const iss = (o) => ({ state: 'open', labels: [{ name: 'tracking' }], body: '', ...o });
  t('an empty open tracking issue may be written', writeRefusal(iss({}), 1), null);
  t('a body this script wrote may be rewritten', writeRefusal(iss({ body: `${ROSTER_MARKER}\n# old` }), 1), null);
  t('a hand-written body is refused', /roster marker/.test(writeRefusal(iss({ body: 'A real card.' }), 1)), true);
  t('an issue without tracking is refused', /not labelled/.test(writeRefusal(iss({ labels: [] }), 1)), true);
  t('a closed issue or a pull is refused', [/is closed/.test(writeRefusal(iss({ state: 'closed' }), 1)), /pull request/.test(writeRefusal(iss({ pull_request: {} }), 1))], [true, true]);
  t('the write is one issue_patch the relay validator accepts', (() => {
    const p = planWrite({ board: DEFAULT_BOARD, issue: 7, body });
    return [p.actions.length, p.actions[0].op, Object.keys(p.actions[0]).sort(), p.errors];
  })(), [1, 'issue_patch', ['body', 'issue', 'op'], []]);

  battery('paging: a three-page read through the loop equals the slurped array');
  {
    const slurped = [0, 1, 2].map((n) => Array.from({ length: n < 2 ? PER_PAGE : 37 }, (_, i) => ({ number: n * PER_PAGE + i + 1 })));
    const asked = [];
    const get = (path) => {
      asked.push(path);
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      return { ok: true, value: slurped[page - 1] ?? [] };
    };
    const read = readAllPages('/repos/o/r/issues?state=open&labels=pm%3Aseat&per_page=100', { get });
    t('three pages read = the --slurp array, flattened', [read.ok, read.value], [true, slurped.flat()]);
    t('pages 1..3 asked, per_page kept once, other keys kept, stop at the short page', asked, [1, 2, 3].map((n) => `/repos/o/r/issues?state=open&labels=pm%3Aseat&per_page=100&page=${n}`));
    const exact = [];
    t('an exact multiple of per_page reads one empty page and stops', [readAllPages('/x', { get: (p) => (exact.push(p), { ok: true, value: exact.length === 1 ? slurped[0] : [] }) }).value.length, exact.length], [PER_PAGE, 2]);
    t('a failed page or a non-list page is an error, never a partial list', [readAllPages('/x', { get: () => ({ ok: false, error: 'boom' }) }), readAllPages('/x', { get: () => ({ ok: true, value: { message: 'x' } }) }).ok], [{ ok: false, error: 'boom' }, false]);
  }

  battery('the health rule text: every phrase --health is built from is in the file that writes it');
  for (const [path, phrases] of Object.entries(HEALTH_RULE_FILES)) {
    let text = '';
    try {
      text = readFileSync(join(REPO_ROOT, path), 'utf8');
    } catch (e) {
      text = `could not be read (${e.code ?? e.message}) — moved or split?`;
    }
    t(`⭐ ${path.split('/').pop()} still says what --health encodes`, phrases.filter((p) => !text.includes(p)), []);
  }
  t('the labels --health counts are the ones the rule line names', [QUEUE_LABEL, GOVERNED_PR_AWAITING_MERGE_LABEL, P0_LABEL].every((l) => HEALTH_RULE_FILES['.claude/skills/pm-dispatch/references/seat-lifecycle.md'].join('\n').includes(`\`${l}\``)), true);

  battery('--health: five indicators off one walk, every count checked, every gap named');
  {
    const H = fixture.health;
    const nowMs = Date.parse(H.now);
    const OS = 'objectstack-ai/objectstack';
    const CRM = 'objectstack-ai/hotcrm';
    const withRepo = (repo, over) => ({ ...H, repos: { ...H.repos, [repo]: { ...H.repos[repo], ...over } } });
    const run = (health, repos = Object.keys(health.repos), extra = {}) => readHealth(repos, { get: healthFixtureGet(health), nowMs, ...extra });
    const h = await run(H);
    const two = await run(H, [OS, CRM]);
    t('⭐ 可派发库存: open pm:queue with no assignee, per repo and total — the trend is never a number', [h.inventory.total, h.inventory.perRepo.map((x) => x.n), h.inventory.trend], [3, [2, 1], null]);
    t('⭐ 决策箱: decision cards and awaiting-merge pulls counted apart by inboxTotals, never summed', [h.inbox.decisionCards, h.inbox.awaitingMergePulls, Object.keys(h.inbox)], [3, 1, ['decisionCards', 'awaitingMergePulls', 'downstream']]);
    t('⭐ the Blocked-by: reverse read, computed now: a body line, a cross-repo line and a pm:blocked thread line each name their decision card', h.inbox.downstream, [{ card: `${OS}#104`, dependents: [`${OS}#105`, `${CRM}#12`] }, { card: `${OS}#107`, dependents: [`${OS}#106`] }]);
    t('finding: the bare label count with its median age; a held card (label changed) is not in it', [h.findings.total, h.findings.medianAgeHours], [2, 36]);
    const { classify } = await import('./first-touch-sweep.mjs');
    const sweepBare = H.repos[OS].issues.filter((i) => classify(i, { repo: OS, nowMs }).includes(1)).map((i) => `${OS}#${i.number}`);
    t('⭐ 裸卡 is first-touch-sweep ① off the sweep\'s own walk — imported, never re-spelled — with its median age and ④ apart', [h.bare.cards, h.bare.cards, h.bare.medianAgeHours, h.bare.ungraded], [sweepBare, [`${OS}#108`, `${OS}#109`, `${OS}#110`], 24, 1]);
    t('发版阻塞: open priority:p0 summed over the repos read', [h.releaseBlockers.total, h.releaseBlockers.perRepo.map((x) => x.n)], [2, [1, 1]]);
    t('⭐ an unreadable repo is a named gap: INCOMPLETE, exit 4, never a clean number', [healthExit(h), h.gaps.some((g) => g.startsWith('objectstack-ai/objectui could not be read') && g.includes('HTTP 403')), renderHealth(h, { now: H.now }).includes('COMPLETE — five')], [EXIT_INCOMPLETE, true, false]);
    t('the repos that answer, read alone, are COMPLETE, exit 0', [healthExit(two), two.gaps, renderHealth(two, { now: H.now }).split('\n').at(-1).startsWith('fleet-roster --health COMPLETE')], [EXIT_OK, [], true]);
    const queueGap = await run(withRepo(OS, { totals: { queue: 5 } }), [OS, CRM]);
    t('⭐ a label count the platform disagrees with is a gap naming both numbers', [healthExit(queueGap), queueGap.gaps], [EXIT_INCOMPLETE, [`${OS}: queue: the walk holds 2 and the platform counts 5`]]);
    const openGap = await run(withRepo(OS, { totals: { open: 99 } }), [OS, CRM]);
    t('⭐ a walk shorter than the platform\'s open count is a gap, read from the sweep\'s own check', [healthExit(openGap), openGap.gaps.length === 1 && openGap.gaps[0].includes('the walk returned 13 open issue(s) and the platform counts 99')], [EXIT_INCOMPLETE, true]);
    const threadGap = await run(withRepo(OS, { comments: { 105: [], 106: null } }), [OS, CRM]);
    t('⭐ an unreadable pm:blocked thread is a gap, and its comment-borne line is not read', [healthExit(threadGap), threadGap.gaps.some((g) => g.includes("#106's thread could not be read")), threadGap.inbox.downstream.map((d) => d.card)], [EXIT_INCOMPLETE, true, [`${OS}#104`]]);
    const mergeGap = await run(withRepo(OS, { totals: { merge: 2 } }), [OS, CRM]);
    t('an awaiting-merge listing shorter than the platform count is a gap', mergeGap.gaps, [`${OS}: awaiting-merge pulls: listed 1 and the platform counts 2`]);
    const blind = await readHealth([OS], { get: healthFixtureGet(H), nowMs, sweepFn: async () => ({ enumerated: 5, pages: 1, totalCount: 5, complete: true, why: [], found: { 1: [], 4: [] } }) });
    t('⭐ a sweep walk this reader did not keep is a gap: no indicator is read off rows it never saw', [healthExit(blind), blind.gaps.some((g) => g.includes('the sweep enumerated 5 open issue(s) and this reader kept 0'))], [EXIT_INCOMPLETE, true]);
    const none = await run({ ...H, repos: { 'objectstack-ai/objectui': null } });
    t('no repository answering is CAN\'T READ, exit 3, no indicator read', [healthExit(none), renderHealth(none, { now: H.now }).includes("CAN'T READ")], [EXIT_PREREQUISITE, true]);
    const text = renderHealth(h, { now: H.now });
    t('⭐ every run names the legs it cannot read, and the trend reads "unread", never a number', [HEALTH_UNREAD_LEGS.every((l) => text.includes(l)), /可派发库存 — [^\n]*trend unread/.test(text)], [true, true]);
    t('the five indicator lines print in the rule\'s order, the two inboxes apart', ['1 可派发库存', '2 决策箱 — 决策卡 3 · 待您审合 PR 1', '3 finding — 2 open', '4 裸卡 — 3 bare', '5 发版阻塞 — open priority:p0 issues summed over the repos read: 2'].map((s) => text.includes(s)), [true, true, true, true, true]);
    const waits = [];
    const paced = pacedSearch((p) => ({ ok: true, value: p }), (ms) => waits.push(ms));
    ['/search/issues?q=a', '/repos/o/r/issues?page=1', '/search/issues?q=b'].forEach(paced);
    t('live search reads are spaced, and only search reads', [waits.length, waits.every((w) => w > 0 && w <= SEARCH_SPACING_MS)], [1, true]);
    t('median: odd, even and empty', [median([3, 1, 2]), median([4, 1, 2, 3]), median([])], [2, 2.5, null]);
    t('--health is read-only: with --write it is a usage error; alone it parses', [parseArgs(['--health', '--write', '3']).errors.some((e) => e.includes('read-only')), parseArgs(['--health']).errors], [true, []]);
    const hcli = (args) => spawnSync(process.execPath, [SELF_PATH, '--health', ...args], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
    const offline = hcli(['--fixture', FIXTURE_PATH]);
    t('⭐ --health --fixture runs offline (no gh on PATH) and exits 4 on the unreadable fixture repo', [offline.status, offline.stdout.split('\n').filter((l) => /^[1-5] /.test(l)).length], [EXIT_INCOMPLETE, 5]);
    const jsonRun = hcli(['--fixture', FIXTURE_PATH, '--repos', `${OS},${CRM}`, '--json']);
    let jsonOut = null;
    try {
      jsonOut = JSON.parse(jsonRun.stdout);
    } catch {}
    t('--repos narrows a fixture run; --json carries the exit and every unread leg', [jsonRun.status, jsonOut?.exit, jsonOut?.unreadLegs?.length], [EXIT_OK, EXIT_OK, HEALTH_UNREAD_LEGS.length]);
    const dir = mkdtempSync(join(tmpdir(), 'fleet-roster-health-'));
    try {
      const noHealth = join(dir, 'roster-only.json');
      writeFileSync(noHealth, JSON.stringify({ now: H.now, repos: fixture.repos }));
      t('a fixture with no health section is exit 3, never an empty reading', [hcli(['--fixture', noHealth]).status, hcli(['--write', '3']).status], [EXIT_PREREQUISITE, EXIT_USAGE]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  battery('the CLI: fixture runs offline, usage errors are exit 2');
  const cli = (args) => spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', OS_FLEET_SESSION: '', CLAUDE_CODE_REMOTE_SESSION_ID: '' } });
  const jsonRun = cli(['--fixture', FIXTURE_PATH, '--json']);
  let parsed = null;
  try {
    parsed = JSON.parse(jsonRun.stdout);
  } catch {}
  t('--fixture --json exits 0 with no gh on PATH (nothing reached for)', jsonRun.status, EXIT_OK);
  t('the printed rows are the built rows', parsed?.rows?.length, rows.length);
  t('the printed JSON carries the mailboxes on no seat row', parsed?.unassignedMailboxes?.map((m) => m.ref.number), [25395, 25396, 25398]);
  t('--fixture prints the markdown table', cli(['--fixture', FIXTURE_PATH]).stdout.split('\n')[0], ROSTER_MARKER);
  t('a usage error is exit 2', cli(['--write', 'x']).status, EXIT_USAGE);
  t('a missing fixture is exit 3', cli(['--fixture', join(PM_DIR, 'no-such-fixture.json')]).status, EXIT_PREREQUISITE);

  const floor = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) floor.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  for (const [name, count] of seen) if (!declared.includes(name)) floor.push(`battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) floor.push(count === 0 ? `battery "${name}" DID NOT RUN — 0 cases, ${SELF_TEST_BATTERIES[name]} pinned.` : `battery "${name}" registered ${count} case(s), below its floor of ${SELF_TEST_BATTERIES[name]}.`);
  }
  for (const f of floor) console.error(`✗ self-test floor: ${f}`);
  failed += floor.length;
  if (failed > 0) {
    console.error(`\n✗ fleet-roster self-test: ${failed} failure(s) (cases and floor).`);
    return 1;
  }
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  console.log(`✓ fleet-roster self-test: ${total} cases in ${declared.length} batteries pass.`);
  selfTestReachedVerdict = true;
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\n✗ fleet-roster self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
        'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}
