#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * board-snapshot — a scheduled, read-only backup of the board (#17390).
 *
 *   node scripts/pm/board-snapshot.mjs --out=archive/board     # snapshot (incremental)
 *   node scripts/pm/board-snapshot.mjs --out=archive/board --full
 *   node scripts/pm/board-snapshot.mjs --out=archive/board --restore=17297
 *   node scripts/pm/board-snapshot.mjs --self-test             # offline, no network, no token
 *
 * ## Why this exists, measured rather than supposed
 *
 * Three fleet accounts were suspended in two months. #17374 F3 measured what a
 * suspension destroys: every issue, pull request and comment the account
 * authored — while every branch and commit survives, because those belong to
 * the repository and not to a user. The board IS the fleet's state by rule
 * (pm-dispatch SKILL.md, 全体座位的不变量: 「GitHub 之外永不维护任何跟踪状态」),
 * so one suspension erases state that nothing else holds. Six cards — #17297
 * (a p1 security decision), #17128, #17150, #17276, #17313, #17318 — are gone.
 *
 * ## The one-board rule this obeys, and how it obeys it
 *
 * An ARCHIVE IS NOT A TRACKER. Nothing reads this snapshot for state: no seat,
 * no patrol, no gate, no query. The board stays the single source of truth and
 * every reading of it still goes to GitHub. What this tool produces is a
 * write-once backup that answers exactly one question, after a loss: what did
 * the record say? That is why:
 *
 *   - it has NO write path to GitHub at all — no POST, no PATCH, no DELETE, in
 *     any mode. `--restore` PRINTS a payload; a seat posts it, or nobody does;
 *   - the archive lives on an orphan branch (`board-archive`) of this same
 *     repository — no second repo, no second credential, and it is a branch, so
 *     it survives the suspension that destroys the records;
 *   - the manifest records what the run READ, never what any seat should do.
 *
 * ## Layout — one file per number, so a diff reads like a board
 *
 *   <out>/issues/<n>.json      the issue or pull request record (stable key order)
 *   <out>/comments/<n>.jsonl   its comment thread, one JSON object per line, id-ordered
 *   <out>/reviews/<n>.jsonl    pull requests only: reviews and review comments,
 *                              each line discriminated by its `record` field
 *   <out>/manifest.json        the run stamp, the `since` used, counts by state,
 *                              the board's own `open_issues_count` read in the
 *                              same run, the request count, and the resume cursor
 *   <out>/gone.json            hand-written: numbers known to be destroyed or
 *                              transferred, so the count check below can stay a
 *                              real alarm instead of a permanent red
 *
 * Every record is built key by key in a fixed order and every list is sorted, so
 * two runs over an unchanged board produce byte-identical files and the branch's
 * history is a diff of what actually changed on the board.
 *
 * ## Incremental, and the two things that makes exact
 *
 * A run reads `since` from the previous manifest (`next_since`, or `resume.since`
 * when the previous run stopped early) and asks the listing endpoint for
 * everything updated at or after it. The first run has no manifest and is full.
 *
 * **The page walk never trusts `Link: rel="next"`.** The REST channel table
 * records the measurement: cursor-following stopped at 102 rows where the page
 * walk found 287 and 448, and the enumerations that were wrong looked exactly
 * like the ones that were right. So this walks `&page=N` until a SHORT page
 * (fewer rows than `per_page`) ends it, and nothing else ends it.
 *
 * **The walk re-anchors on a VALUE, never on an offset.** Ascending by
 * `updated_at`, an item that is updated mid-walk moves to the end of the
 * ordering and shifts every row behind it one slot forward — so the row that
 * was about to be the first of page k+1 lands at the last slot of page k, which
 * this run has already read past. Blind `page += 1` skips it PERMANENTLY: its
 * own `updated_at` never moved, so no later `since` window contains it either.
 * `nextWalkStep()` therefore sets `since` to the last row's `updated_at` and
 * returns to page 1 whenever that value advances, and increments the page only
 * when a whole page shares one timestamp (which is the only case an offset is
 * needed for). `since` is inclusive, so the boundary rows are re-read and
 * re-written identically — an over-read, which is the safe direction.
 *
 * ## Rate discipline — stop with a cursor, never retry in a loop
 *
 * The workflow's `GITHUB_TOKEN` is budgeted at 1,000 requests/hour PER
 * REPOSITORY. A first full snapshot of this board (~600 open issues and several
 * thousand closed ones, each with a comment thread) does not fit one run and
 * must not try: `--max-requests` stops the run cleanly, writes the manifest with
 * a `resume` cursor and exits 0, and the next scheduled run continues from that
 * cursor. Four runs a day walk the backlog in a few days without ever exceeding
 * the budget.
 *
 * A real rate-limit signal from GitHub (403/429 with the remaining count at
 * zero) is different and is NOT a planned pause: the run stops, writes the same
 * resume cursor, prints the reset time and exits `EXIT_RATE_LIMITED`. ⛔ It
 * never sleeps and never retries the request — a loop against a zero budget is
 * how one repository's automation starves every other caller of that budget.
 *
 * ## The count check, and why a mismatch is red rather than a warning
 *
 * `rest-channel.md`: an enumeration without a count check is not a reading. So
 * every run censuses the archive on disk and compares the open-issue count with
 * the board's own `open_issues_count` minus the open pull requests, both read in
 * the same run.
 *
 *   SHORTFALL (the archive holds fewer)  the enumeration missed cards. This is
 *                                        the failure the rule exists for.
 *   SURPLUS   (the archive holds more)   the board no longer carries records
 *                                        this archive does — the destruction
 *                                        signature this tool was built for.
 *                                        `--restore` prints them back; a number
 *                                        deliberately left destroyed (or moved
 *                                        to another repo) goes in `gone.json`,
 *                                        which is the ONLY way to quiet it.
 *
 * Both are non-zero exits. A partial archive (a first snapshot still resuming)
 * makes the check `pending` instead — the census is not yet a reading, and
 * reporting `pending` is what keeps "could not check" apart from "checked and
 * clean" (#4690).
 *
 * ## Heartbeat
 *
 * ⚠️ Unlike the half-state patrol, this run does NOT refresh a timestamp when
 * nothing changed — idempotence is the card's requirement and a per-run no-op
 * commit would bury the real diffs. The liveness signal is therefore the Actions
 * run history and each run's job summary, NOT the archive. A reader asking "is
 * the backup alive?" reads the workflow, never the branch.
 *
 * ## Adopting this in a sibling repo
 *
 * Copy FOUR files, unchanged — this one, `.github/workflows/board-snapshot.yml`,
 * `scripts/pm/check-half-states.mjs` (the proxy re-exec plan and the repo
 * resolver are imported from it, so a three-file copy installs an archiver that
 * cannot start) and `scripts/invoked-as.mjs` (imported by both). A repo that has
 * already adopted the half-state patrol has the last two. ⛔ Do not shorten this
 * list from memory: the imports below decide it, not this comment.
 *
 * There is no configuration. The board archived is `github.repository`, passed
 * explicitly by the workflow — and this script REFUSES the default repository
 * its resolver would otherwise fall back to, because a copy that quietly
 * archived the repo it was copied FROM would produce a complete, well-formed,
 * green archive of the wrong board.
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import { EXIT_PREREQUISITE_NOT_MET, PROXY_FLAG, labelNames, proxyRearmPlan, resolveSweepRepo } from './check-half-states.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_COUNT_MISMATCH = 2;
// 3 is EXIT_PREREQUISITE_NOT_MET, imported so the register is one register.
export const EXIT_RATE_LIMITED = 4;

/**
 * The re-exec guard, per script rather than shared with its neighbours: two
 * scripts sharing one guard name means the first one's re-exec silently
 * disarms the second's when they run in the same process tree.
 */
const PROXY_REARM_GUARD = 'OS_BOARD_SNAPSHOT_PROXY_REARMED';

/** The archive format. Bump it when a record's shape changes; the manifest carries it. */
export const ARCHIVE_SCHEMA = 1;

/** Rows per listing page. GitHub's ceiling, and the short-page test's threshold. */
export const PER_PAGE = 100;

/**
 * The per-run request budget. The workflow token's limit is 1,000/hour per
 * repository and this run is not the only caller of it (the half-state patrol
 * and the closed-card sweep share the same budget), so the default leaves room.
 *
 * ⛔ Raising this is not a tuning decision. A run that exceeds the budget does
 * not fail alone: it takes every other automated caller in the repository down
 * with it for the rest of the hour.
 */
export const DEFAULT_MAX_REQUESTS = 800;

/** Where a run writes when `--out` is not given. */
export const DEFAULT_OUT_DIR = 'board';

export const MANIFEST_NAME = 'manifest.json';
export const GONE_LEDGER_NAME = 'gone.json';

// ---------------------------------------------------------------------------
// Pure core — every function below is offline and is what `--self-test` pins.
// ---------------------------------------------------------------------------

/** One JSON document, pretty-printed and newline-terminated. Key order is the caller's. */
export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** JSONL: one record per line, in the order given, newline-terminated. */
export function stableJsonl(records) {
  if (!records?.length) return '';
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

/**
 * An actor, reduced to what survives the account being destroyed: the login is
 * the only handle a rebuilt record can name, and it is exactly what GitHub stops
 * answering for once the account is gone.
 */
export function actorRecord(user) {
  if (!user) return null;
  return { login: user.login ?? null, id: user.id ?? null, type: user.type ?? null };
}

/**
 * The archived shape of one issue or pull request.
 *
 * ⚠️ `closed_by` is DECLARED ABSENT rather than silently missing: the listing
 * endpoint does not carry it (only `GET /issues/{n}` does), and buying it would
 * cost one extra request per archived number — which is the whole budget, spent
 * on a field no restore needs. The key is present and `null` so a reader can
 * tell "not carried by this archive" from "nobody closed it".
 */
export function issueRecord(raw) {
  const isPull = Boolean(raw.pull_request);
  return {
    number: raw.number,
    kind: isPull ? 'pull_request' : 'issue',
    title: raw.title ?? null,
    state: raw.state ?? null,
    state_reason: raw.state_reason ?? null,
    draft: isPull ? Boolean(raw.draft) : null,
    author: actorRecord(raw.user),
    labels: labelNames(raw).filter(Boolean).slice().sort(),
    assignees: (raw.assignees ?? []).map((a) => a?.login).filter(Boolean).slice().sort(),
    milestone: raw.milestone ? { number: raw.milestone.number ?? null, title: raw.milestone.title ?? null, state: raw.milestone.state ?? null } : null,
    type: raw.type?.name ?? null,
    created_at: raw.created_at ?? null,
    updated_at: raw.updated_at ?? null,
    closed_at: raw.closed_at ?? null,
    closed_by: actorRecord(raw.closed_by),
    merged_at: isPull ? (raw.pull_request?.merged_at ?? null) : null,
    comments: raw.comments ?? 0,
    locked: Boolean(raw.locked),
    html_url: raw.html_url ?? null,
    body: raw.body ?? null,
  };
}

/** The archived shape of one issue comment. */
export function commentRecord(raw) {
  return {
    id: raw.id,
    author: actorRecord(raw.user),
    created_at: raw.created_at ?? null,
    updated_at: raw.updated_at ?? null,
    html_url: raw.html_url ?? null,
    body: raw.body ?? null,
  };
}

/**
 * The archived shape of one review or review comment. The `record` field is the
 * discriminator: both families share one file per number, and a reader must
 * never have to infer which one a line is from the keys it happens to carry.
 */
export function reviewRecord(raw, kind) {
  return {
    record: kind,
    id: raw.id,
    author: actorRecord(raw.user),
    state: raw.state ?? null,
    path: raw.path ?? null,
    created_at: raw.created_at ?? raw.submitted_at ?? null,
    updated_at: raw.updated_at ?? null,
    html_url: raw.html_url ?? null,
    body: raw.body ?? null,
  };
}

/** Records sorted by id, so a re-fetch in a different order is not a diff. */
export function byId(records) {
  return records.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/** The archive paths one number owns. */
export function issuePath(outDir, number) {
  return join(outDir, 'issues', `${number}.json`);
}
export function commentsPath(outDir, number) {
  return join(outDir, 'comments', `${number}.jsonl`);
}
export function reviewsPath(outDir, number) {
  return join(outDir, 'reviews', `${number}.jsonl`);
}

/**
 * One page of the board, oldest update first.
 *
 * `state=all` is the point — a closed card is exactly what a suspension
 * destroys, and every census, patrol and mutex query on the live board forces
 * `state:open`, so the closed half has no other reader at all.
 */
export function listingPath(repo, { since = null, page = 1, perPage = PER_PAGE } = {}) {
  const query = [
    'state=all',
    'sort=updated',
    'direction=asc',
    ...(since ? [`since=${encodeURIComponent(since)}`] : []),
    `per_page=${perPage}`,
    `page=${page}`,
  ].join('&');
  return `/repos/${repo}/issues?${query}`;
}

/** One page of the open pull requests — the right-hand side of the count check. */
export function openPullsPath(repo, { page = 1, perPage = PER_PAGE } = {}) {
  return `/repos/${repo}/pulls?state=open&per_page=${perPage}&page=${page}`;
}

/**
 * Where the walk goes after a page. The completeness rule and the anti-skip
 * rule, in one place, offline, so `--self-test` can hold both.
 *
 * `done` is decided by the SHORT PAGE and by nothing else — never by a `Link`
 * header, never by "the rows look old enough".
 */
export function nextWalkStep({ batchLength, lastUpdatedAt, since, page, perPage = PER_PAGE }) {
  if (batchLength < perPage) {
    return { done: true, since: lastUpdatedAt ?? since, page, reanchored: false };
  }
  if (lastUpdatedAt && lastUpdatedAt !== since) {
    // Re-anchor on the VALUE. Page 1 again, so a row that shifted forward while
    // this run was reading cannot fall through the gap an offset would leave.
    return { done: false, since: lastUpdatedAt, page: 1, reanchored: true };
  }
  // A whole page sharing one timestamp: the offset is the only way past it.
  return { done: false, since, page: page + 1, reanchored: false };
}

/**
 * The `since` this run reads from, and the reason — printed, so a run that
 * silently became full (or silently stayed incremental) cannot be mistaken for
 * the other one.
 */
export function selectSince(manifest, { full = false, override = null } = {}) {
  if (override) return { since: override, reason: `--since=${override} given on the command line` };
  if (full) return { since: null, reason: '--full: the whole board, ignoring the previous manifest' };
  if (!manifest) return { since: null, reason: 'no previous manifest — the first run is full' };
  if (manifest.resume?.since) return { since: manifest.resume.since, reason: `resuming the previous run at ${manifest.resume.since}` };
  if (manifest.next_since) return { since: manifest.next_since, reason: `incremental from the previous run's next_since (${manifest.next_since})` };
  return { since: null, reason: 'the previous manifest carries no cursor — falling back to a full read' };
}

/**
 * The count check. `expected` is the board's own arithmetic; `archived` is a
 * census of files on disk. `pending` is a third answer and not a pass: a
 * snapshot still resuming has not enumerated the board yet, so its census says
 * nothing about completeness in either direction.
 */
export function countCheck({ openIssuesCount, openPullRequests, archivedOpenIssues, gone = [], resuming = false }) {
  const expected = Number(openIssuesCount ?? 0) - Number(openPullRequests ?? 0);
  const goneOpen = new Set(gone ?? []);
  const archived = Number(archivedOpenIssues ?? 0);
  const shortfall = Math.max(0, expected - archived);
  const surplus = Math.max(0, archived - expected - goneOpen.size);
  if (resuming) {
    return { verdict: 'pending', expected, archived, shortfall: null, surplus: null, gone_ledger: goneOpen.size, ok: null };
  }
  const ok = shortfall === 0 && surplus === 0;
  return { verdict: ok ? 'ok' : shortfall > 0 ? 'shortfall' : 'surplus', expected, archived, shortfall, surplus, gone_ledger: goneOpen.size, ok };
}

/**
 * The manifest, minus the three fields that move on every run whether or not
 * anything changed. Comparing THIS is what makes "no change ⇒ no write" real:
 * a run stamp is a fact about the run, not about the board.
 */
export function materialManifest(manifest) {
  if (!manifest) return null;
  const { generated_at: _stamp, requests: _requests, run: _run, ...rest } = manifest;
  return rest;
}

/** Did anything about the BOARD change between these two manifests? */
export function manifestChanged(previous, next) {
  if (!previous) return true;
  return stableJson(materialManifest(previous)) !== stableJson(materialManifest(next));
}

/** The manifest this run would write, built key by key so the file is diff-stable. */
export function buildManifest({
  repo,
  generatedAt,
  since,
  sinceReason,
  nextSince,
  resume,
  counts,
  board,
  check,
  requests,
  run,
}) {
  return {
    schema: ARCHIVE_SCHEMA,
    repo,
    generated_at: generatedAt,
    since: since ?? null,
    since_reason: sinceReason,
    next_since: nextSince ?? null,
    resume: resume ?? null,
    counts,
    board,
    count_check: check,
    requests,
    run,
  };
}

// ---------------------------------------------------------------------------
// The archive on disk — read, census, write. No network in this section.
// ---------------------------------------------------------------------------

/** A JSON file, or `null` when it is absent or unreadable. Absence is a normal answer here. */
export function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** The numbers a seat has declared destroyed or moved, so the surplus alarm can stay one. */
export function readGoneLedger(outDir) {
  const raw = readJsonFile(join(outDir, GONE_LEDGER_NAME));
  if (!raw) return [];
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw.numbers) ? raw.numbers : [];
  return rows.map((r) => Number(typeof r === 'object' ? r?.number : r)).filter((n) => Number.isInteger(n));
}

/**
 * A census of the archive as it stands on disk — counts by state and by kind.
 *
 * Read from the FILES, never accumulated across runs: an accumulated counter
 * drifts from what is actually stored, and the count check would then be
 * comparing the board with a number this tool made up.
 */
export function censusArchive(outDir) {
  const counts = { issues_open: 0, issues_closed: 0, pulls_open: 0, pulls_closed: 0, records: 0 };
  let names = [];
  try {
    names = readdirSync(join(outDir, 'issues'));
  } catch {
    return counts;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const record = readJsonFile(join(outDir, 'issues', name));
    if (!record) continue;
    counts.records += 1;
    const pull = record.kind === 'pull_request';
    const open = record.state === 'open';
    if (pull && open) counts.pulls_open += 1;
    else if (pull) counts.pulls_closed += 1;
    else if (open) counts.issues_open += 1;
    else counts.issues_closed += 1;
  }
  return counts;
}

/**
 * Write `text` at `path` only if the bytes differ. Returns whether it wrote.
 *
 * The rename is what makes a run interruptible without corrupting the archive:
 * a run killed by the job timeout leaves either the old file or the new one,
 * never half of either.
 */
export function writeIfChanged(path, text, { dryRun = false } = {}) {
  let existing = null;
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    existing = null;
  }
  if (existing === text) return false;
  if (dryRun) return true;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
  return true;
}

/**
 * Apply a whole run's writes. `files` is a Map of path to contents; the return
 * value is the paths that actually moved, so "nothing changed" is a measured
 * fact and not an assumption the caller makes about its own inputs.
 */
export function applyWrites(files, { dryRun = false } = {}) {
  const written = [];
  for (const [path, text] of files) {
    if (writeIfChanged(path, text, { dryRun })) written.push(path);
  }
  return written.sort();
}

// ---------------------------------------------------------------------------
// --restore — prints, never posts
// ---------------------------------------------------------------------------

/**
 * The sentence a rebuilt record must carry (#17374 F3.4): a record that does not
 * say it is a rebuild is a forgery of the original, and the number it names is
 * the destroyed one rather than its own.
 */
export function provenanceSentence(runStamp) {
  return `rebuilt from the board snapshot at ${runStamp}; the original was destroyed with its author's account`;
}

/**
 * The recreate payload for one destroyed card: a provenance header, the original
 * body, the labels to re-apply, and the comment thread as a second block.
 *
 * ⛔ It carries no attribution footer. The comment channel appends its own, and
 * a footer shipped inside a body that a seat then posts is how a record ends up
 * with two.
 */
export function restorePayload({ issue, comments = [], runStamp, repo }) {
  const opened = issue.author?.login ? `@${issue.author.login}` : 'an account that no longer resolves';
  const closed = issue.closed_at ? `, ${issue.state}${issue.state_reason ? ` (${issue.state_reason})` : ''} at ${issue.closed_at}` : `, ${issue.state}`;
  const header = [
    `> **Rebuilt record — not the original.** Originally ${repo}#${issue.number}, opened by ${opened}`,
    `> at ${issue.created_at}, last updated ${issue.updated_at}${closed}.`,
    `> ${provenanceSentence(runStamp)}.`,
    '> The number above is the destroyed card; this card carries a new one.',
  ].join('\n');

  const labels = issue.labels?.length ? issue.labels.map((l) => `\`${l}\``).join(', ') : '(none)';
  const blocks = [
    header,
    '',
    issue.body?.trim() ? issue.body : '_(the archived body was empty)_',
    '',
    '---',
    '',
    `**Labels to re-apply:** ${labels}`,
    `**Assignees on the original:** ${issue.assignees?.length ? issue.assignees.map((a) => `@${a}`).join(', ') : '(none)'}`,
  ];

  const thread = [
    '',
    '---',
    '',
    `**Comment thread — ${comments.length} comment(s).** Post each as its own comment, not as part of the body.`,
    '',
  ];
  for (const [index, comment] of comments.entries()) {
    const who = comment.author?.login ? `@${comment.author.login}` : 'an account that no longer resolves';
    thread.push(`### Comment ${index + 1} — ${who} at ${comment.created_at}`, '', comment.body?.trim() ? comment.body : '_(empty)_', '');
  }

  return `${[...blocks, ...thread].join('\n').replace(/\n+$/, '')}\n`;
}

/** Read one number back out of the archive. Reads the directory and nothing else. */
export function readArchivedCard(outDir, number) {
  const issue = readJsonFile(issuePath(outDir, number));
  if (!issue) return { ok: false, error: `no archived record for #${number} at ${issuePath(outDir, number)}` };
  let comments = [];
  try {
    comments = readFileSync(commentsPath(outDir, number), 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch {
    comments = [];
  }
  return { ok: true, issue, comments };
}

// ---------------------------------------------------------------------------
// Live layer — the only section that touches the network, and it only READS.
// ---------------------------------------------------------------------------

/** A rate-limit stop. Carried as a type so the run can tell it from a transport failure. */
export class RateLimited extends Error {
  constructor(message, { resetAt = null, path = null } = {}) {
    super(message);
    this.name = 'RateLimited';
    this.resetAt = resetAt;
    this.path = path;
  }
}

/**
 * Is this refusal the budget, rather than a permission problem? GitHub answers
 * both 403 and 429 for a spent budget, and the discriminator is the remaining
 * count — a 403 with budget left is about the token, and retrying it is as
 * useless as retrying the other one is harmful.
 */
export function rateLimitStop({ status, remaining, retryAfter, reset }) {
  if (status !== 403 && status !== 429) return null;
  const spent = String(remaining ?? '') === '0';
  if (!spent && !retryAfter) return null;
  const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : retryAfter ? `${retryAfter}s from now` : 'unknown';
  return { resetAt };
}

/** The request counter every fetch in this run passes through. */
const requestCount = { value: 0 };

async function rest(path) {
  requestCount.value += 1;
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    const stop = rateLimitStop({
      status: res.status,
      remaining: res.headers.get('x-ratelimit-remaining'),
      retryAfter: res.headers.get('retry-after'),
      reset: res.headers.get('x-ratelimit-reset'),
    });
    if (stop) throw new RateLimited(`GET ${path} refused for the rate limit; it resets at ${stop.resetAt}`, { resetAt: stop.resetAt, path });
    const err = new Error(`GET ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Every page of one paginated read, walked to a short page. Never a `Link` header. */
async function readAllPages(makePath, { budget }) {
  const rows = [];
  for (let page = 1; ; page++) {
    budget.spend();
    const batch = await rest(makePath(page));
    const list = Array.isArray(batch) ? batch : [];
    rows.push(...list);
    if (list.length < PER_PAGE) return rows;
  }
}

/** The run's request budget. `spend()` throws the planned stop, which is not an error. */
class BudgetExhausted extends Error {}
function makeBudget(max) {
  return {
    max,
    get spent() {
      return requestCount.value;
    },
    spend() {
      if (requestCount.value >= max) throw new BudgetExhausted(`the per-run budget of ${max} requests is spent`);
    },
  };
}

/**
 * Everything one number owes the archive this run, as files. Comment and review
 * reads are skipped when the record says there is nothing to read — the listing
 * carries the comment count, and on this board most numbers spend zero requests
 * beyond the page they arrived on.
 */
async function collectNumber(repo, raw, outDir, { budget }) {
  const record = issueRecord(raw);
  const files = new Map();
  files.set(issuePath(outDir, record.number), stableJson(record));

  if (record.comments > 0) {
    const rows = await readAllPages((page) => `/repos/${repo}/issues/${record.number}/comments?per_page=${PER_PAGE}&page=${page}`, { budget });
    files.set(commentsPath(outDir, record.number), stableJsonl(byId(rows.map(commentRecord))));
  }

  if (record.kind === 'pull_request') {
    const reviews = await readAllPages((page) => `/repos/${repo}/pulls/${record.number}/reviews?per_page=${PER_PAGE}&page=${page}`, { budget });
    const reviewComments = await readAllPages((page) => `/repos/${repo}/pulls/${record.number}/comments?per_page=${PER_PAGE}&page=${page}`, { budget });
    const rows = [...byId(reviews.map((r) => reviewRecord(r, 'review'))), ...byId(reviewComments.map((r) => reviewRecord(r, 'review_comment')))];
    if (rows.length) files.set(reviewsPath(outDir, record.number), stableJsonl(rows));
  }

  return { record, files };
}

/**
 * The snapshot run.
 *
 * Every early exit — budget, rate limit — leaves the same two things behind: the
 * files already collected, and a `resume` cursor the next run continues from.
 * ⛔ There is no path here that retries a refused request.
 */
async function snapshot(repo, options) {
  const outDir = options.out;
  const previous = readJsonFile(join(outDir, MANIFEST_NAME));
  const picked = selectSince(previous, { full: options.full, override: options.since });
  const budget = makeBudget(options.maxRequests);

  const files = new Map();
  const seen = new Set();
  let since = picked.since;
  let page = 1;
  let cursor = picked.since;
  let stopped = null;
  let walkComplete = false;

  try {
    for (;;) {
      budget.spend();
      const batch = await rest(listingPath(repo, { since, page }));
      const rows = Array.isArray(batch) ? batch : [];
      for (const raw of rows) {
        if (seen.has(raw.number)) continue;
        if (options.limit && seen.size >= options.limit) {
          stopped = { kind: 'limit', reason: `--limit=${options.limit} reached` };
          break;
        }
        const collected = await collectNumber(repo, raw, outDir, { budget });
        for (const [path, text] of collected.files) files.set(path, text);
        seen.add(raw.number);
        cursor = collected.record.updated_at ?? cursor;
      }
      if (stopped) break;
      const step = nextWalkStep({ batchLength: rows.length, lastUpdatedAt: rows.at(-1)?.updated_at ?? null, since, page });
      if (step.done) {
        walkComplete = true;
        cursor = step.since ?? cursor;
        break;
      }
      since = step.since;
      page = step.page;
    }
  } catch (err) {
    if (err instanceof BudgetExhausted) stopped = { kind: 'budget', reason: err.message };
    else if (err instanceof RateLimited) stopped = { kind: 'rate-limit', reason: err.message, resetAt: err.resetAt };
    else throw err;
  }

  // The board's own arithmetic, read in THIS run so the two sides of the count
  // check describe one instant. Skipped when the run already stopped: spending
  // the last requests on a census of an archive that is knowingly partial buys
  // a reading nobody can use.
  let board = { open_issues_count: null, open_pull_requests: null, read_at: null };
  if (!stopped) {
    try {
      budget.spend();
      const meta = await rest(`/repos/${repo}`);
      const openPulls = await readAllPages((p) => openPullsPath(repo, { page: p }), { budget });
      board = { open_issues_count: meta?.open_issues_count ?? null, open_pull_requests: openPulls.length, read_at: new Date().toISOString() };
    } catch (err) {
      if (err instanceof BudgetExhausted) stopped = { kind: 'budget', reason: err.message };
      else if (err instanceof RateLimited) stopped = { kind: 'rate-limit', reason: err.message, resetAt: err.resetAt };
      else throw err;
    }
  }

  // Write the records BEFORE the manifest: a run that dies between the two
  // leaves an archive richer than its manifest claims, which the next run
  // repairs. The other order loses records and reports success.
  const written = applyWrites(files, { dryRun: options.dryRun });

  const resuming = Boolean(stopped);
  const counts = censusArchive(outDir);
  const gone = readGoneLedger(outDir);
  const check = countCheck({
    openIssuesCount: board.open_issues_count,
    openPullRequests: board.open_pull_requests,
    archivedOpenIssues: counts.issues_open,
    gone,
    resuming: resuming || board.open_issues_count === null,
  });

  const manifest = buildManifest({
    repo,
    generatedAt: new Date().toISOString(),
    since: picked.since,
    sinceReason: picked.reason,
    nextSince: resuming ? (previous?.next_since ?? null) : cursor,
    resume: resuming ? { since: cursor, stopped_by: stopped.kind, reason: stopped.reason, ...(stopped.resetAt ? { resets_at: stopped.resetAt } : {}) } : null,
    counts,
    board,
    check,
    requests: requestCount.value,
    run: { numbers_read: seen.size, files_written: written.length, walk_complete: walkComplete },
  });

  const manifestPath = join(outDir, MANIFEST_NAME);
  const manifestMoved = manifestChanged(previous, manifest) || written.length > 0;
  if (manifestMoved) writeIfChanged(manifestPath, stableJson(manifest), { dryRun: options.dryRun });

  return { manifest, written, manifestMoved, stopped, picked, walkComplete };
}

/** What the run tells a reader, and the exit code that goes with it. */
export function renderRun(result, options) {
  const m = result.manifest;
  const lines = [
    `board-snapshot — ${m.repo} into ${options.out}${options.dryRun ? ' (DRY RUN — nothing was written)' : ''}`,
    `  since        ${m.since ?? '(full)'} — ${m.since_reason}`,
    `  read         ${m.run.numbers_read} number(s) in ${m.requests} request(s); walk ${m.run.walk_complete ? 'complete' : 'INCOMPLETE'}`,
    `  written      ${result.written.length} file(s)${result.manifestMoved ? ' + manifest' : ''}`,
    `  archive      ${m.counts.records} record(s): ${m.counts.issues_open} open / ${m.counts.issues_closed} closed issue(s), ${m.counts.pulls_open} open / ${m.counts.pulls_closed} closed pull request(s)`,
  ];

  if (!result.written.length && !result.manifestMoved) {
    lines.push('  idempotent   nothing changed on the board since the last run, so nothing was written.');
  }

  const check = m.count_check;
  if (check.verdict === 'pending') {
    const board = m.board.open_issues_count === null
      ? 'the board\'s own count was not read this run'
      : `the board reports ${check.expected}`;
    lines.push(`  count check  PENDING — the snapshot is incomplete, so its census is no reading about the board (archived ${check.archived}; ${board}).`);
  } else if (check.ok) {
    lines.push(`  count check  ok — ${check.archived} open issue(s) archived, board says ${check.expected} (open_issues_count ${m.board.open_issues_count} minus ${m.board.open_pull_requests} open pull request(s)).`);
  } else if (check.verdict === 'shortfall') {
    lines.push(
      `  count check  SHORTFALL of ${check.shortfall} — the archive holds ${check.archived} open issue(s) where the board reports ${check.expected}.`,
      '               The enumeration missed cards. This is not a warning: an enumeration without a count check is not a reading,',
      '               and one that fails its count check is a reading that says it is wrong.',
    );
  } else {
    lines.push(
      `  count check  SURPLUS of ${check.surplus} — the archive holds ${check.archived} open issue(s) where the board reports only ${check.expected}.`,
      '               Records this archive carries are no longer on the board: destroyed with an account, deleted, or transferred.',
      `               Print one back with --restore=N. A number deliberately left gone belongs in ${GONE_LEDGER_NAME}, which is the only way to quiet this.`,
    );
  }

  if (result.stopped?.kind === 'rate-limit') {
    lines.push(
      `  STOPPED      rate limit: ${result.stopped.reason}`,
      `               Nothing was retried. The next run resumes at ${m.resume.since}.`,
    );
  } else if (result.stopped) {
    lines.push(
      `  paused       ${result.stopped.reason} — this is a planned stop, not a failure.`,
      `               The next run resumes at ${m.resume.since}.`,
    );
  }

  const exitCode = result.stopped?.kind === 'rate-limit'
    ? EXIT_RATE_LIMITED
    : check.ok === false
      ? EXIT_COUNT_MISMATCH
      : EXIT_OK;
  return { text: lines.join('\n'), exitCode };
}

/**
 * `--verify-counts`: the count check against a LIVE enumeration instead of the
 * archive, in the same arithmetic and through the same page walk.
 *
 * It exists because the archive's own count check is only a reading once the
 * first full snapshot has finished — days of scheduled runs, on a board this
 * size — and until then nothing would have exercised the rule the whole
 * enumeration rests on. This answers it in a dozen requests, on any day.
 */
async function verifyCounts(repo, options) {
  const budget = makeBudget(options.maxRequests);
  const numbers = new Set();
  let since = null;
  let page = 1;
  for (;;) {
    budget.spend();
    const batch = await rest(`/repos/${repo}/issues?state=open&sort=updated&direction=asc${since ? `&since=${encodeURIComponent(since)}` : ''}&per_page=${PER_PAGE}&page=${page}`);
    const rows = Array.isArray(batch) ? batch : [];
    for (const raw of rows) if (!raw.pull_request) numbers.add(raw.number);
    const step = nextWalkStep({ batchLength: rows.length, lastUpdatedAt: rows.at(-1)?.updated_at ?? null, since, page });
    if (step.done) break;
    since = step.since;
    page = step.page;
  }
  budget.spend();
  const meta = await rest(`/repos/${repo}`);
  const openPulls = await readAllPages((p) => openPullsPath(repo, { page: p }), { budget });
  const check = countCheck({
    openIssuesCount: meta?.open_issues_count ?? null,
    openPullRequests: openPulls.length,
    archivedOpenIssues: numbers.size,
  });
  const lines = [
    `board-snapshot --verify-counts — ${repo}`,
    `  enumerated   ${numbers.size} open issue(s) by walking pages to a short page (no Link header was read)`,
    `  board says   open_issues_count ${meta?.open_issues_count} minus ${openPulls.length} open pull request(s) = ${check.expected}`,
    `  requests     ${requestCount.value}`,
    check.ok
      ? '  count check  ok — the enumeration is a reading.'
      : `  count check  ${check.verdict.toUpperCase()} — shortfall ${check.shortfall}, surplus ${check.surplus}. The enumeration is NOT a reading.`,
  ];
  return { text: lines.join('\n'), exitCode: check.ok ? EXIT_OK : EXIT_COUNT_MISMATCH, check };
}

function reportPrerequisiteNotMet(err) {
  console.error(
    `\nboard-snapshot: PREREQUISITE NOT MET — ${err.message}\n\n` +
      "  Fix:  run this where node's fetch reaches api.github.com with a token that can read issues\n" +
      `        (a GitHub Actions runner, or an agent container with ${PROXY_FLAG} — this script re-execs\n` +
      '        itself with that flag when HTTPS_PROXY is set).\n\n' +
      '  NOTHING WAS ARCHIVED. This is not an empty board and not a complete snapshot — it is no\n' +
      '  reading at all, and the previous archive is untouched.\n' +
      `\n  (Exit code ${EXIT_PREREQUISITE_NOT_MET}. Capture it BEFORE any pipe:\n` +
      '  `node scripts/pm/board-snapshot.mjs --out=board > /tmp/b.log 2>&1; echo "EXIT=$?"`.)',
  );
  return EXIT_PREREQUISITE_NOT_MET;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = Object.freeze(['--full', '--dry-run', '--verify-counts', '--self-test', '--help', '-h']);
export const KNOWN_OPTIONS = Object.freeze(['out', 'since', 'max-requests', 'limit', 'restore']);

export function readOption(argv, name, fallback = null) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit !== undefined) return hit.slice(name.length + 3);
  // `--name VALUE` is accepted for every option too: the card spells the restore
  // recipe `--restore <n>`, and a tool that answered a usage error to the
  // spelling its own card documents would be read as broken rather than strict.
  const at = argv.indexOf(`--${name}`);
  if (at !== -1 && at + 1 < argv.length && !argv[at + 1].startsWith('-')) return argv[at + 1];
  return fallback;
}

/**
 * Parse, and REFUSE anything unrecognised.
 *
 * A typo must never make this decision quietly: `--dry-runn` that parses as
 * "no flags given" is a live run, and `--limitt=20` is a full-board pull with a
 * user token — the one thing the dispatch of this card forbids by name.
 */
export function parseOptions(argv) {
  const consumed = new Set();
  for (const [index, arg] of argv.entries()) {
    if (consumed.has(index)) continue;
    if (!arg.startsWith('-')) return { ok: false, error: `unexpected argument ${JSON.stringify(arg)} — every input to this tool is a flag.` };
    const name = arg.startsWith('--') && arg.includes('=') ? arg.slice(2, arg.indexOf('=')) : null;
    if (name === null && KNOWN_OPTIONS.includes(arg.slice(2))) {
      if (index + 1 >= argv.length || argv[index + 1].startsWith('-')) return { ok: false, error: `${arg} takes a value: write ${arg}=VALUE or ${arg} VALUE.` };
      consumed.add(index + 1);
      continue;
    }
    if (name === null && !KNOWN_FLAGS.includes(arg)) return { ok: false, error: `unknown flag ${arg}. Known: ${[...KNOWN_FLAGS, ...KNOWN_OPTIONS.map((o) => `--${o}=…`)].join(' ')}` };
    if (name !== null && !KNOWN_OPTIONS.includes(name)) return { ok: false, error: `unknown option --${name}=…. Known: ${KNOWN_OPTIONS.map((o) => `--${o}=…`).join(' ')}` };
  }

  const maxRaw = readOption(argv, 'max-requests', String(DEFAULT_MAX_REQUESTS));
  const maxRequests = Number(maxRaw);
  if (!Number.isInteger(maxRequests) || maxRequests < 1) return { ok: false, error: `--max-requests=${maxRaw} is not a positive integer.` };

  const limitRaw = readOption(argv, 'limit', null);
  const limit = limitRaw === null ? null : Number(limitRaw);
  if (limitRaw !== null && (!Number.isInteger(limit) || limit < 1)) return { ok: false, error: `--limit=${limitRaw} is not a positive integer.` };

  const restoreRaw = readOption(argv, 'restore', null);
  const restore = restoreRaw === null ? null : Number(restoreRaw);
  if (restoreRaw !== null && (!Number.isInteger(restore) || restore < 1)) return { ok: false, error: `--restore=${restoreRaw} is not an issue number.` };

  return {
    ok: true,
    options: {
      out: readOption(argv, 'out', DEFAULT_OUT_DIR),
      since: readOption(argv, 'since', null),
      full: argv.includes('--full'),
      dryRun: argv.includes('--dry-run'),
      verifyCounts: argv.includes('--verify-counts'),
      maxRequests,
      limit,
      restore,
    },
  };
}

const USAGE = [
  'board-snapshot — back the board up to an orphan branch, so an account suspension destroys no record.',
  '',
  '  node scripts/pm/board-snapshot.mjs [--out=DIR] [--full] [--since=ISO] [--limit=N]',
  '                                     [--max-requests=N] [--dry-run]',
  '  node scripts/pm/board-snapshot.mjs --out=DIR --restore=N     # print a recreate payload; posts nothing',
  '  node scripts/pm/board-snapshot.mjs --verify-counts           # the count check, live, no archive',
  '  node scripts/pm/board-snapshot.mjs --self-test               # offline, no network, no token',
  '',
  `  Default --out is ${DEFAULT_OUT_DIR}/ and the default budget is ${DEFAULT_MAX_REQUESTS} requests per run.`,
  '  The board is PM_SWEEP_REPO or GITHUB_REPOSITORY; this tool refuses to guess one.',
  '  It reads GitHub and writes files. It has no write path to GitHub in any mode.',
].join('\n');

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT_OK;
  }

  const parsed = parseOptions(argv);
  if (!parsed.ok) {
    console.error(`board-snapshot: ${parsed.error}`);
    return EXIT_USAGE;
  }
  const options = parsed.options;

  // --restore reads the archive directory and nothing else: no token, no
  // network, no repo. It works from a bare checkout of the archive branch,
  // which is the situation it is for.
  if (options.restore !== null) {
    const card = readArchivedCard(options.out, options.restore);
    if (!card.ok) {
      console.error(`board-snapshot: ${card.error}`);
      return EXIT_USAGE;
    }
    const manifest = readJsonFile(join(options.out, MANIFEST_NAME));
    console.log(restorePayload({
      issue: card.issue,
      comments: card.comments,
      runStamp: manifest?.generated_at ?? 'an unstamped archive',
      repo: manifest?.repo ?? 'this repository',
    }));
    return EXIT_OK;
  }

  const repoRes = resolveSweepRepo(process.env);
  if (!repoRes.valid || repoRes.source === 'default') {
    console.error(
      `board-snapshot: the board to archive is ${repoRes.source === 'default' ? 'not set' : `${repoRes.source}=${JSON.stringify(repoRes.repo)}, which is not owner/name`}.\n` +
        '  Set PM_SWEEP_REPO (the workflow passes github.repository). ⛔ This tool refuses the resolver\'s\n' +
        '  default: a copy of it archiving the repo it was copied FROM produces a complete, well-formed,\n' +
        '  green archive of the wrong board.',
    );
    return EXIT_USAGE;
  }

  if (!TOKEN) {
    console.error(
      'board-snapshot: no token. Set GITHUB_TOKEN (the workflow supplies its own) or GH_TOKEN.\n' +
        '  ⛔ Refusing to run unauthenticated: the anonymous budget is 60 requests/hour, so an\n' +
        '  unauthenticated run would write a truncated archive and report it as a snapshot.',
    );
    return EXIT_PREREQUISITE_NOT_MET;
  }

  try {
    const rendered = options.verifyCounts ? await verifyCounts(repoRes.repo, options) : renderRun(await snapshot(repoRes.repo, options), options);
    console.log(rendered.text);
    return rendered.exitCode;
  } catch (err) {
    if (err instanceof RateLimited) {
      console.error(`board-snapshot: ${err.message}. Nothing was retried.`);
      return EXIT_RATE_LIMITED;
    }
    return reportPrerequisiteNotMet(err);
  }
}

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

// ---------------------------------------------------------------------------
// Self-test — offline, no network, no token, and the only instrument watching
// the rules a clean tree cannot exercise: the walk's re-anchor, the resume
// cursor, the count check's three verdicts, the restore header, and the two
// structural properties (no write path to GitHub, no retry loop) that this
// tool's whole standing rests on.
//
// Every section opens with `battery(...)`; the floor below requires the OPENED
// set to equal the DECLARED set with each battery at or above its own count, so
// a section that stops running names itself instead of going quiet. The counts
// are a FLOOR, never an equality — adding cases is ordinary work.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the record shapes: fixed key order, declared absence': 9,
  'the page walk: only a short page ends it': 8,
  'the `since` selection: full, then incremental, then resume': 7,
  'idempotence: no change means no write': 8,
  'the census and the count check': 10,
  'the restore payload: a rebuilt record says it is one': 9,
  'the refusals: a typo must never make this decision': 11,
  'the rate-limit stop, and the two properties that are structural': 8,
});
const SELF_TEST_BATTERY_FLOOR = 8;
const UNATTRIBUTED_BATTERY = '(unattributed)';

let selfTestReachedVerdict = false;

export function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => { openBattery = name; };
  const cases = [];
  const t = (name, ok, detail) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    cases.push({ name, ok: Boolean(ok), detail });
  };

  const RAW = (over = {}) => ({
    number: 17297,
    title: 'a p1 security decision card',
    state: 'open',
    state_reason: null,
    user: { login: 'os-litant', id: 7, type: 'User' },
    labels: [{ name: 'priority:p1' }, { name: 'domain:skills' }],
    assignees: [{ login: 'zeta' }, { login: 'alpha' }],
    milestone: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    closed_at: null,
    comments: 2,
    locked: false,
    html_url: 'https://github.com/o/r/issues/17297',
    body: 'the body that a suspension destroys',
    ...over,
  });
  const RAW_COMMENT = (over = {}) => ({
    id: 5617561348,
    user: { login: 'os-litant', id: 7, type: 'User' },
    created_at: '2026-09-02T10:56:32Z',
    updated_at: '2026-09-02T10:56:32Z',
    html_url: 'https://github.com/o/r/issues/17297#issuecomment-5617561348',
    body: 'Claim: PM loop round 1',
    ...over,
  });

  // -- the record shapes -----------------------------------------------------
  battery('the record shapes: fixed key order, declared absence');
  const record = issueRecord(RAW());
  t('the key order is the one this file writes, not the order GitHub answered in',
    Object.keys(record).join(',') === 'number,kind,title,state,state_reason,draft,author,labels,assignees,milestone,type,created_at,updated_at,closed_at,closed_by,merged_at,comments,locked,html_url,body',
    Object.keys(record).join(','));
  t('labels are sorted, so a re-fetch in another order is not a diff', record.labels.join() === 'domain:skills,priority:p1');
  t('assignees are sorted for the same reason', record.assignees.join() === 'alpha,zeta');
  t('`closed_by` is PRESENT and null — declared absent, not silently missing', 'closed_by' in record && record.closed_by === null);
  t('an issue reads kind=issue and its `draft` is null, not false', record.kind === 'issue' && record.draft === null);
  const pull = issueRecord(RAW({ number: 17326, pull_request: { merged_at: '2026-09-10T07:45:30Z' }, draft: false }));
  t('a pull request reads kind=pull_request and carries merged_at off the listing, at no extra request',
    pull.kind === 'pull_request' && pull.merged_at === '2026-09-10T07:45:30Z' && pull.draft === false);
  t('two runs over the same answer produce identical bytes', stableJson(issueRecord(RAW())) === stableJson(issueRecord(RAW())));
  t('a JSON file ends in exactly one newline', stableJson({ a: 1 }).endsWith('}\n') && !stableJson({ a: 1 }).endsWith('\n\n'));
  t('an empty thread is an empty file, never a line of nothing', stableJsonl([]) === '' && stableJsonl([commentRecord(RAW_COMMENT())]).split('\n').filter(Boolean).length === 1);

  // -- the page walk ---------------------------------------------------------
  battery('the page walk: only a short page ends it');
  const full = nextWalkStep({ batchLength: 100, lastUpdatedAt: '2026-09-03T00:00:00Z', since: '2026-09-01T00:00:00Z', page: 1 });
  t('a FULL page must fetch the next — the completeness rule, and nothing else ends the walk', full.done === false);
  t('…and it re-anchors on the VALUE, back to page 1, so a row that shifted forward cannot fall through the gap',
    full.since === '2026-09-03T00:00:00Z' && full.page === 1 && full.reanchored === true);
  const tied = nextWalkStep({ batchLength: 100, lastUpdatedAt: '2026-09-01T00:00:00Z', since: '2026-09-01T00:00:00Z', page: 4 });
  t('a full page whose rows all share the cursor advances the PAGE — the one case an offset is for',
    tied.done === false && tied.page === 5 && tied.since === '2026-09-01T00:00:00Z');
  t('a short page ends the walk', nextWalkStep({ batchLength: 3, lastUpdatedAt: '2026-09-04T00:00:00Z', since: null, page: 9 }).done === true);
  t('an empty page ends the walk', nextWalkStep({ batchLength: 0, lastUpdatedAt: null, since: 'x', page: 2 }).done === true);
  const path = listingPath('o/r', { since: '2026-09-01T00:00:00Z', page: 3 });
  t('the listing asks for state=all — the closed half is exactly what a suspension destroys', path.includes('state=all'));
  t('…ordered by updated ascending, 100 a page, by page number', path.includes('sort=updated') && path.includes('direction=asc') && path.includes('per_page=100') && path.includes('page=3'));
  t('a full read carries no `since` at all', !listingPath('o/r', {}).includes('since='));

  // -- the since selection ---------------------------------------------------
  battery('the `since` selection: full, then incremental, then resume');
  t('no manifest: the first run is full', selectSince(null).since === null);
  t('…and says so, so a full run and an incremental one are never confused', /first run is full/.test(selectSince(null).reason));
  t('a previous manifest hands over its next_since', selectSince({ next_since: '2026-09-05T00:00:00Z' }).since === '2026-09-05T00:00:00Z');
  t('a resume cursor WINS over next_since — an interrupted run is continued, not skipped past',
    selectSince({ next_since: '2026-09-09T00:00:00Z', resume: { since: '2026-09-05T00:00:00Z' } }).since === '2026-09-05T00:00:00Z');
  t('--full ignores the manifest', selectSince({ next_since: '2026-09-05T00:00:00Z' }, { full: true }).since === null);
  t('--since overrides everything, including a resume cursor',
    selectSince({ resume: { since: '2026-09-05T00:00:00Z' } }, { override: '2026-01-01T00:00:00Z' }).since === '2026-01-01T00:00:00Z');
  t('every selection carries a printable reason', ['reason'].every((k) => typeof selectSince(null)[k] === 'string' && selectSince(null)[k].length > 0));

  // -- idempotence -----------------------------------------------------------
  battery('idempotence: no change means no write');
  const dir = mkdtempSync(join(tmpdir(), 'board-snapshot-'));
  try {
    const files = new Map([
      [issuePath(dir, 17297), stableJson(issueRecord(RAW()))],
      [commentsPath(dir, 17297), stableJsonl([commentRecord(RAW_COMMENT())])],
    ]);
    t('the first run writes every file', applyWrites(files).length === 2);
    t('THE CASE: an unchanged re-run writes nothing at all', applyWrites(files).length === 0);
    const changed = new Map(files);
    changed.set(issuePath(dir, 17297), stableJson(issueRecord(RAW({ state: 'closed', state_reason: 'completed' }))));
    t('a changed record writes exactly its own file', applyWrites(changed).join() === issuePath(dir, 17297));
    const dryDir = mkdtempSync(join(tmpdir(), 'board-snapshot-dry-'));
    const dryFiles = new Map([[issuePath(dryDir, 1), stableJson({ number: 1 })]]);
    t('--dry-run reports the path it would write', applyWrites(dryFiles, { dryRun: true }).length === 1);
    t('…and leaves the disk untouched', readJsonFile(issuePath(dryDir, 1)) === null);
    rmSync(dryDir, { recursive: true, force: true });
    const base = { schema: 1, counts: { issues_open: 3 }, generated_at: 'A', requests: 5, run: { numbers_read: 1 } };
    t('a manifest differing only in its run stamp is NOT a change — a stamp is a fact about the run',
      manifestChanged(base, { ...base, generated_at: 'B', requests: 9, run: { numbers_read: 4 } }) === false);
    t('a manifest whose counts moved IS a change', manifestChanged(base, { ...base, counts: { issues_open: 4 } }) === true);
    t('no previous manifest is always a change', manifestChanged(null, base) === true);

    // -- the census and the count check --------------------------------------
    battery('the census and the count check');
    const censusDir = mkdtempSync(join(tmpdir(), 'board-snapshot-census-'));
    applyWrites(new Map([
      [issuePath(censusDir, 1), stableJson(issueRecord(RAW({ number: 1, state: 'open' })))],
      [issuePath(censusDir, 2), stableJson(issueRecord(RAW({ number: 2, state: 'closed' })))],
      [issuePath(censusDir, 3), stableJson(issueRecord(RAW({ number: 3, state: 'open', pull_request: { merged_at: null } })))],
      [issuePath(censusDir, 4), stableJson(issueRecord(RAW({ number: 4, state: 'closed', pull_request: { merged_at: 'x' } })))],
    ]));
    const census = censusArchive(censusDir);
    t('the census counts by state AND kind, read off the files rather than accumulated',
      census.issues_open === 1 && census.issues_closed === 1 && census.pulls_open === 1 && census.pulls_closed === 1 && census.records === 4);
    t('a census of a directory that does not exist is zero, not a throw', censusArchive(join(censusDir, 'nope')).records === 0);
    t('the ledger of gone numbers is empty when the file is absent', readGoneLedger(censusDir).length === 0);
    writeIfChanged(join(censusDir, GONE_LEDGER_NAME), stableJson([{ number: 9, note: 'transferred' }, 10]));
    t('…and reads both a bare number and a row carrying a note', readGoneLedger(censusDir).join() === '9,10');
    rmSync(censusDir, { recursive: true, force: true });
    t('the count check passes when the archive equals open_issues_count minus the open pull requests',
      countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 600 }).ok === true);
    const short = countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 590 });
    t('a SHORTFALL is the enumeration missing cards, and it is not ok', short.verdict === 'shortfall' && short.shortfall === 10 && short.ok === false);
    const surplus = countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 606 });
    t('a SURPLUS is the destruction signature this tool exists for, and it is not ok', surplus.verdict === 'surplus' && surplus.surplus === 6 && surplus.ok === false);
    t('…and the gone ledger is the only thing that quiets it',
      countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 606, gone: [1, 2, 3, 4, 5, 6] }).ok === true);
    const pending = countCheck({ openIssuesCount: 620, openPullRequests: 20, archivedOpenIssues: 12, resuming: true });
    t('a resuming snapshot reads PENDING — a census of a partial archive is no reading about the board', pending.verdict === 'pending');
    t('…and pending is not a pass: `ok` is null, so "could not check" never renders as "checked and clean"', pending.ok === null);

    // -- the restore payload -------------------------------------------------
    battery('the restore payload: a rebuilt record says it is one');
    const archived = issueRecord(RAW());
    const thread = [commentRecord(RAW_COMMENT()), commentRecord(RAW_COMMENT({ id: 2, body: 'ACCEPT' }))];
    const payload = restorePayload({ issue: archived, comments: thread, runStamp: '2026-09-10T13:37:00Z', repo: 'o/r' });
    t('THE rule: the payload carries the provenance sentence verbatim', payload.includes(provenanceSentence('2026-09-10T13:37:00Z')));
    t('it names the ORIGINAL number, and says the rebuilt card carries a new one', payload.includes('o/r#17297') && /new one/.test(payload));
    t('it names the author whose account the loss travelled through', payload.includes('@os-litant'));
    t('it carries both timestamps', payload.includes('2026-09-01T00:00:00Z') && payload.includes('2026-09-02T00:00:00Z'));
    t('it lists the labels to re-apply', payload.includes('`domain:skills`') && payload.includes('`priority:p1`'));
    t('the thread is a SECOND block, one heading per comment', payload.includes('Comment 1 — @os-litant') && payload.includes('Comment 2 —') && payload.includes('2 comment(s)'));
    t('⛔ it carries no attribution footer — the channel appends its own, and two is what that costs', !payload.includes('Generated by ['));
    t('an author whose account is gone renders without inventing a handle',
      restorePayload({ issue: { ...archived, author: null }, comments: [], runStamp: 's', repo: 'o/r' }).includes('an account that no longer resolves'));
    const restoreDir = mkdtempSync(join(tmpdir(), 'board-snapshot-restore-'));
    applyWrites(new Map([[issuePath(restoreDir, 17297), stableJson(archived)], [commentsPath(restoreDir, 17297), stableJsonl(thread)]]));
    const readBack = readArchivedCard(restoreDir, 17297);
    t('--restore reads the archive DIRECTORY and nothing else, thread included',
      readBack.ok && readBack.issue.body === archived.body && readBack.comments.length === 2);
    rmSync(restoreDir, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // -- the refusals ----------------------------------------------------------
  battery('the refusals: a typo must never make this decision');
  t('a good command line parses', parseOptions(['--out=archive/board', '--limit=20']).ok === true);
  t('an unknown flag is refused', parseOptions(['--archive-everything']).ok === false);
  t('an unknown option is refused', parseOptions(['--outt=board']).ok === false);
  t('a positional argument is refused', parseOptions(['17297']).ok === false);
  t('THE typo: `--dry-runn` is refused rather than parsed as a LIVE run', parseOptions(['--dry-runn']).ok === false);
  t('--limit=0 is refused', parseOptions(['--limit=0']).ok === false);
  t('--restore=abc is refused', parseOptions(['--restore=abc']).ok === false);
  t('--max-requests=-1 is refused', parseOptions(['--max-requests=-1']).ok === false);
  t('the budget defaults to the value this file declares, never to unlimited', parseOptions([]).options.maxRequests === DEFAULT_MAX_REQUESTS);
  const spaced = parseOptions(['--out', 'archive/board', '--restore', '17297']);
  t('the spelling the card documents parses: `--restore <n>` with a space', spaced.ok === true && spaced.options.restore === 17297 && spaced.options.out === 'archive/board');
  t('…and an option left without a value is refused rather than swallowing the next flag',
    parseOptions(['--restore', '--dry-run']).ok === false);

  // -- the rate-limit stop, and the structural properties ---------------------
  battery('the rate-limit stop, and the two properties that are structural');
  t('403 with the budget spent is a rate-limit stop', rateLimitStop({ status: 403, remaining: '0', reset: '1789000000' }) !== null);
  t('429 with a retry-after is a rate-limit stop', rateLimitStop({ status: 429, retryAfter: '60' }) !== null);
  t('403 with budget REMAINING is about the token, not the budget — and retrying it is useless',
    rateLimitStop({ status: 403, remaining: '4800' }) === null);
  t('a 404 is not a rate-limit stop', rateLimitStop({ status: 404, remaining: '0' }) === null);
  t('the reset instant is rendered as an ISO stamp a reader can act on',
    /^\d{4}-\d{2}-\d{2}T/.test(rateLimitStop({ status: 403, remaining: '0', reset: '1789000000' }).resetAt));
  const source = readFileSync(SELF_PATH, 'utf8');
  // Built from parts on purpose: a literal would match itself and pin nothing.
  t('⛔ STRUCTURAL: this file contains no retry loop — the stop writes a cursor and returns',
    !new RegExp(['set', 'Timeout'].join('')).test(source) && !source.includes(['await ', 'sleep('].join('')));
  t('⛔ STRUCTURAL: this file has no write path to GitHub in any mode — the one-board rule, mechanically',
    !/method:\s*'(?:POST|PATCH|PUT|DELETE)'/.test(source) && !/\bmethod:\s*(?:method|options\.method)\b/.test(source));
  t('…and its only fetch is the one read helper', (source.match(/await fetch\(/g) ?? []).length === 1);

  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of batterySeen) {
    if (!declared.includes(name)) problems.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(count === 0
      ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
      : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`);
  }
  for (const message of problems) cases.push({ name: message, ok: false });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  x ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`x board-snapshot self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`OK board-snapshot self-test: ${cases.length} cases pass across ${declared.length} batteries (walk re-anchor, resume cursor, idempotence, the three count-check verdicts, the restore header, and the two structural properties).`);
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\nx board-snapshot self-test: selfTest() returned without reaching its verdict, so no success\n' +
          'line was printed. Exiting 0 here would report a self-test that never finished as a self-test\n' +
          'that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  } else {
    // ⛔ --restore is not re-exec'd: it reads the archive directory and makes no
    // request at all, so routing its transport would spawn a child to prove a
    // route nothing in that mode uses. The absence of the re-exec line is part
    // of what "prints, never posts, reads nothing but the directory" looks like.
    const restoring = process.argv.some((a) => a === '--restore' || a.startsWith('--restore='));
    const rearmed = restoring ? null : rearmThroughProxy(process.argv.slice(2));
    if (rearmed !== null) process.exit(rearmed);
    main(process.argv.slice(2)).then((code) => process.exit(code));
  }
}
