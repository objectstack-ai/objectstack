#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * rerun-failed — re-run the FAILED jobs of one `ci.yml` pull-request run, ONCE, as
 * `objectstack-fleet[bot]`, through the fleet-write relay's `run_rerun_failed` op.
 *
 *   node scripts/pm/rerun-failed.mjs --run 39713789453                       # a run on the board repo
 *   node scripts/pm/rerun-failed.mjs --run ID --repo objectstack-ai/<name>   # a run on another fleet repository
 *   node scripts/pm/rerun-failed.mjs --run ID --dry-run                      # read, judge and pack; send nothing
 *   node scripts/pm/rerun-failed.mjs --run ID --json                         # the outcome as one JSON line on stdout
 *   node scripts/pm/rerun-failed.mjs --self-test                             # offline, no network
 *
 * ## When a seat may run it
 *
 * pm-dispatch `references/platform-readings.md` carries the rule. A seat may
 * re-run a PR's failed `ci.yml` jobs ONCE through this tool. It may do so only
 * after it has written down, on the PR or the card, why it judges the failure a
 * flake, and a second failure is real. ⛔ A dev never re-runs.
 *
 * ## What it does, in order
 *
 *   1. It reads the run (`GET /repos/{repo}/actions/runs/{id}`) and judges the
 *      four fences on the run with the predicates the relay's executor uses
 *      (`RERUN_FAILED_FENCES` in `fleet-write/ops.mjs`): the workflow, the
 *      event, once, failed. A run that fails one is REFUSED here (exit 2) with
 *      every failing fence named and nothing sent. It then reads attempt 1's
 *      job list and names the jobs that failed there, which are what the
 *      relay's read-back looks for. A list with no failed job is refused the
 *      same way. ⛔ This check is ADVISORY: an early refusal with its reason.
 *      The executor judges the four fences again on the run it reads
 *      immediately before its POST, and that check is the authoritative one;
 *      a pass here never stands in for it.
 *   2. It packs ONE action, `{ op: 'run_rerun_failed', run_id }`, which the
 *      shared validator judges (alone in its stroke, `run_id` alone), and
 *      sends it as ONE `repository_dispatch` (`fleet-write/dispatch.mjs`'s
 *      `sendFleetWrite`), which waits for the relay's run.
 *   3. After a `success` run it reads the run back at the seat, its attempt
 *      and attempt 2's re-run jobs, and prints their ids. That is a READING
 *      for the seat's note, never a verdict: the executor's own read-back
 *      landed the action. After a FAILED run it re-reads the run and prints
 *      what the fences say now, so the seat learns why without the job log it
 *      cannot read.
 *
 * ## RELAY-ONLY
 *
 * The re-run lands as the fleet through the relay or it does not land. The
 * relay's token is minted with `actions: write` for this stroke alone, and its
 * executor is where the fences are authoritative, so ⛔ there is no direct
 * path. A route that resolves to `direct` (a developer's machine,
 * `OS_FLEET_TRANSPORT=direct`, a relay the board has switched off) is a
 * PREREQUISITE refusal, exit 3, with zero writes. An accepted dispatch with no
 * run, or none completed, is UNCONFIRMED, exit 6, and never a direct write
 * after it. `fleet-write/dispatch.mjs`'s no-run conformance drives this file's
 * `relayMissProbe`, and its relay-only control pins the direct refusal
 * (`relayOnly` below).
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0   the relay's run succeeded, so attempt 2 started with its failed jobs
 *       queued or in progress; with `--dry-run`, the fences hold and the
 *       payload is printed, nothing sent.
 *   2   usage, a fence the run fails or a run with no failed job (advisory,
 *       nothing sent), or the payload refused by the validator.
 *   3   PREREQUISITE NOT MET — no token, the run or its jobs unreadable, no
 *       session, or a route that is not the relay. Nothing sent.
 *   5   the dispatch was refused, or the relay's run FAILED: its executor
 *       refused at a fence, or the re-run did not read back. Go READ the run;
 *       ⛔ do not re-send blind (a re-send after a landing meets the once fence).
 *   6   UNCONFIRMED — no run, or none completed within the ceiling. Go READ
 *       the run; ⛔ do not re-send blind.
 *  10   the write throttle refused the dispatch.
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { EXIT_PREREQUISITE_NOT_MET, PROXY_FLAG, proxyRearmPlan } from './check-half-states.mjs';
import { EXIT_UNCONFIRMED, exitForResult, packRequest, resolveRoute, sendFleetWrite, sessionFrom, unconfirmedText } from './fleet-write/dispatch.mjs';
import {
  RELAY_EVENT_TYPE,
  RELAY_REPO,
  RERUN_FAILED_ATTEMPT,
  RERUN_FAILED_RERUN_STATES,
  TARGET_REPO_SHAPE,
  failedJobNames,
  rerunFailedFenceFailures,
  rerunFailedFenceText,
} from './fleet-write/ops.mjs';
import { refusalText } from './fleet-write/validate.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOOL = 'scripts/pm/rerun-failed.mjs';
const PROXY_REARM_GUARD = 'OS_RERUN_FAILED_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = EXIT_PREREQUISITE_NOT_MET;
export const EXIT_PLATFORM_REFUSAL = 5;
export { EXIT_UNCONFIRMED };

/**
 * This sender has no direct path: `fleet-write/dispatch.mjs`'s no-run conformance reads this export and holds
 * the control to a refusal under `direct` — zero writes, no dispatch — instead of a direct write.
 */
export const relayOnly = true;

/** The op this tool sends — the relay table's row, spelled once here. */
export const OP = 'run_rerun_failed';

/** The page size and cap of the job-list reads — the endpoint's maximum, and a walk past the cap is refused. */
export const JOBS_PAGE_SIZE = 100;
export const JOBS_PAGE_CAP = 10;

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const shortSha = (sha) => (typeof sha === 'string' ? sha.slice(0, 7) : '?');

/** The command line, judged. Returns `{ ok, options }` or `{ ok: false, error }`. Pure. */
export function parseOptions(argv) {
  const options = { run: null, repo: RELAY_REPO, dryRun: false, json: false };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    const value = () => {
      const v = args.shift();
      return v === undefined || v.startsWith('--') ? null : v;
    };
    if (a === '--run') {
      const v = value();
      if (v === null || !/^[1-9][0-9]*$/.test(v) || !Number.isSafeInteger(Number(v))) return { ok: false, error: `--run needs a workflow run id, a positive integer — got ${JSON.stringify(v)}` };
      options.run = Number(v);
    } else if (a === '--repo') {
      const v = value();
      if (v === null || !TARGET_REPO_SHAPE.test(v) || v.includes('..')) return { ok: false, error: `--repo needs objectstack-ai/<name> — got ${JSON.stringify(v)}` };
      options.repo = v;
    } else if (a === '--dry-run') options.dryRun = true;
    else if (a === '--json') options.json = true;
    else return { ok: false, error: `unrecognised argument ${JSON.stringify(a)}` };
  }
  if (options.run === null) return { ok: false, error: '--run <run id> is required — the run whose failed jobs to re-run' };
  return { ok: true, options };
}

/** One line about the run, for the transcript: what it is, where it stands, and which pull request head it ran on. Pure. */
export function runLine(repo, run) {
  const pulls = Array.isArray(run?.pull_requests) && run.pull_requests.length ? ` · pull ${run.pull_requests.map((p) => `#${p?.number ?? '?'}`).join(', ')}` : '';
  return `run ${run?.id ?? '?'} on ${repo} — ${run?.name ?? '?'} (${run?.path ?? '?'}) · event ${run?.event ?? '?'} · attempt ${run?.run_attempt ?? '?'} · ${run?.status ?? '?'}/${run?.conclusion ?? 'none'} · head ${shortSha(run?.head_sha)}${pulls}`;
}

/** The jobs of an attempt listed `queued` or `in_progress` — the re-run's own jobs, for the seat's reading. Pure. */
export function rerunJobs(jobs) {
  return (Array.isArray(jobs) ? jobs : []).filter((j) => RERUN_FAILED_RERUN_STATES.includes(j?.status)).map((j) => ({ name: j.name, id: j.id, status: j.status }));
}

// ---------------------------------------------------------------------------
// Transport — reads only. ⛔ This file issues no write of its own: the one write is the dispatch, sent and paced by
// `sendFleetWrite`. Nothing here throws on an HTTP status.
// ---------------------------------------------------------------------------

function liveCall(token) {
  return async (path) => {
    let res;
    try {
      res = await fetch(`${API}${path}`, { headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    } catch (e) {
      return { status: 0, json: null, detail: e?.message ?? 'fetch threw', call: `GET ${path}` };
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json, detail: typeof json?.message === 'string' ? json.message : '', call: `GET ${path}` };
  };
}

/** One attempt's job list, every page: `{ jobs }` or `{ fail }` — the sentence. Never throws. */
async function readJobs(call, repo, runId, attempt) {
  const jobs = [];
  for (let page = 1; page <= JOBS_PAGE_CAP; page++) {
    const r = await call(`/repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=${JOBS_PAGE_SIZE}&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json?.jobs)) return { fail: `${r.call} -> HTTP ${r.status}${r.detail ? ` (${r.detail})` : ''}: attempt ${attempt}'s job list could not be read` };
    jobs.push(...r.json.jobs);
    const total = Number.isInteger(r.json.total_count) ? r.json.total_count : null;
    if (r.json.jobs.length < JOBS_PAGE_SIZE || (total !== null && jobs.length >= total)) return { jobs };
  }
  return { fail: `attempt ${attempt}'s job list hit its ${JOBS_PAGE_CAP}-page cap with more pending — a truncated list is a SUBSET` };
}

/** The run, read: `{ run }` or `{ fail }`. Never throws. */
async function readRun(call, repo, runId) {
  const r = await call(`/repos/${repo}/actions/runs/${runId}`);
  if (r.status !== 200 || !isObject(r.json)) return { fail: `${r.call} -> HTTP ${r.status}${r.detail ? ` (${r.detail})` : ''}: the run could not be read` };
  return { run: r.json };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * The whole tool, every dependency injectable: `call(path)` answers a GET, `route` the transport (resolved when
 * absent), `send(payload, deps)` the relay (`sendFleetWrite` when absent), `env` the session source for a dry run.
 * Returns `{ exit, ... }` — never throws on an HTTP status.
 */
export async function runRerunFailed(options, deps = {}) {
  const log = deps.log ?? ((l) => console.error(l));
  const env = deps.env ?? process.env;
  const token = deps.token ?? env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '';
  const call = deps.call ?? liveCall(token);
  const { run: runId, repo } = options;
  const out = { repo, run: runId, exit: null, fences: [], failed: [], transport: null, relay: null, reading: null };

  // ── 1. the fences, advisory ────────────────────────────────────────────────
  const read = await readRun(call, repo, runId);
  if (read.fail) {
    log(`rerun-failed: PREREQUISITE NOT MET — ${read.fail}. ⛔ NOT MEASURED: no fence was judged and nothing was sent.`);
    return { ...out, exit: EXIT_PREREQUISITE };
  }
  log(`rerun-failed: ${runLine(repo, read.run)}`);
  const failures = rerunFailedFenceFailures(read.run);
  if (failures.length) {
    log(`rerun-failed: REFUSED before the dispatch — ${rerunFailedFenceText(failures)}. The relay judges the same fences on the run again and would refuse it too. ⛔ Nothing sent.`);
    return { ...out, fences: failures, exit: EXIT_USAGE };
  }
  const baseline = await readJobs(call, repo, runId, RERUN_FAILED_ATTEMPT);
  if (baseline.fail) {
    log(`rerun-failed: PREREQUISITE NOT MET — ${baseline.fail}, so the jobs the re-run would confirm are unknown. ⛔ Nothing sent.`);
    return { ...out, exit: EXIT_PREREQUISITE };
  }
  const failed = failedJobNames(baseline.jobs);
  if (!failed.length) {
    log(`rerun-failed: REFUSED before the dispatch — attempt ${RERUN_FAILED_ATTEMPT} lists ${baseline.jobs.length} job(s) and none concluded failure, so the relay's read-back would have nothing to confirm and the relay refuses it. ⛔ Nothing sent.`);
    return { ...out, exit: EXIT_USAGE };
  }
  log(`rerun-failed: the four fences hold (advisory — the relay judges them again on the run it reads before its POST); attempt ${RERUN_FAILED_ATTEMPT} failed ${failed.map((n) => `\`${n}\``).join(', ')}.`);
  const action = { op: OP, run_id: runId };

  // ── 2. the stroke — relay-only ─────────────────────────────────────────────
  if (options.dryRun) {
    const session = sessionFrom(env);
    if (!session) {
      log('rerun-failed: PREREQUISITE NOT MET — no session id for the envelope (OS_FLEET_SESSION, or the cloud container\'s own). ⛔ Nothing sent.');
      return { ...out, failed, exit: EXIT_PREREQUISITE };
    }
    const packed = packRequest({ repo, session, actions: [action] });
    if (!packed.ok) {
      log(refusalText(packed.errors));
      return { ...out, failed, exit: EXIT_USAGE };
    }
    log('rerun-failed: DRY RUN — nothing sent. This is the relay request the dispatch would carry:');
    return { ...out, failed, exit: EXIT_OK, dryRun: { event_type: RELAY_EVENT_TYPE, client_payload: packed.payload } };
  }
  const route = deps.route ?? (await resolveRoute(env));
  out.transport = route.transport ?? null;
  if (route.error) {
    log(`rerun-failed: PREREQUISITE NOT MET — ${route.error} ⛔ Nothing sent.`);
    return { ...out, failed, exit: EXIT_PREREQUISITE };
  }
  if (route.transport !== 'dispatch') {
    log(
      `rerun-failed: PREREQUISITE NOT MET — the route is ${route.transport ?? 'unresolved'} (${route.reason}), and this op is RELAY-ONLY: the relay's token alone carries actions write for it, ` +
        'and its executor alone is where the fences are authoritative. ⛔ Not falling back to a direct write — that would be a re-run booked against the personal account. Nothing sent.',
    );
    return { ...out, failed, exit: EXIT_PREREQUISITE };
  }
  log(`rerun-failed: transport dispatch — ${route.reason}`);
  const packed = packRequest({ repo, session: route.session, actions: [action] });
  if (!packed.ok) {
    log(refusalText(packed.errors));
    return { ...out, failed, exit: EXIT_USAGE };
  }
  const send = deps.send ?? sendFleetWrite;
  const result = await send(packed.payload, { token, log, ...(deps.sendDeps ?? {}) });
  out.relay = { state: result.state, run: result.run ?? null, requestId: result.requestId ?? packed.payload.request_id };

  // ── 3. the outcome, read at the seat ───────────────────────────────────────
  if (!result.ok) {
    if (result.state === 'no-run' || result.state === 'timeout') {
      log(unconfirmedText(result, TOOL));
      return { ...out, failed, exit: EXIT_UNCONFIRMED };
    }
    if (result.state === 'failure') {
      const now = await readRun(call, repo, runId);
      const why = now.fail ? `${now.fail} either` : `${runLine(repo, now.run)}; ${rerunFailedFenceFailures(now.run).length ? `the fences now read: ${rerunFailedFenceText(rerunFailedFenceFailures(now.run))}` : 'the four fences still hold, so the relay refused or the re-run did not read back for another reason — read the relay run'}`;
      log(`rerun-failed: ✗ the relay's run FAILED (${result.detail ?? 'conclusion failure'})${result.run?.url ? ` ${result.run.url}` : ''} — its executor refused at a fence, or the re-run did not read back as attempt ${RERUN_FAILED_ATTEMPT + 1}. Read now: ${why}. ⛔ Do not re-send blind.`);
      return { ...out, failed, exit: exitForResult(result) };
    }
    log(`rerun-failed: ✗ the relay answered ${result.state}${result.detail ? ` (${result.detail})` : ''}. ⛔ Do not re-send blind.`);
    return { ...out, failed, exit: exitForResult(result) };
  }
  const after = await readRun(call, repo, runId);
  const jobs = after.run && after.run.run_attempt === RERUN_FAILED_ATTEMPT + 1 ? await readJobs(call, repo, runId, RERUN_FAILED_ATTEMPT + 1) : { fail: after.fail ?? `the run reads attempt ${after.run?.run_attempt ?? '?'}` };
  const reading = jobs.jobs ? rerunJobs(jobs.jobs) : null;
  out.reading = { attempt: after.run?.run_attempt ?? null, jobs: reading, why: jobs.fail ?? null };
  log(
    `rerun-failed: ✓ the relay re-ran run ${runId}'s failed jobs (its executor read attempt ${RERUN_FAILED_ATTEMPT + 1} back before it called the action landed)${result.run?.url ? ` — relay run ${result.run.url}` : ''}. ` +
      (reading ? `Reading now: attempt ${after.run.run_attempt} · ${reading.length ? reading.map((j) => `\`${j.name}\` job ${j.id} ${j.status}`).join(', ') : 'no job queued or in progress any more'}.` : `Reading now: ${jobs.fail} — a reading, not a verdict; the relay's row holds the job ids.`),
  );
  return { ...out, failed, exit: EXIT_OK };
}

// ---------------------------------------------------------------------------
// The no-run conformance probe (`fleet-write/dispatch.mjs`, its header's section of that name)
// ---------------------------------------------------------------------------

const PROBE_RUN = 39713789453;

/** An offline board for the probe and the self-test: a run and its two attempts' job lists, every read recorded. */
function fakeBoard({ run = {}, attempt1 = null, attempt2 = null, after = null } = {}) {
  const calls = [];
  const REPO = RELAY_REPO;
  // `run: null` is a run the platform does not answer for; an object patches the measured run.
  const base = run === null ? null : { id: PROBE_RUN, name: 'CI', path: '.github/workflows/ci.yml', event: 'pull_request', run_attempt: 1, status: 'completed', conclusion: 'failure', head_sha: '25b3a6c4bff905d462d4ff44030e5465c342254a', pull_requests: [{ number: 25155 }], ...run };
  const jobs1 = attempt1 ?? [
    { id: 119611140808, name: 'Test Core (3/6)', run_attempt: 1, status: 'completed', conclusion: 'failure' },
    { id: 119611140839, name: 'Test Core (1/6)', run_attempt: 1, status: 'completed', conclusion: 'success' },
    { id: 119617410962, name: 'Test Core', run_attempt: 1, status: 'completed', conclusion: 'failure' },
  ];
  const jobs2 = attempt2 ?? [
    { id: 119642047246, name: 'Test Core (3/6)', run_attempt: 2, status: 'queued', conclusion: null },
    { id: 119642048282, name: 'Test Core (1/6)', run_attempt: 2, status: 'completed', conclusion: 'success' },
  ];
  let runReads = 0;
  const call = async (path) => {
    calls.push(`GET ${path.split('?')[0]}`);
    const p = path.split('?')[0];
    if (p === `/repos/${REPO}/actions/runs/${PROBE_RUN}`) {
      runReads += 1;
      const json = runReads > 1 && after && base ? { ...base, ...after } : base;
      return json === null ? { status: 404, json: { message: 'Not Found' }, detail: 'Not Found', call: `GET ${p}` } : { status: 200, json, detail: '', call: `GET ${p}` };
    }
    if (p === `/repos/${REPO}/actions/runs/${PROBE_RUN}/attempts/1/jobs`) return jobs1 === 'unread' ? { status: 403, json: { message: 'Forbidden' }, detail: 'Forbidden', call: `GET ${p}` } : { status: 200, json: { total_count: jobs1.length, jobs: jobs1 }, detail: '', call: `GET ${p}` };
    if (p === `/repos/${REPO}/actions/runs/${PROBE_RUN}/attempts/2/jobs`) return { status: 200, json: { total_count: jobs2.length, jobs: jobs2 }, detail: '', call: `GET ${p}` };
    return { status: 404, json: { message: 'Not Found' }, detail: 'Not Found', call: `GET ${p}` };
  };
  return { call, calls };
}

/**
 * The no-run conformance probe: ONE re-run through this tool's real path against the offline board, on the route and
 * the sender the conformance hands in. Answers the exit, every request that left this process directly
 * (`METHOD /path` — reads only, by construction), and what the tool printed.
 */
export async function relayMissProbe({ route, send }) {
  const board = fakeBoard();
  const lines = [];
  const r = await runRerunFailed({ run: PROBE_RUN, repo: RELAY_REPO, dryRun: false, json: false }, { call: board.call, route, send, log: (l) => lines.push(l), env: {}, token: 'ghs_FixtureTokenNotRealAtAll0000000000000' });
  return { exit: r.exit, calls: [...board.calls], text: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Self-test — offline. The battery roster is the floor (AGENTS.md, "Writing a --self-test").
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the command line: --run a positive integer, --repo in the one organization, the board repo by default, anything else refused': 6,
  'the fences at the seat, advisory: the measured run passes all four; each failing fence refused by name with nothing sent; a run or job list that cannot be read, or one with no failed job, sends nothing': 8,
  'relay-only: a direct route, or a route that errs, refuses with zero writes and no dispatch; the dispatch route packs ONE action, run_id alone; --dry-run prints it and sends nothing': 5,
  "the outcomes: a success run is read back at the seat naming attempt 2's re-run job ids; a failed run re-reads the run and names what the fences say now, exit 5; no run or none completed is UNCONFIRMED, exit 6; never a second dispatch": 6,
  'the wiring: this file issues no write of its own, imports the fences rather than restating them, and declares itself relay-only': 3,
});
const SELF_TEST_BATTERY_FLOOR = 5;
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
  const SESSION = 'session_01ABCDEFGHJKMNPQRSTVWXYZ';
  const DISPATCH_ROUTE = { requested: 'auto', transport: 'dispatch', reason: 'self-test: dispatch', error: null, session: SESSION };
  const DIRECT_ROUTE = { requested: 'direct', transport: 'direct', reason: 'self-test: direct', error: null, session: null };
  const RELAY_RUN = { id: 42, url: 'https://github.test/run/42', status: 'completed' };
  /** A fake relay: counts dispatches and answers the shape `sendFleetWrite` returns for the outcome named. */
  const relay = (outcome, sent) => async (payload) => {
    sent.push(payload);
    const base = { requestId: payload.request_id, startMs: 90_000, ceilingMs: 300_000, status: 204, verdict: 'ok', dispatchedAt: 0 };
    if (outcome === 'success') return { ...base, state: 'success', ok: true, run: { ...RELAY_RUN, conclusion: 'success' }, detail: 'conclusion success' };
    if (outcome === 'failure') return { ...base, state: 'failure', ok: false, run: { ...RELAY_RUN, conclusion: 'failure' }, detail: 'conclusion failure' };
    if (outcome === 'timeout') return { ...base, state: 'timeout', ok: false, run: { ...RELAY_RUN, status: 'in_progress', conclusion: null }, detail: 'run 42 in_progress' };
    return { ...base, state: 'no-run', ok: false, run: null, detail: 'no run appeared' };
  };
  const drive = async (options, { board = {}, route = DISPATCH_ROUTE, outcome = 'success', env = {} } = {}) => {
    const b = fakeBoard(board);
    const sent = [];
    const lines = [];
    const r = await runRerunFailed({ run: PROBE_RUN, repo: RELAY_REPO, dryRun: false, json: false, ...options }, { call: b.call, route, send: relay(outcome, sent), log: (l) => lines.push(l), env, token: 'ghs_FixtureTokenNotRealAtAll0000000000000' });
    return { ...r, calls: b.calls, sent, text: lines.join('\n') };
  };
  const RUN_PATH = `GET /repos/${RELAY_REPO}/actions/runs/${PROBE_RUN}`;
  const A1_PATH = `GET /repos/${RELAY_REPO}/actions/runs/${PROBE_RUN}/attempts/1/jobs`;
  const A2_PATH = `GET /repos/${RELAY_REPO}/actions/runs/${PROBE_RUN}/attempts/2/jobs`;

  // ── the command line ──────────────────────────────────────────────────────
  battery('the command line: --run a positive integer, --repo in the one organization, the board repo by default, anything else refused');
  {
    t('--run alone: the board repo, no dry run', parseOptions(['--run', '39713789453']), { ok: true, options: { run: 39713789453, repo: RELAY_REPO, dryRun: false, json: false } });
    t('--repo names another fleet repository, --dry-run and --json are read', parseOptions(['--run', '7', '--repo', 'objectstack-ai/objectui', '--dry-run', '--json']).options, { run: 7, repo: 'objectstack-ai/objectui', dryRun: true, json: true });
    t('⛔ --run that is not a positive integer is refused — zero, a sign, a float, a word, nothing', ['0', '-1', '1.5', 'abc', '01'].map((v) => parseOptions(['--run', v]).ok).concat(parseOptions(['--run']).ok), [false, false, false, false, false, false]);
    t('⛔ no --run is refused, naming the flag', [parseOptions([]).ok, parseOptions([]).error?.includes('--run')], [false, true]);
    t('⛔ a repository outside the organization, or with a path, is refused', [parseOptions(['--run', '7', '--repo', 'someone/objectstack']).ok, parseOptions(['--run', '7', '--repo', 'objectstack-ai/a/b']).ok], [false, false]);
    t('⛔ an unknown flag is refused, never ignored — a workflow or an attempt is not this tool\'s to name', [parseOptions(['--run', '7', '--workflow', 'ci.yml']).ok, parseOptions(['--run', '7', '--attempt', '1']).ok], [false, false]);
  }

  // ── the fences at the seat ────────────────────────────────────────────────
  battery('the fences at the seat, advisory: the measured run passes all four; each failing fence refused by name with nothing sent; a run or job list that cannot be read, or one with no failed job, sends nothing');
  {
    const ok = await drive({});
    t('accepted: the measured run passes the four fences — the run read, then attempt 1\'s jobs — and the line names the failed jobs and the pull request head', [ok.exit, ok.calls.slice(0, 2), ok.text.includes('attempt 1 failed `Test Core (3/6)`, `Test Core`'), ok.text.includes('head 25b3a6c · pull #25155')], [EXIT_OK, [RUN_PATH, A1_PATH], true, true], ok.text);
    const fenced = async (run, fence) => {
      const r = await drive({}, { board: { run } });
      return [r.exit, r.sent.length, r.calls.length, r.text.includes(`fence \`${fence}\``) && r.text.includes('Nothing sent')];
    };
    t('⛔ fence workflow, refused at the seat: a run of lint.yml — exit 2, no dispatch, no further read', await fenced({ path: '.github/workflows/lint.yml' }, 'workflow'), [EXIT_USAGE, 0, 1, true]);
    t('⛔ fence event, refused at the seat: a merge_group run', await fenced({ event: 'merge_group' }, 'event'), [EXIT_USAGE, 0, 1, true]);
    t('⛔ fence once, refused at the seat: a run already at attempt 2 — a second failure is real', await fenced({ run_attempt: 2 }, 'once'), [EXIT_USAGE, 0, 1, true]);
    t('⛔ fence failed, refused at the seat: a run that succeeded', await fenced({ conclusion: 'success' }, 'failed'), [EXIT_USAGE, 0, 1, true]);
    const unread = await drive({}, { board: { run: null } });
    t('a run that cannot be read is NOT MEASURED: exit 3, no dispatch', [unread.exit, unread.sent.length, unread.text.includes('NOT MEASURED')], [EXIT_PREREQUISITE, 0, true]);
    const noJobs = await drive({}, { board: { attempt1: 'unread' } });
    t('a job list that cannot be read: exit 3, no dispatch', [noJobs.exit, noJobs.sent.length], [EXIT_PREREQUISITE, 0]);
    const passed = await drive({}, { board: { attempt1: [{ id: 1, name: 'Test Core (1/6)', run_attempt: 1, status: 'completed', conclusion: 'success' }] } });
    t('⛔ a job list with no failed job: exit 2, no dispatch — the relay would refuse a re-run with nothing to confirm', [passed.exit, passed.sent.length, passed.text.includes('none concluded failure')], [EXIT_USAGE, 0, true]);
  }

  // ── relay-only ────────────────────────────────────────────────────────────
  battery('relay-only: a direct route, or a route that errs, refuses with zero writes and no dispatch; the dispatch route packs ONE action, run_id alone; --dry-run prints it and sends nothing');
  {
    const direct = await drive({}, { route: DIRECT_ROUTE });
    t('⛔ a direct route is a PREREQUISITE refusal: exit 3, no dispatch, the reads only, the line saying RELAY-ONLY and never a direct write', [direct.exit, direct.sent.length, direct.calls, direct.text.includes('RELAY-ONLY') && direct.text.includes('Not falling back')], [EXIT_PREREQUISITE, 0, [RUN_PATH, A1_PATH], true]);
    const erring = await drive({}, { route: { requested: 'dispatch', transport: 'dispatch', reason: 'x', error: 'OS_FLEET_TRANSPORT=dispatch but the relay is not live.', session: SESSION } });
    t('⛔ a route that errs is a PREREQUISITE refusal, its error printed, no dispatch', [erring.exit, erring.sent.length, erring.text.includes('the relay is not live')], [EXIT_PREREQUISITE, 0, true]);
    const sent = await drive({});
    t('the dispatch route sends ONE stroke of ONE action: op run_rerun_failed and run_id alone, the session on the envelope', [sent.sent.length, sent.sent[0]?.actions, sent.sent[0]?.session, sent.sent[0]?.repo], [1, [{ op: OP, run_id: PROBE_RUN }], SESSION, RELAY_REPO]);
    const dry = await drive({ dryRun: true }, { env: { OS_FLEET_SESSION: SESSION } });
    t('--dry-run: the fences read and judged, the relay request printed, nothing sent, exit 0', [dry.exit, dry.sent.length, dry.dryRun?.event_type, dry.dryRun?.client_payload?.actions], [EXIT_OK, 0, RELAY_EVENT_TYPE, [{ op: OP, run_id: PROBE_RUN }]]);
    const drySessionless = await drive({ dryRun: true }, { env: {} });
    t('⛔ --dry-run with no session id is exit 3 — the envelope carries the seat\'s identity and it is never invented', [drySessionless.exit, drySessionless.sent.length], [EXIT_PREREQUISITE, 0]);
  }

  // ── the outcomes ──────────────────────────────────────────────────────────
  battery("the outcomes: a success run is read back at the seat naming attempt 2's re-run job ids; a failed run re-reads the run and names what the fences say now, exit 5; no run or none completed is UNCONFIRMED, exit 6; never a second dispatch");
  {
    const landed = await drive({}, { board: { after: { run_attempt: 2, status: 'queued', conclusion: null } } });
    t('⭐ success: exit 0 after ONE dispatch, the run and attempt 2\'s jobs read back, the line naming the re-run job id', [landed.exit, landed.sent.length, landed.calls.slice(2), landed.text.includes('attempt 2 · `Test Core (3/6)` job 119642047246 queued'), landed.reading?.jobs], [EXIT_OK, 1, [RUN_PATH, A2_PATH], true, [{ name: 'Test Core (3/6)', id: 119642047246, status: 'queued' }]], landed.text);
    const unreadAfter = await drive({}, { board: { after: { run_attempt: 1 } } });
    t('…a reading that does not see attempt 2 at the seat is SAID, and the exit stays 0 — the executor\'s read-back is the verdict, this is a reading', [unreadAfter.exit, unreadAfter.text.includes('a reading, not a verdict')], [EXIT_OK, true]);
    const failed = await drive({}, { outcome: 'failure', board: { after: { run_attempt: 2, status: 'in_progress', conclusion: null } } });
    t('⛔ a failed relay run: exit 5, ONE dispatch, the run re-read and the fence that fails NOW named — here a person re-ran it first', [failed.exit, failed.sent.length, failed.text.includes('FAILED') && failed.text.includes('fence `once`: the run reads 2')], [EXIT_PLATFORM_REFUSAL, 1, true], failed.text);
    const failedHolding = await drive({}, { outcome: 'failure' });
    t('…and when the fences still hold, the line says to read the relay run, never to re-send', [failedHolding.exit, failedHolding.text.includes('read the relay run') && failedHolding.text.includes('Do not re-send blind')], [EXIT_PLATFORM_REFUSAL, true]);
    const noRun = await drive({}, { outcome: 'no-run' });
    const stuck = await drive({}, { outcome: 'timeout' });
    t('⛔ no run, or none completed: UNCONFIRMED exit 6 after ONE dispatch, the shared sentence printed', [[noRun.exit, noRun.sent.length, noRun.text.includes('UNCONFIRMED') && noRun.text.includes('do not re-run')], [stuck.exit, stuck.sent.length, stuck.text.includes('UNCONFIRMED')]], [[EXIT_UNCONFIRMED, 1, true], [EXIT_UNCONFIRMED, 1, true]]);
    const probe = await relayMissProbe({ route: DISPATCH_ROUTE, send: relay('no-run', []) });
    t('the conformance probe answers what the tool does: exit 6, reads only, the UNCONFIRMED sentence', [probe.exit, probe.calls.every((c) => c.startsWith('GET ')), probe.text.includes('UNCONFIRMED')], [EXIT_UNCONFIRMED, true, true]);
  }

  // ── the wiring ────────────────────────────────────────────────────────────
  battery('the wiring: this file issues no write of its own, imports the fences rather than restating them, and declares itself relay-only');
  {
    const { readFileSync } = await import('node:fs');
    const own = readFileSync(SELF_PATH, 'utf8');
    const code = own.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    t('⛔ no write verb in this file\'s code — its one write is the dispatch, which sendFleetWrite sends and paces', /\b(?:method|verb)\s*:\s*'(?:POST|PATCH|PUT|DELETE)'/.test(code), false);
    t('the fences are the relay table\'s, imported — no fence predicate or allowlist is spelled here', [/\brerunFailedFenceFailures\b/.test(own), /RERUN_FAILED_WORKFLOWS\s*=/.test(code), /'\.github\/workflows\/ci\.yml'\]/.test(code)], [true, false, false]);
    t('the relay-only declaration the conformance reads is set', relayOnly, true);
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

  const failedCases = cases.filter((c) => !c.ok);
  for (const c of failedCases) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failedCases.length) {
    console.error(`✗ rerun-failed self-test: ${failedCases.length} of ${cases.length} case(s) failed.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(
    `✓ rerun-failed self-test: ${cases.length} cases pass across ${declared.length} batteries — the four fences judged at the seat as an advisory refusal ` +
      'naming each failing one, nothing sent; relay-only, a direct route refused with zero writes; ONE dispatch of ONE action carrying run_id alone; ' +
      "a success read back naming attempt 2's job ids, a failure re-read and explained, and no run UNCONFIRMED — never a second dispatch.",
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const USAGE = [
  'usage:',
  '  node scripts/pm/rerun-failed.mjs --run <run id> [--repo objectstack-ai/<name>] [--dry-run] [--json]',
  '  node scripts/pm/rerun-failed.mjs --self-test',
  '',
  '  Re-runs the FAILED jobs of one ci.yml pull-request run, once, through the fleet-write relay (relay-only).',
  '  Only after the seat has written on the PR or the card why it judges the failure a flake; a second failure is real.',
  `  Exits: ${EXIT_OK} re-run started (or dry run) · ${EXIT_USAGE} usage / a fence refused / payload refused · ${EXIT_PREREQUISITE} prerequisite ·`,
  `         ${EXIT_PLATFORM_REFUSAL} dispatch refused or the relay run failed · ${EXIT_UNCONFIRMED} UNCONFIRMED · 10 throttle refused`,
].join('\n');

/** Route node's `fetch` through the session proxy before the first request — a re-exec, as every fleet tool does. */
function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({ env: process.env, execArgv: process.execArgv, flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG), guard: PROXY_REARM_GUARD });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], { stdio: 'inherit', env: { ...process.env, [PROXY_REARM_GUARD]: '1' } });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — every request will bypass the proxy.`);
  return null;
}

export async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (argv.includes('--self-test')) return selfTest();
  const parsed = parseOptions(argv);
  if (!parsed.ok) {
    console.error(`rerun-failed: ${parsed.error}\n`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  if (!(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)) {
    console.error('rerun-failed: PREREQUISITE NOT MET — no GITHUB_TOKEN / GH_TOKEN in the environment. ⛔ NOT MEASURED: nothing was read and nothing was sent.');
    return EXIT_PREREQUISITE;
  }
  const relayed = rearmThroughProxy(argv);
  if (relayed !== null) return relayed;
  const result = await runRerunFailed(parsed.options, {});
  if (result.dryRun) console.log(JSON.stringify(result.dryRun, null, 2));
  if (parsed.options.json) {
    console.log(JSON.stringify({ repo: result.repo, run: result.run, exit: result.exit, fences: result.fences, failed_jobs: result.failed, transport: result.transport, relay: result.relay, reading: result.reading }));
  }
  return result.exit;
}

// ⛔ No top-level await on main: this file imports `fleet-write/dispatch.mjs`, whose read-back imports post-stamped,
// which imports dispatch back — the entry settles first, as dispatch.mjs's own entry does.
if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
      console.error(
        '\n✗ rerun-failed self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
          'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  });
}
