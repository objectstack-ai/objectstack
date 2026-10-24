#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Census: why the push lane's coverage gate was red, run by run — objectui#8545.
 *
 * ⚠️ This is a ONE-OFF CENSUS, not a gate. It is deliberately NOT wired into any
 * workflow, it never fails a build, and nothing in CI calls it. It exists so the
 * numbers objectui#8545 publishes stay REPRODUCIBLE from a file instead of being
 * claims about a deleted scratch script. ⛔ Do not add it to `.github/workflows`
 * without answering, on a card, what it would be gating.
 *
 * Run:
 *   NODE_USE_ENV_PROXY=1 node scripts/coverage-red-cause-census.mjs --fetch --since=2026-09-02 > snap.json
 *   node scripts/coverage-red-cause-census.mjs --snapshot=snap.json
 *
 * `NODE_USE_ENV_PROXY=1` is not decoration on a proxied host: Node's built-in
 * `fetch` ignores `HTTPS_PROXY`, so `--fetch` answers 403 on the very first
 * page and the 403 reads exactly like a permissions problem. Measured on Node
 * v22.22.2. The `--snapshot` path needs no network at all.
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION
 * ---------------------------------------------------------------------------
 *
 * objectui#6055 measured that a large share of push-lane merges were red at the
 * coverage gate, and said plainly that this was a CORRELATION between two
 * measurements — it never classified those failures by cause. This file is that
 * classification.
 *
 * ---------------------------------------------------------------------------
 * THE DELIVERY PROBE — artifact presence, ⛔ never a run-level conclusion
 * ---------------------------------------------------------------------------
 *
 * A run is "red at the coverage gate" when the `coverage-report` artifact is
 * ABSENT from it. objectui#6055 re-confirmed independently that a run's
 * `conclusion` is NOT a delivery proxy: it found `conclusion=cancelled` runs
 * that had nevertheless delivered the artifact. `deliveredCoverageReport()`
 * below is therefore the only admissible probe, and `conclusion` is carried in
 * the snapshot for reporting only.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CAUSE CANNOT BE READ OFF A JOB LOG — the resolution limit, stated
 * ---------------------------------------------------------------------------
 *
 * The push lane runs `pnpm test:coverage --reporter=blob …` (ci.yml, the
 * `test-coverage` job). `--reporter=blob` REPLACES the default reporter set, so
 * a failing shard's job log contains no failing-test names, no assertion text
 * and no `Test timed out in 15000ms` line: it goes from whatever the tests
 * themselves printed on stdout straight to `blob report written to …` and
 * `ELIFECYCLE Command failed with exit code 1`. The failures do exist, inside
 * the `coverage-blob-N` artifact — which is downloadable only, not readable
 * through the API.
 *
 * ⇒ per-run failing-test identity is NOT recoverable from CI. This census
 * therefore classifies by the two readings that ARE recoverable, and says so
 * rather than inferring a cause from "it was red and something was slow":
 *
 *   (1) WHICH SHARD failed, paired with WHICH SHARD a named suspect file
 *       computes into on that exact tree — `shardOf()` below is a replica of
 *       vitest's own sequencer, so this is arithmetic on the tree, not a guess.
 *   (2) WHETHER THE SAME TREE PASSED UNINSTRUMENTED, from the `merge_group`
 *       lane, which runs the same 4-way split over the same files without
 *       `--coverage` (ci.yml gave `test` `if: github.event_name != 'push'`
 *       when this was written; since objectui#12214 a `merge_group` run
 *       carries only the affected set, and the uninstrumented whole suite
 *       runs on `push` and `schedule` beside the coverage lane).
 *
 * ⚠️ Reading (2) has a selection trap that has to be named: a commit only lands
 * if its merge_group run went green, so "every landed sha had a green
 * merge_group run" is TAUTOLOGICAL and proves nothing on its own. What is NOT
 * tautological is the merge_group runs that FAILED — those trees never landed,
 * and they are in the data. Comparing the per-shard failure RATE of the two
 * lanes over the same period is the reading that carries weight.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { isEntrypoint } from './invoked-as.mjs';

const API = 'https://api.github.com/repos';

/** Files vitest treats as specs, from a tracked-path list. */
const SPEC_RE = /\.(test|spec)\.(ts|tsx|js|mjs|cts|mts)$/;

/**
 * The spec set of a tree, from `git ls-tree -r --name-only <sha>` output.
 *
 * `e2e/` is excluded because those are Playwright specs, reached by
 * `playwright.config.ts` and by no vitest project. The rule is not assumed:
 * against `pnpm exec vitest list --filesOnly` on 6214db63f it reproduces the
 * spec set EXACTLY — 2998 paths, zero in either direction — and the 31 paths
 * the raw regex adds are all and only `e2e/`.
 */
export function specFilesFrom(trackedPaths) {
  return trackedPaths.filter((p) => SPEC_RE.test(p) && !p.startsWith('e2e/'));
}

/**
 * Replica of vitest's `BaseSequencer.calculateShardRange` (vitest 4.1.10).
 * Kept as its own export so the test can pin it against the upstream algebra
 * rather than only through `shardOf`.
 */
export function shardRange(filesCount, index, count) {
  const base = Math.floor(filesCount / count);
  const remainder = filesCount % count;
  if (remainder >= index) {
    const size = base + 1;
    return [size * (index - 1), size * index];
  }
  const start = remainder * (base + 1) + (index - remainder - 1) * base;
  return [start, start + base];
}

/**
 * Replica of vitest's `BaseSequencer.shard` (vitest 4.1.10): sha1 of the spec
 * path relative to the config root (which always begins with `/`), sorted by
 * that hex digest, then sliced by `shardRange`.
 *
 * VALIDATED, not asserted: computed against a real
 * `pnpm exec vitest run --shard=3/4 --project @object-ui/console` on 6214db63f,
 * the two file sets are identical — 24 of 24, empty in both directions.
 *
 * ⚠️ Shard membership is a function of the WHOLE spec list, so it moves when
 * files are added anywhere in the repository. That is objectui#8545's own
 * point: a file can cross a shard boundary with nobody editing it.
 *
 * ⚠️ This replicates vitest's DEFAULT split, which describes the runs this
 * census was written for. Since objectui#12208 the root config's sequencer
 * (`scripts/test-shard-sequencer.mjs`) splits by measured duration whenever
 * `scripts/test-shard-timings.json` holds a measurement, so for a run on a
 * tree whose dataset is non-empty this replica no longer names the shard a
 * file ran in.
 */
export function shardOf(specPaths, index, count) {
  const rows = specPaths.map((p) => ({ p, h: createHash('sha1').update(`/${p}`).digest('hex') }));
  rows.sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
  const [start, end] = shardRange(rows.length, index, count);
  return rows.slice(start, end).map((r) => r.p);
}

/** Which 1-based shard of `count` a single spec path lands in, or null. */
export function shardIndexOf(specPaths, target, count = 4) {
  for (let i = 1; i <= count; i += 1) if (shardOf(specPaths, i, count).includes(target)) return i;
  return null;
}

/** The delivery probe. ⛔ Never read `conclusion` for this. */
export function deliveredCoverageReport(artifacts) {
  return artifacts.some((a) => a.name === 'coverage-report');
}

/**
 * The proximate reading: which coverage shards failed, and at which STEP.
 * The step matters — a shard that died in `Upload this shard's blob report`
 * ran its tests green and is not a test failure at all.
 */
export function proximateCause(jobs) {
  const shards = new Set();
  const kinds = new Set();
  for (const job of jobs) {
    // Any width: the runs this census reads were 4-way, and objectui#12256
    // made the lane 8-way. A width-pinned pattern would read every newer run
    // as having no coverage shard at all, which is a silent zero.
    const match = /^Test \(coverage shard (\d+)\/\d+\)$/.exec(job.name);
    if (!match) continue;
    if (job.conclusion === 'cancelled') {
      kinds.add('run-cancelled');
      continue;
    }
    if (job.conclusion !== 'failure') continue;
    shards.add(Number(match[1]));
    const failed = (job.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => s.name);
    if (failed.some((n) => n.startsWith('Run tests with coverage'))) kinds.add('vitest-nonzero');
    else if (failed.some((n) => n.startsWith("Upload this shard's blob report"))) kinds.add('blob-upload');
    else kinds.add('runner-setup');
  }
  return { failingShards: [...shards].sort(), kinds: [...kinds].sort() };
}

/**
 * Attribute one red run to a named un-hoisted corpus-walk suspect.
 *
 * A suspect is `{ name, path, liveFrom, liveUntil }` — the window in which its
 * walk sat inside the timed assertion window on `main`. A run is attributed when
 * it is inside that window AND the shard the suspect computes into on that run's
 * own tree is one of the shards that actually failed.
 *
 * ⚠️ This is an attribution, ⛔ not an observation of the failing test: see the
 * resolution-limit section in the header. Its strength comes from the controls
 * the census prints alongside it — the same test applied OUTSIDE each suspect's
 * live window, where it must and does stop matching.
 */
export function attributeRun(run, suspects) {
  const failing = new Set(run.failingShards.map(String));
  return suspects
    .filter((s) => run.createdAt >= s.liveFrom && run.createdAt < s.liveUntil)
    .filter((s) => run.suspectShard?.[s.path] != null && failing.has(String(run.suspectShard[s.path])))
    .map((s) => s.name);
}

/** `git ls-tree` for one sha, as a tracked-path list. */
export function trackedPathsAt(sha, cwd = process.cwd()) {
  return execFileSync('git', ['ls-tree', '-r', '--name-only', sha], { cwd, encoding: 'utf8', maxBuffer: 64e6 })
    .split('\n')
    .filter(Boolean);
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/**
 * Page with explicit `&page=N` to a short page. ⛔ Not `Link: rel="next"`:
 * objectui#6055 measured that cursor walking exhausts early and under-counts the
 * population by about a quarter, which is how that card's own baseline
 * denominator came out short.
 */
async function listRuns(repo, event, since) {
  const rows = [];
  for (let page = 1; page <= 20; page += 1) {
    const url = `${API}/${repo}/actions/workflows/ci.yml/runs?event=${event}&status=completed&per_page=100&page=${page}`;
    const body = await getJson(url);
    const batch = body.workflow_runs ?? [];
    rows.push(...batch);
    if (batch.length < 100) break;
    if (batch[batch.length - 1].created_at < since) break;
  }
  return rows.filter((r) => r.created_at >= since);
}

async function fetchSnapshot(repo, since) {
  const push = await listRuns(repo, 'push', since);
  const mergeGroup = await listRuns(repo, 'merge_group', since);
  const runs = [];
  for (const run of push) {
    const [{ artifacts = [] }, { jobs = [] }] = await Promise.all([
      getJson(`${API}/${repo}/actions/runs/${run.id}/artifacts?per_page=100`),
      getJson(`${API}/${repo}/actions/runs/${run.id}/jobs?per_page=100`),
    ]);
    runs.push({
      id: run.id,
      sha: run.head_sha,
      createdAt: run.created_at,
      conclusion: run.conclusion,
      actor: run.actor?.login ?? null,
      delivered: deliveredCoverageReport(artifacts),
      ...proximateCause(jobs),
    });
  }
  return { repo, since, generatedAt: new Date().toISOString(), runs, mergeGroup: mergeGroup.map((r) => ({ id: r.id, sha: r.head_sha, createdAt: r.created_at, conclusion: r.conclusion })) };
}

/**
 * Summary the card reports: denominator, delivery split, cause split.
 *
 * ⚠️ THE UNIT IS A MERGE, NOT A RUN, and the difference is not pedantic. The
 * per-sha push concurrency group (objectui#6049) cancels a superseded run and
 * starts a fresh one on the SAME head sha seconds later; the cancelled one has
 * no `coverage-report` artifact and so reads as red, while the commit itself
 * got its merged report moments afterwards. Counting runs therefore
 * OVER-counts red. Measured over 2026-09-02..09-11 the gap is 4 runs in 700 —
 * small, and exactly the 4 that made this census's own first draft disagree
 * with objectui#6055's published 454/301 by two in each column. Collapsed by
 * sha, both numbers land on objectui#6055's to the unit.
 *
 * A merge is delivered when ANY of its runs delivered. A red merge's cause is
 * taken from its runs that failed.
 */
export function summarise(snapshot, suspects) {
  const bySha = new Map();
  for (const run of snapshot.runs) {
    if (!bySha.has(run.sha)) bySha.set(run.sha, []);
    bySha.get(run.sha).push(run);
  }
  const byCause = new Map();
  let red = 0;
  for (const runs of bySha.values()) {
    if (runs.some((r) => r.delivered)) continue;
    red += 1;
    const names = [...new Set(runs.flatMap((r) => attributeRun(r, suspects)))].sort();
    const key = names.length ? names.join(' + ') : 'unattributed';
    byCause.set(key, (byCause.get(key) ?? 0) + 1);
  }
  return {
    runs: snapshot.runs.length,
    merges: bySha.size,
    supersededRuns: snapshot.runs.length - bySha.size,
    delivered: bySha.size - red,
    red,
    redShare: red / Math.max(1, bySha.size),
    byCause: Object.fromEntries([...byCause].sort((a, b) => b[1] - a[1])),
  };
}

async function main() {
  const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const repo = arg('repo', 'objectstack-ai/objectui');
  const since = arg('since', '2026-09-02');

  if (process.argv.includes('--fetch')) {
    process.stdout.write(`${JSON.stringify(await fetchSnapshot(repo, since))}\n`);
    return;
  }

  const file = arg('snapshot', null);
  if (!file) {
    // ⛔ Refusing to answer over an empty input: a census nobody fed must not
    // read as "nothing was red".
    process.stderr.write('Pass --snapshot=<file>, or --fetch to build one.\n');
    process.exitCode = 1;
    return;
  }
  const snapshot = JSON.parse(await readFile(file, 'utf8'));
  const suspects = JSON.parse(await readFile(arg('suspects', 'scripts/coverage-red-cause-suspects.json'), 'utf8'));
  for (const run of snapshot.runs) {
    if (run.delivered || run.suspectShard) continue;
    const specs = specFilesFrom(trackedPathsAt(run.sha));
    run.suspectShard = Object.fromEntries(suspects.map((s) => [s.path, shardIndexOf(specs, s.path)]));
  }
  process.stdout.write(`${JSON.stringify(summarise(snapshot, suspects), null, 2)}\n`);
}

if (isEntrypoint(import.meta.url)) await main();
