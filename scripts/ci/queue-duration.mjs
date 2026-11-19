#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// queue-duration -- the weekly merge-queue duration reading, and the one
// speed-up card it files when the queue is over its budget.
//
//   node scripts/ci/queue-duration.mjs [--repo OWNER/NAME] [--since 7d|24h|ISO] [--until ISO]
//                                      [--json] [--job-sample N] [--via gh]
//   node scripts/ci/queue-duration.mjs --render READING.json [--report-only]
//   node scripts/ci/queue-duration.mjs --self-test
//
// Read-only against GitHub. The workflow `.github/workflows/queue-duration-budget.yml`
// runs it weekly and, on an OVER verdict, imports `fileQueueCard` from here to
// file or refresh the card; nothing else in this file writes.
//
// ## The budget, and whose numbers they are
//
// `scripts/ci/queue-budget.json` holds them: the median budget, the p90 alarm,
// the baseline they were set against, and the queue workflows this repo reads.
// ⛔ Changing a number there is the MAINTAINER's call, never a seat's -- a
// queue that got slower is answered by a speed-up, not by a looser budget.
// This script reads the numbers and never restates them.
//
// ## What one reading measures
//
// Every `merge_group` run created in the window, grouped by head SHA (one
// queue entry's temporary merge commit). For a SHA whose every run of a queue
// workflow concluded green, the duration is its FIRST run's `created_at` to
// its LAST run's `updated_at`: the wall clock a queue entry costs, waiting
// for runners included, re-runs included. Percentiles are nearest-rank over
// those durations. A SHA with any red run (failure, timed_out,
// startup_failure) counts toward the failure rate; a cancelled SHA is the
// queue invalidating an entry, reported apart and neither green nor red; a
// SHA still running is left out.
//
// The five slowest jobs come from the CRITICAL run -- the run of each SHA
// that finished last -- read for an evenly spaced sample of the green SHAs
// (`--job-sample`, default 40), so the job reads stay a few dozen calls.
//
// ## What a reading never does
//
// A gate grading a duration reports and never reds a required job (AGENTS.md
// Build & Test). This is not a gate: no required context runs it, and an
// OVER week files a card and exits 0. Exit 2 means NOT MEASURED -- the
// transport failed, a window could not be listed whole, or the sample fell
// under the budget's floor -- and the workflow turns that into a red patrol
// run, the patrol reporting its own death, never a verdict on the queue.
//
// A PR that changes CI or adds a gate reports the affected job's before/after
// median in its body as advisory; that reading never blocks a merge.
//
// Dependency-free: the workflow runs no `pnpm install`.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BUDGET_PATH = path.resolve(HERE, 'queue-budget.json');

/** The card's identity: a fixed title and a PLAIN-TEXT body marker. */
export const CARD_TITLE = 'merge queue over its speed budget';
export const CARD_MARKER = 'os-queue-duration-budget';
/** Applied on CREATE only; ⛔ a refresh never touches labels. */
export const CARD_LABELS = Object.freeze(['tooling', 'area:fleet', 'domain:devx', 'priority:p2', 'pm:queue']);
export const CARD_TYPE = 'Task';

const GREEN = new Set(['success', 'skipped', 'neutral']);
const RED = new Set(['failure', 'timed_out', 'startup_failure']);
const CANCELLED = new Set(['cancelled', 'stale']);

/** The runs list API answers at most this many results for one query. */
const LIST_CAP = 1000;
const MAX_PAGES_PER_SLICE = 10;
const MIN_SLICE_MS = 60 * 60 * 1000;
const JOB_PAGES = 3;

const minutes = (ms) => Math.round((ms / 60000) * 10) / 10;
const ts = (s) => (s ? Date.parse(s) : NaN);

/** Nearest-rank percentile over an ASCENDING array; null on an empty one. */
export function percentile(sorted, q) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** `7d`, `24h` or an ISO instant, against `now`. Throws on anything else. */
export function parseSince(spec, now) {
  const m = /^(\d+)([dh])$/.exec(String(spec ?? '').trim());
  if (m) return new Date(now.getTime() - Number(m[1]) * (m[2] === 'd' ? 86400000 : 3600000));
  const t = Date.parse(String(spec ?? ''));
  if (Number.isNaN(t)) throw new Error(`--since/--until \`${spec}\` is neither Nd, Nh nor an ISO date`);
  return new Date(t);
}

/**
 * Validate the budget file's shape. Values are the maintainer's; this checks
 * only that they can be read and judged against. Returns a list of problems.
 */
export function validateBudget(b) {
  const out = [];
  if (!b || typeof b !== 'object' || Array.isArray(b)) return ['the budget is not a JSON object'];
  const pos = (k) => {
    if (typeof b[k] !== 'number' || !Number.isFinite(b[k]) || b[k] <= 0) out.push(`\`${k}\` must be a positive number`);
  };
  pos('budgetMedianMinutes');
  pos('alarmP90Minutes');
  if (out.length === 0 && b.alarmP90Minutes < b.budgetMedianMinutes) {
    out.push('`alarmP90Minutes` is below `budgetMedianMinutes`: a p90 can never sit under its own median');
  }
  if (!Number.isInteger(b.minSample) || b.minSample < 1) out.push('`minSample` must be a positive integer');
  if (typeof b.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(b.repo)) out.push('`repo` must be OWNER/NAME');
  if (!Array.isArray(b.queueWorkflows) || b.queueWorkflows.length === 0
    || b.queueWorkflows.some((w) => typeof w !== 'string' || w.trim() === '')) {
    out.push('`queueWorkflows` must be a non-empty list of workflow names');
  } else if (new Set(b.queueWorkflows).size !== b.queueWorkflows.length) {
    out.push('`queueWorkflows` names a workflow twice');
  }
  const base = b.baseline;
  if (!base || typeof base !== 'object' || !['p50Minutes', 'p90Minutes', 'maxMinutes', 'sample'].every((k) => typeof base[k] === 'number')
    || typeof base.window !== 'string') {
    out.push('`baseline` must carry numeric `p50Minutes`, `p90Minutes`, `maxMinutes`, `sample` and a `window` string');
  }
  if (typeof b.note !== 'string' || !/maintainer/i.test(b.note)) out.push('`note` must say that changing a number is the maintainer\'s call');
  return out;
}

export function loadBudget(file = BUDGET_PATH) {
  const budget = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = validateBudget(budget);
  if (problems.length > 0) throw new Error(`${path.basename(file)}: ${problems.join('; ')}`);
  return budget;
}

/**
 * Group runs by head SHA and classify each SHA. `workflows` null reads every
 * merge_group workflow (a sibling repo, report-only); a list keeps only the
 * runs of those names and reports the names it dropped.
 */
export function groupQueueRuns(runs, { workflows = null } = {}) {
  const listed = workflows ? new Set(workflows) : null;
  const unlisted = new Map();
  const seenNames = new Set();
  const bySha = new Map();
  for (const r of runs) {
    if (!r || !r.head_sha) continue;
    if (listed && !listed.has(r.name)) {
      unlisted.set(r.name, (unlisted.get(r.name) ?? 0) + 1);
      continue;
    }
    seenNames.add(r.name);
    if (!bySha.has(r.head_sha)) bySha.set(r.head_sha, []);
    bySha.get(r.head_sha).push(r);
  }
  const shas = [];
  for (const [sha, list] of bySha) {
    const running = list.some((r) => r.status !== 'completed');
    const red = list.some((r) => RED.has(r.conclusion));
    const green = !running && list.every((r) => GREEN.has(r.conclusion));
    const cancelled = !running && !red && !green && list.some((r) => CANCELLED.has(r.conclusion));
    const state = running ? 'running' : red ? 'red' : green ? 'green' : cancelled ? 'cancelled' : 'other';
    const start = Math.min(...list.map((r) => ts(r.created_at)));
    const end = Math.max(...list.map((r) => ts(r.updated_at)));
    const last = list.reduce((a, b) => (ts(b.updated_at) > ts(a.updated_at) ? b : a));
    shas.push({ sha, state, runs: list.length, start, end, minutes: minutes(end - start), criticalRun: { id: last.id, name: last.name } });
  }
  shas.sort((a, b) => a.start - b.start);
  return {
    shas,
    unlisted: Object.fromEntries([...unlisted].sort()),
    missing: listed ? [...listed].filter((w) => !seenNames.has(w)).sort() : [],
  };
}

/** The reading's numbers from grouped SHAs. */
export function summarise(grouped) {
  const count = (s) => grouped.shas.filter((x) => x.state === s).length;
  const green = grouped.shas.filter((x) => x.state === 'green');
  const sorted = green.map((x) => x.minutes).sort((a, b) => a - b);
  const completed = grouped.shas.length - count('running');
  const critical = {};
  for (const g of green) critical[g.criticalRun.name] = (critical[g.criticalRun.name] ?? 0) + 1;
  return {
    shas: { seen: grouped.shas.length, green: green.length, red: count('red'), cancelled: count('cancelled'), other: count('other'), running: count('running') },
    p50Minutes: percentile(sorted, 0.5),
    p90Minutes: percentile(sorted, 0.9),
    maxMinutes: sorted.length ? sorted[sorted.length - 1] : null,
    failureRate: { red: count('red'), completed, ratio: completed ? Math.round((count('red') / completed) * 1000) / 1000 : null },
    criticalRunWorkflows: Object.fromEntries(Object.entries(critical).sort((a, b) => b[1] - a[1])),
  };
}

/** Judge a reading against the budget. `report-only` for a repo the budget is not for. */
export function judge(reading, budget) {
  if (reading.repo !== budget.repo) return { verdict: 'report-only', reasons: [`${reading.repo} is read for the record; the budget is ${budget.repo}'s`] };
  if (reading.shas.green < budget.minSample) {
    return { verdict: 'not-measured', reasons: [`${reading.shas.green} all-green SHA(s), under the budget's floor of ${budget.minSample}: too few to judge a median or a p90`] };
  }
  const reasons = [];
  if (reading.p50Minutes > budget.budgetMedianMinutes) reasons.push(`median ${reading.p50Minutes} min is over the ${budget.budgetMedianMinutes}-minute budget`);
  if (reading.p90Minutes > budget.alarmP90Minutes) reasons.push(`p90 ${reading.p90Minutes} min is over the ${budget.alarmP90Minutes}-minute alarm`);
  return reasons.length ? { verdict: 'over', reasons } : {
    verdict: 'within',
    reasons: [`median ${reading.p50Minutes} ≤ ${budget.budgetMedianMinutes} min and p90 ${reading.p90Minutes} ≤ ${budget.alarmP90Minutes} min`],
  };
}

// ── Transport ──────────────────────────────────────────────────────────────

/**
 * A GET-only JSON reader. With a token in the environment it calls the REST
 * API through `fetch`; `--via gh` hands the path to the `gh` CLI instead (a
 * seat whose egress only `gh` is configured for). ⛔ The token is read, never
 * printed.
 */
export function makeApi({ via = 'fetch', env = process.env } = {}) {
  if (via === 'gh') {
    return async (p) => JSON.parse(execFileSync('gh', ['api', '-X', 'GET', p], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  }
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || '';
  const base = env.GITHUB_API_URL || 'https://api.github.com';
  return async (p) => {
    for (let attempt = 1; ; attempt += 1) {
      const res = await fetch(`${base}/${p}`, {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'objectstack-queue-duration',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) return res.json();
      // 403 and 429 are a secondary rate limit as often as a refusal; 5xx is transient.
      if (attempt < 4 && (res.status >= 500 || res.status === 429 || res.status === 403)) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new Error(`GET ${p} answered HTTP ${res.status}`);
    }
  };
}

const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Every merge_group run created in [since, until), listed whole or refused.
 * A slice whose total exceeds what the API will list is split in two; a slice
 * that cannot be split further, or that pages past its bound, REFUSES -- a
 * truncated list would read as a faster, smaller queue.
 */
export async function listQueueRuns(api, repo, since, until) {
  const out = [];
  const slices = [[since.getTime(), until.getTime()]];
  let calls = 0;
  while (slices.length > 0) {
    const [a, b] = slices.shift();
    const q = (page) => `repos/${repo}/actions/runs?event=merge_group&per_page=100&page=${page}&created=${iso(a)}..${iso(b - 1000)}`;
    const first = await api(q(1));
    calls += 1;
    const total = Number(first.total_count ?? 0);
    if (total > LIST_CAP * 0.9) {
      if (b - a <= MIN_SLICE_MS) throw new Error(`the slice ${iso(a)}..${iso(b)} holds ${total} runs, more than one listing returns, and it is already the smallest slice -- NOT MEASURED rather than a truncated reading`);
      const mid = a + Math.floor((b - a) / 2 / 1000) * 1000;
      slices.unshift([a, mid], [mid, b]);
      continue;
    }
    const got = [...(first.workflow_runs ?? [])];
    // Bounded by construction: a slice holds at most 90% of LIST_CAP, i.e.
    // nine full pages; a short page ends it early.
    let page = 1;
    while (got.length < total && (first.workflow_runs ?? []).length === 100 && page < MAX_PAGES_PER_SLICE) {
      page += 1;
      const res = await api(q(page));
      calls += 1;
      const rows = res.workflow_runs ?? [];
      got.push(...rows);
      if (rows.length < 100) break;
    }
    out.push(...got);
  }
  // A run listed in two slices (a boundary second) is one run.
  const byId = new Map(out.map((r) => [r.id, r]));
  return { runs: [...byId.values()], calls };
}

/**
 * The slowest jobs of the critical run, over an evenly spaced sample of the
 * green SHAs. Each job is keyed `workflow / job`; ranked by median duration.
 */
export async function criticalJobs(api, repo, greenShas, sampleSize) {
  const n = Math.min(sampleSize, greenShas.length);
  const picks = [];
  for (let i = 0; i < n; i += 1) picks.push(greenShas[Math.floor((i * greenShas.length) / n)]);
  const stats = new Map();
  let calls = 0;
  for (const g of picks) {
    for (let page = 1; page <= JOB_PAGES; page += 1) {
      const res = await api(`repos/${repo}/actions/runs/${g.criticalRun.id}/jobs?filter=latest&per_page=100&page=${page}`);
      calls += 1;
      const jobs = res.jobs ?? [];
      for (const j of jobs) {
        const dur = ts(j.completed_at) - ts(j.started_at);
        if (!Number.isFinite(dur) || j.conclusion === 'skipped') continue;
        const key = `${g.criticalRun.name} / ${j.name}`;
        if (!stats.has(key)) stats.set(key, { durations: [], waits: [] });
        stats.get(key).durations.push(dur);
        const wait = ts(j.started_at) - ts(j.created_at);
        if (Number.isFinite(wait)) stats.get(key).waits.push(wait);
      }
      if (jobs.length < 100) break;
    }
  }
  const med = (xs) => minutes(percentile([...xs].sort((a, b) => a - b), 0.5) ?? 0);
  const jobsRanked = [...stats].map(([job, s]) => ({ job, sampled: s.durations.length, medianMinutes: med(s.durations), medianWaitMinutes: med(s.waits) }))
    .sort((a, b) => b.medianMinutes - a.medianMinutes || a.job.localeCompare(b.job))
    .slice(0, 5);
  return { sampled: n, jobs: jobsRanked, calls };
}

/** One reading of one repo's queue. Throws on anything it could not read whole. */
export async function readQueue({ api, repo, since, until, budget, jobSample = 40 }) {
  const { runs, calls: listCalls } = await listQueueRuns(api, repo, since, until);
  const grouped = groupQueueRuns(runs, { workflows: repo === budget.repo ? budget.queueWorkflows : null });
  const summary = summarise(grouped);
  const green = grouped.shas.filter((x) => x.state === 'green');
  const crit = await criticalJobs(api, repo, green, jobSample);
  const reading = {
    repo,
    window: { since: iso(since), until: iso(until) },
    runs: runs.length,
    workflowsRead: repo === budget.repo ? [...budget.queueWorkflows] : 'every merge_group workflow',
    unlistedWorkflows: grouped.unlisted,
    missingWorkflows: grouped.missing,
    ...summary,
    criticalJobs: { sampled: crit.sampled, jobs: crit.jobs },
    apiCalls: listCalls + crit.calls,
  };
  return { ...reading, ...judge(reading, budget) };
}

// ── Rendering ──────────────────────────────────────────────────────────────

const pct = (r) => (r == null ? 'n/a' : `${(r * 100).toFixed(1)}%`);

/** The reading as markdown lines (run summary, card body, and the CLI). */
export function renderReading(reading, budget) {
  const s = reading.shas;
  const lines = [
    `**${reading.repo}** — merge_group runs created ${reading.window.since} .. ${reading.window.until} · verdict **${reading.verdict.toUpperCase()}**`,
    '',
    `- Reading: ${reading.reasons.join('; ')}.`,
    `- First start to last end over all-green SHAs (n=${s.green}): p50 **${reading.p50Minutes ?? 'n/a'} min** · p90 **${reading.p90Minutes ?? 'n/a'} min** · max ${reading.maxMinutes ?? 'n/a'} min.`,
  ];
  if (reading.repo === budget.repo) {
    lines.push(`- Budget (\`scripts/ci/queue-budget.json\`, the maintainer's numbers): median ≤ ${budget.budgetMedianMinutes} min · p90 alarm ≤ ${budget.alarmP90Minutes} min. Baseline ${budget.baseline.window}: p50 ${budget.baseline.p50Minutes} · p90 ${budget.baseline.p90Minutes} · max ${budget.baseline.maxMinutes} min over ${budget.baseline.sample} SHAs.`);
  } else {
    lines.push('- Report-only: no budget is set for this repository and nothing is filed for it.');
  }
  lines.push(
    `- Head SHAs: ${s.seen} seen · ${s.green} all-green · ${s.red} red · ${s.cancelled} cancelled · ${s.other} other · ${s.running} still running (${reading.runs} runs).`,
    `- Queue failure rate: ${reading.failureRate.red} of ${reading.failureRate.completed} completed SHAs had a red run (${pct(reading.failureRate.ratio)}).`,
    `- Workflows read: ${Array.isArray(reading.workflowsRead) ? reading.workflowsRead.join(', ') : reading.workflowsRead}.`,
  );
  const unlisted = Object.entries(reading.unlistedWorkflows ?? {});
  if (unlisted.length > 0) lines.push(`- ⚠️ merge_group workflows NOT in the budget's list, left out of the reading: ${unlisted.map(([n, c]) => `${n} (${c} runs)`).join(', ')}. A new queue workflow is a budget-file edit.`);
  if ((reading.missingWorkflows ?? []).length > 0) lines.push(`- ⚠️ listed queue workflows with no run in the window: ${reading.missingWorkflows.join(', ')}.`);
  const crit = Object.entries(reading.criticalRunWorkflows ?? {});
  if (crit.length > 0) lines.push(`- The run that finished last (the critical run), per all-green SHA: ${crit.map(([n, c]) => `${n} ${c}`).join(' · ')}.`);
  if (reading.criticalJobs.jobs.length > 0) {
    lines.push('', `Slowest jobs of the critical run, median over ${reading.criticalJobs.sampled} sampled all-green SHAs:`, '',
      '| Job | Median duration | Median wait for a runner | Sampled |', '|:---|---:|---:|---:|',
      ...reading.criticalJobs.jobs.map((j) => `| ${j.job.replace(/\|/g, '/')} | ${j.medianMinutes} min | ${j.medianWaitMinutes} min | ${j.sampled} |`));
  }
  return lines;
}

/** The speed-up card's body. Plain text marker first; ⛔ no HTML comment. */
export function renderCardBody(reading, budget, { runUrl, sha, eventName, sweptAt }) {
  return [
    `${CARD_MARKER} — machine-findable marker for this generated card. ⛔ Do not delete this line: it is how the weekly reading finds this card instead of filing a new one.`,
    '',
    `# ${CARD_TITLE}`,
    '',
    `_Swept ${sweptAt.toISOString()} · weekly while the queue stays over budget · [run](${runUrl}) · commit \`${sha}\` · trigger \`${eventName}\`._`,
    '',
    `The merge queue has a speed budget: a ${budget.budgetMedianMinutes}-minute median and a ${budget.alarmP90Minutes}-minute p90 alarm, held in`,
    '`scripts/ci/queue-budget.json` and read weekly by `.github/workflows/queue-duration-budget.yml`. This week\'s reading is over it, so this card asks',
    'for a speed-up. Nothing is blocked by it, and the body is refreshed in place each week the queue stays over.',
    '',
    '## This week\'s reading',
    '',
    ...renderReading(reading, budget),
    '',
    '## What answers this card',
    '',
    '- A change that brings the queue back under budget: shorten or split the slowest job of the critical run above,',
    '  cut runner waits, or move a family off the queue run. Its PR reports the affected job\'s before/after median.',
    '- ⛔ Not a looser budget: changing a number in `scripts/ci/queue-budget.json` is the maintainer\'s call.',
    '- Re-measure by hand: `node scripts/ci/queue-duration.mjs --since 7d` (add `--via gh` where only `gh` reaches the API).',
    '',
    '_Filed by `.github/workflows/queue-duration-budget.yml`. Generated by [Claude Code](https://claude.ai/code)_',
  ].join('\n');
}

// ── The card ───────────────────────────────────────────────────────────────

/**
 * File or refresh the ONE open speed-up card. The scan is bounded and refuses
 * rather than files when it cannot establish absence; the oldest match wins;
 * labels and the issue type are applied on create only.
 */
export async function fileQueueCard({ github, context, core, reading, budget, env = process.env, now = () => new Date() }) {
  if (reading.verdict !== 'over') throw new Error(`fileQueueCard: called on a \`${reading.verdict}\` reading -- only an OVER week files`);
  const { owner, repo } = context.repo;
  const body = renderCardBody(reading, budget, {
    runUrl: `${env.GITHUB_SERVER_URL}/${owner}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`,
    sha: env.GITHUB_SHA,
    eventName: context.eventName,
    sweptAt: now(),
  });
  const isThisCard = (i) => !i.pull_request
    && (String(i.title ?? '').startsWith(CARD_TITLE) || String(i.body ?? '').includes(CARD_MARKER));
  const MAX_PAGES = 10;
  const candidates = [];
  let scanComplete = true;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await github.rest.issues.listForRepo({ owner, repo, state: 'open', sort: 'created', direction: 'asc', per_page: 100, page });
    candidates.push(...res.data.filter(isThisCard));
    if (res.data.length < 100) break;
    if (page === MAX_PAGES) scanComplete = false;
  }
  if (!scanComplete) {
    throw new Error(`the open-issue scan hit its ${MAX_PAGES}-page bound without completing — absence is NOT established, so nothing was filed. The reading is in this run's summary.`);
  }
  const existing = candidates.sort((a, b) => a.number - b.number)[0] ?? null;
  if (existing) {
    // Rewritten in place, never a comment per week. ⛔ Labels are NOT rewritten.
    await github.rest.issues.update({ owner, repo, issue_number: existing.number, body });
    core.notice(`merge queue over budget — speed-up card #${existing.number} refreshed.`);
    return { action: 'refreshed', number: existing.number };
  }
  const created = await github.rest.issues.create({ owner, repo, title: CARD_TITLE, body, labels: [...CARD_LABELS] });
  const number = created.data.number;
  // The type is its own write so a refusal costs the type, never the card.
  try {
    await github.rest.issues.update({ owner, repo, issue_number: number, type: CARD_TYPE });
  } catch (error) {
    core.warning(`speed-up card #${number} filed, but setting its type to ${CARD_TYPE} was refused: ${error?.message ?? error}`);
  }
  core.notice(`merge queue over budget — speed-up card #${number} filed.`);
  return { action: 'filed', number };
}

// ── Self-test ──────────────────────────────────────────────────────────────
//
// Offline: fixtures for the runs and jobs APIs and in-memory doubles for the
// issue API. The one tracked file it reads is the budget, whose shape it
// validates. Roster and floor per AGENTS.md "Writing a --self-test".

const SELF_TEST_BATTERIES = Object.freeze({
  'percentile and window parsing': 6,
  'grouping by head SHA: green, red, cancelled, running, unlisted': 9,
  'verdict: the median budget, the p90 alarm, the sample floor, report-only': 6,
  'listing: the adaptive split, de-dup across slices, and the refusals': 5,
  'critical run: the slowest jobs of the run that finished last': 4,
  'budget file: the tracked file, and malformed shapes refused': 7,
  'card: files once, refreshes the oldest, refuses an unfinished scan': 10,
  'render: the summary names its numbers, window and verdict': 5,
});
const SELF_TEST_BATTERY_FLOOR = 8;

let selfTestReachedVerdict = false;

const FIX_BUDGET = Object.freeze({
  note: 'Changing a number here is the maintainer\'s call.',
  repo: 'objectstack-ai/objectstack',
  budgetMedianMinutes: 22,
  alarmP90Minutes: 32,
  minSample: 3,
  queueWorkflows: ['CI', 'Lint & Type Check'],
  baseline: { window: 'fixture', p50Minutes: 1, p90Minutes: 2, maxMinutes: 3, sample: 4 },
});

const T0 = Date.parse('2026-11-10T00:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
let runId = 0;
const run = (sha, name, startMin, endMin, conclusion = 'success', status = 'completed') => ({
  id: (runId += 1), head_sha: sha, name, status, conclusion, created_at: at(startMin), updated_at: at(endMin),
});

async function selfTest() {
  const failures = [];
  const seen = new Map();
  let checked = 0;
  const t = (battery, label, ok) => {
    seen.set(battery, (seen.get(battery) ?? 0) + 1);
    checked += 1;
    if (!ok) failures.push(`[${battery}] ${label}`);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const throwsAsync = async (fn, needle) => {
    try { await fn(); return false; } catch (e) { return String(e?.message ?? e).includes(needle); }
  };

  // ── percentile and window parsing
  {
    const B = 'percentile and window parsing';
    t(B, 'empty ⇒ null', percentile([], 0.5) === null);
    t(B, 'nearest rank: p50 of 1..10 is 5', percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5) === 5);
    t(B, 'nearest rank: p90 of 1..10 is 9', percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9) === 9);
    t(B, 'p90 of one value is that value', percentile([7], 0.9) === 7);
    const now = new Date('2026-11-19T00:00:00Z');
    t(B, '7d and 24h count back from now', parseSince('7d', now).toISOString() === '2026-11-12T00:00:00.000Z' && parseSince('24h', now).toISOString() === '2026-11-18T00:00:00.000Z');
    t(B, 'an unreadable --since throws', (() => { try { parseSince('last week', now); return false; } catch { return true; } })());
  }

  // ── grouping
  {
    const B = 'grouping by head SHA: green, red, cancelled, running, unlisted';
    const runs = [
      run('a', 'CI', 0, 20), run('a', 'Lint & Type Check', 1, 25),
      run('b', 'CI', 10, 30, 'failure'), run('b', 'Lint & Type Check', 10, 12),
      run('c', 'CI', 20, 21, 'cancelled'), run('c', 'Lint & Type Check', 20, 22),
      run('d', 'CI', 30, 31, null, 'in_progress'),
      run('e', 'CI', 40, 50, 'skipped'), run('e', 'Lint & Type Check', 40, 41, 'neutral'),
      run('a', 'Docs Preview', 0, 99),
      run('f', 'CI', 50, 60, 'action_required'),
    ];
    const g = groupQueueRuns(runs, { workflows: ['CI', 'Lint & Type Check', 'Governed Surface Guard'] });
    const st = Object.fromEntries(g.shas.map((x) => [x.sha, x.state]));
    t(B, 'all green ⇒ green', st.a === 'green');
    t(B, 'one red run ⇒ red', st.b === 'red');
    t(B, 'cancelled without red ⇒ cancelled', st.c === 'cancelled');
    t(B, 'any run not completed ⇒ running', st.d === 'running');
    t(B, 'skipped and neutral are green', st.e === 'green');
    t(B, 'an unknown conclusion is other, never green', st.f === 'other');
    const a = g.shas.find((x) => x.sha === 'a');
    t(B, 'first created to last updated, the unlisted workflow excluded', a.minutes === 25 && a.criticalRun.name === 'Lint & Type Check');
    t(B, 'an unlisted workflow is reported with its run count', same(g.unlisted, { 'Docs Preview': 1 }));
    t(B, 'a listed workflow with no run is reported missing', same(g.missing, ['Governed Surface Guard']));
  }

  // ── verdict
  {
    const B = 'verdict: the median budget, the p90 alarm, the sample floor, report-only';
    const r = (p50, p90, green = 10, repo = FIX_BUDGET.repo) => ({ repo, p50Minutes: p50, p90Minutes: p90, shas: { green } });
    t(B, 'under both ⇒ within', judge(r(21.7, 31.9), FIX_BUDGET).verdict === 'within');
    t(B, 'exactly at both ⇒ within (the budget is a ceiling, not a strict bound)', judge(r(22, 32), FIX_BUDGET).verdict === 'within');
    const m = judge(r(22.1, 30), FIX_BUDGET);
    t(B, 'median alone over ⇒ over, naming the median', m.verdict === 'over' && m.reasons.length === 1 && m.reasons[0].startsWith('median 22.1'));
    const p = judge(r(20, 32.5), FIX_BUDGET);
    t(B, 'p90 alone over ⇒ over, naming the alarm', p.verdict === 'over' && p.reasons.length === 1 && p.reasons[0].startsWith('p90 32.5'));
    t(B, 'under the sample floor ⇒ not-measured, even when over', judge(r(99, 99, 2), FIX_BUDGET).verdict === 'not-measured');
    t(B, 'another repository ⇒ report-only, never over', judge(r(99, 99, 10, 'objectstack-ai/hotcrm'), FIX_BUDGET).verdict === 'report-only');
  }

  // ── listing
  {
    const B = 'listing: the adaptive split, de-dup across slices, and the refusals';
    const since = new Date('2026-11-10T00:00:00Z');
    const until = new Date('2026-11-10T04:00:00Z');
    const mkRuns = (n, from) => Array.from({ length: n }, (_, i) => ({ id: from + i, head_sha: `s${from + i}`, name: 'CI' }));
    // Over the cap on the whole window, under it on each half.
    const seenQ = [];
    const api = async (p) => {
      seenQ.push(p);
      const created = /created=([^&]+)/.exec(p)[1];
      const page = Number(/[?&]page=(\d+)/.exec(p)[1]);
      if (created.startsWith('2026-11-10T00:00:00Z..2026-11-10T03:59:59Z')) return { total_count: 1500, workflow_runs: mkRuns(100, 0) };
      const base = created.startsWith('2026-11-10T00:00:00Z') ? 1000 : 2000;
      const total = 150;
      // The second half repeats one run of the first, as a boundary second would.
      const rows = page === 1 ? mkRuns(100, base) : [...mkRuns(49, base + 100), ...(base === 2000 ? [{ id: 1000, head_sha: 's1000', name: 'CI' }] : [{ id: base + 149, head_sha: 'x', name: 'CI' }])];
      return { total_count: total, workflow_runs: rows };
    };
    const got = await listQueueRuns(api, 'o/r', since, until);
    t(B, 'a window over the cap is split in halves, never truncated',
      seenQ.length === 5 && seenQ[1].includes('created=2026-11-10T00:00:00Z..2026-11-10T01:59:59Z') && seenQ[3].includes('created=2026-11-10T02:00:00Z..2026-11-10T03:59:59Z'));
    t(B, 'every page of each half is read', got.calls === 5);
    t(B, 'a run listed in two slices counts once', got.runs.length === 299);
    const big = async () => ({ total_count: 5000, workflow_runs: mkRuns(100, 0) });
    t(B, 'a smallest slice still over the cap refuses', await throwsAsync(() => listQueueRuns(big, 'o/r', since, new Date(since.getTime() + 3600000)), 'NOT MEASURED'));
    const dies = async (p) => {
      if (/[?&]page=2/.test(p)) throw new Error('GET answered HTTP 502');
      return { total_count: 300, workflow_runs: mkRuns(100, 0) };
    };
    t(B, 'a page that cannot be read fails the whole listing, never a shorter one', await throwsAsync(() => listQueueRuns(dies, 'o/r', since, until), 'HTTP 502'));
  }

  // ── critical jobs
  {
    const B = 'critical run: the slowest jobs of the run that finished last';
    const green = Array.from({ length: 10 }, (_, i) => ({ sha: `g${i}`, criticalRun: { id: 100 + i, name: 'CI' } }));
    const asked = [];
    const job = (name, startMin, endMin, conclusion = 'success') => ({ name, conclusion, created_at: at(0), started_at: at(startMin), completed_at: at(endMin) });
    const api = async (p) => {
      asked.push(p);
      return { jobs: [job('Test Core', 1, 15), job('Build Core', 2, 8), job('Lint', 0, 3), job('Skip me', 0, 50, 'skipped'), job('a', 0, 1), job('b', 0, 1), job('c', 0, 2)] };
    };
    const got = await criticalJobs(api, 'o/r', green, 4);
    t(B, 'the sample is bounded and evenly spaced', got.sampled === 4 && same(asked.map((p) => /runs\/(\d+)\/jobs/.exec(p)[1]), ['100', '102', '105', '107']));
    t(B, 'five jobs, slowest first, keyed by workflow', got.jobs.length === 5 && got.jobs[0].job === 'CI / Test Core' && got.jobs[0].medianMinutes === 14);
    t(B, 'a skipped job is never ranked', !got.jobs.some((j) => j.job.endsWith('Skip me')));
    t(B, 'the wait for a runner is reported', got.jobs[0].medianWaitMinutes === 1);
  }

  // ── budget file
  {
    const B = 'budget file: the tracked file, and malformed shapes refused';
    let tracked = null;
    try { tracked = loadBudget(); } catch (e) { failures.push(`[${B}] the tracked budget does not load: ${e.message}`); }
    t(B, 'the tracked queue-budget.json loads and validates', tracked !== null);
    t(B, 'the fixture budget validates', validateBudget(FIX_BUDGET).length === 0);
    t(B, 'a missing median budget is refused', validateBudget({ ...FIX_BUDGET, budgetMedianMinutes: undefined }).some((x) => x.includes('budgetMedianMinutes')));
    t(B, 'an alarm under the median is refused', validateBudget({ ...FIX_BUDGET, alarmP90Minutes: 10 }).some((x) => x.includes('below')));
    t(B, 'an empty workflow list is refused', validateBudget({ ...FIX_BUDGET, queueWorkflows: [] }).some((x) => x.includes('queueWorkflows')));
    t(B, 'a duplicated workflow is refused', validateBudget({ ...FIX_BUDGET, queueWorkflows: ['CI', 'CI'] }).some((x) => x.includes('twice')));
    t(B, 'a note that does not name the maintainer is refused', validateBudget({ ...FIX_BUDGET, note: 'tune freely' }).some((x) => x.includes('maintainer')));
  }

  // ── the card
  {
    const B = 'card: files once, refreshes the oldest, refuses an unfinished scan';
    const reading = {
      repo: FIX_BUDGET.repo, window: { since: '2026-11-12T00:00:00Z', until: '2026-11-19T00:00:00Z' }, runs: 10,
      workflowsRead: FIX_BUDGET.queueWorkflows, unlistedWorkflows: {}, missingWorkflows: [],
      shas: { seen: 5, green: 4, red: 1, cancelled: 0, other: 0, running: 0 }, p50Minutes: 23, p90Minutes: 33, maxMinutes: 35,
      failureRate: { red: 1, completed: 5, ratio: 0.2 }, criticalRunWorkflows: { CI: 4 }, criticalJobs: { sampled: 4, jobs: [] },
      verdict: 'over', reasons: ['median 23 min is over the 22-minute budget'],
    };
    const env = { GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '9', GITHUB_SHA: 'c'.repeat(40) };
    const issuesState = [];
    const doubles = ({ pages, typeRefused = false }) => {
      const calls = [];
      const reports = [];
      const rest = {
        issues: {
          listForRepo: async (p) => { calls.push(['list', p.page]); return { data: pages(p.page) }; },
          create: async (p) => { calls.push(['create', p.title, p.labels.join(',')]); issuesState.push({ number: 501, title: p.title, body: p.body }); return { data: { number: 501 } }; },
          update: async (p) => {
            calls.push(['update', p.issue_number, p.type ? `type=${p.type}` : 'body', 'labels' in p ? 'LABELS' : '']);
            if (p.type && typeRefused) throw new Error('HTTP 422');
            return { data: {} };
          },
        },
      };
      const core = { notice: (m) => reports.push(['notice', m]), warning: (m) => reports.push(['warning', m]) };
      return { github: { rest }, context: { repo: { owner: 'objectstack-ai', repo: 'objectstack' }, eventName: 'schedule' }, core, calls, reports };
    };
    const others = (n) => Array.from({ length: n }, (_, i) => ({ number: 1000 + i, title: `other ${i}`, body: '' }));
    const now = () => new Date('2026-11-19T07:09:00Z');

    const d1 = doubles({ pages: () => others(3) });
    const r1 = await fileQueueCard({ ...d1, reading, budget: FIX_BUDGET, env, now });
    t(B, 'no open card ⇒ files one, labels on create', r1.action === 'filed' && same(d1.calls.slice(0, 2), [['list', 1], ['create', CARD_TITLE, CARD_LABELS.join(',')]]));
    t(B, '…then sets the issue type in its own write', same(d1.calls[2], ['update', 501, 'type=Task', '']));
    // The second run sees the first run's card: it refreshes, never files twice.
    const d2 = doubles({ pages: () => [...others(2), ...issuesState] });
    const r2 = await fileQueueCard({ ...d2, reading, budget: FIX_BUDGET, env, now });
    t(B, '⭐ a second run refreshes the card the first one filed, never a second card', r2.action === 'refreshed' && r2.number === 501 && !d2.calls.some((c) => c[0] === 'create'));
    t(B, 'a refresh rewrites the body and never the labels', same(d2.calls[1], ['update', 501, 'body', '']));
    const d3 = doubles({ pages: () => [{ number: 90, title: CARD_TITLE, body: '' }, { number: 40, title: 'renamed', body: `${CARD_MARKER} — marker` }, { number: 30, title: CARD_TITLE, pull_request: {} }] });
    const r3 = await fileQueueCard({ ...d3, reading, budget: FIX_BUDGET, env, now });
    t(B, 'the oldest open match wins, by title or marker; a pull request is never the card', r3.number === 40);
    const d4 = doubles({ pages: () => others(100) });
    t(B, 'a scan at its page bound refuses and writes nothing', await throwsAsync(() => fileQueueCard({ ...d4, reading, budget: FIX_BUDGET, env, now }), 'absence is NOT established') && !d4.calls.some((c) => c[0] !== 'list'));
    const d5 = doubles({ pages: (p) => (p < 3 ? others(100) : [{ number: 77, title: 'x', body: CARD_MARKER }]) });
    const r5 = await fileQueueCard({ ...d5, reading, budget: FIX_BUDGET, env, now });
    t(B, 'the scan pages until a short page and finds a card on page three', r5.number === 77 && d5.calls.filter((c) => c[0] === 'list').length === 3);
    const d6 = doubles({ pages: () => [], typeRefused: true });
    const r6 = await fileQueueCard({ ...d6, reading, budget: FIX_BUDGET, env, now });
    t(B, 'a refused type costs the type, never the card', r6.action === 'filed' && d6.reports.some(([k, m]) => k === 'warning' && m.includes('type')));
    t(B, 'a reading that is not over never files', await throwsAsync(() => fileQueueCard({ ...doubles({ pages: () => [] }), reading: { ...reading, verdict: 'within' }, budget: FIX_BUDGET, env, now }), 'only an OVER week files'));
    const body = renderCardBody(reading, FIX_BUDGET, { runUrl: 'u', sha: 's', eventName: 'schedule', sweptAt: now() });
    t(B, 'the body opens with the plain-text marker and carries no HTML comment or angle bracket',
      body.startsWith(CARD_MARKER) && !body.includes('<') && !body.includes('>') && createHash('sha256').update(body).digest('hex').length === 64);
  }

  // ── render
  {
    const B = 'render: the summary names its numbers, window and verdict';
    const reading = {
      repo: 'objectstack-ai/hotcrm', window: { since: 'S', until: 'U' }, runs: 3, workflowsRead: 'every merge_group workflow',
      unlistedWorkflows: { 'Docs Preview': 2 }, missingWorkflows: ['Governed Surface Guard'],
      shas: { seen: 3, green: 2, red: 1, cancelled: 0, other: 0, running: 0 }, p50Minutes: 8.5, p90Minutes: 9, maxMinutes: 9,
      failureRate: { red: 1, completed: 3, ratio: 0.333 }, criticalRunWorkflows: { CI: 2 },
      criticalJobs: { sampled: 2, jobs: [{ job: 'CI / a|b', sampled: 2, medianMinutes: 4, medianWaitMinutes: 0.5 }] },
      verdict: 'report-only', reasons: ['read for the record'],
    };
    const text = renderReading(reading, FIX_BUDGET).join('\n');
    t(B, 'the window and the verdict are named', text.includes('S .. U') && text.includes('REPORT-ONLY'));
    t(B, 'p50, p90 and max are printed with the sample', text.includes('n=2') && text.includes('p50 **8.5 min**') && text.includes('p90 **9 min**'));
    t(B, 'a repo without a budget says report-only and nothing filed', text.includes('nothing is filed for it'));
    t(B, 'unlisted and missing workflows are warned about', text.includes('Docs Preview (2 runs)') && text.includes('no run in the window: Governed Surface Guard'));
    t(B, 'a pipe inside a job name cannot break the table', text.includes('| CI / a/b |'));
  }

  // ── floor
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failures.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it`);
  }
  for (const [name, count] of seen) {
    if (!declared.includes(name)) failures.push(`battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      failures.push(count === 0
        ? `battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned`
        : `battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do; ⛔ never lower the number`);
    }
  }

  if (failures.length > 0) {
    console.error(`✗ queue-duration --self-test: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ queue-duration --self-test: ${checked} assertions across ${declared.length} floored batteries.`);
  selfTestReachedVerdict = true;
}

// ── CLI ────────────────────────────────────────────────────────────────────

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv) {
  const budget = loadBudget();
  const render = argValue(argv, '--render');
  if (render) {
    const reading = JSON.parse(fs.readFileSync(render, 'utf8'));
    console.log(renderReading(reading, budget).join('\n'));
    return 0;
  }
  const now = new Date();
  const repo = argValue(argv, '--repo') ?? budget.repo;
  const since = parseSince(argValue(argv, '--since') ?? '7d', now);
  const until = argValue(argv, '--until') ? parseSince(argValue(argv, '--until'), now) : now;
  const jobSample = Number(argValue(argv, '--job-sample') ?? 40);
  const api = makeApi({ via: argValue(argv, '--via') ?? 'fetch' });
  let reading;
  try {
    reading = await readQueue({ api, repo, since, until, budget, jobSample });
  } catch (error) {
    console.error(`queue-duration: NOT MEASURED for ${repo} — ${error?.message ?? error}`);
    if (argv.includes('--json')) console.log(JSON.stringify({ repo, verdict: 'not-measured', reasons: [String(error?.message ?? error)] }));
    return 2;
  }
  if (argv.includes('--json')) console.log(JSON.stringify(reading, null, 2));
  else console.log(renderReading(reading, budget).join('\n'));
  return reading.verdict === 'not-measured' ? 2 : 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
    if (!selfTestReachedVerdict) {
      console.error('\n✗ queue-duration self-test: selfTest() returned without reaching its verdict, so no success line was printed.\n'
        + 'Exiting 0 here would report a self-test that never finished as one that passed.\n');
      process.exit(1);
    }
  } else {
    process.exit(await main(process.argv.slice(2)));
  }
}
