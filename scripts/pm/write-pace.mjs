#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * write-pace — one throttle in front of every seat write (#19572).
 *
 *   node scripts/pm/write-pace.mjs --status      # this token's budget, before a batch
 *   node scripts/pm/write-pace.mjs --self-test   # offline, injected clock, no network
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
 *  10   `EXIT_WRITE_PACE_REFUSED` — the budget or a stop marker refused this
 *       write. Distinct from every code the five calling tools use (their
 *       highest is 9), so a seat reading an exit code can always tell "the
 *       throttle stopped me" from anything the tool itself decided. ⛔ NOT a
 *       failure of the work: nothing was written, nothing is half-written, and
 *       re-running after the printed instant is safe.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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
    notes,
  };
}

/**
 * The trailing-hour prune, applied on every read of the log.
 *
 * Two different survival rules, deliberately: a WRITE survives by age, a
 * MARKER survives by its own expiry. A `retry-after` of two hours writes a
 * marker that an age rule would prune away thirty minutes before the platform
 * said it could be ignored.
 */
export function pruneRecords(records, nowMs) {
  const cutoff = nowMs - WINDOW_MS;
  return (Array.isArray(records) ? records : []).filter((r) => {
    if (!r || typeof r !== 'object') return false;
    if (Number.isFinite(Number(r.stop))) return Number(r.stop) > nowMs;
    return Number.isFinite(Number(r.t)) && Number(r.t) > cutoff;
  });
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
 *               the instant the reservation is stamped with.
 */
export function decidePace({ records = [], key, nowMs, minGapMs = DEFAULT_MIN_GAP_MS, hourlyMax = DEFAULT_HOURLY_MAX } = {}) {
  const mine = (Array.isArray(records) ? records : []).filter((r) => r && r.k === key);

  let marker = null;
  for (const r of mine) {
    if (!Number.isFinite(Number(r.stop))) continue;
    if (!marker || Number(r.stop) > Number(marker.stop)) marker = r;
  }
  const writes = mine.filter((r) => !Number.isFinite(Number(r.stop)) && Number.isFinite(Number(r.t))).map((r) => Number(r.t));
  const inWindow = writes.filter((t) => t > nowMs - WINDOW_MS);
  const last = writes.length ? Math.max(...writes) : null;
  const base = { key, count: inWindow.length, hourlyMax, minGapMs, nowMs, lastAtMs: last };

  if (marker && Number(marker.stop) > nowMs) {
    return { ...base, verdict: 'stopped', sleepMs: 0, resumeAtMs: Number(marker.stop), why: String(marker.why ?? 'a platform back-off signal'), markerAtMs: Number(marker.at) || null };
  }
  if (inWindow.length >= hourlyMax) {
    return { ...base, verdict: 'exhausted', sleepMs: 0, resumeAtMs: Math.min(...inWindow) + WINDOW_MS };
  }
  const sleepMs = last === null ? 0 : Math.max(0, last + minGapMs - nowMs);
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

/** Rule ① — the pause, said out loud. */
export function gapText(d, kind) {
  return (
    `write-pace: pausing ${fmtDuration(d.sleepMs)} before ${kind || 'this write'} — the minimum gap is ` +
    `${d.minGapMs}ms and the previous write by token key ${d.key} was ${fmtDuration(d.nowMs - d.lastAtMs)} ago ` +
    `(${d.count}/${d.hourlyMax} in the trailing hour).`
  );
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
  for (;;) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      mkdirSync(lock);
      held = true;
      break;
    } catch (e) {
      if (e?.code !== 'EEXIST') break;
      let age = 0;
      try {
        age = now() - statSync(lock).mtimeMs;
      } catch {
        continue; // it went away between the mkdir and the stat — try again
      }
      if (age > LOCK_STALE_MS) {
        try {
          rmdirSync(lock);
        } catch {
          /* someone else broke it first */
        }
        continue;
      }
      if (now() >= deadline) break;
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

  const { minGapMs, hourlyMax, notes } = limitsFrom(env);
  for (const note of notes) log(`write-pace: ${note}`);

  const key = tokenKey(token);
  const nowMs = now();
  let decision;

  withPaceLock(
    file,
    () => {
      const kept = pruneRecords(readRecordsFrom(file), nowMs);
      decision = decidePace({ records: kept, key, nowMs, minGapMs, hourlyMax });
      if (decision.verdict === 'ok') kept.push({ t: decision.issueAtMs, k: key, kind });
      writeRecordsTo(file, kept);
    },
    { now, sleep: deps.sleepSync ?? sleepSync },
  );

  if (decision.verdict === 'stopped') {
    log(stoppedText(decision));
    exit(EXIT_WRITE_PACE_REFUSED);
    return { ...decision, refused: true, exitCode: EXIT_WRITE_PACE_REFUSED, file };
  }
  if (decision.verdict === 'exhausted') {
    log(exhaustedText(decision));
    exit(EXIT_WRITE_PACE_REFUSED);
    return { ...decision, refused: true, exitCode: EXIT_WRITE_PACE_REFUSED, file };
  }
  if (decision.sleepMs > 0) {
    log(gapText(decision, kind));
    await sleep(decision.sleepMs);
  }
  return { ...decision, refused: false, slept: decision.sleepMs, file };
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
  if (!signal) return null;

  const key = tokenKey(token);
  withPaceLock(
    file,
    () => {
      const kept = pruneRecords(readRecordsFrom(file), nowMs);
      kept.push({ stop: signal.untilMs, k: key, why: signal.why, at: nowMs });
      writeRecordsTo(file, kept);
    },
    { now, sleep: deps.sleepSync ?? sleepSync },
  );
  log(markerText(signal, key, nowMs));
  return { ...signal, key, file };
}

/** `--status`: this token's budget and any active marker, without writing anything. */
export function statusReport({ token } = {}, deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const env = deps.env ?? process.env;
  const file = deps.file ?? paceFilePath(env, deps.home ?? homedir());
  const { minGapMs, hourlyMax, notes } = limitsFrom(env);

  const nowMs = now();
  const key = tokenKey(token);
  const kept = pruneRecords(readRecordsFrom(file), nowMs);
  const d = decidePace({ records: kept, key, nowMs, minGapMs, hourlyMax });

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
  'the limits: overrides are for tests, and a malformed one never loosens': 6,
  'rule ①: the remainder is slept, and the pause is said out loud': 7,
  'rule ②: the 41st is REFUSED, with a prescription': 8,
  'rule ③: what writes a stop marker, how long it lasts, what it refuses': 10,
  'the prune: the trailing hour for writes, the expiry for markers': 6,
  'the log, --status and the CLI: what lands on disk, and what must never': 9,
  'the wiring: both halves, in every write transport, on write verbs only': 7,
});
const SELF_TEST_BATTERY_FLOOR = 9;
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

/** The five write transports this throttle is wired into — the card's census. */
export const WIRED_WRITE_TOOLS = Object.freeze([
  'post-stamped.mjs',
  'label-write.mjs',
  'close-cards.mjs',
  'sweep-closed-cards.mjs',
  'sweep-stale-finding.mjs',
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

    // The closed set: a SIXTH write path in this directory reds here, which is
    // the only way a new one cannot land unpaced.
    const names = spawnSync('git', ['ls-files', '--', 'scripts/pm'], { cwd: resolve(PM_DIR, '../..'), encoding: 'utf8' })
      .stdout.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('.mjs'))
      .map((l) => l.slice('scripts/pm/'.length))
      .filter((n) => n !== 'write-pace.mjs');
    t('git listed this directory', names.length > 5);
    t('⛔ the roster IS the set of files that issue a write verb — a sixth one reds here', writeVerbFiles(PM_DIR, names, read, maskComments), [...WIRED_WRITE_TOOLS].sort());
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
      'the prune that keeps a long retry-after alive, and the five write transports that call both halves.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = Object.freeze(['--status', '--self-test', '--help', '-h']);

const USAGE = [
  'usage:',
  '  node scripts/pm/write-pace.mjs --status      this token\'s trailing-hour budget and any active stop marker',
  '  node scripts/pm/write-pace.mjs --self-test   offline, injected clock, no network and no real cache file',
  '',
  `  Exits: 0 ok · ${EXIT_USAGE} usage · ${EXIT_WRITE_PACE_REFUSED} the throttle refused a write (that code is only ever`,
  '         raised from inside a calling tool, never by --status).',
].join('\n');

export async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (argv.includes('--self-test')) return selfTest();
  const unknown = argv.filter((a) => !KNOWN_FLAGS.includes(a));
  if (unknown.length) {
    console.error(`write-pace: unrecognised option ${unknown.map((u) => `\`${u}\``).join(', ')}\n`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  if (argv.includes('--status')) {
    console.log(statusReport({ token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '' }).text);
    return EXIT_OK;
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
