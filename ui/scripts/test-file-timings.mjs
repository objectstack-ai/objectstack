#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * test-file-timings -- per-file test durations, measured on `main`'s full
 * battery and turned into `scripts/test-shard-timings.json`, the dataset the
 * duration-balanced shard split reads (objectui#12208, ruling 6121816480,
 * letter B).
 *
 * ONE file, three parts, so the report format has exactly one spelling:
 *
 *   THE WRITER, this module's default export: a vitest reporter. `ci.yml`'s
 *   `test` job adds it beside the reporters vitest would have picked on its
 *   own, on the full battery's events, and uploads what it writes as the
 *   `test-file-timings-N` artifact of shard N:
 *
 *     pnpm test --shard=N/M --reporter=default --reporter=github-actions \
 *       --reporter=./scripts/test-file-timings.mjs
 *     -> $OBJECTUI_TEST_TIMINGS_OUT   (no variable, no file: one stderr line)
 *
 *   THE SELECTOR, `select`: the newest completed full-battery `CI` runs on
 *   `main` whose M test shards ALL reported success and whose M timing
 *   artifacts are all still there.
 *
 *     node scripts/test-file-timings.mjs select --shards 16 --limit 6 > runs.json
 *
 *   THE GENERATOR, `merge`: one directory per run (the run id is the
 *   directory's name), every report under it read; per run a file's
 *   durations are summed, across runs the MEDIAN is kept, and the dataset is
 *   keyed by `pathKey()` of each file, never by its path.
 *
 *     node scripts/test-file-timings.mjs merge --runs-file runs.json \
 *       --out scripts/test-shard-timings.json [--summary body.md] DIR...
 *
 * `.github/workflows/test-shard-timings-refresh.yml` drives the last two on a
 * timer and opens the pull request; ⛔ nothing writes the dataset by hand.
 *
 * ## Why not vitest's built-in `json` reporter
 *
 * Its per-file `startTime` / `endTime` span the file's TESTS -- the first
 * test's start to the last test's end (vitest 4.1.10, `JsonReporter`). A
 * module's import, its setup files and its environment fall outside that
 * span, and in this repository they are most of a file's cost: `isolate: true`
 * re-executes the setup per file, and the `dom-heavy` setup registers four
 * packages' components into every file of that project. A split balanced on
 * the json span would balance the part that does not decide a leg's wall.
 * The writer records vitest's public module diagnostic instead
 * (`TestModule.diagnostic()`): environment + prepare + setup + import + run,
 * the module's whole time on its worker. The same reading cloud#2806 took
 * for the same reason.
 *
 * ## What a file's number is, and what it is not
 *
 * The sum of the module's phases on its worker. Legs run files on parallel
 * workers, so a leg's wall is roughly its files' sum over the worker count
 * plus fixed start-up; the split balances the sums, which is what the wall
 * follows. In the `unit` project (`isolate: false`) a worker shares one
 * module graph across files, so a file that imports a module first pays for
 * it and later files do not: those numbers depend on the neighbours a file
 * had, and the median across runs is what keeps one run's neighbours from
 * deciding them.
 *
 * ## Report-only, all three parts
 *
 * The writer never throws into vitest: a failure is one stderr line and no
 * report, never a red test task. The selector and the generator gate nothing;
 * the refresh workflow opens a pull request, and a person (or a seat) lands it.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';
import { TIMINGS_SCHEMA, datasetWeights, pathKey } from './test-shard-partition.mjs';

/** The writer's report schema. The generator refuses any other tag rather than reading it as empty. */
export const REPORT_SCHEMA = 'objectui.test-file-timings/1';
/** The environment variable naming the writer's output file. */
export const OUT_ENV = 'OBJECTUI_TEST_TIMINGS_OUT';
/** The dataset rounds every file's median to this many ms, so noise below it does not churn the file. */
export const ROUND_MS = 10;
/** The artifact name of shard N's report, as `ci.yml` uploads it. */
export const artifactName = (/** @type {number} */ n) => `test-file-timings-${n}`;
/** The check-run name of shard N of M, as `ci.yml`'s `test` job spells it. */
export const shardJobName = (/** @type {number} */ n, /** @type {number} */ m) => `Test (shard ${n}/${m})`;

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
/** The question could not be answered: no eligible run, or an unreadable API. Nothing was written. */
export const EXIT_NOT_MEASURED = 3;

const ms = (/** @type {unknown} */ value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const posix = (/** @type {string} */ p) => p.split(path.sep).join('/');

/**
 * `fn()`, or `fallback` when it throws or answers nothing: the writer reads an
 * API it does not own and must never throw into the run it observes.
 *
 * @template T
 * @param {() => T} fn
 * @param {T} fallback
 * @returns {T}
 */
function attempt(fn, fallback) {
  try {
    const value = fn();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

/**
 * One test module, as vitest 4 hands it to `onTestRunEnd`, reduced to the
 * record the dataset needs.
 *
 * @param {any} testModule
 * @param {string} root
 */
export function fileRecord(testModule, root) {
  const d = attempt(() => testModule.diagnostic(), /** @type {Record<string, unknown>} */ ({}));
  const wall =
    ms(d.environmentSetupDuration) + ms(d.prepareDuration) + ms(d.setupDuration) + ms(d.collectDuration) + ms(d.duration);
  return {
    file: posix(path.relative(root, String(attempt(() => testModule.moduleId, '?')))),
    project: String(attempt(() => testModule.project.name, '')),
    ms: Math.round(wall),
    state: String(attempt(() => testModule.state(), 'unknown')),
  };
}

export default class FileTimingsReporter {
  constructor() {
    /** @type {any} */
    this.ctx = undefined;
  }

  /** @param {any} ctx */
  onInit(ctx) {
    this.ctx = ctx;
  }

  /** @param {ReadonlyArray<any>} testModules */
  onTestRunEnd(testModules) {
    const out = process.env[OUT_ENV];
    if (!out) {
      process.stderr.write(`test-file-timings: ${OUT_ENV} is not set, so no per-file timing report was written.\n`);
      return;
    }
    try {
      const config = this.ctx?.config ?? {};
      const root = String(config.root ?? process.cwd());
      const shard = config.shard ? `${config.shard.index}/${config.shard.count}` : null;
      const report = {
        schema: REPORT_SCHEMA,
        shard,
        coverage: Boolean(attempt(() => config.coverage.enabled, false)),
        files: [...(testModules ?? [])].map((m) => fileRecord(m, root)),
      };
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `${JSON.stringify(report)}\n`);
    } catch (error) {
      process.stderr.write(`test-file-timings: no report written: ${attempt(() => /** @type {Error} */ (error).message, String(error))}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/**
 * Every writer report under a run's directory, checked.
 *
 * @param {string} dir
 * @returns {Array<{ shard: string|null, files: Array<{ file: string, ms: number }> }>}
 */
export function readRunReports(dir) {
  /** @type {string[]} */
  const found = [];
  const walk = (/** @type {string} */ d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith('.json')) found.push(p);
    }
  };
  walk(dir);
  return found.sort().map((p) => {
    const report = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (report?.schema !== REPORT_SCHEMA || !Array.isArray(report.files)) {
      throw new Error(`${p} is not a ${REPORT_SCHEMA} report`);
    }
    return report;
  });
}

/**
 * One run's per-file durations: every report of the run, a file summed where
 * it appears more than once (a file in two projects runs twice).
 *
 * @param {Array<{ files: Array<{ file: string, ms: number }> }>} reports
 * @returns {Map<string, number>}
 */
export function runDurations(reports) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const report of reports) {
    for (const row of report.files) {
      if (typeof row?.file !== 'string' || typeof row.ms !== 'number' || !Number.isFinite(row.ms) || row.ms < 0) {
        throw new Error(`a report row is not { file, ms }: ${JSON.stringify(row)}`);
      }
      out.set(row.file, (out.get(row.file) ?? 0) + row.ms);
    }
  }
  return out;
}

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Each file's median across the runs that ran it, rounded to `ROUND_MS`, by
 * PATH. A file no run ran is absent (a deleted file drops out; a new one is
 * weighed at the dataset median until it is measured).
 *
 * @param {Array<{ durations: Map<string, number> }>} runs
 * @returns {Map<string, number>}
 */
export function medianDurations(runs) {
  /** @type {Map<string, number[]>} */
  const seen = new Map();
  for (const run of runs) {
    for (const [file, value] of run.durations) {
      const list = seen.get(file) ?? [];
      list.push(value);
      seen.set(file, list);
    }
  }
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const file of [...seen.keys()].sort()) {
    out.set(file, Math.round(median(/** @type {number[]} */ (seen.get(file))) / ROUND_MS) * ROUND_MS);
  }
  return out;
}

/**
 * The dataset, from several runs' per-file durations: `medianDurations()`
 * keyed by `pathKey()` -- never by the path, for the reason `pathKey` states.
 * Keys are sorted, so the same inputs always give the same bytes.
 *
 * @param {{ runs: Array<{ meta: Record<string, unknown>, durations: Map<string, number> }>, measuredAt: string }} input
 */
export function buildDataset({ runs, measuredAt }) {
  if (runs.length === 0) throw new Error('no run to build the dataset from');
  /** @type {Map<string, number>} */
  const byKey = new Map();
  for (const [file, value] of medianDurations(runs)) {
    const key = pathKey(file);
    if (byKey.has(key)) throw new Error(`pathKey collision on ${file}: pick a longer key before this dataset can be written`);
    byKey.set(key, value);
  }
  /** @type {Record<string, number>} */
  const files = {};
  for (const key of [...byKey.keys()].sort()) files[key] = /** @type {number} */ (byKey.get(key));
  const dataset = {
    schema: TIMINGS_SCHEMA,
    generated_by:
      'scripts/test-file-timings.mjs merge, from the per-file timing reports of the runs under measured.runs; ' +
      'each key is pathKey() of a test file (scripts/test-shard-partition.mjs says why it is not the path). ' +
      'Never hand-edited: .github/workflows/test-shard-timings-refresh.yml regenerates it weekly from main (objectui#12208).',
    // Sorted by run id, so the order the directories were named in cannot move a byte.
    measured: {
      at: measuredAt,
      runs: runs.map((r) => r.meta).sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true })),
    },
    files,
  };
  datasetWeights(dataset); // the reader's own check, so the writer cannot emit what the reader refuses
  return dataset;
}

/**
 * The refresh pull request's account of a regenerated dataset, against the one
 * it replaces: which runs it read, which files arrived and how many left, and
 * the heaviest files. Names come from the runs' reports (`medians`); the
 * dataset itself carries none. Markdown, and no angle-bracket shapes (GitHub
 * strips them).
 *
 * @param {Map<string, number>} medians  `medianDurations()` of the same runs
 * @param {{ files: Record<string, number>, measured: { at: string, runs: Array<Record<string, unknown>> } }} dataset
 * @param {unknown} previous  the committed dataset, or null
 */
export function summarize(medians, dataset, previous) {
  const before = new Set(Object.keys(/** @type {{ files?: Record<string, number> } | null} */ (previous)?.files ?? {}));
  const added = [...medians.keys()].filter((f) => !before.has(pathKey(f)));
  const dropped = [...before].filter((k) => !(k in dataset.files)).length;
  const total = [...medians.values()].reduce((a, b) => a + b, 0);
  const heaviest = [...medians.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10);
  const secs = (/** @type {number} */ v) => `${(v / 1000).toFixed(1)} s`;
  const list = (/** @type {string[]} */ files) =>
    files.length === 0 ? ['- none'] : [...files.slice(0, 20).map((f) => `- \`${f}\``), ...(files.length > 20 ? [`- and ${files.length - 20} more`] : [])];
  return [
    `Measured ${dataset.measured.at}, the median of ${dataset.measured.runs.length} full-battery run(s):`,
    '',
    ...dataset.measured.runs.map((r) => `- run ${String(r.id)} (${String(r.event)}, \`${String(r.head_sha ?? '').slice(0, 10)}\`)`),
    '',
    `${medians.size} files, ${secs(total)} summed over their workers.`,
    '',
    `**Measured for the first time (${added.length}):**`,
    ...list(added),
    '',
    `**No longer measured: ${dropped}.**`,
    '',
    '**The ten heaviest files:**',
    ...heaviest.map(([f, v]) => `- ${secs(v)} \`${f}\``),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The selector
// ---------------------------------------------------------------------------

/**
 * Whether one run can feed the dataset: all M test shards concluded `success`
 * and all M timing artifacts are present and unexpired. A shard that failed or
 * was cancelled may have stopped part-way, and its report would weigh the
 * files it reached against a run that never reached the rest.
 *
 * @param {{ jobs: Array<{ name?: unknown, conclusion?: unknown }>, artifacts: Array<{ name?: unknown, expired?: unknown }>, shards: number }} input
 * @returns {{ eligible: boolean, why: string }}
 */
export function judgeRun({ jobs, artifacts, shards }) {
  for (let n = 1; n <= shards; n += 1) {
    const job = jobs.find((j) => j.name === shardJobName(n, shards));
    if (!job) return { eligible: false, why: `${shardJobName(n, shards)} is not in the run` };
    if (job.conclusion !== 'success') return { eligible: false, why: `${shardJobName(n, shards)} concluded ${String(job.conclusion)}` };
    const artifact = artifacts.find((a) => a.name === artifactName(n));
    if (!artifact) return { eligible: false, why: `artifact ${artifactName(n)} is not on the run` };
    if (artifact.expired === true) return { eligible: false, why: `artifact ${artifactName(n)} has expired` };
  }
  return { eligible: true, why: `all ${shards} shards succeeded and all ${shards} timing artifacts are present` };
}

/**
 * @param {string} route
 * @param {{ token: string, apiUrl: string, fetchImpl: typeof fetch }} input
 */
async function apiGet(route, { token, apiUrl, fetchImpl }) {
  const res = await fetchImpl(`${apiUrl}${route}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${route} -> HTTP ${res.status}`);
  return res.json();
}

/**
 * The newest eligible full-battery runs, newest first, at most `limit`.
 *
 * @param {{ shards: number, limit: number, repository?: string, token?: string, apiUrl?: string, fetchImpl?: typeof fetch, log?: (line: string) => void }} input
 */
export async function selectRuns({
  shards,
  limit,
  repository = process.env.GITHUB_REPOSITORY ?? '',
  token = process.env.GITHUB_TOKEN ?? '',
  apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com',
  fetchImpl = globalThis.fetch,
  log = () => {},
}) {
  if (!repository) throw new Error('GITHUB_REPOSITORY is not set');
  const io = { token, apiUrl, fetchImpl };
  const listing = await apiGet(`/repos/${repository}/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=50`, io);
  /** @type {Array<{ id: number, event: string, head_sha: string, created_at: string }>} */
  const chosen = [];
  // Two reads per run examined, on the repository's one shared `GITHUB_TOKEN`
  // budget: stop after a bounded number of candidates, eligible or not.
  let examined = 0;
  for (const run of listing?.workflow_runs ?? []) {
    if (chosen.length >= limit || examined >= limit * 5) break;
    // The full battery: `push` and the hourly `schedule` (objectui#12214).
    if (run.event !== 'push' && run.event !== 'schedule') continue;
    examined += 1;
    const jobs = (await apiGet(`/repos/${repository}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`, io))?.jobs ?? [];
    const artifacts = (await apiGet(`/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`, io))?.artifacts ?? [];
    const verdict = judgeRun({ jobs, artifacts, shards });
    log(`${verdict.eligible ? 'take' : 'skip'} run ${run.id} (${run.event}, ${String(run.head_sha).slice(0, 10)}): ${verdict.why}`);
    if (verdict.eligible) chosen.push({ id: run.id, event: run.event, head_sha: run.head_sha, created_at: run.created_at });
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

/** @param {string[]} argv */
function options(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  /** @type {string[]} */
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      flags[a.slice(2)] = argv[i + 1] ?? '';
      i += 1;
    } else rest.push(a);
  }
  return { flags, rest };
}

/** @param {string[]} argv */
export async function main(argv) {
  const [command, ...tail] = argv;
  const { flags, rest } = options(tail);

  if (command === 'select') {
    const shards = Number(flags.shards);
    const limit = Number(flags.limit ?? '6');
    if (!Number.isInteger(shards) || shards < 1 || !Number.isInteger(limit) || limit < 1) {
      console.error('usage: node scripts/test-file-timings.mjs select --shards M [--limit K]');
      return EXIT_USAGE;
    }
    let runs;
    try {
      runs = await selectRuns({ shards, limit, log: (line) => console.error(line) });
    } catch (error) {
      console.error(`NOT MEASURED: the runs could not be read: ${error instanceof Error ? error.message : String(error)}`);
      return EXIT_NOT_MEASURED;
    }
    if (runs.length === 0) {
      console.error(`NOT MEASURED: no completed full-battery run on main has all ${shards} shards green and all ${shards} timing artifacts.`);
      return EXIT_NOT_MEASURED;
    }
    console.log(JSON.stringify(runs, null, 2));
    return EXIT_OK;
  }

  if (command === 'merge') {
    if (!flags.out || !flags['runs-file'] || rest.length === 0) {
      console.error('usage: node scripts/test-file-timings.mjs merge --runs-file runs.json --out FILE [--summary FILE] DIR...');
      return EXIT_USAGE;
    }
    /** @type {Array<Record<string, unknown>>} */
    const metas = JSON.parse(fs.readFileSync(flags['runs-file'], 'utf8'));
    const runs = rest.map((dir) => {
      const id = path.basename(path.resolve(dir));
      const meta = metas.find((m) => String(m.id) === id);
      if (!meta) throw new Error(`${dir}: no entry with id ${id} in ${flags['runs-file']}`);
      return { meta, durations: runDurations(readRunReports(dir)) };
    });
    const measuredAt = metas
      .map((m) => String(m.created_at ?? ''))
      .sort()
      .at(-1);
    const dataset = buildDataset({ runs, measuredAt: measuredAt ?? '' });
    /** @type {unknown} */
    let previous = null;
    try {
      previous = JSON.parse(fs.readFileSync(flags.out, 'utf8'));
    } catch {
      previous = null;
    }
    fs.writeFileSync(flags.out, `${JSON.stringify(dataset, null, 1)}\n`);
    const n = Object.keys(dataset.files).length;
    console.log(`wrote ${flags.out}: ${n} files from ${runs.length} run(s), measured ${measuredAt}`);
    if (flags.summary) fs.writeFileSync(flags.summary, summarize(medianDurations(runs), dataset, previous));
    return EXIT_OK;
  }

  console.error('usage: node scripts/test-file-timings.mjs select|merge ... (see the file header)');
  return EXIT_USAGE;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
