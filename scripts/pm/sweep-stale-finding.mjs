#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * sweep-stale-finding — the stale `finding` label sweep (#16904, deliverable D1).
 *
 *   node scripts/pm/sweep-stale-finding.mjs                   # DRY RUN: print the stale set, write nothing
 *   node scripts/pm/sweep-stale-finding.mjs --write           # act: remove `finding` from the stale set
 *   node scripts/pm/sweep-stale-finding.mjs --repo owner/name # the board to sweep (both boards are targets)
 *   node scripts/pm/sweep-stale-finding.mjs --cursor=17500    # resume from an issue number
 *   node scripts/pm/sweep-stale-finding.mjs --json            # the run summary as one JSON document
 *   node scripts/pm/sweep-stale-finding.mjs --self-test       # offline, no network, no token
 *
 * ## The rule this mechanizes, verbatim and untranslated
 *
 * The PM state model defines the label as transient:
 *
 *   「`finding` 观察类记录,恒 = 待首次定级;定级即离标;不占队列不进收件箱」
 *
 * So `label:finding` answers exactly one question — WHAT HAS NOT BEEN GRADED
 * YET — and on both boards it does not: the filing card measured 385 of 395
 * open carriers already graded (2% precise), a triage seat re-measured 185 of
 * 226 two days later, and a third seat's hand strip of 38 left 62 standing on
 * objectstack. The rule has a written half and no mechanical half; 定级即离标
 * is a step a human has to remember, which is the actual defect.
 *
 * This file is the ONE-TIME SWEEP half of the fix (the grading ruling's D1).
 * The recurrence half is a report-only patrol row in `check-half-states.mjs`
 * (D2), and the write-path half — making the strip impossible to omit on a
 * grading write — is a card of its own. ⛔ A sweep alone measures a population
 * that keeps refilling; nothing here should be read as closing the class.
 *
 * ## What is STALE, and what is deliberately left
 *
 * A card is stale when it carries `finding` AND any evidence that it has been
 * graded: one of `GRADING_STATE_LABELS` (derived from H13's state vocabulary,
 * imported, never restated) or any `priority:*`.
 *
 * ⚖️ That rule — the label constants, `gradeLabelsIn` and the `screenCard`
 * screen itself — now LIVES in `check-half-states.mjs` and is imported here,
 * re-exported under the names this file's callers and self-test already use.
 * It moved because the patrol grew a report-only row over the same population
 * (H63, #16904's D2) and the two must never be able to disagree about what
 * 「stale」 means. The direction is forced rather than chosen: this file already
 * imports `PM_STATE_LABELS` from there and derives module-level constants from
 * it, so the patrol importing THIS file is a cycle that throws
 * `ReferenceError: Cannot access 'PM_STATE_LABELS' before initialization` the
 * moment the patrol is the entry point — measured, not assumed. ⛔ Do not copy
 * the rule back here to shorten the import list.
 *
 * ⚠️ The trigger is a DISJUNCTION, and a triage seat that swept 38 of these by
 * hand recorded the opposite constraint from its own error: 「Any automated
 * `finding`-strip must key on 「has a six-state and a priority」 and must ⛔
 * never synthesise a missing grade」. That constraint was learned by FILLING a
 * missing `priority:*` from the label table without reading the body, and
 * sweeping a decision card into the queue. It binds a sweep that WRITES A
 * GRADE. This file writes no grade and cannot: its only write subtracts
 * `finding` from a label set it just read, and every other label — `domain:*`,
 * `priority:*`, the state, the type, `needs-user-decision` — is re-passed
 * exactly as found. Under subtraction the conjunction would leave standing
 * precisely the cards the index is wrongest about: a card carrying `finding`
 * beside a lone `priority:*` has been read and graded, which is the whole
 * content of 定级. So the disjunction is the ruled predicate, and every row
 * this file prints NAMES the trigger that put the card in the set, so the
 * reading is auditable card by card rather than on trust.
 *
 * Left alone, and reported rather than silently skipped:
 *
 *   - `finding` with NO grade at all — the genuinely ungraded pool. The index
 *     is honest about these and they are the one thing it is FOR.
 *   - a `pm:seat` post (`NEVER_SWEPT_LABELS`) — a seat registry post is not a
 *     card in the grading pool; whatever it carries, the seat that owns it owns
 *     its labels. ⛔ Never touched, whatever else is true of it.
 *   - a closed card — every census, patrol and candidate query forces
 *     `state:open`, so a closed card's labels are an archive, not an index.
 *   - a pull request that slipped into the listing.
 *
 * ⛔ This sweep NEVER adds a label, never posts a comment, never touches an
 * assignee and never closes anything. One comment per card would double the
 * write volume on the shared identity this file's caps exist to bound; the
 * run's own report is the audit record, and it is meant to be pasted onto the
 * card the sweep was run for.
 *
 * ## Why it is batched, and what it refuses to be
 *
 * ⛔ NEVER a whole-board burst in one loop. The population is ~60-120 cards per
 * board and every write goes out on ONE shared bot identity — a burst of that
 * size is #17374's incident class (a secondary rate limit taken on a shared
 * credential stops every seat on the board, not just this run). So:
 *
 *   - the action set is cut into batches of `DEFAULT_BATCH_SIZE`;
 *   - `GET /rate_limit` is read and PRINTED before and after every batch, so
 *     the operator watches the quota move rather than inferring it afterwards;
 *   - `DEFAULT_BATCH_PAUSE_MS` separates batches in `--write` mode;
 *   - `DEFAULT_MAX_CARDS` caps what one run will act on, and the cap ANNOUNCES
 *     itself whenever it binds — a capped run is not a finished sweep;
 *   - the FIRST `403` or `429` on any request stops the run where it stands and
 *     prints the resume cursor. ⛔ No retry loop: a secondary limit answered
 *     with retries is the incident, not the recovery.
 *
 * ## The four-step label write, and the verb it is spelled with
 *
 * Each removal is four steps: READ the card's current label set → COMPUTE the
 * survivor set, that set minus `finding` → WRITE → READ BACK and DIFF against
 * the computed set. Step 1 is taken immediately before the write and the
 * staleness is RE-JUDGED on it, because the listing row can be minutes old and
 * a card whose grade came off meanwhile is no longer this sweep's business.
 *
 * ⚠️ Step 3 is `DELETE /issues/{n}/labels/{name}`, which names ONE label and
 * cannot rewrite the set. The whole-set replace — the verb that PUTs the
 * computed survivor set back — is BANNED in this repo across
 * `.github/workflows/**`, `.github/actions/**` and `scripts/**`, and
 * `scripts/check-whole-set-label-write.mjs` is the gate; its header carries the
 * measurement, a label destroyed one second after it was written by another
 * writer's whole-set replace. A read-modify-write across a network round trip
 * silently destroys whatever lands inside the window, and read-back is its only
 * detection. So the computed survivor set is still computed — it is what step 4
 * compares against — and the write that realises it subtracts one name.
 *
 * The read-back is a REFUSAL, not a log line: any difference from the computed
 * set stops the run. `finding` still present means the removal did not land; a
 * survivor now missing or a new label now present means another actor is
 * writing to this card, and the safe move is to hand the operator a cursor
 * instead of racing it. ⛔ A label that appeared or vanished underneath the
 * write is REPORTED, never re-written: this sweep was only ever cleared to
 * subtract one label, and re-attaching or removing anything else would be it
 * overruling a deliberate write by someone else.
 *
 * ## Exit codes
 *
 *   0  the run finished: every card was judged, and in `--write` mode every
 *      strip landed and read back clean. A board with nothing to do is exit 0.
 *   1  usage — an unknown flag, a malformed `--repo`, a bad number.
 *   2  the run finished, but at least one card is UNJUDGED: a read or a write
 *      failed on it. An unjudged card is not a clean card.
 *   3  PREREQUISITE NOT MET (imported): the population read itself failed, so
 *      NO card was judged and this run says nothing at all about the board.
 *   4  STOPPED EARLY on a `403`/`429` or a read-back mismatch. The report names
 *      the card it stopped on and the `--cursor=N` that resumes there.
 *
 * Capture it BEFORE any pipe:
 *   `node scripts/pm/sweep-stale-finding.mjs > /tmp/sweep.log 2>&1; echo "EXIT=$?"`
 *
 * ## Who runs it
 *
 * The seat that OWNS the board it sweeps, once, by hand, after reading a dry
 * run. ⛔ No workflow calls this file with `--write` and none should: a
 * scheduled one-time sweep is a contradiction, and the recurrence it would be
 * papering over is D2's patrol row.
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import {
  EXIT_PREREQUISITE_NOT_MET,
  GRADING_STATE_LABELS,
  NEVER_SWEPT_LABELS,
  NOT_A_GRADE,
  PM_STATE_LABELS,
  PRIORITY_LABEL_SHAPE,
  PROXY_FLAG,
  STALE_FINDING_LABEL,
  SWEEP_REPO_SHAPE,
  gradeLabelsIn,
  labelNames,
  priorityLabelsIn,
  proxyRearmPlan,
  resolveSweepRepo,
  staleFindingScreen,
} from './check-half-states.mjs';

// dispatch-gates: no-path-population -- this tool reads no file in the tree at all; its whole input is the GitHub API (one label-scoped issue listing per board, plus the per-card label read-back each write verifies itself against), so no card's file surface can predict it and the honest derivation is a repo-wide undetermined one (#16904)

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_UNJUDGED = 2;
export const EXIT_STOPPED = 4;

/**
 * The re-exec guard, per script rather than shared: two scripts sharing one
 * guard name means the first one's re-exec silently disarms the second's when
 * they run in the same process tree.
 */
const PROXY_REARM_GUARD = 'OS_STALE_FINDING_SWEEP_PROXY_REARMED';

/**
 * The rule, re-exported under the names this file has always published so its
 * callers, its renderers and its self-test are unchanged by the move. ⛔ These
 * are ALIASES of one definition, never a second copy — the header says why the
 * definition lives in `check-half-states.mjs` and why the arrow cannot point
 * the other way.
 */
export { GRADING_STATE_LABELS, NEVER_SWEPT_LABELS, NOT_A_GRADE, PRIORITY_LABEL_SHAPE, gradeLabelsIn, priorityLabelsIn };

/** The one label this sweep removes. It removes nothing else, ever. */
export const TARGET_LABEL = STALE_FINDING_LABEL;

/** The screen, over a listing row — the shared rule, under this file's name for it. */
export const screenCard = staleFindingScreen;

/** How many cards one batch acts on before the quota is read again. */
export const DEFAULT_BATCH_SIZE = 10;

/** The pause between WRITE batches. A dry run never pauses — it writes nothing. */
export const DEFAULT_BATCH_PAUSE_MS = 2_000;

/** How many cards one run will act on. Reported whenever it binds. */
export const DEFAULT_MAX_CARDS = 50;

/** The quota backstop on the listing — a ceiling that announces itself. */
export const LISTING_PAGE_CEILING = 10;

// ---------------------------------------------------------------------------
// Pure core — every function below is offline and is what `--self-test` pins.
// ---------------------------------------------------------------------------

/** The label set the four-step write PUTs: everything except the target. */
export function targetLabelSet(names) {
  return (names ?? []).filter((name) => name !== TARGET_LABEL);
}

/**
 * STEP 2 of the four-step write, re-judged on the FRESH read rather than on the
 * listing row: what this card's write should be, if any.
 *
 * @param {string[]} freshNames the label set as it reads right now
 */
export function planStrip(freshNames) {
  const names = freshNames ?? [];
  if (!names.includes(TARGET_LABEL)) {
    return { act: false, kind: 'already-clean', detail: `\`${TARGET_LABEL}\` is no longer on the card — someone else removed it` };
  }
  const excluded = NEVER_SWEPT_LABELS.filter((label) => names.includes(label));
  if (excluded.length > 0) {
    return { act: false, kind: 'never-swept', detail: `the card now carries ${excluded.map((l) => `\`${l}\``).join(', ')}` };
  }
  const triggers = gradeLabelsIn(names);
  if (triggers.length === 0) {
    return { act: false, kind: 'no-longer-graded', detail: 'the grade came off between the listing and this read, so the label is not stale any more' };
  }
  return { act: true, kind: 'strip', triggers, target: targetLabelSet(names) };
}

/**
 * STEP 4: the read-back, compared against the set that was written.
 *
 * Three distinguishable outcomes, because they mean three different things:
 *   `stillTarget`  the removal did not land — the write was accepted and the
 *                  label is still there.
 *   `missing`      a survivor is gone — the subtractive write cannot have taken
 *                  it, so another actor removed it inside the window.
 *   `added`        a label appeared that was not in the computed set — another
 *                  actor added it. The subtractive write did not clobber it,
 *                  and it is LEFT ALONE.
 */
export function readBackDiff(target, after) {
  const wrote = target ?? [];
  const now = after ?? [];
  return {
    stillTarget: now.includes(TARGET_LABEL),
    missing: wrote.filter((name) => !now.includes(name)),
    added: now.filter((name) => !wrote.includes(name)),
    get ok() {
      return !this.stillTarget && this.missing.length === 0 && this.added.length === 0;
    },
  };
}

/** The sentence a read-back mismatch stops the run with. */
export function readBackRefusal(number, diff) {
  const parts = [];
  if (diff.stillTarget) parts.push(`\`${TARGET_LABEL}\` is STILL on the card — the removal did not land`);
  if (diff.missing.length) parts.push(`survivor label(s) are gone: ${diff.missing.map((l) => `\`${l}\``).join(', ')}`);
  if (diff.added.length) parts.push(`label(s) appeared that were not in the computed set: ${diff.added.map((l) => `\`${l}\``).join(', ')} — LEFT ALONE, never re-written`);
  return (
    `#${number}: the read-back does not match what was written (${parts.join('; ')}). ` +
    'Another actor is writing to this board, so this run stops here rather than racing it.'
  );
}

/** `403` and `429` are the two statuses that stop this run. Nothing else does. */
export function isStopStatus(status) {
  return status === 403 || status === 429;
}

/** The line an operator copies to resume. Inclusive of the card named: re-judging one card is free. */
export function resumeHint(number) {
  return `--cursor=${number}`;
}

/** One page of the OPEN cards carrying the target label. One label, so the AND-across-names filter is not in play. */
export function listingPath(repo, page) {
  const query = [
    'state=open',
    `labels=${encodeURIComponent(TARGET_LABEL)}`,
    'sort=created',
    'direction=asc',
    'per_page=100',
    `page=${page}`,
  ].join('&');
  return `/repos/${repo}/issues?${query}`;
}

/** Cut a list into bounded batches. A batch is the unit the quota is read around. */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < (list ?? []).length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * The run's counts and its exit code, from the judged rows alone — so the exit
 * register is pinned offline and cannot drift from what the report printed.
 *
 * ⛔ Nothing-to-do is exit 0, always. Only an unjudged card, a write that did
 * not land, or an early stop moves the code.
 */
export function summariseRun(rows, { stopped = null } = {}) {
  const counts = { stale: 0, stripped: 0, left: 0, skipped: 0, unjudged: 0 };
  for (const row of rows ?? []) {
    if (row.verdict === 'stale') counts.stale += 1;
    else if (row.verdict === 'leave') counts.left += 1;
    else if (row.verdict === 'unjudged') counts.unjudged += 1;
    else counts.skipped += 1;
    if (row.removed?.length) counts.stripped += 1;
  }
  const exitCode = stopped ? EXIT_STOPPED : counts.unjudged > 0 ? EXIT_UNJUDGED : EXIT_OK;
  return { counts, exitCode };
}

/** A rate reading, rendered. Pure, so the one line an operator watches is pinned offline. */
export function formatRate(reading) {
  if (!reading?.ok) return `unavailable — ${reading?.detail ?? 'no reading'}`;
  return `core ${reading.remaining}/${reading.limit}, resets ${reading.resetIso}`;
}

/** The label names off a `GET .../labels` payload. */
export function namesOf(payload) {
  return (Array.isArray(payload) ? payload : []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Live layer — the only functions in this file that touch the network. Every
// one of them takes its transport as an argument, so `--self-test` drives the
// whole run offline with a fake and no token.
// ---------------------------------------------------------------------------

async function restLive(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    err.retryAfter = res.headers?.get?.('retry-after') ?? null;
    err.rateRemaining = res.headers?.get?.('x-ratelimit-remaining') ?? null;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

const sleepLive = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** `GET /rate_limit` — exempt from the limit it reports, and never fatal: a run that cannot read the quota still reports one. */
async function readRate(rest) {
  try {
    const doc = await rest('/rate_limit');
    const core = doc?.resources?.core ?? doc?.rate ?? null;
    if (!core || typeof core.limit !== 'number') return { ok: false, detail: 'the response carried no `core` resource' };
    return {
      ok: true,
      limit: core.limit,
      remaining: core.remaining,
      reset: core.reset,
      resetIso: new Date((core.reset ?? 0) * 1000).toISOString(),
    };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

async function listOpenTargets(rest, repo, stats) {
  const byNumber = new Map();
  let exhausted = false;
  for (let page = 1; page <= LISTING_PAGE_CEILING; page++) {
    const batch = await rest(listingPath(repo, page));
    stats.listingRequests += 1;
    for (const row of Array.isArray(batch) ? batch : []) byNumber.set(row.number, row);
    if (!Array.isArray(batch) || batch.length < 100) {
      exhausted = true;
      break;
    }
  }
  if (!exhausted) stats.listingTruncated = true;
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/**
 * The four-step write, on ONE card. Steps 1 and 2 are re-taken here rather than
 * carried from the listing: the row that put this card in the set can be
 * minutes old, and a card whose grade came off since is not this sweep's.
 */
async function stripCard(rest, repo, number, stats) {
  const before = await rest(`/repos/${repo}/issues/${number}/labels?per_page=100`); // STEP 1 — read
  stats.readRequests += 1;
  const beforeNames = namesOf(before);
  const plan = planStrip(beforeNames); // STEP 2 — compute the survivor set
  if (!plan.act) return { acted: false, plan, beforeNames };
  // STEP 3 — write, as the ONE verb that cannot rewrite a label set.
  await rest(`/repos/${repo}/issues/${number}/labels/${encodeURIComponent(TARGET_LABEL)}`, { method: 'DELETE' });
  stats.writeRequests += 1;
  const after = await rest(`/repos/${repo}/issues/${number}/labels?per_page=100`); // STEP 4 — read back
  stats.readRequests += 1;
  const afterNames = namesOf(after);
  return { acted: true, plan, beforeNames, afterNames, diff: readBackDiff(plan.target, afterNames) };
}

function row(card, verdict, extra = {}) {
  return {
    number: card.number,
    title: card.title ?? '',
    url: card.html_url ?? null,
    labels: labelNames(card ?? {}),
    verdict,
    kind: null,
    triggers: [],
    detail: null,
    removed: [],
    ...extra,
  };
}

/**
 * The run. Returns everything the two renderers need and decides nothing about
 * how it is printed — `--json` and the text report must never be able to
 * disagree about what happened.
 */
export async function sweep(repo, options, { rest = restLive, sleep = sleepLive } = {}) {
  const stats = { listingRequests: 0, readRequests: 0, writeRequests: 0, rateRequests: 0, listingTruncated: false };
  const rateReadings = [];
  const takeRate = async (when) => {
    const reading = await readRate(rest);
    stats.rateRequests += 1;
    rateReadings.push({ when, ...reading });
    return reading;
  };

  await takeRate('run-start');

  let listed;
  try {
    listed = await listOpenTargets(rest, repo, stats);
  } catch (err) {
    const detail = err.status ? `${err.message}${err.retryAfter ? ` (retry-after ${err.retryAfter})` : ''}` : err.message;
    const wrapped = new Error(detail);
    wrapped.status = err.status ?? null;
    throw wrapped;
  }

  const rows = [];
  const stale = [];
  for (const card of listed) {
    if (options.cursor !== null && card.number < options.cursor) {
      rows.push(row(card, 'skip', { kind: 'before-cursor', detail: `below \`${resumeHint(options.cursor)}\`` }));
      continue;
    }
    const screen = screenCard(card);
    const out = row(card, screen.verdict, { kind: screen.kind, triggers: screen.triggers, detail: screen.detail ?? null });
    if (screen.verdict === 'stale') stale.push(out);
    rows.push(out);
  }

  const acting = stale.slice(0, options.maxCards);
  const deferred = stale.slice(options.maxCards);
  for (const r of deferred) {
    r.deferred = true;
    r.detail = `beyond this run's cap of ${options.maxCards} card(s) — NOT acted on; resume with \`${resumeHint(r.number)}\``;
  }

  const batches = options.write ? chunk(acting, options.batchSize) : [];
  let stopped = null;

  for (const [index, batch] of batches.entries()) {
    await takeRate(`batch-${index + 1}-before`);
    for (const r of batch) {
      try {
        const written = await stripCard(rest, repo, r.number, stats);
        if (!written.acted) {
          r.verdict = 'skip';
          r.kind = written.plan.kind;
          r.detail = `not written: ${written.plan.detail}`;
          continue;
        }
        if (!written.diff.ok) {
          r.verdict = 'unjudged';
          r.detail = readBackRefusal(r.number, written.diff);
          stopped = { number: r.number, reason: 'read-back-mismatch', detail: r.detail, status: null, retryAfter: null };
          break;
        }
        r.removed = [TARGET_LABEL];
        r.detail = `removed \`${TARGET_LABEL}\`; read back and matched (${written.afterNames.length} label(s) left)`;
      } catch (err) {
        r.verdict = 'unjudged';
        r.detail = `the write failed: ${err.message}`;
        if (isStopStatus(err.status)) {
          stopped = {
            number: r.number,
            reason: err.status === 429 ? 'rate-limited' : 'forbidden',
            detail: err.message,
            status: err.status,
            retryAfter: err.retryAfter ?? null,
          };
          break;
        }
      }
    }
    await takeRate(`batch-${index + 1}-after`);
    if (stopped) break;
    if (index < batches.length - 1 && options.batchPauseMs > 0) await sleep(options.batchPauseMs);
  }

  await takeRate('run-end');

  return {
    repo,
    rows,
    stale: stale.length,
    acting: acting.length,
    deferred: deferred.length,
    listed: listed.length,
    batches: batches.length,
    stats,
    rateReadings,
    stopped,
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function countKinds(rows, verdict) {
  const out = new Map();
  for (const r of rows) {
    if (r.verdict !== verdict) continue;
    out.set(r.kind ?? 'other', (out.get(r.kind ?? 'other') ?? 0) + 1);
  }
  return [...out.entries()].map(([kind, n]) => `${n} ${kind}`).join(' · ') || 'none';
}

/** How the stale set breaks down by what triggered it — the reading that makes the set auditable. */
export function staleByTrigger(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    if (r.verdict !== 'stale' && !(r.removed?.length > 0)) continue;
    const states = (r.triggers ?? []).filter((t) => GRADING_STATE_LABELS.includes(t));
    const key = states.length > 0 ? states.join('+') : 'priority only';
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

export function renderRun(result, options) {
  const { counts, exitCode } = summariseRun(result.rows, { stopped: result.stopped });
  const lines = [
    `sweep-stale-finding — ${result.repo} — ${options.write ? 'WRITE' : 'DRY RUN — nothing was written'}`,
    `  stale = \`${TARGET_LABEL}\` beside a grading state (${GRADING_STATE_LABELS.join(', ')}) or any \`priority:*\``,
    ...(options.provenance ? [`  provenance: ${options.provenance}`] : []),
    `  listed: ${result.listed} open card(s) carrying \`${TARGET_LABEL}\``,
    `  stale: ${result.stale} · genuinely ungraded: ${counts.left} · not judged: ${counts.skipped}`,
    `  stale by trigger: ${staleByTrigger(result.rows).map(([k, n]) => `${n} ${k}`).join(' · ') || 'none'}`,
    `  left, by reason: ${countKinds(result.rows, 'leave')}`,
    `  not judged, by reason: ${countKinds(result.rows, 'skip')}`,
    `  batches: ${result.batches} of up to ${options.batchSize} card(s) · stripped: ${counts.stripped} · unjudged: ${counts.unjudged}`,
    `  requests: ${result.stats.listingRequests} listing · ${result.stats.readRequests} label read · ${result.stats.writeRequests} write · ${result.stats.rateRequests} rate`,
  ];
  for (const reading of result.rateReadings) lines.push(`  rate_limit [${reading.when}]: ${formatRate(reading)}`);

  if (result.stats.listingTruncated) {
    lines.push(
      `  ⚠️  the page ceiling (${LISTING_PAGE_CEILING}) BOUND the listing — that population was read short,`,
      '      so this run is NOT a complete inventory of the board.',
    );
  }
  if (result.deferred > 0) {
    lines.push(`  ⚠️  the per-run cap (${options.maxCards}) BOUND this run: ${result.deferred} stale card(s) were NOT acted on.`);
  }

  const section = (title, picked) => {
    if (picked.length === 0) return;
    lines.push('', `${title} (${picked.length})`);
    for (const r of picked.slice(0, options.listCap)) {
      const trig = r.triggers?.length ? ` [${r.triggers.join(', ')}]` : '';
      lines.push(`  #${r.number}${trig}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    if (picked.length > options.listCap) {
      lines.push(`  … and ${picked.length - options.listCap} more (list capped for readability, not for judgement)`);
    }
  };

  section(
    options.write ? 'STRIPPED' : `STALE — would remove \`${TARGET_LABEL}\``,
    result.rows.filter((r) => r.verdict === 'stale' || r.removed?.length > 0),
  );
  section('UNGRADED — left alone; the index is honest about these', result.rows.filter((r) => r.verdict === 'leave'));
  section('UNJUDGED — these cards were NOT read as clean', result.rows.filter((r) => r.verdict === 'unjudged'));

  if (result.stopped) {
    lines.push(
      '',
      `⛔ STOPPED on #${result.stopped.number} (${result.stopped.reason}${result.stopped.status ? `, HTTP ${result.stopped.status}` : ''}` +
        `${result.stopped.retryAfter ? `, retry-after ${result.stopped.retryAfter}` : ''}).`,
      `   ${result.stopped.detail}`,
      `   RESUME: re-run with ${resumeHint(result.stopped.number)} — the card it stopped on is re-judged, which is free.`,
      '   ⛔ Do not retry in a loop: a secondary limit answered with retries is the incident, not the recovery.',
      `   exit ${EXIT_STOPPED}.`,
    );
  } else if (counts.unjudged > 0) {
    lines.push('', `⚠️  ${counts.unjudged} card(s) unjudged. An unjudged card is not a clean card; exit ${EXIT_UNJUDGED}.`);
  } else if (!options.write) {
    lines.push('', `✓ ${result.stale} stale card(s) found and NOTHING was written; exit ${EXIT_OK}. Pass --write to act.`);
  } else {
    lines.push('', `✓ ${counts.stripped} card(s) stripped, every one read back and matched; exit ${EXIT_OK}.`);
  }
  return { text: lines.join('\n'), exitCode };
}

export function renderJson(result, options) {
  const { counts, exitCode } = summariseRun(result.rows, { stopped: result.stopped });
  return {
    tool: 'sweep-stale-finding',
    repo: result.repo,
    mode: options.write ? 'write' : 'dry-run',
    target_label: TARGET_LABEL,
    grading_states: [...GRADING_STATE_LABELS],
    never_swept: [...NEVER_SWEPT_LABELS],
    cursor: options.cursor,
    caps: { max_cards: options.maxCards, batch_size: options.batchSize, listing_pages: LISTING_PAGE_CEILING },
    cap_bound: result.deferred > 0,
    listing_truncated: result.stats.listingTruncated,
    listed: result.listed,
    stale: result.stale,
    counts,
    stale_by_trigger: Object.fromEntries(staleByTrigger(result.rows)),
    rate_readings: result.rateReadings,
    requests: result.stats,
    stopped: result.stopped,
    resume: result.stopped ? resumeHint(result.stopped.number) : null,
    exit_code: exitCode,
    cards: result.rows.map((r) => ({
      number: r.number,
      verdict: r.verdict,
      kind: r.kind,
      triggers: r.triggers,
      removed: r.removed,
      labels: r.labels,
      detail: r.detail,
      url: r.url,
    })),
  };
}

/**
 * The refusal printer. Its load-bearing half is the last paragraph: a run that
 * could not read the board must never be legible as a run that found a clean
 * one (#4690) — and on a report-only dry run that risk is sharper than on a gate.
 */
function reportPrerequisiteNotMet(err) {
  console.error(
    `\nsweep-stale-finding: PREREQUISITE NOT MET — ${err.message}\n\n` +
      '  Fix:  run this where node\'s fetch reaches api.github.com with a token that can read issues\n' +
      `        (a GitHub Actions runner, or an agent container with ${PROXY_FLAG} — this script re-execs\n` +
      '        itself with that flag when HTTPS_PROXY is set).\n\n' +
      '  NOTHING WAS SWEPT: the population read failed, so no card was listed and no card was judged.\n' +
      '  This run says nothing about whether the board carries stale labels. It is not a clean board\n' +
      '  and it is not a dirty one — it is no reading at all.\n' +
      `\n  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from ${EXIT_UNJUDGED}'s "read the board, could not judge a card"\n` +
      `  and ${EXIT_STOPPED}'s "stopped early, resume here". Capture it BEFORE any pipe:\n` +
      '  `node scripts/pm/sweep-stale-finding.mjs > /tmp/sweep.log 2>&1; echo "EXIT=$?"`.)',
  );
  return EXIT_PREREQUISITE_NOT_MET;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  if (process.env[PROXY_REARM_GUARD] === '1') return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — every request will bypass the proxy.`);
  return null;
}

/** The flags this tool takes. An argument outside this set is a typo, and a typo is refused. */
export const KNOWN_FLAGS = Object.freeze(['--write', '--dry-run', '--json', '--self-test', '--help', '-h']);
export const KNOWN_OPTIONS = Object.freeze(['repo', 'cursor', 'max-cards', 'batch-size', 'batch-pause-ms', 'list-cap', 'provenance']);

/**
 * The one option that also takes its value as a SEPARATE argument, because that
 * is the spelling the grading ruled (`--repo OWNER/NAME`). Deliberately not
 * extended to the numeric options: a bare `--max-cards 5` swallowing the next
 * token is how a run silently acts on a different number of cards than the
 * caller believes, and refusing it costs the caller one `=`.
 */
export const SPACE_SEPARATED_OPTIONS = Object.freeze(['--repo']);

/**
 * Parse argv into the run's options, or refuse. Pure over its `env`, so both
 * refusals and the repo resolution are pinned offline — this is the layer that
 * decides whether a run WRITES and WHICH BOARD it writes to, and a misread flag
 * there is a machine writing labels onto cards nobody asked about.
 */
export function parseOptions(argv, { env = {} } = {}) {
  const args = argv ?? [];
  const flags = new Set();
  const named = new Map();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (KNOWN_FLAGS.includes(arg)) {
      flags.add(arg);
      continue;
    }
    const eq = /^--([a-z-]+)=([\s\S]*)$/.exec(arg);
    if (eq && KNOWN_OPTIONS.includes(eq[1])) {
      named.set(eq[1], eq[2]);
      continue;
    }
    if (SPACE_SEPARATED_OPTIONS.includes(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { ok: false, error: `\`${arg}\` needs a value: \`${arg} owner/name\` or \`${arg}=owner/name\`.` };
      }
      named.set(arg.slice(2), value);
      i += 1;
      continue;
    }
    return {
      ok: false,
      error: `\`${arg}\` is not an argument this tool takes. Flags: ${KNOWN_FLAGS.join(' ')}; options: ${KNOWN_OPTIONS.map((o) => `--${o}=…`).join(' ')}.`,
    };
  }

  if (flags.has('--write') && flags.has('--dry-run')) {
    return { ok: false, error: '--write and --dry-run together say two different things about the one decision that matters. Pass one.' };
  }

  let repo = named.get('repo') ?? null;
  let repoSource = repo ? '--repo' : null;
  if (!repo) {
    const resolved = resolveSweepRepo(env);
    repo = resolved.repo;
    repoSource = resolved.source;
  }
  if (!SWEEP_REPO_SHAPE.test(repo)) {
    return {
      ok: false,
      error:
        `${repoSource}=${JSON.stringify(repo)} is not a repository in \`owner\`/\`name\` form. Refusing to fall back ` +
        'to a different board — a sweep of the wrong repo writes labels onto cards nobody asked about.',
    };
  }

  const whole = (name, fallback, { min = 1 } = {}) => {
    const raw = named.has(name) ? named.get(name) : String(fallback);
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) return { bad: `--${name}=${raw} must be a whole number of at least ${min}.` };
    return { value };
  };

  const maxCards = whole('max-cards', DEFAULT_MAX_CARDS);
  if (maxCards.bad) return { ok: false, error: maxCards.bad };
  const batchSize = whole('batch-size', DEFAULT_BATCH_SIZE);
  if (batchSize.bad) return { ok: false, error: batchSize.bad };
  const batchPauseMs = whole('batch-pause-ms', DEFAULT_BATCH_PAUSE_MS, { min: 0 });
  if (batchPauseMs.bad) return { ok: false, error: batchPauseMs.bad };
  const listCap = whole('list-cap', 25);
  if (listCap.bad) return { ok: false, error: listCap.bad };
  let cursor = null;
  if (named.has('cursor')) {
    const parsed = whole('cursor', 0);
    if (parsed.bad) return { ok: false, error: `--cursor=${named.get('cursor')} must be a positive issue number.` };
    cursor = parsed.value;
  }

  return {
    ok: true,
    options: {
      repo,
      repoSource,
      write: flags.has('--write'),
      json: flags.has('--json'),
      cursor,
      maxCards: maxCards.value,
      batchSize: batchSize.value,
      batchPauseMs: batchPauseMs.value,
      listCap: listCap.value,
      provenance: named.get('provenance') ?? '',
    },
  };
}

const USAGE = [
  'sweep-stale-finding — remove the stale `finding` label from cards that have already been graded.',
  '',
  '  node scripts/pm/sweep-stale-finding.mjs [--write | --dry-run] [--json] [--repo owner/name]',
  '                                          [--cursor=N] [--max-cards=N] [--batch-size=N]',
  '                                          [--batch-pause-ms=N] [--list-cap=N] [--provenance=TEXT]',
  '  node scripts/pm/sweep-stale-finding.mjs --self-test',
  '',
  '  default: DRY RUN over the board `PM_SWEEP_REPO` / `GITHUB_REPOSITORY` names. --write is what acts.',
  '  stale = `finding` beside a grading state or any `priority:*`. A card carrying `finding` alone is',
  '  the genuinely ungraded pool and is LEFT. A `pm:seat` post is never touched.',
  '  Read this file\'s header before passing --write: the run is bounded, batched and stops on the',
  '  first 403/429 on purpose, and the write set is one label per card.',
].join('\n');

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT_OK;
  }

  const parsed = parseOptions(argv, { env: process.env });
  if (!parsed.ok) {
    console.error(`sweep-stale-finding: ${parsed.error}`);
    return EXIT_USAGE;
  }
  const options = parsed.options;

  let result;
  try {
    result = await sweep(options.repo, options);
  } catch (err) {
    return reportPrerequisiteNotMet(err);
  }

  if (options.json) {
    const doc = renderJson(result, options);
    console.log(JSON.stringify(doc, null, 2));
    return doc.exit_code;
  }
  const rendered = renderRun(result, options);
  console.log(rendered.text);
  return rendered.exitCode;
}

// ---------------------------------------------------------------------------
// --self-test — offline, no network, no token. Every function above is driven
// by fixtures, and the RUN itself is driven through an injected transport, so
// the two properties a reviewer cannot check by reading (a dry run writes
// nothing; a stop really stops) are measured rather than asserted in prose.
//
// The battery ledger this self-test's floor is evaluated against: `battery()`
// opens one, every assertion is attributed to the one most recently opened, and
// a section that stops running names ITSELF at the floor rather than going
// quiet. The counts are a FLOOR, never an equality — adding cases is ordinary
// work and must not go red.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the grading vocabulary is derived from H13, never restated': 7,
  'the screen: what is stale, and what is deliberately left': 11,
  'the four-step write: the plan, the read-back and its refusal': 13,
  'the listing, the cursor and the caps': 9,
  'the exit register: nothing to do is never an alarm': 7,
  'the CLI: the two decisions a typo must never make': 12,
  'the run, driven offline: a dry run writes NOTHING': 6,
  'the run, driven offline: the write, the stop and the cursor': 15,
  'the report: what a reader is told, and what it refuses to imply': 8,
});
const SELF_TEST_BATTERY_FLOOR = 9;
const UNATTRIBUTED_BATTERY = '(unattributed)';

let selfTestReachedVerdict = false;

/**
 * A board in memory, behind the same transport signature the live layer uses.
 * ⛔ No network and no token: every path this fake does not know is an error,
 * so a run that reached for something unexpected fails loudly instead of
 * quietly returning undefined.
 */
function fakeBoard({ cards, failOn = null, afterWrite = null }) {
  const calls = [];
  const state = new Map(cards);
  const rest = async (path, { method = 'GET', body = null } = {}) => {
    calls.push({ path, method, body });
    const failure = failOn?.(path, method, calls.length);
    if (failure) throw failure;
    if (path === '/rate_limit') {
      return { resources: { core: { limit: 5000, remaining: 5000 - calls.length, reset: 1_789_000_000 } } };
    }
    if (/\/issues\?/.test(path)) {
      const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? '1'); // ⛔ anchored: a bare `page=` also matches `per_page=100`
      if (page > 1) return [];
      return [...state.entries()].map(([number, card]) => ({
        number,
        title: `card ${number}`,
        state: card.state ?? 'open',
        html_url: `https://github.com/o/r/issues/${number}`,
        ...(card.pull_request ? { pull_request: card.pull_request } : {}),
        labels: (card.labels ?? []).map((name) => ({ name })),
      }));
    }
    const single = /\/issues\/(\d+)\/labels(?:\/([^?]+))?/.exec(path);
    if (single) {
      const number = Number(single[1]);
      const card = state.get(number) ?? { labels: [] };
      if (method === 'DELETE') {
        const removed = decodeURIComponent(single[2] ?? '');
        state.set(number, { ...card, labels: (card.labels ?? []).filter((name) => name !== removed) });
        afterWrite?.(number, state);
        return (state.get(number).labels ?? []).map((name) => ({ name }));
      }
      return (card.labels ?? []).map((name) => ({ name }));
    }
    throw new Error(`the fake transport was asked for an unexpected path: ${path}`);
  };
  return { rest, calls, state };
}

export async function selfTest() {
  // The run fixture's option bag. Declared HERE rather than at module level,
  // and that placement is load-bearing: `dispatch-gates`'s module-body mask
  // blanks self-test BODIES but deliberately never masks top-level VALUE
  // declarations — an unreferenced top-level const carrying path literals is
  // how a gate DECLARES its population for that scanner. So a fixture repo slug
  // spelled at module scope reads as this tool declaring a one-path population
  // that names no tracked file, which `check:declared-population-live` reds on
  // (measured, the moment `check:pm-stale-finding` made this a declaring
  // family). Inside the body it is a fixture again. ⛔ Do not hoist it.
  const OPTIONS = (over = {}) => ({
    repo: 'o/r',
    repoSource: '--repo',
    write: false,
    json: false,
    cursor: null,
    maxCards: DEFAULT_MAX_CARDS,
    batchSize: DEFAULT_BATCH_SIZE,
    batchPauseMs: 0,
    listCap: 25,
    provenance: '',
    ...over,
  });

  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => { openBattery = name; };
  const cases = [];
  const t = (name, ok, detail) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    cases.push({ name, ok: Boolean(ok), detail });
  };

  const CARD = (over = {}) => ({
    number: 100,
    title: 'a card',
    state: 'open',
    html_url: 'https://github.com/o/r/issues/100',
    labels: [{ name: 'finding' }, { name: 'pm:queue' }, { name: 'domain:skills' }, { name: 'priority:p3' }],
    ...over,
  });
  const L = (...names) => ({ labels: names.map((name) => ({ name })) });

  // -- the grading vocabulary ------------------------------------------------
  battery('the grading vocabulary is derived from H13, never restated');
  t('every grading state comes from the IMPORTED vocabulary', GRADING_STATE_LABELS.every((l) => PM_STATE_LABELS.includes(l)));
  t('and it is exactly the six the card names', GRADING_STATE_LABELS.join(',') === 'pm:queue,pm:dispatched,pm:blocked,pm:on-hold,pm:awaiting-maintainer,needs-user-decision');
  t('⛔ `finding` is not its own trigger', !GRADING_STATE_LABELS.includes(TARGET_LABEL));
  t('⛔ `pm:seat` is not a grade — a registry post is not a position in the grading flow', !GRADING_STATE_LABELS.includes('pm:seat'));
  t('⛔ `pm:epic` is not a grade either — it says what a card IS', !GRADING_STATE_LABELS.includes('pm:epic'));
  t('a priority is a grade, in every spelling the board uses', priorityLabelsIn(['priority:p0', 'priority:p3']).length === 2);
  t('⛔ and `priority-ish` prose is not a priority label', priorityLabelsIn(['priorities', 'priority', 'prioritypX']).length === 0);

  // -- the screen ------------------------------------------------------------
  battery('the screen: what is stale, and what is deliberately left');
  t('`finding` + `pm:queue` is STALE — the ruled case', screenCard(CARD(L('finding', 'pm:queue'))).verdict === 'stale');
  t('…and the row NAMES the trigger that put it in the set', screenCard(CARD(L('finding', 'pm:queue'))).triggers.join() === 'pm:queue');
  t('`finding` + `priority:p3` is STALE, with no state at all — a card carrying a priority has been read', screenCard(CARD(L('finding', 'priority:p3'))).verdict === 'stale');
  t('…and its trigger is the priority', screenCard(CARD(L('finding', 'priority:p3'))).triggers.join() === 'priority:p3');
  t('⛔ `finding` ALONE is NOT stale — that is the pool the index exists for', screenCard(CARD(L('finding'))).verdict === 'leave');
  t('…and it is reported as ungraded rather than skipped silently', screenCard(CARD(L('finding'))).kind === 'ungraded');
  t('⛔ a `pm:seat` post is NEVER touched, whatever else it carries', screenCard(CARD(L('finding', 'pm:seat', 'priority:p1'))).verdict === 'skip');
  t('…and the row says why', String(screenCard(CARD(L('finding', 'pm:seat'))).detail).includes('pm:seat'));
  t('a CLOSED card is not swept — a closed board is an archive, not an index', screenCard(CARD({ state: 'closed', ...L('finding', 'pm:queue') })).kind === 'not-open');
  t('a pull request row that slipped into the listing is not a card', screenCard(CARD({ pull_request: {}, ...L('finding', 'pm:queue') })).kind === 'pull-request');
  t('a card without the target label is not this sweep\'s business', screenCard(CARD(L('pm:queue', 'priority:p2'))).kind === 'no-target-label');

  // -- the four-step write ---------------------------------------------------
  battery('the four-step write: the plan, the read-back and its refusal');
  const plan = planStrip(['finding', 'pm:queue', 'domain:skills', 'priority:p3']);
  t('STEP 2 computes the written set as the read set MINUS the target', plan.act && plan.target.join() === 'pm:queue,domain:skills,priority:p3');
  t('…so every other label is re-passed verbatim, in the order the card carried them', plan.target.includes('domain:skills') && plan.target.includes('priority:p3'));
  t('⛔ the plan is re-judged on the FRESH read: a card already stripped is not written to', planStrip(['pm:queue', 'domain:skills']).act === false);
  t('…and says so', planStrip(['pm:queue']).kind === 'already-clean');
  t('⛔ a card whose grade came off since the listing is not written to either', planStrip(['finding']).kind === 'no-longer-graded');
  t('⛔ nor is one that acquired `pm:seat` since the listing', planStrip(['finding', 'pm:seat', 'priority:p1']).kind === 'never-swept');
  t('STEP 4 accepts a read-back equal to what was written', readBackDiff(['a', 'b'], ['a', 'b']).ok === true);
  t('⛔ a read-back still carrying the target is a removal that did not land', readBackDiff(['a'], ['a', 'finding']).stillTarget === true);
  t('⛔ a label this sweep re-passed that is now gone is a MISMATCH, not a rounding error', readBackDiff(['a', 'b'], ['a']).missing.join() === 'b');
  t('⛔ a label that appeared underneath the write is a mismatch too', readBackDiff(['a'], ['a', 'tooling']).added.join() === 'tooling');
  t('…and the refusal says it is LEFT ALONE, never re-written', readBackRefusal(7, readBackDiff(['a'], ['a', 'tooling'])).includes('LEFT ALONE'));
  t('the refusal names the card and says why the run stops', readBackRefusal(7, readBackDiff(['a'], ['a', 'x'])).includes('#7') && readBackRefusal(7, readBackDiff(['a'], ['a', 'x'])).includes('stops here'));
  // ⛔ The whole-set replace is banned repo-wide (`check-whole-set-label-write`),
  // and this file is in that gate's scanned root. Pinned here too, positively:
  // the verbs this file issues are named, so a new one has to be declared.
  const verbs = [...new Set([...readFileSync(SELF_PATH, 'utf8').matchAll(/method\s*[:=]\s*'([A-Z]+)'/g)].map((m) => m[1]))].sort();
  t('⛔ the only verbs this file issues are the read and the one-label subtraction', verbs.join() === 'DELETE,GET', `verbs: ${verbs.join()}`);

  // -- the listing, the cursor and the caps ----------------------------------
  battery('the listing, the cursor and the caps');
  t('the listing is scoped to OPEN cards', listingPath('o/r', 1).includes('state=open'));
  t('it filters on the one label, URL-encoded', listingPath('o/r', 1).includes('labels=finding'));
  t('one label per request — a multi-label query is an AND and answers a different question', (listingPath('o/r', 1).match(/labels=/g) ?? []).length === 1);
  t('it is repo-relative, keeping this file repo-agnostic', listingPath('o/r', 2).startsWith('/repos/o/r/issues?'));
  t('it carries the page it was asked for, at 100 rows', listingPath('o/r', 7).includes('page=7') && listingPath('o/r', 7).includes('per_page=100'));
  t('a stop prints a cursor a caller can paste', resumeHint(17_534) === '--cursor=17534');
  t('403 stops the run', isStopStatus(403) === true);
  t('429 stops the run', isStopStatus(429) === true);
  t('⛔ and a 502 does not — it is a bad read on one card, not a limit on the identity', isStopStatus(502) === false);

  // -- the exit register -----------------------------------------------------
  battery('the exit register: nothing to do is never an alarm');
  t('a run that judged nothing at all exits 0', summariseRun([]).exitCode === EXIT_OK);
  t('a dry run that found stale cards exits 0 — finding them is the job', summariseRun([{ verdict: 'stale' }]).exitCode === EXIT_OK);
  t('a run that left the ungraded pool alone exits 0', summariseRun([{ verdict: 'leave' }]).exitCode === EXIT_OK);
  t('one unjudged card moves the exit to 2', summariseRun([{ verdict: 'stale' }, { verdict: 'unjudged' }]).exitCode === EXIT_UNJUDGED);
  t('an early stop outranks it: the run did not finish', summariseRun([{ verdict: 'unjudged' }], { stopped: { number: 1 } }).exitCode === EXIT_STOPPED);
  t('the counts a reader is given match the rows', summariseRun([{ verdict: 'stale', removed: ['finding'] }, { verdict: 'leave' }]).counts.stripped === 1);
  t('a stale card that was never written to does not count as stripped', summariseRun([{ verdict: 'stale' }]).counts.stripped === 0);

  // -- the CLI ---------------------------------------------------------------
  battery('the CLI: the two decisions a typo must never make');
  t('the default is a DRY RUN — writing is something a caller has to ask for', parseOptions([]).options.write === false);
  t('`--write` is the ask, and it is exact', parseOptions(['--write']).options.write === true);
  t('`--dry-run` is a real flag, so a caller can name the mode it is in', parseOptions(['--dry-run']).options.write === false);
  t('⛔ the two mode flags together are a refusal, not a precedence rule', parseOptions(['--write', '--dry-run']).ok === false);
  t('⛔ an unrecognised argument is REFUSED — a caller who thinks it passed a mode flag and did not is the failure this closes', parseOptions(['--wirte']).ok === false);
  t('…and the refusal names the arguments that do exist', String(parseOptions(['--nope']).error).includes('--cursor'));
  t('`--repo owner/name` is the ruled spelling and it parses', parseOptions(['--repo', 'objectstack-ai/objectui']).options.repo === 'objectstack-ai/objectui');
  t('`--repo=owner/name` parses too', parseOptions(['--repo=objectstack-ai/objectui']).options.repo === 'objectstack-ai/objectui');
  t('⛔ a malformed board is REFUSED, never replaced by the default — that is a sweep of the wrong repo', parseOptions(['--repo=not-a-repo']).ok === false);
  t('⛔ and a malformed board from the ENVIRONMENT is refused the same way', parseOptions([], { env: { PM_SWEEP_REPO: 'nope' } }).ok === false);
  t('with no flag the board comes from the environment, and the source is reported', parseOptions([], { env: { GITHUB_REPOSITORY: 'o/r' } }).options.repoSource === 'GITHUB_REPOSITORY');
  t('a bad cap, batch or cursor is refused rather than rounded to something safe-looking',
    parseOptions(['--max-cards=0']).ok === false && parseOptions(['--batch-size=x']).ok === false && parseOptions(['--cursor=0']).ok === false);

  // -- the run: a dry run writes NOTHING -------------------------------------
  battery('the run, driven offline: a dry run writes NOTHING');
  const dryBoard = fakeBoard({
    cards: new Map([
      [1, { labels: ['finding', 'pm:queue', 'domain:skills'] }],
      [2, { labels: ['finding', 'priority:p3'] }],
      [3, { labels: ['finding'] }],
      [4, { labels: ['finding', 'pm:seat'] }],
      [5, { labels: ['pm:queue'] }],
    ]),
  });
  const dry = await sweep('o/r', OPTIONS(), { rest: dryBoard.rest, sleep: async () => {} });
  t('the stale set is the two graded carriers', dry.stale === 2);
  t('the ungraded carrier is LEFT and counted', summariseRun(dry.rows).counts.left === 1);
  t('the seat post is skipped', dry.rows.find((r) => r.number === 4).kind === 'never-swept');
  t('⛔ the write-path spy sees NO write of any kind', dryBoard.calls.every((c) => c.method === 'GET'));
  t('⛔ and no per-card label read either — a dry run costs one listing and the rate readings', dryBoard.calls.every((c) => !/issues\/\d+\/labels/.test(c.path)));
  t('the quota is read at the start and the end even when nothing is written', dry.rateReadings.length === 2 && dry.rateReadings[0].when === 'run-start');

  // -- the run: the write, the stop and the cursor ---------------------------
  battery('the run, driven offline: the write, the stop and the cursor');
  const writeBoard = fakeBoard({
    cards: new Map([
      [11, { labels: ['finding', 'pm:queue', 'domain:skills'] }],
      [12, { labels: ['finding', 'priority:p2', 'bug'] }],
      [13, { labels: ['finding'] }],
    ]),
  });
  let slept = 0;
  const wrote = await sweep('o/r', OPTIONS({ write: true, batchSize: 1, batchPauseMs: 5 }), {
    rest: writeBoard.rest,
    sleep: async () => { slept += 1; },
  });
  const del11 = writeBoard.calls.find((c) => c.method !== 'GET' && c.path.includes('/11/'));
  t('the write NAMES one label and cannot rewrite the set', del11.method === 'DELETE' && del11.path.endsWith('/labels/finding'));
  t('…and it carries no body at all — there is no set to send', del11.body === null || del11.body === undefined);
  t('⛔ no request this run issued could replace a whole label set', writeBoard.calls.every((c) => c.method === 'GET' || c.method === 'DELETE'));
  t('every acted card is read BEFORE the write and read BACK after it — four steps, two reads',
    writeBoard.calls.filter((c) => c.method === 'GET' && c.path.includes('/11/labels')).length === 2);
  t('the ungraded card is never written to', !writeBoard.calls.some((c) => c.method !== 'GET' && c.path.includes('/13/')));
  t('the run reports what it removed, per card', wrote.rows.find((r) => r.number === 11).removed.join() === 'finding');
  t('the board really changed underneath the fake transport', !writeBoard.state.get(11).labels.includes('finding'));
  t('…and every survivor is still on it, untouched', writeBoard.state.get(11).labels.join() === 'pm:queue,domain:skills');
  t('batches bracket the quota: one reading before and one after each', wrote.rateReadings.filter((r) => r.when.endsWith('-before')).length === 2);
  t('…and the batches are separated by a pause', slept === 1);
  t('a clean write run exits 0', summariseRun(wrote.rows, { stopped: wrote.stopped }).exitCode === EXIT_OK);

  const stopBoard = fakeBoard({
    cards: new Map([
      [21, { labels: ['finding', 'pm:queue'] }],
      [22, { labels: ['finding', 'pm:queue'] }],
      [23, { labels: ['finding', 'pm:queue'] }],
    ]),
    failOn: (path, method) => {
      if (method !== 'DELETE' || !path.includes('/22/')) return null;
      const err = new Error('DELETE /repos/o/r/issues/22/labels/finding -> HTTP 403');
      err.status = 403;
      err.retryAfter = '60';
      return err;
    },
  });
  const stopped = await sweep('o/r', OPTIONS({ write: true, batchSize: 10, batchPauseMs: 0 }), { rest: stopBoard.rest, sleep: async () => {} });
  t('⛔ the FIRST 403 stops the run where it stands', stopped.stopped?.number === 22);
  t('⛔ and the card after it is never touched — no retry loop, no carrying on', !stopBoard.calls.some((c) => c.path.includes('/23/')));
  const stopText = renderRun(stopped, OPTIONS({ write: true })).text;
  t('the report prints the resume cursor', stopText.includes('--cursor=22'));
  t('…and the stop exits 4, not 0', renderRun(stopped, OPTIONS({ write: true })).exitCode === EXIT_STOPPED);

  const racedBoard = fakeBoard({
    cards: new Map([[31, { labels: ['finding', 'pm:queue'] }], [32, { labels: ['finding', 'pm:queue'] }]]),
    afterWrite: (number, state) => { state.set(number, { labels: [...state.get(number).labels, 'tooling'] }); },
  });
  const raced = await sweep('o/r', OPTIONS({ write: true, batchSize: 10, batchPauseMs: 0 }), { rest: racedBoard.rest, sleep: async () => {} });
  t('⛔ a read-back that differs from what was written REFUSES to proceed', raced.stopped?.reason === 'read-back-mismatch');
  t('…on the first card, so the second is never written to', !racedBoard.calls.some((c) => c.method !== 'GET' && c.path.includes('/32/')));
  t('…and the label that appeared is reported, never re-written away', String(raced.rows.find((r) => r.number === 31).detail).includes('tooling'));

  // -- the report ------------------------------------------------------------
  battery('the report: what a reader is told, and what it refuses to imply');
  const dryText = renderRun(dry, OPTIONS()).text;
  t('a dry run says so in its first line — no reader should have to infer it', dryText.split('\n')[0].includes('DRY RUN'));
  t('the board it read is named in that same line', dryText.split('\n')[0].includes('o/r'));
  t('the stale predicate is stated, not left to the reader to reconstruct', dryText.includes('priority:*'));
  t('the rate readings are printed, both of them', (dryText.match(/rate_limit \[/g) ?? []).length === 2);
  t('the ungraded pool is shown as LEFT ALONE rather than omitted', dryText.includes('UNGRADED'));
  t('the stale rows name their trigger', dryText.includes('#1 [pm:queue]'));
  t('⛔ the report carries no angle-bracket-shaped fragment for GitHub\'s body sanitizer to eat — it is meant to be pasted onto a card',
    !/[<>]/.test(dryText));
  const doc = renderJson(dry, OPTIONS());
  t('the JSON summary carries the counts, the caps, the readings and every card',
    doc.stale === 2 && doc.caps.max_cards === DEFAULT_MAX_CARDS && doc.rate_readings.length === 2 && doc.cards.length === 5);

  // -- the floor -------------------------------------------------------------
  const floorFailure = (message) => { cases.push({ name: message, ok: false }); };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  let breached = false;
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    breached = true;
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    breached = true;
    floorFailure(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    breached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (breached) floorFailure('A battery at or below its floor means cases STOPPED RUNNING — find what stopped registering and restore it.');

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ sweep-stale-finding self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ sweep-stale-finding self-test: ${cases.length} cases pass across ${declared.length} batteries ` +
      '(the derived grading vocabulary, the screen with the ungraded pool and the seat post it refuses to touch, ' +
      'the four-step write and the read-back refusal, the caps and the cursor, the exit register, the CLI, ' +
      'and the run itself driven offline — a dry run that writes nothing, a write that reads back, a 403 that ' +
      'stops with a cursor, and a raced read-back that refuses to proceed).',
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = await selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ sweep-stale-finding self-test: selfTest() returned without reaching its verdict, so no\n' +
          'success line was printed. Exiting 0 here would report a self-test that never finished as\n' +
          'a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  } else {
    const rearmed = rearmThroughProxy(process.argv.slice(2));
    if (rearmed !== null) process.exit(rearmed);
    main(process.argv.slice(2)).then((code) => process.exit(code));
  }
}
