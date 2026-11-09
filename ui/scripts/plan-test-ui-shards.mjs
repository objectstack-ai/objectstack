#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * plan-test-ui-shards -- which `Test UI (k/16)` slots a run starts, and which
 * test files each one runs, decided once before any slot runner exists
 * (objectstack#31914). The root `ci.yml`'s `test-ui-plan` job writes the plan;
 * every `test-ui` leg derives it again and refuses to run on a mismatch.
 *
 *   node ui/scripts/plan-test-ui-shards.mjs plan --all ALL.json [--selected SEL.json [--lane LANE.txt]]
 *        --out PLAN.json [--github-output FILE] [--expect-digest HEX]
 *   node ui/scripts/plan-test-ui-shards.mjs files --plan PLAN.json --slot K
 *   node ui/scripts/plan-test-ui-shards.mjs verify-ran --plan PLAN.json --slot K --report REPORT.json
 *
 * `ALL.json` and `SEL.json` are `vitest list --filesOnly --json=FILE` output:
 * the whole suite, and the suite under the selector's filters. `LANE.txt` is
 * the selector's `--lane-out`: its always-on files, one ui-relative path per
 * line. Vitest's own
 * collection is the one authority on which files a set of filters runs, so the
 * planner never derives a file list of its own: a package filter that collects
 * a file the selector does not know about is still planned, and still checked.
 *
 * ## The waste this removes
 *
 * The `test-ui` matrix was the literal list 1..16, so every run that started
 * Test UI started sixteen runners. Each paid about 133 s before and around
 * its tests (job setup, a ~51 s checkout, install, and vitest's own start),
 * whatever it was handed (run 42478811805, a console-only pull request:
 * 3,371 runner-s, 16 legs of 81 to 194 s of test step). An affected
 * selection near the always-on floor needs one or two legs, not sixteen.
 *
 * ## The plan, Test Core's shape (`scripts/ci/plan-test-core-shards.mjs`)
 *
 * `16` stays the slot roster: the matrix is
 * `fromJSON(needs.test-ui-plan.outputs.shards || '[1, ..., 16]')`, a started
 * leg keeps its name `Test UI (k/16)`, and only the slots the plan fills start.
 * The roster is read off `ci.yml` by `scripts/ci-shard-matrix.mjs`, never
 * spelled here.
 *
 *   full      (every push and schedule run, a selector that fails open, and a
 *             plan job that died): all 16 slots, each leg running
 *             `--shard=k/16` through `scripts/test-shard-sequencer.mjs`
 *             exactly as before. The plan's bins are `planShards()` over the
 *             whole suite at 16, the split that sequencer makes, so a leg can
 *             check what it ran.
 *   affected  the selected files, grouped by path, packed longest first
 *             (`partition()`, the sequencer's own LPT) into N bins, N =
 *             clamp(ceil(P / D), 1, min(16, files)). P is the selection's
 *             predicted ms; D is the whole suite's predicted ms divided by the
 *             roster, computed on every run from the committed timings, never a
 *             literal: the bins average at most D, a full-battery leg's own
 *             mean, unless the file count caps N (a file heavier than D, which
 *             no split divides). Bin j
 *             runs on slot j, its files passed to vitest by exact path. A file
 *             is never split across bins, so a file two projects collect
 *             runs in both of them on one leg.
 *   the lane  (affected plans given `--lane`): the selection's ALWAYS-ON files,
 *             the ones the selector selects only because the package graph
 *             cannot place them, run together on slot 1, and the rest is
 *             packed as above into slots 2..N+1, N at most the roster less
 *             one, so when that cap binds the bins average at most
 *             roster / (roster - 1) of D (the rest never weighs more than the
 *             whole suite). The lane itself is NOT
 *             sized to D: it weighs what the always-on set predicts, and
 *             `plan` prints a `::warning::` when that passes D, the sign that
 *             slot 1 has become the run's slowest leg. The lane is the
 *             selector's verdict on this very run, never a list kept beside it. A full plan has no lane: its sixteen
 *             sequencer legs already run everything (ruling 6739581615).
 *
 * ## Paths that are filters of each other
 *
 * Vitest reads each positional as a case-insensitive SUBSTRING of a test path,
 * so a leg handed `a/x.test.ts` also runs `a/x.test.tsx`, and
 * `scripts/vitest-invocation-guard.mjs` refuses an argv in which one positional
 * contains another. The planner therefore packs such paths as one UNIT, always
 * on one slot (the lane, when any of them is always-on), and `files` hands
 * vitest only the shortest of them. A selected path that is a filter of a
 * collected path the selection lacks cannot be run exactly, so `plan` refuses.
 *
 * Weights are `test-shard-partition.mjs`'s: the measured per-file ms keyed by
 * `pathKey()`, the dataset median for a file it does not name, at least 1 ms.
 *
 * ## What a leg proves (`verify-ran`)
 *
 * After its tests, a leg compares the files vitest actually ran (its `json`
 * reporter, `testResults[].name`) with its bin, as a multiset of paths. A file
 * missing, extra or run twice is red, so the leg publishes no credential and
 * the `Test UI` aggregate counts it missing. With the plan's own invariant
 * (below) that is "every selected file ran in exactly one slot": the bins
 * partition vitest's collection, every leg ran exactly its bin, and every
 * planned slot attested.
 *
 * ## The plan's own invariant
 *
 * `plan` refuses to write a plan whose bins are not a partition of its input:
 * every collected specification in exactly one bin, none invented. A planner
 * defect therefore stops the plan job, the matrix falls back to all sixteen
 * full legs, and coverage is never what pays for it.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { datasetWeights, medianWeight, MIN_WEIGHT_MS, partition, pathKey, planShards } from './test-shard-partition.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The vitest root: every path in a plan is relative to it, posix. */
export const UI_ROOT = path.resolve(HERE, '..');
const TIMINGS = path.resolve(HERE, 'test-shard-timings.json');

/** The plan file's schema tag. Any other tag is refused, never guessed at. */
export const PLAN_SCHEMA = 'objectui.test-ui-plan/1';

const toPosix = (/** @type {string} */ p) => p.split(path.sep).join('/');

/**
 * `vitest list --filesOnly --json` output as specifications, paths relative to
 * the ui root. Throws on any shape it cannot read: a misread list is a
 * silently wrong plan.
 *
 * @param {unknown} list
 * @param {string} [root]
 * @returns {Array<{ path: string, project: string }>}
 */
export function readSpecs(list, root = UI_ROOT) {
  if (!Array.isArray(list)) throw new Error('plan-test-ui-shards: the vitest list is not a JSON array');
  return list.map((entry, i) => {
    const file = /** @type {{ file?: unknown }} */ (entry)?.file;
    const project = /** @type {{ projectName?: unknown }} */ (entry)?.projectName;
    if (typeof file !== 'string' || file === '') throw new Error(`plan-test-ui-shards: list entry ${i} carries no \`file\``);
    const rel = toPosix(path.isAbsolute(file) ? path.relative(root, file) : file);
    if (rel.startsWith('../') || rel === '..') throw new Error(`plan-test-ui-shards: ${file} is outside the ui root ${root}`);
    return { path: rel, project: typeof project === 'string' ? project : '' };
  });
}

/** One spec's identity inside a plan. */
const specId = (/** @type {{ path: string, project: string }} */ s) => `${s.path}\u0000${s.project}`;

/**
 * `paths` grouped into the units vitest's filters force: two paths share a unit
 * when one is a case-insensitive substring of the other, transitively. Throws
 * when a path is a filter of a collected path outside `paths`: the leg running
 * it would run that file too, and no slot planned it.
 *
 * @param {string[]} paths unique
 * @param {string[]} collected every collected path, unique
 * @returns {string[][]} each unit sorted, shortest first
 */
export function filterUnits(paths, collected) {
  const inPaths = new Set(paths);
  const lower = collected.map((p) => p.toLowerCase());
  /** @type {Map<string, string>} */
  const parent = new Map(paths.map((p) => [p, p]));
  const root = (/** @type {string} */ p) => {
    let r = p;
    while (parent.get(r) !== r) r = /** @type {string} */ (parent.get(r));
    parent.set(p, r);
    return r;
  };
  /** @type {string[]} */
  const strays = [];
  for (const p of paths) {
    const needle = p.toLowerCase();
    collected.forEach((q, i) => {
      if (q === p || !lower[i].includes(needle)) return;
      if (!inPaths.has(q)) strays.push(`${p} also matches ${q}`);
      else parent.set(root(q), root(p));
    });
  }
  if (strays.length > 0) {
    throw new Error(
      `plan-test-ui-shards: ${strays.length} selected path(s) are vitest filters of a collected file the selection lacks, so no leg could run them exactly: ${strays.slice(0, 5).join('; ')}`,
    );
  }
  /** @type {Map<string, string[]>} */
  const units = new Map();
  for (const p of paths) units.set(root(p), [...(units.get(root(p)) ?? []), p]);
  return [...units.values()].map((unit) => unit.sort((a, b) => a.length - b.length || a.localeCompare(b)));
}

/**
 * The positionals that run exactly `paths`: a path another one already
 * matches is left out, as the invocation guard requires.
 *
 * @param {string[]} paths
 */
export function slotFilters(paths) {
  const sorted = [...new Set(paths)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  /** @type {string[]} lower-cased */
  const kept = [];
  const keep = new Set();
  for (const p of sorted) {
    const lower = p.toLowerCase();
    if (kept.some((k) => lower.includes(k))) continue;
    kept.push(lower);
    keep.add(p);
  }
  return [...new Set(paths)].filter((p) => keep.has(p));
}

/**
 * The per-path weights the sequencer would use: measured ms, else the median.
 *
 * @param {string[]} paths
 * @param {unknown} dataset
 */
function pathWeights(paths, dataset) {
  const weights = datasetWeights(dataset);
  const median = medianWeight(weights);
  return new Map(paths.map((p) => [p, Math.max(MIN_WEIGHT_MS, weights.get(pathKey(p)) ?? median)]));
}

/**
 * Throws unless `bins` hold every spec of `specs` exactly once and nothing else.
 *
 * @param {Array<{ path: string, project: string }>} specs
 * @param {Array<Array<{ path: string, project: string }>>} bins
 */
export function assertPartition(specs, bins) {
  /** @type {Map<string, number>} */
  const want = new Map();
  for (const s of specs) want.set(specId(s), (want.get(specId(s)) ?? 0) + 1);
  /** @type {Map<string, number>} */
  const got = new Map();
  for (const bin of bins) for (const s of bin) got.set(specId(s), (got.get(specId(s)) ?? 0) + 1);
  const wrong = [...new Set([...want.keys(), ...got.keys()])].filter((id) => want.get(id) !== got.get(id));
  if (wrong.length > 0) {
    const show = wrong.slice(0, 5).map((id) => `${id.replace('\u0000', ' [')}] planned ${got.get(id) ?? 0}, collected ${want.get(id) ?? 0}`);
    throw new Error(`plan-test-ui-shards: the bins are not a partition of the collected set (${wrong.length} spec(s)): ${show.join('; ')}`);
  }
}

/**
 * The whole plan for one run.
 *
 * @param {{ all: Array<{ path: string, project: string }>, selected?: Array<{ path: string, project: string }> | null, lane?: string[] | null, dataset: unknown, slots: number }} input
 *   `selected` absent or null is the full mode. `lane`, the selector's
 *   always-on paths, is an affected plan's slot 1; absent or null, no lane.
 */
export function planRun({ all, selected = null, lane = null, dataset, slots }) {
  if (!Number.isInteger(slots) || slots < 1) throw new Error(`plan-test-ui-shards: the slot roster must be a positive integer, got ${slots}`);
  if (selected === null && lane !== null) throw new Error('plan-test-ui-shards: a lane belongs to an affected plan; a full plan has none');
  const allPaths = [...new Set(all.map((s) => s.path))];
  const allWeights = pathWeights(allPaths, dataset);
  const suiteMs = allPaths.reduce((sum, p) => sum + /** @type {number} */ (allWeights.get(p)), 0);
  const densityMs = suiteMs / slots;

  /** @type {Array<Array<{ path: string, project: string }>>} */
  let bins;
  /** @type {'full' | 'affected'} */
  let mode;
  let selectedMs = suiteMs;
  /** Whether slot 1 is the always-on lane, and what it weighs. */
  let hasLane = false;
  let laneMs = 0;
  /** `sequencer` unless a full plan meets a dataset with no measurement in it. */
  let split = 'sequencer';
  if (selected === null) {
    mode = 'full';
    if (datasetWeights(dataset).size === 0) {
      // The sequencer's own fallback: with nothing measured it hands the run
      // to vitest's path-hash split, which this file does not reproduce. The
      // sixteen legs still partition the suite (that is vitest's `--shard`),
      // so nothing is lost; there is only no per-leg list to check against.
      split = 'vitest-hash';
      bins = Array.from({ length: slots }, () => []);
    } else {
      const plan = planShards(all, dataset, slots);
      bins = plan.bins.map((bin) => bin.map((i) => all[i]));
      assertPartition(all, bins);
    }
  } else {
    mode = 'affected';
    const paths = [...new Set(selected.map((s) => s.path))];
    const weights = pathWeights(paths, dataset);
    const weigh = (/** @type {string[]} */ unit) => unit.reduce((sum, p) => sum + /** @type {number} */ (weights.get(p)), 0);
    selectedMs = weigh(paths);
    /** @type {Map<string, Array<{ path: string, project: string }>>} */
    const byPath = new Map(paths.map((p) => [p, []]));
    for (const s of selected) /** @type {Array<{ path: string, project: string }>} */ (byPath.get(s.path)).push(s);
    const specsOf = (/** @type {string[]} */ unit) => unit.flatMap((p) => /** @type {Array<{ path: string, project: string }>} */ (byPath.get(p)));
    const units = filterUnits(paths, allPaths);
    // The lane: every unit holding an always-on path. With a roster of one
    // there is no slot left beside it, so the lane is then the whole plan.
    const always = new Set(lane ?? []);
    const laneUnits = units.filter((unit) => unit.some((p) => always.has(p)));
    hasLane = laneUnits.length > 0;
    const rest = hasLane && slots === 1 ? [] : units.filter((unit) => !laneUnits.includes(unit));
    const laneBin = hasLane ? units.filter((unit) => !rest.includes(unit)).flat().sort() : [];
    laneMs = weigh(laneBin);
    const restMs = selectedMs - laneMs;
    const room = slots - (hasLane ? 1 : 0);
    const count = rest.length === 0 ? 0 : Math.max(1, Math.min(room, rest.length, Math.ceil(restMs / densityMs)));
    const packed = count === 0 ? { bins: [] } : partition(rest.map((unit) => ({ key: unit[0], weight: weigh(unit) })), count);
    bins = [...(hasLane ? [specsOf(laneBin)] : []), ...packed.bins.map((bin) => specsOf(bin.flatMap((i) => rest[i])))];
    assertPartition(selected, bins);
  }
  const shards = bins.map((_, i) => i + 1);
  const digest = planDigest({ mode, slots, split, lane: hasLane, bins });
  return {
    schema: PLAN_SCHEMA,
    mode,
    slots,
    split,
    lane: hasLane,
    shards,
    suiteMs: Math.round(suiteMs),
    densityMs: Math.round(densityMs),
    selectedMs: Math.round(selectedMs),
    laneMs: Math.round(laneMs),
    bins,
    digest,
  };
}

/**
 * What a plan's digest covers: everything a leg acts on.
 *
 * @param {{ mode: string, slots: number, split: string, lane: boolean, bins: unknown }} plan
 */
function planDigest({ mode, slots, split, lane, bins }) {
  return createHash('sha256').update(JSON.stringify({ schema: PLAN_SCHEMA, mode, slots, split, lane, bins })).digest('hex');
}

/**
 * A plan read back from its file, checked: its digest must be its own.
 *
 * @param {string} file
 */
export function readPlan(file) {
  const plan = JSON.parse(readFileSync(file, 'utf8'));
  if (plan?.schema !== PLAN_SCHEMA) throw new Error(`plan-test-ui-shards: ${file} is not a ${PLAN_SCHEMA} plan`);
  if (planDigest(plan) !== plan.digest) throw new Error(`plan-test-ui-shards: ${file}'s bins do not hash to its digest ${plan.digest}`);
  return /** @type {ReturnType<typeof planRun>} */ (plan);
}

/**
 * The bin of slot `slot` (1-based), or a refusal naming the plan's roster.
 *
 * @param {ReturnType<typeof planRun>} plan
 * @param {number} slot
 */
export function slotBin(plan, slot) {
  if (!Number.isInteger(slot) || !plan.shards.includes(slot)) {
    throw new Error(`plan-test-ui-shards: slot ${slot} is not one this ${plan.mode} plan started (${JSON.stringify(plan.shards)})`);
  }
  return plan.bins[slot - 1];
}

/**
 * The files vitest ran, from its `json` reporter, against the slot's bin, as
 * multisets of paths. Empty `missing` and `extra` is the only pass.
 *
 * @param {ReturnType<typeof planRun>} plan
 * @param {number} slot
 * @param {unknown} report
 * @param {string} [root]
 */
export function compareRan(plan, slot, report, root = UI_ROOT) {
  const results = /** @type {{ testResults?: unknown }} */ (report)?.testResults;
  if (!Array.isArray(results)) throw new Error('plan-test-ui-shards: the vitest report carries no `testResults` array');
  /** @type {Map<string, number>} */
  const ran = new Map();
  for (const result of results) {
    const name = /** @type {{ name?: unknown }} */ (result)?.name;
    if (typeof name !== 'string') throw new Error('plan-test-ui-shards: a vitest report entry carries no `name`');
    const rel = toPosix(path.isAbsolute(name) ? path.relative(root, name) : name);
    ran.set(rel, (ran.get(rel) ?? 0) + 1);
  }
  const bin = slotBin(plan, slot);
  if (plan.split === 'vitest-hash') return { planned: 0, ran: results.length, missing: [], extra: [], unchecked: true };
  /** @type {Map<string, number>} */
  const planned = new Map();
  for (const s of bin) planned.set(s.path, (planned.get(s.path) ?? 0) + 1);
  const missing = [...planned].filter(([p, n]) => (ran.get(p) ?? 0) < n).map(([p, n]) => `${p} (planned ${n}, ran ${ran.get(p) ?? 0})`);
  const extra = [...ran].filter(([p, n]) => (planned.get(p) ?? 0) < n).map(([p, n]) => `${p} (ran ${n}, planned ${planned.get(p) ?? 0})`);
  return { planned: [...planned.values()].reduce((a, b) => a + b, 0), ran: results.length, missing, extra, unchecked: false };
}

/* ── the command line ─────────────────────────────────────────────────── */

/** @param {string[]} argv @param {string} flag */
function option(argv, flag) {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`plan-test-ui-shards: ${flag} needs a value`);
  return value;
}

/** @param {string[]} argv @param {string} flag */
function required(argv, flag) {
  const value = option(argv, flag);
  if (value === undefined) throw new Error(`plan-test-ui-shards: ${flag} is required`);
  return value;
}

/** The slot roster, read off `ci.yml` by the one reader of shard sizes. */
async function liveSlots() {
  const { liveShardTotal } = await import('../../scripts/ci-shard-matrix.mjs');
  return liveShardTotal('test-ui');
}

const readJson = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));

/** @param {string[]} argv */
async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'plan') {
    const all = readSpecs(readJson(required(rest, '--all')));
    const selectedFile = option(rest, '--selected');
    const selected = selectedFile === undefined ? null : readSpecs(readJson(selectedFile));
    const laneFile = option(rest, '--lane');
    const lane = laneFile === undefined ? null : readFileSync(laneFile, 'utf8').split('\n').filter(Boolean);
    const plan = planRun({ all, selected, lane, dataset: readJson(TIMINGS), slots: await liveSlots() });
    const expected = option(rest, '--expect-digest');
    if (expected !== undefined && expected !== plan.digest) {
      console.error(
        `✗ plan-test-ui-shards: this leg's ${plan.mode} plan (${plan.digest}) is not the plan the matrix was built from (${expected}). ` +
          'A slot the plan job called empty could hold a file no leg runs, so this leg refuses to run.',
      );
      return 1;
    }
    writeFileSync(required(rest, '--out'), `${JSON.stringify(plan)}\n`);
    const outputs = option(rest, '--github-output');
    if (outputs !== undefined) {
      appendFileSync(outputs, `shards=${JSON.stringify(plan.shards)}\ndigest=${plan.digest}\nmode=${plan.mode}\n`);
    }
    const files = plan.bins.reduce((n, bin) => n + bin.length, 0);
    const s = (/** @type {number} */ ms) => `${Math.round(ms / 1000)} s`;
    console.log(
      `Test UI plan: ${plan.mode}, ${plan.shards.length} of ${plan.slots} slot(s) for ${files} test file(s); ` +
        `${s(plan.selectedMs)} predicted against a density of ${s(plan.densityMs)} per slot (the whole suite's ${s(plan.suiteMs)} / ${plan.slots}); digest ${plan.digest}.`,
    );
    plan.bins.forEach((bin, i) =>
      console.log(`  slot ${i + 1}: ${bin.length} file(s)${plan.lane && i === 0 ? `, the always-on lane (${s(plan.laneMs)} predicted)` : ''}`),
    );
    if (plan.lane && plan.laneMs > plan.densityMs) {
      console.log(
        `::warning title=Test UI always-on lane::the always-on lane on slot 1 predicts ${s(plan.laneMs)}, more than the ${s(plan.densityMs)} ` +
          'a full-battery leg averages, so it is this run\'s slowest leg. The lane is sized by the selector\'s always-on verdict, not by the plan; it still runs every file it holds.',
      );
    }
    if (lane !== null) {
      const placed = new Set(plan.bins.flat().map((spec) => spec.path));
      const uncollected = lane.filter((p) => !placed.has(p));
      if (uncollected.length > 0) console.log(`  ${uncollected.length} always-on path(s) the selection did not collect, so no lane runs them: ${uncollected.slice(0, 5).join(', ')}`);
    }
    return 0;
  }
  if (command === 'files') {
    const plan = readPlan(required(rest, '--plan'));
    const bin = slotBin(plan, Number(required(rest, '--slot')));
    for (const file of slotFilters([...new Set(bin.map((s) => s.path))])) console.log(file);
    return 0;
  }
  if (command === 'verify-ran') {
    const plan = readPlan(required(rest, '--plan'));
    const slot = Number(required(rest, '--slot'));
    const result = compareRan(plan, slot, readJson(required(rest, '--report')));
    if (result.missing.length > 0 || result.extra.length > 0) {
      console.error(
        `✗ Test UI slot ${slot}/${plan.slots} (${plan.mode}) did not run exactly its planned files: ` +
          `${result.missing.length} missing, ${result.extra.length} extra or repeated.`,
      );
      for (const line of result.missing.slice(0, 20)) console.error(`  - missing  ${line}`);
      for (const line of result.extra.slice(0, 20)) console.error(`  + extra    ${line}`);
      return 1;
    }
    if (result.unchecked) {
      console.log(
        `Test UI slot ${slot}/${plan.slots}: the timings dataset holds no measurement, so this full leg ran vitest's own hash split ` +
          `(${result.ran} file(s)), which has no per-leg list to check against.`,
      );
      return 0;
    }
    console.log(`✓ Test UI slot ${slot}/${plan.slots} (${plan.mode}) ran exactly its ${result.planned} planned file(s).`);
    return 0;
  }
  console.error('usage: plan-test-ui-shards.mjs plan|files|verify-ran … (see the header)');
  return 2;
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
