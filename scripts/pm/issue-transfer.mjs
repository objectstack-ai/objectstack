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
 * and says which. ⛔ Once a dispatch is ACCEPTED, its run is the only answer:
 * no run in the start window, or none completed, is exit 6 under `auto`
 * exactly as under `dispatch`, and a run that failed is exit 5 — never the
 * direct mutation after either. The relay may merely be queued, and the
 * mutation would move the card as the seat's personal account instead of the
 * fleet's (`fleet-write/dispatch.mjs`'s no-run conformance pins every sender
 * to this).
 *
 * ## Read-back — the TARGET decides; the old URL only corroborates
 *
 * The transfer is confirmed when the card answers from the target with the
 * title the pre-read saw. The card is found by its number when one is in
 * hand — the number the `transferIssue` answer carried: directly (direct), or
 * as the relay run's ANNOTATION reports it (`fleet-write/dispatch.mjs`, "The
 * run's annotations": the executor's copy of that same answer, read from the
 * job's check run because a seat container reads neither its log nor its
 * summary) — else the number the old URL's 301 names, and otherwise by that
 * title among the target's cards updated since the transfer was sent; two
 * such cards are not a confirmation. So under the relay the order is the
 * annotation, then the 301, then the title. `GET /repos/{source}/issues/{n}`
 * WITHOUT following redirects is read first, and its answer is printed beside
 * the verdict, never instead of it:
 *
 *   - a 301 naming the card corroborates it; one naming another card, or
 *     another repository, is the board disagreeing;
 *   - a 200 from the source is a PENDING REDIRECT, not "the card did not
 *     move": GitHub serves a moved card's old URL for MINUTES before it turns
 *     into the 301 (measured over five landed transfers in one shift — four
 *     old URLs still answered 200 minutes after their cards stood on the
 *     target), so the old URL is never waited for;
 *   - a 301 naming no card is what an identity that cannot see the target
 *     reads (a private target), and any other status is printed as itself —
 *     neither is read as the move, and only a 301 ever supplies the number.
 *
 * The target is re-read on the bounded schedule
 * `TRANSFER_READ_BACK_DELAYS_MS` names while it ANSWERS without the card,
 * one printed line per re-read; ⛔ the transfer is never re-sent. Exit 4
 * survives for a board that truly disagrees: after the last re-read the
 * target still lacks the card AND the old URL, read again, still serves it
 * from the source. A target that cannot be read at all — a cloud session
 * reads only the repositories attached to it, and answers 403 for the rest —
 * ends the wait at once, UNCONFIRMED; with ONE exception: when the number came
 * from the relay run's annotation and the target answers 403 (not a rate
 * limit), the annotation IS the platform's answer to the mutation, so the
 * transfer is confirmed by it — exit 0, `confirmed_by: relay-annotation`, the
 * target URL the annotation carries, and the old URL's reading printed as
 * corroboration (a pending redirect too). A 404 or another title on the
 * target keeps its exit 4 / 6 whatever named the number. Labels with no
 * same-named label on the target are dropped by the platform (the relay
 * never asks it to create them); the read-back prints what stayed.
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
 *   0   transferred, and confirmed on the target: the card answers there with
 *       the title the pre-read saw, at the URL printed — whether the old URL
 *       already redirects or is still a pending redirect. Or, under the relay
 *       in a session the target answers 403: confirmed by the run's annotation
 *       (`confirmed_by: relay-annotation`), the old URL printed beside it.
 *   2   usage, or a refusal above. Nothing was transferred.
 *   3   PREREQUISITE NOT MET — no token, the platform unreachable, the
 *       credential rate-limit exhausted, or no route. Nothing was transferred.
 *   4   the platform answered, and the BOARD DISAGREES — the card sits on
 *       another repository or under another title, the old URL redirects to
 *       another card than the mutation answered, or the target still lacks
 *       the card after the bounded re-read while the old URL still serves it
 *       from the source. Every number seen is printed.
 *   5   the platform refused, or the relay run FAILED. The remedy is printed.
 *   6   UNCONFIRMED — the dispatch was accepted and its run did not appear or
 *       complete within the ceiling, or the read-back could not be taken: the
 *       target could not be read, or answered two cards for one. The run URL
 *       is printed. Go READ the card; ⛔ never re-run blind.
 *  10   the write throttle refused. Nothing was sent.
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { EXIT_PREREQUISITE_NOT_MET, PROXY_FLAG, proxyRearmPlan, resolveSweepRepo } from './check-half-states.mjs';
import { EXIT_UNCONFIRMED, READ_BACK_SLACK_MS, exitForResult, matchRunAnnotations, packRequest, parseRelayAnnotation, relayAnnotationMessage, resolveRoute, sendFleetWrite, unconfirmedText } from './fleet-write/dispatch.mjs';
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

/** What `--json` prints for a result that names a card. Pure. */
export function jsonLine(result) {
  return { from: result.from, to: result.to, transport: result.transport ?? null, relay_run: result.relay?.run?.url ?? null, pending_redirect: result.pendingRedirect ?? null, confirmed_by: result.confirmedBy ?? null, exit: result.exitCode };
}

/** The exit a transport verdict maps to. `null` means "carry on". */
export function exitForVerdict(verdict) {
  if (verdict === 'ok') return null;
  if (verdict === 'prerequisite' || verdict === 'ratelimit') return EXIT_PREREQUISITE;
  return EXIT_PLATFORM_REFUSAL;
}

/**
 * The card an API redirect names: `{ number, repo }` from the first of the
 * body's `url` and the `location` header that ends in `/issues/{n}`. `repo` is
 * read only from the `/repos/{owner}/{name}/issues/{n}` spelling — the one the
 * platform was measured to answer — and is null for `/repositories/{id}/…`.
 * Both null for a 301 that names nothing: the measured answer to an identity
 * that cannot see the target, with an empty `url` and an empty `location`.
 */
export function redirectTarget({ json, location } = {}) {
  for (const candidate of [json?.url, location]) {
    const text = String(candidate ?? '');
    const m = /\/issues\/([1-9][0-9]*)(?:[?#].*)?$/.exec(text);
    if (!m) continue;
    const repo = /\/repos\/([^/]+\/[^/]+)\/issues\/[1-9][0-9]*(?:[?#].*)?$/.exec(text);
    return { number: Number(m[1]), repo: repo ? repo[1] : null };
  }
  return { number: null, repo: null };
}

/** The issue number an API redirect names (`…/issues/31`), or null. */
export function numberFromRedirect(answer = {}) {
  return redirectTarget(answer).number;
}

/**
 * The read-back's bounded re-read of the TARGET (header, "Read-back"): the
 * wait before each re-read, in order, taken only while the target ANSWERS
 * without the card. Why these values: a repository's issue list was measured
 * lagging a new issue by 3–4 s and never by 5 s (the relay's `issue_create`
 * read-back, measured over five filings in one shift), and the direct path
 * reads the target as soon as the mutation answers, the relay path within
 * one 5 s poll of its run completing — so 3 s, 7 s, then 15 s cover a target
 * that lags harder under load, 25 s in all. The OLD URL is not what this
 * waits for: it was measured lagging by minutes, which no bounded read-back
 * may sit through. ⛔ Never unbounded and ⛔ never a re-send of the transfer;
 * the self-test holds the sum.
 */
export const TRANSFER_READ_BACK_DELAYS_MS = Object.freeze([3_000, 7_000, 15_000]);

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
 * Returns `{ exitCode, from, to, lines, transport, relay }` — plus, on a
 * success, `pendingRedirect` (true while the old URL still serves the card)
 * and `confirmedBy`: `target` (read back there) or `relay-annotation` (the
 * run's annotation, the target answering 403); never throws on a status.
 * `deps.sleep` and `deps.now` serve the read-back's bounded re-read alone
 * (`TRANSFER_READ_BACK_DELAYS_MS`).
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
  const sentAt = (deps.now ?? Date.now)();
  let claimed = null;
  // The relay run's annotation for this transfer — the platform's own transferIssue answer, as the executor read it.
  let annotated = null;
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
      // The annotation first (header): `sendFleetWrite` matched it to this stroke's one action and to the target.
      annotated = (sent.annotations?.rows ?? []).find((a) => a.op === plan.action.op && a.action === 1) ?? null;
      if (annotated) {
        claimed = annotated.number;
        lines.push(`  issue-transfer: the relay run's annotation names ${annotated.repo}#${annotated.number} ${annotated.url} — the platform's own transferIssue answer; the card is read there first.`);
      } else {
        lines.push("  issue-transfer: no annotation on the relay run names this transfer — the number comes from the old URL's 301, else the title finds the card.");
      }
    } else if (sent.state === 'no-run' || sent.state === 'timeout') {
      // ⛔ Under EVERY transport request, `auto` included: the dispatch was accepted and may still run, so the direct
      // mutation here would move the card as the seat's personal account instead of the fleet's.
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

  // ── the read-back: the TARGET decides; the old URL only corroborates ──────
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const unconfirmed = (why, extra = {}) => {
    lines.push(`✗ issue-transfer: UNCONFIRMED — ${why}. Go READ ${plan.repo}#${plan.issue} and ${plan.to}; ⛔ do not re-run blind — the transfer was sent. Exit ${EXIT_UNCONFIRMED}.`);
    return done(EXIT_UNCONFIRMED, extra);
  };
  const sameRepo = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  // The old URL, WITHOUT following its redirect: corroboration, printed beside the verdict and never instead of it.
  const readOld = async () => {
    const r = await rest(`/repos/${plan.repo}/issues/${plan.issue}`, { redirect: 'manual' }, deps);
    if (r.status === 301) return { kind: 'redirect', ...redirectTarget(r), r };
    if (r.status === 200 && r.json) return { kind: 'serving', at: repoOfIssue(r.json), number: r.json.number ?? null, r };
    return { kind: 'other', r };
  };
  const pendingAt = (o) => o.kind === 'serving' && sameRepo(o.at, plan.repo);
  const oldAccount = (o) => {
    if (o.kind === 'redirect') return o.number === null ? 'the old URL answers 301 naming no card this identity can read' : `the old URL answers 301 to ${o.repo && !sameRepo(o.repo, plan.to) ? o.repo : ''}#${o.number}`;
    if (pendingAt(o)) return `the old URL still answers 200 from ${plan.repo} — a PENDING REDIRECT: GitHub serves a moved card's old URL for minutes before it turns into the 301`;
    if (o.kind === 'serving') return `the old URL answers 200 from ${o.at ?? '?'}${o.number !== null ? ` as #${o.number}` : ''}`;
    return `the old URL answers HTTP ${o.r.status}${said(o.r)} — neither the 301 nor the card, so it is not read as the move`;
  };
  const old = await readOld();
  // Only a 301 ever supplies a number; one naming another repository or another number than the mutation answered is the board disagreeing.
  let number = claimed;
  if (old.kind === 'redirect' && old.number !== null) {
    if (old.repo && !sameRepo(old.repo, plan.to)) {
      lines.push(`✗ issue-transfer: the board disagrees — the old URL redirects to ${old.repo}#${old.number}, not to ${plan.to}. ⛔ Not re-sent: go READ both.`);
      return done(EXIT_BOARD_DISAGREES, { to: { repo: old.repo, number: old.number, url: null } });
    }
    if (claimed !== null && claimed !== old.number) {
      lines.push(`✗ issue-transfer: the board disagrees — ${annotated ? "the relay run's annotation names" : 'the mutation answered'} #${claimed}, the old URL redirects to #${old.number}.`);
      return done(EXIT_BOARD_DISAGREES, { to: { repo: plan.to, number: old.number, url: null } });
    }
    number = old.number;
  }
  // The card on the target: by its number when one is in hand, else by the pre-read's title among the cards updated since the send.
  const since = encodeURIComponent(new Date(sentAt - READ_BACK_SLACK_MS).toISOString());
  const look = async () => {
    if (number !== null) {
      const r = await rest(`/repos/${plan.to}/issues/${number}`, {}, deps);
      if (r.status === 200 && r.json) return { state: 'answered', card: r.json, r };
      if (r.status === 404) return { state: 'absent', r, why: `${r.call} answers 404` };
      return { state: 'unread', r };
    }
    const r = await rest(`/repos/${plan.to}/issues?state=all&sort=updated&direction=desc&since=${since}&per_page=100`, {}, deps);
    if (r.status !== 200 || !Array.isArray(r.json)) return { state: 'unread', r };
    const hits = r.json.filter((o) => o && !o.pull_request && String(o.title ?? '').trim() === title);
    if (hits.length === 1) return { state: 'answered', card: hits[0], r };
    if (hits.length > 1) return { state: 'ambiguous', hits, r };
    return { state: 'absent', r, why: `no card on ${plan.to} updated since the transfer was sent is titled ${JSON.stringify(title)}` };
  };
  let found = await look();
  let waited = 0;
  const delays = TRANSFER_READ_BACK_DELAYS_MS;
  for (let i = 0; i < delays.length && found.state === 'absent'; i++) {
    lines.push(`  issue-transfer: ${found.why} yet — re-read ${i + 1}/${delays.length} of ${plan.to} in ${delays[i]} ms (the target may lag the transfer; ⛔ the transfer is not re-sent).`);
    await sleep(delays[i]);
    waited += delays[i];
    found = await look();
    if (found.state === 'answered') lines.push(`  issue-transfer: ${plan.to}#${found.card.number ?? number} found on re-read ${i + 1}, ${waited} ms after the first read.`);
  }
  const known = number !== null ? { to: { repo: plan.to, number, url: annotated && annotated.number === number ? annotated.url : null } } : {};
  // The one exception to "unreadable is UNCONFIRMED" (header): the number is the relay run's annotation — the platform's
  // answer to the mutation — and the target refused THIS session (403, not an exhausted rate limit).
  if (found.state === 'unread' && annotated && annotated.number === number && found.r.status === 403 && found.r.rateRemaining !== 0) {
    lines.push(`✓ issue-transfer: ${plan.repo}#${plan.issue} → ${plan.to}#${number} ${annotated.url}`);
    lines.push(
      `  confirmed_by: relay-annotation — the relay run ${ctx.relay?.run?.url ?? ctx.relay?.run?.id ?? ''} reported #${number} ${annotated.url} from the platform's transferIssue answer; ` +
        `the target was not read back: ${found.r.call} answered HTTP 403 to this session${said(found.r)}; ${oldAccount(old)}.`,
    );
    return done(EXIT_OK, { to: { repo: plan.to, number, url: annotated.url }, pendingRedirect: pendingAt(old), confirmedBy: 'relay-annotation' });
  }
  if (found.state === 'unread') {
    return unconfirmed(`the target could not be read — ${found.r.call} answered HTTP ${found.r.status}${said(found.r)}; ${oldAccount(old)}`, known);
  }
  if (found.state === 'ambiguous') {
    return unconfirmed(`${found.hits.length} cards on ${plan.to} updated since the transfer was sent carry the title ${JSON.stringify(title)} (${found.hits.map((h) => `#${h.number}`).join(', ')}), and a title names one card or none; ${oldAccount(old)}`);
  }
  if (found.state === 'absent') {
    // A board that truly disagrees: the target still lacks the card AND the old URL, read again, still serves it from the source.
    const after = await readOld();
    const tried = `read ${delays.length + 1} times over ${waited} ms`;
    if (pendingAt(after)) {
      lines.push(
        `✗ issue-transfer: the board disagrees — ${found.why} (${tried}), and ${after.r.call} still answers 200 from ${plan.repo}: the card did not move` +
          `${claimed !== null ? `, though the mutation answered #${claimed}` : ''}${ctx.relay ? ', though the relay run reported success' : ''}. ⛔ Not re-sent: go READ both.`,
      );
      return done(EXIT_BOARD_DISAGREES, known);
    }
    return unconfirmed(`${found.why} (${tried}), while ${oldAccount(after)}`, known);
  }
  const card = found.card;
  const cardAt = repoOfIssue(card);
  const cardTitle = String(card.title ?? '').trim();
  const cardNumber = Number.isInteger(card.number) ? card.number : number;
  const to = { repo: cardAt ?? plan.to, number: cardNumber, url: card.html_url ?? null };
  if (!cardAt || !sameRepo(cardAt, plan.to) || cardTitle !== title) {
    lines.push(`✗ issue-transfer: the board disagrees — #${cardNumber} answers from ${cardAt ?? '?'} titled ${JSON.stringify(cardTitle)}; wanted ${plan.to} titled ${JSON.stringify(title)}.`);
    return done(EXIT_BOARD_DISAGREES, { to });
  }
  const labelsAfter = (card.labels ?? []).map((l) => l?.name ?? String(l));
  const dropped = labelsBefore.filter((l) => !labelsAfter.includes(l));
  const pending = pendingAt(old);
  lines.push(`✓ issue-transfer: ${plan.repo}#${plan.issue} → ${plan.to}#${cardNumber}${to.url ? ` ${to.url}` : ''}`);
  lines.push(
    `  read-back: #${cardNumber} answers from ${plan.to} with the same title${number === null ? ' (found by that title: no number was in hand)' : ''}; ${oldAccount(old)}` +
      `; labels kept: ${labelsAfter.join(', ') || '(none)'}` +
      `${dropped.length ? `; dropped (no same-named label on the target): ${dropped.join(', ')}` : ''}` +
      `${annotated && annotated.number === cardNumber ? "; its number came from the relay run's annotation" : ''}.`,
  );
  return done(EXIT_OK, { to, pendingRedirect: pending, confirmedBy: 'target' });
}

/**
 * The no-run conformance probe — `fleet-write/dispatch.mjs`'s header names the
 * contract and its self-test drives it: ONE transfer through `transferIssue`,
 * the real write path, against an offline fake board, on the route, the sender
 * and the throttle the conformance hands in. Answers the exit, every request
 * that left this process directly (`METHOD /path`), and what the tool printed.
 */
export async function relayMissProbe({ route, send, pace }) {
  const src = `${TARGET_OWNER}/objectstack`;
  const to = `${TARGET_OWNER}/objectui`;
  const plan = planFrom(parseArgs(['--repo', src, '--issue', '7', '--to', to]), { env: {} });
  const card = (repo, number) => ({ number, node_id: `I_${number}`, title: 'relay-miss probe', html_url: `https://github.test/${repo}/issues/${number}`, repository_url: `${API}/repos/${repo}`, labels: [] });
  // The card MOVES when the mutation lands, so the direct leg reads back the way a real transfer does.
  let moved = false;
  const answers = {
    [`GET /repos/${src}/issues/7`]: () => ({ status: 200, json: moved ? card(to, 31) : card(src, 7) }),
    [`GET /repos/${to}`]: () => ({ status: 200, json: { node_id: 'R_to', full_name: to } }),
    'POST /graphql': () => {
      moved = true;
      return { status: 200, json: { data: { transferIssue: { issue: { number: 31, url: `https://github.test/${to}/issues/31`, repository: { nameWithOwner: to } } } } } };
    },
    [`GET /repos/${to}/issues/31`]: () => (moved ? { status: 200, json: card(to, 31) } : { status: 404, json: { message: 'Not Found' } }),
  };
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
    calls.push(call);
    const a = answers[call]?.() ?? { status: 404, json: { message: 'Not Found' } };
    return { status: a.status, headers: new Headers({ 'x-ratelimit-remaining': '4999' }), json: async () => a.json };
  };
  const r = await transferIssue(plan, { fetch, token: 'probe-token', pace, route, send, sleep: async () => {}, now: () => 0 });
  return { exit: r.exitCode, calls, text: r.lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Self-test — offline: a fake board that moves the card when the mutation (or
// the relay) lands, injected routes, no network.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  "the arguments: one card, a source in the organization, a target from the governed roster that is not the source — judged by the relay's own validator": 11,
  'the pre-read: a pull request, a card already moved, or an unreadable card is refused before any write': 5,
  "the direct transport: the target's node id, then ONE paced mutation carrying both node ids — the relay row's own query": 7,
  'the read-back: the old URL answers 301 to the new card, which answers from the target with the same title': 9,
  'the relay transport: ONE dispatch carrying ONE transfer, the new number read from the redirect, a failed run names the remedy, and no outcome of an accepted dispatch — a failure, no run under auto — is ever fallen back from': 9,
  'the target decides: a card the target answers is a transfer even while the old URL still serves it (a pending redirect: exit 0, the target URL); exit 4 only when the target still lacks it after the bounded re-read AND the old URL is unchanged; an unreadable or ambiguous target is UNCONFIRMED; the transfer is never re-sent': 16,
  "the relay annotation: the number the relay run's annotation carries is read first — the card confirmed on the target with no title search; a target that answers this session 403 is still exit 0, confirmed_by relay-annotation, the old URL its corroboration; a 404, another title or another number keeps exit 4 / 6; absent, the 301 and the title as before": 12,
  'dry-run: no request leaves, and the plan is printed': 3,
  'the wiring: both halves around the one write verb, on the roster': 4,
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
    const NOW_FIXTURE = Date.parse('2026-10-01T02:00:00Z');
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
        // The target's list: a card under another title, and a PULL REQUEST under the same one — neither is the card.
        [`GET /repos/${UI}/issues`]: () => ({
          status: 200,
          json: [card(UI, 30, { title: 'another card' }), card(UI, 29, { pull_request: { url: 'x' } }), ...(state.moved ? [card(UI, 31, { labels: [{ name: 'bug' }] })] : [])],
        }),
        ...overrides,
      };
      return { state, answers };
    };
    const platform = (answers, seen) => async (url, init) => {
      const u = new URL(url);
      const call = `${init?.method ?? 'GET'} ${u.pathname}`;
      seen.push({ call, query: u.search, redirect: init?.redirect ?? 'follow', body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.authorization ?? '' });
      const make = answers[call];
      const a = make ? make(init ?? {}) : { status: 404, json: { message: 'Not Found' } };
      if (a.throws) throw new Error(a.throws);
      return { status: a.status, headers: new Headers({ 'x-ratelimit-remaining': '4999', ...(a.headers ?? {}) }), json: async () => a.json };
    };
    const DIRECT_ROUTE = { requested: 'direct', transport: 'direct', reason: 'self-test: direct', error: null, session: null };
    // `sleeps` records every wait the read-back takes — offline, nothing really waits.
    const drive = async (b, { file, route, send, token = TOKEN_FIXTURE, planOverride, onSleep } = {}) => {
      const seen = [];
      const sleeps = [];
      const sleep = async (ms) => {
        sleeps.push(ms);
        onSleep?.(sleeps.length);
      };
      const pace = paceFor(file ?? join(dir, `pace-${paceCase++}.jsonl`));
      try {
        const r = await transferIssue(planOverride ?? plan, { fetch: platform(b.answers, seen), token, pace, route: route ?? DIRECT_ROUTE, send, sleep, now: () => NOW_FIXTURE });
        return { ...r, seen, sleeps, pace, text: r.lines.join('\n') };
      } catch (e) {
        if (e?.throttleExit === undefined) throw e;
        return { exitCode: e.throttleExit, lines: [], seen, sleeps, pace, throttled: true, text: '' };
      }
    };
    const posts = (seen) => seen.filter((s) => s.call.startsWith('POST '));
    const SRC_KEY = `GET /repos/${SRC}/issues/7`;
    const withAnswers = (b, extra) => ({ state: b.state, answers: { ...b.answers, ...extra } });
    // The measured lag: the card stands on the target while its old URL still answers 200 from the source.
    const lagOld = (b) => withAnswers(b, { [SRC_KEY]: (init) => (init.redirect === 'manual' ? { status: 200, json: card(SRC, 7) } : b.answers[SRC_KEY](init)) });
    const SESSION = 'session_01ABCDEFGHJKMNPQRSTVWXYZ';
    const dispatchRoute = (requested = 'dispatch') => ({ requested, transport: 'dispatch', reason: 'self-test: dispatch', error: null, session: SESSION });
    const RUN = { id: 42, url: 'https://github.test/run/42', status: 'completed', conclusion: 'success' };
    const outcome = (state, b, extra = {}) => async (payload) => {
      if (state === 'success') b.state.moved = true;
      return { state, ok: state === 'success', status: state === 'refused' ? 404 : 204, verdict: state === 'refused' ? 'refusal' : 'ok', requestId: payload.request_id, startMs: 1, ceilingMs: 2, run: state === 'no-run' || state === 'refused' ? null : RUN, detail: '', ...extra };
    };
    // A run that reports success while the board never moved.
    const liar = async (p) => ({ state: 'success', ok: true, status: 204, verdict: 'ok', requestId: p.request_id, startMs: 1, ceilingMs: 2, run: RUN, detail: '' });

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
      const old404 = (b) => withAnswers(b, { [SRC_KEY]: (init) => (init.redirect === 'manual' ? { status: 404, json: { message: 'Not Found' } } : b.answers[SRC_KEY](init)) });
      const gone = await drive(old404(board()));
      const b404blind = board();
      const goneBlind = await drive(withAnswers(old404(b404blind), { [`GET /repos/${UI}/issues/31`]: () => ({ status: 502, json: { message: 'Bad Gateway' } }) }));
      t(
        'an old URL that answers neither 301 nor 200 is never read as the move — printed as itself beside a card the target confirms (0), and UNCONFIRMED (6) when the target cannot be read',
        [gone.exitCode, gone.text.includes('the old URL answers HTTP 404') && gone.text.includes('not read as the move'), goneBlind.exitCode, goneBlind.text.includes('UNCONFIRMED')],
        [EXIT_OK, true, EXIT_UNCONFIRMED, true],
        `${gone.text}\n${goneBlind.text}`,
      );
      // Only the PERMANENT redirect a moved card answers counts — a temporary one naming the same card is not that fact.
      const b307 = board();
      const temporary = await drive(withAnswers(b307, { [SRC_KEY]: (init) => (init.redirect === 'manual' && b307.state.moved ? { status: 307, json: { url: REDIRECT }, headers: { location: REDIRECT } } : b307.answers[SRC_KEY](init)) }), { route: dispatchRoute(), send: outcome('success', b307) });
      t(
        '⛔ a 307 naming the new card never supplies its number — under the relay, with no number in hand, #31 is never read by it: the title finds the card on the target',
        [temporary.exitCode, temporary.seen.some((x) => x.call === `GET /repos/${UI}/issues/31`), temporary.seen.some((x) => x.call === `GET /repos/${UI}/issues`), temporary.text.includes('HTTP 307')],
        [EXIT_OK, false, true, true],
        temporary.text,
      );
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
      // The two 301 shapes measured on landed transfers: a public target named by `/repos/{owner}/{name}`, and EMPTY `url` and `location` for a target the reader cannot see.
      t(
        'the measured 301 shapes: the repository is read from the /repos/ spelling, none from /repositories/{id}, and an empty redirect names nothing',
        [redirectTarget({ json: { url: 'https://api.github.com/repos/objectstack-ai/hotcrm/issues/1972' }, location: 'https://api.github.com/repos/objectstack-ai/hotcrm/issues/1972' }), redirectTarget({ json: { url: REDIRECT } }), redirectTarget({ json: { message: 'Moved Permanently', url: '' }, location: '' })],
        [{ number: 1972, repo: 'objectstack-ai/hotcrm' }, { number: 31, repo: null }, { number: null, repo: null }],
      );
    }

    // ── the relay transport ─────────────────────────────────────────────────
    battery('the relay transport: ONE dispatch carrying ONE transfer, the new number read from the redirect, a failed run names the remedy, and no outcome of an accepted dispatch — a failure, no run under auto — is ever fallen back from');
    {
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
      const noRunAuto = await drive(ba, { route: dispatchRoute('auto'), send: outcome('no-run', ba) });
      t('⛔ under AUTO, an accepted dispatch with no run is exit 6 UNCONFIRMED too — the pre-read alone, ZERO requests after it: no target read, no mutation', [noRunAuto.exitCode, noRunAuto.seen.map((s) => s.call)], [EXIT_UNCONFIRMED, [`GET /repos/${SRC}/issues/7`]]);
      t('…the answer an EXPLICIT dispatch gives, in the shared UNCONFIRMED sentence (go READ, never re-run blind)', [noRunAuto.exitCode === noRun.exitCode, noRunAuto.relay ? noRunAuto.lines.includes(unconfirmedText(noRunAuto.relay, 'issue-transfer')) : false], [true, true]);
      // A run that reports success while the board never moved: the read-back, not the run, decides.
      const bs = board();
      const lied = await drive(bs, { route: dispatchRoute(), send: liar });
      t('a run that succeeded while the target lacks the card and the old URL still serves it is exit 4, never a success', [lied.exitCode, lied.text.includes('the card did not move') && lied.text.includes('though the relay run reported success')], [EXIT_BOARD_DISAGREES, true], lied.text);
    }

    // ── the target decides ──────────────────────────────────────────────────
    battery('the target decides: a card the target answers is a transfer even while the old URL still serves it (a pending redirect: exit 0, the target URL); exit 4 only when the target still lacks it after the bounded re-read AND the old URL is unchanged; an unreadable or ambiguous target is UNCONFIRMED; the transfer is never re-sent');
    {
      const DELAYS = TRANSFER_READ_BACK_DELAYS_MS;
      const WINDOW = DELAYS.reduce((a, b) => a + b, 0);
      const calls = (r, call) => r.seen.filter((x) => x.call === call).length;
      const T31 = `GET /repos/${UI}/issues/31`;
      const LIST = `GET /repos/${UI}/issues`;
      t(
        'the re-read schedule is frozen and non-empty, every wait a positive integer that never shrinks, the whole window at most 30 s',
        [Object.isFrozen(DELAYS), DELAYS.length > 0, DELAYS.every((ms, i, a) => Number.isInteger(ms) && ms > 0 && (i === 0 || ms >= a[i - 1])), WINDOW <= 30_000],
        [true, true, true, true],
      );

      // ① THE PIN: the old URL lags, the target holds the card — exit 0 with the target URL, under both transports.
      const direct = await drive(lagOld(board()));
      t(
        'direct: the old URL still answers 200 from the source while #31 answers from the target — exit 0 with the target URL, read as a PENDING REDIRECT, never as "did not move"',
        [direct.exitCode, direct.to, direct.pendingRedirect, direct.text.includes('PENDING REDIRECT'), direct.text.includes('did not move')],
        [EXIT_OK, { repo: UI, number: 31, url: `https://github.test/${UI}/issues/31` }, true, true, false],
        direct.text,
      );
      t('…by the number the mutation answered: ONE mutation, the old URL read once, #31 read once, no wait', [posts(direct.seen).length, calls(direct, SRC_KEY), calls(direct, T31), direct.sleeps], [1, 2, 1, []]);
      const bRelay = board();
      const relay = await drive(lagOld(bRelay), { route: dispatchRoute(), send: outcome('success', bRelay) });
      const listed = relay.seen.find((x) => x.call === LIST);
      t(
        'relay: no number in hand and the old URL still answers 200 — the card is found by its title on the target: exit 0 with the target URL, a PENDING REDIRECT',
        [relay.exitCode, relay.to, relay.pendingRedirect, relay.text.includes('found by that title'), relay.text.includes('did not move')],
        [EXIT_OK, { repo: UI, number: 31, url: `https://github.test/${UI}/issues/31` }, true, true, false],
        relay.text,
      );
      t(
        '…the list read is the target\'s cards updated since the send (less the slack), newest first — the decoy titled otherwise and the pull request under the same title are passed over; no POST left this process',
        [relay.seen.map((x) => x.call), new URLSearchParams(listed?.query ?? '').get('since'), new URLSearchParams(listed?.query ?? '').get('sort'), new URLSearchParams(listed?.query ?? '').get('state'), posts(relay.seen).length],
        [[SRC_KEY, SRC_KEY, LIST], new Date(NOW_FIXTURE - READ_BACK_SLACK_MS).toISOString(), 'updated', 'all', 0],
      );
      const bBlank = board();
      const blank = await drive(withAnswers(bBlank, { [SRC_KEY]: (init) => (init.redirect === 'manual' && bBlank.state.moved ? { status: 301, json: { message: 'Moved Permanently', url: '' }, headers: { location: '' } } : bBlank.answers[SRC_KEY](init)) }), { route: dispatchRoute(), send: outcome('success', bBlank) });
      t('relay: a 301 naming no card (a target this identity cannot see) supplies no number — the title finds the card, exit 0', [blank.exitCode, blank.to?.number, blank.text.includes('answers 301 naming no card this identity can read')], [EXIT_OK, 31, true], blank.text);

      // ② the positive controls: the target lacks the card AND the old URL is unchanged — still exit 4, after exactly the window.
      const stuck = await drive(board({ 'POST /graphql': () => ({ status: 200, json: landedOn(UI) }) }));
      t(
        'direct: the mutation answered #31 but the target never holds it and the old URL still serves the card — exit 4, after one read per step of the schedule and no more',
        [stuck.exitCode, stuck.text.includes('the card did not move') && stuck.text.includes(`read ${DELAYS.length + 1} times over ${WINDOW} ms`), stuck.sleeps, calls(stuck, T31)],
        [EXIT_BOARD_DISAGREES, true, [...DELAYS], DELAYS.length + 1],
        stuck.text,
      );
      t('…④ the transfer was sent ONCE: one mutation, the old URL read twice after it (before and after the window)', [posts(stuck.seen).length, calls(stuck, SRC_KEY)], [1, 3]);
      let sends = 0;
      const lied = await drive(board(), { route: dispatchRoute(), send: async (p) => { sends++; return liar(p); } });
      t('relay: a run that reported success while the target never lists the card and the old URL still serves it — exit 4 after the window, ONE dispatch, no POST', [lied.exitCode, lied.sleeps, calls(lied, LIST), sends, posts(lied.seen).length], [EXIT_BOARD_DISAGREES, [...DELAYS], DELAYS.length + 1, 1, 0], lied.text);

      // the bounded re-read finds a target that lags the transfer
      const bLag = board();
      let lagReads = 0;
      const late = await drive(withAnswers(bLag, { [T31]: (init) => (++lagReads <= 2 ? { status: 404, json: { message: 'Not Found' } } : bLag.answers[T31](init)) }));
      t('direct: #31 answers 404 twice, then from the target — exit 0 on re-read 2, having waited exactly the first two steps, the transfer sent once', [late.exitCode, late.sleeps, late.text.includes('found on re-read 2'), posts(late.seen).length], [EXIT_OK, DELAYS.slice(0, 2), true, 1], late.text);
      const bListLag = board();
      let listReads = 0;
      const slowList = await drive(withAnswers(lagOld(bListLag), { [LIST]: (init) => (++listReads === 1 ? { status: 200, json: [] } : bListLag.answers[LIST](init)) }), { route: dispatchRoute(), send: outcome('success', bListLag) });
      t('relay: a target list that lags is re-read — exit 0 on re-read 1, a pending redirect', [slowList.exitCode, slowList.sleeps, slowList.pendingRedirect], [EXIT_OK, DELAYS.slice(0, 1), true], slowList.text);

      // ③ an unreadable or ambiguous target is UNCONFIRMED — never "did not move", and an unreadable one is not waited for.
      const GATE = 'GitHub access to this repository is not enabled for this session. Use add_repo to request access.';
      const bGate = board();
      const gated = await drive(withAnswers(lagOld(bGate), { [LIST]: () => ({ status: 403, json: { message: GATE } }) }), { route: dispatchRoute(), send: outcome('success', bGate) });
      t(
        'relay in a session that cannot read the target (403): UNCONFIRMED (6) printing the platform\'s sentence and the pending redirect — never exit 4, and an unreadable target is not re-read',
        [gated.exitCode, gated.text.includes(GATE), gated.text.includes('PENDING REDIRECT'), gated.text.includes('did not move'), gated.sleeps, calls(gated, LIST)],
        [EXIT_UNCONFIRMED, true, true, false, [], 1],
        gated.text,
      );
      const bGate31 = board();
      const gated31 = await drive(withAnswers(bGate31, { [T31]: () => ({ status: 403, json: { message: GATE } }) }));
      t('direct with the target unreadable: UNCONFIRMED (6), carrying the number the mutation and the 301 agree on', [gated31.exitCode, gated31.to, gated31.text.includes('the old URL answers 301 to #31')], [EXIT_UNCONFIRMED, { repo: UI, number: 31, url: null }, true], gated31.text);
      const bTwo = board();
      const two = await drive(withAnswers(lagOld(bTwo), { [LIST]: () => ({ status: 200, json: [card(UI, 31), card(UI, 32)] }) }), { route: dispatchRoute(), send: outcome('success', bTwo) });
      t('relay: two cards on the target under the title are UNCONFIRMED (6), both named — a title names one card or none', [two.exitCode, two.text.includes('(#31, #32)'), two.sleeps], [EXIT_UNCONFIRMED, true, []], two.text);
      const bFar = board();
      const far = await drive(withAnswers(bFar, { [SRC_KEY]: (init) => (init.redirect === 'manual' && bFar.state.moved ? { status: 301, json: { url: `${API_TEST}/repos/${TARGET_OWNER}/cloud/issues/31` }, headers: { location: `${API_TEST}/repos/${TARGET_OWNER}/cloud/issues/31` } } : bFar.answers[SRC_KEY](init)) }));
      t('a 301 to another repository than the target is exit 4, naming it, and the target is not read', [far.exitCode, far.text.includes(`redirects to ${TARGET_OWNER}/cloud#31, not to ${UI}`), calls(far, T31)], [EXIT_BOARD_DISAGREES, true, 0], far.text);
      let manualReads = 0;
      const bTurn = board();
      const turn = await drive(withAnswers(bTurn, { [SRC_KEY]: (init) => (init.redirect !== 'manual' ? bTurn.answers[SRC_KEY](init) : ++manualReads === 1 ? { status: 200, json: card(SRC, 7) } : { status: 301, json: { url: '' }, headers: { location: '' } }) }), { route: dispatchRoute(), send: liar });
      t('relay: the target still lacks the card after the window, but the old URL now answers 301 — UNCONFIRMED (6), not exit 4: the source is no longer unchanged', [turn.exitCode, turn.text.includes('did not move'), turn.text.includes('answers 301 naming no card')], [EXIT_UNCONFIRMED, false, true], turn.text);
    }

    // ── the relay annotation ────────────────────────────────────────────────
    battery("the relay annotation: the number the relay run's annotation carries is read first — the card confirmed on the target with no title search; a target that answers this session 403 is still exit 0, confirmed_by relay-annotation, the old URL its corroboration; a 404, another title or another number keeps exit 4 / 6; absent, the 301 and the title as before");
    {
      const DELAYS = TRANSFER_READ_BACK_DELAYS_MS;
      const calls = (r, call) => r.seen.filter((x) => x.call === call).length;
      const T31 = `GET /repos/${UI}/issues/31`;
      const LIST = `GET /repos/${UI}/issues`;
      const URL31 = `https://github.test/${UI}/issues/31`;
      const GATE = 'GitHub access to this repository is not enabled for this session. Use add_repo to request access.';
      // A relay run that reports the transfer through its annotation — spelled and parsed by the relay's own pair,
      // matched to the stroke by the relay's own matcher, exactly as `sendFleetWrite` hands it on.
      const annotatedRun = (b, number = 31, { moves = true } = {}) => async (payload) => {
        if (moves) b.state.moved = true;
        const parsed = [parseRelayAnnotation(relayAnnotationMessage({ action: 1, op: 'transfer', number, url: `https://github.test/${UI}/issues/${number}` }))];
        const { rows, ignored } = matchRunAnnotations(payload, parsed);
        return { state: 'success', ok: true, status: 204, verdict: 'ok', requestId: payload.request_id, startMs: 1, ceilingMs: 2, run: RUN, detail: '', annotations: { state: 'read', rows, ignored, why: '' } };
      };
      const relayed = (b, send) => drive(b, { route: dispatchRoute(), send: send ?? annotatedRun(b) });

      const b1 = board();
      const one = await relayed(b1);
      t(
        "the annotation's number is read first: #31 read once on the target, ZERO title searches, no wait — exit 0, confirmed by the target",
        [one.exitCode, one.to, one.confirmedBy, calls(one, T31), calls(one, LIST), one.sleeps, posts(one.seen).length],
        [EXIT_OK, { repo: UI, number: 31, url: URL31 }, 'target', 1, 0, [], 0],
        one.text,
      );
      t('…the transcript names the annotation, and the read-back line says where the number came from', [one.text.includes(`the relay run's annotation names ${UI}#31 ${URL31}`), one.text.includes("its number came from the relay run's annotation")], [true, true], one.text);
      const b2 = board();
      const pending = await relayed(lagOld(b2), annotatedRun(b2));
      t('an old URL still answering 200 from the source beside it: exit 0, a PENDING REDIRECT, still no title search', [pending.exitCode, pending.pendingRedirect, pending.text.includes('PENDING REDIRECT'), calls(pending, LIST)], [EXIT_OK, true, true, 0], pending.text);

      // ⭐ The PM ruling's exit: a session that cannot read the target.
      const gate = (b) => withAnswers(lagOld(b), { [T31]: () => ({ status: 403, json: { message: GATE } }), [LIST]: () => ({ status: 403, json: { message: GATE } }) });
      const b3 = board();
      const gated = await relayed(gate(b3), annotatedRun(b3));
      t(
        "⭐ the target answers this session 403: exit 0, confirmed_by relay-annotation, the target URL the annotation carries — not re-read, no title search",
        [gated.exitCode, gated.confirmedBy, gated.to, gated.sleeps, calls(gated, T31), calls(gated, LIST)],
        [EXIT_OK, 'relay-annotation', { repo: UI, number: 31, url: URL31 }, [], 1, 0],
        gated.text,
      );
      t(
        "…printing `confirmed_by: relay-annotation`, the platform's 403 sentence, and the old URL as corroboration (here a PENDING REDIRECT)",
        [gated.text.includes('confirmed_by: relay-annotation'), gated.text.includes(GATE), gated.text.includes('PENDING REDIRECT'), gated.pendingRedirect, gated.text.includes(`✓ issue-transfer: ${SRC}#7 → ${UI}#31 ${URL31}`)],
        [true, true, true, true, true],
        gated.text,
      );
      t('…and --json carries the confirmation: confirmed_by relay-annotation, the target URL, the pending redirect', [jsonLine(gated).confirmed_by, jsonLine(gated).to, jsonLine(gated).pending_redirect, jsonLine(one).confirmed_by], ['relay-annotation', { repo: UI, number: 31, url: URL31 }, true, 'target']);
      const b4 = board();
      const bare = await relayed(gate(b4), outcome('success', b4, { annotations: { state: 'read', rows: [], ignored: [], why: '' } }));
      t('the control: the same 403 with NO annotation stays UNCONFIRMED (6) — the exception is the annotation\'s alone', [bare.exitCode, bare.confirmedBy ?? null, bare.text.includes('no annotation on the relay run names this transfer')], [EXIT_UNCONFIRMED, null, true], bare.text);
      const b5 = board();
      const limited = await relayed(withAnswers(lagOld(b5), { [T31]: () => ({ status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: { message: 'API rate limit exceeded' } }) }), annotatedRun(b5));
      t('a 403 that is an EXHAUSTED rate limit is not that exception: UNCONFIRMED (6), carrying the annotated number and url', [limited.exitCode, limited.to], [EXIT_UNCONFIRMED, { repo: UI, number: 31, url: URL31 }], limited.text);

      // A 404, another title, another number: the board's own exits stand, whatever named the number.
      const b6 = board();
      const absent = await relayed(withAnswers(b6, { [T31]: () => ({ status: 404, json: { message: 'Not Found' } }) }), annotatedRun(b6, 31, { moves: false }));
      t("the target never holds the annotated #31 and the old URL still serves the card: exit 4 after exactly the window, ONE dispatch, no POST", [absent.exitCode, absent.sleeps, calls(absent, T31), posts(absent.seen).length, absent.text.includes('the card did not move')], [EXIT_BOARD_DISAGREES, [...DELAYS], DELAYS.length + 1, 0, true], absent.text);
      const b7 = board();
      const retitled = await relayed(withAnswers(b7, { [T31]: () => ({ status: 200, json: card(UI, 31, { title: 'something else' }) }) }), annotatedRun(b7));
      t('the annotated #31 answering under another title is exit 4', [retitled.exitCode, retitled.text.includes('titled "something else"')], [EXIT_BOARD_DISAGREES, true], retitled.text);
      const b8 = board();
      const other = await relayed(b8, annotatedRun(b8, 30));
      t("an annotation naming #30 while the old URL redirects to #31 is exit 4, both numbers printed", [other.exitCode, other.text.includes("the relay run's annotation names #30, the old URL redirects to #31")], [EXIT_BOARD_DISAGREES, true], other.text);

      // Absent: the order the header names — the 301, then the title.
      const b9 = board();
      const fallback = await relayed(b9, outcome('success', b9, { annotations: { state: 'unread', rows: [], ignored: [], why: 'GET /jobs -> HTTP 403' } }));
      t("no annotation: the old URL's 301 supplies #31 and the card is read there, exit 0 confirmed by the target", [fallback.exitCode, fallback.to?.number, calls(fallback, T31), calls(fallback, LIST), fallback.confirmedBy], [EXIT_OK, 31, 1, 0, 'target'], fallback.text);
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
      'a pull request or an already-moved card refused before any write, one paced mutation or one dispatch, a read-back that confirms on the TARGET — an old URL ' +
      'still answering 200 read as a pending redirect, exit 4 only when a bounded re-read still finds no card AND the old URL is unchanged, the transfer never ' +
      're-sent — the relay run\'s annotation read first for the number (a target that answers 403 confirmed by it, confirmed_by relay-annotation), ' +
      'a failed run that names the installation remedy and is never fallen back from, and both halves of the throttle around the one write.',
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
  if (opts.json && result.to) console.log(JSON.stringify(jsonLine(result)));
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
