#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * pr-state — one state line per PR, read the way the landing and reporting rules ask for it.
 *
 *   node scripts/pm/pr-state.mjs --pr 35482
 *   node scripts/pm/pr-state.mjs --pr 35482,35532 --json
 *   node scripts/pm/pr-state.mjs --pr 35482 --fixture pr.json      # offline: the fixture answers every read
 *   node scripts/pm/pr-state.mjs --self-test                       # offline, no network at all
 *
 * ## Why this file exists
 *
 * `references/coordinator.md` (before any PR status goes to the maintainer) and `references/landing-operations.md`
 * (every look between open and MERGED) ask every seat, coordinator and director to re-read the same six facts, and
 * `references/readings-queue.md` says how each one lies: `mergeable_state` is computed lazily and `unknown` is not a
 * reading; queue membership is the timeline's `added_to_merge_queue` / `removed_from_merge_queue`, and the position
 * is the `gh-readonly-queue/*` parent-tip chain from the current main; `auto_merge` is unstable. This file is that
 * reading. ⛔ It writes nothing.
 *
 * ## What it reads — REST through `gh api`, every page, and one `git ls-remote`
 *
 *   1. the PR row; on an OPEN PR whose `mergeable_state` is `unknown`, re-read up to `--rereads` times (bounded);
 *   2. every review — the newest per reviewer: those on the head commit, and apart from them, with state and login,
 *      those on an older commit (an APPROVED on any commit counts, AGENTS.md Prime Directive 14);
 *   3. the timeline, every page — the last merge-queue event;
 *   4. the queue refs and the base branch's tip (`git ls-remote`, zero quota) — the position, only while a ref exists;
 *   5. the head's check-runs (`filter=latest`, every page, the platform's count checked), judged with
 *      `check-expected-skips.mjs`'s roster (this checkout's workflows), and the head's legacy commit status.
 *
 * ## What it does NOT read — named in the footer of every run
 *
 * `UNREAD_LEGS`: `auto_merge` is printed but is not a reading; a queue event can be absent for a short window after an
 * enqueue; whether the PR's content is on `main` (read it by content); and the required-set verdict of the enqueue bar
 * (the skip judgement here uses this checkout's roster, not the base branch's).
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0  every leg answered for every PR
 *   1  `--self-test` failed
 *   2  usage
 *   3  a PR row could not be read — nothing printed for it but the gap
 *   4  INCOMPLETE — a leg did not answer (named on the line), an open PR's `mergeable_state` was still `unknown`
 *      after the bounded re-reads, or a queue ref contradicts the timeline's last queue event; ⛔ never read as a
 *      clean line
 *
 * ## Self-test
 *
 * `--self-test` drives every leg and the CLI against fixtures, with the floor and the handshake AGENTS.md § "Writing a
 * `--self-test`" requires (copied, never imported), and pins the rule text it replaces.
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { DEFAULT_SWEEP_REPO } from './check-half-states.mjs';
import { expectedSkipRoster, judgeCheckRuns } from './check-expected-skips.mjs';
import { ghApi } from './gh-pages.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const EXIT_OK = 0;
export const EXIT_SELF_TEST_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_PR_UNREADABLE = 3;
export const EXIT_INCOMPLETE = 4;

export const DEFAULT_REREADS = 3;
export const REREAD_DELAY_MS = 3000;
export const QUEUE_EVENTS = Object.freeze(['added_to_merge_queue', 'removed_from_merge_queue']);
/** `gh-readonly-queue/<base>/pr-<PR>-<PARENT>`: `<PARENT>` is the previous entry's tip. */
export const QUEUE_REF = /^refs\/heads\/gh-readonly-queue\/[^/]+\/pr-(\d+)-([0-9a-f]{40})$/;

/** Where the rules live, and the phrases this file is built from — the self-test pins each one present. */
export const RULE_FILES = Object.freeze({
  '.claude/skills/pm-dispatch/references/coordinator.md': [
    '`pr-state.mjs`:merged/draft/auto_merge/在队/reviews/`mergeable_state`',
    '无 APPROVED 也可能已被 ready 入队 ⇒ ⛔ 单读 reviews',
  ],
  '.claude/skills/pm-dispatch/references/landing-operations.md': ['读检查与 `mergeable_state`,`unknown` 重读:`pr-state.mjs`'],
  '.claude/skills/pm-dispatch/references/readings-queue.md': [
    '判在不在队列的决断读数是 timeline 事件 `added_to_merge_queue` / `removed_from_merge_queue`',
    '`auto_merge` 字段不只是空,是不稳定',
    '`mergeable_state` 惰性计算,`unknown` 不是读数',
    '队列 ref 在场时还答位置:名形 `…/pr-<PR>-<PARENT>` 的 `<PARENT>` 是前一条目的 tip',
    '从根在当前 `origin/main` 的那条起走父-tip 链即真实排队序',
  ],
});

/** The legs this file cannot read, printed under every run. */
export const UNREAD_LEGS = Object.freeze([
  '`auto_merge` — printed as the API answered it; the field is unstable and is never a reading (never re-arm on it)',
  'an enqueue in its first minutes — the queue event has been measured absent for +75 s; a short-window absence is not a reading',
  "whether the PR's content is on `main` — read it by content, never by the head sha's ancestry",
  "the enqueue bar's required set — the skip judgement here uses this checkout's roster, not the base branch's (`check-expected-skips.mjs --pr N`)",
]);

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

/** The newest review per reviewer: the ones on `head`, and apart from them the ones on an older commit. */
export function reviewsAtHead(reviews, head) {
  const newest = new Map();
  for (const r of reviews ?? []) {
    if (!r?.user?.login || r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    const prev = newest.get(r.user.login);
    if (!prev || String(r.submitted_at) >= String(prev.submitted_at)) newest.set(r.user.login, r);
  }
  const at = [...newest.values()].filter((r) => r.commit_id === head);
  return {
    approved: at.filter((r) => r.state === 'APPROVED').map((r) => r.user.login).sort(),
    changes: at.filter((r) => r.state === 'CHANGES_REQUESTED').map((r) => r.user.login).sort(),
    dismissed: at.filter((r) => r.state === 'DISMISSED').map((r) => r.user.login).sort(),
    older: [...newest.values()]
      .filter((r) => r.commit_id !== head)
      .map((r) => ({ login: r.user.login, state: r.state, commit: r.commit_id ?? null }))
      .sort((a, b) => a.login.localeCompare(b.login)),
  };
}

/** The older-commit reviews as the line prints them: `APPROVED b@dddddddddd`. */
export function olderReviewsText(older) {
  return older.map((r) => `${r.state} ${r.login}@${String(r.commit).slice(0, 10)}`).join(', ');
}

/** The last merge-queue event on a timeline, or null. */
export function lastQueueEvent(timeline) {
  let last = null;
  for (const e of timeline ?? []) if (QUEUE_EVENTS.includes(e?.event)) last = e;
  return last ? { event: last.event, at: last.created_at ?? null, actor: last.actor?.login ?? null } : null;
}

/** The queue order from `ls-remote` rows `{sha, ref}`, walked from the base tip by parent. */
export function queueChain(rows, baseSha) {
  const entries = [];
  for (const r of rows ?? []) {
    const m = QUEUE_REF.exec(r.ref);
    if (m) entries.push({ pr: Number(m[1]), parent: m[2], tip: r.sha, ref: r.ref });
  }
  const byParent = new Map(entries.map((e) => [e.parent, e]));
  const chain = [];
  const seen = new Set();
  let cur = baseSha;
  while (byParent.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const e = byParent.get(cur);
    chain.push(e);
    cur = e.tip;
  }
  return { chain, entries, offChain: entries.filter((e) => !chain.includes(e)) };
}

/** The queue leg for one PR: `{ text, gap }`. */
export function queueLeg({ pr, event, refs, baseSha }) {
  if (pr.merged_at) return { text: 'queue: landed' };
  if (pr.state !== 'open') return { text: 'queue: n/a (closed unmerged)' };
  const q = refs ? queueChain(refs, baseSha) : null;
  const mine = q ? q.entries.find((e) => e.pr === pr.number) : null;
  const pos = mine && q.chain.includes(mine) ? `position ${q.chain.indexOf(mine) + 1} of ${q.chain.length}` : mine ? `a queue ref exists but is off the chain from ${String(baseSha).slice(0, 10)} (position unread)` : null;
  if (!event) return mine ? { text: `queue: no queue event on the timeline, yet a queue ref exists (${pos}) — re-read`, gap: 'a queue ref exists with no queue event on the timeline, so membership is unread' } : { text: 'queue: never queued (no queue event)' };
  if (event.event === 'removed_from_merge_queue') return mine ? { text: `queue: not in queue (removed ${event.at}) — yet a queue ref exists (${pos}); re-read`, gap: 'a queue ref exists after the last queue event removed the PR, so membership is unread' } : { text: `queue: not in queue (removed ${event.at})` };
  if (!q) return { text: `queue: in queue (added ${event.at}), position unread`, gap: 'the queue refs could not be listed, so the position is unread' };
  return { text: `queue: in queue (added ${event.at}), ${pos ?? 'no queue ref for it now (a ref answers a build, not membership) — position unread'}` };
}

/** One PR's state, read through `get` / `lsRemote` / `sleep`. `{ number, line, gaps, exit, json }`. */
export function readPrState({ repo, number, get = ghApi, lsRemote = gitLsRemote, sleep = sleepMs, rereads = DEFAULT_REREADS, roster = null }) {
  const gaps = [];
  let row = get(`/repos/${repo}/pulls/${number}`);
  if (!row.ok) return { number, line: `#${number} · CAN'T READ — the PR row did not answer (${row.error})`, gaps: [row.error], exit: EXIT_PR_UNREADABLE, json: { number, error: row.error } };
  let reads = 1;
  while (row.value.state === 'open' && row.value.mergeable_state === 'unknown' && reads <= rereads) {
    sleep(REREAD_DELAY_MS);
    const again = get(`/repos/${repo}/pulls/${number}`);
    reads++;
    if (!again.ok) break;
    row = again;
  }
  const pr = row.value;
  const head = pr.head?.sha ?? null;
  const base = pr.base?.ref ?? 'main';
  const state = pr.merged_at ? `MERGED ${pr.merged_at}` : pr.state === 'open' ? 'OPEN' : 'CLOSED unmerged';
  let mergeable;
  if (pr.state !== 'open') mergeable = `mergeable_state n/a (${pr.merged_at ? 'merged' : 'closed'})`;
  else if (pr.mergeable_state === 'unknown') {
    mergeable = `mergeable_state unknown after ${reads} read(s) — not a reading`;
    gaps.push(`mergeable_state still unknown after ${reads} read(s)`);
  } else mergeable = `mergeable_state ${pr.mergeable_state}${reads > 1 ? ` (read ${reads}×)` : ''}`;

  const reviews = readPaged(get, `/repos/${repo}/pulls/${number}/reviews`);
  let reviewText;
  let rv = null;
  if (!reviews.ok) {
    reviewText = 'reviews unread';
    gaps.push(`reviews could not be read (${reviews.error})`);
  } else {
    rv = reviewsAtHead(reviews.value, head);
    const parts = [rv.approved.length ? `APPROVED ${rv.approved.join(',')}` : null, rv.changes.length ? `CHANGES_REQUESTED ${rv.changes.join(',')}` : null, rv.dismissed.length ? `DISMISSED ${rv.dismissed.join(',')}` : null].filter(Boolean);
    reviewText = `reviews at ${String(head).slice(0, 10)}: ${parts.join('; ') || 'none'}${rv.older.length ? ` · newest on an older commit: ${olderReviewsText(rv.older)} (an APPROVED counts on any commit)` : ''}`;
  }

  const timeline = readPaged(get, `/repos/${repo}/issues/${number}/timeline`);
  let event = null;
  if (!timeline.ok) gaps.push(`the timeline could not be read (${timeline.error}), so queue membership is unread`);
  else event = lastQueueEvent(timeline.value);
  let queue;
  if (!timeline.ok && pr.state === 'open' && !pr.merged_at) queue = { text: 'queue: unread' };
  else {
    let refs = null;
    let baseSha = null;
    if (pr.state === 'open' && !pr.merged_at) {
      const ls = lsRemote(repo, [`refs/heads/gh-readonly-queue/${base}/*`, `refs/heads/${base}`]);
      if (ls.ok) {
        baseSha = ls.value.find((r) => r.ref === `refs/heads/${base}`)?.sha ?? null;
        refs = baseSha ? ls.value : null;
      }
    }
    queue = queueLeg({ pr: { ...pr, number }, event, refs, baseSha });
    if (queue.gap) gaps.push(queue.gap);
  }

  let checksText;
  let judged = null;
  const runs = readWrappedAll(get, `/repos/${repo}/commits/${head}/check-runs?filter=latest`, 'check_runs');
  if (!runs.ok) {
    checksText = 'checks unread';
    gaps.push(`the head's check-runs could not be read (${runs.error})`);
  } else if (runs.total !== null && runs.value.length < runs.total) {
    checksText = `checks unread (listed ${runs.value.length} of ${runs.total})`;
    gaps.push(`the head's check-run listing returned ${runs.value.length} and the platform counts ${runs.total}`);
  } else {
    judged = judgeCheckRuns({ total_count: runs.value.length, check_runs: runs.value }, roster ?? localRoster());
    if (judged.kind === 'empty') checksText = 'checks: none on the head';
    else if (judged.kind === 'unreadable') {
      checksText = 'checks unread';
      gaps.push(judged.reason);
    } else {
      const failed = judged.other.filter((o) => o.conclusion !== 'neutral');
      checksText = `checks at ${String(head).slice(0, 10)}: ${judged.success} success · ${judged.expected.reduce((s, e) => s + e.count, 0)} expected skip · ${judged.unexpected.length} unexpected skip${judged.unexpected.length ? ` (${judged.unexpected.map((u) => u.name).join(', ')})` : ''} · ${failed.length} failed${failed.length ? ` (${failed.map((f) => `${f.name}=${f.conclusion}`).join(', ')})` : ''} · ${judged.pending.length} pending`;
    }
  }
  const status = get(`/repos/${repo}/commits/${head}/status`);
  let statusText;
  if (!status.ok) {
    statusText = 'commit status unread';
    gaps.push(`the head's commit status could not be read (${status.error})`);
  } else statusText = status.value.total_count ? `commit status ${status.value.state} (${status.value.total_count})` : 'no commit status';
  const auto = pr.auto_merge ? `auto_merge set (${pr.auto_merge.merge_method ?? '?'})` : 'auto_merge null';
  const parts = [`#${number}`, state, `draft ${pr.draft ? 'yes' : 'no'}`, mergeable, queue.text, reviewText, checksText, statusText, `${auto} [unreliable field]`];
  const line = parts.join(' · ') + (gaps.length ? ` — INCOMPLETE: ${gaps.join('; ')}` : '');
  return {
    number,
    line,
    gaps,
    exit: gaps.length ? EXIT_INCOMPLETE : EXIT_OK,
    json: {
      number,
      state: pr.merged_at ? 'merged' : pr.state,
      merged_at: pr.merged_at ?? null,
      draft: Boolean(pr.draft),
      head,
      mergeable_state: pr.state === 'open' ? pr.mergeable_state : null,
      mergeable_reads: reads,
      queue: queue.text,
      queue_event: event,
      reviews_at_head: rv ? { approved: rv.approved, changes: rv.changes, dismissed: rv.dismissed } : null,
      reviews_older: rv ? rv.older : null,
      checks: judged && judged.kind !== 'unreadable' ? { kind: judged.kind, success: judged.success ?? 0, expected_skips: judged.expected?.length ?? 0, unexpected_skips: (judged.unexpected ?? []).map((u) => u.name), other: judged.other ?? [], pending: (judged.pending ?? []).map((p) => p.name) } : null,
      commit_status: status.ok ? { state: status.value.state, total_count: status.value.total_count } : null,
      auto_merge: pr.auto_merge ?? null,
      gaps,
      line,
    },
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function readPaged(get, path, maxPages = 30) {
  const rows = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!r.ok) return r;
    if (!Array.isArray(r.value)) return { ok: false, error: `GET ${path} answered no list` };
    rows.push(...r.value);
    if (r.value.length < 100) return { ok: true, value: rows };
  }
  return { ok: false, error: `GET ${path} still returned full pages after ${maxPages}` };
}

function readWrappedAll(get, path, key, maxPages = 10) {
  const rows = [];
  let total = null;
  for (let page = 1; page <= maxPages; page++) {
    const r = get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!r.ok) return r;
    if (!Array.isArray(r.value?.[key])) return { ok: false, error: `GET ${path} answered no \`${key}\` list` };
    total = r.value.total_count ?? total;
    rows.push(...r.value[key]);
    if (r.value[key].length < 100) return { ok: true, value: rows, total };
  }
  return { ok: false, error: `GET ${path} still returned full pages after ${maxPages}` };
}

/** `git ls-remote https://github.com/<repo>.git <patterns…>` → `{ ok, value: [{sha, ref}] }`. Zero API quota. */
export function gitLsRemote(repo, patterns) {
  const r = spawnSync('git', ['ls-remote', `https://github.com/${repo}.git`, ...patterns], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) return { ok: false, error: (r.stderr || `git ls-remote exited ${r.status}`).trim().split('\n')[0] };
  return { ok: true, value: r.stdout.split('\n').filter(Boolean).map((l) => { const [sha, ref] = l.split('\t'); return { sha, ref }; }) };
}

let rosterCache = null;
/** This checkout's derived skip roster, read once per process (`check-expected-skips.mjs` owns the derivation). */
export function localRoster() {
  rosterCache ??= expectedSkipRoster(REPO_ROOT).roster;
  return rosterCache;
}

export function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---------------------------------------------------------------------------
// Fixture — offline PRs the same reads answer
// ---------------------------------------------------------------------------

/**
 * `{ prs: {N: row | [row, row…] (successive reads)}, reviews: {N: []}, timeline: {N: []}, check_runs: {sha: []},
 * status: {sha: {state, total_count}}, ls_remote: [{sha, ref}] | null, roster: [] }`. Absent → 404; `null` → 502.
 */
export function fixtureReaders(fx, repo) {
  const reads = new Map();
  const page = (rows, path) => {
    const p = Number(new URLSearchParams(path.split('?')[1] ?? '').get('page') ?? 1);
    return rows.slice((p - 1) * 100, p * 100);
  };
  const from = (table, key, path, wrap) => {
    if (!table || !(key in table)) return { ok: false, error: 'HTTP 404' };
    if (table[key] === null) return { ok: false, error: 'HTTP 502' };
    return { ok: true, value: wrap ? wrap(table[key]) : page(table[key], path) };
  };
  const get = (path) => {
    const bare = path.split('?')[0];
    let m = new RegExp(`^/repos/${repo}/pulls/(\\d+)$`).exec(bare);
    if (m) {
      const v = fx.prs?.[m[1]];
      if (v === undefined || v === null) return { ok: false, error: v === null ? 'HTTP 502' : 'HTTP 404' };
      if (!Array.isArray(v)) return { ok: true, value: v };
      const k = reads.get(m[1]) ?? 0;
      reads.set(m[1], k + 1);
      return { ok: true, value: v[Math.min(k, v.length - 1)] };
    }
    if ((m = new RegExp(`^/repos/${repo}/pulls/(\\d+)/reviews$`).exec(bare))) return from(fx.reviews, m[1], path);
    if ((m = new RegExp(`^/repos/${repo}/issues/(\\d+)/timeline$`).exec(bare))) return from(fx.timeline, m[1], path);
    if ((m = new RegExp(`^/repos/${repo}/commits/([0-9a-f]+)/check-runs$`).exec(bare))) return from(fx.check_runs, m[1], path, (runs) => ({ total_count: fx.check_runs_total ?? runs.length, check_runs: page(runs, path) }));
    if ((m = new RegExp(`^/repos/${repo}/commits/([0-9a-f]+)/status$`).exec(bare))) return from(fx.status, m[1], path, (s) => s);
    return { ok: false, error: `HTTP 404 (${bare})` };
  };
  const lsRemote = () => (fx.ls_remote === null ? { ok: false, error: 'fatal: unable to access' } : { ok: true, value: fx.ls_remote ?? [] });
  return { get, lsRemote, sleep: () => {}, roster: fx.roster ?? [] };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
  'pr-state — one state line per PR: merged, draft, mergeable_state, queue, reviews at head, checks (read-only).',
  '',
  '  node scripts/pm/pr-state.mjs --pr N[,N…] [--repo OWNER/NAME] [--rereads K] [--json] [--fixture FILE]',
  '  node scripts/pm/pr-state.mjs --self-test',
  '',
  '  Exits: 0 complete · 2 usage · 3 a PR row unreadable · 4 INCOMPLETE (a leg unread or mergeable_state still unknown).',
].join('\n');

export function parseArgs(argv) {
  const opts = { repo: DEFAULT_SWEEP_REPO, prs: [], rereads: DEFAULT_REREADS, json: false, fixture: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = /^(--[a-z-]+)=(.*)$/.exec(a);
    const flag = eq ? eq[1] : a;
    const take = () => (eq ? eq[2] : argv[++i]);
    if (flag === '--json' && !eq) opts.json = true;
    else if ((flag === '--help' || flag === '-h') && !eq) opts.help = true;
    else if (flag === '--pr') {
      const v = String(take() ?? '');
      const list = v.split(',').map((s) => s.trim().replace(/^#/, ''));
      if (!list.every((s) => /^[1-9][0-9]*$/.test(s))) return { error: `--pr must be N or N,N,… (PR numbers), got \`${v}\`` };
      opts.prs.push(...list.map(Number));
    } else if (flag === '--repo') {
      opts.repo = String(take() ?? '');
      if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) return { error: `--repo must be OWNER/NAME, got \`${opts.repo}\`` };
    } else if (flag === '--rereads') {
      const v = String(take() ?? '');
      if (!/^[0-9]$/.test(v)) return { error: `--rereads must be 0-9, got \`${v}\`` };
      opts.rereads = Number(v);
    } else if (flag === '--fixture') {
      opts.fixture = take();
      if (!opts.fixture) return { error: '--fixture needs a file' };
    } else return { error: `\`${a}\` is not an argument this tool takes` };
  }
  if (!opts.help && opts.prs.length === 0) return { error: '--pr N is required' };
  return { opts };
}

export function main(argv, deps = {}) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`pr-state: ${parsed.error}`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const o = parsed.opts;
  if (o.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  let readers = deps.readers ?? {};
  if (o.fixture) {
    try {
      readers = fixtureReaders(JSON.parse(readFileSync(o.fixture, 'utf8')), o.repo);
    } catch (e) {
      console.error(`pr-state: --fixture \`${o.fixture}\` could not be read as JSON (${e.message})`);
      return EXIT_USAGE;
    }
  }
  const results = o.prs.map((number) => readPrState({ repo: o.repo, number, rereads: o.rereads, ...readers }));
  const exit = results.some((r) => r.exit === EXIT_PR_UNREADABLE) ? EXIT_PR_UNREADABLE : results.some((r) => r.exit === EXIT_INCOMPLETE) ? EXIT_INCOMPLETE : EXIT_OK;
  if (o.json) console.log(JSON.stringify({ repo: o.repo, prs: results.map((r) => r.json), unread_legs: UNREAD_LEGS, exit }, null, 2));
  else {
    for (const r of results) console.log(r.line);
    console.log('Not read by this reader — the seat reads these itself:');
    for (const leg of UNREAD_LEGS) console.log(`  · ${leg}`);
    console.log(exit === EXIT_OK ? `pr-state COMPLETE — ${results.length} PR(s), every leg read.` : `pr-state ${exit === EXIT_PR_UNREADABLE ? "CAN'T READ a PR" : 'INCOMPLETE'} — ⛔ not a clean state line: re-run when the reads answer.`);
  }
  return exit;
}

// ---------------------------------------------------------------------------
// Self-test — floor (battery names pinned) + handshake, copied from the landed shape
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the rule text: every phrase this file is built from is in the file that writes it': 3,
  'mergeable_state: unknown is re-read, bounded, and never printed as a reading': 5,
  'the queue: the timeline decides membership, the parent-tip chain the position': 9,
  'reviews: the newest per reviewer, at the head commit and apart from it on older ones': 6,
  'checks and status: the head, every page, the count checked': 6,
  'the line and the CLI: usage, exits and the footer': 7,
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
  const sha = (c) => c.repeat(40);
  const HEAD = sha('c');
  const MAIN = sha('a');
  const open = (over = {}) => ({ number: 7, state: 'open', draft: false, merged_at: null, mergeable_state: 'clean', head: { sha: HEAD }, base: { ref: 'main' }, auto_merge: null, ...over });
  const run = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion, check_suite: { id: 1 } });
  const fixture = (over = {}) => ({ prs: { 7: open() }, reviews: { 7: [] }, timeline: { 7: [] }, check_runs: { [HEAD]: [run('Test Core'), run('Lint & Repo Gates')] }, status: { [HEAD]: { state: 'pending', total_count: 0 } }, ls_remote: [{ sha: MAIN, ref: 'refs/heads/main' }], roster: [{ name: 'Build Docs', reason: 'docs filter' }], ...over });
  const read = (fx, opts = {}) => readPrState({ repo: REPO, number: 7, ...fixtureReaders(fx, REPO), ...opts });

  battery('the rule text: every phrase this file is built from is in the file that writes it');
  {
    const missing = Object.entries(RULE_FILES).flatMap(([p, phrases]) => phrases.filter((ph) => !readFileSync(join(REPO_ROOT, p), 'utf8').includes(ph)).map((ph) => `${p}: ${ph}`));
    t('⭐ coordinator.md, landing-operations.md and readings-queue.md still say what this file encodes', missing, []);
    t('the queue-ref shape parses PR and parent', QUEUE_REF.exec(`refs/heads/gh-readonly-queue/main/pr-35482-${MAIN}`)?.slice(1), ['35482', MAIN]);
    t('the six facts the coordinator rule names are each on the line', ['MERGED', 'draft', 'mergeable_state', 'queue:', 'reviews at', 'auto_merge'].every((w) => read(fixture({ prs: { 7: open({ merged_at: '2026-11-19T13:48:50Z', state: 'closed' }) } })).line.includes(w)), true);
  }

  battery('mergeable_state: unknown is re-read, bounded, and never printed as a reading');
  {
    const settles = read(fixture({ prs: { 7: [open({ mergeable_state: 'unknown' }), open({ mergeable_state: 'unknown' }), open({ mergeable_state: 'blocked' })] } }));
    t('⭐ unknown is re-read until it settles, and the line says how many reads', [settles.exit, settles.line.includes('mergeable_state blocked (read 3×)')], [EXIT_OK, true]);
    const stuck = read(fixture({ prs: { 7: [open({ mergeable_state: 'unknown' })] } }), { rereads: 2 });
    t('⭐ unknown after the bound is INCOMPLETE, exit 4, never a reading', [stuck.exit, stuck.line.includes('mergeable_state unknown after 3 read(s) — not a reading')], [EXIT_INCOMPLETE, true]);
    let slept = 0;
    read(fixture({ prs: { 7: [open({ mergeable_state: 'unknown' })] } }), { rereads: 2, sleep: () => slept++ });
    t('the re-reads are bounded by --rereads and each waits', slept, 2);
    const merged = read(fixture({ prs: { 7: open({ state: 'closed', merged_at: '2026-11-19T13:48:50Z', mergeable_state: 'unknown' }) } }));
    t('a merged PR is never re-read for mergeable_state and is not incomplete for it', [merged.exit, merged.line.includes('mergeable_state n/a (merged)')], [EXIT_OK, true]);
    t('a clean open PR is read once', read(fixture()).json.mergeable_reads, 1);
  }

  battery('the queue: the timeline decides membership, the parent-tip chain the position');
  {
    const added = { event: 'added_to_merge_queue', created_at: '2026-11-19T10:00:00Z' };
    const removed = { event: 'removed_from_merge_queue', created_at: '2026-11-19T10:05:00Z' };
    const refs = [{ sha: MAIN, ref: 'refs/heads/main' }, { sha: sha('1'), ref: `refs/heads/gh-readonly-queue/main/pr-5-${MAIN}` }, { sha: sha('2'), ref: `refs/heads/gh-readonly-queue/main/pr-7-${sha('1')}` }, { sha: sha('3'), ref: `refs/heads/gh-readonly-queue/main/pr-9-${sha('2')}` }];
    const inQ = read(fixture({ timeline: { 7: [added] }, ls_remote: refs }));
    t('⭐ in queue: the position is walked from the base tip by parent, never by name order', inQ.line.includes('queue: in queue (added 2026-11-19T10:00:00Z), position 2 of 3'), true);
    t('⭐ the LAST queue event decides: removed after added is not in queue', read(fixture({ timeline: { 7: [added, removed] } })).line.includes('queue: not in queue (removed 2026-11-19T10:05:00Z)'), true);
    t('no queue event is never queued', read(fixture()).line.includes('queue: never queued'), true);
    const noRef = read(fixture({ timeline: { 7: [added] } }));
    t('in queue with no ref: membership stands, the position is unread, and that is not a gap', [noRef.exit, noRef.line.includes('no queue ref for it now (a ref answers a build, not membership) — position unread')], [EXIT_OK, true]);
    const contradict = read(fixture({ timeline: { 7: [added, removed] }, ls_remote: refs }));
    t('⭐ a ref after the last event removed the PR contradicts the timeline: printed, not resolved, INCOMPLETE exit 4', [contradict.exit, contradict.line.includes('— yet a queue ref exists (position 2 of 3); re-read'), contradict.line.includes('INCOMPLETE: a queue ref exists after the last queue event removed the PR')], [EXIT_INCOMPLETE, true, true]);
    const noEvent = read(fixture({ ls_remote: refs }));
    t('⭐ a ref with no queue event on the timeline contradicts it: INCOMPLETE exit 4, never a clean line', [noEvent.exit, noEvent.line.includes('queue: no queue event on the timeline, yet a queue ref exists (position 2 of 3) — re-read'), noEvent.gaps], [EXIT_INCOMPLETE, true, ['a queue ref exists with no queue event on the timeline, so membership is unread']]);
    const lsDown = read(fixture({ timeline: { 7: [added] }, ls_remote: null }));
    t('⭐ unlisted queue refs on an in-queue PR leave the position unread and make it INCOMPLETE', [lsDown.exit, lsDown.gaps[0]], [EXIT_INCOMPLETE, 'the queue refs could not be listed, so the position is unread']);
    const tl = read(fixture({ timeline: { 7: null } }));
    t('⭐ an unreadable timeline is INCOMPLETE: membership is never inferred from refs', [tl.exit, tl.line.includes('queue: unread')], [EXIT_INCOMPLETE, true]);
    t('a broken chain leaves the stranded entries off it', queueChain(refs.filter((r) => !r.ref.includes('pr-5-')), MAIN).chain.length, 0);
  }

  battery('reviews: the newest per reviewer, at the head commit and apart from it on older ones');
  {
    const rv = (login, state, commit, at) => ({ user: { login }, state, commit_id: commit, submitted_at: at });
    const r = reviewsAtHead([rv('a', 'CHANGES_REQUESTED', HEAD, '1'), rv('a', 'APPROVED', HEAD, '2'), rv('b', 'APPROVED', sha('d'), '1'), rv('c', 'COMMENTED', HEAD, '3')], HEAD);
    t('⭐ the newest review per reviewer counts; an approval on an older commit is not at head, and is kept with its state and login', [r.approved, r.changes, r.older], [['a'], [], [{ login: 'b', state: 'APPROVED', commit: sha('d') }]]);
    t('a comment-only review is neither', reviewsAtHead([rv('c', 'COMMENTED', HEAD, '3')], HEAD).approved, []);
    t('the line names the approvals at head and, apart from them, the older ones by state and login', read(fixture({ reviews: { 7: [rv('a', 'APPROVED', HEAD, '2'), rv('b', 'APPROVED', sha('d'), '1')] } })).line.includes(`reviews at ${HEAD.slice(0, 10)}: APPROVED a · newest on an older commit: APPROVED b@${sha('d').slice(0, 10)} (an APPROVED counts on any commit)`), true);
    const moved = read(fixture({ reviews: { 7: [rv('m', 'APPROVED', sha('d'), '1'), rv('x', 'CHANGES_REQUESTED', sha('e'), '2')] } }));
    t('⭐ approve, then a merge of main moves the head: the line still says who approved, never only a count', [moved.exit, moved.line.includes(`reviews at ${HEAD.slice(0, 10)}: none · newest on an older commit: APPROVED m@${sha('d').slice(0, 10)}, CHANGES_REQUESTED x@${sha('e').slice(0, 10)}`)], [EXIT_OK, true]);
    t('--json carries the older reviews apart from the at-head ones', JSON.parse(quiet(main)(['--pr', '7', '--json'], { readers: fixtureReaders(fixture({ reviews: { 7: [rv('m', 'APPROVED', sha('d'), '1')] } }), REPO) }).out).prs[0].reviews_older, [{ login: 'm', state: 'APPROVED', commit: sha('d') }]);
    t('unreadable reviews are INCOMPLETE', read(fixture({ reviews: { 7: null } })).exit, EXIT_INCOMPLETE);
  }

  battery('checks and status: the head, every page, the count checked');
  {
    const runs = [run('Test Core'), run('Build Docs', 'skipped'), run('Lint UI', 'skipped'), run('Type Check UI', 'failure'), { name: 'Build Core', status: 'in_progress', conclusion: null, check_suite: { id: 1 } }];
    const r = read(fixture({ check_runs: { [HEAD]: runs } }));
    t('⭐ success, expected and unexpected skips, failures and pending are each counted', r.line.includes('1 success · 1 expected skip · 1 unexpected skip (Lint UI) · 1 failed (Type Check UI=failure) · 1 pending'), true);
    const many = Array.from({ length: 130 }, (_, k) => run(`job ${k}`));
    t('every page of check-runs is read', read(fixture({ check_runs: { [HEAD]: many } })).line.includes('130 success'), true);
    const gap = read(fixture({ check_runs_total: 9 }));
    t('⭐ a listing shorter than the platform count is INCOMPLETE', [gap.exit, gap.line.includes('checks unread (listed 2 of 9)')], [EXIT_INCOMPLETE, true]);
    t('a legacy status with entries is printed with its state', read(fixture({ status: { [HEAD]: { state: 'failure', total_count: 1 } } })).line.includes('commit status failure (1)'), true);
    t('unreadable check-runs are INCOMPLETE', read(fixture({ check_runs: { [HEAD]: null } })).exit, EXIT_INCOMPLETE);
    const live = readPrState({ repo: REPO, number: 7, ...fixtureReaders(fixture({ check_runs: { [HEAD]: [run('Build Docs', 'skipped')] } }), REPO), roster: null });
    t('⭐ with no injected roster the live one is derived from this checkout and judges a skip', [Array.isArray(localRoster()), localRoster().length > 0, live.exit], [true, true, EXIT_OK]);
  }

  battery('the line and the CLI: usage, exits and the footer');
  {
    t('--pr is required', Boolean(parseArgs([]).error), true);
    t('a list of PRs is read, #N included', parseArgs(['--pr', '7,#8']).opts.prs, [7, 8]);
    t('an unknown flag is refused, never ignored', Boolean(parseArgs(['--pr', '7', '--fast']).error), true);
    const ok = quiet(main)(['--pr', '7'], { readers: fixtureReaders(fixture(), REPO) });
    t('⭐ every run names the legs it cannot read, auto_merge is tagged unreliable, a complete run exits 0', [ok.code, UNREAD_LEGS.every((l) => ok.out.includes(l)), ok.out.includes('auto_merge null [unreliable field]')], [EXIT_OK, true, true]);
    const gone = quiet(main)(['--pr', '7,8'], { readers: fixtureReaders(fixture(), REPO) });
    t('⭐ an unreadable PR row is exit 3 and its line says CAN\'T READ', [gone.code, gone.out.includes("#8 · CAN'T READ")], [EXIT_PR_UNREADABLE, true]);
    const inc = quiet(main)(['--pr', '7'], { readers: fixtureReaders(fixture({ reviews: { 7: null } }), REPO) });
    t('an incomplete run never prints the COMPLETE verdict', [inc.code, inc.out.includes('pr-state COMPLETE')], [EXIT_INCOMPLETE, false]);
    t('--json carries the exit', JSON.parse(quiet(main)(['--pr', '7', '--json'], { readers: fixtureReaders(fixture(), REPO) }).out).exit, EXIT_OK);
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
  for (const f of floor) console.error(`  ✗ ${f}`);
  if (failed.length || floor.length) {
    console.error(`✗ pr-state self-test: ${failed.length} of ${cases.length} case(s) failed${floor.length ? `, ${floor.length} floor breach(es)` : ''}.`);
    selfTestReachedVerdict = true;
    return EXIT_SELF_TEST_FAILED;
  }
  console.log(`✓ pr-state self-test: ${cases.length} cases pass across ${declared.length} batteries — offline, no network.`);
  selfTestReachedVerdict = true;
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error('\n✗ pr-state self-test: selfTest() returned without reaching its verdict, so no success line was\nprinted. Exiting 0 here would report a self-test that never finished as one that passed.\n');
      process.exit(1);
    }
    process.exit(code);
  } else {
    process.exit(main(argv));
  }
}
