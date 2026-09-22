#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fleet-write/dispatch — the seat side of the relay: pick the transport, pack
 * ONE stroke into ONE `repository_dispatch`, send it, and wait for its run.
 *
 *   node scripts/pm/fleet-write/dispatch.mjs --repo owner/name --actions-file actions.json [--session session_…] [--json]
 *   node scripts/pm/fleet-write/dispatch.mjs --repo owner/name --actions-file actions.json --dry-run   # pack and print, send nothing
 *   node scripts/pm/fleet-write/dispatch.mjs --self-test                                                # offline, no network
 *
 * ## Why a seat cannot write as the fleet directly, and what this does instead
 *
 * A cloud seat's egress proxy REPLACES every `Authorization` header with the
 * session's own token and refuses the `/app/**` path the token minter needs,
 * so `fleet-token.mjs` cannot mint there and a minted token could not be used
 * there. What the proxy does pass is `POST /repos/{board}/dispatches` with the
 * session token — measured 204 — and GitHub Actions is the broker a cloud seat
 * can reach. So a seat packs the SAME requests it would have sent directly
 * into one payload (`validate.mjs` judges it before it leaves), dispatches it
 * to the board repo, and `.github/workflows/fleet-write.yml` there executes
 * it as `objectstack-fleet[bot]` against `payload.repo`.
 *
 * ## The transport selector — `OS_FLEET_TRANSPORT` ∈ direct | dispatch | auto
 *
 * `direct` is today's path (the tool's own requests with the token it holds);
 * `dispatch` is the relay; `auto` (the default) is `dispatch` when this
 * process runs in a cloud seat container and `direct` otherwise. The
 * discriminator is `CCR_AGENT_PROXY_ENABLED=1` — the variable that names the
 * very proxy whose header replacement makes the direct path unusable, present
 * in every cloud container measured and absent on a developer's machine and
 * on a runner. ⛔ Not the proxy port: a port is a fact about one container's
 * boot, and nothing about identity. Every selection PRINTS which transport it
 * took and why; a silent choice between two identities is the one thing this
 * file must never make.
 *
 * ## Identity on the envelope: `OS_FLEET_SESSION`
 *
 * The payload carries the dispatching seat's `session_…` id, and the run's
 * summary names it. A seat sets `OS_FLEET_SESSION` to its own id; in dispatch
 * mode a missing one is a PREREQUISITE refusal (exit 3), never an invented
 * value and never a silent fall-back to `direct` — the fall-back would change
 * the identity every write below is booked against.
 *
 * ## The run-poller, and the two ceilings
 *
 * A dispatch answers 204 whether or not anything listens — measured on the
 * board repo with zero listeners: 204, zero runs. So acceptance proves
 * nothing; the run does. After the POST this file polls
 * `GET /repos/{board}/actions/runs?event=repository_dispatch` for the run whose
 * name carries the request id (`run-name: fleet-write <request_id>`), then
 * polls that run until it completes:
 *
 *   `OS_FLEET_DISPATCH_START_MS`    how long a run may take to APPEAR (default 90 s);
 *   `OS_FLEET_DISPATCH_TIMEOUT_MS`  how long, from the dispatch, it may take to COMPLETE (default 5 min);
 *   `OS_FLEET_DISPATCH_POLL_MS`     the poll interval (default 5 s).
 *
 * Neither ceiling is a measured start latency yet — the relay workflow lands
 * separately, and the first live probe is what tunes them. On either ceiling
 * the answer is `UNCONFIRMED` with the run URL when there is one, exit
 * `EXIT_UNCONFIRMED` (6): ⛔ never silent, ⛔ never auto-retried — a retry of a
 * dispatch that may still run is a double write. The one fall-back that exists
 * is the caller's and only under `auto`: NO run appeared in the start window,
 * which is the shape a board without the listening workflow produces, so the
 * caller prints one line and takes `direct`. A run that appeared and FAILED is
 * never fallen back from — the relay refused or half-wrote, and a direct retry
 * would write twice.
 *
 * `write-pace.mjs` counts the dispatch as THE write — one POST, paced and
 * leased like any other; the runner's executor paces its own writes there.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0   the run completed with conclusion `success`.
 *   2   usage, or the packed payload was refused by the validator (nothing sent).
 *   3   PREREQUISITE NOT MET — no token, no session in dispatch mode, the
 *       dispatch route dead (401/407/0), or the run list unreadable.
 *   5   the platform REFUSED the dispatch (403/404/422), or the run FAILED.
 *   6   UNCONFIRMED — no run in the start window, or no completion within
 *       the ceiling. The run URL (when any) is printed. Go READ it; ⛔ do not
 *       retry blind.
 *  10   the write throttle refused the dispatch.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../../invoked-as.mjs';
import { EXIT_PREREQUISITE_NOT_MET, PROXY_FLAG, proxyRearmPlan } from '../check-half-states.mjs';
import { classifyHttp } from '../label-write.mjs';
import { EXIT_WRITE_PACE_REFUSED, isWriteMethod, noteResponse, paceWrite, releaseWriteLease } from '../write-pace.mjs';
import { MAX_REQUEST_ID_CHARS, RELAY_EVENT_TYPE, RELAY_REPO, SESSION_ENV, SESSION_SHAPE, TRANSPORTS, TRANSPORT_ENV } from './ops.mjs';
import { refusalText, validatePayload } from './validate.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const DEFAULT_API = 'https://api.github.com';
const PROXY_REARM_GUARD = 'OS_FLEET_DISPATCH_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = EXIT_PREREQUISITE_NOT_MET;
export const EXIT_PLATFORM_REFUSAL = 5;
/** The one exit that means "dispatched, outcome not confirmed" — shared by every tool that takes the relay. */
export const EXIT_UNCONFIRMED = 6;

/** The cloud-seat discriminator `auto` reads. */
export const CLOUD_DISCRIMINATOR = 'CCR_AGENT_PROXY_ENABLED';

export const DEFAULT_START_MS = 90_000;
export const DEFAULT_CEILING_MS = 5 * 60 * 1000;
export const DEFAULT_POLL_MS = 5_000;

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/**
 * Which transport this process takes, and why. Pure.
 * @returns {{ requested: string, transport: 'direct'|'dispatch'|null, reason: string, error: string|null }}
 */
export function selectTransport(env = process.env) {
  const raw = String(env[TRANSPORT_ENV] ?? '').trim();
  const requested = raw || 'auto';
  if (!TRANSPORTS.includes(requested)) {
    return { requested, transport: null, reason: '', error: `${TRANSPORT_ENV}=${JSON.stringify(raw)} is not one of ${TRANSPORTS.join(' | ')} — refusing to guess between two identities` };
  }
  if (requested !== 'auto') return { requested, transport: requested, reason: `${TRANSPORT_ENV}=${requested}`, error: null };
  const cloud = String(env[CLOUD_DISCRIMINATOR] ?? '') === '1';
  return {
    requested,
    transport: cloud ? 'dispatch' : 'direct',
    reason: cloud
      ? `${TRANSPORT_ENV} is auto and ${CLOUD_DISCRIMINATOR}=1 — a cloud seat container, whose proxy replaces the Authorization header, so the fleet identity is reachable only through the relay`
      : `${TRANSPORT_ENV} is auto and ${CLOUD_DISCRIMINATOR} is not 1 — not a cloud seat container, so the tool's own requests go out directly`,
    error: null,
  };
}

/** The seat's session id from the environment, or null. */
export function sessionFrom(env = process.env) {
  const raw = String(env[SESSION_ENV] ?? '').trim();
  return SESSION_SHAPE.test(raw) ? raw : null;
}

/** A request id: `fw-<UTC instant>-<6 hex>` — under the cap, and unique enough to find its run by name. */
export function newRequestId(nowMs = Date.now(), random = () => randomBytes(3).toString('hex')) {
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const id = `fw-${stamp}-${random()}`;
  if (id.length > MAX_REQUEST_ID_CHARS) throw new RangeError(`request id ${id} exceeds ${MAX_REQUEST_ID_CHARS} characters`);
  return id;
}

/** Pack one stroke. The shared validator is the judge; nothing here restates a rule. */
export function packRequest({ repo, session, actions, requestId = null, now = Date.now } = {}) {
  const payload = { request_id: requestId ?? newRequestId(now()), repo, session, actions };
  const judged = validatePayload(payload);
  return judged.ok ? { ok: true, payload: judged.payload, errors: [] } : { ok: false, payload: null, errors: judged.errors };
}

/** Is this workflow run the one a request id names? `run-name` renders as `display_title`; the workflow's own `name` is the fallback. */
export function runMatches(run, requestId) {
  if (!run || typeof run !== 'object') return false;
  return [run.display_title, run.name].some((v) => typeof v === 'string' && v.includes(requestId));
}

/** The three ceilings, from the environment, with the same parse rule as write-pace: a malformed override is IGNORED and said. */
export function ceilingsFrom(env = process.env) {
  const notes = [];
  const read = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const n = Number(String(raw).trim());
    if (Number.isInteger(n) && n >= 0) return n;
    notes.push(`${name}=${JSON.stringify(String(raw))} is not a non-negative integer — IGNORED, using the default ${fallback}.`);
    return fallback;
  };
  return { startMs: read('OS_FLEET_DISPATCH_START_MS', DEFAULT_START_MS), ceilingMs: read('OS_FLEET_DISPATCH_TIMEOUT_MS', DEFAULT_CEILING_MS), pollMs: read('OS_FLEET_DISPATCH_POLL_MS', DEFAULT_POLL_MS), notes };
}

/** The UNCONFIRMED sentence a tool prints on either ceiling. */
export function unconfirmedText(result, tool = 'fleet-write') {
  const where = result.run?.url ? ` Run: ${result.run.url}` : ' No run carrying this request id appeared.';
  const what = result.state === 'no-run' ? `no run named after request ${result.requestId} appeared within ${result.startMs} ms of the dispatch` : `run ${result.run?.id ?? '?'} had not completed ${result.ceilingMs} ms after the dispatch (last status: ${result.run?.status ?? '?'})`;
  return (
    `${tool}: UNCONFIRMED — ${what}.${where}\n` +
    `  The dispatch was ACCEPTED (HTTP ${result.status}) and may still run. Go READ the run and the target; ⛔ do not re-run this\n` +
    `  command blind — a second dispatch is a second write. Exit ${EXIT_UNCONFIRMED}.`
  );
}

/** The one line `auto` prints when it falls back to `direct` because no run appeared. */
export function fallbackText(result, tool = 'fleet-write') {
  return (
    `${tool}: transport auto — the dispatch was accepted (HTTP ${result.status}) but NO run named after request ${result.requestId} appeared within ` +
    `${result.startMs} ms, the shape a board without the listening workflow produces. Falling back to DIRECT for this write. ` +
    '⚠️ If the relay is live and merely slow, the direct write below is a second one.'
  );
}

// ---------------------------------------------------------------------------
// Transport — the one POST, paced; the reads around it are not.
// ---------------------------------------------------------------------------

async function rest(api, path, { method = 'GET', body = null } = {}, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const token = deps.token ?? '';
  const paceDeps = deps.pace ?? {};
  const paced = isWriteMethod(method);
  if (paced) await paceWrite({ token, kind: `fleet-write dispatch ${method}` }, paceDeps);
  let res;
  try {
    res = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    if (paced) releaseWriteLease(paceDeps.file);
    return { status: 0, rateRemaining: null, json: null, detail: e?.message ?? 'fetch threw', call: `${method} ${path}` };
  }
  const rateRemaining = res.headers.get('x-ratelimit-remaining');
  let json = null;
  if (res.status !== 204) {
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  }
  if (paced) {
    noteResponse(
      { token, status: res.status, headers: res.headers, body: json, verdict: classifyHttp({ status: res.status, rateRemaining: rateRemaining === null ? null : Number(rateRemaining) }) },
      paceDeps,
    );
  }
  return { status: res.status, rateRemaining: rateRemaining === null ? null : Number(rateRemaining), json, detail: typeof json?.message === 'string' ? json.message : '', call: `${method} ${path}` };
}

/**
 * Send one packed payload and wait for its run.
 *
 * Returns `{ state, ok, status, verdict, run, requestId, dispatchedAt, startMs, ceilingMs, detail }` where `state` is one of
 * `success` · `failure` (the run completed otherwise) · `no-run` · `timeout` · `refused` (the dispatch itself).
 * Never throws on an HTTP status.
 */
export async function sendFleetWrite(payload, deps = {}) {
  const api = deps.api ?? DEFAULT_API;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((line) => console.error(line));
  const { startMs, ceilingMs, pollMs, notes } = deps.ceilings ?? ceilingsFrom(deps.env ?? process.env);
  for (const note of notes ?? []) log(`fleet-write: ${note}`);
  const t = { fetch: deps.fetch, token: deps.token, pace: deps.pace };
  const requestId = payload.request_id;
  const base = { requestId, startMs, ceilingMs, run: null };

  const dispatchedAt = now();
  const sent = await rest(api, `/repos/${RELAY_REPO}/dispatches`, { method: 'POST', body: { event_type: RELAY_EVENT_TYPE, client_payload: payload } }, t);
  const verdict = classifyHttp({ status: sent.status, rateRemaining: sent.rateRemaining });
  if (sent.status !== 204) {
    log(`fleet-write: ${sent.call} -> HTTP ${sent.status}${sent.detail ? ` (${sent.detail})` : ''} — the dispatch was NOT accepted (${verdict}); nothing ran.`);
    return { ...base, state: 'refused', ok: false, status: sent.status, verdict, dispatchedAt, detail: sent.detail };
  }
  log(`fleet-write: dispatched request ${requestId} to ${RELAY_REPO} (HTTP 204) — ${payload.actions.length} action(s) for ${payload.repo}; waiting for its run.`);

  // ── find the run ──────────────────────────────────────────────────────────
  const since = new Date(dispatchedAt - 60_000).toISOString();
  let run = null;
  let listFailure = null;
  while (run === null) {
    const list = await rest(api, `/repos/${RELAY_REPO}/actions/runs?event=repository_dispatch&per_page=20&created=%3E%3D${encodeURIComponent(since)}`, {}, t);
    if (list.status !== 200) {
      listFailure = list;
    } else {
      listFailure = null;
      const hit = (list.json?.workflow_runs ?? []).find((r) => runMatches(r, requestId));
      if (hit) run = { id: hit.id, url: hit.html_url ?? null, status: hit.status ?? null, conclusion: hit.conclusion ?? null };
    }
    if (run !== null) break;
    if (now() - dispatchedAt >= startMs) {
      if (listFailure) {
        log(`fleet-write: ${listFailure.call} -> HTTP ${listFailure.status}${listFailure.detail ? ` (${listFailure.detail})` : ''} — the run list could not be read, so the run cannot be found.`);
        return { ...base, state: 'no-run', ok: false, status: 204, verdict: 'ok', dispatchedAt, detail: `run list HTTP ${listFailure.status}`, listUnreadable: true };
      }
      return { ...base, state: 'no-run', ok: false, status: 204, verdict: 'ok', dispatchedAt, detail: 'no run appeared' };
    }
    await sleep(pollMs);
  }
  log(`fleet-write: run ${run.id} found (${run.status})${run.url ? ` ${run.url}` : ''}.`);

  // ── wait for it ───────────────────────────────────────────────────────────
  while (run.status !== 'completed') {
    if (now() - dispatchedAt >= ceilingMs) return { ...base, run, state: 'timeout', ok: false, status: 204, verdict: 'ok', dispatchedAt, detail: `run ${run.id} ${run.status}` };
    await sleep(pollMs);
    const one = await rest(api, `/repos/${RELAY_REPO}/actions/runs/${run.id}`, {}, t);
    if (one.status === 200 && one.json) run = { id: run.id, url: one.json.html_url ?? run.url, status: one.json.status ?? run.status, conclusion: one.json.conclusion ?? null };
  }
  const ok = run.conclusion === 'success';
  log(`fleet-write: run ${run.id} completed — conclusion ${run.conclusion}${run.url ? ` ${run.url}` : ''}.`);
  return { ...base, run, state: ok ? 'success' : 'failure', ok, status: 204, verdict: 'ok', dispatchedAt, detail: `conclusion ${run.conclusion}` };
}

/** The exit a tool takes from a result that is not `success`. */
export function exitForResult(result) {
  if (result.state === 'refused') return result.verdict === 'prerequisite' || result.verdict === 'ratelimit' ? EXIT_PREREQUISITE : EXIT_PLATFORM_REFUSAL;
  if (result.state === 'failure') return EXIT_PLATFORM_REFUSAL;
  if (result.state === 'no-run' || result.state === 'timeout') return EXIT_UNCONFIRMED;
  return EXIT_OK;
}

/**
 * The route a tool takes for THIS write, resolved once: the transport, the
 * session the envelope needs, and the refusal when dispatch mode has no
 * session. Pure. Every tool prints `reason` — the choice is never silent.
 */
export function resolveRoute(env = process.env) {
  const sel = selectTransport(env);
  if (sel.error) return { ...sel, session: null, error: sel.error };
  if (sel.transport !== 'dispatch') return { ...sel, session: null };
  const session = sessionFrom(env);
  if (!session) {
    return {
      ...sel,
      session: null,
      error: `transport ${sel.transport} (${sel.reason}) needs ${SESSION_ENV}=session_… — this seat's own session id — on the envelope; it is absent or malformed. ⛔ Not falling back to direct: that would change the identity the write is booked against.`,
    };
  }
  return { ...sel, session };
}

// ---------------------------------------------------------------------------
// Self-test — offline: a fake platform with a fake Actions run list, an
// injected clock, an injected throttle, no network.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the selector: OS_FLEET_TRANSPORT wins; auto is dispatch in a cloud container and direct without the variable': 8,
  'the session: read from OS_FLEET_SESSION, refused in dispatch mode when absent, never invented': 4,
  'the packer: one payload per stroke, a fresh request id under the cap, judged by the shared validator': 6,
  'the dispatch: one paced POST to the board repo with event_type and client_payload; 204 is acceptance, anything else a refusal': 7,
  'the run-poller: the run named after the request id, its completion, its conclusion': 6,
  'the ceilings: no run in the start window, no completion in the ceiling — UNCONFIRMED, never retried': 7,
  'the wiring: the POST is paced and on the roster, the reads are not, the token never reaches the log': 4,
  'the CLI: a dry run sends nothing, usage, the exit ladder': 6,
});
const SELF_TEST_BATTERY_FLOOR = 8;
const UNATTRIBUTED_BATTERY = '(unattributed)';

const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

export async function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true, detail) => {
    const bucket = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(bucket, (batteryCases.get(bucket) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `${detail ? `${detail} — ` : ''}got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };
  const { mkdtempSync, rmSync, existsSync, readFileSync: readReal, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const TOKEN = 'ghs_FixtureTokenNotRealAtAll0000000000000';
  const SESSION = 'session_01ABCDEFGHJKMNPQRSTVWXYZ';
  const ACTIONS = [{ op: 'comment', issue: 19701, body: 'Hello from the relay.' }];

  // ── the selector ────────────────────────────────────────────────────────
  battery('the selector: OS_FLEET_TRANSPORT wins; auto is dispatch in a cloud container and direct without the variable');
  {
    t('no variables at all is auto → direct', [selectTransport({}).requested, selectTransport({}).transport], ['auto', 'direct']);
    t('the cloud discriminator alone makes auto → dispatch', selectTransport({ [CLOUD_DISCRIMINATOR]: '1' }).transport, 'dispatch');
    t('…and the reason names the variable and the proxy', selectTransport({ [CLOUD_DISCRIMINATOR]: '1' }).reason.includes(CLOUD_DISCRIMINATOR) && selectTransport({ [CLOUD_DISCRIMINATOR]: '1' }).reason.includes('Authorization'));
    t('the discriminator must be exactly 1 — an empty value is not a cloud container', selectTransport({ [CLOUD_DISCRIMINATOR]: '' }).transport, 'direct');
    t('an explicit direct wins over the discriminator', selectTransport({ [TRANSPORT_ENV]: 'direct', [CLOUD_DISCRIMINATOR]: '1' }).transport, 'direct');
    t('an explicit dispatch wins outside a cloud container', selectTransport({ [TRANSPORT_ENV]: 'dispatch' }).transport, 'dispatch');
    t('an unknown value is refused, never guessed', [selectTransport({ [TRANSPORT_ENV]: 'relay' }).transport, typeof selectTransport({ [TRANSPORT_ENV]: 'relay' }).error], [null, 'string']);
    t('⛔ the proxy port is not what the selector reads — its source names no proxy variable or port', /HTTPS_PROXY|https_proxy|34111|_PORT|proxy port/.test(selectTransport.toString()), false);
  }

  // ── the session ─────────────────────────────────────────────────────────
  battery('the session: read from OS_FLEET_SESSION, refused in dispatch mode when absent, never invented');
  {
    t('a well-formed session id is read', sessionFrom({ [SESSION_ENV]: SESSION }), SESSION);
    t('a UUID is not a session id', sessionFrom({ [SESSION_ENV]: 'd589e4b7-cc75-54c6-a119-874fab8f21f8' }), null);
    const missing = resolveRoute({ [TRANSPORT_ENV]: 'dispatch' });
    t('dispatch mode without a session is a refusal naming the variable and saying it will NOT fall back', [missing.transport, missing.error?.includes(SESSION_ENV), missing.error?.includes('Not falling back')], ['dispatch', true, true]);
    t('direct mode needs no session and carries no error', [resolveRoute({}).transport, resolveRoute({}).error, resolveRoute({}).session], ['direct', null, null]);
  }

  // ── the packer ──────────────────────────────────────────────────────────
  battery('the packer: one payload per stroke, a fresh request id under the cap, judged by the shared validator');
  {
    const NOW = Date.UTC(2026, 8, 22, 9, 4, 0);
    const id = newRequestId(NOW, () => 'abc123');
    t('the request id carries the UTC instant and a random tail', id, 'fw-20260922T090400Z-abc123');
    t('…and is under the cap', id.length <= MAX_REQUEST_ID_CHARS);
    const packed = packRequest({ repo: 'objectstack-ai/objectstack', session: SESSION, actions: ACTIONS, now: () => NOW });
    t('a stroke packs to a valid payload with the four keys', [packed.ok, Object.keys(packed.payload)], [true, ['request_id', 'repo', 'session', 'actions']]);
    t('a given request id is kept', packRequest({ repo: 'objectstack-ai/objectstack', session: SESSION, actions: ACTIONS, requestId: 'given-1' }).payload.request_id, 'given-1');
    const bad = packRequest({ repo: 'someone/else', session: SESSION, actions: [{ op: 'merge' }] });
    t('a bad stroke is refused by the SHARED validator with every reason', [bad.ok, bad.errors.length >= 2], [false, true]);
    t('…and nothing here restates a rule: the refusal comes from validate.mjs', bad.errors.some((e) => e.includes('objectstack-ai/<name>')));
  }

  const dir = mkdtempSync(join(tmpdir(), 'fleet-write-dispatch-'));
  try {
    let paceCase = 0;
    const paceFor = (file) => ({
      file,
      env: { OS_PM_WRITE_MIN_GAP_MS: '0' },
      log: () => {},
      exit: (code) => {
        throw Object.assign(new Error(`throttle refused with exit ${code}`), { throttleExit: code });
      },
    });
    const paceFile = join(dir, 'pace-shared.jsonl');
    const payload = packRequest({ repo: 'objectstack-ai/objectstack', session: SESSION, actions: ACTIONS, requestId: 'fw-test-1' }).payload;
    const DISPATCH = `POST /repos/${RELAY_REPO}/dispatches`;
    const RUNS = `GET /repos/${RELAY_REPO}/actions/runs`;
    /**
     * A fake platform whose run list is a SCRIPT over the clock: `runs` is a
     * function of the elapsed ms since the dispatch, so appearance latency and
     * completion are modelled as time, not as call counts.
     */
    const platform = ({ dispatch = { status: 204 }, runs = () => [], one = () => null }, seen, clock) => async (url, init) => {
      const u = new URL(url);
      const call = `${init?.method ?? 'GET'} ${u.pathname}`;
      seen.push({ call, query: u.search, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.authorization ?? '' });
      const headers = new Headers({ 'x-ratelimit-remaining': '4999' });
      if (call === DISPATCH) {
        if (dispatch.throws) throw new Error(dispatch.throws);
        return { status: dispatch.status, headers: new Headers({ 'x-ratelimit-remaining': dispatch.rateRemaining ?? '4999' }), json: async () => dispatch.json ?? null };
      }
      if (call === RUNS) {
        const r = runs(clock.elapsed());
        if (r === 'down') return { status: 503, headers, json: async () => ({ message: 'down' }) };
        return { status: 200, headers, json: async () => ({ total_count: r.length, workflow_runs: r }) };
      }
      const m = /\/actions\/runs\/(\d+)$/.exec(u.pathname);
      if (m) {
        const r = one(Number(m[1]), clock.elapsed());
        return r ? { status: 200, headers, json: async () => r } : { status: 404, headers, json: async () => ({ message: 'Not Found' }) };
      }
      return { status: 404, headers, json: async () => ({ message: 'Not Found' }) };
    };
    const drive = async (script, { file, ceilings } = {}) => {
      const seen = [];
      const logs = [];
      let nowMs = Date.UTC(2026, 8, 22, 9, 4, 0);
      const t0 = nowMs;
      const clock = { now: () => nowMs, elapsed: () => nowMs - t0 };
      const pace = paceFor(file ?? join(dir, `pace-${paceCase++}.jsonl`));
      try {
        const r = await sendFleetWrite(payload, {
          fetch: platform(script, seen, clock),
          token: TOKEN,
          pace,
          now: clock.now,
          sleep: async (ms) => {
            nowMs += ms;
          },
          log: (l) => logs.push(l),
          ceilings: ceilings ?? { startMs: 90_000, ceilingMs: 300_000, pollMs: 5_000, notes: [] },
        });
        return { ...r, seen, logs, pace };
      } catch (e) {
        if (e?.throttleExit === undefined) throw e;
        return { state: 'throttled', ok: false, exitCode: e.throttleExit, seen, logs, pace, throttled: true };
      }
    };
    const RUN = (status, conclusion = null) => ({ id: 42, display_title: 'fleet-write fw-test-1', name: 'Fleet Write', html_url: 'https://github.test/run/42', status, conclusion });

    // ── the dispatch ────────────────────────────────────────────────────────
    battery('the dispatch: one paced POST to the board repo with event_type and client_payload; 204 is acceptance, anything else a refusal');
    {
      const ok = await drive({ runs: (ms) => (ms >= 10_000 ? [RUN('completed', 'success')] : []) }, { file: paceFile });
      t('the POST goes to the BOARD repo, whatever the target', ok.seen[0].call, DISPATCH);
      t('…with event_type fleet-write and the payload as client_payload, under the session token', [ok.seen[0].body, ok.seen[0].auth], [{ event_type: RELAY_EVENT_TYPE, client_payload: payload }, `Bearer ${TOKEN}`]);
      t('…exactly ONE dispatch per stroke, however long the wait', ok.seen.filter((s) => s.call === DISPATCH).length, 1);
      const refused = await drive({ dispatch: { status: 404, json: { message: 'Not Found' } } });
      t('a 404 on the dispatch is refused — nothing ran, no run list read, exit 5', [refused.state, refused.seen.length, exitForResult(refused)], ['refused', 1, EXIT_PLATFORM_REFUSAL]);
      const dead = await drive({ dispatch: { status: 401, json: { message: 'Bad credentials' } } });
      t('a 401 is a prerequisite failure (exit 3)', [dead.state, exitForResult(dead)], ['refused', EXIT_PREREQUISITE]);
      const down = await drive({ dispatch: { throws: 'ECONNRESET' } });
      t('an unreachable platform is refused with status 0, and the lease was released', [down.state, down.status, existsSync(`${down.pace.file}.lease`)], ['refused', 0, false]);
      const exhausted = await drive({ dispatch: { status: 403, rateRemaining: '0', json: { message: 'API rate limit exceeded' } } });
      const after = await drive({ runs: () => [RUN('completed', 'success')] }, { file: exhausted.pace.file });
      t('a rate-limit refusal writes the stop marker and the NEXT dispatch on that log is refused before it leaves', [exitForResult(exhausted), after.throttled, after.seen.length], [EXIT_PREREQUISITE, true, 0]);
    }

    // ── the run-poller ──────────────────────────────────────────────────────
    battery('the run-poller: the run named after the request id, its completion, its conclusion');
    {
      t('a run is matched by its display_title carrying the request id', runMatches({ display_title: 'fleet-write fw-test-1' }, 'fw-test-1'));
      t('…or by its name, and never by a different id', [runMatches({ name: 'fleet-write fw-test-1' }, 'fw-test-1'), runMatches({ display_title: 'fleet-write fw-test-2' }, 'fw-test-1')], [true, false]);
      const slow = await drive({
        runs: (ms) => (ms >= 20_000 ? [{ ...RUN('queued'), id: 42 }] : []),
        one: (id, ms) => (id === 42 ? RUN(ms >= 60_000 ? 'completed' : 'in_progress', ms >= 60_000 ? 'success' : null) : null),
      }, { file: paceFile });
      t('a run that appears after 20 s and completes after 60 s is success, with its url', [slow.state, slow.ok, slow.run?.url], ['success', true, 'https://github.test/run/42']);
      t('…the list was polled until the run appeared, then the run itself until it completed', [slow.seen.filter((s) => s.call === RUNS).length >= 4, slow.seen.some((s) => s.call.endsWith('/actions/runs/42'))], [true, true]);
      t('…and the list is filtered to repository_dispatch runs created around the dispatch', slow.seen.find((s) => s.call === RUNS).query.includes('event=repository_dispatch') && slow.seen.find((s) => s.call === RUNS).query.includes('created='));
      const failed = await drive({ runs: () => [RUN('completed', 'failure')] });
      t('a run that completed with failure is `failure`, exit 5 — ⛔ never a fall-back candidate', [failed.state, failed.ok, exitForResult(failed)], ['failure', false, EXIT_PLATFORM_REFUSAL]);
    }

    // ── the ceilings ────────────────────────────────────────────────────────
    battery('the ceilings: no run in the start window, no completion in the ceiling — UNCONFIRMED, never retried');
    {
      const none = await drive({ runs: () => [] });
      t('no run within the start window is `no-run`, exit 6', [none.state, exitForResult(none)], ['no-run', EXIT_UNCONFIRMED]);
      t('…after ONE dispatch, and it says how long it waited', [none.seen.filter((s) => s.call === DISPATCH).length, unconfirmedText(none).includes('90000 ms')], [1, true]);
      t('…and the fall-back line names the shape (no listening workflow) and the double-write risk', fallbackText(none).includes('listening workflow') && fallbackText(none).includes('second one'));
      const stuck = await drive({ runs: () => [RUN('in_progress')], one: () => RUN('in_progress') });
      t('a run that never completes within the ceiling is `timeout`, exit 6, with the run url', [stuck.state, exitForResult(stuck), unconfirmedText(stuck).includes('https://github.test/run/42')], ['timeout', EXIT_UNCONFIRMED, true]);
      t('…and the sentence says not to retry blind', unconfirmedText(stuck).includes('do not re-run'));
      const listDown = await drive({ runs: () => 'down' });
      t('a run list that cannot be read is `no-run` flagged unreadable, never a silent no', [listDown.state, listDown.listUnreadable, listDown.logs.some((l) => l.includes('could not be read'))], ['no-run', true, true]);
      t('the ceilings read the environment with malformed overrides ignored and said', [ceilingsFrom({ OS_FLEET_DISPATCH_START_MS: '10', OS_FLEET_DISPATCH_TIMEOUT_MS: 'soon' }).startMs, ceilingsFrom({ OS_FLEET_DISPATCH_TIMEOUT_MS: 'soon' }).ceilingMs, ceilingsFrom({ OS_FLEET_DISPATCH_TIMEOUT_MS: 'soon' }).notes.length], [10, DEFAULT_CEILING_MS, 1]);
    }

    // ── the wiring ──────────────────────────────────────────────────────────
    battery('the wiring: the POST is paced and on the roster, the reads are not, the token never reaches the log');
    {
      const { WIRED_WRITE_TOOLS } = await import('../write-pace.mjs');
      const own = readReal(SELF_PATH, 'utf8');
      t('write-pace lists this file among the wired write tools', WIRED_WRITE_TOOLS.includes('scripts/pm/fleet-write/dispatch.mjs'));
      t('this file calls both halves, guarded by the write-verb predicate', own.includes('paceWrite(') && own.includes('noteResponse(') && own.includes('isWriteMethod('));
      const records = readReal(paceFile, 'utf8');
      t('the dispatches above were paced; the run-list and run reads were not', [records.includes('fleet-write dispatch POST'), records.includes('fleet-write dispatch GET')], [true, false]);
      t('⛔ and the token never reached the throttle\'s log', records.includes(TOKEN), false);
    }

    // ── the CLI ─────────────────────────────────────────────────────────────
    battery('the CLI: a dry run sends nothing, usage, the exit ladder');
    {
      writeFileSync(join(dir, 'actions.json'), JSON.stringify(ACTIONS), 'utf8');
      writeFileSync(join(dir, 'bad.json'), JSON.stringify([{ op: 'merge', pull: 1 }]), 'utf8');
      const env = (extra) => ({ ...process.env, GITHUB_TOKEN: TOKEN, GH_TOKEN: '', HTTPS_PROXY: '', https_proxy: '', OS_PM_WRITE_PACE_FILE: join(dir, 'cli-pace.jsonl'), [SESSION_ENV]: SESSION, ...extra });
      const spawn = (args, extra = {}) => spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: 'utf8', env: env(extra) });
      const dry = spawn(['--repo', 'objectstack-ai/objectstack', '--actions-file', join(dir, 'actions.json'), '--dry-run']);
      t('--dry-run packs, prints the payload and sends nothing (exit 0, no pace record)', [dry.status, dry.stdout.includes('"event_type"') && dry.stdout.includes('fw-'), existsSync(join(dir, 'cli-pace.jsonl'))], [EXIT_OK, true, false], dry.stderr.slice(-300));
      t('a refused actions file is usage (2) with the reasons, nothing sent', [spawn(['--repo', 'objectstack-ai/objectstack', '--actions-file', join(dir, 'bad.json'), '--dry-run']).status, spawn(['--repo', 'objectstack-ai/objectstack', '--actions-file', join(dir, 'bad.json'), '--dry-run']).stderr.includes('REFUSED')], [EXIT_USAGE, true]);
      t('no --actions-file is usage', spawn(['--repo', 'objectstack-ai/objectstack']).status, EXIT_USAGE);
      t('an unknown flag is usage', spawn(['--repo', 'o/r', '--actions-file', join(dir, 'actions.json'), '--dry-run', '--bogus']).status, EXIT_USAGE);
      const noSession = spawn(['--repo', 'objectstack-ai/objectstack', '--actions-file', join(dir, 'actions.json'), '--dry-run'], { [SESSION_ENV]: '' });
      t('no session is exit 3 naming the variable — even on a dry run, the envelope needs it', [noSession.status, noSession.stderr.includes(SESSION_ENV)], [EXIT_PREREQUISITE, true]);
      t('⛔ no spawned run printed the token', [dry, noSession].some((r) => `${r.stdout}${r.stderr}`.includes(TOKEN)), false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
    console.error(`✗ fleet-write/dispatch self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(
    `✓ fleet-write/dispatch self-test: ${cases.length} cases pass across ${declared.length} batteries — the transport selector that never guesses, ` +
      'the session on the envelope, one paced dispatch per stroke, a run found by its request id and waited to its conclusion, both ceilings answered UNCONFIRMED and never retried.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch (the CLI)
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { repo: null, actionsFile: null, session: null, requestId: null, dryRun: false, json: false, selfTest: false, help: false, errors: [] };
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
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--repo') opts.repo = value(a);
    else if (a === '--actions-file') opts.actionsFile = value(a);
    else if (a === '--session') opts.session = value(a);
    else if (a === '--request-id') opts.requestId = value(a);
    else if (a.startsWith('--') && a.includes('=')) {
      const [k, ...rest] = a.split('=');
      args.unshift(k, rest.join('='));
    } else opts.errors.push(`unrecognised argument ${JSON.stringify(a)}`);
  }
  if (!opts.selfTest && !opts.help) {
    if (!opts.repo) opts.errors.push('--repo owner/name is required (the TARGET repo)');
    if (!opts.actionsFile) opts.errors.push('--actions-file <path> is required — a JSON array of actions');
  }
  return opts;
}

const USAGE = [
  'usage:',
  '  node scripts/pm/fleet-write/dispatch.mjs --repo owner/name --actions-file actions.json [--session session_…] [--request-id id] [--json]',
  '  node scripts/pm/fleet-write/dispatch.mjs --repo owner/name --actions-file actions.json --dry-run',
  '  node scripts/pm/fleet-write/dispatch.mjs --self-test',
  '',
  `  The session comes from --session or ${SESSION_ENV}. The dispatch always goes to ${RELAY_REPO}; --repo names the target.`,
  `  Exits: ${EXIT_OK} run succeeded · ${EXIT_USAGE} usage / payload refused · ${EXIT_PREREQUISITE} prerequisite · ${EXIT_PLATFORM_REFUSAL} dispatch refused or run failed ·`,
  `         ${EXIT_UNCONFIRMED} UNCONFIRMED (no run, or no completion within the ceiling) · ${EXIT_WRITE_PACE_REFUSED} throttle refused`,
].join('\n');

function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
    guard: PROXY_REARM_GUARD,
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — the dispatch will bypass the proxy.`);
  return null;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (opts.selfTest) return selfTest();
  if (opts.errors.length) {
    for (const e of opts.errors) console.error(`fleet-write/dispatch: ${e}`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  let actions;
  try {
    actions = JSON.parse(readFileSync(opts.actionsFile, 'utf8'));
  } catch (e) {
    console.error(`fleet-write/dispatch: --actions-file ${opts.actionsFile} cannot be read as JSON (${e?.message ?? 'unreadable'}). Nothing was sent.`);
    return EXIT_USAGE;
  }
  const session = opts.session ?? sessionFrom(process.env);
  if (!session || !SESSION_SHAPE.test(session)) {
    console.error(`fleet-write/dispatch: PREREQUISITE NOT MET — no session id: pass --session session_… or set ${SESSION_ENV}. The envelope carries the dispatching seat's identity; it is never invented. Nothing was sent.`);
    return EXIT_PREREQUISITE;
  }
  const packed = packRequest({ repo: opts.repo, session, actions, requestId: opts.requestId });
  if (!packed.ok) {
    console.error(refusalText(packed.errors));
    console.error('fleet-write/dispatch: nothing was sent.');
    return EXIT_USAGE;
  }
  if (opts.dryRun) {
    console.error(`fleet-write/dispatch: DRY RUN — nothing sent. This is the request POST /repos/${RELAY_REPO}/dispatches would carry:`);
    console.log(JSON.stringify({ event_type: RELAY_EVENT_TYPE, client_payload: packed.payload }, null, 2));
    return EXIT_OK;
  }
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  if (!token) {
    console.error('fleet-write/dispatch: PREREQUISITE NOT MET — no GITHUB_TOKEN / GH_TOKEN in the environment. Nothing was sent.');
    return EXIT_PREREQUISITE;
  }
  const rearmed = rearmThroughProxy(argv);
  if (rearmed !== null) return rearmed;
  const result = await sendFleetWrite(packed.payload, { token });
  if (!result.ok && (result.state === 'no-run' || result.state === 'timeout')) console.error(unconfirmedText(result, 'scripts/pm/fleet-write/dispatch.mjs'));
  if (opts.json) console.log(JSON.stringify({ request_id: packed.payload.request_id, state: result.state, ok: result.ok, run: result.run, dispatched_at: new Date(result.dispatchedAt).toISOString() }));
  return result.ok ? EXIT_OK : exitForResult(result);
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\n✗ fleet-write/dispatch self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
        'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}
