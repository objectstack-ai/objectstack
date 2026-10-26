#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * report-turbo-cache -- what one turbo run REPLAYED from the cache and what it
 * re-executed, read from turbo's own run summary (objectui#12222).
 *
 *   node scripts/report-turbo-cache.mjs [--summary <file>] [--cache-dir <dir>]
 *   node scripts/report-turbo-cache.mjs --prune [--summary <file>] [--cache-dir <dir>]
 *
 * ci.yml's `Run type-check` step sets `TURBO_RUN_SUMMARY=true`, so turbo writes
 * its run summary to `.turbo/runs/<id>.json`. This script reads the newest one
 * (or `--summary`) and prints:
 *
 *   - per task name (`type-check`, `build`, ...): how many tasks the cache
 *     replayed, how many it missed, and how many are uncached by declaration
 *     (`"cache": false` in turbo.json, which turbo reports as a miss);
 *   - one line per missed task: its hash, how long it ran, and each task it
 *     depends on with that task's cache status and how many input files it
 *     hashes. A task's hash folds in the hashes of the tasks it depends on, so
 *     when every package misses, the dependency that moved is named here --
 *     that is how objectui#12222 read its miss: every `type-check` depended on
 *     the uncached root task `//#type-check:e2e`, whose default inputs were
 *     every tracked file in the repository;
 *   - the cache directory: entries and bytes, and how many of them this run
 *     did not use (`--cache-dir`, default `.turbo/cache`).
 *
 * `--prune` then DELETES every entry this run did not use, so the directory
 * holds exactly the verdicts and build outputs of the run that is about to
 * save it. ci.yml prunes on the full battery only (`push`, `schedule`),
 * whose summary covers every task: measured on objectui#12222's first run, the
 * cache a pull request restored -- another job's, through the bare
 * `turbo-<os>-` restore key -- held 401 entries and about 2 GB, 321 of them
 * unused, and an entry that size is what a size-limited cache store evicts
 * first. Pruning refuses to run without a summary that lists at least one
 * task: no summary means no knowledge of what is used, never "nothing is".
 *
 * The same counts go into ONE `::notice` annotation. An annotation is readable
 * through the check-runs API by a reader who cannot open the job log, which is
 * how "the cache replayed the packages the change did not touch" is read after
 * a change lands -- without copying any count into prose (AGENTS.md #9: the
 * instrument is the claim, its answer is not).
 *
 * It is bookkeeping and says nothing about the code under test: ci.yml runs it
 * after the job's last checking step, bounded and `continue-on-error`.
 *
 * Exit 0 = reported (and, with `--prune`, pruned). Exit 1 = no run summary
 * to read, or one with no task in it under `--prune`: the instrument broke,
 * not the code, and nothing was deleted. Exit 2 = bad arguments.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';

/** Where turbo writes run summaries, relative to the repository root. */
export const RUNS_DIR = '.turbo/runs';

/** Where turbo 2 keeps its local cache, relative to the repository root. */
export const CACHE_DIR = '.turbo/cache';

/** The newest run summary in `dir`, or null when there is none. */
export function newestSummary(dir = RUNS_DIR) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  let best = null;
  for (const name of names) {
    const file = path.join(dir, name);
    const mtime = fs.statSync(file).mtimeMs;
    if (!best || mtime > best.mtime) best = { file, mtime };
  }
  return best ? best.file : null;
}

/** True when turbo.json declares the task uncached: turbo then reports MISS by construction. */
const isUncached = (task) => task?.resolvedTaskDefinition?.cache === false;

/**
 * Per task name, the replayed / missed / uncached counts, and the missed tasks
 * themselves with their dependencies' status.
 *
 * @param {{ tasks?: Array<any> }} summary a turbo run summary
 */
export function summarize(summary) {
  const tasks = Array.isArray(summary?.tasks) ? summary.tasks : [];
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  /** @type {Map<string, { hit: number, miss: number, uncached: number }>} */
  const byTask = new Map();
  const missed = [];
  for (const t of tasks) {
    const row = byTask.get(t.task) ?? { hit: 0, miss: 0, uncached: 0 };
    byTask.set(t.task, row);
    if (isUncached(t)) {
      row.uncached += 1;
    } else if (t.cache?.status === 'HIT') {
      row.hit += 1;
    } else {
      row.miss += 1;
      const ms = t.execution ? t.execution.endTime - t.execution.startTime : null;
      missed.push({
        taskId: t.taskId,
        hash: t.hash,
        ms,
        dependencies: (t.dependencies ?? []).map((id) => {
          const dep = byId.get(id);
          return {
            taskId: id,
            status: dep ? (isUncached(dep) ? 'uncached' : (dep.cache?.status ?? 'unknown')) : 'not run',
            inputs: dep?.inputs ? Object.keys(dep.inputs).length : null,
          };
        }),
      });
    }
  }
  const uncachedTasks = tasks
    .filter(isUncached)
    .map((t) => ({ taskId: t.taskId, inputs: t.inputs ? Object.keys(t.inputs).length : null }));
  return { total: tasks.length, byTask, missed, uncachedTasks, hashes: new Set(tasks.map((t) => t.hash)) };
}

/**
 * The cache directory as turbo 2 lays it out: `<hash>.tar.zst` plus
 * `<hash>-meta.json` / `<hash>-manifest.json` per entry.
 *
 * @param {string} dir
 * @param {Set<string>} used the hashes this run read or wrote
 */
export function cacheDirStats(dir, used) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { present: false, entries: 0, bytes: 0, unused: 0, unusedBytes: 0 };
  }
  let bytes = 0;
  let unusedBytes = 0;
  let entries = 0;
  let unused = 0;
  for (const name of names) {
    const stat = fs.statSync(path.join(dir, name));
    if (!stat.isFile()) continue;
    bytes += stat.size;
    const owner = entryHash(name);
    if (owner !== null && !used.has(owner)) unusedBytes += stat.size;
    if (!name.endsWith('.tar.zst') || owner === null) continue;
    entries += 1;
    if (!used.has(owner)) unused += 1;
  }
  return { present: true, entries, bytes, unused, unusedBytes };
}

/** The hash a turbo cache file belongs to, or null for a file turbo's layout does not name. */
export function entryHash(name) {
  const m = name.match(/^([0-9a-f]+)(?:\.tar\.zst|-meta\.json|-manifest\.json)$/);
  return m ? m[1] : null;
}

/**
 * Delete every cache file whose entry this run did not use. Files outside
 * turbo's `<hash>.tar.zst` / `-meta.json` / `-manifest.json` layout are left
 * alone.
 *
 * @returns {{ files: number, bytes: number }} what was deleted
 */
export function pruneCacheDir(dir, used) {
  let files = 0;
  let bytes = 0;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { files, bytes };
  }
  for (const name of names) {
    const owner = entryHash(name);
    if (owner === null || used.has(owner)) continue;
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (!stat.isFile()) continue;
    fs.rmSync(file);
    files += 1;
    bytes += stat.size;
  }
  return { files, bytes };
}

const seconds = (ms) => (ms === null || ms === undefined ? '?' : `${(ms / 1000).toFixed(1)}s`);
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

/** The human report and the one-line annotation, from what the two readers above returned. */
export function render({ summaryFile, stats, cache, restoredKey }) {
  const lines = [`Turbo run summary: ${summaryFile}`];
  const parts = [];
  if (stats.total === 0) {
    lines.push('No task ran in this turbo run.');
    parts.push('no task ran');
  }
  for (const [task, row] of [...stats.byTask].sort(([a], [b]) => a.localeCompare(b))) {
    const cached = row.hit + row.miss;
    lines.push(`${task}: ${row.hit} replayed, ${row.miss} missed, ${row.uncached} uncached by declaration`);
    if (cached > 0) parts.push(`${task} ${row.hit}/${cached} replayed`);
  }
  for (const u of stats.uncachedTasks) {
    parts.push(`uncached ${u.taskId} (${u.inputs ?? '?'} input files)`);
  }
  if (stats.missed.length > 0) lines.push('', 'Missed (re-executed) tasks, with what each one depends on:');
  for (const m of stats.missed) {
    const deps = m.dependencies.map((d) => `${d.taskId} ${d.status}${d.inputs === null ? '' : ` (${d.inputs} inputs)`}`);
    lines.push(`  ${m.taskId} ${m.hash} ${seconds(m.ms)}${deps.length ? ` <- ${deps.join(', ')}` : ''}`);
  }
  lines.push('');
  if (cache.present) {
    const c = `${cache.entries} entries, ${megabytes(cache.bytes)}, ${cache.unused} (${megabytes(cache.unusedBytes ?? 0)}) not used by this run`;
    lines.push(`Cache directory: ${c}`);
    parts.push(`cache ${c}`);
  } else {
    lines.push('Cache directory: absent');
    parts.push('cache directory absent');
  }
  const restored = restoredKey ? restoredKey : 'nothing (cold)';
  lines.push(`Restored cache key: ${restored}`);
  parts.push(`restored ${restored}`);
  return { lines, notice: `::notice title=Turbo cache::${parts.join(' · ')}` };
}

function parseArgs(argv) {
  const out = { summary: null, cacheDir: CACHE_DIR, prune: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--prune') out.prune = true;
    else if (arg === '--summary' && argv[i + 1]) out.summary = argv[++i];
    else if (arg === '--cache-dir' && argv[i + 1]) out.cacheDir = argv[++i];
    else return { error: `unknown or incomplete argument: ${arg}` };
  }
  return out;
}

export function main(argv, env = process.env, log = console.log) {
  const args = parseArgs(argv);
  if ('error' in args) {
    console.error(`report-turbo-cache: ${args.error}`);
    return 2;
  }
  const summaryFile = args.summary ?? newestSummary(RUNS_DIR);
  if (!summaryFile || !fs.existsSync(summaryFile)) {
    log(`::warning title=Turbo cache::no turbo run summary under ${RUNS_DIR}; the instrument did not run (TURBO_RUN_SUMMARY unset?), the code under test is unaffected.`);
    return 1;
  }
  const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  const stats = summarize(summary);
  const cache = cacheDirStats(args.cacheDir, stats.hashes);
  const { lines, notice } = render({ summaryFile, stats, cache, restoredKey: env.RESTORED_CACHE_KEY ?? '' });
  for (const line of lines) log(line);
  // The annotation is the REPORT step's: a prune run after it would post the
  // same counts twice on one check run.
  if (!args.prune) {
    log(notice);
    return 0;
  }
  if (stats.total === 0) {
    log(`::warning title=Turbo cache::the run summary lists no task, so nothing is known to be used; not pruning ${args.cacheDir}.`);
    return 1;
  }
  const pruned = pruneCacheDir(args.cacheDir, stats.hashes);
  const kept = cacheDirStats(args.cacheDir, stats.hashes);
  log(`Pruned ${pruned.files} file(s), ${megabytes(pruned.bytes)}; kept ${kept.entries} entries, ${megabytes(kept.bytes)}.`);
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
