#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * round-open — the round-open mutex: before the first write of a fire, does any activity of THIS seat that no
 * stand-down brief closed, less than one round old, belong to another session? Read-only.
 *
 *   node scripts/pm/round-open.mjs --seat repo:objectstack#8 --session session_01… [--own session_01…,…]
 *                                  [--post N] [--intake area:fleet,epic:#N] [--round-minutes 60] [--repo OWNER/NAME]
 *                                  [--json] [--fixture FILE] [--now ISO]
 *   node scripts/pm/round-open.mjs --self-test          # offline, no network at all
 *
 * ## Why this file exists
 *
 * `references/seat-lifecycle.md` 〈开轮互斥〉 makes every executing seat take four readings at fire start, and the seat
 * retyped them by hand each fire: find the seat post, find its newest stand-down brief and the newest marker after it,
 * walk the lane's dispatched and queued cards for the newest claim of the same seat number by another session, check
 * every lane card's branch for a push since the brief (`git ls-remote`, card by card), and walk the lane's closed
 * cards newest-updated first for the first same-seat claim. The rule is one line; the reading is long, and it is where
 * two sessions end up sitting one seat. This file is the reading. ⛔ It writes nothing — the marker the rule asks for
 * after a clear mutex is the seat's own write, and the rule text keeps every judgement this file does not make.
 *
 * ## The readings — the rule text on `main`, pinned by the self-test (`LIFECYCLE_PHRASES`)
 *
 *   1. the seat post's NEWEST stand-down brief (`standDownBrief`: its headline, one of the measured spellings);
 *   2. the NEWEST comment after it signed by this seat (`LANE#N · ACCOUNT · SESSION`, `readSignatureLine`) — the
 *      round-open marker is the one trace a running session leaves on the post, and any seat-signed comment is that
 *      session's trace, so the headline is printed, never required;
 *   3. every open `pm:dispatched` ∪ `pm:queue` card updated inside the window, on the intake or off it (a p0 or p1
 *      card is taken from any area): the newest `Claim:` of THIS seat (its `Seat:` line, else its signature) written
 *      by another session — and a push to a card's `claude/issue-N` branch (one `git ls-remote` for the whole board,
 *      intersected locally; the head commit's committer date and `Claude-Session:` trailer), which counts as a claim
 *      when the card's newest claim is this seat's, or, on the seat's intake (`seatIntakeKeys`: the post title's
 *      `area:*` and `epic #N`, or `--intake`), when there is none (推即认领);
 *   4. every closed card updated inside the window, newest-updated first: the first with a claim of this seat — its
 *      session, timed by that session's newest comment on the card (a merge closes a card, so `closed_at` is no act
 *      of the seat).
 *
 * The verdict: an activity is UN-CLOCKED-OUT when it is newer than reading 1 (or there is no brief), and FOREIGN when
 * its session is not `--session` or an `--own` one (a lease-table session, the seat's card threads) — an unread
 * session is foreign. A foreign, un-clocked-out activity less than one round old (`--round-minutes`, default
 * `ROUND_MINUTES`: contract-review.md's 「一轮(约 60 分钟)」) is the self-exit (YIELD, exit 5). A brief newer than every
 * activity is the release marker: clear at once. Every reading is bounded by that window — a card not updated inside
 * it buys no thread read.
 *
 * ## What it does NOT read — named in the footer of every run (`UNREAD_LEGS`)
 *
 * The maintainer's explicit summon (the arbitration line), the lease table (pass its sessions with `--own`), a push to
 * a branch not spelled `claude/issue-N…` (a card thread's platform branch), a push's real time (the committer date is
 * read; a later push of an older commit reads older), the 不占席 chains and the director seat (refused: the mutex is an
 * executing seat's), and the touch readings the rule takes after a clear mutex (`git-history.mjs touch`,
 * `check-harness-current.mjs`).
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0  CLEAR — every reading answered and no foreign activity under one round old outlived the newest brief
 *   1  `--self-test` failed
 *   2  usage
 *   3  PREREQUISITE NOT MET — the seat post could not be listed or read; nothing was judged
 *   4  INCOMPLETE — a reading could not be taken (each gap named); ⛔ never a clear mutex
 *   5  YIELD (自退) — a foreign activity under one round old, each named; printed over any gap
 *
 * Every reader is borrowed, never re-spelled: `check-half-states.mjs` owns the claim and release markers, the
 * signature line, the headline, the intake keys and the session shape; `gh-pages.mjs` owns the paging. The self-test
 * carries the floor and the handshake AGENTS.md § "Writing a `--self-test`" requires (copied, never imported).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { isEntrypoint } from '../invoked-as.mjs';
import {
  CLAIM_COMMENT_MARKER,
  DEFAULT_SWEEP_REPO,
  SEAT_SESSION_ID,
  cardIntakeKeys,
  h44IsRoundOpenMarker,
  h65Headline,
  labelNames,
  markerMatches,
  readSignatureLine,
  seatIntakeKeys,
} from './check-half-states.mjs';
import { ghApi, readAllPages } from './gh-pages.mjs';

const REPO_ROOT = new URL('../../', import.meta.url);

export const EXIT_CLEAR = 0;
export const EXIT_SELF_TEST_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = 3;
export const EXIT_INCOMPLETE = 4;
export const EXIT_YIELD = 5;

/** One round, in minutes — contract-review.md's 「一轮(约 60 分钟)」, pinned below. */
export const ROUND_MINUTES = 60;
export const LANE_LABELS = Object.freeze(['pm:dispatched', 'pm:queue']);

/** The rule text this file is built from — the self-test pins each phrase present in the file that writes it. */
export const LIFECYCLE_PATH = '.claude/skills/pm-dispatch/references/seat-lifecycle.md';
export const LIFECYCLE_PHRASES = Object.freeze([
  '未收班活动任一未满一轮 ⇒ 自退',
  '读数一、二:最近的收班简报,与晚于它的最新开轮标记',
  '读数三:本车道 `pm:dispatched` ∪ `pm:queue` 卡最新非本 session 同席号的 `Claim:` 评论',
  '推即认领',
  '读数四:本车道 `state=CLOSED`',
  '简报即最新事件 ⇒ 立即坐席',
  '`round-open.mjs`',
]);
export const CONTRACT_REVIEW_PATH = '.claude/skills/pm-dispatch/references/contract-review.md';
export const ROUND_PHRASE = '一轮(约 60 分钟)';

/** The legs this file cannot read, printed under every run. */
export const UNREAD_LEGS = Object.freeze([
  "the maintainer's explicit summon — the arbitration line (有简报径直坐席;无简报才走保守确认); not on the board as a reading",
  'the lease table — its area sessions see this seat by rule; pass them with --own, the reader does not parse the table',
  'a push to a branch not spelled `claude/issue-N…` (a card thread\'s platform branch), or on an off-intake card no claim names — matched to no seat here; its claim names it',
  "a push's real time — the head commit's committer date is read, so a later push of an older commit reads older",
  'the touch readings after a clear mutex — `git-history.mjs touch` and `check-harness-current.mjs`, run them next',
]);

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

/** `LANE#N`: an executing seat — `repo:NAME#N`, `epic:#N#k` or a retired `domain:LANE#N`. `null` otherwise. Pure. */
export function parseSeat(text) {
  const v = String(text ?? '').trim().toLowerCase();
  const m = /^(repo:[a-z0-9][a-z0-9._-]*|epic:#[1-9][0-9]*|domain:[a-z][a-z0-9-]*)#([1-9][0-9]*)$/u.exec(v);
  return m ? { lane: m[1], seat: Number(m[2]), name: `${m[1]}#${m[2]}` } : null;
}

/** The seat a `[PM seat] …` title names — `LANE · seat N`, `LANE#N`, or bare `LANE` for seat 1. Pure. */
export function seatOfPostTitle(title) {
  const m = /^\[PM seat\]\s*(.*?)\s*—/u.exec(String(title ?? ''));
  if (!m) return null;
  const half = m[1].trim();
  const numbered = /^(\S+?)\s*·\s*seat\s+([1-9][0-9]*)\b/iu.exec(half);
  if (numbered) return `${numbered[1].toLowerCase()}#${numbered[2]}`;
  const hashed = /^(\S+?)#([1-9][0-9]*)(?:\s|$)/u.exec(half);
  if (hashed) return `${hashed[1].toLowerCase()}#${hashed[2]}`;
  const bare = /^(\S+)/u.exec(half);
  return bare ? `${bare[1].toLowerCase()}#1` : null;
}

/**
 * A stand-down brief's headline — the measured spellings on the live seat posts, a closed set: `## Clock-out · …`,
 * `Clock-out: … seat 2 is vacant`, `## Clock-out brief (…)`, `Clock-out brief · seat 7 · …`, `## 收班简报 · …`,
 * `**收班简报 2026-11-08**`, `# 🔻 收班简报 · 分诊席`, `Stand-down brief · …`, `Shift end · … is vacant`. Anchored at
 * the headline's start, so a comment that MENTIONS a clock-out (`Premise corrected (to clock-out …)`) is none.
 */
export const STAND_DOWN_HEADLINE = /^[ \t>]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*(?:🔻[ \t]*)?(?:Clock-out(?:[ \t]+brief)?|Stand-down brief|Shift end|收班简报)(?![A-Za-z-])/iu;

/** Is this comment a stand-down brief? Read on its headline (one leading signature line skipped, fences blanked). */
export const standDownBrief = (body) => STAND_DOWN_HEADLINE.test(h65Headline(body));

const stampOf = (row) => {
  const ms = Date.parse(row?.created_at ?? '');
  return Number.isFinite(ms) ? ms : null;
};

/** The seat a claim declares: its `Seat:` line, else its signature's `LANE#N`; `null` when neither reads. Pure. */
export function claimSeat(body) {
  const text = String(body ?? '');
  const keyed = /^[ \t]*(?:[-*+][ \t]+)?>?[ \t]*(?:\*\*)?`?Seat`?(?:\*\*)?[ \t]*:[ \t]*`?((?:repo:[A-Za-z0-9._-]+|epic:#[1-9][0-9]*|domain:[a-z0-9_-]+)#[1-9][0-9]*)/imu.exec(text);
  if (keyed) return keyed[1].toLowerCase();
  const sig = readSignatureLine(text);
  return sig ? `${sig.lane}#${sig.seat}`.toLowerCase() : null;
}

/** The session a comment speaks for: a `Session:` line, else its signature's, else the first session id; or null. */
export function commentSession(body) {
  const text = String(body ?? '');
  const keyed = new RegExp(`^[ \\t>*-]*\`?Session\`?(?:\\*\\*)?[ \\t]*[:：][ \\t]*\`?(${SEAT_SESSION_ID.source})`, 'mu').exec(text);
  if (keyed) return keyed[1];
  return readSignatureLine(text)?.session ?? SEAT_SESSION_ID.exec(text)?.[0] ?? null;
}

/**
 * Readings 1 and 2 over the seat post's thread: the newest stand-down brief, and the newest comment after it signed
 * by this seat from a session outside `own` — an own comment newer than another session's marker must not hide it,
 * the same filter reading 3 takes. Pure.
 */
export function postReadings(rows, seatName, own = new Set()) {
  const list = Array.isArray(rows) ? rows : [];
  let brief = null;
  for (const row of list) if (standDownBrief(row?.body) && (brief === null || (stampOf(row) ?? 0) >= (stampOf(brief) ?? 0))) brief = row;
  const after = (row) => brief === null || (stampOf(row) ?? 0) > (stampOf(brief) ?? 0);
  let marker = null;
  for (const row of list) {
    if (row === brief || !after(row)) continue;
    const sig = readSignatureLine(String(row?.body ?? ''));
    if (!sig || `${sig.lane}#${sig.seat}`.toLowerCase() !== seatName || own.has(sig.session)) continue;
    if (marker === null || (stampOf(row) ?? 0) >= (stampOf(marker) ?? 0)) marker = row;
  }
  return { brief, marker };
}

/** The intake keys `--intake` names, or the usage error. Pure. */
export function parseIntake(text) {
  const keys = [];
  for (const raw of String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const epic = /^epic:#?([1-9][0-9]*)$/u.exec(raw);
    if (epic) keys.push(`epic:#${epic[1]}`);
    else if (/^area:[a-z0-9][a-z0-9-]*$/u.test(raw)) keys.push(raw);
    else return { ok: false, error: `--intake item \`${raw}\` is neither area:NAME nor epic:#N` };
  }
  return keys.length > 0 ? { ok: true, keys } : { ok: false, error: '--intake names no key' };
}

/** The lane card a `claude/issue-N…` head belongs to, or null. Pure. */
export function headCard(ref) {
  const m = /^refs\/heads\/claude\/issue-([1-9][0-9]*)(?:-|$)/u.exec(String(ref ?? ''));
  return m ? Number(m[1]) : null;
}

/** The `Claude-Session:` trailer's session in a commit message, or null. Pure. */
export function commitSession(message) {
  const m = new RegExp(`^Claude-Session:[ \\t]*\\S*?(${SEAT_SESSION_ID.source})`, 'mu').exec(String(message ?? ''));
  return m ? m[1] : null;
}

/** The newest claim on a thread, and the newest claim of `seatName` by a session outside `own`. Pure. */
export function claimReadings(rows, seatName, own) {
  const list = Array.isArray(rows) ? rows : [];
  let newest = null;
  let foreign = null;
  for (const row of list) {
    if (!markerMatches(CLAIM_COMMENT_MARKER, String(row?.body ?? ''))) continue;
    if (newest === null || (stampOf(row) ?? 0) >= (stampOf(newest) ?? 0)) newest = row;
    if (claimSeat(row.body) !== seatName || own.has(commentSession(row.body))) continue;
    if (foreign === null || (stampOf(row) ?? 0) >= (stampOf(foreign) ?? 0)) foreign = row;
  }
  return { newest, foreign };
}

/**
 * The verdict over the readings: every activity newer than the brief is un-clocked-out; one whose session is not
 * own (or unread) and whose time lies inside the round is the self-exit. Pure.
 * @param {{ activities: { reading: string, at: number|null, session: string|null, where: string }[], own: Set<string>,
 *           briefAt: number|null, nowMs: number, roundMinutes: number, gaps: string[] }} input
 */
export function mutexVerdict({ activities = [], own = new Set(), briefAt = null, nowMs, roundMinutes = ROUND_MINUTES, gaps = [] }) {
  const since = nowMs - roundMinutes * 60_000;
  const judged = activities.map((a) => {
    const clocked = briefAt !== null && a.at !== null && a.at <= briefAt;
    const recent = a.at === null || a.at >= since;
    const mine = a.session !== null && own.has(a.session);
    return { ...a, clocked, recent, mine, yields: !clocked && recent && !mine };
  });
  const yields = judged.filter((a) => a.yields);
  const exit = yields.length > 0 ? EXIT_YIELD : gaps.length > 0 ? EXIT_INCOMPLETE : EXIT_CLEAR;
  return { exit, judged, yields, since };
}

// ---------------------------------------------------------------------------
// The reads — every request through an injected `get` (and `lsRemote`), so the self-test drives them offline
// ---------------------------------------------------------------------------

/** One `git ls-remote --heads` of the board's repository. `{ ok, value: [{ ref, sha }] }` or `{ ok: false, error }`. */
export function gitLsRemote(repo) {
  const r = spawnSync('git', ['ls-remote', '--heads', `https://github.com/${repo}.git`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.error?.message || `git exited ${r.status}`).trim() };
  const value = r.stdout.split('\n').filter(Boolean).map((line) => {
    const [sha, ref] = line.split('\t');
    return { sha, ref };
  });
  return { ok: true, value };
}

const iso = (ms) => new Date(ms).toISOString();

/** Every reading, from the seat post on. Returns the readings, the activities and the gaps; never throws. */
export function readMutex({ repo, seat, session, own: ownList = [], post = null, intake = null, roundMinutes = ROUND_MINUTES, nowMs, get = ghApi, lsRemote = gitLsRemote }) {
  const own = new Set([session, ...ownList]);
  const gaps = [];
  const reads = { threads: 0, commits: 0 };
  // 0. the seat post.
  let postRow = null;
  if (post !== null) {
    const r = get(`/repos/${repo}/issues/${post}`);
    if (!r.ok) return { prerequisite: `the seat post #${post} could not be read (${r.error})` };
    if (!labelNames(r.value).includes('pm:seat')) return { prerequisite: `#${post} carries no \`pm:seat\` label — it is no seat post` };
    postRow = r.value;
  } else {
    const r = readAllPages(`/repos/${repo}/issues?state=open&labels=pm:seat`, { get });
    if (!r.ok) return { prerequisite: `the \`pm:seat\` listing could not be read (${r.error})` };
    const hits = r.value.filter((i) => !i.pull_request && seatOfPostTitle(i.title) === seat.name);
    if (hits.length !== 1) return { prerequisite: hits.length === 0 ? `no open \`pm:seat\` post titles ${seat.name}; pass --post N` : `${hits.length} open \`pm:seat\` posts title ${seat.name} (${hits.map((h) => `#${h.number}`).join(', ')}); pass --post N` };
    postRow = hits[0];
  }
  if (seatOfPostTitle(postRow.title) !== seat.name) gaps.push(`the post #${postRow.number}'s title names ${seatOfPostTitle(postRow.title) ?? 'no seat'}, not ${seat.name}`);
  const thread = readAllPages(`/repos/${repo}/issues/${postRow.number}/comments`, { get });
  if (!thread.ok) return { prerequisite: `the seat post #${postRow.number}'s thread could not be read (${thread.error})` };
  const { brief, marker } = postReadings(thread.value, seat.name, own);
  const briefAt = brief ? stampOf(brief) : null;
  const since = Math.max(nowMs - roundMinutes * 60_000, briefAt ?? -Infinity);
  const activities = [];
  if (marker) activities.push({ reading: '2', at: stampOf(marker), session: readSignatureLine(marker.body)?.session ?? null, where: `seat post #${postRow.number} comment ${marker.id}`, what: (h44IsRoundOpenMarker(marker.body) ? 'round-open marker: ' : '') + h65Headline(marker.body).trim().slice(0, 90) });

  // 3 and 4 read EVERY open `pm:dispatched` ∪ `pm:queue` card and every closed card updated inside the window: a seat's
  // claim lawfully sits off its intake (card-pick's p0/p1 legs take a card from any area). The intake keys bound only
  // the push leg's UNCLAIMED cards, where no claim says whose seat a push is.
  const keys = intake ?? seatIntakeKeys(postRow, repo);
  const onIntake = (issue) => cardIntakeKeys(issue, repo).some((k) => keys.includes(k));
  const readings = { post: postRow.number, brief, marker, keys, claim: null, push: null, closed: null };
  if (keys.length === 0) gaps.push(`the post #${postRow.number}'s title names no \`area:*\` or \`epic #N\` intake, so the push leg read no unclaimed lane card; pass --intake`);
  const threadOf = new Map();
  const readThread = (n) => {
    if (threadOf.has(n)) return threadOf.get(n);
    const r = readAllPages(`/repos/${repo}/issues/${n}/comments`, { get });
    reads.threads += 1;
    const rows = r.ok ? r.value : null;
    if (!r.ok) gaps.push(`the thread of #${n} could not be read (${r.error})`);
    threadOf.set(n, rows);
    return rows;
  };
  // 3. the open cards: a claim of this seat by another session, wherever the card sits.
  const open = [];
  for (const label of LANE_LABELS) {
    const r = readAllPages(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}`, { get });
    if (!r.ok) {
      gaps.push(`the open \`${label}\` listing could not be read (${r.error})`);
      continue;
    }
    for (const i of r.value) if (!i.pull_request && !open.some((x) => x.number === i.number)) open.push(i);
  }
  const seatCards = new Set();
  for (const issue of open) {
    if ((Date.parse(issue.updated_at ?? '') || Infinity) < since) continue;
    const rows = readThread(issue.number);
    if (!rows) continue;
    const { newest, foreign } = claimReadings(rows, seat.name, own);
    if (newest && claimSeat(newest.body) === seat.name) seatCards.add(issue.number);
    if (foreign && (stampOf(foreign) ?? Infinity) >= since) {
      activities.push({ reading: '3', at: stampOf(foreign), session: commentSession(foreign.body), where: `#${issue.number} comment ${foreign.id}${onIntake(issue) ? '' : ' (off the intake)'}`, what: 'a claim of this seat' });
      if (readings.claim === null || (stampOf(foreign) ?? 0) > (stampOf(readings.claim.row) ?? 0)) readings.claim = { number: issue.number, row: foreign };
    }
  }
  // 3, the push half: one ls-remote, intersected locally with the intake's cards and the cards this seat claims.
  const heads = lsRemote(repo);
  if (!heads.ok) gaps.push(`\`git ls-remote --heads\` could not be read (${heads.error}), so no push was checked`);
  else {
    const pushCards = new Set([...open.filter(onIntake).map((i) => i.number), ...seatCards]);
    for (const h of heads.value) {
      const n = headCard(h.ref);
      if (n === null || !pushCards.has(n)) continue;
      const c = get(`/repos/${repo}/commits/${h.sha}`);
      reads.commits += 1;
      if (!c.ok) {
        gaps.push(`the head ${String(h.sha).slice(0, 10)} of \`${h.ref.replace('refs/heads/', '')}\` could not be read (${c.error})`);
        continue;
      }
      const at = Date.parse(c.value?.commit?.committer?.date ?? '');
      if (!Number.isFinite(at) || at < since) continue;
      const rows = readThread(n);
      if (!rows) continue;
      const { newest } = claimReadings(rows, seat.name, own);
      const holder = newest ? claimSeat(newest.body) : null;
      if (newest && holder !== seat.name) continue;
      const pushSession = commitSession(c.value?.commit?.message);
      activities.push({ reading: '3 push', at, session: pushSession, where: `\`${h.ref.replace('refs/heads/', '')}\` @ ${String(h.sha).slice(0, 10)} (#${n})`, what: newest ? 'a push on a card this seat claims' : 'a push on an unclaimed lane card (推即认领, its `Claim:` owed)' });
      if (readings.push === null || at > readings.push.at) readings.push = { number: n, at, session: pushSession };
    }
  }
  // 4. every closed card inside the window, newest-updated first.
  const closed = readAllPages(`/repos/${repo}/issues?state=closed&sort=updated&direction=desc&since=${encodeURIComponent(iso(since))}`, { get });
  if (!closed.ok) gaps.push(`the closed listing since ${iso(since)} could not be read (${closed.error})`);
  else {
    const cards = closed.value.filter((i) => !i.pull_request).sort((a, b) => Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? ''));
    for (const issue of cards) {
      const rows = readThread(issue.number);
      if (!rows) continue;
      const seatClaims = rows.filter((r) => markerMatches(CLAIM_COMMENT_MARKER, String(r?.body ?? '')) && claimSeat(r.body) === seat.name);
      if (seatClaims.length === 0) continue;
      const claim = seatClaims.reduce((best, r) => ((stampOf(r) ?? 0) >= (stampOf(best) ?? 0) ? r : best));
      const who = commentSession(claim.body);
      const traces = rows.filter((r) => who !== null && String(r?.body ?? '').includes(who));
      const last = traces.reduce((best, r) => (best === null || (stampOf(r) ?? 0) >= (stampOf(best) ?? 0) ? r : best), null) ?? claim;
      readings.closed = { number: issue.number, session: who, at: stampOf(last) };
      activities.push({ reading: '4', at: stampOf(last), session: who, where: `closed #${issue.number} comment ${last.id}`, what: "this seat's claim on the newest-updated closed card, timed by its session's newest comment there" });
      break;
    }
  }
  return { readings, activities, gaps, briefAt, own, reads };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const at = (ms) => (ms === null || ms === undefined ? 'no time read' : iso(ms).replace(/:\d\d\.\d{3}Z$/u, 'Z'));

export function renderText(r, v, { seat, repo, roundMinutes }) {
  const L = [];
  const head =
    v.exit === EXIT_YIELD
      ? `round-open: YIELD (自退) — ${v.yields.length} activity(ies) of ${seat.name} by another session, under one round old and no brief after it.`
      : v.exit === EXIT_INCOMPLETE
        ? `round-open: INCOMPLETE — ${r.gaps.length} reading(s) could not be taken; ⛔ not a clear mutex.`
        : `round-open: CLEAR — no activity of ${seat.name} by another session under one round old outlived the newest brief; seat and leave the round-open marker.`;
  L.push(head, `  Board ${repo} · seat post #${r.readings.post} · one round = ${roundMinutes} min · window from ${at(v.since)}.`);
  L.push(`  1. newest stand-down brief: ${r.readings.brief ? `comment ${r.readings.brief.id} · ${at(stampOf(r.readings.brief))} · ${readSignatureLine(r.readings.brief.body)?.session ?? 'unsigned'}` : 'none on the post'}`);
  L.push(`  2. newest seat-signed comment after it by another session: ${r.readings.marker ? `comment ${r.readings.marker.id} · ${at(stampOf(r.readings.marker))} · ${readSignatureLine(r.readings.marker.body)?.session}` : 'none'}`);
  L.push(`  3. open cards (intake ${r.readings.keys.length > 0 ? r.readings.keys.join(', ') : 'none'} for unclaimed pushes): newest claim of this seat by another session ${r.readings.claim ? `#${r.readings.claim.number} comment ${r.readings.claim.row.id} · ${at(stampOf(r.readings.claim.row))}` : 'none inside the window'}; push ${r.readings.push ? `#${r.readings.push.number} · ${at(r.readings.push.at)} · ${r.readings.push.session ?? 'no Claude-Session trailer'}` : 'none inside the window'}`);
  L.push(`  4. first closed card with this seat's claim: ${r.readings.closed ? `#${r.readings.closed.number} · ${r.readings.closed.session ?? 'no session read'} · last trace ${at(r.readings.closed.at)}` : 'none inside the window'}`);
  for (const a of v.yields) L.push(`  ⛔ reading ${a.reading} · ${a.where} · ${at(a.at)} · ${a.session ?? 'session unread'} — ${a.what}`);
  if (v.exit === EXIT_YIELD) L.push("  Exit before any write: another session sits this seat. Re-run next fire; a brief it writes releases the seat at once. A session the seat knows as its own — a lease-table area session, its PM session seen from an area, a dev's remote session — is cleared with --own, never by ignoring this line; a push with no Claude-Session trailer reads foreign the same way.");
  for (const g of r.gaps) L.push(`  gap: ${g}`);
  L.push(`  Own sessions: ${[...r.own].join(', ')}. Reads: ${r.reads.threads} card thread(s), ${r.reads.commits} head commit(s).`);
  L.push('  Not read here (the seat reads these itself):');
  for (const leg of UNREAD_LEGS) L.push(`  · ${leg}`);
  return L.join('\n');
}

export function renderJson(r, v, { seat, repo, roundMinutes }) {
  return {
    verdict: v.exit === EXIT_YIELD ? 'yield' : v.exit === EXIT_INCOMPLETE ? 'incomplete' : 'clear',
    seat: seat.name,
    repo,
    post: r.readings.post,
    round_minutes: roundMinutes,
    window_from: iso(v.since),
    brief: r.readings.brief ? { id: r.readings.brief.id, at: r.readings.brief.created_at } : null,
    marker: r.readings.marker ? { id: r.readings.marker.id, at: r.readings.marker.created_at } : null,
    intake: r.readings.keys,
    activities: v.judged.map(({ reading, at: t, session, where, what, clocked, recent, mine, yields }) => ({ reading, at: t === null ? null : iso(t), session, where, what, clocked, recent, mine, yields })),
    gaps: r.gaps,
    unread_legs: UNREAD_LEGS,
  };
}

// ---------------------------------------------------------------------------
// Fixture `get` — the offline board
// ---------------------------------------------------------------------------

export function fixtureGet(fixture, repo) {
  const page = (rows, path) => {
    const p = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? 1);
    return rows.slice((p - 1) * 100, p * 100);
  };
  const issues = fixture.issues ?? [];
  return (path) => {
    const [bare, query = ''] = path.split('?');
    const q = new URLSearchParams(query);
    if (bare === `/repos/${repo}/issues`) {
      if (fixture.listingDown?.includes(q.get('labels') ?? q.get('state'))) return { ok: false, error: 'HTTP 502' };
      const labels = q.get('labels');
      const rows = issues.filter((i) => (q.get('state') === 'closed' ? i.state === 'closed' : i.state !== 'closed') && (!labels || labelNames(i).includes(labels)) && (!q.get('since') || Date.parse(i.updated_at) >= Date.parse(q.get('since'))));
      return { ok: true, value: page(rows, path) };
    }
    let m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(bare);
    if (m) return fixture.comments?.[m[1]] === null ? { ok: false, error: 'HTTP 502' } : { ok: true, value: page(fixture.comments?.[m[1]] ?? [], path) };
    m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(bare);
    if (m) {
      const row = issues.find((i) => i.number === Number(m[1]));
      return row ? { ok: true, value: row } : { ok: false, error: 'HTTP 404 Not Found' };
    }
    m = /^\/repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]+)$/.exec(bare);
    if (m) return fixture.commits?.[m[1]] ? { ok: true, value: fixture.commits[m[1]] } : { ok: false, error: 'HTTP 404 Not Found' };
    return { ok: false, error: `HTTP 404 Not Found (${bare})` };
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
  'round-open — the round-open mutex at fire start, before the first write (read-only).',
  '',
  '  node scripts/pm/round-open.mjs --seat LANE#N --session SESSION [--own SESSION,…] [--post N]',
  '                                 [--intake area:NAME,epic:#N] [--round-minutes N] [--repo OWNER/NAME]',
  '                                 [--json] [--fixture FILE] [--now ISO]',
  '  node scripts/pm/round-open.mjs --self-test',
  '',
  '  --seat    this executing seat (repo:NAME#N, epic:#N#k); the director and the review chains hold no round mutex.',
  '  --own     sessions that are this seat\'s own — the lease table\'s area sessions, the PM session (from an area), a card thread\'s or a remote dev\'s session.',
  '  --post    the seat post, when its title does not name the seat as `LANE · seat N`.',
  '  --intake  the lane, when the post title names no `area:*` / `epic #N`.',
  `  Exits: ${EXIT_CLEAR} CLEAR · ${EXIT_USAGE} usage · ${EXIT_PREREQUISITE} prerequisite (no seat post read) · ${EXIT_INCOMPLETE} INCOMPLETE (a gap, named) · ${EXIT_YIELD} YIELD (自退).`,
].join('\n');

const SESSION_ONLY = new RegExp(`^${SEAT_SESSION_ID.source}$`, 'u');

export function parseArgs(argv) {
  const opts = { repo: DEFAULT_SWEEP_REPO, seat: null, session: null, own: [], post: null, intake: null, roundMinutes: ROUND_MINUTES, json: false, fixture: null, nowMs: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = /^(--[a-z-]+)=(.*)$/.exec(a);
    const flag = eq ? eq[1] : a;
    const take = () => (eq ? eq[2] : argv[++i]);
    if (flag === '--json' && !eq) opts.json = true;
    else if ((flag === '--help' || flag === '-h') && !eq) opts.help = true;
    else if (flag === '--repo') {
      opts.repo = String(take() ?? '');
      if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) return { error: `--repo must be OWNER/NAME, got \`${opts.repo}\`` };
    } else if (flag === '--seat') {
      const v = take();
      opts.seat = parseSeat(v);
      if (!opts.seat) return { error: `--seat must be an executing seat, repo:NAME#N or epic:#N#k (the director and the review chains hold no round mutex), got \`${v}\`` };
    } else if (flag === '--session') {
      const v = String(take() ?? '');
      if (!SESSION_ONLY.test(v)) return { error: `--session must be ONE session id, got \`${v}\`` };
      opts.session = v;
    } else if (flag === '--own') {
      const parts = String(take() ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const bad = parts.find((p) => !SESSION_ONLY.test(p));
      if (parts.length === 0 || bad !== undefined) return { error: `--own takes session ids, comma-separated${bad ? `; \`${bad}\` is not one` : ''}` };
      opts.own.push(...parts);
    } else if (flag === '--post') {
      const v = String(take() ?? '').replace(/^#/, '');
      if (!/^[1-9][0-9]*$/.test(v)) return { error: `--post must be the seat post's number, got \`${v}\`` };
      opts.post = Number(v);
    } else if (flag === '--intake') {
      const parsed = parseIntake(take());
      if (!parsed.ok) return { error: parsed.error };
      opts.intake = parsed.keys;
    } else if (flag === '--round-minutes') {
      const v = take();
      if (!/^[1-9][0-9]*$/.test(String(v ?? ''))) return { error: `--round-minutes must be a positive integer, got \`${v}\`` };
      opts.roundMinutes = Number(v);
    } else if (flag === '--fixture') {
      opts.fixture = take();
      if (!opts.fixture) return { error: '--fixture needs a file' };
    } else if (flag === '--now') {
      const v = take();
      opts.nowMs = Date.parse(String(v ?? ''));
      if (!Number.isFinite(opts.nowMs)) return { error: `--now must be an ISO time, got \`${v}\`` };
    } else return { error: `\`${a}\` is not an argument this tool takes` };
  }
  if (!opts.help && (opts.seat === null || opts.session === null)) return { error: '--seat and --session are both required: whose seat, and which session is asking' };
  return { opts };
}

export function main(argv, deps = {}) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`round-open: ${parsed.error}`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const o = parsed.opts;
  if (o.help) {
    console.log(USAGE);
    return EXIT_CLEAR;
  }
  let get = deps.get ?? ghApi;
  let lsRemote = deps.lsRemote ?? gitLsRemote;
  let nowMs = o.nowMs ?? deps.nowMs ?? Date.now();
  if (o.fixture) {
    let fixture;
    try {
      fixture = JSON.parse(readFileSync(o.fixture, 'utf8'));
    } catch (e) {
      console.error(`round-open: --fixture \`${o.fixture}\` could not be read as JSON (${e.message})`);
      return EXIT_USAGE;
    }
    get = fixtureGet(fixture, o.repo);
    lsRemote = () => ({ ok: true, value: fixture.heads ?? [] });
    if (o.nowMs === null && fixture.now) nowMs = Date.parse(fixture.now);
  }
  const r = readMutex({ repo: o.repo, seat: o.seat, session: o.session, own: o.own, post: o.post, intake: o.intake, roundMinutes: o.roundMinutes, nowMs, get, lsRemote });
  if (r.prerequisite) {
    console.error(`round-open: PREREQUISITE NOT MET — ${r.prerequisite}. ⛔ No verdict: the mutex was not judged.`);
    return EXIT_PREREQUISITE;
  }
  const v = mutexVerdict({ activities: r.activities, own: r.own, briefAt: r.briefAt, nowMs, roundMinutes: o.roundMinutes, gaps: r.gaps });
  const ctx = { seat: o.seat, repo: o.repo, roundMinutes: o.roundMinutes };
  console.log(o.json ? JSON.stringify(renderJson(r, v, ctx), null, 2) : renderText(r, v, ctx));
  return v.exit;
}

// ---------------------------------------------------------------------------
// Self-test — floor (battery names pinned) + handshake, copied from the landed shape
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the rule text: every phrase this file is built from is in the file that writes it': 2,
  'readings 1 and 2: the newest stand-down brief, the newest seat-signed comment after it': 7,
  'reading 3: the newest claim of this seat by another session, and a push on a lane branch': 9,
  'reading 4: the first closed lane card with a claim of this seat, timed by its session': 4,
  'the verdict: foreign, un-clocked-out and under a round yields; own, clocked-out or older does not; a gap is never clear': 7,
  'the CLI: usage, exits and the footer': 7,
});
const SELF_TEST_BATTERY_FLOOR = 6;
const UNATTRIBUTED_BATTERY = '(unattributed)';
const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

const quiet = (fn) => (...args) => {
  const log = console.log;
  const err = console.error;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    return { code: fn(...args), out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
};

export function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true) => {
    const key = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(key, (batteryCases.get(key) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };
  const REPO = 'objectstack-ai/objectstack';
  const NOW = Date.parse('2026-11-27T08:00:00Z');
  const ME = 'session_01ASNY8UcT2uJmgTyCPnMiMZ';
  const OTHER = 'session_01L9qibyUSf2nKJWW6qBemSU';
  const AREA = 'session_01AreaSessionXXXXXXXXXXX';
  const SEAT = parseSeat('repo:objectstack#8');
  const sig = (session, seat = 'repo:objectstack#8', account = 'os-mickey') => `${seat} · ${account} · ${session}`;
  const ago = (min) => new Date(NOW - min * 60_000).toISOString();
  let id = 9000;
  const c = (body, min) => ({ id: ++id, created_at: ago(min), updated_at: ago(min), body });
  const POST = { number: 37865, title: '[PM seat] repo:objectstack · seat 8 — 🟢 os-mickey · area:fleet (p1/p2)', labels: [{ name: 'pm:seat' }], state: 'open', updated_at: ago(1) };
  const claim = (session, min, seat = 'repo:objectstack#8') => c(`${sig(session, seat)}\n\nClaim: PM loop round 1\nSession: \`${session}\`\nSeat: \`${seat}\`\nFile surface: \`scripts/pm/x.mjs\``, min);
  let n = 37000;
  const card = (labels, min, extra = {}) => ({ number: ++n, title: `card ${n}`, state: 'open', labels: labels.map((name) => ({ name })), updated_at: ago(min), ...extra });
  const run = (fx, opts = {}) => {
    const r = readMutex({ repo: REPO, seat: SEAT, session: ME, own: opts.own ?? [], post: opts.post ?? null, intake: opts.intake ?? null, nowMs: NOW, get: fixtureGet(fx, REPO), lsRemote: () => (fx.headsDown ? { ok: false, error: 'exit 128' } : { ok: true, value: fx.heads ?? [] }) });
    return r.prerequisite ? r : { ...r, v: mutexVerdict({ activities: r.activities, own: r.own, briefAt: r.briefAt, nowMs: NOW, gaps: r.gaps }) };
  };

  battery('the rule text: every phrase this file is built from is in the file that writes it');
  {
    const read = (p) => {
      try {
        return readFileSync(new URL(p, REPO_ROOT), 'utf8');
      } catch {
        return '';
      }
    };
    const lifecycle = read(LIFECYCLE_PATH);
    t('every reading this file takes is a phrase of seat-lifecycle.md 〈开轮互斥〉, the pointer included', LIFECYCLE_PHRASES.filter((p) => !lifecycle.includes(p)), []);
    t("one round's length is contract-review.md's own phrase, and ROUND_MINUTES is its number", [read(CONTRACT_REVIEW_PATH).includes(ROUND_PHRASE), ROUND_PHRASE.includes(String(ROUND_MINUTES))], [true, true]);
  }

  battery('readings 1 and 2: the newest stand-down brief, the newest seat-signed comment after it');
  {
    const measured = ['## Clock-out · 2026-11-19 00:45Z', 'Clock-out: 2026-11-24T02:53Z · seat 2 is vacant.', '## Clock-out brief (repo:objectstack#2, area:fleet)', 'Clock-out brief · seat 7 · 2026-11-23T04:05Z', '## 收班简报 · seat repo:objectstack#4 · 2026-11-26T06:43Z', '**收班简报 2026-11-08**(维护者 16:40Z)', '# 🔻 收班简报 · 分诊席', 'Stand-down brief · `repo:cloud#2` R3', 'Shift end · 2026-11-15T14:17Z · seat `repo:cloud#4` is vacant'];
    t('⭐ every measured stand-down spelling reads as a brief, a signature line above it or not', measured.filter((h) => !standDownBrief(`${sig(OTHER)}\n\n${h}\n\nbody`) || !standDownBrief(h)), []);
    t('⛔ a comment that MENTIONS a clock-out, a seating, a W0 or a downgrade is no brief', ['Premise corrected (to clock-out 6996037060): the port has landed.', '## Seated · 2026-11-22T22:51Z', 'W0 · area o1-A', 'Seat downgrade · seat 3 → `⏳ vacant`', 'clockout notes'].filter((h) => standDownBrief(`${sig(OTHER)}\n\n${h}`)), []);
    const BRIEF = c(`${sig(OTHER)}\n\n## Clock-out · seat 8`, 150);
    const MARK = c(`${sig(OTHER)}\n\n## Seated · seat 8`, 200);
    const pr = postReadings([c(`${sig(OTHER)}\n\n## Clock-out · old`, 900), MARK, BRIEF, c(`${sig(ME, 'repo:objectstack#3')}\n\nZone opened`, 100), c('maintainer · os-bob · session_012dn2AecKpLaYkUtNRiqtby\n\nNotice', 50)], 'repo:objectstack#8');
    t('reading 1 is the NEWEST brief; reading 2 is the newest comment after it signed by THIS seat — another seat\'s and an unsigned notice are not', [pr.brief?.id, pr.marker?.id], [BRIEF.id, null]);
    const pr2 = postReadings([BRIEF, MARK], 'repo:objectstack#8');
    t('a seat-signed comment OLDER than the brief is no reading 2', pr2.marker, null);
    const late = c(`${sig(OTHER)}\n\n## Seated · seat 8 again`, 40);
    t('⭐ a seat-signed comment after the brief is reading 2, whatever its headline', postReadings([BRIEF, late], 'repo:objectstack#8').marker?.id, late.id);
    t('N1 — an OWN comment newer than another session\'s marker does not hide it: reading 2 is the newest by a session outside own', postReadings([BRIEF, late, c(`${sig(ME)}\n\nSeat audit`, 10)], 'repo:objectstack#8', new Set([ME])).marker?.id, late.id);
    t('the seat a post title names: `LANE · seat N`, `LANE#N`, bare LANE for seat 1', [seatOfPostTitle(POST.title), seatOfPostTitle('[PM seat] repo:cloud#1 — 🟢 os-warren'), seatOfPostTitle('[PM seat] review — ⏳ vacant'), seatOfPostTitle('not a post')], ['repo:objectstack#8', 'repo:cloud#1', 'review#1', null]);
  }

  battery('reading 3: the newest claim of this seat by another session, and a push on a lane branch');
  {
    t('a claim\'s seat is its `Seat:` line, else its signature; its session the `Session:` line, else the signature', [claimSeat(claim(OTHER, 5).body), claimSeat(`${sig(OTHER, 'epic:#35205#1')}\n\nClaim: x`), claimSeat('Claim: x'), commentSession(`${sig(OTHER)}\n\nClaim: x`)], ['repo:objectstack#8', 'epic:#35205#1', null, OTHER]);
    const own = new Set([ME]);
    const cr = claimReadings([claim(OTHER, 30), claim(ME, 10), claim(OTHER, 5, 'repo:objectstack#3')], 'repo:objectstack#8', own);
    t('⭐ the newest claim of THIS seat by ANOTHER session — the own session\'s and another seat\'s are not it', cr.foreign?.created_at, ago(30));
    const live = card(['pm:dispatched', 'area:fleet'], 20);
    const off = card(['pm:dispatched', 'area:ui'], 20);
    const fx = { issues: [POST, live, off], comments: { 37865: [], [live.number]: [claim(OTHER, 20)], [off.number]: [claim(OTHER, 15)] } };
    const r = run(fx);
    t('⭐ a foreign claim of this seat inside the round is a reading-3 activity, on the intake and OFF it (S1: a p0/p1 card is taken from any area), the off-intake one marked so', [r.activities.map((a) => a.reading), r.readings.claim?.number, r.reads.threads, r.activities.filter((a) => a.where.endsWith('(off the intake)')).length], [['3', '3'], off.number, 2, 1]);
    const offOnly = run({ issues: [POST, card(['pm:dispatched', 'area:ux', 'priority:p1'], 12)], comments: { 37865: [], [n]: [claim(OTHER, 12)] } });
    t('⭐ THE REVIEW\'S S1 SHAPE — the seat\'s only foreign claim sits on a p1 card outside its intake: YIELD, never CLEAR', offOnly.v.exit, EXIT_YIELD);
    const stale = card(['pm:queue', 'area:fleet'], 600);
    const r2 = run({ issues: [POST, stale], comments: { 37865: [], [stale.number]: [claim(OTHER, 600)] } });
    t('a lane card not updated inside the window buys no thread read', [r2.reads.threads, r2.activities.length], [0, 0]);
    const pushed = card(['pm:queue', 'area:fleet'], 300);
    const fxp = { issues: [POST, pushed], comments: { 37865: [], [pushed.number]: [] }, heads: [{ ref: `refs/heads/claude/issue-${pushed.number}-slice`, sha: 'abc123' }, { ref: 'refs/heads/claude/issue-1-x', sha: 'def456' }, { ref: 'refs/heads/main', sha: 'fff' }], commits: { abc123: { commit: { committer: { date: ago(10) }, message: `fix\n\nClaude-Session: https://claude.ai/code/${OTHER}` } } } };
    const rp = run(fxp);
    t('⭐ 推即认领: a push on an unclaimed lane card\'s `claude/issue-N` branch inside the round is an activity, its session the commit trailer; one ls-remote, other heads matched to nothing', [rp.activities.map((a) => [a.reading, a.session]), rp.reads.commits], [[['3 push', OTHER]], 1]);
    const fxq = { ...fxp, comments: { 37865: [], [pushed.number]: [claim(OTHER, 400, 'repo:objectstack#3')] } };
    t('…but a push on a card ANOTHER seat claims is that seat\'s, never this one\'s', run(fxq).activities.length, 0);
    const offPushed = card(['pm:dispatched', 'area:ux'], 20);
    const fxo = { issues: [POST, offPushed], comments: { 37865: [], [offPushed.number]: [claim(ME, 20)] }, heads: [{ ref: `refs/heads/claude/issue-${offPushed.number}-x`, sha: 'abc999' }], commits: { abc999: { commit: { committer: { date: ago(5) }, message: `wip\n\nClaude-Session: https://claude.ai/code/${OTHER}` } } } };
    t('a push on an OFF-intake card this seat claims is read too — an unclaimed off-intake card\'s head is not (no claim says whose seat it is)', [run(fxo).activities.map((a) => [a.reading, a.session]), run({ ...fxo, comments: { 37865: [], [offPushed.number]: [] } }).reads.commits], [[['3 push', OTHER]], 0]);
    t('a head no card on the intake owns, and `headCard` itself: `claude/issue-N` and `claude/issue-N-…` only', [headCard('refs/heads/claude/issue-35237-slice4'), headCard('refs/heads/claude/issue-35237'), headCard('refs/heads/claude/issue-35237x'), headCard('refs/heads/claude/project-thread-x')], [35237, 35237, null, null]);
  }

  battery('reading 4: the first closed lane card with a claim of this seat, timed by its session');
  {
    const shut = card(['area:fleet'], 15, { state: 'closed' });
    const older = card(['area:fleet'], 40, { state: 'closed' });
    const fx = { issues: [POST, shut, older], comments: { 37865: [], [shut.number]: [claim(OTHER, 400), c(`${sig(OTHER)}\n\nos-dev-report`, 20), c('merged by the queue', 15)], [older.number]: [claim(ME, 45)] } };
    const r = run(fx);
    t('⭐ the newest-updated closed intake card with this seat\'s claim gives its session, timed by that session\'s newest comment (not the merge)', [r.readings.closed?.number, r.readings.closed?.session, r.readings.closed?.at === Date.parse(ago(20))], [shut.number, OTHER, true]);
    t('the walk stops at the first such card', r.activities.filter((a) => a.reading === '4').length, 1);
    const offShut = card(['area:ux'], 10, { state: 'closed' });
    t('⭐ S1 — a closed card OFF the intake with this seat\'s claim is reading 4 too', run({ issues: [POST, offShut], comments: { 37865: [], [offShut.number]: [claim(OTHER, 30)] } }).readings.closed?.number, offShut.number);
    const none = run({ issues: [POST, card(['area:fleet'], 15, { state: 'closed' })], comments: { 37865: [] } });
    t('a closed card with no claim of this seat gives no reading 4', none.readings.closed, null);
  }

  battery('the verdict: foreign, un-clocked-out and under a round yields; own, clocked-out or older does not; a gap is never clear');
  {
    const A = (min, session, reading = '3') => ({ reading, at: NOW - min * 60_000, session, where: 'x', what: 'y' });
    const own = new Set([ME, AREA]);
    t('⭐ a foreign activity under one round old, no brief after it: YIELD (5)', mutexVerdict({ activities: [A(20, OTHER)], own, nowMs: NOW }).exit, EXIT_YIELD);
    t('⭐ 简报即最新事件 ⇒ 立即坐席: the same activity before a newer brief is clocked out — CLEAR', mutexVerdict({ activities: [A(20, OTHER)], own, briefAt: NOW - 10 * 60_000, nowMs: NOW }).exit, EXIT_CLEAR);
    t('a foreign activity older than one round does not yield', mutexVerdict({ activities: [A(61, OTHER)], own, nowMs: NOW }).exit, EXIT_CLEAR);
    t('⭐ the own session and an --own session (a lease-table area session) never yield', mutexVerdict({ activities: [A(5, ME), A(5, AREA, '2')], own, nowMs: NOW }).exit, EXIT_CLEAR);
    t('⛔ an activity whose session could not be read is FOREIGN — the conservative side of a mutex', mutexVerdict({ activities: [A(5, null, '3 push')], own, nowMs: NOW }).exit, EXIT_YIELD);
    t('⛔ a gap with nothing foreign is INCOMPLETE (4), never clear; a yield is printed over a gap', [mutexVerdict({ activities: [], own, nowMs: NOW, gaps: ['x'] }).exit, mutexVerdict({ activities: [A(5, OTHER)], own, nowMs: NOW, gaps: ['x'] }).exit], [EXIT_INCOMPLETE, EXIT_YIELD]);
    const dark = card(['pm:dispatched', 'area:fleet'], 10);
    const r = run({ issues: [POST, dark], comments: { 37865: [], [dark.number]: null }, headsDown: true, listingDown: ['closed'] });
    t('every unreadable reading is a named gap: a thread, ls-remote, the closed listing', [r.gaps.some((g) => g.includes(`thread of #${dark.number}`)), r.gaps.some((g) => g.includes('ls-remote')), r.gaps.some((g) => g.includes('closed listing')), r.v.exit], [true, true, true, EXIT_INCOMPLETE]);
  }

  battery('the CLI: usage, exits and the footer');
  {
    t('--seat and --session are required; the director and a review chain are refused by name', [Boolean(parseArgs([]).error), Boolean(parseArgs(['--seat', 'director#1', '--session', ME]).error), Boolean(parseArgs(['--seat', 'l2-review#1', '--session', ME]).error), parseArgs(['--seat', 'epic:#35205#1', '--session', ME]).opts?.seat.name], [true, true, true, 'epic:#35205#1']);
    t('a bad --session, --own, --post, --intake or flag is a usage error, never a default', ['--session=x', '--own=x', '--post=x', '--intake=ux', '--bogus'].map((a) => Boolean(parseArgs(['--seat=repo:objectstack#8', `--session=${ME}`, a]).error)), [true, true, true, true, true]);
    const busy = card(['pm:dispatched', 'area:fleet'], 10);
    const fx = { issues: [POST, busy], comments: { 37865: [c(`${sig(OTHER)}\n\n## Clock-out · seat 8`, 120)], [busy.number]: [claim(OTHER, 10)] } };
    const yieldRun = quiet(main)(['--seat', 'repo:objectstack#8', '--session', ME], { get: fixtureGet(fx, REPO), lsRemote: () => ({ ok: true, value: [] }), nowMs: NOW });
    t('⭐ a live-shaped yield exits 5 and names the reading, the card and the session', [yieldRun.code, yieldRun.out.includes('YIELD'), yieldRun.out.includes(`reading 3 · #${busy.number}`), yieldRun.out.includes(OTHER)], [EXIT_YIELD, true, true, true]);
    const ownRun = quiet(main)(['--seat', 'repo:objectstack#8', '--session', ME, '--own', OTHER], { get: fixtureGet(fx, REPO), lsRemote: () => ({ ok: true, value: [] }), nowMs: NOW });
    t('the same board with that session named --own is CLEAR (0)', [ownRun.code, ownRun.out.startsWith('round-open: CLEAR')], [EXIT_CLEAR, true]);
    t('⭐ every run names the legs it cannot read', UNREAD_LEGS.every((l) => ownRun.out.includes(l)), true);
    const noPost = quiet(main)(['--seat', 'repo:objectstack#9', '--session', ME], { get: fixtureGet(fx, REPO), lsRemote: () => ({ ok: true, value: [] }), nowMs: NOW });
    t('no post titling the seat is PREREQUISITE NOT MET (3), naming --post', [noPost.code, noPost.out.includes('pass --post N')], [EXIT_PREREQUISITE, true]);
    const noIntake = run({ issues: [{ ...POST, title: '[PM seat] repo:objectstack · seat 8 — 🟢 os-mickey' }], comments: { 37865: [] } });
    t('a post title naming no intake is a gap naming --intake; --intake supplies it', [noIntake.v.exit, noIntake.gaps[0]?.includes('--intake'), run({ issues: [{ ...POST, title: '[PM seat] repo:objectstack · seat 8 — 🟢' }], comments: { 37865: [] } }, { intake: ['area:fleet'] }).v.exit], [EXIT_INCOMPLETE, true, EXIT_CLEAR]);
  }

  const failed = cases.filter((x) => !x.ok);
  for (const f of failed) console.error(`  ✗ ${f.name} — ${f.detail}`);
  const floor = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) floor.push(`the battery ledger declares ${declared.length} batteries, below its floor of ${SELF_TEST_BATTERY_FLOOR}`);
  for (const [name, count] of batteryCases) if (!(name in SELF_TEST_BATTERIES)) floor.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES`);
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) floor.push(count === 0 ? `self-test battery "${name}" DID NOT RUN` : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}`);
  }
  for (const f of floor) console.error(`  ✗ floor: ${f}`);
  if (failed.length > 0 || floor.length > 0) {
    console.error(`✗ round-open self-test: ${failed.length} of ${cases.length} case(s) failed, ${floor.length} floor breach(es).`);
    selfTestReachedVerdict = true;
    return EXIT_SELF_TEST_FAILED;
  }
  console.log(`✓ round-open self-test: ${cases.length} cases pass across ${declared.length} batteries — offline, no network.`);
  selfTestReachedVerdict = true;
  return EXIT_CLEAR;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error('✗ round-open self-test: selfTest() returned without reaching its verdict — not a pass.');
      process.exit(1);
    }
    process.exit(code);
  }
  process.exit(main(process.argv.slice(2)));
}
