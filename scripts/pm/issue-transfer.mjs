#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * issue-transfer — the one door a card leaves its repository through, WITH
 * its history.
 *
 *   node scripts/pm/issue-transfer.mjs --repo objectstack-ai/objectstack --issue 123 --to objectstack-ai/objectui [--json]
 *   node scripts/pm/issue-transfer.mjs --issue 123 --to objectstack-ai/objectui --dry-run
 *   node scripts/pm/issue-transfer.mjs --self-test          # offline, a fake platform, no network at all
 *
 * ## Why this file exists
 *
 * A card filed in the wrong repository used to be REBUILT in the right one —
 * a provenance header, every bare `#N` spelled out, the source closed as
 * moved — because the fleet-write relay had no transfer op. A rebuild loses
 * the comment thread, the timeline, the cross-references and the reactions,
 * and leaves a closed husk behind. GitHub's `transferIssue` mutation keeps
 * them, keeps comments and assignees, and redirects the old URL. This door
 * performs it — through the relay's `transfer` row in a cloud seat, or
 * directly with a fleet token elsewhere — and reads the card back at its new
 * address. One card per call; N cards are N calls.
 *
 * ## What it refuses, before any request leaves
 *
 *   - a source outside the organization (a transfer never leaves it);
 *   - whatever the relay's own validator refuses for the same stroke —
 *     `validateStroke` in `fleet-write/validate.mjs`, ONE judge for both
 *     transports: a target outside `TRANSFER_TARGETS` (the governed roster),
 *     the source as its own target, a number that is not a positive integer.
 *
 * And after one read, before any write:
 *
 *   - a number that is a pull request — only an issue transfers;
 *   - a card that no longer answers from the source (the platform followed
 *     its redirect): already moved. The door names where it lives now and
 *     sends nothing — so after an UNCONFIRMED, READ the card; this refusal is
 *     what a blind re-run would meet, not a licence to try one.
 *
 * ## The transport — `OS_FLEET_TRANSPORT` direct | dispatch | auto
 *
 * `dispatch` packs ONE `transfer` action into ONE `repository_dispatch`; the
 * relay mints its token for the source AND the target — the one widening it
 * makes — and gates the sender on both. `direct` reads the target's node id
 * and sends the relay row's own mutation with the token this process holds.
 * `auto` takes `dispatch` in a cloud seat container and `direct` elsewhere,
 * and says which; it falls back to `direct` only when NO run appeared, never
 * from a run that failed (issue-create's rule, and dispatch.mjs's reasons).
 *
 * ## Read-back — the old URL redirects, the card answers at the new one
 *
 * `GET /repos/{source}/issues/{n}` WITHOUT following redirects must answer
 * 301 naming the new issue, and `GET /repos/{target}/issues/{m}` must answer
 * from the target with the title the pre-read saw. Both, or not confirmed.
 * Labels with no same-named label on the target are dropped by the platform
 * (the relay never asks it to create them); the read-back prints what stayed.
 *
 * ## When the platform refuses — fail closed, name the remedy
 *
 * Whether the fleet App's installation covers the target is a maintainer
 * setting no seat token can read. A failed run, a target whose node id cannot
 * be read, or a refused mutation is refused here with `transferRemedy`
 * (`fleet-write/ops.mjs`): the maintainer adds the target to the App's
 * repository access. ⛔ The door never falls back to a rebuild: an
 * installation gap is a setting to fix. The rebuild recipe
 * (`.claude/skills/pm-dispatch/references/cross-repo-coordination.md`) stays
 * for a target outside `TRANSFER_TARGETS` and for a move GitHub refuses
 * outright — another organization, a private card into a public repository.
 *
 * ## Exit codes — capture them BEFORE any pipe (issue-create's ladder)
 *
 *   0   transferred, and read back: the old URL redirects, the new one answers.
 *   2   usage, or a refusal above. Nothing was transferred.
 *   3   PREREQUISITE NOT MET — no token, the platform unreachable, the
 *       credential rate-limit exhausted, or no route. Nothing was transferred.
 *   4   the platform answered, and the BOARD DISAGREES — the card sits on
 *       another repository, under another title, or the old URL still serves
 *       it. Every number seen is printed.
 *   5   the platform refused, or the relay run FAILED. The remedy is printed.
 *   6   UNCONFIRMED — the dispatch was accepted and its run did not appear or
 *       complete within the ceiling, or the read-back could not be taken. The
 *       run URL is printed. Go READ the card; ⛔ never re-run blind.
 *  10   the write throttle refused. Nothing was sent.
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { EXIT_PREREQUISITE_NOT_MET, PROXY_FLAG, proxyRearmPlan, resolveSweepRepo } from './check-half-states.mjs';
import { EXIT_UNCONFIRMED, exitForResult, fallbackText, packRequest, resolveRoute, sendFleetWrite, unconfirmedText } from './fleet-write/dispatch.mjs';
import { repoOfIssue, requestLanded } from './fleet-write/execute.mjs';
import { OPS, TARGET_OWNER, TARGET_REPO_SHAPE, TRANSFER_TARGETS, transferRemedy } from './fleet-write/ops.mjs';
import { refusalText as relayRefusalText, validateStroke } from './fleet-write/validate.mjs';
import { classifyHttp } from './label-write.mjs';
import { EXIT_WRITE_PACE_REFUSED, isWriteMethod, noteResponse, paceWrite, releaseWriteLease } from './write-pace.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const PROXY_REARM_GUARD = 'OS_ISSUE_TRANSFER_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = EXIT_PREREQUISITE_NOT_MET;
export const EXIT_BOARD_DISAGREES = 4;
export const EXIT_PLATFORM_REFUSAL = 5;

// ---------------------------------------------------------------------------
// The pure core — arguments, the plan, the verdict on a status.
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { repo: null, issue: null, to: null, json: false, dryRun: false, selfTest: false, help: false, unknown: [], errors: [] };
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
    else if (a === '--issue') opts.issue = value(a);
    else if (a === '--to') opts.to = value(a);
    else if (a.startsWith('--') && a.includes('=')) {
      const [k, ...rest] = a.split('=');
      args.unshift(k, rest.join('='));
    } else opts.unknown.push(a);
  }
  return opts;
}

/**
 * The plan: the one `transfer` action, its source and target, or why not.
 * The relay's validator judges the stroke for BOTH transports.
 */
export function planFrom(opts, { env = process.env } = {}) {
  const errors = [];
  const resolved = opts.repo ? { repo: String(opts.repo).trim(), source: '--repo' } : resolveSweepRepo(env);
  const repo = resolved.repo;
  if (!TARGET_REPO_SHAPE.test(repo) || repo.includes('..')) {
    errors.push(`the source must be ${TARGET_OWNER}/<name> — a transfer never leaves the one organization the fleet App is installed on; got ${JSON.stringify(repo)} (from ${resolved.source})`);
  }
  const rawIssue = opts.issue === null ? null : String(opts.issue).trim();
  if (rawIssue === null) errors.push('the card is required: --issue <number>');
  else if (!/^[1-9][0-9]*$/.test(rawIssue)) errors.push(`--issue must be a positive integer; got ${JSON.stringify(opts.issue)}`);
  const to = opts.to === null ? null : String(opts.to).trim();
  if (to === null) errors.push(`the target is required: --to <one of ${TRANSFER_TARGETS.join(', ')}>`);
  const action = { op: 'transfer', issue: rawIssue === null ? null : Number(rawIssue), target_repo: to };
  if (errors.length === 0) errors.push(...validateStroke(repo, [action]));
  return { ok: errors.length === 0, errors, repo, to, issue: action.issue, action };
}

/** What `--dry-run` prints: the whole stroke, nothing sent. */
export function dryRunText(plan) {
  return [
    'issue-transfer --dry-run — NOTHING was sent, nothing was read.',
    `  card      : ${plan.repo}#${plan.issue}`,
    `  target    : ${plan.to}`,
    `  mutation  : ${OPS.transfer.requests(plan.action)[0].graphql.mutation} (labels the target lacks are dropped, never created)`,
    `  relay     : ONE fleet-write action ${JSON.stringify(plan.action)}; its token reaches ${plan.repo} and ${plan.to}`,
  ].join('\n');
}

/** The exit a transport verdict maps to. `null` means "carry on". */
export function exitForVerdict(verdict) {
  if (verdict === 'ok') return null;
  if (verdict === 'prerequisite' || verdict === 'ratelimit') return EXIT_PREREQUISITE;
  return EXIT_PLATFORM_REFUSAL;
}

/** The issue number an API redirect names (`…/issues/31`), or null. */
export function numberFromRedirect({ json, location } = {}) {
  for (const candidate of [json?.url, location]) {
    const m = /\/issues\/([1-9][0-9]*)(?:[?#].*)?$/.exec(String(candidate ?? ''));
    if (m) return Number(m[1]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Transport — the one shape, with both halves of the throttle around the one
// write verb. ⛔ Nothing here throws on an HTTP status.
// ---------------------------------------------------------------------------

async function rest(path, { method = 'GET', body = null, redirect = 'follow' } = {}, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const token = deps.token ?? TOKEN;
  const paceDeps = deps.pace ?? {};
  // ⏱ The throttle, on the write verb only — the POST that carries the mutation.
  const paced = isWriteMethod(method);
  if (paced) await paceWrite({ token, kind: `issue-transfer ${method}` }, paceDeps);
  let res;
  try {
    res = await fetchImpl(`${API}${path}`, {
      method,
      redirect,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    if (paced) releaseWriteLease(paceDeps.file); // ⏱ no response will come, so the fleet's turn ends here
    return { status: 0, rateRemaining: null, json: null, location: null, detail: e?.message ?? 'fetch threw', call: `${method} ${path}` };
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
      { token, status: res.status, headers: res.headers, body: json, verdict: classifyHttp({ status: res.status, rateRemaining: rateRemaining === null ? null : Number(rateRemaining) }) },
      paceDeps,
    );
  }
  return {
    status: res.status,
    rateRemaining: rateRemaining === null ? null : Number(rateRemaining),
    json,
    location: res.headers.get('location'),
    detail: typeof json?.message === 'string' ? json.message : '',
    call: `${method} ${path}`,
  };
}

/**
 * Transfer the card the plan names, read it back, and say what happened.
 * Returns `{ exitCode, from, to, lines, transport, relay }`; never throws on a
 * status.
 */
export async function transferIssue(plan, deps = {}) {
  const lines = [];
  const token = deps.token ?? TOKEN;
  const ctx = { from: { repo: plan.repo, number: plan.issue }, to: null, transport: null, relay: null };
  const done = (exitCode, extra = {}) => ({ exitCode, lines, ...ctx, ...extra });
  const remedy = () => `  Remedy: ${transferRemedy(plan.repo, plan.to)}`;
  const said = (r) => (r.detail ? ` — ${r.detail}` : '');
  if (!token) {
    lines.push('✗ issue-transfer: no GITHUB_TOKEN / GH_TOKEN in the environment — nothing was sent. Run it through scripts/pm/with-fleet.sh, which mints the fleet identity.');
    return done(EXIT_PREREQUISITE);
  }
  const route = deps.route ?? (await resolveRoute(deps.env ?? process.env));
  ctx.transport = route.transport;
  if (route.error) {
    lines.push(`✗ issue-transfer: PREREQUISITE NOT MET — ${route.error} Nothing was sent.`);
    return done(EXIT_PREREQUISITE);
  }
  lines.push(`  issue-transfer: transport ${route.transport} — ${route.reason}`);

  // ── the pre-read: the card, still on the source, and an issue ─────────────
  const pre = await rest(`/repos/${plan.repo}/issues/${plan.issue}`, {}, deps);
  if (pre.status !== 200 || !pre.json) {
    lines.push(`✗ issue-transfer: ${pre.call} → HTTP ${pre.status}${said(pre)}: the card could not be read, so nothing was sent.`);
    return done(exitForVerdict(classifyHttp({ status: pre.status, rateRemaining: pre.rateRemaining })) ?? EXIT_PLATFORM_REFUSAL);
  }
  if (pre.json.pull_request) {
    lines.push(`✗ issue-transfer: ${plan.repo}#${plan.issue} is a pull request — only an issue transfers. Nothing was sent.`);
    return done(EXIT_USAGE);
  }
  const at = repoOfIssue(pre.json);
  if (!at || at.toLowerCase() !== plan.repo.toLowerCase()) {
    const where = at ? ` — it lives on ${at} as #${pre.json.number}${pre.json.html_url ? ` ${pre.json.html_url}` : ''}` : ' (its repository could not be read)';
    lines.push(`✗ issue-transfer: ${plan.repo}#${plan.issue} no longer answers from ${plan.repo}${where}. Already moved; nothing was sent.`);
    return done(EXIT_USAGE, at ? { to: { repo: at, number: pre.json.number ?? null, url: pre.json.html_url ?? null } } : {});
  }
  const title = String(pre.json.title ?? '').trim();
  const labelsBefore = (pre.json.labels ?? []).map((l) => l?.name ?? String(l));

  // ── the transfer ──────────────────────────────────────────────────────────
  let claimed = null;
  if (route.transport === 'dispatch') {
    const packed = packRequest({ repo: plan.repo, session: route.session, actions: [plan.action] });
    if (!packed.ok) {
      lines.push(relayRefusalText(packed.errors), '  Nothing was sent.');
      return done(EXIT_USAGE);
    }
    const sent = await (deps.send ?? sendFleetWrite)(packed.payload, { token, log: (line) => lines.push(`  ${line}`) });
    if (sent.ok) {
      ctx.relay = sent;
      lines.push(`  issue-transfer: the relay run ${sent.run?.url ?? sent.run?.id ?? ''} completed — reading the card back.`);
    } else if (route.requested === 'auto' && sent.state === 'no-run') {
      lines.push(`  ${fallbackText(sent, 'issue-transfer')}`);
    } else if (sent.state === 'no-run' || sent.state === 'timeout') {
      lines.push(unconfirmedText(sent, 'issue-transfer'));
      return done(EXIT_UNCONFIRMED, { relay: sent });
    } else {
      lines.push(`✗ issue-transfer: relay ${sent.state === 'refused' ? 'REFUSED the dispatch' : 'run FAILED'} — ${sent.detail}${sent.run?.url ? ` ${sent.run.url}` : ''}. ⛔ Not retried and not fallen back: go READ the run's summary and the card.`);
      if (sent.state !== 'refused') lines.push(remedy());
      return done(exitForResult(sent), { relay: sent });
    }
  }
  if (ctx.relay === null) {
    const target = await rest(`/repos/${plan.to}`, {}, deps);
    if (target.status !== 200 || typeof target.json?.node_id !== 'string') {
      lines.push(`✗ issue-transfer: ${target.call} → HTTP ${target.status}${said(target)}: the target's node id could not be read. Nothing was sent.`, remedy());
      return done(exitForVerdict(classifyHttp({ status: target.status, rateRemaining: target.rateRemaining })) ?? EXIT_PLATFORM_REFUSAL);
    }
    // The relay row's own descriptor — one spelling of the mutation for both transports.
    const req = OPS.transfer.requests(plan.action)[0];
    const answer = await rest('/graphql', { method: 'POST', body: { query: req.graphql.query, variables: { issueId: pre.json.node_id, repositoryId: target.json.node_id } } }, deps);
    const verdict = classifyHttp({ status: answer.status, rateRemaining: answer.rateRemaining });
    const bad = exitForVerdict(verdict);
    if (bad !== null) {
      lines.push(`✗ issue-transfer: POST /graphql ${req.graphql.mutation} → HTTP ${answer.status}${said(answer)} (${verdict}). Nothing was transferred.`);
      lines.push(verdict === 'ratelimit' ? '  The credential is rate-limit exhausted: this binds the IDENTITY, so switching tools or tokens to keep writing is the same act as retrying. ⛔ Do not.' : remedy());
      return done(bad);
    }
    const landed = requestLanded(req, answer);
    const moved = answer.json?.data?.[req.graphql.mutation]?.issue;
    if (!landed.ok) {
      if (moved && Number.isInteger(moved.number)) {
        lines.push(`✗ issue-transfer: the board disagrees — ${landed.why}; it answered #${moved.number}${moved.url ? ` ${moved.url}` : ''}.`);
        return done(EXIT_BOARD_DISAGREES, { to: { repo: moved.repository?.nameWithOwner ?? null, number: moved.number, url: moved.url ?? null } });
      }
      lines.push(`✗ issue-transfer: POST /graphql ${req.graphql.mutation} → ${landed.why}. Nothing was transferred.`, remedy());
      return done(EXIT_PLATFORM_REFUSAL);
    }
    claimed = moved.number;
    lines.push(`  issue-transfer: ${req.graphql.mutation} answered ${plan.to}#${claimed}${moved.url ? ` ${moved.url}` : ''} — reading the card back.`);
  }

  // ── the read-back: the old URL redirects, the new one answers ─────────────
  const unconfirmed = (why) => {
    lines.push(`✗ issue-transfer: UNCONFIRMED — ${why}. Go READ ${plan.repo}#${plan.issue} and ${plan.to}; ⛔ do not re-run blind. Exit ${EXIT_UNCONFIRMED}.`);
    return done(EXIT_UNCONFIRMED);
  };
  const old = await rest(`/repos/${plan.repo}/issues/${plan.issue}`, { redirect: 'manual' }, deps);
  if (old.status === 200) {
    lines.push(`✗ issue-transfer: the board disagrees — ${old.call} still answers 200 from ${repoOfIssue(old.json) ?? '?'}: the card did not move${claimed !== null ? `, though the mutation answered #${claimed}` : ''}.`);
    return done(EXIT_BOARD_DISAGREES);
  }
  if (old.status !== 301) return unconfirmed(`${old.call} answered HTTP ${old.status}${said(old)}, not the 301 a moved card answers`);
  const number = numberFromRedirect(old);
  if (number === null) return unconfirmed(`${old.call} answered 301 naming no issue number`);
  if (claimed !== null && claimed !== number) {
    lines.push(`✗ issue-transfer: the board disagrees — the mutation answered #${claimed}, the old URL redirects to #${number}.`);
    return done(EXIT_BOARD_DISAGREES, { to: { repo: plan.to, number, url: null } });
  }
  const fresh = await rest(`/repos/${plan.to}/issues/${number}`, {}, deps);
  if (fresh.status !== 200 || !fresh.json) return unconfirmed(`the old URL redirects to #${number}, but ${fresh.call} answered HTTP ${fresh.status}${said(fresh)}`);
  const freshAt = repoOfIssue(fresh.json);
  const freshTitle = String(fresh.json.title ?? '').trim();
  const to = { repo: freshAt ?? plan.to, number, url: fresh.json.html_url ?? null };
  if (!freshAt || freshAt.toLowerCase() !== plan.to.toLowerCase() || freshTitle !== title) {
    lines.push(`✗ issue-transfer: the board disagrees — #${number} answers from ${freshAt ?? '?'} titled ${JSON.stringify(freshTitle)}; wanted ${plan.to} titled ${JSON.stringify(title)}.`);
    return done(EXIT_BOARD_DISAGREES, { to });
  }
  const labelsAfter = (fresh.json.labels ?? []).map((l) => l?.name ?? String(l));
  const dropped = labelsBefore.filter((l) => !labelsAfter.includes(l));
  lines.push(`✓ issue-transfer: ${plan.repo}#${plan.issue} → ${plan.to}#${number}${to.url ? ` ${to.url}` : ''}`);
  lines.push(
    `  read-back: the old URL answers 301 to #${number}; #${number} answers from ${plan.to} with the same title; labels kept: ${labelsAfter.join(', ') || '(none)'}` +
      `${dropped.length ? `; dropped (no same-named label on the target): ${dropped.join(', ')}` : ''}.`,
  );
  return done(EXIT_OK, { to });
}

// ---------------------------------------------------------------------------
// Self-test — offline: a fake board that moves the card when the mutation (or
// the relay) lands, injected routes, no network.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  "the arguments: one card, a source in the organization, a target from the governed roster that is not the source — judged by the relay's own validator": 11,
  'the pre-read: a pull request, a card already moved, or an unreadable card is refused before any write': 5,
  "the direct transport: the target's node id, then ONE paced mutation carrying both node ids — the relay row's own query": 7,
  'the read-back: the old URL answers 301 to the new card, which answers from the target with the same title': 7,
  'the relay transport: ONE dispatch carrying ONE transfer, the new number read from the redirect, a failed run names the remedy and is never fallen back from': 8,
  'dry-run: no request leaves, and the plan is printed': 3,
  'the wiring: both halves around the one write verb, on the roster': 4,
});
const SELF_TEST_BATTERY_FLOOR = 7;
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
  const { mkdtempSync, rmSync, readFileSync: readReal, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const SRC = `${TARGET_OWNER}/objectstack`;
  const UI = `${TARGET_OWNER}/objectui`;
  const env = { PM_SWEEP_REPO: SRC };
  const plan = planFrom(parseArgs(['--repo', SRC, '--issue', '7', '--to', UI]), { env });

  // ── the arguments ─────────────────────────────────────────────────────────
  battery("the arguments: one card, a source in the organization, a target from the governed roster that is not the source — judged by the relay's own validator");
  {
    t('a card, a source and a target make a plan carrying ONE transfer action', [plan.ok, plan.action], [true, { op: 'transfer', issue: 7, target_repo: UI }], plan.errors.join(' | '));
    t('…on the board the environment resolves when --repo is absent', planFrom(parseArgs(['--issue', '7', '--to', UI]), { env }).repo, SRC);
    t('a target outside the governed roster is refused, naming the roster', planFrom(parseArgs(['--issue', '7', '--to', `${TARGET_OWNER}/elsewhere`]), { env }).errors.some((e) => e.includes('must be one of') && e.includes(UI)));
    t('the source as its own target is refused', planFrom(parseArgs(['--issue', '7', '--to', SRC]), { env }).errors.some((e) => e.includes("the stroke's own repository")));
    t('a source outside the organization is refused', planFrom(parseArgs(['--repo', 'someone/else', '--issue', '7', '--to', UI]), { env }).errors.some((e) => e.includes(`the source must be ${TARGET_OWNER}/<name>`)));
    t('a number that is not a positive integer is refused, every spelling of it', ['7a', '0', '-3', '1.5', ' '].map((n) => planFrom(parseArgs(['--issue', n, '--to', UI]), { env }).ok), [false, false, false, false, false]);
    t('the card is required', planFrom(parseArgs(['--to', UI]), { env }).errors.some((e) => e.includes('the card is required')));
    t('the target is required, and the refusal names the roster', planFrom(parseArgs(['--issue', '7']), { env }).errors.some((e) => e.includes('the target is required') && e.includes(TRANSFER_TARGETS[1])));
    t('a flag without its value is a usage error', parseArgs(['--issue', '7', '--to']).errors, ['--to needs a value']);
    t('an unknown flag is reported, ⛔ never silently dropped', parseArgs(['--isue', '7']).unknown, ['--isue', '7']);
    t('the --flag=value spelling is accepted', planFrom(parseArgs([`--repo=${SRC}`, '--issue=7', `--to=${UI}`]), { env }).ok);
  }

  const dir = mkdtempSync(join(tmpdir(), 'issue-transfer-'));
  try {
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
    const API_TEST = 'https://api.github.test';
    const card = (repo, number, extra = {}) => ({
      number,
      node_id: `I_${number}`,
      title: 'Console grid drops the sort',
      html_url: `https://github.test/${repo}/issues/${number}`,
      repository_url: `${API_TEST}/repos/${repo}`,
      labels: [{ name: 'bug' }, { name: 'repo:objectui' }],
      ...extra,
    });
    const REDIRECT = `${API_TEST}/repositories/99/issues/31`;
    const landedOn = (where, number = 31) => ({ data: { transferIssue: { issue: { number, url: `https://github.test/${where}/issues/${number}`, repository: { nameWithOwner: where } } } } });
    // A board that MOVES the card when the mutation lands (or when the relay fake says it did).
    const board = (overrides = {}) => {
      const state = { moved: false };
      const answers = {
        [`GET /repos/${SRC}/issues/7`]: (init) => {
          if (!state.moved) return { status: 200, json: card(SRC, 7) };
          if (init.redirect === 'manual') return { status: 301, json: { message: 'Moved Permanently', url: REDIRECT }, headers: { location: REDIRECT } };
          return { status: 200, json: card(UI, 31, { labels: [{ name: 'bug' }] }) };
        },
        [`GET /repos/${UI}`]: () => ({ status: 200, json: { node_id: 'R_ui', full_name: UI } }),
        'POST /graphql': () => {
          state.moved = true;
          return { status: 200, json: landedOn(UI) };
        },
        [`GET /repos/${UI}/issues/31`]: () => (state.moved ? { status: 200, json: card(UI, 31, { labels: [{ name: 'bug' }] }) } : { status: 404, json: { message: 'Not Found' } }),
        ...overrides,
      };
      return { state, answers };
    };
    const platform = (answers, seen) => async (url, init) => {
      const u = new URL(url);
      const call = `${init?.method ?? 'GET'} ${u.pathname}`;
      seen.push({ call, redirect: init?.redirect ?? 'follow', body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.authorization ?? '' });
      const make = answers[call];
      const a = make ? make(init ?? {}) : { status: 404, json: { message: 'Not Found' } };
      if (a.throws) throw new Error(a.throws);
      return { status: a.status, headers: new Headers({ 'x-ratelimit-remaining': '4999', ...(a.headers ?? {}) }), json: async () => a.json };
    };
    const DIRECT_ROUTE = { requested: 'direct', transport: 'direct', reason: 'self-test: direct', error: null, session: null };
    const drive = async (b, { file, route, send, token = TOKEN_FIXTURE, planOverride } = {}) => {
      const seen = [];
      const pace = paceFor(file ?? join(dir, `pace-${paceCase++}.jsonl`));
      try {
        const r = await transferIssue(planOverride ?? plan, { fetch: platform(b.answers, seen), token, pace, route: route ?? DIRECT_ROUTE, send });
        return { ...r, seen, pace, text: r.lines.join('\n') };
      } catch (e) {
        if (e?.throttleExit === undefined) throw e;
        return { exitCode: e.throttleExit, lines: [], seen, pace, throttled: true, text: '' };
      }
    };
    const posts = (seen) => seen.filter((s) => s.call.startsWith('POST '));

    // ── the pre-read ────────────────────────────────────────────────────────
    battery('the pre-read: a pull request, a card already moved, or an unreadable card is refused before any write');
    {
      const pull = await drive(board({ [`GET /repos/${SRC}/issues/7`]: () => ({ status: 200, json: card(SRC, 7, { pull_request: { url: 'x' } }) }) }));
      t('a number that is a pull request is usage (2), and nothing is sent', [pull.exitCode, posts(pull.seen).length, pull.text.includes('is a pull request')], [EXIT_USAGE, 0, true]);
      const moved = await drive(board({ [`GET /repos/${SRC}/issues/7`]: () => ({ status: 200, json: card(UI, 31) }) }));
      t('a card that already answers from another repository is usage (2), naming where it lives, and nothing is sent', [moved.exitCode, posts(moved.seen).length, moved.text.includes(`it lives on ${UI} as #31`), moved.to], [EXIT_USAGE, 0, true, { repo: UI, number: 31, url: `https://github.test/${UI}/issues/31` }]);
      const missing = await drive(board({ [`GET /repos/${SRC}/issues/7`]: () => ({ status: 404, json: { message: 'Not Found' } }) }));
      t('a card that cannot be read is a platform refusal (5), and nothing is sent', [missing.exitCode, posts(missing.seen).length], [EXIT_PLATFORM_REFUSAL, 0]);
      const down = await drive(board({ [`GET /repos/${SRC}/issues/7`]: () => ({ throws: 'ECONNRESET' }) }));
      t('an unreachable platform is exit 3', down.exitCode, EXIT_PREREQUISITE);
      const noToken = await drive(board(), { token: '' });
      t('no token is exit 3 before any request, naming with-fleet.sh', [noToken.exitCode, noToken.seen.length, noToken.text.includes('with-fleet.sh')], [EXIT_PREREQUISITE, 0, true]);
    }

    // ── the direct transport ────────────────────────────────────────────────
    battery("the direct transport: the target's node id, then ONE paced mutation carrying both node ids — the relay row's own query");
    {
      const ok = await drive(board(), { file: paceFile });
      t('a direct transfer: the pre-read, the target, ONE mutation, then the two read-backs — exit 0', [ok.exitCode, ok.seen.map((s) => s.call)], [EXIT_OK, [`GET /repos/${SRC}/issues/7`, `GET /repos/${UI}`, 'POST /graphql', `GET /repos/${SRC}/issues/7`, `GET /repos/${UI}/issues/31`]], ok.text);
      t("the mutation carries both node ids, under the relay row's own query", [posts(ok.seen)[0].body.variables, posts(ok.seen)[0].body.query], [{ issueId: 'I_7', repositoryId: 'R_ui' }, OPS.transfer.requests(plan.action)[0].graphql.query]);
      t('every request carried the bearer token', ok.seen.every((s) => s.auth === `Bearer ${TOKEN_FIXTURE}`));
      const refused = await drive(board({ 'POST /graphql': () => ({ status: 200, json: { data: { transferIssue: null }, errors: [{ message: 'Resource not accessible by integration' }] } }) }));
      t('a refused mutation is exit 5 carrying the platform\'s sentence and the installation remedy', [refused.exitCode, refused.text.includes('Resource not accessible by integration'), refused.text.includes("objectstack-fleet App's repository access")], [EXIT_PLATFORM_REFUSAL, true, true]);
      const uncovered = await drive(board({ [`GET /repos/${UI}`]: () => ({ status: 404, json: { message: 'Not Found' } }) }));
      t('a target whose node id cannot be read is exit 5 with the remedy, and no mutation is sent', [uncovered.exitCode, posts(uncovered.seen).length, uncovered.text.includes('Remedy:')], [EXIT_PLATFORM_REFUSAL, 0, true]);
      const exhausted = await drive(board({ 'POST /graphql': () => ({ status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: { message: 'API rate limit exceeded' } }) }));
      t('a 403 with the quota exhausted is exit 3 that binds the identity — no remedy about the installation', [exhausted.exitCode, exhausted.text.includes('binds the IDENTITY'), exhausted.text.includes('Remedy:')], [EXIT_PREREQUISITE, true, false]);
      const elsewhere = await drive(board({ 'POST /graphql': () => ({ status: 200, json: landedOn(`${TARGET_OWNER}/cloud`) }) }));
      t('an answer that places the card on another repository is exit 4 — the board disagrees', elsewhere.exitCode, EXIT_BOARD_DISAGREES);
    }

    // ── the read-back ───────────────────────────────────────────────────────
    battery('the read-back: the old URL answers 301 to the new card, which answers from the target with the same title');
    {
      const ok = await drive(board());
      t('the success line names both addresses; the read-back line names the 301 and the label the target dropped', [ok.text.includes(`✓ issue-transfer: ${SRC}#7 → ${UI}#31`), ok.text.includes('the old URL answers 301 to #31') && ok.text.includes('dropped (no same-named label on the target): repo:objectui')], [true, true], ok.text);
      t('…the old URL was read WITHOUT following its redirect, the pre-read with it', ok.seen.filter((s) => s.call === `GET /repos/${SRC}/issues/7`).map((s) => s.redirect), ['follow', 'manual']);
      const stuck = await drive(board({ 'POST /graphql': () => ({ status: 200, json: landedOn(UI) }) }));
      t('a mutation that answered while the old URL still serves the card is exit 4', [stuck.exitCode, stuck.text.includes('the card did not move')], [EXIT_BOARD_DISAGREES, true]);
      const b404 = board();
      const gone = await drive({ answers: { ...b404.answers, [`GET /repos/${SRC}/issues/7`]: (init) => (init.redirect === 'manual' ? { status: 404, json: { message: 'Not Found' } } : b404.answers[`GET /repos/${SRC}/issues/7`](init)) } });
      t('an old URL that answers neither 301 nor 200 is UNCONFIRMED (6), never a success', [gone.exitCode, gone.text.includes('UNCONFIRMED')], [EXIT_UNCONFIRMED, true]);
      const bo = board();
      bo.answers['POST /graphql'] = () => {
        bo.state.moved = true;
        return { status: 200, json: landedOn(UI, 30) };
      };
      const other = await drive(bo);
      t('a redirect naming another number than the mutation answered is exit 4, both numbers printed', [other.exitCode, other.text.includes('the mutation answered #30, the old URL redirects to #31')], [EXIT_BOARD_DISAGREES, true], other.text);
      const bRenamed = board();
      const renamed = await drive({ answers: { ...bRenamed.answers, 'POST /graphql': bRenamed.answers['POST /graphql'], [`GET /repos/${UI}/issues/31`]: () => ({ status: 200, json: card(UI, 31, { title: 'something else' }) }) } });
      t('a new card under another title is exit 4', [renamed.exitCode, renamed.text.includes('titled "something else"')], [EXIT_BOARD_DISAGREES, true]);
      t('the redirect number is read from the url, else the location header, else nothing', [numberFromRedirect({ json: { url: REDIRECT } }), numberFromRedirect({ json: {}, location: `${API_TEST}/repositories/9/issues/12` }), numberFromRedirect({ json: { url: `${API_TEST}/repos/x/y` } })], [31, 12, null]);
    }

    // ── the relay transport ─────────────────────────────────────────────────
    battery('the relay transport: ONE dispatch carrying ONE transfer, the new number read from the redirect, a failed run names the remedy and is never fallen back from');
    {
      const SESSION = 'session_01ABCDEFGHJKMNPQRSTVWXYZ';
      const dispatchRoute = (requested = 'dispatch') => ({ requested, transport: 'dispatch', reason: 'self-test: dispatch', error: null, session: SESSION });
      const RUN = { id: 42, url: 'https://github.test/run/42', status: 'completed', conclusion: 'success' };
      const outcome = (state, b, extra = {}) => async (payload) => {
        if (state === 'success') b.state.moved = true;
        return { state, ok: state === 'success', status: state === 'refused' ? 404 : 204, verdict: state === 'refused' ? 'refusal' : 'ok', requestId: payload.request_id, startMs: 1, ceilingMs: 2, run: state === 'no-run' || state === 'refused' ? null : RUN, detail: '', ...extra };
      };
      const sentPayloads = [];
      const b = board();
      const ok = await drive(b, { route: dispatchRoute(), send: async (p) => { sentPayloads.push(p); return outcome('success', b)(p); } });
      t('under dispatch ONE payload carries ONE transfer, with the session and the source', [sentPayloads.length, sentPayloads[0]?.session, sentPayloads[0]?.repo, sentPayloads[0]?.actions], [1, SESSION, SRC, [{ op: 'transfer', issue: 7, target_repo: UI }]]);
      t('…no POST left this process; the new number came from the redirect and was read back', [ok.exitCode, ok.to?.number, ok.seen.map((s) => s.call)], [EXIT_OK, 31, [`GET /repos/${SRC}/issues/7`, `GET /repos/${SRC}/issues/7`, `GET /repos/${UI}/issues/31`]], ok.text);
      const bf = board();
      const failed = await drive(bf, { route: dispatchRoute('auto'), send: outcome('failure', bf, { run: { ...RUN, conclusion: 'failure' }, detail: 'conclusion failure' }) });
      t('⛔ a run that FAILED is exit 5 naming the installation remedy, never fallen back from even under auto: no POST', [failed.exitCode, failed.text.includes('Remedy:') && failed.text.includes(UI), posts(failed.seen).length], [EXIT_PLATFORM_REFUSAL, true, 0]);
      const br = board();
      const refused = await drive(br, { route: dispatchRoute(), send: outcome('refused', br) });
      t('a dispatch the platform refused is exit 5 with no installation remedy — nothing ran', [refused.exitCode, refused.text.includes('Remedy:')], [EXIT_PLATFORM_REFUSAL, false]);
      const bt = board();
      const timedOut = await drive(bt, { route: dispatchRoute(), send: outcome('timeout', bt, { run: { ...RUN, status: 'in_progress', conclusion: null } }) });
      t('a run that did not complete within the ceiling is exit 6 with the run url', [timedOut.exitCode, timedOut.text.includes('https://github.test/run/42'), posts(timedOut.seen).length], [EXIT_UNCONFIRMED, true, 0]);
      const bn = board();
      const noRun = await drive(bn, { route: dispatchRoute('dispatch'), send: outcome('no-run', bn) });
      t('under an EXPLICIT dispatch, no run is exit 6 — no fall-back', [noRun.exitCode, posts(noRun.seen).length], [EXIT_UNCONFIRMED, 0]);
      const ba = board();
      const fallback = await drive(ba, { route: dispatchRoute('auto'), send: outcome('no-run', ba) });
      t('under AUTO, no run falls back to the direct mutation — said out loud — and the card is read back', [fallback.exitCode, fallback.text.includes('Falling back to DIRECT'), posts(fallback.seen).map((s) => s.call)], [EXIT_OK, true, ['POST /graphql']]);
      // A run that reports success while the board never moved: the read-back, not the run, decides.
      const bs = board();
      const lied = await drive(bs, { route: dispatchRoute(), send: async (p) => ({ state: 'success', ok: true, status: 204, verdict: 'ok', requestId: p.request_id, startMs: 1, ceilingMs: 2, run: RUN, detail: '' }) });
      t('a run that succeeded while the old URL still serves the card is exit 4, never a success', [lied.exitCode, lied.text.includes('the card did not move')], [EXIT_BOARD_DISAGREES, true]);
    }

    // ── dry-run ─────────────────────────────────────────────────────────────
    battery('dry-run: no request leaves, and the plan is printed');
    {
      const spawned = spawnSync(process.execPath, [SELF_PATH, '--dry-run', '--repo', SRC, '--issue', '7', '--to', UI], {
        encoding: 'utf8',
        env: { ...process.env, OS_PM_WRITE_PACE_FILE: join(dir, 'dry-pace.jsonl'), GITHUB_TOKEN: TOKEN_FIXTURE, GH_TOKEN: '', HTTPS_PROXY: '', https_proxy: '' },
      });
      t('--dry-run exits 0 and prints the stroke it did not send', [spawned.status, spawned.stdout.includes('NOTHING was sent') && spawned.stdout.includes('transferIssue') && spawned.stdout.includes(`${SRC}#7`) && spawned.stdout.includes(UI)], [0, true], spawned.stderr.slice(-300));
      t('…and the throttle recorded nothing: a dry run makes no write', existsSync(join(dir, 'dry-pace.jsonl')), false);
      t('a refused plan is usage, printed, and nothing is sent', spawnSync(process.execPath, [SELF_PATH, '--dry-run', '--repo', SRC, '--issue', '7', '--to', SRC], { encoding: 'utf8', env: { ...process.env, HTTPS_PROXY: '', https_proxy: '' } }).status, EXIT_USAGE);
    }

    // ── the wiring ──────────────────────────────────────────────────────────
    battery('the wiring: both halves around the one write verb, on the roster');
    {
      const { WIRED_WRITE_TOOLS } = await import('./write-pace.mjs');
      const own = readReal(SELF_PATH, 'utf8');
      t('write-pace lists this file among the wired write tools', WIRED_WRITE_TOOLS.includes('scripts/pm/issue-transfer.mjs'));
      t('this file calls both halves, guarded by the write-verb predicate', own.includes('paceWrite(') && own.includes('noteResponse(') && own.includes('isWriteMethod('));
      const records = readReal(paceFile, 'utf8');
      t('the mutation above was paced; the reads were not', [records.includes('issue-transfer POST'), records.includes('issue-transfer GET')], [true, false]);
      t("⛔ and the token never reached the throttle's log", records.includes(TOKEN_FIXTURE), false);
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
    console.error(`✗ issue-transfer self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(
    `✓ issue-transfer self-test: ${cases.length} cases pass across ${declared.length} batteries — one card to a governed target judged by the relay's own validator, ` +
      'a pull request or an already-moved card refused before any write, one paced mutation or one dispatch, a read-back that demands the 301 and the card at its new ' +
      'address, a failed run that names the installation remedy and is never fallen back from, and both halves of the throttle around the one write.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const USAGE = [
  'usage:',
  '  node scripts/pm/issue-transfer.mjs [--repo owner/name] --issue <n> --to owner/name [--json] [--dry-run]',
  '  node scripts/pm/issue-transfer.mjs --self-test',
  '',
  `  --to is one of: ${TRANSFER_TARGETS.join(', ')} (the governed roster), never the source.`,
  '  One card per call. OS_FLEET_TRANSPORT=direct|dispatch|auto (default auto): dispatch sends ONE transfer through the',
  "  fleet-write relay as objectstack-fleet[bot]; auto takes it in a cloud seat container (the seat's session is read from the",
  "  container's CLAUDE_CODE_REMOTE_SESSION_ID; OS_FLEET_SESSION overrides it — a local checkout, a test) and direct elsewhere.",
  `  Exits: 0 transferred and read back · ${EXIT_USAGE} usage or refused · ${EXIT_PREREQUISITE} prerequisite · ${EXIT_BOARD_DISAGREES} the board disagrees · ${EXIT_PLATFORM_REFUSAL} platform refused / run failed · ${EXIT_UNCONFIRMED} UNCONFIRMED · ${EXIT_WRITE_PACE_REFUSED} throttle refused`,
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
    for (const e of opts.errors) console.error(`issue-transfer: ${e}`);
    if (opts.unknown.length) console.error(`issue-transfer: unrecognised argument ${opts.unknown.map((u) => `\`${u}\``).join(', ')}`);
    console.error(`\n${USAGE}`);
    return EXIT_USAGE;
  }
  const plan = planFrom(opts);
  if (!plan.ok) {
    for (const e of plan.errors) console.error(`✗ issue-transfer: ${e}`);
    console.error('  Nothing was sent.');
    return EXIT_USAGE;
  }
  if (opts.dryRun) {
    console.log(dryRunText(plan));
    return EXIT_OK;
  }
  const rearmed = rearmThroughProxy(argv);
  if (rearmed !== null) return rearmed;
  const result = await transferIssue(plan);
  for (const line of result.lines) console.error(line);
  if (opts.json && result.to) console.log(JSON.stringify({ from: result.from, to: result.to, transport: result.transport ?? null, relay_run: result.relay?.run?.url ?? null, exit: result.exitCode }));
  return result.exitCode;
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\n✗ issue-transfer self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
        'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}
