#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * issue-create — the one door a NEW card leaves through.
 *
 *   node scripts/pm/issue-create.mjs --repo owner/name --title-file title.txt --body-file body.md [--label L]… [--assignee A]… [--json]
 *   node scripts/pm/issue-create.mjs --title 'A short title' --body-file body.md --dry-run
 *   node scripts/pm/issue-create.mjs --self-test          # offline, a fake platform, no network at all
 *
 * ## Why this file exists
 *
 * Labels had `label-write.mjs`, comments and bodies had `post-stamped.mjs`,
 * closures had `close-cards.mjs` — CREATION had nothing. So a seat creating a
 * batch of cards reached for a bare `curl` loop, and a loop in which each
 * process paced itself and none paced the fleet is exactly the burst that got
 * an account restricted (`write-pace.mjs`'s header carries the reading). This
 * file is the door: one POST, through the throttle's lease and gap, read back,
 * and reported — and a batch of N cards is N calls of it behind one
 * `write-pace.mjs --announce-batch N`, never a loop of anything else.
 *
 * ## Prose comes from FILES, never from argv
 *
 * A title typed into a shell command is interpolated by that shell before this
 * program sees it: a backticked identifier in a card title once posted as the
 * OUTPUT of the command it named. `--body-file` is the only way to give a body.
 * `--title-file` is the way to give a title; `--title` exists for the plain
 * case and is REFUSED when it carries a backtick or a dollar sign, because by
 * then the shell has already had its turn.
 *
 * ## What it refuses, before any request leaves
 *
 *   - an empty title or body; both title sources, or neither;
 *   - a repo not shaped `owner/name` (the default is the board the sweep
 *     tooling resolves, so a card never lands on a repo nobody named);
 *   - a body carrying `{{NOW}}` / `{{WAS:…}}` — those are `post-stamped.mjs`'s
 *     contract for comments and body EDITS; a new card is dated by the platform.
 *
 * ## The transport — `OS_FLEET_TRANSPORT` direct | dispatch | auto
 *
 * `direct` is the one POST above with the token this process holds.
 * `dispatch` packs that SAME create into ONE `repository_dispatch` and
 * `scripts/pm/fleet-write/dispatch.mjs` waits for the relay run that performs
 * it as `objectstack-fleet[bot]` — a cloud seat container's proxy replaces the
 * Authorization header, so that is the only way it can create as the fleet.
 * `auto` (the default) takes `dispatch` there and `direct` elsewhere, and says
 * which. Under the relay the new card's number is found by READING it back:
 * the newest issue on the target created at or after the dispatch whose title
 * is the one sent — then the same read-back as the direct path.
 *
 * ## Read-back
 *
 * After a 201 the card is fetched again and its title compared. A mismatch is
 * exit 4 — the one exit that means the board now holds something nobody asked
 * for — and the number is printed either way, so nothing is created twice.
 *
 * ## Exit codes — capture them BEFORE any pipe (label-write's ladder)
 *
 *   0   created, and the read-back matched. The number and URL are printed;
 *       `--json` adds one JSON line on stdout.
 *   2   usage, or a refusal above.
 *   3   PREREQUISITE NOT MET — no token, the platform unreachable, or the
 *       credential rate-limit exhausted. Nothing was created.
 *   4   created, and the READ-BACK DISAGREES. The number is printed.
 *   5   the platform refused (403 / 404 / 422 …). Its own sentence is printed.
 *   6   UNCONFIRMED — the dispatch was accepted and its run did not appear or
 *       did not complete within the ceiling, or the created card could not be
 *       found by title afterwards. The run URL is printed. Go READ the board;
 *       ⛔ never re-run blind: a second dispatch is a second card.
 *  10   the write throttle refused (a stop marker, no turn on the lease, the
 *       hourly budget). Nothing was sent.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { EXIT_PREREQUISITE_NOT_MET, PROXY_FLAG, proxyRearmPlan, resolveSweepRepo } from './check-half-states.mjs';
import { EXIT_UNCONFIRMED, exitForResult, fallbackText, packRequest, resolveRoute, sendFleetWrite, unconfirmedText } from './fleet-write/dispatch.mjs';
import { refusalText as relayRefusalText } from './fleet-write/validate.mjs';
import { classifyHttp } from './label-write.mjs';
import { EXIT_WRITE_PACE_REFUSED, isWriteMethod, noteResponse, paceWrite, releaseWriteLease } from './write-pace.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const PROXY_REARM_GUARD = 'OS_ISSUE_CREATE_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = EXIT_PREREQUISITE_NOT_MET;
export const EXIT_READ_BACK_MISMATCH = 4;
export const EXIT_PLATFORM_REFUSAL = 5;

export const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const STAMP_TOKEN = /\{\{(?:NOW|WAS:)/;

// ---------------------------------------------------------------------------
// The pure core — arguments, the plan, the payload, the verdict on a status.
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { repo: null, title: null, titleFile: null, bodyFile: null, labels: [], assignees: [], json: false, dryRun: false, selfTest: false, help: false, unknown: [], errors: [] };
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
    else if (a === '--repo') opts.repo = value(a);
    else if (a === '--title') opts.title = value(a);
    else if (a === '--title-file') opts.titleFile = value(a);
    else if (a === '--body-file') opts.bodyFile = value(a);
    else if (a === '--label') {
      const v = value(a);
      if (v !== null) opts.labels.push(v);
    } else if (a === '--assignee') {
      const v = value(a);
      if (v !== null) opts.assignees.push(v);
    } else if (a.startsWith('--') && a.includes('=')) {
      // `--title=x` is accepted for the flags that take a value, so a caller
      // used to the other tools' spelling is not refused for it.
      const [k, ...rest] = a.split('=');
      args.unshift(k, rest.join('='));
    } else opts.unknown.push(a);
  }
  return opts;
}

/** Order-preserving de-duplication of non-empty strings. */
function dedupe(values) {
  const out = [];
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * The plan: what will be sent, to which board, or why not. `read` is injected
 * so the self-test never touches a real file for its refusals.
 */
export function planFrom(opts, { read = (p) => readFileSync(p, 'utf8'), env = process.env } = {}) {
  const errors = [];
  const resolved = opts.repo ? { repo: String(opts.repo).trim(), source: '--repo' } : resolveSweepRepo(env);
  const repo = resolved.repo;
  if (!REPO_SHAPE.test(repo)) errors.push(`the repo must be owner/name; got ${JSON.stringify(repo)} (from ${resolved.source})`);

  let title = null;
  if (opts.title !== null && opts.titleFile !== null) errors.push('give the title ONCE: --title or --title-file, not both');
  else if (opts.title === null && opts.titleFile === null) errors.push('a title is required: --title-file <path> (recommended) or --title <text>');
  else if (opts.titleFile !== null) {
    try {
      title = read(opts.titleFile);
    } catch (e) {
      errors.push(`--title-file ${opts.titleFile} cannot be read (${e?.message ?? 'unreadable'})`);
    }
  } else {
    title = opts.title;
    if (/[`$]/.test(title)) {
      errors.push('--title carries a backtick or a dollar sign — the shell has already had its turn on it; put the title in a file and pass --title-file');
    }
  }
  if (title !== null) {
    title = String(title).replace(/\r?\n/g, ' ').trim();
    if (!title) errors.push('the title is empty');
  }

  let body = null;
  if (opts.bodyFile === null) errors.push('a body is required: --body-file <path> — a body never comes from argv');
  else {
    try {
      body = read(opts.bodyFile);
    } catch (e) {
      errors.push(`--body-file ${opts.bodyFile} cannot be read (${e?.message ?? 'unreadable'})`);
    }
  }
  if (body !== null) {
    body = String(body).replace(/\r\n/g, '\n').trim();
    if (!body) errors.push('the body is empty — a card names its evidence');
    else if (STAMP_TOKEN.test(body)) errors.push('the body carries a {{NOW}} / {{WAS:…}} token — those are post-stamped.mjs\'s contract for comments; a new card is dated by the platform');
  }

  const labels = dedupe(opts.labels);
  const assignees = dedupe(opts.assignees);
  const payload = { title: title ?? '', body: body ?? '' };
  if (labels.length) payload.labels = labels;
  if (assignees.length) payload.assignees = assignees;
  return { ok: errors.length === 0, errors, repo, payload };
}

/** What `--dry-run` prints: the whole request, nothing sent. */
export function dryRunText(plan) {
  return [
    `issue-create --dry-run — NOTHING was sent.`,
    `  POST /repos/${plan.repo}/issues`,
    `  title     : ${plan.payload.title}`,
    `  labels    : ${plan.payload.labels?.join(', ') ?? '(none)'}`,
    `  assignees : ${plan.payload.assignees?.join(', ') ?? '(none)'}`,
    `  body      : ${plan.payload.body.length} chars, ${plan.payload.body.split('\n').length} line(s)`,
  ].join('\n');
}

/** The exit a transport verdict maps to. `null` means "carry on". */
export function exitForVerdict(verdict) {
  if (verdict === 'ok') return null;
  if (verdict === 'prerequisite' || verdict === 'ratelimit') return EXIT_PREREQUISITE;
  return EXIT_PLATFORM_REFUSAL;
}

// ---------------------------------------------------------------------------
// Transport — the one shape, with both halves of the throttle around the one
// write verb. ⛔ Nothing here throws on an HTTP status.
// ---------------------------------------------------------------------------

async function rest(path, { method = 'GET', body = null } = {}, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const token = deps.token ?? TOKEN;
  const paceDeps = deps.pace ?? {};
  // ⏱ The throttle, on the write verb only — the POST that creates the card.
  const paced = isWriteMethod(method);
  if (paced) await paceWrite({ token, kind: `issue-create ${method}` }, paceDeps);
  let res;
  try {
    res = await fetchImpl(`${API}${path}`, {
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
    if (paced) releaseWriteLease(paceDeps.file); // ⏱ rule ④: no response will come, so the fleet's turn ends here
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
  // ⏱ …and the other half, with the verdict `classifyHttp` already reached.
  if (paced) {
    noteResponse(
      {
        token,
        status: res.status,
        headers: res.headers,
        body: json,
        verdict: classifyHttp({ status: res.status, rateRemaining: rateRemaining === null ? null : Number(rateRemaining) }),
      },
      paceDeps,
    );
  }
  return {
    status: res.status,
    rateRemaining: rateRemaining === null ? null : Number(rateRemaining),
    json,
    detail: typeof json?.message === 'string' ? json.message : '',
    call: `${method} ${path}`,
  };
}

/**
 * Create the card the plan describes, read it back, and say what happened.
 * Returns `{ exitCode, number, url, author, lines }`; never throws on a status.
 */
export async function createIssue(plan, deps = {}) {
  const lines = [];
  const token = deps.token ?? TOKEN;
  if (!token) {
    lines.push('✗ issue-create: no GITHUB_TOKEN / GH_TOKEN in the environment — nothing was sent. Run it through scripts/pm/with-fleet.sh, which mints the fleet identity.');
    return { exitCode: EXIT_PREREQUISITE, number: null, url: null, author: null, lines };
  }
  const route = deps.route ?? (await resolveRoute(deps.env ?? process.env));
  if (route.error) {
    lines.push(`✗ issue-create: PREREQUISITE NOT MET — ${route.error} Nothing was sent.`);
    return { exitCode: EXIT_PREREQUISITE, number: null, url: null, author: null, lines, transport: route.transport };
  }
  lines.push(`  issue-create: transport ${route.transport} — ${route.reason}`);

  let number = null;
  let url = null;
  let author = null;
  let relay = null;
  if (route.transport === 'dispatch') {
    const packed = packRequest({ repo: plan.repo, session: route.session, actions: [{ op: 'issue_create', ...plan.payload }] });
    if (!packed.ok) {
      lines.push(relayRefusalText(packed.errors), '  Nothing was sent.');
      return { exitCode: EXIT_USAGE, number: null, url: null, author: null, lines, transport: route.transport };
    }
    const dispatchedAt = (deps.now ?? (() => Date.now()))();
    const sent = await (deps.send ?? sendFleetWrite)(packed.payload, { token, log: (line) => lines.push(`  ${line}`) });
    if (sent.ok) {
      relay = sent;
      // The relay does not hand the number back; the board does. The newest
      // issue on the target created at or after the dispatch carrying the title
      // sent is the one — and the ordinary read-back below then judges it.
      const since = new Date(dispatchedAt - 60_000).toISOString();
      const listed = await rest(`/repos/${plan.repo}/issues?state=all&sort=created&direction=desc&per_page=30&since=${encodeURIComponent(since)}`, {}, deps);
      const hit = (Array.isArray(listed.json) ? listed.json : []).find((i) => !i.pull_request && String(i.title ?? '').trim() === plan.payload.title && Date.parse(i.created_at) >= dispatchedAt - 60_000);
      if (listed.status !== 200 || !hit) {
        lines.push(
          `✗ issue-create: UNCONFIRMED — the relay run ${sent.run?.url ?? sent.run?.id ?? ''} completed, but ${listed.status !== 200 ? `${listed.call} → HTTP ${listed.status}` : 'no issue created since the dispatch carries the title sent'}. ` +
            `Go READ the board; ⛔ do not re-run blind — a second dispatch is a second card. Exit ${EXIT_UNCONFIRMED}.`,
        );
        return { exitCode: EXIT_UNCONFIRMED, number: null, url: null, author: null, lines, transport: route.transport, relay };
      }
      number = hit.number;
      url = hit.html_url ?? null;
      author = hit.user?.login ?? null;
      lines.push(`✓ issue-create: created #${number}${url ? ` ${url}` : ''}${author ? ` (as ${author})` : ''} — via the relay run ${sent.run?.url ?? sent.run?.id ?? ''}`);
    } else if (route.requested === 'auto' && sent.state === 'no-run') {
      lines.push(`  ${fallbackText(sent, 'issue-create')}`);
    } else if (sent.state === 'no-run' || sent.state === 'timeout') {
      lines.push(unconfirmedText(sent, 'issue-create'));
      return { exitCode: EXIT_UNCONFIRMED, number: null, url: null, author: null, lines, transport: route.transport, relay: sent };
    } else {
      lines.push(`✗ issue-create: relay ${sent.state === 'refused' ? 'REFUSED the dispatch' : 'run FAILED'} — ${sent.detail}${sent.run?.url ? ` ${sent.run.url}` : ''}. ⛔ Not retried and not fallen back: go READ the run and the board.`);
      return { exitCode: exitForResult(sent), number: null, url: null, author: null, lines, transport: route.transport, relay: sent };
    }
  }

  if (relay === null) {
    const created = await rest(`/repos/${plan.repo}/issues`, { method: 'POST', body: plan.payload }, deps);
    const verdict = classifyHttp({ status: created.status, rateRemaining: created.rateRemaining });
    const bad = exitForVerdict(verdict);
    if (bad !== null || !Number.isInteger(created.json?.number)) {
      lines.push(`✗ issue-create: ${created.call} → HTTP ${created.status}${created.detail ? ` — ${created.detail}` : ''} (${verdict}). Nothing was created.`);
      if (verdict === 'ratelimit') lines.push('  The credential is rate-limit exhausted: this binds the IDENTITY, so switching tools or tokens to keep writing is the same act as retrying. ⛔ Do not.');
      return { exitCode: bad ?? EXIT_PLATFORM_REFUSAL, number: null, url: null, author: null, lines, transport: route.transport };
    }
    number = created.json.number;
    url = created.json.html_url ?? null;
    author = created.json.user?.login ?? null;
    lines.push(`✓ issue-create: created #${number}${url ? ` ${url}` : ''}${author ? ` (as ${author})` : ''}`);
  }

  const back = await rest(`/repos/${plan.repo}/issues/${number}`, {}, deps);
  if (back.status !== 200 || !back.json) {
    lines.push(`✗ issue-create: the read-back ${back.call} → HTTP ${back.status}${back.detail ? ` — ${back.detail}` : ''}; #${number} exists but could not be verified.`);
    return { exitCode: EXIT_READ_BACK_MISMATCH, number, url, author, lines };
  }
  const gotTitle = String(back.json.title ?? '').trim();
  if (gotTitle !== plan.payload.title) {
    lines.push(`✗ issue-create: read-back of #${number} disagrees — title ${JSON.stringify(gotTitle)}, wanted ${JSON.stringify(plan.payload.title)}.`);
    return { exitCode: EXIT_READ_BACK_MISMATCH, number, url, author, lines };
  }
  lines.push(`  read-back: #${number} title matches; state ${back.json.state ?? '?'}; labels ${(back.json.labels ?? []).map((l) => l?.name ?? l).join(', ') || '(none)'}.`);
  return { exitCode: EXIT_OK, number, url, author, lines, transport: route.transport, relay };
}

// ---------------------------------------------------------------------------
// Self-test — offline: a fake platform, injected file reads, no network.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the arguments: files not argv for prose, exactly one title source, a repo shape': 10,
  'the payload: title trimmed to one line, labels and assignees de-duplicated, nothing invented': 5,
  'the transport: a fake platform, and what each answer does to the exit code': 9,
  'dry-run: no request leaves, and the plan is printed': 3,
  'the wiring: both halves around the one POST, on the write verb only': 4,
  'the relay transport: ONE dispatch carrying the create, the card found by title since the dispatch, auto falls back only on no-run': 8,
});
const SELF_TEST_BATTERY_FLOOR = 6;
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
  const { mkdtempSync, rmSync, writeFileSync, readFileSync: readReal, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const files = { 'title.txt': '  A card with `backticks` and $HOME in it \n', 'body.md': 'Evidence: a repro.\n\n- step one\n', 'empty.md': '   \n', 'stamped.md': 'Reading time {{NOW}}\n' };
  const read = (p) => {
    if (!(p in files)) throw new Error('ENOENT');
    return files[p];
  };
  const env = { PM_SWEEP_REPO: 'objectstack-ai/objectstack' };

  // ── the arguments ─────────────────────────────────────────────────────────
  battery('the arguments: files not argv for prose, exactly one title source, a repo shape');
  {
    const good = planFrom(parseArgs(['--title-file', 'title.txt', '--body-file', 'body.md']), { read, env });
    t('a title file and a body file make a plan', good.ok, true, good.errors.join(' | '));
    t('…on the board the environment resolves when --repo is absent', good.repo, 'objectstack-ai/objectstack');
    t('--repo overrides it', planFrom(parseArgs(['--repo', 'o/r', '--title', 'x', '--body-file', 'body.md']), { read, env }).repo, 'o/r');
    t('a repo that is not owner/name is refused', planFrom(parseArgs(['--repo', 'nope', '--title', 'x', '--body-file', 'body.md']), { read, env }).errors.some((e) => e.includes('owner/name')));
    t('both title sources are refused', planFrom(parseArgs(['--title', 'x', '--title-file', 'title.txt', '--body-file', 'body.md']), { read, env }).errors.some((e) => e.includes('ONCE')));
    t('neither is refused', planFrom(parseArgs(['--body-file', 'body.md']), { read, env }).errors.some((e) => e.includes('a title is required')));
    t('⛔ a --title carrying a backtick or a dollar sign is refused — the shell already had its turn', planFrom(parseArgs(['--title', 'the `id` field', '--body-file', 'body.md']), { read, env }).errors.some((e) => e.includes('backtick')));
    t('…while the same title from a FILE is accepted verbatim', good.payload.title, 'A card with `backticks` and $HOME in it');
    t('a body never comes from argv: --body-file is required', planFrom(parseArgs(['--title', 'x']), { read, env }).errors.some((e) => e.includes('--body-file')));
    t('an unreadable file is a refusal, not a crash', planFrom(parseArgs(['--title', 'x', '--body-file', 'missing.md']), { read, env }).errors.some((e) => e.includes('cannot be read')));
    t('a flag without its value is a usage error', parseArgs(['--title']).errors, ['--title needs a value']);
    t('an unknown flag is reported, ⛔ never silently dropped', parseArgs(['--tilte', 'x']).unknown, ['--tilte', 'x']);
  }

  // ── the payload ───────────────────────────────────────────────────────────
  battery('the payload: title trimmed to one line, labels and assignees de-duplicated, nothing invented');
  {
    const p = planFrom(parseArgs(['--title', 'x', '--body-file', 'body.md', '--label', 'a', '--label', 'b', '--label', 'a', '--assignee', 'u', '--assignee', ' u ']), { read, env });
    t('labels are de-duplicated in order', p.payload.labels, ['a', 'b']);
    t('assignees too, trimmed', p.payload.assignees, ['u']);
    t('no labels ⇒ no labels key at all, nothing invented', 'labels' in planFrom(parseArgs(['--title', 'x', '--body-file', 'body.md']), { read, env }).payload, false);
    t('an empty body is refused', planFrom(parseArgs(['--title', 'x', '--body-file', 'empty.md']), { read, env }).errors.some((e) => e.includes('body is empty')));
    t('a body carrying a stamp token is refused — that is post-stamped\'s contract', planFrom(parseArgs(['--title', 'x', '--body-file', 'stamped.md']), { read, env }).errors.some((e) => e.includes('{{NOW}}')));
  }

  const dir = mkdtempSync(join(tmpdir(), 'issue-create-'));
  try {
    // One pace file PER CASE: a stop marker one answer writes must not refuse
    // the next case's POST — except in the case that pins exactly that.
    let paceCase = 0;
    const paceFile = join(dir, 'pace-0.jsonl');
    const paceFor = (file) => ({
      file,
      env: { OS_PM_WRITE_MIN_GAP_MS: '0' },
      log: () => {},
      exit: (code) => {
        throw Object.assign(new Error(`throttle refused with exit ${code}`), { throttleExit: code });
      },
    });
    const TOKEN_FIXTURE = 'ghs_FixtureTokenNotRealAtAll0000000000000';
    const plan = planFrom(parseArgs(['--repo', 'o/r', '--title-file', 'title.txt', '--body-file', 'body.md', '--label', 'pm:queue']), { read, env });
    const platform = (answers, seen) => async (url, init) => {
      const u = new URL(url);
      const call = `${init?.method ?? 'GET'} ${u.pathname}`;
      seen.push({ call, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.authorization ?? '' });
      const a = answers[call] ?? { status: 404, json: { message: 'Not Found' } };
      if (a.throws) throw new Error(a.throws);
      // The platform sends the quota header on every answer; an answer that
      // omits it is what `classifyHttp` reads as "exhausted", so the fake
      // sends a live quota unless the case says otherwise.
      return { status: a.status, headers: new Headers({ 'x-ratelimit-remaining': '4999', ...(a.headers ?? {}) }), json: async () => a.json };
    };
    const happy = {
      'POST /repos/o/r/issues': { status: 201, json: { number: 12, html_url: 'https://github.test/o/r/issues/12', user: { login: 'objectstack-fleet[bot]' } } },
      'GET /repos/o/r/issues/12': { status: 200, json: { number: 12, title: plan.payload.title, state: 'open', labels: [{ name: 'pm:queue' }] } },
    };
    const DIRECT_ROUTE = { requested: 'direct', transport: 'direct', reason: 'self-test: direct', error: null, session: null };
    const drive = async (answers, { file, route, send, now, plan: planOverride } = {}) => {
      const seen = [];
      const pace = paceFor(file ?? join(dir, `pace-${paceCase++}.jsonl`));
      try {
        const r = await createIssue(planOverride ?? plan, { fetch: platform(answers, seen), token: TOKEN_FIXTURE, pace, route: route ?? DIRECT_ROUTE, send, now });
        return { ...r, seen, pace };
      } catch (e) {
        if (e?.throttleExit === undefined) throw e;
        return { exitCode: e.throttleExit, number: null, url: null, author: null, lines: [], seen, pace, throttled: true };
      }
    };

    // ── the transport ───────────────────────────────────────────────────────
    battery('the transport: a fake platform, and what each answer does to the exit code');
    {
      const ok = await drive(happy, { file: paceFile });
      t('a 201 and a matching read-back is exit 0, and the number, URL and actor are printed', [ok.exitCode, ok.number, ok.lines.some((l) => l.includes('created #12') && l.includes('objectstack-fleet[bot]'))], [EXIT_OK, 12, true]);
      t('the POST carries the payload the plan built, and the bearer token', [ok.seen[0].body, ok.seen[0].auth], [plan.payload, `Bearer ${TOKEN_FIXTURE}`]);
      t('…then exactly one read-back GET', ok.seen.map((s) => s.call), ['POST /repos/o/r/issues', 'GET /repos/o/r/issues/12']);
      const mismatch = await drive({ ...happy, 'GET /repos/o/r/issues/12': { status: 200, json: { number: 12, title: 'something else' } } });
      t('a read-back that disagrees is exit 4, with the number still printed', [mismatch.exitCode, mismatch.number], [EXIT_READ_BACK_MISMATCH, 12]);
      const refused = await drive({ ...happy, 'POST /repos/o/r/issues': { status: 403, json: { message: 'Resource not accessible by integration' } } });
      t('a 403 is a platform refusal (exit 5) carrying the platform\'s own sentence', [refused.exitCode, refused.lines.some((l) => l.includes('Resource not accessible'))], [EXIT_PLATFORM_REFUSAL, true]);
      const exhausted = await drive({ ...happy, 'POST /repos/o/r/issues': { status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: { message: 'API rate limit exceeded' } } });
      t('a 403 with the quota exhausted is a PREREQUISITE failure (exit 3) that binds the identity', [exhausted.exitCode, exhausted.lines.some((l) => l.includes('binds the IDENTITY'))], [EXIT_PREREQUISITE, true]);
      const afterMarker = await drive(happy, { file: exhausted.pace.file });
      t('…and the stop marker that answer wrote refuses the NEXT create before it leaves (exit 10, no request)', [afterMarker.exitCode, afterMarker.throttled, afterMarker.seen.length], [EXIT_WRITE_PACE_REFUSED, true, 0]);
      const unprocessable = await drive({ ...happy, 'POST /repos/o/r/issues': { status: 422, json: { message: 'Validation Failed' } } });
      t('a 422 is a platform refusal too', unprocessable.exitCode, EXIT_PLATFORM_REFUSAL);
      const down = await drive({ ...happy, 'POST /repos/o/r/issues': { throws: 'ECONNRESET' } });
      t('an unreachable platform is exit 3, and the lease it held was released on the way out', [down.exitCode, existsSync(`${down.pace.file}.lease`)], [EXIT_PREREQUISITE, false]);
      const noToken = await createIssue(plan, { fetch: platform(happy, []), token: '', pace: paceFor(join(dir, 'pace-none.jsonl')) });
      t('no token is exit 3 before any request, naming with-fleet.sh', [noToken.exitCode, noToken.lines[0].includes('with-fleet.sh')], [EXIT_PREREQUISITE, true]);
    }

    // ── dry-run ─────────────────────────────────────────────────────────────
    battery('dry-run: no request leaves, and the plan is printed');
    {
      writeFileSync(join(dir, 'b.md'), 'A body.\n', 'utf8');
      const spawned = spawnSync(process.execPath, [SELF_PATH, '--dry-run', '--repo', 'o/r', '--title', 'Dry', '--body-file', join(dir, 'b.md')], {
        encoding: 'utf8',
        env: { ...process.env, OS_PM_WRITE_PACE_FILE: join(dir, 'dry-pace.jsonl'), GITHUB_TOKEN: TOKEN_FIXTURE, GH_TOKEN: '', HTTPS_PROXY: '', https_proxy: '' },
      });
      t('--dry-run exits 0 and prints the request it did not send', [spawned.status, spawned.stdout.includes('NOTHING was sent') && spawned.stdout.includes('POST /repos/o/r/issues')], [0, true], spawned.stderr.slice(-300));
      t('…and the throttle recorded nothing: a dry run makes no write', existsSync(join(dir, 'dry-pace.jsonl')), false);
      t('a refused plan is usage, printed, and nothing is sent', spawnSync(process.execPath, [SELF_PATH, '--dry-run', '--repo', 'o/r', '--title', 'x'], { encoding: 'utf8', env: { ...process.env, HTTPS_PROXY: '', https_proxy: '' } }).status, EXIT_USAGE);
    }

    // ── the relay transport ─────────────────────────────────────────────────
    battery('the relay transport: ONE dispatch carrying the create, the card found by title since the dispatch, auto falls back only on no-run');
    {
      const SESSION = 'session_01ABCDEFGHJKMNPQRSTVWXYZ';
      const NOW = Date.UTC(2026, 8, 22, 9, 4, 0);
      const dispatchRoute = (requested = 'dispatch') => ({ requested, transport: 'dispatch', reason: 'self-test: dispatch', error: null, session: SESSION });
      const RUN = { id: 42, url: 'https://github.test/run/42', status: 'completed', conclusion: 'success' };
      const outcome = (state, extra = {}) => async (payload) => ({ state, ok: state === 'success', status: state === 'refused' ? 404 : 204, verdict: state === 'refused' ? 'refusal' : 'ok', requestId: payload.request_id, startMs: 1, ceilingMs: 2, run: state === 'no-run' || state === 'refused' ? null : RUN, detail: '', ...extra });
      // The relay only serves the organization the App is installed on, so these cases target a repo of it.
      const ORG_REPO = 'objectstack-ai/objectstack';
      const orgPlan = planFrom(parseArgs(['--repo', ORG_REPO, '--title-file', 'title.txt', '--body-file', 'body.md', '--label', 'pm:queue']), { read, env });
      const orgHappy = {
        [`POST /repos/${ORG_REPO}/issues`]: { status: 201, json: { number: 12, html_url: `https://github.test/${ORG_REPO}/issues/12`, user: { login: 'objectstack-fleet[bot]' } } },
        [`GET /repos/${ORG_REPO}/issues/12`]: { status: 200, json: { number: 12, title: orgPlan.payload.title, state: 'open', labels: [{ name: 'pm:queue' }] } },
      };
      const listing = (rows) => ({ [`GET /repos/${ORG_REPO}/issues`]: { status: 200, json: rows } });
      const created = { number: 12, title: orgPlan.payload.title, html_url: `https://github.test/${ORG_REPO}/issues/12`, user: { login: 'objectstack-fleet[bot]' }, created_at: new Date(NOW + 5000).toISOString() };
      const sentPayloads = [];
      const ok = await drive({ ...orgHappy, ...listing([{ ...created, number: 13, title: 'another card', created_at: new Date(NOW + 9000).toISOString() }, created]) }, {
        plan: orgPlan,
        route: dispatchRoute(),
        now: () => NOW,
        send: async (p) => {
          sentPayloads.push(p);
          return outcome('success')(p);
        },
      });
      t('under dispatch ONE payload carries the create — title, body, labels — with the session and the target', [sentPayloads.length, sentPayloads[0]?.session, sentPayloads[0]?.repo, sentPayloads[0]?.actions], [1, SESSION, ORG_REPO, [{ op: 'issue_create', title: orgPlan.payload.title, body: orgPlan.payload.body, labels: ['pm:queue'] }]]);
      t('…no POST left this process; the card was found by title among issues created since the dispatch, then read back', [ok.exitCode, ok.number, ok.seen.map((s) => s.call)], [EXIT_OK, 12, [`GET /repos/${ORG_REPO}/issues`, `GET /repos/${ORG_REPO}/issues/12`]], ok.lines.join(' | '));
      t('…and the actor printed is the bot the relay wrote as', ok.lines.some((l) => l.includes('objectstack-fleet[bot]') && l.includes('via the relay run')));
      const notFound = await drive({ ...orgHappy, ...listing([]) }, { plan: orgPlan, route: dispatchRoute(), now: () => NOW, send: outcome('success') });
      t('a run that succeeded but no card carrying the title since the dispatch is exit 6 UNCONFIRMED, never a second dispatch', [notFound.exitCode, notFound.lines.some((l) => l.includes('UNCONFIRMED'))], [EXIT_UNCONFIRMED, true]);
      const timedOut = await drive(orgHappy, { plan: orgPlan, route: dispatchRoute(), send: outcome('timeout', { run: { ...RUN, status: 'in_progress', conclusion: null } }) });
      t('a run that did not complete within the ceiling is exit 6 with the run url, and no POST left', [timedOut.exitCode, timedOut.lines.join('\n').includes('https://github.test/run/42'), timedOut.seen.length], [EXIT_UNCONFIRMED, true, 0]);
      const noRunExplicit = await drive(orgHappy, { plan: orgPlan, route: dispatchRoute('dispatch'), send: outcome('no-run') });
      t('under an EXPLICIT dispatch, no run is exit 6 — no fall-back', [noRunExplicit.exitCode, noRunExplicit.seen.length], [EXIT_UNCONFIRMED, 0]);
      const noRunAuto = await drive(orgHappy, { plan: orgPlan, route: dispatchRoute('auto'), send: outcome('no-run') });
      t('under AUTO, no run falls back to the direct POST — said out loud — and the card is created and read back', [noRunAuto.exitCode, noRunAuto.number, noRunAuto.lines.some((l) => l.includes('Falling back to DIRECT')), noRunAuto.seen.map((s) => s.call)], [EXIT_OK, 12, true, [`POST /repos/${ORG_REPO}/issues`, `GET /repos/${ORG_REPO}/issues/12`]]);
      const failedRun = await drive(orgHappy, { plan: orgPlan, route: dispatchRoute('auto'), send: outcome('failure', { run: { ...RUN, conclusion: 'failure' }, detail: 'conclusion failure' }) });
      t('⛔ a run that FAILED is never fallen back from, even under auto: exit 5, no POST', [failedRun.exitCode, failedRun.seen.length], [EXIT_PLATFORM_REFUSAL, 0]);
    }

    // ── the wiring ──────────────────────────────────────────────────────────
    battery('the wiring: both halves around the one POST, on the write verb only');
    {
      const { WIRED_WRITE_TOOLS } = await import('./write-pace.mjs');
      const own = readReal(SELF_PATH, 'utf8');
      t('write-pace lists this file among the wired write tools', WIRED_WRITE_TOOLS.includes('scripts/pm/issue-create.mjs'));
      t('this file calls both halves, guarded by the write-verb predicate', own.includes('paceWrite(') && own.includes('noteResponse(') && own.includes('isWriteMethod('));
      const records = readReal(paceFile, 'utf8');
      t('the POSTs above were paced; the read-backs were not', [records.includes('issue-create POST'), records.includes('issue-create GET')], [true, false]);
      t('⛔ and the token never reached the throttle\'s log', records.includes(TOKEN_FIXTURE), false);
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
    console.error(`✗ issue-create self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(
    `✓ issue-create self-test: ${cases.length} cases pass across ${declared.length} batteries — prose from files and never argv, ` +
      'one title source, a fake platform through every exit code, a dry run that sends nothing, and both halves of the throttle around the one POST.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const USAGE = [
  'usage:',
  '  node scripts/pm/issue-create.mjs [--repo owner/name] (--title-file <path> | --title <text>) --body-file <path>',
  '                                   [--label <name>]… [--assignee <login>]… [--json] [--dry-run]',
  '  node scripts/pm/issue-create.mjs --self-test',
  '',
  '  The body comes from a file, always; the title from a file by preference. A batch of N ≥ 5 cards is',
  '  announced first:  node scripts/pm/write-pace.mjs --announce-batch N --kind "issue-create POST"',
  '  OS_FLEET_TRANSPORT=direct|dispatch|auto (default auto): dispatch sends the create through the fleet-write relay as',
  "  objectstack-fleet[bot]; auto takes it in a cloud seat container (the seat's session is read from the container's",
  '  CLAUDE_CODE_REMOTE_SESSION_ID; OS_FLEET_SESSION overrides it — a local checkout, a test) and direct elsewhere.',
  `  Exits: 0 created and read back · ${EXIT_USAGE} usage · ${EXIT_PREREQUISITE} prerequisite · ${EXIT_READ_BACK_MISMATCH} read-back mismatch · ${EXIT_PLATFORM_REFUSAL} platform refused · ${EXIT_UNCONFIRMED} dispatched but UNCONFIRMED · ${EXIT_WRITE_PACE_REFUSED} throttle refused`,
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
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — the request will bypass the proxy.`);
  return null;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (opts.selfTest) return selfTest();
  if (opts.unknown.length || opts.errors.length) {
    for (const e of opts.errors) console.error(`issue-create: ${e}`);
    if (opts.unknown.length) console.error(`issue-create: unrecognised argument ${opts.unknown.map((u) => `\`${u}\``).join(', ')}`);
    console.error(`\n${USAGE}`);
    return EXIT_USAGE;
  }
  const plan = planFrom(opts);
  if (!plan.ok) {
    for (const e of plan.errors) console.error(`✗ issue-create: ${e}`);
    console.error('  Nothing was sent.');
    return EXIT_USAGE;
  }
  if (opts.dryRun) {
    console.log(dryRunText(plan));
    return EXIT_OK;
  }
  const rearmed = rearmThroughProxy(argv);
  if (rearmed !== null) return rearmed;
  const result = await createIssue(plan);
  for (const line of result.lines) console.error(line);
  if (opts.json && result.number !== null) console.log(JSON.stringify({ number: result.number, html_url: result.url, author: result.author, repo: plan.repo, transport: result.transport ?? null, relay_run: result.relay?.run?.url ?? null }));
  return result.exitCode;
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\n✗ issue-create self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
        'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}
