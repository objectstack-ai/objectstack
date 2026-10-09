#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-package suite-duration ratchet (#16468): a run in which a package's test
 * suite took longer than its measured ceiling is RED, naming the package and
 * its slowest test files, and a ceiling rises only by a ruling.
 *
 *   node scripts/check-test-suite-ceilings.mjs --captures <dir> [--label <text>]
 *   node scripts/check-test-suite-ceilings.mjs --self-test
 *
 * ## Why it exists
 *
 * `@objectstack/cli` measured 458 s on 2026-08-24, and the shard carrying it
 * measured 28m46s two weeks later; nothing turned red on the pull requests that
 * made it slower. CI time is the Actions bill and every seat's wait, and until
 * this check nothing fired at the moment a package got slower.
 *
 * ## The ruling it implements (letter A, maintainer-approved)
 *
 * - The ceiling is the package's SLOWEST executed run in the refresh window
 *   x 1.25 -- not its median, which 31 of 71 packages' own window maximum
 *   already exceeded by more than 25%. It is GENERATED, never typed: the
 *   `ceilings` field of scripts/test-shard-timings.json, written by
 *   scripts/measure-test-shard-timings.mjs at every refresh (CEILING_HEADROOM
 *   and suiteCeilings() there), and held by every later refresh.
 * - A package in the dataset's `provisional` list prints "no ceiling:
 *   provisional" and is not red. A package `uncapped` as `carried` (a cache HIT
 *   re-confirmed it, but no run of the window executed it) is not red either:
 *   it is in the dataset, and the next refresh that executes it gives it one.
 * - ONLY a package absent from the dataset is red for having no ceiling -- the
 *   new-package shape. A package that has never landed is never measured by a
 *   refresh, so for a new package that red is lifted by a ruled raise below,
 *   not by waiting.
 * - A ceiling rises only by a ruling: RULED_CEILING_RAISES, each entry naming
 *   the ruling's comment URL. Nothing else in this file moves a ceiling.
 *
 * ## No table yet is NOT MEASURED, never red
 *
 * The ceilings can only be generated where the run-summary artifacts can be
 * downloaded -- the refresh workflow on a GitHub-hosted runner. An agent
 * container's egress answers 403 to the artifact host (blob storage behind
 * `GET /actions/artifacts/{id}/zip`), so no seat can seed the table, and a
 * hand-typed one is exactly what the generator exists to prevent. Until the
 * first refresh after this check landed writes `ceilings`, a dataset WITHOUT
 * the key is read as NOT MEASURED ("no ceiling table yet") and exits 0. That
 * is distinct from a package absent from a dataset that HAS the key (red), and
 * the reading is printed as a warning annotation on every run, because a
 * persistent NOT MEASURED is a defect: it means the refresh stopped writing
 * ceilings.
 *
 * ## Where it runs, and why the CLI's slices are SUMMED
 *
 * In `Test Core` -- the aggregator job ci.yml runs after all six shards -- as
 * the last step. It reads the per-shard captures `report-test-timings.mjs
 * --capture` already writes (#16454): each capture carries every executed
 * package's turbo execution window, read by `samplesFromSummary` -- the reader
 * the drift step and the generator use, so there is no second reader of the
 * turbo summary format here -- and every vitest file line with its duration,
 * which is where "its slowest files" comes from.
 *
 * A file-sharded package (the CLI, cut into 3 slices on 3 shards whenever a
 * run's own list makes it the serial floor) arrives as three partial windows
 * on three shards. They are SUMMED across shards (foldCaptures, which marks a
 * set missing a part as incomplete) and the sum is graded against the whole
 * package's ceiling, because that is the quantity the ceiling was measured in:
 * the generator records a sliced package as the per-run SUM of its slices, and
 * takes the slowest of those sums. Comparing each slice to a third of the
 * ceiling was measured and rejected: vitest cuts the file list by a hash of
 * each path, so the three slices carry 0.81 / 1.17 / 1.02 of an even third
 * (PR #22456), and the heaviest slice against a third of `max x 1.25` keeps
 * only ~7% headroom over the window maximum instead of 25% -- and a new or
 * renamed file can move a slow file between slices without the suite getting
 * one second slower. A set missing a part is NOT MEASURED for that package,
 * never a part graded as a whole.
 *
 * ## The density the ceilings assume
 *
 * A package's window is CONTENDED wall clock: up to four suites share a 4-vCPU
 * runner (`--concurrency=4`), so its window grows with how much its shard
 * carries. Round 2 of the CLI split packed ~2641 s of predicted windows onto
 * three shards (1.49x the density cap) and those shards' windows read 1.5-1.9x;
 * on the one full run under it (37902633826), two packages read over this
 * ratchet's ceilings. The ceilings are measured at the density the dataset's
 * own split runs at, which the live split holds under its density cap
 * (`densityCap()` in partition-test-shards.mjs). A future split that raises
 * the density will read red here on packages it did not touch; that red is
 * the split making suites slower, and the remedy is the split, not a raise.
 *
 * ## Exit codes
 *
 *   0  OK, or NOT MEASURED (no table yet; nothing executed; no captures)
 *   1  a package over its ceiling, a package absent from the dataset, or a
 *      refusal (a malformed ceiling table or raise record)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';
import { escapeWorkflowCommandMessage } from './partition-test-shards.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATASET_PATH = path.join(REPO_ROOT, 'scripts', 'test-shard-timings.json');
const DATASET_REL = 'scripts/test-shard-timings.json';

/** How many of a red package's slowest test files the verdict names. */
export const SLOWEST_FILES_NAMED = 5;

// ── The ruled raises ──────────────────────────────────────────────────────
//
// A ceiling rises ONLY here, and only on a ruling. One entry per package:
//
//   '<package name>': { seconds: <the raised ceiling>, ruling: '<the ruling comment URL>' }
//
// `ruling` must be the URL of the issue or pull-request comment that records
// the ruling (`.../issues/<n>#issuecomment-<id>` or `.../pull/<n>#...`): the
// raise is reviewable only if the words that authorised it can be read. The
// effective ceiling is the larger of the generated one and the raise, so a raise
// below the generated ceiling changes nothing and is reported as stale. An entry
// for a package absent from the dataset gives a new package its first ceiling --
// the only way a package that has never landed can get one, since a refresh only
// measures what runs on `main`.
//
// ⛔ Never raise a ceiling by editing `ceilings` in scripts/test-shard-timings.json:
// that file is generated, and the next refresh holds whatever it finds.
export const RULED_CEILING_RAISES = Object.freeze({});

const RULING_URL = /^https:\/\/github\.com\/objectstack-ai\/[A-Za-z0-9._-]+\/(?:issues|pull)\/\d+#issuecomment-\d+$/;

/** Problems with a raise record; empty when every entry is well-formed. */
export function raiseProblems(raises) {
  const problems = [];
  if (!raises || typeof raises !== 'object' || Array.isArray(raises)) {
    return [`the ruled-raise record is ${JSON.stringify(raises)}, not a map of package -> { seconds, ruling }`];
  }
  for (const [name, entry] of Object.entries(raises)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${name}: the raise is ${JSON.stringify(entry)}, not { seconds, ruling }`);
      continue;
    }
    if (typeof entry.seconds !== 'number' || !Number.isFinite(entry.seconds) || !(entry.seconds > 0)) {
      problems.push(`${name}: the raised ceiling is ${JSON.stringify(entry.seconds)}, not a positive number of seconds`);
    }
    if (typeof entry.ruling !== 'string' || !RULING_URL.test(entry.ruling)) {
      problems.push(
        `${name}: the raise names no ruling (${JSON.stringify(entry.ruling)}). A ceiling rises only by a ruling, ` +
          'so the entry carries the URL of the comment that records it.'
      );
    }
  }
  return problems;
}

// ── Reading the dataset's ceiling table ───────────────────────────────────

/**
 * The parts of the dataset this check reads, or `{ table: null }` when the
 * dataset predates the ceilings (no `ceilings` key) -- the NOT MEASURED
 * bootstrap reading. A dataset that HAS the key but carries a malformed table
 * is a refusal: it was generated, so a malformed one is a defect to fix, and
 * grading against a guess would be a pass nobody earned.
 */
export function readCeilingTable(dataset) {
  if (!dataset || typeof dataset !== 'object') {
    throw new Error(`${DATASET_REL} is not a JSON object`);
  }
  const packages = dataset.packages;
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new Error(`${DATASET_REL}: expected {packages:{"<name>":<seconds>}}`);
  }
  if (!Object.hasOwn(dataset, 'ceilings')) return { table: null };
  const { ceilings, uncapped = {}, provisional = [] } = dataset;
  if (!ceilings || typeof ceilings !== 'object' || Array.isArray(ceilings)) {
    throw new Error(`${DATASET_REL}: \`ceilings\` is ${JSON.stringify(ceilings)}, not a map of package -> seconds`);
  }
  for (const [name, seconds] of Object.entries(ceilings)) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || !(seconds > 0)) {
      throw new Error(`${DATASET_REL}: the ceiling for ${name} is ${JSON.stringify(seconds)}, not a positive duration`);
    }
  }
  if (!uncapped || typeof uncapped !== 'object' || Array.isArray(uncapped)) {
    throw new Error(`${DATASET_REL}: \`uncapped\` is ${JSON.stringify(uncapped)}, not a map of package -> reason`);
  }
  if (!Array.isArray(provisional)) {
    throw new Error(`${DATASET_REL}: \`provisional\` is ${JSON.stringify(provisional)}, not a list of package names`);
  }
  // Every package the dataset weighs is either capped or uncapped with a reason:
  // the generator guarantees it, so a package in neither map is a table that
  // was not written by it, and is refused rather than read as "no ceiling".
  const uncovered = Object.keys(packages).filter((n) => !Object.hasOwn(ceilings, n) && !Object.hasOwn(uncapped, n));
  if (uncovered.length > 0) {
    throw new Error(
      `${DATASET_REL}: ${uncovered.length} package(s) carry a weight but neither a ceiling nor an \`uncapped\` ` +
        `reason (${uncovered.join(', ')}). The generator writes one or the other for every package; regenerate ` +
        'the dataset rather than editing it.'
    );
  }
  return {
    table: {
      packages,
      ceilings,
      uncapped,
      provisional: new Set(provisional),
      headroom: dataset.provenance?.ceilingHeadroom ?? null,
      measuredAt: dataset.provenance?.measuredAt ?? null,
    },
  };
}

// ── Grading ───────────────────────────────────────────────────────────────

/**
 * Grade one run. `merged` is foldCaptures()' result: every executed package's
 * window, a sliced package already summed across shards with `complete` saying
 * whether every part turned up, and every file line.
 *
 * Returns `{ table, rows, problems }`; each row is one executed package with a
 * `status`:
 *
 *   over         graded, over its effective ceiling          RED
 *   absent       not in the dataset, and no ruled raise       RED
 *   ok           graded, within its effective ceiling
 *   provisional  in the dataset's `provisional` list          no ceiling, not red
 *   uncapped     `uncapped` with a reason (`carried`)         no ceiling, not red
 *   partial      a sliced package missing a part this run     NOT MEASURED
 *
 * `problems` are refusals (a malformed raise record) and red the run on their own.
 */
export function gradeCeilings({ merged, dataset, raises = RULED_CEILING_RAISES }) {
  const problems = raiseProblems(raises);
  const { table } = readCeilingTable(dataset);
  const rows = [];
  if (table === null) return { table, rows, problems, staleRaises: [] };

  const staleRaises = [];
  for (const [name, raise] of Object.entries(problems.length ? {} : raises)) {
    const generated = table.ceilings[name];
    if (generated !== undefined && raise.seconds <= generated) {
      staleRaises.push(`${name} (raised to ${raise.seconds}s, generated ${generated}s)`);
    }
  }

  for (const pkg of merged.packages) {
    const name = pkg.pkg;
    const seconds = pkg.seconds;
    const slices = pkg.sliceCount === null ? null : { count: pkg.sliceCount, parts: pkg.parts };
    const files = merged.files
      .filter((f) => f.pkg === name)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, SLOWEST_FILES_NAMED);
    const row = { name, seconds, slices, files, ceiling: null, generated: null, raise: null };
    rows.push(row);
    if (!pkg.complete) {
      row.status = 'partial';
      continue;
    }
    const raise = problems.length === 0 && Object.hasOwn(raises, name) ? raises[name] : null;
    const inDataset = Object.hasOwn(table.packages, name);
    if (inDataset && table.provisional.has(name)) {
      row.status = 'provisional';
      continue;
    }
    const generated = inDataset && Object.hasOwn(table.ceilings, name) ? table.ceilings[name] : null;
    row.generated = generated;
    row.raise = raise;
    if (generated === null && raise === null) {
      if (!inDataset) {
        row.status = 'absent';
      } else {
        row.status = 'uncapped';
        row.reason = table.uncapped[name];
      }
      continue;
    }
    row.ceiling = Math.max(generated ?? 0, raise?.seconds ?? 0);
    // Strict `>`: a run AT its ceiling is within it, like the drift bound.
    row.status = seconds > row.ceiling ? 'over' : 'ok';
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return { table, rows, problems, staleRaises };
}

// ── Rendering ─────────────────────────────────────────────────────────────

const RED_STATUSES = new Set(['over', 'absent']);

function sliceNote(row) {
  if (!row.slices) return '';
  return row.slices.parts.length === row.slices.count
    ? ` (all ${row.slices.count} slices, summed across shards)`
    : ` (slices ${row.slices.parts.join('+') || 'none'} of ${row.slices.count})`;
}

function filesText(row) {
  if (row.files.length === 0) return '      (no vitest file line was captured for it)';
  return row.files
    .map((f) => `      ${(f.ms / 1000).toFixed(2)}s  ${f.file}${f.project ? ` [${f.project}]` : ''}`)
    .join('\n');
}

function ceilingText(row) {
  const parts = [];
  if (row.generated !== null) parts.push(`generated ${row.generated.toFixed(2)}s`);
  if (row.raise) parts.push(`ruled raise ${row.raise.seconds.toFixed(2)}s, ${row.raise.ruling}`);
  return parts.join('; ');
}

/**
 * The verdict a runner receives, rendered without printing it so the
 * self-test can read it: `out` is stdout (workflow-command annotations),
 * `err` the human log.
 */
export function renderCeilingVerdict(report, label) {
  const head = `suite-ceiling`;
  if (report.problems.length > 0) {
    return {
      verdict: 'REFUSED',
      exitCode: 1,
      out: [`::error title=Suite-duration ceilings::${escapeWorkflowCommandMessage(`${label}: the ruled-raise record is malformed: ${report.problems.join('; ')}`)}`],
      err: [
        `${head}: REFUSED -- ${label}: RULED_CEILING_RAISES in scripts/check-test-suite-ceilings.mjs is malformed:\n` +
          report.problems.map((p) => `  - ${p}`).join('\n'),
      ],
    };
  }

  if (report.table === null) {
    const text =
      `NOT MEASURED -- ${label}: no ceiling table yet. ${DATASET_REL} carries no \`ceilings\`, because it was ` +
      'written before the suite-duration ceilings existed; the first run of .github/workflows/shard-timings-refresh.yml ' +
      'after this check landed writes them. Nothing was graded and nothing failed. If this still prints after that ' +
      'refresh has merged, the refresh is not writing ceilings: that is a defect, file it.';
    return {
      verdict: 'NOT MEASURED',
      exitCode: 0,
      out: [`::warning title=Suite-duration ceilings::${escapeWorkflowCommandMessage(text)}`],
      err: [`${head}: ${text}`],
    };
  }

  const graded = report.rows.filter((r) => r.status === 'ok' || r.status === 'over');
  const red = report.rows.filter((r) => RED_STATUSES.has(r.status));
  const lines = report.rows.map((r) => {
    switch (r.status) {
      case 'ok':
      case 'over':
        return (
          `  ${r.status === 'over' ? 'OVER' : 'ok  '}  ${r.name}: ${r.seconds.toFixed(2)}s against ${r.ceiling.toFixed(2)}s ` +
          `(${(r.seconds / r.ceiling).toFixed(2)}x)${sliceNote(r)}`
        );
      case 'provisional':
        return `  --    ${r.name}: ${r.seconds.toFixed(2)}s -- no ceiling: provisional`;
      case 'uncapped':
        return `  --    ${r.name}: ${r.seconds.toFixed(2)}s -- no ceiling: ${r.reason}`;
      case 'partial':
        return `  --    ${r.name}: NOT MEASURED -- a part of its suite is missing from this run${sliceNote(r)}; a part is never graded as the whole`;
      case 'absent':
        return `  NEW   ${r.name}: ${r.seconds.toFixed(2)}s -- no ceiling: not in ${DATASET_REL} (a new package)`;
      default:
        throw new Error(`unknown row status ${r.status}`);
    }
  });
  const stale = report.staleRaises.length
    ? `\n  Ruled raises at or below the generated ceiling, so changing nothing (delete them): ${report.staleRaises.join(', ')}.`
    : '';
  const basis =
    `ceilings from ${DATASET_REL}${report.table.measuredAt ? ` (refreshed ${report.table.measuredAt})` : ''}: ` +
    `each package's slowest executed run x ${report.table.headroom ?? '?'} when first set, held since`;

  if (red.length === 0) {
    const verdict = graded.length === 0 ? 'NOT MEASURED' : 'OK';
    const summaryLine =
      graded.length === 0
        ? `${head}: NOT MEASURED -- ${label}: no executed package carried a ceiling to grade against (${report.rows.length} executed).`
        : `${head}: OK -- ${label}: ${graded.length} package(s) graded, every one within its ceiling.`;
    return {
      verdict,
      exitCode: 0,
      out: [],
      err: [`${summaryLine}\n  ${basis}.${lines.length ? `\n${lines.join('\n')}` : ''}${stale}`],
    };
  }

  const detail = red
    .map((r) =>
      r.status === 'over'
        ? `  ${r.name}: ${r.seconds.toFixed(2)}s measured against its ${r.ceiling.toFixed(2)}s ceiling ` +
          `(${(r.seconds / r.ceiling).toFixed(2)}x; ${ceilingText(r)})${sliceNote(r)}. Its slowest test files:\n${filesText(r)}`
        : `  ${r.name}: ${r.seconds.toFixed(2)}s and no ceiling -- it is not in ${DATASET_REL}, so it is a new package. ` +
          'It stays red until a ruled raise gives it a first ceiling (a refresh only measures what runs on main). ' +
          `Its slowest test files:\n${filesText(r)}`
    )
    .join('\n');
  return {
    verdict: 'OVER',
    exitCode: 1,
    out: red.map(
      (r) =>
        `::error title=Suite-duration ceiling::${escapeWorkflowCommandMessage(
          r.status === 'over'
            ? `${r.name}: ${r.seconds.toFixed(2)}s, over its ${r.ceiling.toFixed(2)}s ceiling. Slowest file: ` +
                `${r.files[0] ? `${r.files[0].file} ${(r.files[0].ms / 1000).toFixed(2)}s` : '(none captured)'}.`
            : `${r.name}: ${r.seconds.toFixed(2)}s and no ceiling -- a package absent from ${DATASET_REL}.`
        )}`
    ),
    err: [
      `${head}: OVER -- ${label}: ${red.length} package(s) over their suite-duration ceiling or without one.\n` +
        `${detail}\n` +
        `  ${basis}.\n` +
        '  Make the suite faster, or take the raise to a ruling: a ceiling rises only by an entry in\n' +
        '  RULED_CEILING_RAISES (scripts/check-test-suite-ceilings.mjs) naming the ruling comment. ⛔ Never\n' +
        `  hand-edit \`ceilings\` in ${DATASET_REL} -- it is generated, and the next refresh holds what it finds.\n` +
        `  Every executed package this run:\n${lines.join('\n')}${stale}`,
    ],
  };
}

// ── Reading the shard captures ────────────────────────────────────────────

/** The capture schema `report-test-timings.mjs --capture` writes; any other is refused. */
export const CAPTURE_SCHEMA = 'test-timing-capture/1';

/**
 * Fold the per-shard captures into one run: every executed package's window,
 * a file-sliced package SUMMED across the shards that ran its parts and marked
 * `complete` only when every part turned up, and every file line.
 *
 * The same fold `report-test-timings.mjs` makes for its table, kept here rather
 * than imported: that module is a gate file only through its own self-test, and
 * a gate family importing it would silently stop inheriting its declared
 * populations in the dispatch-gates derivation (its promotion invariant reds on
 * exactly that). The windows themselves are not re-read here -- each capture's
 * package rows are `samplesFromSummary`'s, taken on the shard.
 */
export function foldCaptures(captures) {
  const files = [];
  const byName = new Map();
  const problems = [];
  const shards = [];
  for (const capture of captures) {
    if (capture?.schema !== CAPTURE_SCHEMA) {
      problems.push(`a capture declares schema ${JSON.stringify(capture?.schema ?? null)}, not ${CAPTURE_SCHEMA}`);
      continue;
    }
    if (capture.shard) shards.push(capture.shard);
    files.push(...(capture.files ?? []));
    for (const p of capture.problems ?? []) problems.push(p);
    for (const row of capture.packages ?? []) {
      const acc = byName.get(row.pkg) ?? { pkg: row.pkg, seconds: 0, sliceCount: null, parts: [] };
      acc.seconds += row.seconds;
      if (row.sliceCount) {
        acc.sliceCount = row.sliceCount;
        acc.parts.push(...(row.parts ?? []));
      }
      byName.set(row.pkg, acc);
    }
  }
  const packages = [...byName.values()].map((row) => {
    const parts = [...new Set(row.parts)].sort((a, b) => a - b);
    return { ...row, parts, complete: row.sliceCount === null || parts.length === row.sliceCount };
  });
  return { files, packages, problems, shards: shards.sort() };
}


/** Every capture JSON under `dir`, recursively; unreadable files become problems. */
export function readCaptures(dir) {
  const captures = [];
  const problems = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d);
    } catch (err) {
      problems.push(`capture directory unreadable at ${d}: ${err?.message ?? String(err)}`);
      return;
    }
    for (const entry of entries.sort()) {
      const p = path.join(d, entry);
      let s;
      try {
        s = statSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        walk(p);
        continue;
      }
      if (!entry.endsWith('.json')) continue;
      try {
        captures.push(JSON.parse(readFileSync(p, 'utf8')));
      } catch (err) {
        problems.push(`${entry}: ${err?.message ?? String(err)}`);
      }
    }
  };
  walk(dir);
  return { captures, problems };
}

// ── Self-test ─────────────────────────────────────────────────────────────

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` above that line prints nothing and still exits 0 -- a
// self-test that never finished, reported as one that passed.
let selfTestReachedVerdict = false;

// The roster: battery name -> minimum case count. A FLOOR, not an equality --
// adding cases is ordinary work. A battery below its floor means cases stopped
// running; the remedy is to find what stopped registering, never to lower it.
const SELF_TEST_BATTERIES = Object.freeze({
  'over the ceiling is red, naming the package and its slowest files': 6,
  'provisional prints "no ceiling: provisional" and is not red': 3,
  'a package absent from the dataset is red; an uncapped one is not': 4,
  'no ceiling table yet is NOT MEASURED, never red': 5,
  'file-sliced packages are summed across shards': 6,
  'a ruled raise lifts a ceiling, and only a well-formed one does': 7,
  'a malformed ceiling table is refused, never read as a pass': 4,
});

// Deleting an entry silences that battery's floor as effectively as zeroing
// it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 7;

const UNATTRIBUTED_BATTERY = '(no battery open)';

function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const check = (fn) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    fn();
  };
  const threw = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  // Fixtures in the shapes the live inputs have: a capture as
  // `report-test-timings.mjs --capture` writes it, a dataset as the generator does.
  const capture = (shard, packages, files = []) => ({
    schema: 'test-timing-capture/1',
    shard,
    files,
    packages: packages.map(([pkg, seconds, slice = null]) => ({
      pkg,
      seconds,
      sliceCount: slice ? slice[1] : null,
      parts: slice ? [slice[0]] : [],
    })),
    cached: [],
    problems: [],
    coverage: { declaredFiles: files.length, unattributed: 0, summariesRead: 1 },
  });
  const file = (pkg, name, ms) => ({ pkg, file: name, project: null, tests: 1, ms, state: 'pass', replayed: false });
  const dataset = (extra = {}) => ({
    packages: { a: 100, b: 50, prov: 10, carried: 20, cli: 1500 },
    provisional: ['prov'],
    ceilings: { a: 150, b: 80, cli: 2000 },
    uncapped: { prov: 'provisional', carried: 'carried' },
    provenance: { measuredAt: '2026-10-12', ceilingHeadroom: 1.25 },
    ...extra,
  });
  const run = (captures, ds = dataset(), raises = {}) => {
    const report = gradeCeilings({ merged: foldCaptures(captures), dataset: ds, raises });
    return { report, ...renderCeilingVerdict(report, 'Test Core') };
  };
  const status = (r, name) => r.report.rows.find((row) => row.name === name)?.status;
  const raiseUrl = 'https://github.com/objectstack-ai/objectstack/issues/1#issuecomment-2';

  battery('over the ceiling is red, naming the package and its slowest files');
  const over = run([
    capture('1/6', [['a', 151]], [file('a', 'fast.test.ts', 1_000), file('a', 'slow.test.ts', 90_000), file('a', 'mid.test.ts', 30_000)]),
  ]);
  check(() => {
    if (over.exitCode !== 1 || over.verdict !== 'OVER') throw new Error(`over: exit ${over.exitCode}, verdict ${over.verdict}`);
  });
  check(() => {
    if (!over.err[0].includes('a: 151.00s measured against its 150.00s ceiling')) throw new Error(`over: the package is not named:\n${over.err[0]}`);
  });
  check(() => {
    // The slowest files, slowest first.
    const text = over.err[0];
    const [i, j, k] = ['slow.test.ts', 'mid.test.ts', 'fast.test.ts'].map((n) => text.indexOf(n));
    if (!(i >= 0 && i < j && j < k)) throw new Error(`over: the slowest files are not named slowest first:\n${text}`);
  });
  check(() => {
    if (!over.out.some((l) => l.startsWith('::error title=Suite-duration ceiling::a: 151.00s'))) {
      throw new Error(`over: no error annotation names the package: ${JSON.stringify(over.out)}`);
    }
  });
  check(() => {
    // AT the ceiling is within it (strict `>`), and under is OK.
    const at = run([capture('1/6', [['a', 150], ['b', 10]])]);
    if (at.exitCode !== 0 || at.verdict !== 'OK' || status(at, 'a') !== 'ok') throw new Error(`over: a run AT its ceiling read ${at.verdict}`);
  });
  check(() => {
    // Only the files of the red package are named, at most SLOWEST_FILES_NAMED.
    const many = Array.from({ length: 9 }, (_, i) => file('a', `f${i}.test.ts`, 1000 * (i + 1)));
    const r = run([capture('1/6', [['a', 999], ['b', 1]], [...many, file('b', 'other.test.ts', 999_999)])]);
    const row = r.report.rows.find((x) => x.name === 'a');
    if (row.files.length !== SLOWEST_FILES_NAMED || row.files[0].file !== 'f8.test.ts' || r.err[0].includes('other.test.ts ')) {
      throw new Error(`over: the named files are wrong: ${JSON.stringify(row.files.map((f) => f.file))}`);
    }
  });

  battery('provisional prints "no ceiling: provisional" and is not red');
  const prov = run([capture('1/6', [['prov', 9999], ['a', 10]])]);
  check(() => {
    if (prov.exitCode !== 0 || status(prov, 'prov') !== 'provisional') throw new Error(`provisional: exit ${prov.exitCode}, ${status(prov, 'prov')}`);
  });
  check(() => {
    if (!prov.err[0].includes('prov: 9999.00s -- no ceiling: provisional')) throw new Error(`provisional: the line is wrong:\n${prov.err[0]}`);
  });
  check(() => {
    // Provisional wins even over a ceiling the table still holds for it.
    const held = run([capture('1/6', [['prov', 9999]])], dataset({ ceilings: { a: 150, b: 80, cli: 2000, prov: 12 }, uncapped: { carried: 'carried' } }));
    if (held.exitCode !== 0 || status(held, 'prov') !== 'provisional') throw new Error(`provisional: a held ceiling overrode the provisional exemption (${held.verdict})`);
  });

  battery('a package absent from the dataset is red; an uncapped one is not');
  const fresh = run([capture('2/6', [['brand-new', 5], ['a', 10]], [file('brand-new', 'n.test.ts', 4_000)])]);
  check(() => {
    if (fresh.exitCode !== 1 || status(fresh, 'brand-new') !== 'absent') throw new Error(`absent: exit ${fresh.exitCode}, ${status(fresh, 'brand-new')}`);
  });
  check(() => {
    if (!fresh.err[0].includes('brand-new: 5.00s and no ceiling') || !fresh.err[0].includes('n.test.ts')) {
      throw new Error(`absent: the package or its files are not named:\n${fresh.err[0]}`);
    }
  });
  check(() => {
    const carried = run([capture('2/6', [['carried', 9999]])]);
    if (carried.exitCode !== 0 || status(carried, 'carried') !== 'uncapped') throw new Error(`uncapped: a carried package read ${carried.verdict}`);
  });
  check(() => {
    const carried = run([capture('2/6', [['carried', 9999], ['a', 1]])]);
    if (!carried.err[0].includes('carried: 9999.00s -- no ceiling: carried')) throw new Error(`uncapped: the reason is not named:\n${carried.err[0]}`);
  });

  battery('no ceiling table yet is NOT MEASURED, never red');
  const { ceilings: _c, uncapped: _u, ...preCeilings } = dataset();
  check(() => {
    // Even a package absent from the dataset is not red before the table exists.
    const none = run([capture('1/6', [['a', 9999], ['brand-new', 5]])], preCeilings);
    if (none.exitCode !== 0 || none.verdict !== 'NOT MEASURED') throw new Error(`no table: exit ${none.exitCode}, verdict ${none.verdict}`);
  });
  check(() => {
    const none = run([capture('1/6', [['a', 9999]])], preCeilings);
    if (!none.err[0].includes('no ceiling table yet')) throw new Error(`no table: the reason is not named:\n${none.err[0]}`);
  });
  check(() => {
    // Said as a warning annotation, so a persistent one is seen.
    const none = run([capture('1/6', [['a', 9999]])], preCeilings);
    if (!none.out.some((l) => l.startsWith('::warning title=Suite-duration ceilings::NOT MEASURED'))) {
      throw new Error(`no table: no warning annotation: ${JSON.stringify(none.out)}`);
    }
  });
  check(() => {
    // No capture at all, and only cached packages, grade nothing: NOT MEASURED.
    const empty = run([]);
    if (empty.exitCode !== 0 || empty.verdict !== 'NOT MEASURED') throw new Error(`no captures: verdict ${empty.verdict}`);
  });
  check(() => {
    const onlyProv = run([capture('1/6', [['prov', 1]])]);
    if (onlyProv.exitCode !== 0 || onlyProv.verdict !== 'NOT MEASURED') throw new Error(`nothing graded: verdict ${onlyProv.verdict}`);
  });

  battery('file-sliced packages are summed across shards');
  check(() => {
    // Three parts on three shards: summed, graded against the WHOLE ceiling.
    const r = run([capture('2/6', [['cli', 600, [1, 3]]]), capture('3/6', [['cli', 700, [2, 3]]]), capture('4/6', [['cli', 650, [3, 3]]])]);
    const row = r.report.rows.find((x) => x.name === 'cli');
    if (row.seconds !== 1950 || row.status !== 'ok' || r.exitCode !== 0) throw new Error(`slices: read ${row.seconds}s, ${row.status}`);
  });
  check(() => {
    // THE SKEW CASE: the heavy slice is past a third of the ceiling (700 >
    // 2000/3 = 666.67), but the suite is within it -- not red.
    const r = run([capture('2/6', [['cli', 560, [1, 3]]]), capture('3/6', [['cli', 700, [2, 3]]]), capture('4/6', [['cli', 600, [3, 3]]])]);
    if (r.exitCode !== 0 || status(r, 'cli') !== 'ok') throw new Error(`slices: a skewed slice redded a suite within its ceiling (${r.verdict})`);
  });
  check(() => {
    // The sum over the whole ceiling is red, said as a summed set.
    const r = run([capture('2/6', [['cli', 700, [1, 3]]]), capture('3/6', [['cli', 700, [2, 3]]]), capture('4/6', [['cli', 700, [3, 3]]])]);
    if (r.exitCode !== 1 || !r.err[0].includes('cli: 2100.00s measured against its 2000.00s ceiling') || !r.err[0].includes('all 3 slices, summed across shards')) {
      throw new Error(`slices: an over-ceiling sum was not red, or not said as a sum:\n${r.err[0]}`);
    }
  });
  check(() => {
    // A part missing: NOT MEASURED for the package, never a part graded as the whole.
    const r = run([capture('2/6', [['cli', 9999, [1, 3]]]), capture('3/6', [['cli', 9999, [2, 3]]])]);
    if (r.exitCode !== 0 || status(r, 'cli') !== 'partial') throw new Error(`slices: an incomplete set read ${status(r, 'cli')} / ${r.verdict}`);
  });
  check(() => {
    const r = run([capture('2/6', [['cli', 10, [1, 3]]]), capture('3/6', [['a', 1]])]);
    if (!r.err[0].includes('cli: NOT MEASURED') || !r.err[0].includes('slices 1 of 3')) throw new Error(`slices: the partial line is wrong:\n${r.err[0]}`);
  });
  check(() => {
    // A capture in a shape this fold does not know contributes nothing and is
    // named, never read as a set of windows.
    const folded = foldCaptures([{ ...capture('2/6', [['cli', 600, [1, 3]]]), schema: 'test-timing-capture/2' }, capture('3/6', [['a', 1]])]);
    if (folded.packages.some((p) => p.pkg === 'cli') || !folded.problems.some((p) => p.includes('test-timing-capture/2'))) {
      throw new Error(`slices: an unknown capture schema was folded in: ${JSON.stringify(folded)}`);
    }
  });

  battery('a ruled raise lifts a ceiling, and only a well-formed one does');
  check(() => {
    // Over the generated 150, within the ruled 200: not red, and the ruling is named.
    const r = run([capture('1/6', [['a', 180]])], dataset(), { a: { seconds: 200, ruling: raiseUrl } });
    const row = r.report.rows.find((x) => x.name === 'a');
    if (r.exitCode !== 0 || row.status !== 'ok' || row.ceiling !== 200) throw new Error(`raise: ${row.status} against ${row.ceiling}`);
  });
  check(() => {
    const r = run([capture('1/6', [['a', 201]])], dataset(), { a: { seconds: 200, ruling: raiseUrl } });
    if (r.exitCode !== 1 || !r.err[0].includes(raiseUrl)) throw new Error(`raise: over the raise was not red, or the ruling not named:\n${r.err[0]}`);
  });
  check(() => {
    // A new package's first ceiling, before any refresh could give it one.
    const r = run([capture('1/6', [['brand-new', 5]])], dataset(), { 'brand-new': { seconds: 30, ruling: raiseUrl } });
    if (r.exitCode !== 0 || status(r, 'brand-new') !== 'ok') throw new Error(`raise: a ruled first ceiling did not lift the new-package red (${status(r, 'brand-new')})`);
  });
  check(() => {
    // A raise at or under the generated ceiling changes nothing, and says so.
    const r = run([capture('1/6', [['a', 151]])], dataset(), { a: { seconds: 120, ruling: raiseUrl } });
    if (r.exitCode !== 1 || !r.err[0].includes('changing nothing')) throw new Error(`raise: a stale raise lowered or silently stayed:\n${r.err[0]}`);
  });
  check(() => {
    // No ruling, no raise: the record is refused and the run is red.
    const r = run([capture('1/6', [['a', 180]])], dataset(), { a: { seconds: 200, ruling: 'the maintainer said so' } });
    if (r.exitCode !== 1 || r.verdict !== 'REFUSED') throw new Error(`raise: a raise naming no ruling was applied (${r.verdict})`);
  });
  check(() => {
    if (raiseProblems({ a: { seconds: -5, ruling: raiseUrl } }).length !== 1) throw new Error('raise: a negative raise was accepted');
    if (raiseProblems([]).length !== 1) throw new Error('raise: a list was read as the record');
  });
  check(() => {
    // The live record is well-formed.
    const live = raiseProblems(RULED_CEILING_RAISES);
    if (live.length) throw new Error(`raise: RULED_CEILING_RAISES is malformed: ${live.join('; ')}`);
  });

  battery('a malformed ceiling table is refused, never read as a pass');
  check(() => {
    if (!threw(() => run([capture('1/6', [['a', 1]])], dataset({ ceilings: [150] })))) throw new Error('table: a list was read as `ceilings`');
  });
  check(() => {
    if (!threw(() => run([capture('1/6', [['a', 1]])], dataset({ ceilings: { a: 0, b: 80, cli: 2000 } })))) throw new Error('table: a zero ceiling was graded against');
  });
  check(() => {
    // A weighed package in neither map is a table the generator did not write.
    if (!threw(() => run([capture('1/6', [['a', 1]])], dataset({ uncapped: { prov: 'provisional' } })))) {
      throw new Error('table: a package with neither a ceiling nor a reason was read as uncapped');
    }
  });
  check(() => {
    if (!threw(() => readCeilingTable({ ceilings: {} }))) throw new Error('table: a dataset with no `packages` was accepted');
  });

  // The floor: every declared battery ran, and ran its cases.
  const floorFailures = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailures.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  }
  for (const [name, count] of batterySeen) {
    if (!declared.includes(name)) floorFailures.push(`battery "${name}" registered ${count} case(s) but is not declared`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      floorFailures.push(
        count === 0
          ? `battery "${name}" DID NOT RUN -- 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned`
          : `battery "${name}" registered ${count} case(s), below its floor of ${SELF_TEST_BATTERIES[name]}`
      );
    }
  }
  if (floorFailures.length > 0) {
    throw new Error(
      `check-test-suite-ceilings self-test floor (${floorFailures.length} breach(es)):\n` +
        floorFailures.map((f) => `  - ${f}`).join('\n') +
        '\n  A battery below its floor means cases STOPPED RUNNING; find what stopped registering and restore it.'
    );
  }

  const total = [...batterySeen.values()].reduce((a, b) => a + b, 0);
  console.log(`check-test-suite-ceilings: self-test OK (${total} cases across ${declared.length} batteries)`);
  selfTestReachedVerdict = true;
}

// ── Entry point ───────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-test-suite-ceilings self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test\n' +
          'that never finished as a self-test that passed.\n'
      );
      process.exit(1);
    }
    return;
  }

  let capturesDir = null;
  let label = 'Test Core';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--captures') capturesDir = argv[++i];
    else if (argv[i] === '--label') label = argv[++i];
    else throw new Error(`unrecognized argument: ${argv[i]}`);
  }
  if (!capturesDir) {
    console.error('usage: check-test-suite-ceilings.mjs --captures <dir> [--label <text>] | --self-test');
    process.exit(1);
  }

  const { captures, problems: readProblems } = readCaptures(capturesDir);
  const merged = foldCaptures(captures);
  const dataset = JSON.parse(readFileSync(DATASET_PATH, 'utf8'));
  const report = gradeCeilings({ merged, dataset });
  const rendered = renderCeilingVerdict(report, label);
  for (const line of rendered.out) console.log(line);
  for (const line of rendered.err) console.error(line);
  // Not a verdict of their own: a shard capture that could not be read leaves
  // its packages ungraded, which the counts above already show. Said, so an
  // OK over five of six shards never reads as an OK over six.
  const notes = [...readProblems, ...merged.problems];
  const shards = merged.shards.length;
  console.error(
    `suite-ceiling: read ${captures.length} shard capture(s) (${shards ? merged.shards.join(', ') : 'none'})` +
      `${notes.length ? `; ${notes.length} could not be fully read, so their packages are ungraded: ${notes.join('; ')}` : ''}.`
  );
  if (rendered.exitCode !== 0) process.exit(rendered.exitCode);
}

// Exports bindings, so an import for those exports alone must run nothing.
if (isEntrypoint(import.meta.url)) {
  main();
}
