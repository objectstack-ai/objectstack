#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fleet-write/execute — the relay's executor: the writes a validated payload
 * asked for, in order, as the fleet App, on a GitHub Actions runner.
 *
 *   FLEET_WRITE_PAYLOAD='…' FLEET_WRITE_SENDER=login GITHUB_TOKEN=… node scripts/pm/fleet-write/execute.mjs
 *   node scripts/pm/fleet-write/execute.mjs --payload-file payload.json      # the same, payload from disk
 *   node scripts/pm/fleet-write/execute.mjs --self-test                      # offline: a fake platform, no network
 *
 * ## Where this runs, and what it holds
 *
 * `.github/workflows/fleet-write.yml` runs this as its last step, after the
 * validator refused nothing and `actions/create-github-app-token` minted an
 * installation token narrowed to `payload.repo` and to `PERMISSIONS`
 * (`ops.mjs`). That token arrives in `GITHUB_TOKEN`, from the environment
 * only: it is never printed, never written to a file, never placed in an
 * argument; every string this file emits is scrubbed of it, and the runner's
 * own secret masking is the second net, not the first. The App's private key
 * never reaches this process at all — the mint is the action's.
 *
 * ## The sender gate — authorization comes from the TARGET repo
 *
 * `github.event.sender.login` is the login GitHub resolved from the token that
 * sent the dispatch. Before the first write this file asks the target repo
 * what that login may do there — `GET /repos/{repo}/collaborators/{login}/permission`
 * — and refuses unless the answer is `write`, `maintain` or `admin`
 * (GitHub folds `maintain` into `permission: write`; `role_name` carries the
 * exact role, and both are read). A refusal is a run failure with zero writes.
 * There is no sender allowlist: GitHub's write permission on the target IS
 * the authorization, so a seat that can push to a repo can write to it as the
 * fleet, and one that cannot, cannot — whichever repo the dispatch landed on.
 *
 * ## The run
 *
 * Every action is validated AGAIN here (defence in depth: the executor trusts
 * the validator's rule, not the step that ran it), then its requests are
 * issued in order with the App token: REST calls straight from the op table;
 * the pull-request GraphQL ops resolve the pull's node id with one GET first.
 * The FIRST failure stops the run — later actions are NOT attempted, and the
 * summary says which — because a seat that dispatched five related writes
 * must be able to read exactly where the board was left. A 404 on a directed
 * label DELETE is the label already being gone: idempotent success, the same
 * reading `label-write.mjs` takes.
 *
 * Every write goes through `write-pace.mjs` like every other fleet write: the
 * gap between two writes and the back-off marker a platform refusal writes
 * apply on the runner too (the runner's own home holds the log; nothing is
 * shared with a seat container, and the twenty-action cap bounds the run).
 *
 * ## The step summary — what a seat reads back
 *
 * `$GITHUB_STEP_SUMMARY` gets one table per run: request id · sender and its
 * role · session · target, then one row per request — op, endpoint, HTTP
 * status, and the resulting id / url — and a last line saying how many landed
 * or where it stopped. Text is passed through unchanged: attribution stays
 * the session id inside the text, per protocol.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0   every action landed.
 *   2   the payload was refused (the reasons are printed and summarised); zero writes.
 *   3   PREREQUISITE NOT MET — no token, no sender, the permission read did
 *       not answer, or the platform was unreachable; zero writes.
 *   4   the sender is not authorized on the target repo; zero writes.
 *   5   an action FAILED; the summary names it and which earlier ones landed.
 *  10   the write throttle refused (its prescription was printed).
 */

import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../../invoked-as.mjs';
import { scrub } from '../fleet-token.mjs';
import { classifyHttp } from '../label-write.mjs';
import { EXIT_WRITE_PACE_REFUSED, isWriteMethod, noteResponse, paceWrite, releaseWriteLease } from '../write-pace.mjs';
import { OPS, PERMISSIONS } from './ops.mjs';
import { PAYLOAD_ENV, refusalText, validatePayload } from './validate.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const DEFAULT_API = 'https://api.github.com';

export const EXIT_OK = 0;
export const EXIT_REFUSED = 2;
export const EXIT_PREREQUISITE = 3;
export const EXIT_SENDER_REFUSED = 4;
export const EXIT_ACTION_FAILED = 5;

/** The environment variable the workflow hands `github.event.sender.login` through. */
export const SENDER_ENV = 'FLEET_WRITE_SENDER';

/** The roles that carry write permission on the target — GitHub's legacy base roles plus the exact role names. */
export const ALLOWED_PERMISSIONS = Object.freeze(['admin', 'write']);
export const ALLOWED_ROLE_NAMES = Object.freeze(['admin', 'maintain', 'write']);

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/**
 * What the permission read means. `verdict` is one of:
 *   `allowed`       — write, maintain or admin; `role` names it;
 *   `refused`       — a lesser role, or not a collaborator at all (404);
 *   `prerequisite`  — the read did not answer (route, credential, 5xx).
 */
export function senderVerdict({ status, json } = {}) {
  if (status === 200 && json && typeof json === 'object') {
    const permission = typeof json.permission === 'string' ? json.permission : '';
    const roleName = typeof json.role_name === 'string' ? json.role_name : '';
    const allowed = ALLOWED_PERMISSIONS.includes(permission) || ALLOWED_ROLE_NAMES.includes(roleName);
    return { verdict: allowed ? 'allowed' : 'refused', role: roleName || permission || 'none', permission, roleName };
  }
  if (status === 404) return { verdict: 'refused', role: 'not a collaborator', permission: '', roleName: '' };
  return { verdict: 'prerequisite', role: '', permission: '', roleName: '' };
}

/** Did this answer land the request? A 404 on a directed label DELETE is the label already being gone. */
export function requestLanded(req, { status, json } = {}) {
  if (req.graphql) {
    if (status !== 200 || !json || typeof json !== 'object') return { ok: false, why: `HTTP ${status}` };
    if (Array.isArray(json.errors) && json.errors.length) return { ok: false, why: `GraphQL: ${json.errors.map((e) => e?.message ?? 'error').join('; ')}` };
    if (!json.data) return { ok: false, why: 'GraphQL: no data' };
    return { ok: true, why: '' };
  }
  if (status >= 200 && status < 300) return { ok: true, why: '' };
  if (status === 404 && req.idempotent404) return { ok: true, why: 'already absent', idempotent: true };
  return { ok: false, why: `HTTP ${status}${typeof json?.message === 'string' ? ` — ${json.message}` : ''}` };
}

/** The one thing a seat needs from an answer: the id / number / url of what was written. */
export function resultOf(req, json) {
  if (req.graphql) {
    const pr = json?.data?.[req.graphql.mutation]?.pullRequest;
    if (!pr) return 'ok';
    const bits = [`#${pr.number}`];
    if (typeof pr.isDraft === 'boolean') bits.push(pr.isDraft ? 'draft' : 'ready');
    if ('autoMergeRequest' in pr) bits.push(pr.autoMergeRequest ? `auto-merge ${pr.autoMergeRequest.mergeMethod ?? ''}`.trim() : 'auto-merge off');
    return bits.join(' · ');
  }
  if (Array.isArray(json)) return `${json.length} label(s) now on the issue`;
  if (!json || typeof json !== 'object') return 'ok';
  const bits = [];
  if (Number.isInteger(json.number)) bits.push(`#${json.number}`);
  else if (Number.isInteger(json.id)) bits.push(`id ${json.id}`);
  if (typeof json.html_url === 'string') bits.push(json.html_url);
  return bits.join(' ') || 'ok';
}

/** The summary table, as markdown lines. */
export function summaryText({ payload, sender, role, rows, stoppedAt = null, notAttempted = 0, refusal = null }) {
  const lines = [`### fleet-write \`${payload?.request_id ?? '?'}\``, ''];
  lines.push(`- sender: \`${sender ?? '?'}\`${role ? ` (${role})` : ''} · session: \`${payload?.session ?? '?'}\` · target: \`${payload?.repo ?? '?'}\` · ${payload?.actions?.length ?? 0} action(s)`);
  if (refusal) {
    lines.push('', `⛔ ${refusal} — zero writes.`);
    return `${lines.join('\n')}\n`;
  }
  lines.push('', '| # | op | request | HTTP | result |', '|---|---|---|---|---|');
  for (const r of rows) lines.push(`| ${r.action} | \`${r.op}\` | \`${r.call}\` | ${r.status} | ${r.result} |`);
  lines.push('');
  if (stoppedAt === null) lines.push(`✓ ${rows.length} request(s) landed, every action done.`);
  else lines.push(`✗ stopped at action ${stoppedAt.action} (\`${stoppedAt.op}\`): ${stoppedAt.why}. ${notAttempted} later action(s) NOT attempted.`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Transport — one shape, both halves of the throttle around every write verb.
// ⛔ Nothing here throws on an HTTP status; a refusal is an observation.
// ---------------------------------------------------------------------------

async function rest(api, path, { method = 'GET', body = null } = {}, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const token = deps.token ?? '';
  const paceDeps = deps.pace ?? {};
  const paced = isWriteMethod(method);
  if (paced) await paceWrite({ token, kind: `fleet-write ${method}` }, paceDeps);
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
    return { status: 0, json: null, detail: scrub(e?.message ?? 'fetch threw', [token]), call: `${method} ${path}` };
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
  return { status: res.status, json, detail: scrub(typeof json?.message === 'string' ? json.message : '', [token]), call: `${method} ${path}` };
}

/**
 * The run. Returns `{ exit, rows, summary, lines }`; never throws on a status.
 *
 * @param {{ payload: unknown, sender: string, token: string, api?: string }} input
 * @param {{ fetch?: Function, pace?: object, log?: Function }} [deps]
 */
export async function executeFleetWrite({ payload: raw, sender, token, api = DEFAULT_API } = {}, deps = {}) {
  const lines = [];
  const log = (line) => {
    lines.push(line);
    (deps.log ?? ((l) => console.log(l)))(line);
  };
  const t = { fetch: deps.fetch, token, pace: deps.pace };

  const judged = validatePayload(raw);
  if (!judged.ok) {
    log(refusalText(judged.errors));
    return { exit: EXIT_REFUSED, rows: [], summary: summaryText({ payload: raw && typeof raw === 'object' ? raw : null, sender, rows: [], refusal: `payload refused (${judged.errors.length} problem(s))` }), lines };
  }
  const payload = judged.payload;
  if (!token) {
    log('fleet-write/execute: PREREQUISITE NOT MET — no GITHUB_TOKEN in the environment (the workflow passes the minted App token through it). ⛔ zero writes.');
    return { exit: EXIT_PREREQUISITE, rows: [], summary: summaryText({ payload, sender, rows: [], refusal: 'no token' }), lines };
  }
  if (typeof sender !== 'string' || !sender.trim()) {
    log(`fleet-write/execute: PREREQUISITE NOT MET — no ${SENDER_ENV} (the workflow passes github.event.sender.login through it). ⛔ zero writes.`);
    return { exit: EXIT_PREREQUISITE, rows: [], summary: summaryText({ payload, sender, rows: [], refusal: 'no sender' }), lines };
  }

  // ── the sender gate ───────────────────────────────────────────────────────
  const permPath = `/repos/${payload.repo}/collaborators/${encodeURIComponent(sender)}/permission`;
  const perm = await rest(api, permPath, {}, t);
  const gate = senderVerdict(perm);
  if (gate.verdict === 'prerequisite') {
    log(`fleet-write/execute: PREREQUISITE NOT MET — ${perm.call} -> HTTP ${perm.status}${perm.detail ? ` (${perm.detail})` : ''}; the sender's permission could not be read. ⛔ zero writes.`);
    return { exit: EXIT_PREREQUISITE, rows: [], summary: summaryText({ payload, sender, rows: [], refusal: `the permission read answered HTTP ${perm.status}` }), lines };
  }
  if (gate.verdict === 'refused') {
    log(`fleet-write/execute: SENDER REFUSED — \`${sender}\` is ${gate.role} on ${payload.repo}; the relay writes only for a sender with write, maintain or admin there. ⛔ zero writes.`);
    return { exit: EXIT_SENDER_REFUSED, rows: [], summary: summaryText({ payload, sender, role: gate.role, rows: [], refusal: `sender \`${sender}\` is ${gate.role} on the target` }), lines };
  }
  log(`fleet-write/execute: request ${payload.request_id} · sender ${sender} (${gate.role}) · session ${payload.session} · target ${payload.repo} · ${payload.actions.length} action(s)`);

  // ── the actions, in order ─────────────────────────────────────────────────
  const rows = [];
  let stoppedAt = null;
  for (let i = 0; i < payload.actions.length && stoppedAt === null; i++) {
    const action = payload.actions[i];
    const requests = OPS[action.op].requests(action, payload.repo);
    for (const req of requests) {
      let body = req.body ?? null;
      if (req.graphql) {
        const pr = await rest(api, `/repos/${payload.repo}/pulls/${req.graphql.pull}`, {}, t);
        if (pr.status !== 200 || typeof pr.json?.node_id !== 'string') {
          const why = `${pr.call} -> HTTP ${pr.status}${pr.detail ? ` (${pr.detail})` : ''}: the pull's node id could not be read`;
          rows.push({ action: i + 1, op: action.op, call: pr.call, status: pr.status, result: 'no node id' });
          stoppedAt = { action: i + 1, op: action.op, why };
          log(`  ✗ action ${i + 1} ${action.op}: ${why}`);
          break;
        }
        body = { query: req.graphql.query, variables: { id: pr.json.node_id } };
      }
      // The GraphQL leg is spelled with its literal verb: every mutation is a POST to one path.
      const r = req.graphql ? await rest(api, '/graphql', { method: 'POST', body }, t) : await rest(api, req.path, { method: req.verb, body }, t);
      const landed = requestLanded(req, r);
      const call = req.graphql ? `POST /graphql ${req.graphql.mutation}` : r.call;
      rows.push({ action: i + 1, op: action.op, call, status: r.status, result: landed.ok ? (landed.idempotent ? 'already absent (idempotent)' : resultOf(req, r.json)) : `FAILED: ${scrub(landed.why, [token])}` });
      if (!landed.ok) {
        stoppedAt = { action: i + 1, op: action.op, why: scrub(landed.why, [token]) };
        log(`  ✗ action ${i + 1} ${action.op}: ${call} -> ${stoppedAt.why}`);
        break;
      }
      log(`  ✓ action ${i + 1} ${action.op}: ${call} -> HTTP ${r.status} · ${rows[rows.length - 1].result}`);
    }
  }
  const notAttempted = stoppedAt ? payload.actions.length - stoppedAt.action : 0;
  const summary = summaryText({ payload, sender, role: gate.role, rows, stoppedAt, notAttempted });
  if (stoppedAt) log(`fleet-write/execute: ✗ stopped at action ${stoppedAt.action} (${stoppedAt.op}); ${notAttempted} later action(s) NOT attempted. The board holds what the rows above say landed.`);
  else log(`fleet-write/execute: ✓ ${rows.length} request(s) landed, every action done.`);
  return { exit: stoppedAt ? EXIT_ACTION_FAILED : EXIT_OK, rows, summary, lines, role: gate.role };
}

// ---------------------------------------------------------------------------
// Self-test — offline: a fake platform, an injected throttle, no network.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the sender gate: write, maintain and admin pass; read, triage, none and a stranger are refused with zero writes': 9,
  'the requests: every op becomes the endpoint, verb and body the table declares, with the App token': 7,
  'the run: actions in order, stop at the first failure, later actions never attempted': 6,
  'the idempotent removal: a 404 on a directed label DELETE is success': 2,
  'the GraphQL ops: the node id first, then the mutation; an errors array is a failure': 5,
  'the summary: request, sender and role, session, target, one row per request': 5,
  'redaction: the token reaches no summary line, log line or error': 3,
  'the wiring: both halves around every write verb, on the roster': 4,
  'the CLI: environment inputs, the payload refusal, the exit ladder': 7,
});
const SELF_TEST_BATTERY_FLOOR = 9;
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
  const { spawnSync } = await import('node:child_process');

  const TOKEN = 'ghs_FixtureTokenNotRealAtAll0000000000000';
  const REPO = 'objectstack-ai/objectstack';
  const base = (actions) => ({ request_id: 'fw-test-1', repo: REPO, session: 'session_01ABCDEFGHJKMNPQRSTVWXYZ', actions });
  const PERM = `GET /repos/${REPO}/collaborators/os-support-ai/permission`;
  const allowed = { [PERM]: { status: 200, json: { permission: 'write', role_name: 'write', user: { login: 'os-support-ai' } } } };

  const dir = mkdtempSync(join(tmpdir(), 'fleet-write-execute-'));
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
    const platform = (answers, seen) => async (url, init) => {
      const u = new URL(url);
      const call = `${init?.method ?? 'GET'} ${u.pathname}`;
      seen.push({ call, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.authorization ?? '' });
      const a = answers[call] ?? { status: 404, json: { message: 'Not Found' } };
      if (a.throws) throw new Error(a.throws);
      return { status: a.status, headers: new Headers({ 'x-ratelimit-remaining': '4999', ...(a.headers ?? {}) }), json: async () => a.json };
    };
    const paceFile = join(dir, 'pace-shared.jsonl');
    const run = async (payload, answers, { sender = 'os-support-ai', token = TOKEN, file } = {}) => {
      const seen = [];
      const logs = [];
      const pace = paceFor(file ?? join(dir, `pace-${paceCase++}.jsonl`));
      try {
        const r = await executeFleetWrite({ payload, sender, token }, { fetch: platform(answers, seen), pace, log: (l) => logs.push(l) });
        return { ...r, seen, logs, pace };
      } catch (e) {
        if (e?.throttleExit === undefined) throw e;
        return { exit: e.throttleExit, rows: [], summary: '', lines: [], seen, logs, pace, throttled: true };
      }
    };
    const writes = (seen) => seen.filter((s) => !s.call.startsWith('GET '));

    // ── the sender gate ─────────────────────────────────────────────────────
    battery('the sender gate: write, maintain and admin pass; read, triage, none and a stranger are refused with zero writes');
    {
      t('permission write is allowed', senderVerdict({ status: 200, json: { permission: 'write', role_name: 'write' } }).verdict, 'allowed');
      t('maintain (folded into permission write) is allowed, and the exact role is read', senderVerdict({ status: 200, json: { permission: 'write', role_name: 'maintain' } }), { verdict: 'allowed', role: 'maintain', permission: 'write', roleName: 'maintain' });
      t('admin is allowed', senderVerdict({ status: 200, json: { permission: 'admin', role_name: 'admin' } }).verdict, 'allowed');
      t('read is refused', senderVerdict({ status: 200, json: { permission: 'read', role_name: 'read' } }).verdict, 'refused');
      t('triage (folded into read) is refused', senderVerdict({ status: 200, json: { permission: 'read', role_name: 'triage' } }).verdict, 'refused');
      t('none is refused', senderVerdict({ status: 200, json: { permission: 'none', role_name: 'none' } }).verdict, 'refused');
      t('a 404 — not a collaborator — is refused', senderVerdict({ status: 404, json: { message: 'Not Found' } }).verdict, 'refused');
      const refused = await run(base([{ op: 'comment', issue: 1, body: 'x' }]), { [PERM]: { status: 200, json: { permission: 'read', role_name: 'triage' } }, [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 5 } } });
      t('a refused sender is exit 4 with ZERO writes and the role named', [refused.exit, writes(refused.seen).length, refused.logs.some((l) => l.includes('triage'))], [EXIT_SENDER_REFUSED, 0, true]);
      const unreadable = await run(base([{ op: 'comment', issue: 1, body: 'x' }]), { [PERM]: { status: 503, json: { message: 'down' } } });
      t('a permission read that does not answer is exit 3, zero writes — never a pass', [unreadable.exit, writes(unreadable.seen).length], [EXIT_PREREQUISITE, 0]);
    }

    // ── the requests ────────────────────────────────────────────────────────
    battery('the requests: every op becomes the endpoint, verb and body the table declares, with the App token');
    {
      const comment = await run(base([{ op: 'comment', issue: 19701, body: 'Hello' }]), { ...allowed, [`POST /repos/${REPO}/issues/19701/comments`]: { status: 201, json: { id: 77, html_url: 'https://github.test/c/77' } } }, { file: paceFile });
      t('comment: POST …/issues/{n}/comments with the body, exit 0', [comment.exit, comment.seen[1].call, comment.seen[1].body], [EXIT_OK, `POST /repos/${REPO}/issues/19701/comments`, { body: 'Hello' }]);
      t('…with the App token as the bearer, on the permission read and the write alike', comment.seen.map((s) => s.auth), [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
      t('…and the row carries the id and url', comment.rows[0].result, 'id 77 https://github.test/c/77');
      const labels = await run(base([{ op: 'labels_add', issue: 2, labels: ['a', 'b'] }, { op: 'assign', issue: 2, assignees: ['u'] }, { op: 'issue_patch', issue: 2, state: 'closed', state_reason: 'not_planned' }]), {
        ...allowed,
        [`POST /repos/${REPO}/issues/2/labels`]: { status: 200, json: [{ name: 'a' }, { name: 'b' }] },
        [`POST /repos/${REPO}/issues/2/assignees`]: { status: 201, json: { number: 2 } },
        [`PATCH /repos/${REPO}/issues/2`]: { status: 200, json: { number: 2, html_url: 'https://github.test/i/2' } },
      }, { file: paceFile });
      t('labels_add, assign and issue_patch become their verbs and bodies, in order', writes(labels.seen).map((s) => [s.call, s.body]), [
        [`POST /repos/${REPO}/issues/2/labels`, { labels: ['a', 'b'] }],
        [`POST /repos/${REPO}/issues/2/assignees`, { assignees: ['u'] }],
        [`PATCH /repos/${REPO}/issues/2`, { state: 'closed', state_reason: 'not_planned' }],
      ]);
      const pr = await run(base([{ op: 'pr_create', title: 'T', head: 'h', base: 'main' }, { op: 'issue_create', title: 'I', body: 'B', labels: ['l'] }]), {
        ...allowed,
        [`POST /repos/${REPO}/pulls`]: { status: 201, json: { number: 9, html_url: 'https://github.test/p/9' } },
        [`POST /repos/${REPO}/issues`]: { status: 201, json: { number: 10, html_url: 'https://github.test/i/10' } },
      }, { file: paceFile });
      t('pr_create sends draft: true whatever was asked', writes(pr.seen)[0].body, { title: 'T', head: 'h', base: 'main', draft: true });
      t('issue_create sends title, body and the optional lists it was given', writes(pr.seen)[1].body, { title: 'I', body: 'B', labels: ['l'] });
      t('…and the rows carry the numbers', pr.rows.map((r) => r.result), ['#9 https://github.test/p/9', '#10 https://github.test/i/10']);
    }

    // ── the run ─────────────────────────────────────────────────────────────
    battery('the run: actions in order, stop at the first failure, later actions never attempted');
    {
      const three = base([{ op: 'comment', issue: 1, body: 'a' }, { op: 'labels_add', issue: 1, labels: ['x'] }, { op: 'comment', issue: 1, body: 'c' }]);
      const stopped = await run(three, { ...allowed, [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } }, [`POST /repos/${REPO}/issues/1/labels`]: { status: 403, json: { message: 'Resource not accessible by integration' } } });
      t('the first failure is exit 5', stopped.exit, EXIT_ACTION_FAILED);
      t('…the actions before it landed, the failing one is recorded with the platform\'s sentence', stopped.rows.map((r) => [r.action, r.status]), [[1, 201], [2, 403]]);
      t('…and the action after it was NEVER attempted', writes(stopped.seen).length, 2);
      t('…which the summary says in numbers', stopped.summary.includes('stopped at action 2 (`labels_add`)') && stopped.summary.includes('1 later action(s) NOT attempted'));
      const down = await run(three, { ...allowed, [`POST /repos/${REPO}/issues/1/comments`]: { throws: 'ECONNRESET' } });
      t('an unreachable platform on a write is a failed action (status 0), and the lease was released', [down.exit, down.rows[0].status, existsSync(`${down.pace.file}.lease`)], [EXIT_ACTION_FAILED, 0, false]);
      const marker = await run(three, { ...allowed, [`POST /repos/${REPO}/issues/1/comments`]: { status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: { message: 'API rate limit exceeded' } } });
      const after = await run(three, { ...allowed, [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } } }, { file: marker.pace.file });
      t('a rate-limit refusal writes the stop marker, and the NEXT write on that log is refused before it leaves (exit 10)', [marker.exit, after.exit, after.throttled, writes(after.seen).length], [EXIT_ACTION_FAILED, EXIT_WRITE_PACE_REFUSED, true, 0]);
    }

    // ── the idempotent removal ──────────────────────────────────────────────
    battery('the idempotent removal: a 404 on a directed label DELETE is success');
    {
      const gone = await run(base([{ op: 'labels_remove', issue: 4, labels: ['gone', 'there'] }, { op: 'comment', issue: 4, body: 'after' }]), {
        ...allowed,
        [`DELETE /repos/${REPO}/issues/4/labels/gone`]: { status: 404, json: { message: 'Label does not exist' } },
        [`DELETE /repos/${REPO}/issues/4/labels/there`]: { status: 200, json: [] },
        [`POST /repos/${REPO}/issues/4/comments`]: { status: 201, json: { id: 3 } },
      }, { file: paceFile });
      t('a 404 on a directed DELETE is idempotent success and the run continues', [gone.exit, gone.rows.map((r) => r.result)], [EXIT_OK, ['already absent (idempotent)', '0 label(s) now on the issue', 'id 3']]);
      t('…but a 404 anywhere else is a failure', requestLanded({ verb: 'POST', path: '/x' }, { status: 404, json: { message: 'Not Found' } }).ok, false);
    }

    // ── the GraphQL ops ─────────────────────────────────────────────────────
    battery('the GraphQL ops: the node id first, then the mutation; an errors array is a failure');
    {
      const ready = await run(base([{ op: 'pr_ready', pull: 12 }]), {
        ...allowed,
        [`GET /repos/${REPO}/pulls/12`]: { status: 200, json: { number: 12, node_id: 'PR_kwDO' } },
        'POST /graphql': { status: 200, json: { data: { markPullRequestReadyForReview: { pullRequest: { number: 12, isDraft: false } } } } },
      }, { file: paceFile });
      t('pr_ready reads the node id, then POSTs the mutation with it', [ready.exit, ready.seen.map((s) => s.call), ready.seen[2].body.variables], [EXIT_OK, [PERM, `GET /repos/${REPO}/pulls/12`, 'POST /graphql'], { id: 'PR_kwDO' }]);
      t('…the query names the mutation and the row reads the answer', [ready.seen[2].body.query.includes('markPullRequestReadyForReview'), ready.rows[0].result], [true, '#12 · ready']);
      const merge = await run(base([{ op: 'automerge_enable', pull: 12 }]), {
        ...allowed,
        [`GET /repos/${REPO}/pulls/12`]: { status: 200, json: { number: 12, node_id: 'PR_kwDO' } },
        'POST /graphql': { status: 200, json: { data: { enablePullRequestAutoMerge: { pullRequest: { number: 12, autoMergeRequest: { enabledAt: 'now', mergeMethod: 'SQUASH' } } } } } },
      }, { file: paceFile });
      t('automerge_enable arms SQUASH and the row says so', [merge.exit, merge.seen[2].body.query.includes('mergeMethod: SQUASH'), merge.rows[0].result], [EXIT_OK, true, '#12 · auto-merge SQUASH']);
      const errored = await run(base([{ op: 'pr_draft', pull: 12 }]), {
        ...allowed,
        [`GET /repos/${REPO}/pulls/12`]: { status: 200, json: { number: 12, node_id: 'PR_kwDO' } },
        'POST /graphql': { status: 200, json: { data: null, errors: [{ message: 'Pull request is already a draft' }] } },
      });
      t('a 200 carrying an errors array is a FAILED action naming the message', [errored.exit, errored.rows[0].result.includes('already a draft')], [EXIT_ACTION_FAILED, true]);
      const noNode = await run(base([{ op: 'pr_ready', pull: 13 }]), { ...allowed, [`GET /repos/${REPO}/pulls/13`]: { status: 404, json: { message: 'Not Found' } } });
      t('a pull whose node id cannot be read is a failed action with no mutation sent', [noNode.exit, noNode.seen.some((s) => s.call === 'POST /graphql')], [EXIT_ACTION_FAILED, false]);
    }

    // ── the summary ─────────────────────────────────────────────────────────
    battery('the summary: request, sender and role, session, target, one row per request');
    {
      const ok = await run(base([{ op: 'comment', issue: 1, body: 'a' }, { op: 'labels_remove', issue: 1, labels: ['x', 'y'] }]), {
        ...allowed,
        [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1, html_url: 'https://github.test/c/1' } },
        [`DELETE /repos/${REPO}/issues/1/labels/x`]: { status: 200, json: [] },
        [`DELETE /repos/${REPO}/issues/1/labels/y`]: { status: 200, json: [] },
      }, { file: paceFile });
      t('the header names the request id, sender with role, session and target', ok.summary.includes('fleet-write `fw-test-1`') && ok.summary.includes('`os-support-ai` (write)') && ok.summary.includes('session_01ABCDEFGHJKMNPQRSTVWXYZ') && ok.summary.includes(`\`${REPO}\``));
      t('one row per REQUEST — two labels are two rows under one action', ok.summary.split('\n').filter((l) => l.startsWith('| 2 |')).length, 2);
      t('each row carries op, endpoint, status and result', ok.summary.includes(`| 1 | \`comment\` | \`POST /repos/${REPO}/issues/1/comments\` | 201 | id 1 https://github.test/c/1 |`));
      t('the last line counts what landed', ok.summary.trim().endsWith('✓ 3 request(s) landed, every action done.'));
      t('a refusal summary says zero writes', summaryText({ payload: base([]), sender: 's', rows: [], refusal: 'x' }).includes('zero writes'));
    }

    // ── redaction ───────────────────────────────────────────────────────────
    battery('redaction: the token reaches no summary line, log line or error');
    {
      const echo = await run(base([{ op: 'comment', issue: 1, body: 'a' }]), {
        ...allowed,
        [`POST /repos/${REPO}/issues/1/comments`]: { status: 401, json: { message: `Bad credentials for ${TOKEN}` } },
      });
      const everything = [echo.summary, ...echo.logs, ...echo.rows.map((r) => r.result)].join('\n');
      t('⛔ a platform sentence that echoed the token is scrubbed everywhere it lands', everything.includes(TOKEN), false, everything.slice(0, 300));
      t('…and the scrubbed spelling is what appears instead', everything.includes('<redacted>'));
      const thrown = await run(base([{ op: 'comment', issue: 1, body: 'a' }]), { ...allowed, [`POST /repos/${REPO}/issues/1/comments`]: { throws: `socket hung up sending ${TOKEN}` } });
      t('a transport error that echoed the token is scrubbed too', [thrown.summary, ...thrown.logs].join('\n').includes(TOKEN), false);
    }

    // ── the wiring ──────────────────────────────────────────────────────────
    battery('the wiring: both halves around every write verb, on the roster');
    {
      const { WIRED_WRITE_TOOLS } = await import('../write-pace.mjs');
      const own = readReal(SELF_PATH, 'utf8');
      t('write-pace lists this file among the wired write tools', WIRED_WRITE_TOOLS.includes('scripts/pm/fleet-write/execute.mjs'));
      t('this file calls both halves, guarded by the write-verb predicate', own.includes('paceWrite(') && own.includes('noteResponse(') && own.includes('isWriteMethod('));
      const records = readReal(paceFile, 'utf8');
      t('the writes above were paced under their verbs; the reads were not', [records.includes('fleet-write POST'), records.includes('fleet-write DELETE'), records.includes('fleet-write PATCH'), records.includes('fleet-write GET')], [true, true, true, false]);
      t('⛔ and the token never reached the throttle\'s log', records.includes(TOKEN), false);
    }

    // ── the CLI ─────────────────────────────────────────────────────────────
    battery('the CLI: environment inputs, the payload refusal, the exit ladder');
    {
      const env = (extra) => ({ ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', HTTPS_PROXY: '', https_proxy: '', OS_PM_WRITE_PACE_FILE: join(dir, 'cli-pace.jsonl'), GITHUB_STEP_SUMMARY: join(dir, 'summary.md'), ...extra });
      const spawn = (args, extra) => spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: 'utf8', env: env(extra) });
      const good = JSON.stringify(base([{ op: 'comment', issue: 1, body: 'a' }]));
      const noPayload = spawn([], { [PAYLOAD_ENV]: '', [SENDER_ENV]: 'x', GITHUB_TOKEN: TOKEN });
      t('no payload is exit 3 naming the variable', [noPayload.status, noPayload.stderr.includes(PAYLOAD_ENV)], [EXIT_PREREQUISITE, true]);
      const refused = spawn([], { [PAYLOAD_ENV]: JSON.stringify({ request_id: 'x' }), [SENDER_ENV]: 'x', GITHUB_TOKEN: TOKEN });
      t('a refused payload is exit 2, the reasons on stderr, the summary written', [refused.status, refused.stderr.includes('REFUSED'), readReal(join(dir, 'summary.md'), 'utf8').includes('zero writes')], [EXIT_REFUSED, true, true]);
      writeFileSync(join(dir, 'summary.md'), '', 'utf8');
      const noToken = spawn([], { [PAYLOAD_ENV]: good, [SENDER_ENV]: 'x' });
      t('no token is exit 3 before any request', [noToken.status, noToken.stderr.includes('no GITHUB_TOKEN')], [EXIT_PREREQUISITE, true]);
      const noSender = spawn([], { [PAYLOAD_ENV]: good, GITHUB_TOKEN: TOKEN });
      t('no sender is exit 3 before any request', [noSender.status, noSender.stderr.includes(SENDER_ENV)], [EXIT_PREREQUISITE, true]);
      writeFileSync(join(dir, 'p.json'), good, 'utf8');
      const fromFile = spawn(['--payload-file', join(dir, 'p.json')], { GITHUB_TOKEN: TOKEN });
      t('--payload-file reads the payload from disk (and still needs a sender)', [fromFile.status, fromFile.stderr.includes(SENDER_ENV)], [EXIT_PREREQUISITE, true]);
      t('an unknown flag is usage (2)', spawn(['--bogus']).status, EXIT_REFUSED);
      t('⛔ no spawned run printed the token', [noPayload, refused, noToken, noSender, fromFile].some((r) => `${r.stdout}${r.stderr}`.includes(TOKEN)), false);
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
    console.error(`✗ fleet-write/execute self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(
    `✓ fleet-write/execute self-test: ${cases.length} cases pass across ${declared.length} batteries — the sender gate from the target repo's answer, ` +
      'every op as the request the table declares, stop at the first failure with later actions untouched, the idempotent label DELETE, the GraphQL ' +
      'ops behind a node-id read, one summary row per request, and a known token that came back out of NO summary, log or error.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = Object.freeze(['--payload-file', '--self-test', '--help', '-h']);

const USAGE = [
  'usage:',
  `  ${PAYLOAD_ENV}='{…}' ${SENDER_ENV}=<login> GITHUB_TOKEN=<App token> node scripts/pm/fleet-write/execute.mjs`,
  '  node scripts/pm/fleet-write/execute.mjs --payload-file <payload.json>     # the same, payload from disk',
  '  node scripts/pm/fleet-write/execute.mjs --self-test',
  `  Exits: ${EXIT_OK} every action landed · ${EXIT_REFUSED} payload refused or usage · ${EXIT_PREREQUISITE} prerequisite not met ·`,
  `         ${EXIT_SENDER_REFUSED} sender not authorized on the target · ${EXIT_ACTION_FAILED} an action failed (later ones not attempted) · ${EXIT_WRITE_PACE_REFUSED} throttle refused`,
].join('\n');

export function parseArgs(argv) {
  const opts = { payloadFile: null, selfTest: false, help: false, errors: [] };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--payload-file') {
      const v = args.shift();
      if (v === undefined || v.startsWith('--')) opts.errors.push('--payload-file needs a path');
      else opts.payloadFile = v;
    } else if (a.startsWith('--payload-file=')) opts.payloadFile = a.slice('--payload-file='.length);
    else opts.errors.push(`unrecognised argument ${JSON.stringify(a)}`);
  }
  return opts;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (opts.selfTest) return selfTest();
  if (opts.errors.length) {
    for (const e of opts.errors) console.error(`fleet-write/execute: ${e}`);
    console.error(USAGE);
    return EXIT_REFUSED;
  }
  let text;
  if (opts.payloadFile !== null) {
    try {
      text = readFileSync(opts.payloadFile, 'utf8');
    } catch (e) {
      console.error(`fleet-write/execute: PREREQUISITE NOT MET — --payload-file ${opts.payloadFile} cannot be read (${e?.message ?? 'unreadable'}). ⛔ zero writes.`);
      return EXIT_PREREQUISITE;
    }
  } else {
    text = process.env[PAYLOAD_ENV];
    if (typeof text !== 'string' || text.trim() === '' || text.trim() === 'null') {
      console.error(`fleet-write/execute: PREREQUISITE NOT MET — ${PAYLOAD_ENV} is absent or empty. ⛔ zero writes.`);
      return EXIT_PREREQUISITE;
    }
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    console.error(`fleet-write/execute: PREREQUISITE NOT MET — the payload is not JSON (${e?.message ?? 'parse failed'}). ⛔ zero writes.`);
    return EXIT_PREREQUISITE;
  }
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  const sender = process.env[SENDER_ENV] ?? '';
  const api = String(process.env.OS_FLEET_API_URL ?? '').trim().replace(/\/+$/, '') || DEFAULT_API;
  const result = await executeFleetWrite({ payload, sender, token, api }, { log: (l) => (isRefusalLine(l) ? console.error(l) : console.log(l)) });
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    try {
      appendFileSync(summaryFile, result.summary, 'utf8');
    } catch (e) {
      console.error(`fleet-write/execute: could not append the step summary (${scrub(e?.message ?? '', [token])}); the rows above are the record.`);
    }
  }
  return result.exit;
}

/** Refusals and prerequisite lines go to stderr; the per-action transcript to stdout. */
function isRefusalLine(line) {
  return /REFUSED|PREREQUISITE NOT MET/.test(line);
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\n✗ fleet-write/execute self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
        'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}
