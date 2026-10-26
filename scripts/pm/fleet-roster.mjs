#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fleet-roster — regenerate the pinned 「车队总表」 issue: which account holds
 * which lane seat, and what each seat has in flight (#25416).
 *
 *   node scripts/pm/fleet-roster.mjs [--repos o/a,o/b,…] [--json]             # read GitHub, print the table (or the rows)
 *   node scripts/pm/fleet-roster.mjs [--repos …] --write <n> [--board o/r] [--dry-run]
 *   node scripts/pm/fleet-roster.mjs --fixture <file.json> [--json] [--now <iso>]   # offline, from a snapshot
 *   node scripts/pm/fleet-roster.mjs --self-test                                # offline, no network
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
 *   account          the login after 🟢 in the title, else the post's first
 *                    assignee while seated. `🟢 Routine` reads as Routine.
 *   project          「由 X 账户的项目负责」 in the title or body — the line
 *                    a project-held seat carries.
 *   in flight        open `pm:dispatched` cards of the lane assigned to the
 *                    seat's account. A `domain:x` lane is that label on the
 *                    seat's repo; a `repo:x` lane is every card of repo x plus
 *                    the post's own repo's cards labelled `repo:x`. An account
 *                    on two seats of one lane shows them on its lowest seat
 *                    only; the other reads `= seat N`.
 *   awaiting ruling  open `needs-user-decision` cards of the lane (issues, not
 *                    pulls): on the seat whose account is assigned, else on
 *                    the lane's lowest seated seat number, else its lowest.
 *   awaiting landing open pulls on a `claude/` head that close an in-flight
 *                    card of the seat (`Fixes|Closes|Resolves #n`) and carry a
 *                    review verdict — a `## 席位核对` comment whose verdict
 *                    line is ACCEPT, or a `## Contract review` with
 *                    `VERDICT: PASS`. ⛔ `pm:mailbox` pulls never count
 *                    (`LEDGER_EXCLUSION`).
 *   wall note        a line-initial `Wall:` (or `撞墙:`) line in the post
 *                    body, the seat's own record of a usage wall.
 *   last activity    the newest `updated_at` of the post and its in-flight
 *                    cards. A seated seat older than `STALE_HOURS` with no
 *                    wall note is flagged 「疑似撞墙」.
 *   mailbox          open `pm:mailbox` pulls of the seat's account, by head
 *                    `mailbox/<login>` or the body's `Mailbox-of: <login>`.
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
 * script never creates, pins or comments. It has no schedule: the director
 * seat's digest and any seat/takeover/handover call it.
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
// The mailbox label, its ledger exclusion and its branch prefix have ONE owner,
// the mailbox opener (#25417); this file reads them, never re-spells them.
import * as mailboxOpen from './mailbox-open.mjs';
import { LEDGER_EXCLUSION, MAILBOX_BRANCH_PREFIX, MAILBOX_LABEL } from './mailbox-open.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const PM_DIR = dirname(SELF_PATH);
const REPO_ROOT = join(PM_DIR, '..', '..');
const FIXTURE_PATH = join(PM_DIR, 'fleet-roster.fixture.json');

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = 3;
export const EXIT_REFUSED = 4;

export const DEFAULT_REPOS = Object.freeze(['objectstack-ai/objectstack', 'objectstack-ai/objectui', 'objectstack-ai/hotcrm']);
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
  const opts = { repos: [...DEFAULT_REPOS], board: DEFAULT_BOARD, write: null, fixture: null, now: null, json: false, dryRun: false, selfTest: false, help: false, errors: [] };
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
    else if (a === '--repos') {
      const v = value(a);
      if (v !== null) opts.repos = v.split(',').map((s) => s.trim()).filter(Boolean);
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
  if (opts.write !== null && opts.json) opts.errors.push('--write writes the table; --json prints rows — pick one');
  if (opts.write !== null && opts.fixture !== null) opts.errors.push('--write never writes a fixture snapshot');
  if (opts.dryRun && opts.write === null) opts.errors.push('--dry-run only qualifies --write');
  if (opts.now !== null && Number.isNaN(Date.parse(opts.now))) opts.errors.push(`--now ${JSON.stringify(opts.now)} is not a timestamp`);
  return opts;
}

const labelNames = (x) => (Array.isArray(x?.labels) ? x.labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean) : []);
const assigneeLogins = (x) => (Array.isArray(x?.assignees) ? x.assignees.map((a) => (typeof a === 'string' ? a : a?.login)).filter(Boolean) : []);
const lc = (s) => String(s ?? '').toLowerCase();

/** One seat post's title (and body) → its seat fields, or null when the title is not a status board. Pure. */
export function parseSeat(post, board) {
  const m = /^\[PM seat\]\s+(.+?)\s+—\s+(.+)$/u.exec(String(post?.title ?? ''));
  if (!m) return null;
  const [, name, statusText] = m;
  const owner = board.split('/')[0];
  const token = /^([a-z]+:[A-Za-z0-9._-]+|[a-z]+)/.exec(name)?.[1] ?? name.split(/\s/)[0];
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
    if (/^##[ \t]*席位核对[ \t]*$/m.test(body) && /^[ \t]*(?:\*\*)?ACCEPT(?:\*\*)?\b/m.test(body)) return true;
    return /^##[ \t]*Contract review\b/m.test(body) && /^[ \t]*(?:\*\*)?VERDICT:[ \t]*PASS\b/im.test(body);
  });
}

/** The login whose mailbox a `pm:mailbox` pull is, or null. Pure. */
export function mailboxLogin(pr) {
  if (!labelNames(pr).includes(MAILBOX_LABEL)) return null;
  const ref = String(pr?.head?.ref ?? '');
  if (ref.startsWith(MAILBOX_BRANCH_PREFIX)) return ref.slice(MAILBOX_BRANCH_PREFIX.length);
  return /^Mailbox-of: (\S+)/m.exec(String(pr?.body ?? ''))?.[1] ?? null;
}

const cardLaneMatch = (card, row) => {
  if (row.lane.startsWith('domain:')) return card.repo === row.repo && card.labels.includes(row.lane);
  if (row.lane.startsWith('repo:')) return card.repo === row.repo || (card.repo === row.board && card.labels.includes(row.lane));
  return false;
};
const ref = (repo, number) => ({ repo, number });
const keyOf = (r) => `${r.repo}#${r.number}`;
const byRef = (a, b) => (a.repo === b.repo ? a.number - b.number : a.repo < b.repo ? -1 : 1);

/**
 * snapshot = { repos: { 'owner/name': { seats, dispatched, rulings, pulls, comments: { '<n>': [...] } } } }
 * → the roster rows, deterministically ordered (repo, lane, seat, post). Pure.
 */
export function buildRows(snapshot, { now }) {
  const nowMs = Date.parse(now);
  const repos = Object.keys(snapshot?.repos ?? {}).sort();
  const rows = [];
  const cards = [];
  const rulings = [];
  const pulls = [];
  for (const repo of repos) {
    const s = snapshot.repos[repo] ?? {};
    for (const post of s.seats ?? []) {
      if (post.pull_request || !labelNames(post).includes('pm:seat')) continue;
      const seat = parseSeat(post, repo);
      if (seat) rows.push(seat);
    }
    const asCard = (i) => ({ repo, number: i.number, labels: labelNames(i), assignees: assigneeLogins(i).map(lc), updatedAt: i.updated_at ?? null });
    for (const i of s.dispatched ?? []) if (!i.pull_request && i.state !== 'closed') cards.push(asCard(i));
    for (const i of s.rulings ?? []) if (!i.pull_request && i.state !== 'closed') rulings.push(asCard(i));
    for (const p of s.pulls ?? []) if (p.state !== 'closed') pulls.push({ repo, pr: p, comments: s.comments?.[String(p.number)] ?? [] });
  }
  rows.sort((a, b) => (a.repo !== b.repo ? (a.repo < b.repo ? -1 : 1) : a.lane !== b.lane ? (a.lane < b.lane ? -1 : 1) : a.seat !== b.seat ? a.seat - b.seat : a.post - b.post));

  const landing = new Map(); // card key → [pull refs]
  const mailboxes = [];
  for (const { repo, pr, comments } of pulls) {
    const owner = mailboxLogin(pr);
    if (owner !== null) {
      mailboxes.push({ login: lc(owner), ref: ref(repo, pr.number) });
      continue;
    }
    if (labelNames(pr).includes(MAILBOX_LABEL) || !String(pr?.head?.ref ?? '').startsWith(CARD_BRANCH_PREFIX) || !hasLandingVerdict(comments)) continue;
    for (const k of closingRefs(pr.body, repo)) landing.set(k, [...(landing.get(k) ?? []), ref(repo, pr.number)]);
  }

  const out = rows.map((row) => {
    const acct = lc(row.account);
    // One account on two seats of one lane: the cards cannot say which seat, so the lowest seat shows them once.
    const first = row.account ? rows.find((r) => r.repo === row.repo && r.lane === row.lane && lc(r.account) === acct) : row;
    const sharesWith = first !== row ? first.seat : null;
    const inFlight = row.account && sharesWith === null ? cards.filter((c) => cardLaneMatch(c, row) && c.assignees.includes(acct)) : [];
    const awaitingLanding = inFlight.flatMap((c) => landing.get(keyOf(c)) ?? []);
    const times = [row.updatedAt, ...inFlight.map((c) => c.updatedAt)].filter(Boolean).sort();
    const lastActivity = times.at(-1) ?? null;
    const ageHours = lastActivity && Number.isFinite(nowMs) ? (nowMs - Date.parse(lastActivity)) / 3_600_000 : null;
    return {
      ...row,
      sharesWith,
      inFlight: inFlight.map((c) => ref(c.repo, c.number)).sort(byRef),
      awaitingRuling: [],
      awaitingLanding: awaitingLanding.sort(byRef),
      lastActivity,
      suspectedWall: row.status === 'seated' && row.wallNote === null && ageHours !== null && ageHours > STALE_HOURS,
      mailbox: row.account ? mailboxes.filter((m) => m.login === acct).map((m) => m.ref).sort(byRef) : [],
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

function age(iso, now) {
  if (!iso) return '—';
  const h = (Date.parse(now) - Date.parse(iso)) / 3_600_000;
  const rel = h < 1 ? '<1h' : h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`;
  return `${iso.slice(0, 16).replace('T', ' ')}Z (${rel})`;
}

/** The reads made for `repos`, in the order made — the footer's provenance. Pure. */
export function readsFor(repos) {
  return repos.flatMap((r) => [
    `GET /repos/${r}/issues?state=open&labels=pm:seat`,
    `GET /repos/${r}/issues?state=open&labels=pm:dispatched`,
    `GET /repos/${r}/issues?state=open&labels=needs-user-decision`,
    `GET /repos/${r}/pulls?state=open`,
    `GET /repos/${r}/issues/{n}/comments for each claude/ pull closing an in-flight card (${LEDGER_EXCLUSION} excluded)`,
  ]);
}

/** The roster body, markdown. Pure. */
export function renderBody(rows, { now, repos, session = null }) {
  const lines = [
    ROSTER_MARKER,
    '# 车队总表 — fleet roster',
    '',
    'A generated view of the seat posts (`pm:seat`), the `pm:*` labels, assignees and open pulls — **never a second tracker**: the cards and seat posts are the record, and the next run overwrites this body.',
    '',
    '| repo | lane | seat | account | in flight | awaiting ruling | awaiting landing | wall note | last activity | mailbox PR |',
    '|:--|:--|:-:|:--|:--|:--|:--|:--|:--|:--|',
  ];
  for (const r of rows) {
    const who = r.routine ? 'Routine' : r.account ? `\`${r.account}\`` : '—';
    const account = `${r.mark ?? '?'} ${who}${r.project ? ` · 由 ${r.project} 账户的项目负责` : ''}`;
    const wall = r.wallNote ?? (r.suspectedWall ? `⚠️ ${SUSPECTED_WALL}` : '—');
    const inFlight = r.sharesWith !== null ? `= seat ${r.sharesWith}` : refs(r.inFlight);
    lines.push(
      `| ${r.repo.split('/')[1]} | ${cell(r.lane)} | [${r.seat}](https://github.com/${r.board}/issues/${r.post}) | ${cell(account)} | ${inFlight} | ${refs(r.awaitingRuling)} | ${refs(r.awaitingLanding)} | ${cell(wall)} | ${age(r.lastActivity, now)} | ${refs(r.mailbox)} |`,
    );
  }
  const seated = rows.filter((r) => r.status === 'seated');
  lines.push(
    '',
    `${rows.length} seat posts · ${seated.length} seated · ${rows.filter((r) => r.suspectedWall).length} ${SUSPECTED_WALL} (seated, no \`Wall:\` line, last activity older than ${STALE_HOURS} h).`,
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
// The live edges — `gh api` reads (paged by `gh-pages.mjs`), the relay
// ---------------------------------------------------------------------------

function ghJson(path, { paginate = false } = {}) {
  return paginate ? readAllPages(path) : ghApi(path);
}

/** Read every repo into the snapshot shape `buildRows` takes; throws on the first failed read. */
function readLive(repos) {
  const need = (path, paginate = true) => {
    const r = ghJson(path, { paginate });
    if (!r.ok) throw new Error(`GET ${path} — ${r.error}`);
    return r.value;
  };
  const snapshot = { repos: {} };
  for (const repo of repos) {
    const s = {
      seats: need(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent('pm:seat')}&per_page=100`),
      dispatched: need(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent('pm:dispatched')}&per_page=100`),
      rulings: need(`/repos/${repo}/issues?state=open&labels=needs-user-decision&per_page=100`),
      pulls: need(`/repos/${repo}/pulls?state=open&per_page=100`),
      comments: {},
    };
    snapshot.repos[repo] = s;
  }
  // Comments only for the pulls that could fill "awaiting landing": a claude/ head, not a mailbox, closing a dispatched card.
  const dispatched = new Set(Object.entries(snapshot.repos).flatMap(([repo, s]) => s.dispatched.map((i) => `${repo}#${i.number}`)));
  for (const [repo, s] of Object.entries(snapshot.repos)) {
    for (const p of s.pulls) {
      if (mailboxLogin(p) !== null || labelNames(p).includes(MAILBOX_LABEL) || !String(p.head?.ref ?? '').startsWith(CARD_BRANCH_PREFIX)) continue;
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
  '  node scripts/pm/fleet-roster.mjs --self-test',
  `  Exits: ${EXIT_OK} done · ${EXIT_USAGE} usage or refused stroke · ${EXIT_PREREQUISITE} prerequisite · ${EXIT_REFUSED} refused on board state · 5+ the relay's own exit`,
].join('\n');

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
  let snapshot;
  let repos = opts.repos;
  try {
    if (opts.fixture !== null) {
      snapshot = JSON.parse(readFileSync(opts.fixture, 'utf8'));
      repos = Object.keys(snapshot.repos ?? {}).sort();
    } else snapshot = readLive(repos);
  } catch (e) {
    console.error(`✗ fleet-roster: ${opts.fixture !== null ? `could not read the fixture ${opts.fixture}` : 'a read failed'} — ${e.message}. Nothing was written.`);
    return EXIT_PREREQUISITE;
  }
  const now = new Date(opts.now ?? snapshot.now ?? Date.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const rows = buildRows(snapshot, { now });
  if (opts.json) {
    console.log(JSON.stringify({ now, repos, rows }, null, 2));
    return EXIT_OK;
  }
  const session = env.OS_FLEET_SESSION || env.CLAUDE_CODE_REMOTE_SESSION_ID || null;
  const body = renderBody(rows, { now, repos, session });
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
  'the fixture snapshot: rows for the three repos': 15,
  'the rendered body: marker, columns, footer, determinism': 8,
  'refusing to overwrite what is not the roster': 6,
  'the CLI: fixture runs offline, usage errors are exit 2': 5,
  'paging: a three-page read through the loop equals the slurped array': 4,
});
const SELF_TEST_BATTERY_FLOOR = 8;

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
  t('defaults: the three repos, board objectstack, no write', [d.errors, d.repos, d.board, d.write], [[], [...DEFAULT_REPOS], DEFAULT_BOARD, null]);
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
  t('the mailbox constants are the opener\'s own, imported not re-spelled', [MAILBOX_LABEL, LEDGER_EXCLUSION, MAILBOX_BRANCH_PREFIX], [mailboxOpen.MAILBOX_LABEL, mailboxOpen.LEDGER_EXCLUSION, mailboxOpen.MAILBOX_BRANCH_PREFIX]);
  t('a mailbox is read by head, then by body line; no label ⇒ none', [mailboxLogin({ labels: ['pm:mailbox'], head: { ref: 'mailbox/os-bill' } }), mailboxLogin({ labels: ['pm:mailbox'], head: { ref: 'claude/x' }, body: 'Mailbox-of: os-sales\n' }), mailboxLogin({ labels: [], head: { ref: 'mailbox/os-bill' } })], ['os-bill', 'os-sales', null]);

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
    'objectstack:triage:1',
    'objectui:domain:ui:1',
    'objectui:domain:ui:4',
  ]);
  t('the non-seat issue in the seat list is skipped', rows.some((r) => r.post === 999), false);
  t('today’s three seats carry the right accounts', [row(19287).account, row(6023).account, row(1353, 'objectstack-ai/hotcrm').account], ['os-elon-musk', 'os-elon-musk', 'os-elon-musk']);
  t('devx seat 1: its assigned dispatched card, not seat 2’s', row(6023).inFlight, [{ repo: 'objectstack-ai/objectstack', number: 25416 }]);
  t('devx seat 2 (os-sales) has its own card', row(20163).inFlight, [{ repo: 'objectstack-ai/objectstack', number: 25300 }]);
  t('a card of another lane never leaks in', row(19287).inFlight, [{ repo: 'objectstack-ai/objectstack', number: 25412 }]);
  t('awaiting landing: the ACCEPTed claude/ PR only', row(19287).awaitingLanding, [{ repo: 'objectstack-ai/objectstack', number: 25427 }]);
  t('a pm:mailbox PR closing a card never counts as landing', row(6023).awaitingLanding, []);
  t('a PR with no verdict does not count', row(1353, 'objectstack-ai/hotcrm').awaitingLanding, []);
  t('an unassigned ruling sits on the lane’s lowest seated seat', [row(6023).awaitingRuling, row(20163).awaitingRuling], [[{ repo: 'objectstack-ai/objectstack', number: 25373 }], []]);
  t('a ruling assigned to seat 2’s account sits on seat 2', row(19287).awaitingRuling, [{ repo: 'objectstack-ai/objectstack', number: 25344 }]);
  t('the mailbox column is the account’s pm:mailbox PR', [row(6023).mailbox, row(20163).mailbox], [[{ repo: 'objectstack-ai/objectstack', number: 25392 }], []]);
  t('stale and no wall note ⇒ 疑似撞墙; a wall note silences it; vacant never', [row(20163).suspectedWall, row(5560, 'objectstack-ai/objectui').suspectedWall, row(5560, 'objectstack-ai/objectui').wallNote, row(7623).suspectedWall], [true, false, 'limit reached, resets at 15:00Z', false]);
  t('last activity is the newest of post and in-flight cards', row(6023).lastActivity, '2026-10-23T13:28:00Z');
  t('one account on two seats of a lane: cards on the lowest seat, the other reads = seat 1', [row(5560, 'objectstack-ai/objectui').inFlight.length, row(10243, 'objectstack-ai/objectui').sharesWith, row(10243, 'objectstack-ai/objectui').inFlight, row(10243, 'objectstack-ai/objectui').suspectedWall], [1, 1, [], true]);

  battery('the rendered body: marker, columns, footer, determinism');
  const body = renderBody(rows, { now: fixture.now, repos: Object.keys(fixture.repos).sort(), session: 'cse_01ABC' });
  t('the body opens with the marker', body.split('\n')[0], ROSTER_MARKER);
  t('the header names the ten columns', body.includes('| repo | lane | seat | account | in flight | awaiting ruling | awaiting landing | wall note | last activity | mailbox PR |'), true);
  t('one table row per seat post', body.split('\n').filter((l) => /^\| (?:hotcrm|objectstack|objectui) \|/.test(l)).length, rows.length);
  t('the footer names the generation time and each read', [body.includes(`Generated ${fixture.now}`), body.includes('`GET /repos/objectstack-ai/hotcrm/issues?state=open&labels=pm:seat`')], [true, true]);
  t('the suspected wall is spelled in the row', body.includes(`⚠️ ${SUSPECTED_WALL}`), true);
  t('a shared seat reads = seat N in the in-flight cell', body.includes('| = seat 1 |'), true);
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

  battery('the CLI: fixture runs offline, usage errors are exit 2');
  const cli = (args) => spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', OS_FLEET_SESSION: '', CLAUDE_CODE_REMOTE_SESSION_ID: '' } });
  const jsonRun = cli(['--fixture', FIXTURE_PATH, '--json']);
  let parsed = null;
  try {
    parsed = JSON.parse(jsonRun.stdout);
  } catch {}
  t('--fixture --json exits 0 with no gh on PATH (nothing reached for)', jsonRun.status, EXIT_OK);
  t('the printed rows are the built rows', parsed?.rows?.length, rows.length);
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
