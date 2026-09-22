#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * write-pace — one throttle in front of every seat write (#19572).
 *
 *   node scripts/pm/write-pace.mjs --status      # this token's budget, the lease holder, the queue
 *   node scripts/pm/write-pace.mjs --self-test   # offline core with an injected clock, plus a
 *                                                # real-process battery for the lease (no network)
 *   node scripts/pm/write-pace.mjs --announce-batch 17 --kind 'issue-create POST'
 *                                                # rule ⑤: raise the gap for the next 17 writes
 *   node scripts/pm/write-pace.mjs --run --kind 'gh api POST' -- gh api -X POST …
 *                                                # rule ④ for a SHELL caller: take the lease, pace,
 *                                                # run the command, release. `--read` skips the gate.
 *
 * ## What this is, and the one thing it must never become
 *
 * Two seat accounts were suspended by the platform during bulk issue
 * operations. The maintainer's ruling is one sentence — 「截流应该要加」 — and
 * this file is that sentence made mechanical, so that pacing is a property of
 * the write path rather than of who remembered it.
 *
 * It is a THROTTLE, not an instrument. It reads no body, judges no card and
 * changes nothing a write says. It answers exactly one question, asked
 * immediately before a request leaves: may this write go now, and if not now,
 * after how long a pause — or not at all? Everything else about the write
 * belongs to the caller. ⛔ Anything added here that could change WHAT is
 * written belongs in the calling tool, not in the throttle.
 *
 * ## The three rules, and the defaults that are the contract
 *
 *   ① at least `DEFAULT_MIN_GAP_MS` (3 s) between two writes by the same
 *      token. The remainder is SLEPT, and the sleep prints one line saying so —
 *      a pause nobody can see is indistinguishable from a hang;
 *   ② at most `DEFAULT_HOURLY_MAX` (40) writes by that token in the trailing
 *      60 minutes. The 41st is REFUSED — exit `EXIT_WRITE_PACE_REFUSED`, with a
 *      prescription naming the count, when the window reopens, and what to fold
 *      into fewer writes. ⛔ Never a silent wait: an hour-long sleep inside a
 *      write path is a hang with a good excuse, and the seat that needs to hear
 *      "fold this batch" hears nothing;
 *   ③ a platform back-off signal writes a STOP MARKER — 30 minutes, or the
 *      `retry-after` it asked for when that reaches further — and every write by
 *      that token is refused, with the marker's expiry printed, until it
 *      expires.
 *
 * `OS_PM_WRITE_MIN_GAP_MS` and `OS_PM_WRITE_HOURLY_MAX` override ① and ② FOR
 * TESTS. The defaults above are the contract; an override that does not parse
 * as a non-negative integer is IGNORED and said out loud, because an override
 * that silently loosens a budget is worse than one that is refused.
 *
 * ## Rules ④ and ⑤ — the lease and the batch gap, and the reading behind them
 *
 * The three rules above were written per PROCESS, and the fleet is many
 * processes: every seat's subagent runs in its own worktree, so a per-process
 * pause of 1.2 s in each of N processes is a burst of N writes from ONE
 * identity. The measured shape of the second suspension, read from the
 * platform's own headers:
 *
 *   - the token was user-to-server (`GET /user` answered a login, `X-OAuth-Scopes`
 *     empty, `X-RateLimit-Limit: 15000`, a one-hour expiry header), so every
 *     write was booked against a person;
 *   - `X-RateLimit-Remaining` never moved off 15000/15000 — quota was NOT the
 *     trigger. The trigger was RATE SHAPE: 17 issues created in 29 s (a 1.2 s
 *     gap, each process sleeping its own), after which the account was
 *     restricted for the window 08:16–08:52 UTC that day, and every later push
 *     by it — the platform's own `web-flow` merge commits included — got no
 *     `github-actions` check-suite while sibling PRs dispatched normally;
 *   - the platform names "rapid content creation" and "bursts" as secondary-
 *     limit triggers and asks for ≥ 1.5 s between content-creating writes.
 *
 * So two more rules, both FLEET-WIDE because both live in the shared log:
 *
 *   ④ ONE WRITE IN FLIGHT, fleet-wide. A write holds the LEASE from the moment
 *      it is reserved until its response is in hand (`paceWrite` takes it,
 *      `noteResponse` releases it), and the minimum gap is slept UNDER the
 *      lease, so two processes cannot agree they are both "3 s after the last
 *      one". The lease is a `mkdir` beside the log with a holder record (pid,
 *      instant, kind); a waiter takes a TICKET in a queue directory and only
 *      the head contends, so grants are FIFO among waiters rather than decided
 *      by who happens to poll — the same shape as `os-verify-lock.sh`, whose
 *      `flock` this host may not have (a stock macOS ships none). A holder
 *      whose process is gone, or that has held longer than
 *      `DEFAULT_LEASE_MAX_HOLD_MS` (2 min), is broken by the next waiter and
 *      said out loud. A waiter that gets no turn within
 *      `DEFAULT_LEASE_WAIT_MS` (15 min) is REFUSED — exit
 *      `EXIT_WRITE_PACE_REFUSED`, naming the holder — never left spinning.
 *   ⑤ BATCH MODE. A caller about to create or change N ≥ `DEFAULT_BATCH_THRESHOLD`
 *      (5) objects announces it first (`announceBatch` / `--announce-batch N`):
 *      the gap for that token's next N writes rises to `DEFAULT_BATCH_GAP_MS`
 *      (30 s) — every process sees it, because the batch is a record in the
 *      shared log — and the announcement prints the item count and the
 *      estimated duration, so a seat reading the log knows the pause is the
 *      contract and not a hang. Below the threshold nothing changes.
 *
 * `OS_PM_WRITE_BATCH_THRESHOLD`, `OS_PM_WRITE_BATCH_GAP_MS`,
 * `OS_PM_WRITE_LEASE_MAX_HOLD_MS` and `OS_PM_WRITE_LEASE_WAIT_MS` override ④
 * and ⑤ FOR TESTS, under the same parse rule as the two above. Reads are
 * never leased, never gapped, never counted — `isWriteMethod()` is the gate.
 *
 * ## ⚠️ How far "fleet-wide" reaches: one filesystem, and no further
 *
 * Every rule above is enforced through this log and the lease beside it, so
 * the fleet it covers is the set of processes that share that path. On a host
 * where every session shares a home — a developer's machine — that is the
 * whole fleet. Inside one cloud container it is the seat and every subagent it
 * fans out into worktrees, which is the shape of the incident above: one
 * seat's fan-out, each process pacing itself.
 *
 * ACROSS CONTAINERS IT IS NOT SHARED, and there is no shared volume to point
 * it at (maintainer, 2026-09-22). So N containers writing at once are N
 * independently paced streams against ONE identity, and neither the lease nor
 * the hourly budget sees the other N−1. What the platform does share is the
 * installation's own counter — `x-ratelimit-used` on every response — which is
 * the candidate signal for a cross-container rule; it is unmeasured, so
 * nothing here acts on it yet. Until then the knob is this file's own
 * overrides, set conservatively per container.
 *
 * ⛔ What a 403/429 does is rule ③ and NOT a retry loop. The git-retry
 * convention (2 s / 4 s / 8 s / 16 s) is for a transport that dropped a packet;
 * a secondary-limit refusal is the platform saying this IDENTITY is writing
 * too fast, and the platform's own guidance is to wait the `retry-after` it
 * names or at least a minute, growing on every repeat. A marker of 30 minutes
 * (or the `retry-after`, whichever reaches further) refused loudly is the
 * conservative end of that, and every seat sharing the identity sees the same
 * refusal — a 16 s sleep inside one process would be exactly the per-process
 * pacing that produced the burst.
 *
 * ## `--run` — the door for shell callers
 *
 * A write that no `scripts/pm/` tool owns still leaves through this file:
 * `scripts/pm/with-fleet.sh -- <command…>` mints the fleet identity and runs the
 * command through `--run`, which takes the lease, paces, spawns the command
 * with inherited stdio, releases on exit and passes the command's own exit
 * code through. It cannot see an HTTP status, so rule ③ is not applied to a
 * `--run` — a tool that owns its transport calls both halves and gets all
 * five rules; that is the reason to prefer the tool over the door.
 *
 * ## Where the log lives, and why the token is not in it
 *
 * `~/.cache/objectstack-pm/write-pace.jsonl` (`OS_PM_WRITE_PACE_FILE` to move
 * it). One JSON line per write, keyed by `tokenKey()` — a 12-hex prefix of the
 * token's SHA-256. ⛔ The token itself never reaches the file, in any field:
 * the budget is per identity, and a cache file is not a place to keep a
 * credential. The prefix is enough to separate identities and useless to
 * anyone who reads it.
 *
 * The file is READ-PRUNE-REWRITTEN on every pass, so it holds the trailing hour
 * of writes plus any unexpired marker and nothing else. A marker survives the
 * prune by its own expiry, never by age — a `retry-after` longer than an hour
 * would otherwise prune away the very refusal it asked for.
 *
 * ## Reserve, then sleep — the order is the whole concurrency story
 *
 * Several seats share one container and one token. The decision and the record
 * of it are taken under one lock, and the SLEEP happens after the lock is
 * released: the record's timestamp is the instant the write will be ISSUED, not
 * the instant it was decided. So a second process asking while the first is
 * still sleeping sees the reservation and paces behind it. Sleeping under the
 * lock would serialise every seat behind one 3-second pause; deciding without
 * reserving would let two seats agree they are both the 40th.
 *
 * The lock is a `mkdir`, and it FAILS OPEN: a lock that cannot be taken within
 * `LOCK_WAIT_MS`, or one left behind by a process that died, never blocks a
 * write. The cost of failing open is an undercount; the cost of failing closed
 * is a seat that cannot write at all, which is a worse outage than the one this
 * file exists to prevent. A process that dies mid-sleep leaves its reservation
 * behind and OVERcounts, which is the safe direction.
 *
 * ## `classifyHttp` is reused by VALUE, never re-derived
 *
 * `label-write.mjs` already owns "what does this status mean for the op that
 * asked", and its `ratelimit` arm — a 403 or 429 whose `x-ratelimit-remaining`
 * is 0 — is a verdict this file accepts as an input: pass it to `noteResponse`
 * as `verdict` and `stopSignalFrom` honours it. ⛔ It is not imported: that
 * module pulls in the half-states patrol behind it, and a throttle that every
 * write path loads must not drag a 26k-line gate into every process.
 *
 * What this file adds is the signals that classifier does not answer, and they
 * are not copies of it: a 429 whose quota is NOT exhausted (the secondary
 * limit's shape), a 403 whose BODY names the secondary limit, a bare
 * `retry-after`, and an `x-ratelimit-remaining: 0` on ANY status — including a
 * 200, which is exactly the answer that precedes the first refusal.
 *
 * ## Dry runs are excluded STRUCTURALLY, not by a flag read here
 *
 * This file has no idea what a dry run is, and must not. Every caller wires it
 * into the one transport function it owns, guarded by `isWriteMethod()`, and
 * every `--dry-run` path in those tools returns before it issues a write
 * request at all. So a dry run neither counts nor sleeps because it makes no
 * write — a property their own self-tests already pin, rather than a second
 * flag this file could get wrong.
 *
 * ## Output goes to STDERR, always
 *
 * `post-stamped.mjs` prints the rendered body to stdout and `--json` payloads
 * after it. A pacing line on stdout would corrupt both. Every line this file
 * emits — the sleep note, the marker note, the refusals — is stderr; `--status`
 * is the one command whose report is stdout, because reading it IS the output.
 *
 * ## Exit contract
 *
 *   0   `--status` completed, or a `--self-test` that reached its verdict.
 *   2   usage.
 *  10   `EXIT_WRITE_PACE_REFUSED` — the budget, a stop marker, or a lease that
 *       gave no turn within its wait refused this write. Distinct from every
 *       code the calling tools use (their highest is 9), so a seat reading an
 *       exit code can always tell "the throttle stopped me" from anything the
 *       tool itself decided. ⛔ NOT a failure of the work: nothing was written,
 *       nothing is half-written, and re-running after the printed instant is
 *       safe. `--run` passes the wrapped command's own exit code through and
 *       raises 10 only when the gate itself refused, before the command ran.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { constants as OS_CONSTANTS, homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_WRITE_PACE_REFUSED = 10;

/** The contract. Both are overridable FOR TESTS only; see the header. */
export const DEFAULT_MIN_GAP_MS = 3_000;
export const DEFAULT_HOURLY_MAX = 40;

/** The trailing window rule ② is measured over, and the marker rule ③ writes. */
export const WINDOW_MS = 60 * 60 * 1000;
export const STOP_MARKER_MS = 30 * 60 * 1000;

/** The verbs that spend budget. A read is never paced — it is not what suspends an account. */
export const WRITE_METHODS = Object.freeze(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Long enough to separate identities, far too short to be a credential. */
export const TOKEN_KEY_LENGTH = 12;

const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 15_000;
const LOCK_POLL_MS = 40;
// The second bound. See `withPaceLock`: a deadline read from an injected clock
// is not a bound on its own.
const LOCK_MAX_ATTEMPTS = 400;

/** Rules ④ and ⑤. Overridable FOR TESTS only, like ① and ②; see the header. */
export const DEFAULT_BATCH_THRESHOLD = 5;
export const DEFAULT_BATCH_GAP_MS = 30_000;
export const DEFAULT_LEASE_MAX_HOLD_MS = 120_000;
export const DEFAULT_LEASE_WAIT_MS = 15 * 60 * 1000;

/**
 * `--run` hands its child the pid that holds the lease. A child that gates
 * itself (a `scripts/pm` tool) then INHERITS the turn instead of waiting two
 * minutes for its own parent's lease to be judged stale — measured on the
 * first live run: the wrapper held it, the tool queued behind it. The child
 * still reserves its own slot; it just does not re-take the lease, and never
 * releases the one it inherited.
 */
export const LEASE_HOLDER_ENV = 'OS_PM_WRITE_LEASE_HOLDER';

const LEASE_POLL_MS = 50;
// The attempt bound beside the wait deadline, for the same frozen-clock reason
// `LOCK_MAX_ATTEMPTS` exists: 40 000 polls of 50 ms is longer than any wait a
// real clock allows, so under a real clock the deadline always fires first.
const LEASE_MAX_ATTEMPTS = 40_000;
// A waiter says it is waiting after this long, once — a silent wait is a hang.
const LEASE_ANNOUNCE_AFTER_MS = 2_000;

// ---------------------------------------------------------------------------
// Pure core — every decision this file makes is one of the functions below,
// taking its clock as an argument, so `--self-test` drives all of them with no
// filesystem, no network and no real time.
// ---------------------------------------------------------------------------

/**
 * The per-identity key: a 12-hex prefix of the token's SHA-256.
 *
 * A token-less run keys to `no-token` rather than to nothing, so an
 * unauthenticated write path is still paced — it shares one budget with every
 * other token-less run, which is the conservative direction.
 */
export function tokenKey(token) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return 'no-token';
  return createHash('sha256').update(raw).digest('hex').slice(0, TOKEN_KEY_LENGTH);
}

/** Does this HTTP method spend budget? */
export function isWriteMethod(method) {
  return WRITE_METHODS.includes(String(method ?? 'GET').toUpperCase());
}

/** Where the log lives for this environment. */
export function paceFilePath(env = process.env, home = homedir()) {
  const override = typeof env.OS_PM_WRITE_PACE_FILE === 'string' ? env.OS_PM_WRITE_PACE_FILE.trim() : '';
  return override || join(home, '.cache', 'objectstack-pm', 'write-pace.jsonl');
}

/**
 * The two limits in force, and a note for every override that did not parse.
 *
 * ⛔ A malformed override falls back to the DEFAULT and says so. Reading
 * `OS_PM_WRITE_HOURLY_MAX=4O` (letter O) as "unlimited" or as 0 are both wrong
 * in a way nobody would see until it mattered.
 */
export function limitsFrom(env = process.env) {
  const notes = [];
  const read = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const n = Number(String(raw).trim());
    if (Number.isInteger(n) && n >= 0) return n;
    notes.push(`${name}=${JSON.stringify(String(raw))} is not a non-negative integer — IGNORED, using the default ${fallback}.`);
    return fallback;
  };
  return {
    minGapMs: read('OS_PM_WRITE_MIN_GAP_MS', DEFAULT_MIN_GAP_MS),
    hourlyMax: read('OS_PM_WRITE_HOURLY_MAX', DEFAULT_HOURLY_MAX),
    batchThreshold: read('OS_PM_WRITE_BATCH_THRESHOLD', DEFAULT_BATCH_THRESHOLD),
    batchGapMs: read('OS_PM_WRITE_BATCH_GAP_MS', DEFAULT_BATCH_GAP_MS),
    leaseMaxHoldMs: read('OS_PM_WRITE_LEASE_MAX_HOLD_MS', DEFAULT_LEASE_MAX_HOLD_MS),
    leaseWaitMs: read('OS_PM_WRITE_LEASE_WAIT_MS', DEFAULT_LEASE_WAIT_MS),
    notes,
  };
}

/**
 * The trailing-hour prune, applied on every read of the log.
 *
 * Three different survival rules, deliberately: a WRITE survives by age, a
 * MARKER survives by its own expiry, and a BATCH survives by its expiry AND by
 * having writes left in it. A `retry-after` of two hours writes a marker that
 * an age rule would prune away thirty minutes before the platform said it
 * could be ignored; a batch whose N writes are spent is over whatever its
 * expiry says.
 */
export function pruneRecords(records, nowMs) {
  const cutoff = nowMs - WINDOW_MS;
  return (Array.isArray(records) ? records : []).filter((r) => {
    if (!r || typeof r !== 'object') return false;
    if (Number.isFinite(Number(r.stop))) return Number(r.stop) > nowMs;
    if (Number.isFinite(Number(r.batch))) return Number(r.batch) > nowMs && Number(r.left) > 0;
    return Number.isFinite(Number(r.t)) && Number(r.t) > cutoff;
  });
}

/** The active batch for a token key, if any — the newest unexpired one with writes left. */
export function activeBatch(records, key, nowMs) {
  let found = null;
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || r.k !== key || !Number.isFinite(Number(r.batch))) continue;
    if (Number(r.batch) <= nowMs || !(Number(r.left) > 0)) continue;
    if (!found || Number(r.at) > Number(found.at)) found = r;
  }
  return found;
}

/**
 * May this token write now?
 *
 * Returns one of three verdicts and everything the caller needs to say why:
 *
 *   `stopped`   a marker is active. `resumeAtMs` is its expiry.
 *   `exhausted` rule ② — `count` writes already in the window. `resumeAtMs` is
 *               when the OLDEST of them ages out, which is the first instant
 *               the window has room again.
 *   `ok`        `sleepMs` is rule ①'s remainder (0 when the gap has passed),
 *               and `issueAtMs` is when the write will actually be issued —
 *               the instant the reservation is stamped with. `gapMs` is the
 *               gap in force — rule ①'s, or rule ⑤'s while a batch is active,
 *               whichever is larger — and `batch` names that batch when there
 *               is one.
 */
export function decidePace({ records = [], key, nowMs, minGapMs = DEFAULT_MIN_GAP_MS, hourlyMax = DEFAULT_HOURLY_MAX } = {}) {
  const mine = (Array.isArray(records) ? records : []).filter((r) => r && r.k === key);

  let marker = null;
  for (const r of mine) {
    if (!Number.isFinite(Number(r.stop))) continue;
    if (!marker || Number(r.stop) > Number(marker.stop)) marker = r;
  }
  const writes = mine.filter((r) => !Number.isFinite(Number(r.stop)) && !Number.isFinite(Number(r.batch)) && Number.isFinite(Number(r.t))).map((r) => Number(r.t));
  const inWindow = writes.filter((t) => t > nowMs - WINDOW_MS);
  const last = writes.length ? Math.max(...writes) : null;
  const batch = activeBatch(mine, key, nowMs);
  const gapMs = batch ? Math.max(minGapMs, Number(batch.gap) || 0) : minGapMs;
  const base = {
    key,
    count: inWindow.length,
    hourlyMax,
    minGapMs,
    gapMs,
    nowMs,
    lastAtMs: last,
    batch: batch ? { n: Number(batch.n), left: Number(batch.left), gapMs: Number(batch.gap), kind: String(batch.kind ?? 'write') } : null,
  };

  if (marker && Number(marker.stop) > nowMs) {
    return { ...base, verdict: 'stopped', sleepMs: 0, resumeAtMs: Number(marker.stop), why: String(marker.why ?? 'a platform back-off signal'), markerAtMs: Number(marker.at) || null };
  }
  if (inWindow.length >= hourlyMax) {
    return { ...base, verdict: 'exhausted', sleepMs: 0, resumeAtMs: Math.min(...inWindow) + WINDOW_MS };
  }
  const sleepMs = last === null ? 0 : Math.max(0, last + gapMs - nowMs);
  return { ...base, verdict: 'ok', sleepMs, issueAtMs: nowMs + sleepMs };
}

/**
 * Does this response say "stop"? Four independent signals, plus the verdict
 * `label-write.mjs`'s `classifyHttp` already reached when the caller has one.
 *
 * ⛔ Status-independent on purpose: `x-ratelimit-remaining: 0` arrives on the
 * 200 that spends the last unit of quota, which is the one answer that lets a
 * seat stop BEFORE the first refusal rather than after it.
 */
export function stopSignalFrom({ status, headers, body, verdict } = {}, nowMs = Date.now()) {
  const code = Number(status);
  const retryAfterMs = parseRetryAfter(headerValue(headers, 'retry-after'), nowMs);
  const remaining = headerValue(headers, 'x-ratelimit-remaining');
  const triggers = [];

  if (verdict === 'ratelimit') triggers.push('`classifyHttp` read it as `ratelimit`');
  if (code === 429) triggers.push('HTTP 429');
  if (code === 403 && namesSecondaryLimit(body)) triggers.push('HTTP 403 whose body names the secondary rate limit');
  if (retryAfterMs !== null) triggers.push(`a retry-after asking for ${fmtDuration(retryAfterMs)}`);
  if (remaining !== null && String(remaining).trim() !== '' && Number(remaining) === 0) triggers.push('x-ratelimit-remaining 0');

  if (triggers.length === 0) return null;
  return {
    untilMs: nowMs + Math.max(STOP_MARKER_MS, retryAfterMs ?? 0),
    why: triggers.join(' + '),
    triggers,
    retryAfterMs,
  };
}

/** Does a response body name the secondary / abuse limit? Accepts a string or a parsed object. */
export function namesSecondaryLimit(body) {
  if (body === null || body === undefined) return false;
  const text = typeof body === 'string' ? body : safeStringify(body);
  return /secondary rate limit/i.test(text) || /abuse detection/i.test(text);
}

/** `retry-after` as a duration in ms — seconds, or an HTTP date. `null` when absent or unreadable. */
export function parseRetryAfter(raw, nowMs = Date.now()) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - nowMs);
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name) ?? null;
  if (typeof headers === 'object') {
    const lower = String(name).toLowerCase();
    for (const [k, v] of Object.entries(headers)) if (String(k).toLowerCase() === lower) return v ?? null;
  }
  return null;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** `2026-09-21T10:14Z` — minute precision, because that is the precision a reader acts on. */
export function stampUtc(ms) {
  return new Date(ms).toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z');
}

/** A duration a human reads without arithmetic. */
export function fmtDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '0s';
  if (n < 60_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}s`;
  const minutes = Math.round(n / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// ---------------------------------------------------------------------------
// What a refusal SAYS. Built as strings rather than printed, so the self-test
// pins the prescription itself — a refusal whose remedy nobody can read is the
// silent wait wearing an exit code.
// ---------------------------------------------------------------------------

const FOLD_ADVICE = [
  '  Fold the batch into fewer writes:',
  '    · one comment carrying every card\'s line, not one comment per card;',
  '    · one `label-write.mjs` run per card — it already batches every --add into ONE POST;',
  '    · a sweep with --dry-run first, then ONE --write pass over exactly what it printed.',
  '  Read your budget before the next batch:  node scripts/pm/write-pace.mjs --status',
].join('\n');

/** Rule ② — the 41st. */
export function exhaustedText(d) {
  return [
    `✗ write-pace: REFUSED — ${d.count} write(s) by this token in the trailing hour is the budget (${d.hourlyMax}),`,
    `  and this would be number ${d.count + 1}. Token key ${d.key}.`,
    `  The window reopens at ${stampUtc(d.resumeAtMs)} (in ${fmtDuration(d.resumeAtMs - d.nowMs)}), when the oldest write ages out.`,
    '  ⛔ NOT a wait: nothing was written, nothing is half-written, and this process will not retry.',
    FOLD_ADVICE,
    `  Exit ${EXIT_WRITE_PACE_REFUSED} is this refusal and nothing else.`,
  ].join('\n');
}

/** Rule ③ — a marker is active. */
export function stoppedText(d) {
  return [
    `✗ write-pace: REFUSED — a stop marker is active for token key ${d.key} until ${stampUtc(d.resumeAtMs)}`,
    `  (in ${fmtDuration(d.resumeAtMs - d.nowMs)}). It was written because: ${d.why}.`,
    '  The platform asked this IDENTITY to stop, and every seat on this board shares it — so switching tools,',
    '  channels or credentials to keep writing is the same act as retrying. ⛔ Do not.',
    `  ${d.count} write(s) by this token are in the trailing hour.`,
    FOLD_ADVICE,
    `  Exit ${EXIT_WRITE_PACE_REFUSED} is this refusal and nothing else.`,
  ].join('\n');
}

/**
 * The log could not be written.
 *
 * `paceWrite` FAILS CLOSED here, and the asymmetry with `noteResponse` below is
 * deliberate: a throttle that cannot record cannot enforce a budget, so it
 * cannot honestly let the write through either — writing unrecorded is exactly
 * the state that suspended two accounts. It runs BEFORE the request, so nothing
 * is half-written, and the remedy is one line long.
 */
export function unrecordableText(file, error) {
  return [
    `✗ write-pace: REFUSED — the throttle cannot write its log at ${file}`,
    `  (${error?.message ?? String(error)}).`,
    '  A throttle that cannot record cannot count, so it cannot allow this write either — writing',
    '  unrecorded is the state this instrument exists to prevent. ⛔ Nothing was written.',
    '  Fix: make that path writable, or point `OS_PM_WRITE_PACE_FILE` at a path that is.',
    `  Exit ${EXIT_WRITE_PACE_REFUSED} is this refusal and nothing else.`,
  ].join('\n');
}

/** Rule ① — the pause, said out loud (and rule ⑤'s wider one, when a batch is in force). */
export function gapText(d, kind) {
  const gap = d.gapMs ?? d.minGapMs;
  const why = d.batch
    ? `the batch gap is ${fmtDuration(gap)} (${d.batch.left} of ${d.batch.n} ${d.batch.kind} left in the announced batch)`
    : `the minimum gap is ${gap}ms`;
  return (
    `write-pace: pausing ${fmtDuration(d.sleepMs)} before ${kind || 'this write'} — ${why} and the previous write by ` +
    `token key ${d.key} was ${fmtDuration(d.nowMs - d.lastAtMs)} ago (${d.count}/${d.hourlyMax} in the trailing hour).`
  );
}

/** Rule ⑤ — the announcement: the count, the gap, and the estimate, so the pause reads as the contract. */
export function batchText({ n, gapMs, threshold, key, kind, estimateMs }) {
  return (
    `write-pace: batch of ${n} ${kind || 'write'} item(s) announced for token key ${key} — at or above the threshold of ` +
    `${threshold}, so the gap for the next ${n} write(s) by this identity is ${fmtDuration(gapMs)}, fleet-wide. ` +
    `Estimated ${fmtDuration(estimateMs)} of pacing for this batch; the pauses below are the contract, not a hang.`
  );
}

/** Rule ⑤ — below the threshold, said once so a reader knows the announcement was heard. */
export function batchBelowThresholdText({ n, threshold }) {
  return `write-pace: batch of ${n} is below the threshold of ${threshold} — the ordinary gap applies; nothing recorded.`;
}

/** Rule ④ — a waiter says it is waiting, once. */
export function leaseWaitingText({ holder, ahead, waitedMs, nowMs }) {
  const who = holder
    ? `held by pid ${holder.pid} (${holder.kind}) for ${fmtDuration(nowMs - holder.atMs)}`
    : 'being handed over';
  return `write-pace: waiting for the fleet write lease — ${who}; ${ahead} ahead in the queue; waited ${fmtDuration(waitedMs)} so far.`;
}

/** Rule ④ — a dead or over-held holder was broken, and by whom. */
export function leaseBrokenText({ holder, nowMs, maxHoldMs, pid }) {
  const why = !holder
    ? 'its holder record was unreadable'
    : !pidAlive(holder.pid)
      ? `pid ${holder.pid} (${holder.kind}) is gone`
      : `pid ${holder.pid} (${holder.kind}) held it ${fmtDuration(nowMs - holder.atMs)}, past the ${fmtDuration(maxHoldMs)} bound`;
  return `write-pace: ⚠ broke a stale fleet write lease — ${why}; pid ${pid} takes it.`;
}

/** Rule ④ — no turn within the wait. Nothing was written. */
export function leaseRefusedText({ holder, ahead, waitedMs, waitMs, nowMs, kind }) {
  const who = holder ? `held by pid ${holder.pid} (${holder.kind}) since ${stampUtc(holder.atMs)}` : 'contended without a readable holder';
  return [
    `✗ write-pace: REFUSED — no turn on the fleet write lease within ${fmtDuration(waitMs)} for ${kind || 'this write'}:`,
    `  ${who}, ${ahead} waiter(s) ahead, waited ${fmtDuration(waitedMs)} (until ${stampUtc(nowMs)}).`,
    '  ⛔ NOT a wait: nothing was written, nothing is half-written, and this process will not retry.',
    '  A holder whose process is gone is broken by the next waiter automatically; a live one is a',
    '  seat mid-write. Read the holder and the queue:  node scripts/pm/write-pace.mjs --status',
    `  Exit ${EXIT_WRITE_PACE_REFUSED} is this refusal and nothing else.`,
  ].join('\n');
}

/** Rule ③ — the marker, at the moment it is written. */
export function markerText(signal, key, nowMs) {
  return (
    `write-pace: STOP MARKER written for token key ${key} until ${stampUtc(signal.untilMs)} ` +
    `(${fmtDuration(signal.untilMs - nowMs)}) — ${signal.why}. Every write by this token is refused until then.`
  );
}

// ---------------------------------------------------------------------------
// The log — read, prune and rewrite as ONE act under ONE lock. The whole file
// is rewritten rather than appended to, which is what makes the prune and the
// reservation a single atomic replacement instead of two racing ones.
// ---------------------------------------------------------------------------

export function parseRecords(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row && typeof row === 'object') out.push(row);
    } catch {
      // A torn or hand-edited line is DROPPED, never fatal: a throttle that
      // refuses to run because its own cache is malformed has turned a cache
      // into a prerequisite for writing at all.
    }
  }
  return out;
}

export function serializeRecords(records) {
  return records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
}

function readRecordsFrom(file) {
  try {
    return parseRecords(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function writeRecordsTo(file, records) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, serializeRecords(records), 'utf8');
  renameSync(tmp, file);
}

/**
 * Run `fn` holding an exclusive `mkdir` lock beside the log, and FAIL OPEN.
 *
 * Three ways out, all of them running `fn`: the lock was taken; a lock older
 * than `LOCK_STALE_MS` was broken (its owner is gone); or `LOCK_WAIT_MS`
 * elapsed. The last one degrades the count's precision and never blocks a
 * write — see the header on why that is the right direction.
 */
export function withPaceLock(file, fn, { now = () => Date.now(), sleep = sleepSync } = {}) {
  const lock = `${file}.lock`;
  const deadline = now() + LOCK_WAIT_MS;
  let held = false;

  // Outside the retry, because its failures are not contention. A recursive
  // mkdir over a path that exists and is NOT a directory answers EEXIST — the
  // same code lock contention answers — so leaving it inside made an unusable
  // PATH look like a busy lock and spun. `fn()` below reports it properly.
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch {
    /* fn() will fail with the real reason, and paceWrite refuses on it */
  }

  // ⛔ Bounded by ATTEMPTS as well as by the deadline. A deadline alone is not
  // a bound: it is read from an injected clock, and a clock that does not
  // advance — a test's, a suspended container's — turns `now() >= deadline` into
  // a condition that is never true. Two bounds, so neither can be the only one.
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS && now() < deadline; attempt++) {
    try {
      mkdirSync(lock);
      held = true;
      break;
    } catch (e) {
      if (e?.code !== 'EEXIST') break; // an unusable lock never blocks a write
      let age = null;
      try {
        age = now() - statSync(lock).mtimeMs;
      } catch {
        age = null; // it went away between the mkdir and the stat
      }
      if (age !== null && age > LOCK_STALE_MS) {
        try {
          rmdirSync(lock);
        } catch {
          /* someone else broke it first */
        }
      }
      sleep(LOCK_POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    if (held) {
      try {
        rmdirSync(lock);
      } catch {
        /* already gone */
      }
    }
  }
}

/** A synchronous pause, for the lock poll only. The GAP sleep is async — see `paceWrite`. */
function sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const sleepAsync = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// ---------------------------------------------------------------------------
// Rule ④ — the lease. `mkdir` is the exclusion primitive (the one every host
// here has); a ticket directory beside it is ADVISORY ORDER, exactly as
// `os-verify-lock.sh` layers its queue over `flock`: only the head of the live
// queue contends, dead tickets are pruned on the way past, and a holder record
// names who has it so a waiter can say so. Taking and breaking both happen
// under the decision lock, so two waiters cannot both conclude the holder is
// dead and both take it.
// ---------------------------------------------------------------------------

export function leaseDirFor(file) {
  return `${file}.lease`;
}

export function queueDirFor(file) {
  return `${file}.q`;
}

/** Is there a process behind this pid? EPERM is "yes, not ours"; ESRCH is "no". */
export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

/** The holder record: `<pid> <acquired-ms> <kind…>`. `null` when unreadable. */
export function readHolder(leaseDir) {
  try {
    const [pid, at, ...kind] = readFileSync(join(leaseDir, 'holder'), 'utf8').trim().split(' ');
    const rec = { pid: Number(pid), atMs: Number(at), kind: kind.join(' ') || 'write' };
    return Number.isInteger(rec.pid) && Number.isFinite(rec.atMs) ? rec : null;
  } catch {
    return null;
  }
}

/** A ticket name sorts by arrival, then pid — `queueLive` reads them in that order. */
function ticketName(arrivalMs, pid) {
  return `${String(Math.max(0, Math.floor(arrivalMs))).padStart(15, '0')}-${pid}`;
}

/**
 * Live tickets in arrival order. With `prune` (the default) a ticket whose
 * process is gone or whose age passed `maxAgeMs` is removed on the way past;
 * `--status` reads with `prune: false`, because a read that deletes is not a
 * read.
 */
export function queueLive(qDir, nowMs, maxAgeMs, { prune = true } = {}) {
  let names;
  try {
    names = readdirSync(qDir);
  } catch {
    return [];
  }
  const live = [];
  for (const name of names.sort()) {
    const m = /^(\d+)-(\d+)$/.exec(name);
    if (!m) continue;
    const atMs = Number(m[1]);
    const pid = Number(m[2]);
    const dead = !pidAlive(pid) || nowMs - atMs > maxAgeMs;
    if (dead && prune) {
      try {
        rmSync(join(qDir, name), { force: true });
      } catch {
        /* someone else pruned it first */
      }
      continue;
    }
    live.push({ name, atMs, pid, dead });
  }
  return live;
}

const heldLeases = new Map(); // file -> { leaseDir, atMs, kind, pid }
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const file of [...heldLeases.keys()]) releaseWriteLease(file);
  });
}

/**
 * Take the fleet write lease for `file`'s log.
 *
 * Returns `{ held: true, … }`, or `{ held: false, holder, ahead, waitedMs }`
 * after `waitMs` passed with no turn, or `{ held: false, unusable }` when the
 * path itself cannot carry a lease (the parent is a file, say) — which is not
 * contention and is reported as the log being unwritable. Re-entrant for the
 * process that already holds it.
 */
export function acquireWriteLease(file, deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? sleepSync;
  const log = deps.log ?? ((line) => console.error(line));
  const pid = deps.pid ?? process.pid;
  const kind = deps.kind ?? 'write';
  const waitMs = deps.waitMs ?? DEFAULT_LEASE_WAIT_MS;
  const maxHoldMs = deps.maxHoldMs ?? DEFAULT_LEASE_MAX_HOLD_MS;
  const leaseDir = leaseDirFor(file);
  const qDir = queueDirFor(file);

  if (heldLeases.has(file)) return { held: true, reentered: true, waitedMs: 0, broke: null };

  // An ancestor that took the lease for this command (`--run`) named itself in
  // the environment: its turn is this process's turn.
  const inheritFrom = Number(deps.inheritFrom ?? (deps.env ?? process.env)[LEASE_HOLDER_ENV]);
  if (Number.isInteger(inheritFrom) && inheritFrom > 0 && existsSync(leaseDir)) {
    const holder = readHolder(leaseDir);
    if (holder && holder.pid === inheritFrom && pidAlive(inheritFrom)) return { held: true, inherited: true, reentered: false, waitedMs: 0, broke: null };
  }

  try {
    mkdirSync(qDir, { recursive: true });
  } catch {
    /* an unusable queue costs FIFO, never exclusion — the lease dir still decides */
  }
  const arrivalMs = now();
  const ticket = join(qDir, ticketName(arrivalMs, pid));
  try {
    writeFileSync(ticket, `${pid} ${arrivalMs} ${kind}\n`, 'utf8');
  } catch {
    /* same: contend without a place in line */
  }
  const dropTicket = () => {
    try {
      rmSync(ticket, { force: true });
    } catch {
      /* already gone */
    }
  };

  const deadline = arrivalMs + waitMs;
  let announced = false;
  let broke = null;
  for (let attempt = 0; attempt < LEASE_MAX_ATTEMPTS && now() <= deadline; attempt++) {
    const nowMs = now();
    const live = queueLive(qDir, nowMs, waitMs + 60_000);
    const head = live[0];
    if (!head || head.pid === pid) {
      let got;
      try {
        got = withPaceLock(
          file,
          () => {
            if (existsSync(leaseDir)) {
              const holder = readHolder(leaseDir);
              if (holder && holder.pid === pid) return 'mine';
              const stale = !holder || !pidAlive(holder.pid) || nowMs - holder.atMs > maxHoldMs;
              if (!stale) return null;
              rmSync(leaseDir, { recursive: true, force: true });
              broke = holder ?? { pid: 0, atMs: nowMs, kind: '?' };
              log(leaseBrokenText({ holder, nowMs, maxHoldMs, pid }));
            }
            try {
              mkdirSync(leaseDir);
            } catch (e) {
              if (e?.code === 'EEXIST') return null; // taken between the check and the mkdir — wait
              throw e; // not contention: the path cannot carry a lease at all
            }
            writeFileSync(join(leaseDir, 'holder'), `${pid} ${nowMs} ${kind}\n`, 'utf8');
            return 'taken';
          },
          { now, sleep },
        );
      } catch (e) {
        dropTicket();
        return { held: false, unusable: e, holder: null, ahead: 0, waitedMs: now() - arrivalMs, broke };
      }
      if (got) {
        dropTicket();
        heldLeases.set(file, { leaseDir, atMs: nowMs, kind, pid });
        installExitHook();
        return { held: true, reentered: false, waitedMs: nowMs - arrivalMs, broke };
      }
    }
    if (!announced && nowMs - arrivalMs >= LEASE_ANNOUNCE_AFTER_MS) {
      announced = true;
      const idx = live.findIndex((t) => t.pid === pid);
      log(leaseWaitingText({ holder: readHolder(leaseDir), ahead: idx === -1 ? live.length : idx, waitedMs: nowMs - arrivalMs, nowMs }));
    }
    sleep(LEASE_POLL_MS);
  }
  dropTicket();
  const nowMs = now();
  const live = queueLive(qDir, nowMs, waitMs + 60_000);
  const idx = live.findIndex((t) => t.pid === pid);
  return { held: false, holder: readHolder(leaseDir), ahead: idx === -1 ? live.length : idx, waitedMs: nowMs - arrivalMs, broke };
}

/**
 * Release the lease this process holds on `file`'s log — idempotent, and it
 * never removes another holder's. A transport whose request THREW (no response
 * will come, so `noteResponse` will not be called) calls this on its way out.
 */
export function releaseWriteLease(file = paceFilePath()) {
  const mine = heldLeases.get(file);
  if (!mine) return false;
  heldLeases.delete(file);
  const holder = readHolder(mine.leaseDir);
  if (holder && holder.pid !== mine.pid) return false; // broken and re-taken while we held it: not ours to remove
  try {
    rmSync(mine.leaseDir, { recursive: true, force: true });
  } catch {
    /* already gone */
  }
  return true;
}

/** Who holds the lease on `file`'s log right now, and who waits. A READ: prunes nothing. */
export function leaseStatus(file, nowMs = Date.now(), waitMs = DEFAULT_LEASE_WAIT_MS) {
  const leaseDir = leaseDirFor(file);
  const held = existsSync(leaseDir);
  const holder = held ? readHolder(leaseDir) : null;
  const queue = queueLive(queueDirFor(file), nowMs, waitMs + 60_000, { prune: false });
  return { held, holder, holderAlive: holder ? pidAlive(holder.pid) : false, queue };
}

/**
 * Rule ⑤ — announce a batch of `count` writes by `token`. At or above the
 * threshold it records the batch in the shared log (every process sees it) and
 * prints the count and the estimate; below it, one line and nothing recorded.
 * A new announcement for the same identity REPLACES its unspent batch.
 */
export function announceBatch({ token, count, kind = 'write' } = {}, deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((line) => console.error(line));
  const env = deps.env ?? process.env;
  const file = deps.file ?? paceFilePath(env, deps.home ?? homedir());
  const { batchThreshold, batchGapMs, notes } = limitsFrom(env);
  for (const note of notes) log(`write-pace: ${note}`);

  const n = Number(count);
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`announceBatch: count must be a positive integer, got ${JSON.stringify(count)}`);
  const key = tokenKey(token);
  const nowMs = now();
  if (n < batchThreshold) {
    log(batchBelowThresholdText({ n, threshold: batchThreshold }));
    return { batched: false, n, threshold: batchThreshold, gapMs: null, estimateMs: 0, key, file };
  }
  const estimateMs = n * batchGapMs;
  const record = { batch: nowMs + Math.max(WINDOW_MS, estimateMs * 3), k: key, gap: batchGapMs, n, left: n, at: nowMs, kind };
  withPaceLock(
    file,
    () => {
      const kept = pruneRecords(readRecordsFrom(file), nowMs).filter((r) => !(r.k === key && Number.isFinite(Number(r.batch))));
      kept.push(record);
      writeRecordsTo(file, kept);
    },
    { now, sleep: deps.sleepSync ?? sleepSync },
  );
  log(batchText({ n, gapMs: batchGapMs, threshold: batchThreshold, key, kind, estimateMs }));
  return { batched: true, n, threshold: batchThreshold, gapMs: batchGapMs, estimateMs, key, file, expiresAtMs: record.batch };
}

// ---------------------------------------------------------------------------
// The two halves every write path calls.
// ---------------------------------------------------------------------------

/**
 * Called immediately BEFORE a write request leaves. Reserves this write's slot,
 * sleeps rule ①'s remainder, or refuses.
 *
 * @param {{token?: string, kind?: string}} args  `kind` is a short, stable label
 *        for the log and `--status` — `post-stamped POST`, `label-write DELETE`.
 * @param {object} deps  `now`, `sleep`, `exit`, `log`, `env`, `home` — injected
 *        by `--self-test`, defaulted here for every real caller.
 */
export async function paceWrite({ token, kind = 'write' } = {}, deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? sleepAsync;
  const exit = deps.exit ?? ((code) => process.exit(code));
  const log = deps.log ?? ((line) => console.error(line));
  const env = deps.env ?? process.env;
  const file = deps.file ?? paceFilePath(env, deps.home ?? homedir());

  const { minGapMs, hourlyMax, leaseMaxHoldMs, leaseWaitMs, notes } = limitsFrom(env);
  for (const note of notes) log(`write-pace: ${note}`);

  const key = tokenKey(token);

  // Rule ④ first: nothing below is decided until this process holds the
  // fleet's one turn, and the turn is kept through the gap sleep and the
  // request — `noteResponse` gives it back. `deps.lease === false` is for the
  // injected-clock cases that drive the arithmetic alone.
  if (deps.lease !== false) {
    const turn = acquireWriteLease(file, {
      kind,
      now,
      sleep: deps.sleepSync ?? sleepSync,
      log,
      waitMs: leaseWaitMs,
      maxHoldMs: leaseMaxHoldMs,
      pid: deps.pid,
    });
    if (!turn.held && turn.unusable) {
      log(unrecordableText(file, turn.unusable));
      exit(EXIT_WRITE_PACE_REFUSED);
      return { verdict: 'unrecordable', key, refused: true, exitCode: EXIT_WRITE_PACE_REFUSED, file, error: turn.unusable?.message ?? String(turn.unusable) };
    }
    if (!turn.held) {
      log(leaseRefusedText({ ...turn, waitMs: leaseWaitMs, nowMs: now(), kind }));
      exit(EXIT_WRITE_PACE_REFUSED);
      return { verdict: 'no-lease', key, refused: true, exitCode: EXIT_WRITE_PACE_REFUSED, file, holder: turn.holder ?? null, waitedMs: turn.waitedMs };
    }
  }

  const nowMs = now();
  let decision;

  try {
    withPaceLock(
      file,
      () => {
        const kept = pruneRecords(readRecordsFrom(file), nowMs);
        decision = decidePace({ records: kept, key, nowMs, minGapMs, hourlyMax });
        if (decision.verdict === 'ok') {
          kept.push({ t: decision.issueAtMs, k: key, kind });
          if (decision.batch) {
            const spent = activeBatch(kept, key, nowMs);
            if (spent) spent.left = Number(spent.left) - 1;
          }
        }
        writeRecordsTo(file, kept);
      },
      { now, sleep: deps.sleepSync ?? sleepSync },
    );
  } catch (e) {
    releaseWriteLease(file);
    log(unrecordableText(file, e));
    exit(EXIT_WRITE_PACE_REFUSED);
    return { verdict: 'unrecordable', key, refused: true, exitCode: EXIT_WRITE_PACE_REFUSED, file, error: e?.message ?? String(e) };
  }

  if (decision.verdict === 'stopped') {
    releaseWriteLease(file);
    log(stoppedText(decision));
    exit(EXIT_WRITE_PACE_REFUSED);
    return { ...decision, refused: true, exitCode: EXIT_WRITE_PACE_REFUSED, file };
  }
  if (decision.verdict === 'exhausted') {
    releaseWriteLease(file);
    log(exhaustedText(decision));
    exit(EXIT_WRITE_PACE_REFUSED);
    return { ...decision, refused: true, exitCode: EXIT_WRITE_PACE_REFUSED, file };
  }
  if (decision.sleepMs > 0) {
    log(gapText(decision, kind));
    await sleep(decision.sleepMs);
  }
  return { ...decision, refused: false, slept: decision.sleepMs, file, leased: deps.lease !== false };
}

/**
 * Called immediately AFTER a write response is in hand — including a failing
 * one, and including one the caller is about to throw on. Writes a stop marker
 * when the response carries a back-off signal, and does nothing otherwise.
 *
 * Synchronous: it must be safe to call on the error path of a transport that is
 * one line from throwing.
 */
export function noteResponse({ token, status, headers, body, verdict } = {}, deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((line) => console.error(line));
  const env = deps.env ?? process.env;
  const file = deps.file ?? paceFilePath(env, deps.home ?? homedir());

  const nowMs = now();
  const signal = stopSignalFrom({ status, headers, body, verdict }, nowMs);
  if (!signal) {
    releaseWriteLease(file); // rule ④: the response is in hand, the turn is over
    return null;
  }

  const key = tokenKey(token);
  try {
    withPaceLock(
      file,
      () => {
        const kept = pruneRecords(readRecordsFrom(file), nowMs);
        kept.push({ stop: signal.untilMs, k: key, why: signal.why, at: nowMs });
        writeRecordsTo(file, kept);
      },
      { now, sleep: deps.sleepSync ?? sleepSync },
    );
  } catch (e) {
    releaseWriteLease(file);
    // ⛔ This half NEVER throws, and that is not the same judgement as
    // `paceWrite`'s. It is called on a transport's error path, one line before
    // the caller throws the platform's own refusal — an exception raised here
    // would REPLACE that error and hide what the platform said. So it reports
    // the consequence instead, in the one line it has, and lets the real error
    // travel.
    log(
      `write-pace: ⚠ could not record the stop marker in ${file} (${e?.message ?? String(e)}). ` +
        `${signal.why}, so this identity has been asked to back off until ${stampUtc(signal.untilMs)} — but the ` +
        'NEXT write by this token will NOT be refused, because nothing is on disk to refuse it. Stop writing by ' +
        'hand until then, and fix the path or point `OS_PM_WRITE_PACE_FILE` somewhere writable.',
    );
    return { ...signal, key, file, recorded: false };
  }
  log(markerText(signal, key, nowMs));
  releaseWriteLease(file); // after the marker is on disk, so the next holder reads it
  return { ...signal, key, file, recorded: true };
}

/** `--status`: this token's budget and any active marker, without writing anything. */
export function statusReport({ token } = {}, deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const env = deps.env ?? process.env;
  const file = deps.file ?? paceFilePath(env, deps.home ?? homedir());
  const { minGapMs, hourlyMax, leaseWaitMs, notes } = limitsFrom(env);

  const nowMs = now();
  const key = tokenKey(token);
  const kept = pruneRecords(readRecordsFrom(file), nowMs);
  const d = decidePace({ records: kept, key, nowMs, minGapMs, hourlyMax });
  const lease = leaseStatus(file, nowMs, leaseWaitMs);

  const byKind = new Map();
  for (const r of kept) {
    if (r.k !== key || !Number.isFinite(Number(r.t))) continue;
    byKind.set(r.kind ?? 'write', (byKind.get(r.kind ?? 'write') ?? 0) + 1);
  }
  const recent = [...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${k}`);

  const lines = [
    `write-pace --status @ ${stampUtc(nowMs)}`,
    `  file      : ${file}${existsSync(file) ? '' : ' (does not exist yet — no write has been paced on this machine)'}`,
    `  token key : ${key}  (sha256 prefix; ⛔ the token itself is never written to the file)`,
    `  budget    : ${d.count} of ${hourlyMax} write(s) in the trailing hour · ${Math.max(0, hourlyMax - d.count)} left`,
    `  gap       : ${minGapMs}ms minimum · ` +
      (d.lastAtMs
        ? `last write ${stampUtc(d.lastAtMs)} (${fmtDuration(nowMs - d.lastAtMs)} ago) — the next would pause ${fmtDuration(Math.max(0, d.lastAtMs + minGapMs - nowMs))}`
        : 'no write by this token in the window — the next would not pause'),
    `  marker    : ${d.verdict === 'stopped' ? `ACTIVE until ${stampUtc(d.resumeAtMs)} (${fmtDuration(d.resumeAtMs - nowMs)}) — ${d.why}` : 'none active'}`,
    `  batch     : ${d.batch ? `active — ${d.batch.left} of ${d.batch.n} ${d.batch.kind} left, gap ${fmtDuration(d.batch.gapMs)}` : 'none'}`,
    `  lease     : ${
      !lease.held
        ? 'free'
        : lease.holder
          ? `held by pid ${lease.holder.pid} (${lease.holder.kind}) for ${fmtDuration(nowMs - lease.holder.atMs)}${lease.holderAlive ? '' : ' — ⚠ that process is GONE; the next waiter breaks it'}`
          : 'held, holder record unreadable — the next waiter breaks it'
    }`,
    `  queue     : ${lease.queue.length ? `${lease.queue.length} waiting (${lease.queue.map((q) => `pid ${q.pid}${q.dead ? ' †' : ''}`).join(', ')})` : 'empty'}`,
    `  verdict   : ${d.verdict === 'ok' ? 'the next write may go' : d.verdict === 'exhausted' ? `the next write is REFUSED until ${stampUtc(d.resumeAtMs)}` : `every write is REFUSED until ${stampUtc(d.resumeAtMs)}`}`,
  ];
  if (recent.length) lines.push(`  in window : ${recent.join(' · ')}`);
  for (const note of notes) lines.push(`  ⚠ ${note}`);
  lines.push('  ⛔ This is a READ. It spends no budget, writes no record, and always exits 0.');
  return { text: lines.join('\n'), decision: d, key, file, count: d.count };
}

// ---------------------------------------------------------------------------
// Self-test — offline, with an INJECTED CLOCK and an injected sleep. Nothing
// here waits three real seconds, and nothing here touches the real cache file:
// every file-backed case runs against its own temp directory.
//
// The battery roster below is the floor. ⛔ A pinned TOTAL is not the repair —
// a battery falling from 9 cases to 3 keeps a total "right" the moment a
// sibling grows, and the set difference is what names WHICH battery stopped.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the token key: enough to separate identities, useless as a credential': 6,
  'the write-verb predicate: a read is never paced': 5,
  'the limits: overrides are for tests, and a malformed one never loosens': 10,
  'rule ①: the remainder is slept, and the pause is said out loud': 7,
  'rule ②: the 41st is REFUSED, with a prescription': 8,
  'rule ③: what writes a stop marker, how long it lasts, what it refuses': 10,
  'the prune: the trailing hour for writes, the expiry for markers': 8,
  'the log, --status and the CLI: what lands on disk, and what must never': 14,
  'rule ④: the lease — one write in flight, fleet-wide, measured on real processes': 12,
  'rule ⑤: batch mode — the gap rises for an announced batch, and the estimate is printed': 9,
  "--run: the shell door — gated by default, ungated with --read, the command's own exit code": 10,
  'the wiring: both halves, in every write transport, on write verbs only': 7,
});
const SELF_TEST_BATTERY_FLOOR = 12;
const UNATTRIBUTED_BATTERY = '(unattributed)';

const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};

// Set as `selfTest()`'s LAST statement, after the success line prints, and read
// at the dispatch: a `return` above the verdict prints nothing and exits 0 —
// a self-test that never finished, reported as one that passed. ⛔ An exit code
// is not a handshake.
let selfTestReachedVerdict = false;

/**
 * The write transports this throttle is wired into — the census. Nine: the
 * five board tools, the token minter (its one POST creates no content, but a
 * write verb is a write verb and the roster below is mechanical), the
 * card-creation door, and the two halves of the fleet-write relay — the
 * seat-side dispatcher (its one POST is the `repository_dispatch` that
 * carries a stroke) and the runner-side executor (the writes that stroke asked
 * for, paced on the runner's own log).
 */
export const WIRED_WRITE_TOOLS = Object.freeze([
  'post-stamped.mjs',
  'label-write.mjs',
  'close-cards.mjs',
  'sweep-closed-cards.mjs',
  'sweep-stale-finding.mjs',
  'fleet-token.mjs',
  'issue-create.mjs',
  'fleet-write/dispatch.mjs',
  'fleet-write/execute.mjs',
]);

/**
 * Files under `scripts/pm` whose CODE issues a write verb.
 *
 * Two exclusions, and neither is a taste call:
 *
 *   - **comments are masked first**, through the shared `js-comment-mask`
 *     rather than a private `stripComments`, because a header that NAMES a
 *     write verb is not a file that issues one — this file's own header is the
 *     first specimen;
 *   - **a line carrying `/method:` is skipped**: three gates in this directory
 *     pin their own report-only-ness by testing their source against a REGEX
 *     LITERAL spelling this very pattern, and reading those as write sites
 *     would demand a throttle on a file that cannot write at all. A real write
 *     site spells the object key, never the regex delimiter before it.
 */
export function writeVerbFiles(dir, names, read, mask = (s) => s) {
  const found = [];
  for (const name of names) {
    let source = '';
    try {
      source = mask(read(join(dir, name)));
    } catch {
      continue;
    }
    const hit = source
      .split('\n')
      .some((line) => !line.includes('/method:') && /method:\s*'(?:POST|PATCH|PUT|DELETE)'/.test(line));
    if (hit) found.push(name);
  }
  return found.sort();
}

export async function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true, detail) => {
    const bucket = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(bucket, (batteryCases.get(bucket) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `${detail ? `${detail} — ` : ''}got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };

  const SELF = fileURLToPath(import.meta.url);
  const PM_DIR = dirname(SELF);
  const T0 = Date.UTC(2026, 8, 21, 10, 0, 0);
  const TOKEN = 'ghp_thisIsNotARealTokenItIsAFixture000000';

  // A harness that drives `paceWrite` with a clock the case moves by hand.
  const harness = (file, opts = {}) => {
    const state = { ms: opts.start ?? T0, slept: [], out: [], exits: [] };
    const deps = {
      file,
      env: opts.env ?? {},
      now: () => state.ms,
      sleep: async (ms) => {
        state.slept.push(ms);
        state.ms += ms;
      },
      sleepSync: () => {},
      exit: (code) => state.exits.push(code),
      log: (line) => state.out.push(line),
    };
    return { state, deps, text: () => state.out.join('\n') };
  };

  // ── the token key ─────────────────────────────────────────────────────────
  battery('the token key: enough to separate identities, useless as a credential');
  t('the key is a 12-hex sha256 prefix', /^[0-9a-f]{12}$/.test(tokenKey(TOKEN)));
  t('…and it is deterministic', tokenKey(TOKEN), tokenKey(TOKEN));
  t('two tokens are two budgets', tokenKey(TOKEN) === tokenKey(`${TOKEN}x`), false);
  t('⛔ the key is not the token, nor a prefix of it', TOKEN.includes(tokenKey(TOKEN)), false);
  t('an absent token still keys, so a token-less write path is still paced', tokenKey(''), 'no-token');
  t('…and undefined keys the same way rather than throwing', tokenKey(undefined), 'no-token');

  // ── the write-verb predicate ──────────────────────────────────────────────
  battery('the write-verb predicate: a read is never paced');
  t('the four write verbs spend budget', WRITE_METHODS.map(isWriteMethod), [true, true, true, true]);
  t('a GET does not', isWriteMethod('GET'), false);
  t('…nor a HEAD', isWriteMethod('HEAD'), false);
  t('an omitted method is a GET, not a write', isWriteMethod(undefined), false);
  t('case is not a way to dodge the throttle', isWriteMethod('post'), true);

  // ── the limits ────────────────────────────────────────────────────────────
  battery('the limits: overrides are for tests, and a malformed one never loosens');
  t('the defaults are the contract', [limitsFrom({}).minGapMs, limitsFrom({}).hourlyMax], [DEFAULT_MIN_GAP_MS, DEFAULT_HOURLY_MAX]);
  t('both overrides are honoured', [limitsFrom({ OS_PM_WRITE_MIN_GAP_MS: '5', OS_PM_WRITE_HOURLY_MAX: '2' }).minGapMs, limitsFrom({ OS_PM_WRITE_MIN_GAP_MS: '5', OS_PM_WRITE_HOURLY_MAX: '2' }).hourlyMax], [5, 2]);
  t('⛔ a malformed override falls back to the DEFAULT, never to unlimited', limitsFrom({ OS_PM_WRITE_HOURLY_MAX: '4O' }).hourlyMax, DEFAULT_HOURLY_MAX);
  t('…and says so, so a loosened budget is never silent', limitsFrom({ OS_PM_WRITE_HOURLY_MAX: '4O' }).notes.length, 1);
  t('a negative override is malformed too', limitsFrom({ OS_PM_WRITE_MIN_GAP_MS: '-1' }).minGapMs, DEFAULT_MIN_GAP_MS);
  t('zero is a real value, not a malformed one', limitsFrom({ OS_PM_WRITE_MIN_GAP_MS: '0' }).minGapMs, 0);
  t('rules ④ and ⑤ have defaults too', [limitsFrom({}).batchThreshold, limitsFrom({}).batchGapMs, limitsFrom({}).leaseMaxHoldMs, limitsFrom({}).leaseWaitMs], [DEFAULT_BATCH_THRESHOLD, DEFAULT_BATCH_GAP_MS, DEFAULT_LEASE_MAX_HOLD_MS, DEFAULT_LEASE_WAIT_MS]);
  t('…and their overrides are honoured', [limitsFrom({ OS_PM_WRITE_BATCH_THRESHOLD: '2', OS_PM_WRITE_BATCH_GAP_MS: '400' }).batchThreshold, limitsFrom({ OS_PM_WRITE_BATCH_THRESHOLD: '2', OS_PM_WRITE_BATCH_GAP_MS: '400' }).batchGapMs], [2, 400]);
  t('…under the same malformed rule: the default, never unlimited', limitsFrom({ OS_PM_WRITE_LEASE_WAIT_MS: 'soon' }).leaseWaitMs, DEFAULT_LEASE_WAIT_MS);
  t('the batch gap default sits inside the 30–60 s band the platform reading asks for', DEFAULT_BATCH_GAP_MS >= 30_000 && DEFAULT_BATCH_GAP_MS <= 60_000);

  const dir = mkdtempSync(join(tmpdir(), 'write-pace-'));
  try {
    // ── rule ① ──────────────────────────────────────────────────────────────
    battery('rule ①: the remainder is slept, and the pause is said out loud');
    {
      const file = join(dir, 'gap.jsonl');
      const h = harness(file);
      const first = await paceWrite({ token: TOKEN, kind: 'post-stamped POST' }, h.deps);
      t('the first write by a token does not pause', first.sleepMs, 0);
      t('…and it reserves its slot', h.state.slept, []);
      h.state.ms += 1000;
      const second = await paceWrite({ token: TOKEN, kind: 'post-stamped POST' }, h.deps);
      t('a write 1s later sleeps the REMAINDER, not the whole gap', second.sleepMs, DEFAULT_MIN_GAP_MS - 1000);
      t('…and really slept it', h.state.slept, [DEFAULT_MIN_GAP_MS - 1000]);
      t('…and said so in one line', h.text().includes('write-pace: pausing 2s before post-stamped POST'));
      h.state.ms += DEFAULT_MIN_GAP_MS;
      const third = await paceWrite({ token: TOKEN, kind: 'post-stamped POST' }, h.deps);
      t('a write after the gap has passed does not pause', third.sleepMs, 0);
      const other = await paceWrite({ token: 'a-different-token', kind: 'label-write POST' }, h.deps);
      t('⛔ the gap is PER TOKEN — another identity is not held behind it', other.sleepMs, 0);
    }

    // ── rule ② ──────────────────────────────────────────────────────────────
    battery('rule ②: the 41st is REFUSED, with a prescription');
    {
      const file = join(dir, 'budget.jsonl');
      const env = { OS_PM_WRITE_MIN_GAP_MS: '0' };
      const h = harness(file, { env });
      for (let i = 0; i < DEFAULT_HOURLY_MAX; i++) {
        await paceWrite({ token: TOKEN, kind: 'label-write POST' }, h.deps);
        h.state.ms += 1000;
      }
      t('forty writes in the window are allowed', h.state.exits, []);
      const refused = await paceWrite({ token: TOKEN, kind: 'label-write POST' }, h.deps);
      t('the 41st is refused', refused.verdict, 'exhausted');
      t('…with the distinct exit code, ⛔ not the host tool\'s', h.state.exits, [EXIT_WRITE_PACE_REFUSED]);
      t('…and it did NOT sleep instead', h.state.slept.length, 0);
      const said = h.text();
      t('the prescription names the count', said.includes(`${DEFAULT_HOURLY_MAX} write(s) by this token in the trailing hour`));
      t('…when the window reopens', /window reopens at 2026-09-21T1\d:\d\dZ/.test(said));
      t('…and what to fold into fewer writes', said.includes('Fold the batch into fewer writes'));
      const parsed = parseRecords(readFileSync(file, 'utf8'));
      t('⛔ a refused write reserves NOTHING', parsed.filter((r) => r.k === tokenKey(TOKEN)).length, DEFAULT_HOURLY_MAX);
    }

    // ── rule ③ ──────────────────────────────────────────────────────────────
    battery('rule ③: what writes a stop marker, how long it lasts, what it refuses');
    {
      t('a 429 writes a marker', stopSignalFrom({ status: 429 }, T0).untilMs, T0 + STOP_MARKER_MS);
      t('a 403 whose body names the secondary limit writes one', stopSignalFrom({ status: 403, body: { message: 'You have exceeded a secondary rate limit' } }, T0) !== null);
      t('⛔ a plain 403 does NOT — that is about the credential, and waiting fixes nothing', stopSignalFrom({ status: 403, body: { message: 'Bad credentials' } }, T0), null);
      t('x-ratelimit-remaining 0 writes one on ANY status, including the 200 that spent the last unit', stopSignalFrom({ status: 200, headers: { 'x-ratelimit-remaining': '0' } }, T0) !== null);
      t('a 200 with quota left writes none', stopSignalFrom({ status: 200, headers: { 'x-ratelimit-remaining': '4321' } }, T0), null);
      t('`classifyHttp`\'s own ratelimit verdict is accepted as an input, not re-derived', stopSignalFrom({ status: 403, verdict: 'ratelimit' }, T0) !== null);
      t('a retry-after LONGER than 30 min wins; a shorter one does not shorten the marker', [
        stopSignalFrom({ status: 429, headers: { 'retry-after': '5400' } }, T0).untilMs - T0,
        stopSignalFrom({ status: 429, headers: { 'retry-after': '60' } }, T0).untilMs - T0,
      ], [5400_000, STOP_MARKER_MS]);

      const file = join(dir, 'marker.jsonl');
      const h = harness(file, { env: { OS_PM_WRITE_MIN_GAP_MS: '0' } });
      await paceWrite({ token: TOKEN, kind: 'sweep-closed-cards DELETE' }, h.deps);
      const noted = noteResponse({ token: TOKEN, status: 429, headers: { 'retry-after': '60' } }, h.deps);
      t('the marker lands with its reason', noted.why.includes('HTTP 429'));
      h.state.ms += 60_000;
      const blocked = await paceWrite({ token: TOKEN, kind: 'sweep-closed-cards DELETE' }, h.deps);
      t('…and every write by that token is refused while it is live, with the expiry printed', [blocked.verdict, h.text().includes(`until ${stampUtc(noted.untilMs)}`)], ['stopped', true]);
      h.state.ms += STOP_MARKER_MS;
      const after = await paceWrite({ token: TOKEN, kind: 'sweep-closed-cards DELETE' }, h.deps);
      t('…and allowed again once it expires', after.verdict, 'ok');
    }

    // ── the prune ───────────────────────────────────────────────────────────
    battery('the prune: the trailing hour for writes, the expiry for markers');
    {
      const now = T0;
      const records = [
        { t: now - WINDOW_MS - 1, k: 'aaa', kind: 'old' },
        { t: now - 1000, k: 'aaa', kind: 'fresh' },
        { stop: now - 1, k: 'aaa', why: 'expired' },
        { stop: now + 90 * 60 * 1000, k: 'aaa', why: 'a two-hour retry-after' },
        'not an object',
      ];
      const kept = pruneRecords(records, now);
      t('a write older than the window is dropped', kept.some((r) => r.kind === 'old'), false);
      t('a write inside it is kept', kept.some((r) => r.kind === 'fresh'));
      t('an EXPIRED marker is dropped', kept.some((r) => r.why === 'expired'), false);
      t('⛔ an unexpired marker survives the hour it outlives — by its expiry, never by age', kept.some((r) => r.why === 'a two-hour retry-after'));
      t('a torn line is dropped rather than fatal', kept.length, 2);
      t('a spent batch (no writes left) is dropped whatever its expiry says', pruneRecords([{ batch: now + 1000, k: 'aaa', gap: 30_000, n: 5, left: 0, at: now - 1 }], now).length, 0);
      t('…and an unspent, unexpired one survives', pruneRecords([{ batch: now + 1000, k: 'aaa', gap: 30_000, n: 5, left: 3, at: now - 1 }], now).length, 1);

      const file = join(dir, 'prune.jsonl');
      writeFileSync(file, `${records.slice(0, 4).map((r) => JSON.stringify(r)).join('\n')}\n{ not json\n`, 'utf8');
      const h = harness(file, { env: { OS_PM_WRITE_MIN_GAP_MS: '0' } });
      await paceWrite({ token: TOKEN, kind: 'label-write POST' }, h.deps);
      t('…and the file on disk is rewritten pruned on every pass', parseRecords(readFileSync(file, 'utf8')).length, 3);
    }

    // ── the log, --status and the CLI ───────────────────────────────────────
    battery('the log, --status and the CLI: what lands on disk, and what must never');
    {
      const file = join(dir, 'status.jsonl');
      const h = harness(file, { env: { OS_PM_WRITE_MIN_GAP_MS: '0' } });
      await paceWrite({ token: TOKEN, kind: 'post-stamped POST' }, h.deps);
      h.state.ms += 1000;
      await paceWrite({ token: TOKEN, kind: 'label-write DELETE' }, h.deps);
      const onDisk = readFileSync(file, 'utf8');
      t('⛔ THE case: the token never appears in the file, in any field', onDisk.includes(TOKEN), false);
      t('…and the key does', onDisk.includes(tokenKey(TOKEN)));
      t('one line per write', parseRecords(onDisk).length, 2);

      const report = statusReport({ token: TOKEN }, h.deps);
      t('--status counts the trailing hour', report.text.includes(`budget    : 2 of ${DEFAULT_HOURLY_MAX}`));
      t('…names the marker state', report.text.includes('marker    : none active'));
      t('…and ⛔ never prints the token', report.text.includes(TOKEN), false);
      t('…and spends no budget: it is a read', statusReport({ token: TOKEN }, h.deps).count, 2);

      const spawned = spawnSync(process.execPath, [SELF, '--status'], {
        encoding: 'utf8',
        env: { ...process.env, OS_PM_WRITE_PACE_FILE: join(dir, 'cli.jsonl'), GITHUB_TOKEN: TOKEN, GH_TOKEN: '' },
      });
      t('the CLI reports a budget nobody has spent yet, at exit 0', spawned.status === 0 && spawned.stdout.includes(`budget    : 0 of ${DEFAULT_HOURLY_MAX}`), true, JSON.stringify(spawned.stdout));
      t('an unrecognised flag is usage, ⛔ never a silent pass', spawnSync(process.execPath, [SELF, '--paec'], { encoding: 'utf8' }).status, EXIT_USAGE);

      // An unwritable log: the parent of the path is a FILE, so every mkdir on
      // the way to it fails. The two halves answer this DIFFERENTLY on purpose.
      const blocker = join(dir, 'not-a-directory');
      writeFileSync(blocker, 'x', 'utf8');
      const bad = harness(join(blocker, 'pace.jsonl'));
      const unrecordable = await paceWrite({ token: TOKEN, kind: 'label-write POST' }, bad.deps);
      t('⛔ a log it cannot write REFUSES the write — unrecorded is the state this exists to prevent', [unrecordable.verdict, bad.state.exits], ['unrecordable', [EXIT_WRITE_PACE_REFUSED]]);
      t('…naming the path and the one-line remedy', bad.text().includes('OS_PM_WRITE_PACE_FILE'));
      const noted = noteResponse({ token: TOKEN, status: 429 }, bad.deps);
      t('⛔ but `noteResponse` does NOT throw — it runs one line before the caller throws the platform\'s own error', [noted.recorded, noted.why], [false, 'HTTP 429']);

      // ⛔ THE case the attempt bound exists for, found by the case above: a
      // lock somebody else holds, plus a clock that does not advance. The
      // deadline can then never fire, so only the attempt bound ends the wait.
      const heldFile = join(dir, 'held.jsonl');
      mkdirSync(`${heldFile}.lock`, { recursive: true });
      let ran = false;
      withPaceLock(heldFile, () => { ran = true; }, { now: () => T0, sleep: () => {} });
      t('⛔ a held lock under a FROZEN clock still returns — the attempt bound, never the deadline, ends it', ran);
      t('…and the lock it could not take is left alone, ⛔ never stolen', existsSync(`${heldFile}.lock`));
    }

    // ── real processes, real clocks ─────────────────────────────────────────
    // Rules ④ and ⑤ are claims about SEPARATE processes, so they are measured
    // on separate processes: children of this file's own CLI, each recording
    // when it actually ran to a file only it writes. Nothing below reads the
    // code to decide; it reads the timestamps.
    const CHILD_MARK =
      'const fs=require("node:fs");const f=process.env.OS_PM_WRITE_SELFTEST_OUT;' +
      'fs.appendFileSync(f,`${process.pid} start ${Date.now()}\\n`);' +
      'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Number(process.env.OS_PM_WRITE_SELFTEST_RUN_MS||120));' +
      'fs.appendFileSync(f,`${process.pid} end ${Date.now()}\\n`);';
    const runChild = (args, extraEnv = {}) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [SELF, ...args], { env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => {
          out += d;
        });
        child.stderr.on('data', (d) => {
          err += d;
        });
        child.on('close', (code) => resolve({ code, out, err }));
      });
    const readMarks = (f) => {
      const byPid = new Map();
      for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
        const [pid, what, ms] = line.split(' ');
        const rec = byPid.get(pid) ?? {};
        rec[what] = Number(ms);
        byPid.set(pid, rec);
      }
      return [...byPid.values()].filter((r) => r.start && r.end).sort((a, b) => a.start - b.start);
    };
    const issuedStamps = (file) =>
      parseRecords(readFileSync(file, 'utf8'))
        .filter((r) => Number.isFinite(Number(r.t)))
        .map((r) => Number(r.t))
        .sort((a, b) => a - b);

    // ── rule ④ ──────────────────────────────────────────────────────────────
    battery('rule ④: the lease — one write in flight, fleet-wide, measured on real processes');
    {
      const file = join(dir, 'lease.jsonl');
      const marks = join(dir, 'lease-marks.txt');
      writeFileSync(marks, '', 'utf8');
      const env = { OS_PM_WRITE_PACE_FILE: file, OS_PM_WRITE_MIN_GAP_MS: '250', OS_PM_WRITE_SELFTEST_OUT: marks, OS_PM_WRITE_SELFTEST_RUN_MS: '120', GITHUB_TOKEN: TOKEN, GH_TOKEN: '' };
      const N = 4;
      const results = await Promise.all(Array.from({ length: N }, () => runChild(['--run', '--kind', 'lease-case', '--', process.execPath, '-e', CHILD_MARK], env)));
      t('every gated child ran and exited 0', results.map((r) => r.code), Array(N).fill(0), results.map((r) => r.err.slice(-300)).join(' | '));
      const runs = readMarks(marks);
      t(`all ${N} children recorded a start and an end`, runs.length, N);
      const overlaps = runs.filter((r, i) => i > 0 && r.start < runs[i - 1].end).length;
      t('⛔ THE case: no two gated commands were in flight at once — each started after the previous one ENDED', overlaps, 0, JSON.stringify(runs));
      const stamps = issuedStamps(file);
      const gaps = stamps.slice(1).map((v, i) => v - stamps[i]);
      t("…and consecutive reservations are at least the minimum gap apart, by the log's own stamps", gaps.length === N - 1 && gaps.every((g) => g >= 250), true, JSON.stringify(gaps));
      // The children's own clocks say the same, less the spawn latency of the
      // inner node they measure from — 100 ms of tolerance is that latency, not
      // slack in the gap: the log stamps above carry the exact reading.
      t("…and the children's own starts are that far apart too", runs.slice(1).every((r, i) => r.start - runs[i].start >= 150), true, JSON.stringify(runs));
      t('the lease is released when the last command exits', existsSync(leaseDirFor(file)), false);
      t('…and the queue is empty', queueLive(queueDirFor(file), Date.now(), 60_000).length, 0);

      // A dead holder is broken by the next caller; a LIVE one is waited on and, past the wait, refused.
      const deadFile = join(dir, 'dead.jsonl');
      let deadPid = 99_999;
      while (pidAlive(deadPid)) deadPid -= 1;
      mkdirSync(leaseDirFor(deadFile), { recursive: true });
      writeFileSync(join(leaseDirFor(deadFile), 'holder'), `${deadPid} ${Date.now()} ghost\n`, 'utf8');
      const broken = [];
      const took = acquireWriteLease(deadFile, { kind: 'reaper', log: (l) => broken.push(l), waitMs: 2_000 });
      t('a holder whose process is gone is broken and taken', [took.held, took.broke?.pid], [true, deadPid]);
      t('…and the break is said out loud, naming the pid', broken.some((l) => l.includes(`pid ${deadPid}`) && l.includes('gone')));
      releaseWriteLease(deadFile);
      t('…and releasing removes it', existsSync(leaseDirFor(deadFile)), false);

      const liveFile = join(dir, 'live.jsonl');
      const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: 'ignore' });
      mkdirSync(leaseDirFor(liveFile), { recursive: true });
      writeFileSync(join(leaseDirFor(liveFile), 'holder'), `${sleeper.pid} ${Date.now()} sibling-write\n`, 'utf8');
      const refused = acquireWriteLease(liveFile, { kind: 'newcomer', log: () => {}, waitMs: 300 });
      sleeper.kill('SIGKILL');
      t('a LIVE holder is waited on, and past the wait the newcomer is refused — never a second in flight', [refused.held, refused.holder?.pid], [false, sleeper.pid]);
      t('…with the holder named in the refusal text', leaseRefusedText({ ...refused, waitMs: 300, nowMs: Date.now(), kind: 'newcomer' }).includes(`pid ${sleeper.pid} (sibling-write)`));
      t('…and the lease it could not take is left alone, ⛔ never stolen', existsSync(leaseDirFor(liveFile)));
      rmSync(leaseDirFor(liveFile), { recursive: true, force: true });
    }

    // ── rule ⑤ ──────────────────────────────────────────────────────────────
    battery('rule ⑤: batch mode — the gap rises for an announced batch, and the estimate is printed');
    {
      const file = join(dir, 'batch.jsonl');
      const h = harness(file, { env: { OS_PM_WRITE_MIN_GAP_MS: '0', OS_PM_WRITE_BATCH_THRESHOLD: '5', OS_PM_WRITE_BATCH_GAP_MS: '30000' } });
      const small = announceBatch({ token: TOKEN, count: 4, kind: 'issue-create POST' }, h.deps);
      t('below the threshold nothing is recorded — not even the file — and the line says so', [small.batched, existsSync(file), h.text().includes('below the threshold')], [false, false, true]);
      const big = announceBatch({ token: TOKEN, count: 6, kind: 'issue-create POST' }, h.deps);
      t('at the threshold the batch is recorded with its count and gap', [big.batched, big.gapMs, big.estimateMs], [true, 30_000, 180_000]);
      t('…and the announcement prints the item count and the estimate', h.text().includes('batch of 6 issue-create POST item(s)') && h.text().includes('Estimated 3m'));
      const first = await paceWrite({ token: TOKEN, kind: 'issue-create POST' }, h.deps);
      t('the first write of the batch does not pause', first.sleepMs, 0);
      h.state.ms += 1000;
      const second = await paceWrite({ token: TOKEN, kind: 'issue-create POST' }, h.deps);
      t("the second sleeps the BATCH gap's remainder, not rule ①'s", [second.gapMs, second.sleepMs], [30_000, 29_000]);
      t('…and says which batch it is pacing', h.text().includes('the batch gap is 30s (5 of 6 issue-create POST left'));
      t('⛔ another identity is not held behind this batch', (await paceWrite({ token: 'a-different-token', kind: 'label-write POST' }, h.deps)).gapMs, 0);
      for (let i = 0; i < 4; i++) {
        h.state.ms += 30_000;
        await paceWrite({ token: TOKEN, kind: 'issue-create POST' }, h.deps);
      }
      h.state.ms += 30_000;
      const after = await paceWrite({ token: TOKEN, kind: 'issue-create POST' }, h.deps);
      t('once the N writes are spent the batch is over and rule ① is back', [after.batch, after.gapMs], [null, 0]);
      t('…and the spent batch is pruned from the log', parseRecords(readFileSync(file, 'utf8')).some((r) => Number.isFinite(Number(r.batch))), false);

      // Cross-process: an announcement in one process paces --run in two others.
      const xfile = join(dir, 'batch-x.jsonl');
      const xmarks = join(dir, 'batch-x-marks.txt');
      writeFileSync(xmarks, '', 'utf8');
      const xenv = { OS_PM_WRITE_PACE_FILE: xfile, OS_PM_WRITE_MIN_GAP_MS: '0', OS_PM_WRITE_BATCH_THRESHOLD: '2', OS_PM_WRITE_BATCH_GAP_MS: '400', OS_PM_WRITE_SELFTEST_OUT: xmarks, OS_PM_WRITE_SELFTEST_RUN_MS: '10', GITHUB_TOKEN: TOKEN, GH_TOKEN: '' };
      const announced = await runChild(['--announce-batch', '2', '--kind', 'x'], xenv);
      const xr = await Promise.all([0, 1].map(() => runChild(['--run', '--kind', 'x', '--', process.execPath, '-e', CHILD_MARK], xenv)));
      const xissued = issuedStamps(xfile);
      t("announced in one process, the batch gap holds between two OTHER processes' writes", [announced.code, xr.map((r) => r.code), xissued.length === 2 && xissued[1] - xissued[0] >= 400], [0, [0, 0], true], JSON.stringify({ xissued, err: announced.err.slice(-200) }));
      t('…and the announcement itself went to stderr, naming the estimate', announced.err.includes('batch of 2 x item(s)') && announced.err.includes('Estimated'));
    }

    // ── --run ───────────────────────────────────────────────────────────────
    battery("--run: the shell door — gated by default, ungated with --read, the command's own exit code");
    {
      const file = join(dir, 'run.jsonl');
      const env = { OS_PM_WRITE_PACE_FILE: file, OS_PM_WRITE_MIN_GAP_MS: '0', GITHUB_TOKEN: TOKEN, GH_TOKEN: '' };
      const ok = await runChild(['--run', '--kind', 'door', '--', process.execPath, '-e', 'process.stdout.write("ran")'], env);
      t('the command runs with inherited stdio and its exit code passes through', [ok.code, ok.out], [0, 'ran']);
      t('…and one reservation was recorded for it, under the kind given', parseRecords(readFileSync(file, 'utf8')).filter((r) => r.kind === 'door').length, 1);
      const failing = await runChild(['--run', '--', process.execPath, '-e', 'process.exit(7)'], env);
      t("a failing command's own code is the exit, ⛔ never rewritten to 10", failing.code, 7);
      const marks = join(dir, 'read-marks.txt');
      writeFileSync(marks, '', 'utf8');
      const reads = await Promise.all([0, 1, 2].map(() => runChild(['--run', '--read', '--', process.execPath, '-e', CHILD_MARK], { ...env, OS_PM_WRITE_SELFTEST_OUT: marks, OS_PM_WRITE_SELFTEST_RUN_MS: '50' })));
      t('--read runs are never gated: no reservation, no lease, exit 0', [reads.map((r) => r.code), parseRecords(readFileSync(file, 'utf8')).length, existsSync(leaseDirFor(file))], [[0, 0, 0], 2, false]);
      noteResponse({ token: TOKEN, status: 429 }, { file, log: () => {} });
      const blocked = await runChild(['--run', '--', process.execPath, '-e', 'process.stdout.write("must not run")'], env);
      t('a stop marker refuses the door too: exit 10, and the command never ran', [blocked.code, blocked.out], [EXIT_WRITE_PACE_REFUSED, '']);
      t('an empty command is usage', (await runChild(['--run', '--'], env)).code, EXIT_USAGE);
      t('--announce-batch needs a positive count', (await runChild(['--announce-batch', 'lots'], env)).code, EXIT_USAGE);

      // A gated child under --run: it must INHERIT the wrapper's turn at once,
      // not queue behind its own parent until the hold bound breaks the lease.
      const nestedFile = join(dir, 'nested.jsonl');
      const nestedEnv = { ...env, OS_PM_WRITE_PACE_FILE: nestedFile, OS_PM_WRITE_LEASE_MAX_HOLD_MS: '4000', OS_PM_WRITE_SELF: pathToFileURL(SELF).href };
      const nestedCode =
        'const m = await import(process.env.OS_PM_WRITE_SELF);' +
        'const r = await m.paceWrite({ token: process.env.GITHUB_TOKEN, kind: "nested" }, { log: () => {} });' +
        'process.stdout.write(r.refused ? "refused" : "ok");';
      const t0 = Date.now();
      const nested = await runChild(['--run', '--kind', 'outer', '--', process.execPath, '--input-type=module', '-e', nestedCode], nestedEnv);
      const nestedMs = Date.now() - t0;
      t('⛔ a gated child under --run inherits the turn: it wrote at once, long before the 4 s hold bound', [nested.code, nested.out, nestedMs < 3000], [0, 'ok', true], `${nestedMs}ms; ${nested.err.slice(-200)}`);
      t('…both the wrapper and the child recorded their reservation', parseRecords(readFileSync(nestedFile, 'utf8')).map((r) => r.kind).sort(), ['nested', 'outer']);
      t('…and the wrapper released the lease it held on the child\'s behalf', existsSync(leaseDirFor(nestedFile)), false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── the wiring ────────────────────────────────────────────────────────────
  battery('the wiring: both halves, in every write transport, on write verbs only');
  {
    // Imported HERE rather than at module scope: the masker is a self-test
    // input, and a throttle every write path loads must stay a throttle.
    const { maskComments } = await import('../js-comment-mask.mjs');
    const read = (p) => readFileSync(p, 'utf8');
    const sources = new Map(WIRED_WRITE_TOOLS.map((n) => [n, read(join(PM_DIR, n))]));
    t('every wired tool imports this throttle', WIRED_WRITE_TOOLS.filter((n) => !sources.get(n).includes("write-pace.mjs")), []);
    t('…calls `paceWrite` before its write', WIRED_WRITE_TOOLS.filter((n) => !sources.get(n).includes('paceWrite(')), []);
    t('…and `noteResponse` after it', WIRED_WRITE_TOOLS.filter((n) => !sources.get(n).includes('noteResponse(')), []);
    t('…guarded by the write-verb predicate, so a GET is never paced', WIRED_WRITE_TOOLS.filter((n) => !sources.get(n).includes('isWriteMethod(')), []);

    // The closed set: an EIGHTH write path in this directory reds here, which
    // is the only way a new one cannot land unpaced.
    const names = spawnSync('git', ['ls-files', '--', 'scripts/pm'], { cwd: resolve(PM_DIR, '../..'), encoding: 'utf8' })
      .stdout.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('.mjs'))
      .map((l) => l.slice('scripts/pm/'.length))
      .filter((n) => n !== 'write-pace.mjs');
    t('git listed this directory', names.length > 5);
    t('⛔ the roster IS the set of files that issue a write verb — an eighth one reds here', writeVerbFiles(PM_DIR, names, read, maskComments), [...WIRED_WRITE_TOOLS].sort());
    t('this throttle issues no write of its own', writeVerbFiles(PM_DIR, ['write-pace.mjs'], read, maskComments), []);
  }

  // ── the floor, BEFORE the verdict ─────────────────────────────────────────
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floor.push(`the battery ledger declares ${declared.length} batteries, below its floor of ${SELF_TEST_BATTERY_FLOOR} — a section that stopped being declared is a section nothing floors.`);
  }
  for (const [name, count] of batteryCases) {
    if (name in SELF_TEST_BATTERIES) continue;
    floor.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floor.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  for (const message of floor) cases.push({ name: message, ok: false, detail: '' });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ write-pace self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(
    `✓ write-pace self-test: ${cases.length} cases pass across ${declared.length} batteries — the per-token key that ` +
      'never carries the token, the gap remainder, the 41st refusal and its prescription, the stop marker a 429 writes, ' +
      'the prune that keeps a long retry-after alive, the lease that kept one write in flight across real processes, ' +
      'the batch gap one process announced and two others obeyed, the shell door, and the nine write transports ' +
      'that call both halves.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = Object.freeze(['--status', '--self-test', '--help', '-h', '--run', '--read', '--kind', '--batch', '--announce-batch']);

const USAGE = [
  'usage:',
  "  node scripts/pm/write-pace.mjs --status      this token's trailing-hour budget, any stop marker, the lease holder",
  '  node scripts/pm/write-pace.mjs --self-test   offline core with an injected clock, plus real child processes for the lease',
  '  node scripts/pm/write-pace.mjs --announce-batch N [--kind K]',
  '                                               rule ⑤: raise the gap for the next N writes by this token, fleet-wide',
  '  node scripts/pm/write-pace.mjs --run [--kind K] [--batch N] [--read] -- <command…>',
  '                                               rule ④ for a shell caller: take the lease, pace, run the command,',
  '                                               release; --read skips the gate (a read is never paced).',
  '',
  `  Exits: 0 ok · ${EXIT_USAGE} usage · ${EXIT_WRITE_PACE_REFUSED} the throttle refused a write (raised from inside a calling`,
  "         tool or by --run before the command ran, never by --status); --run otherwise passes the command's own code through.",
].join('\n');

/** The CLI's own flags, stopping at `--`; what follows is the command. Pure. */
export function parseCli(argv) {
  const opts = { mode: null, kind: null, batch: null, announce: null, read: false, command: [], unknown: [] };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === '--') {
      opts.command = args.splice(0);
      break;
    }
    if (a === '--help' || a === '-h') opts.mode = 'help';
    else if (a === '--self-test') opts.mode = opts.mode ?? 'self-test';
    else if (a === '--status') opts.mode = opts.mode ?? 'status';
    else if (a === '--run') opts.mode = opts.mode ?? 'run';
    else if (a === '--read') opts.read = true;
    else if (a === '--kind') opts.kind = args.shift() ?? '';
    else if (a === '--batch') opts.batch = args.shift() ?? '';
    else if (a === '--announce-batch') {
      opts.mode = opts.mode ?? 'announce';
      opts.announce = args.shift() ?? '';
    } else opts.unknown.push(a);
  }
  return opts;
}

const positiveCount = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

/** `--run`: rule ④ (and ⑤ with `--batch`) around a command this file cannot see inside. */
async function runGated(cli, token) {
  const kind = cli.kind ?? `run ${cli.command[0]}`;
  const file = paceFilePath();
  if (!cli.read) {
    if (cli.batch !== null) {
      const n = positiveCount(cli.batch);
      if (n === null) {
        console.error(`write-pace: --batch needs a positive integer count, got ${JSON.stringify(cli.batch)}\n`);
        console.error(USAGE);
        return EXIT_USAGE;
      }
      try {
        announceBatch({ token, count: n, kind });
      } catch (e) {
        console.error(unrecordableText(file, e));
        return EXIT_WRITE_PACE_REFUSED;
      }
    }
    const paced = await paceWrite({ token, kind }, { exit: () => {} });
    if (paced.refused) return paced.exitCode ?? EXIT_WRITE_PACE_REFUSED;
  }
  const code = await new Promise((resolve) => {
    const env = cli.read ? process.env : { ...process.env, [LEASE_HOLDER_ENV]: String(process.pid) };
    const child = spawn(cli.command[0], cli.command.slice(1), { stdio: 'inherit', env });
    child.on('error', (e) => {
      console.error(`write-pace: could not run ${cli.command[0]}: ${e?.message ?? e}`);
      resolve(127);
    });
    child.on('close', (status, signal) => resolve(typeof status === 'number' ? status : signal ? 128 + (OS_CONSTANTS.signals[signal] ?? 0) : 1));
  });
  if (!cli.read) releaseWriteLease(file);
  return code;
}

export async function main(argv) {
  const cli = parseCli(argv);
  if (cli.mode === 'help') {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (argv.includes('--self-test')) return selfTest();
  if (cli.unknown.length) {
    console.error(`write-pace: unrecognised option ${cli.unknown.map((u) => `\`${u}\``).join(', ')}\n`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  if (cli.mode === 'status') {
    console.log(statusReport({ token }).text);
    return EXIT_OK;
  }
  if (cli.mode === 'announce') {
    const n = positiveCount(cli.announce);
    if (n === null) {
      console.error(`write-pace: --announce-batch needs a positive integer count, got ${JSON.stringify(cli.announce)}\n`);
      console.error(USAGE);
      return EXIT_USAGE;
    }
    try {
      announceBatch({ token, count: n, kind: cli.kind ?? 'write' });
    } catch (e) {
      console.error(unrecordableText(paceFilePath(), e));
      return EXIT_WRITE_PACE_REFUSED;
    }
    return EXIT_OK;
  }
  if (cli.mode === 'run') {
    if (cli.command.length === 0) {
      console.error('write-pace: --run needs a command after `--`\n');
      console.error(USAGE);
      return EXIT_USAGE;
    }
    return runGated(cli, token);
  }
  console.error(USAGE);
  return EXIT_USAGE;
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\n✗ write-pace self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
        'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}
