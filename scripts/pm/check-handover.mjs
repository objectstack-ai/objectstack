#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-handover — the pre-handover check: a departing seat session may write its `⏳ vacant` body only when
 * this exits 0 (#23396, ruling 6162084315, letter A).
 *
 *   node scripts/pm/check-handover.mjs --session=session_01… --account=LOGIN [--since=ISO] [--repo=OWNER/NAME]
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
 *                         (`DECISION_FACET_MARKER`, `os-decision-facets`, read by `hasDecisionFacetMarker` — the
 *                         literal grep the shape prescribes, so the plain line and its HTML-comment form both
 *                         read), with no ruling comment (`check-prior-rulings.mjs`'s `classifyRulingComment`)
 *                         newer than it, and whose state labels (`PM_EXCLUSIVE_STATE_LABELS`, the six
 *                         mutually exclusive states of `SKILL.md`) are anything but `needs-user-decision` alone.
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
 * (b) keys on the facet marker, as ruled. The two decision analyses the card measured carried no marker, so (b)
 * would not have fired on them: its recall is the four-facet filing duty's (`decision-analysis.md`). And a seat
 * that stays behind for a named tail (`seat-post-protocol.md`, 留守) still holds that card at `pm:dispatched`;
 * (a) refuses it until the tail lands or is released.
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
  OPEN_LISTING_PAGE_CEILING,
  PM_EXCLUSIVE_STATE_LABELS,
  PROXY_FLAG,
  RELEASE_COMMENT_MARKER,
  SEAT_SESSION_ID,
  classifyTransportProbe,
  describeTransportRoute,
  hasDecisionFacetMarker,
  labelNames,
  latestMarkedComment,
  markerMatches,
  pmLabelListingPath,
  proxyRearmPlan,
  resolveSweepRepo,
} from './check-half-states.mjs';
import { classifyRulingComment } from './check-prior-rulings.mjs';

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
 * Predicate (b) over one card, the departing session's fleet-bot comments on it, and every comment on it that the
 * stream holds (for the ruling-after test). `null` when the card is not pending a decision from this session, or
 * when it sits in the inbox alone; otherwise the row.
 */
export function decisionOutsideInbox(issue, sessionComments, cardComments) {
  if (issue?.pull_request || issue?.state !== 'open') return null;
  const mine = (Array.isArray(sessionComments) ? sessionComments : []).filter((c) => c?.user?.login === FLEET_BOT_LOGIN);
  const latest = mine.reduce((best, c) => (best === null || isNewer(c, best) ? c : best), null);
  if (latest === null || !hasDecisionFacetMarker(latest.body)) return null;
  const ruled = (Array.isArray(cardComments) ? cardComments : []).find((c) => isNewer(c, latest) && classifyRulingComment(c?.body) !== null);
  if (ruled) return null;
  const labels = labelNames(issue);
  const states = PM_EXCLUSIVE_STATE_LABELS.filter((l) => labels.includes(l));
  if (states.length === 1 && states[0] === DECISION_INBOX_LABEL) return null;
  return { number: issue.number, title: issue.title ?? '', states, comment: latest };
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
    if (hasDecisionFacetMarker(latest.body)) out.push(number);
  }
  return out.sort((a, b) => a - b);
}

export function parseArgs(argv) {
  const options = { session: null, account: null, since: null, repo: null, selfTest: false, probe: false };
  for (const arg of argv) {
    if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--probe') options.probe = true;
    else if (arg === '--help' || arg === '-h') return { ok: false, help: true };
    else {
      const m = /^--(session|account|since|repo)=(.*)$/u.exec(arg);
      if (!m) return { ok: false, error: `unknown argument ${JSON.stringify(arg)} (spell options as --key=value)` };
      options[m[1]] = m[2].trim();
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
  return { ok: true, options };
}

/** The refusal a departing seat reads. Rows: `{ kind: 'held', issue, claim }` or `{ kind: 'decision', row }`. */
export function refusalText(findings, { session, account, repo }) {
  const lines = findings.map((f, i) =>
    f.kind === 'held'
      ? `  ${i + 1}. [claim-unreleased] #${f.issue.number} ${JSON.stringify(f.issue.title ?? '')} — \`pm:dispatched\`, assignee ` +
        `\`${account}\`, newest \`Claim:\` (comment ${f.claim?.id}) carries this session, and no \`Release:\` from this session follows it.\n` +
        '     Land it, or write `Release:` (session · reason · next) and clear the assignee in ONE write, then move it to its real state.'
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

async function readThread(repo, number) {
  const rows = [];
  for (let page = 1; page <= OPEN_LISTING_PAGE_CEILING * 5; page++) {
    const batch = await rest(`/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  const err = new Error(`the thread of #${number} filled ${OPEN_LISTING_PAGE_CEILING * 5} pages — not read to its end`);
  err.truncated = true;
  throw err;
}

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
    const findings = [];
    for (const issue of mine) {
      const held = claimHolding(issue, await readThread(repo, issue.number), options);
      if (held.verdict === 'held') findings.push({ kind: 'held', issue, claim: held.claim });
      else if (held.verdict === 'other-session' || held.verdict === 'unclaimed') listed.push(`#${issue.number} (${held.verdict === 'unclaimed' ? 'no `Claim:` at all' : 'held by another session'})`);
    }
    coverage.push(`(a) ${dispatched.length} open \`pm:dispatched\` card(s), ${mine.length} assigned to \`${options.account}\`, every one of their threads read`);

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
      if (row !== null) findings.push({ kind: 'decision', row });
    }
    coverage.push(
      `(b) ${streamPages} page(s) of the comment stream since ${since} — ${stream.length} comment(s), ${sessionCount} by the fleet ` +
        `carrying this session on ${[...byCard.values()].filter((e) => e.session.length > 0).length} card(s), ${candidates.length} whose latest carries the ` +
        `four-facet block; a session comment older than the window is UNREAD (widen with --since)`,
    );
    const context = { session: options.session, account: options.account, repo };
    const tail = `  Read: ${coverage.join('; ')}.` + (listed.length > 0 ? `\n  Listed, not refused: ${listed.join(', ')}.` : '');
    if (findings.length > 0) {
      console.error(`${refusalText(findings, context)}\n${tail}`);
      return EXIT_REFUSED;
    }
    console.log(`✓ check-handover: clear — no unreleased claim and no decision outside the inbox for ${options.session} on ${repo}.\n${tail}`);
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

  // the stream
  const STREAM = [ANALYSIS(5, 10), comment(8, 20, `note \`${S}\``, FLEET_BOT_LOGIN, 23169), comment(9, 30, 'another seat', FLEET_BOT_LOGIN, 23169), { ...ANALYSIS(10, 40), issue_url: 'https://api.github.com/repos/o/r/issues/23300', user: { login: 'zhuangjianguo' } }];
  const grouped = groupStream(STREAM, S);
  t('the stream groups by card, every comment kept, the session\'s fleet comments apart', grouped.get(23169).all.length === 2 && grouped.get(23169).session.length === 1 && grouped.get(23193).session.length === 1);
  t('…and a candidate is a card whose LATEST session comment carries the block — the non-fleet author buys no read', decisionCandidates(grouped).join() === '23193');

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
