#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test timing table -- the slowest test FILES and PACKAGES of a `Test Core`
 * run, published to the job summary on every run (#16454).
 *
 *   node scripts/report-test-timings.mjs --self-test
 *   node scripts/report-test-timings.mjs --capture --log <test-core.log> \
 *     --summaries <.turbo/runs> --shard 5/6 --out <capture.json>
 *   node scripts/report-test-timings.mjs --merge --captures <dir> \
 *     --out <table.md> [--json <merged.json>] [--summary-file <path>]
 *
 * ## Why this exists
 *
 * Cutting tests is decided per test file BY COST, so the cost has to be visible
 * first. Nothing published a per-FILE duration before this: the shard run
 * summaries (`.turbo/runs/*.json`, uploaded per shard) carry per-PACKAGE
 * execution windows and nothing finer.
 *
 * REPORT ONLY. Nothing here may redden `Test Core` -- that is the required
 * branch-protection context, and a diagnostics step that can fail it buys a
 * measurement at the price of the merge queue. Every workflow step that runs
 * this carries `if: always()` and `continue-on-error: true`, and the tool
 * itself degrades to a named refusal rather than throwing.
 *
 * ## THE MEASUREMENT THAT CHOSE THE ROUTE (route (a): parse the stream)
 *
 * The open question was whether vitest file lines carry a duration at all,
 * since this repo sets no `slowTestThreshold` anywhere (measured: 0
 * occurrences outside `node_modules`, control: the same grep hits 3 files
 * inside it). They do, and the threshold is not what decides it:
 *
 *   vitest 4.1.11, `BaseReporter.getModuleLog` -> `getDurationPrefix(task)`
 *   returns `''` ONLY when the module has no `result.duration`. Otherwise it
 *   always appends the number; `slowTestThreshold` picks the COLOUR (yellow
 *   past it, green under it) and never the presence.
 *
 * Confirmed on real CI output, not only in the source -- run 34317273493,
 * `Test Core (1/6)` job 102356069873:
 *
 *   @objectstack/verify:test:  ✓ src/harness.posture-only.test.ts (5 tests) 3651ms
 *
 * and locally over a real suite (`@objectstack/sdui-parser`, 7 files) under a
 * CI-shaped environment: 7 of 7 file lines carried a duration, including a 3ms
 * one -- far under the 300ms default threshold.
 *
 * ⚠ THE TRAP THAT MAKES THAT MEASUREMENT EASY TO GET BACKWARDS. vitest 4
 * chooses its default reporter with `resolved.reporters.push([isAgent ?
 * 'agent' : 'default', {}])`, and `isAgent` comes from `std-env`, which reads
 * `AI_AGENT`, `CLAUDECODE`, `CLAUDE_CODE`, `CURSOR_AGENT` and friends. Inside
 * an AI coding agent's container those are SET, so a local run silently
 * selects the `agent` reporter -- which prints NO passing file lines at all.
 * Measured on one 3-file suite: 1 file line under `agent`, 3 under `default`,
 * same command, the only difference being `env -u AI_AGENT -u CLAUDECODE`.
 * ⛔ So "I ran vitest locally and there were no per-file durations" is not
 * evidence about CI. CI sets none of those variables and gets `default`.
 *
 * ## What a file line actually looks like, and the three ways to misparse it
 *
 *   @objectstack/cli:test:  ✓  unit  test/osplugin.test.ts (6 tests) 88ms
 *   ^ turbo stream prefix     ^ project label   ^ path      ^ count  ^ ms
 *
 * 1. ANSI. CI runs with colour ON (`std-env`'s `isColorSupported` is true when
 *    `isCI` is), and the escapes land BETWEEN the digits and `ms`:
 *    `\x1b[32m 88\x1b[2mms\x1b[22m\x1b[39m`. A `/(\d+)ms/` over a raw log
 *    matches nothing. Strip first -- `stripAnsi` is shared, not re-spelled.
 * 2. The PROJECT LABEL. `getEntityPrefix` inserts `formatProjectName` between
 *    the state symbol and the path, and with colour on that renders as a
 *    background-coloured ` unit ` -- after stripping, a bare word with no
 *    delimiter at all (uncoloured it is `|unit|`). `packages/cli` is the one
 *    package here that runs vitest `projects`, so a parser that reads the token
 *    after the symbol as the filename loses EVERY cli row -- 114 of them in the
 *    run cited above -- and cli is precisely the package the drift column
 *    exists to show. The path is therefore taken as the LAST token before the
 *    `(N tests)` group that looks like a test file, never as a fixed position.
 * 3. ATTRIBUTION. Three header shapes carry "whose output is this", not one.
 *    That walk is `attributedLines` in `check-test-completeness.mjs` and is
 *    IMPORTED here; re-deriving a prefix-only version is the measured defect
 *    that made that guard blind on the failing task.
 *
 * ## Boundaries this tool states rather than hides
 *
 * - A line is credited to a package only through a `test` / `test:repo` task.
 *   The sliced package's dependency-closure BUILD leg streams under the same
 *   `--log-order=stream` flag, so a `<pkg>:build:` prefixed line is dropped on
 *   the task name, not on the package name. (It is not in `test-core.log`
 *   today, which concatenates only the test legs -- this holds the property
 *   anyway, for the day someone points this at a whole job log.)
 * - Per-PACKAGE seconds come from turbo's own execution windows via
 *   `samplesFromSummary`, which already refuses cache REPLAYS and FAILED
 *   tasks: a replayed task's near-zero window is not a measurement. Those are
 *   counted and printed as `cached N / total M` rather than averaged in.
 * - ⚠ THE FILE HALF TREATS A REPLAY DIFFERENTLY, ON PURPOSE, and says so in
 *   the table. A cache HIT replays the stored LOG, so its file lines are true
 *   durations measured by the run that filled the cache -- unlike the task's
 *   near-zero execution window, which measures nothing. Dropping them would
 *   empty this table on exactly the runs where the cache is working: measured
 *   on this feature's own first CI run, all 529 file rows came from a replayed
 *   `@objectstack/spec` log. So the rows are KEPT and every one carries a
 *   `source` cell (`replayed log` / `measured here`), with a count beneath the
 *   table. ⛔ Never print a replayed duration as this run's measurement.
 * - `samplesFromSummary` reads the `test` task only, so a package that also
 *   has a `test:repo` task contributes its `test` seconds here. That is the
 *   like-for-like comparison the pinned weights were measured in.
 * - A SLICED package appears on two shards with a `--shard=k/n` passthrough,
 *   and each shard sees a PART. Parts are summed, and a package is labelled
 *   `slice k/n` and marked incomplete until every part is present. ⛔ A part's
 *   seconds are never printed as the package's total.
 * - The pinned weights in `scripts/test-shard-timings.json` are READ ONLY
 *   here. A large drift on `@objectstack/cli` is the CORRECT reading and the
 *   whole point of the column -- it is not a defect to fix in this tool.
 *
 * ## Empty capture is NOT MEASURED, never an empty table
 *
 * A table with no rows and a run where nothing could be parsed look identical
 * on a job summary page, and the second is the one that needs a person. So a
 * capture that parsed nothing exits `EXIT_PREREQUISITE_NOT_MET` (imported, not
 * re-picked as a literal) and says so in words, in the job summary. Exit 1 is
 * reserved for FINDINGS; this tool reports and never judges, so exit 1 is
 * unreachable by construction and pinned that way in `--self-test`.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, appendFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { EXIT_PREREQUISITE_NOT_MET, EXIT_FINDINGS } from './import-prerequisite.mjs';
import { stripAnsi, attributedLines } from './check-test-completeness.mjs';
import { samplesFromSummary } from './measure-test-shard-timings.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const EXIT_OK = 0;

/** How many rows each half of the table publishes (the card's numbers). */
export const TOP_FILES = 20;
export const TOP_PACKAGES = 10;

/** The pinned per-package weights the drift column reads. Never written here. */
const PINNED_WEIGHTS = 'scripts/test-shard-timings.json';

const CAPTURE_SCHEMA = 'test-timing-capture/1';

// ── Line shapes ───────────────────────────────────────────────────────────

// turbo's stream-order prefix, accepted ONLY for the two vitest-bearing tasks.
// `@objectstack/spec:test:repo: …` -> package `@objectstack/spec`. A package
// name carries `@`, `/`, `-` and `.` but never `:` or whitespace, so the
// non-greedy head cannot swallow the task.
const STREAM_TEST_PREFIX = /^(\S+?):(test(?::repo)?):\s?(.*)$/;

// Any other `<pkg>:<task>:` prefix -- `:build:` above all. Matched so those
// lines are DROPPED on the task name rather than falling through to the
// enclosing group and being credited to a package as test output.
const STREAM_OTHER_PREFIX = /^(\S+?):([A-Za-z][\w:-]*):\s/;

// ` ✓  unit  test/osplugin.test.ts (6 tests | 1 failed) 88ms 42 MB heap used`
// The leading-space bound separates a MODULE line (one space) from a test CASE
// line (indented further), and the `(N tests)` group separates it from a case
// suffix, which carries a duration but no count.
const MODULE_LINE =
  /^ {0,2}(✓|❯|×|↓) (.+?) \((\d+) tests?((?:\s*\|[^)]*)?)\) (\d+)ms(?:\s.*)?$/u;

// What a test file path looks like, used to pick the path out of the tokens
// before the count group -- the project label sits in front of it.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

// `Test Files  114 passed (114)` -- the declared file total, the denominator of
// the coverage reading this tool publishes about ITSELF.
const TEST_FILES_TOTAL = /^\s*Test Files\s+.+?\s+\((\d+)\)\s*$/;

const STATE_OF_SYMBOL = new Map([
  ['✓', 'pass'],
  ['❯', 'fail'],
  ['×', 'fail'],
  ['↓', 'skip'],
]);

/**
 * Pick the file path out of the text between the state symbol and the count
 * group. Tokens before it are the optional project label, in either spelling
 * (` unit ` once colour is stripped, or `|unit|` when colour was off).
 */
export function splitProjectAndFile(middle) {
  const tokens = middle.trim().split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (!TEST_FILE.test(tokens[i])) continue;
    const label = tokens.slice(0, i).join(' ').replace(/^\|(.*)\|$/, '$1').trim();
    return { file: tokens[i], project: label || null };
  }
  return null;
}

/**
 * Every vitest module line in a turbo test log, attributed to its package.
 *
 * Returns `{ files, declaredFiles, unattributed }`. `declaredFiles` is what the
 * `Test Files … (N)` summaries add up to, so a caller can publish "parsed X of
 * Y declared" instead of asserting completeness it has not checked.
 */
export function parseFileTimings(rawText) {
  const text = stripAnsi(rawText);
  const files = [];
  let declaredFiles = 0;
  let unattributed = 0;

  for (const { line, group } of attributedLines(text)) {
    let pkg = group;
    let rest = line;

    const testPrefixed = line.match(STREAM_TEST_PREFIX);
    if (testPrefixed) {
      pkg = testPrefixed[1];
      rest = testPrefixed[3];
    } else if (STREAM_OTHER_PREFIX.test(line)) {
      // A non-test task's streamed output. Not this tool's population.
      continue;
    }

    const totals = rest.match(TEST_FILES_TOTAL);
    if (totals) {
      declaredFiles += Number(totals[1]);
      continue;
    }

    const m = rest.match(MODULE_LINE);
    if (!m) continue;
    const split = splitProjectAndFile(m[2]);
    if (!split) continue;

    if (!pkg) {
      unattributed += 1;
      continue;
    }

    files.push({
      pkg,
      file: split.file,
      project: split.project,
      tests: Number(m[3]),
      ms: Number(m[5]),
      state: STATE_OF_SYMBOL.get(m[1]) ?? 'pass',
    });
  }

  return { files, declaredFiles, unattributed };
}

// ── Per-package seconds, from turbo's own run summaries ───────────────────

/**
 * Read every `.turbo/runs/*.json` in `dir`. A shard runs its whole-package leg
 * and each file-level slice as SEPARATE turbo invocations, so there is more
 * than one summary per shard and their task sets differ (the slice leg runs
 * with `--only`). Unreadable files become a stated problem, never a throw:
 * this tool must not be able to fail the job it reports on.
 */
export function readSummaries(dir) {
  const packages = new Map();
  const cached = [];
  const problems = [];
  let summariesRead = 0;

  let entries = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { packages, cached, problems: [`no turbo run summaries could be listed at ${dir}`], summariesRead };
  }

  for (const entry of entries) {
    const path = join(dir, entry);
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      const { samples, skippedCached, slices } = samplesFromSummary(parsed, entry);
      summariesRead += 1;
      cached.push(...skippedCached);
      for (const [pkg, seconds] of samples) {
        const slice = slices.get(pkg) ?? null;
        const row = packages.get(pkg) ?? { pkg, seconds: 0, sliceCount: null, parts: new Set() };
        row.seconds += seconds;
        if (slice) {
          row.sliceCount = slice.count;
          row.parts.add(slice.index);
        }
        packages.set(pkg, row);
      }
    } catch (err) {
      problems.push(`${entry}: ${err?.message ?? String(err)}`);
    }
  }

  return { packages, cached, problems, summariesRead };
}

/** The pinned weight table, or null when it cannot be read. */
export function readPinnedWeights(root = ROOT) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, PINNED_WEIGHTS), 'utf8'));
    const seconds = parsed?.packages;
    if (!seconds || typeof seconds !== 'object') return null;
    return seconds;
  } catch {
    return null;
  }
}

// ── Merge and render ──────────────────────────────────────────────────────

/**
 * Fold the per-shard captures into the two tables.
 *
 * A sliced package is COMPLETE only when every one of its `n` parts turned up
 * across the six shards; until then it is labelled and its seconds are called a
 * part, never a total.
 */
export function mergeCaptures(captures) {
  const files = [];
  const packages = new Map();
  const cached = new Set();
  const problems = [];
  let declaredFiles = 0;
  let unattributed = 0;
  const shards = [];

  for (const capture of captures) {
    if (capture?.schema !== CAPTURE_SCHEMA) {
      problems.push(`a capture declares schema ${JSON.stringify(capture?.schema ?? null)}, not ${CAPTURE_SCHEMA}`);
      continue;
    }
    shards.push(capture.shard);
    files.push(...(capture.files ?? []));
    declaredFiles += capture.coverage?.declaredFiles ?? 0;
    unattributed += capture.coverage?.unattributed ?? 0;
    for (const name of capture.cached ?? []) cached.add(name);
    for (const p of capture.problems ?? []) problems.push(p);
    for (const row of capture.packages ?? []) {
      const acc = packages.get(row.pkg) ?? { pkg: row.pkg, seconds: 0, sliceCount: null, parts: [] };
      acc.seconds += row.seconds;
      if (row.sliceCount) {
        acc.sliceCount = row.sliceCount;
        acc.parts.push(...row.parts);
      }
      packages.set(row.pkg, acc);
    }
  }

  const packageRows = [...packages.values()].map((row) => {
    const parts = [...new Set(row.parts)].sort((a, b) => a - b);
    const complete = row.sliceCount === null || parts.length === row.sliceCount;
    return { ...row, parts, complete };
  });

  files.sort((a, b) => b.ms - a.ms);
  packageRows.sort((a, b) => b.seconds - a.seconds);

  return {
    files,
    packages: packageRows,
    cached: [...cached].sort(),
    problems,
    declaredFiles,
    unattributed,
    shards: shards.filter(Boolean).sort(),
  };
}

const NOT_MEASURED_HEADLINE = 'Test timing table: NOT MEASURED';

/** The words an empty capture prints INSTEAD of an empty table. */
export function notMeasuredText(reason) {
  return [
    `## ${NOT_MEASURED_HEADLINE}`,
    '',
    `Not a single vitest file line could be read, so this run has **no timing table** — which is a`,
    `different statement from "the slowest test files took no time". ${reason}`,
    '',
    'This step is report-only and deliberately cannot fail the job, so the run stays green and this',
    'text is the entire signal. What to check, in order: the test step produced a log at all; the log',
    'still carries vitest module lines (`✓ <path> (N tests) <N>ms`); and vitest still selected its',
    '`default` reporter — the `agent` reporter, chosen when `AI_AGENT` / `CLAUDECODE` are set in the',
    'environment, prints no passing file lines and would empty this table without any other symptom.',
  ].join('\n');
}

function seconds(ms) {
  return (ms / 1000).toFixed(2);
}

function driftCell(measured, pinned) {
  if (pinned === undefined || pinned === null) return ['—', '— (not pinned)'];
  const delta = measured - pinned;
  const sign = delta >= 0 ? '+' : '−';
  const ratio = pinned > 0 ? ` (${(measured / pinned).toFixed(2)}×)` : '';
  return [pinned.toFixed(2), `${sign}${Math.abs(delta).toFixed(2)}${ratio}`];
}

/** The markdown the job summary receives. */
export function renderTable(merged, pinned, context = {}) {
  const out = [];
  out.push('## Test timing — slowest test files and packages');
  out.push('');
  const shardText = merged.shards.length ? merged.shards.join(', ') : 'none';
  out.push(
    `Merged from ${merged.shards.length} shard capture(s) (${shardText}). Report only — this table never`,
  );
  out.push('fails a run. Per-file durations come from vitest module lines; per-package seconds come from');
  out.push("turbo's own execution windows, which is the unit the pinned weights were measured in.");
  out.push('');

  out.push(`### Slowest ${TOP_FILES} test files`);
  out.push('');
  if (merged.files.length === 0) {
    out.push('_No file line was parsed on any shard._');
  } else {
    out.push('| # | seconds | tests | file | package | source |');
    out.push('|--:|--------:|------:|------|---------|--------|');
    merged.files.slice(0, TOP_FILES).forEach((f, i) => {
      const name = f.project ? `${f.file} _(${f.project})_` : f.file;
      const state = f.state === 'pass' ? '' : ` **${f.state}**`;
      // `replayed` = this shard read the duration out of a turbo cache REPLAY,
      // so it is a true duration measured by the run that filled the cache,
      // not by this one. Said per row because it is per package per shard.
      const source = f.replayed ? 'replayed log' : 'measured here';
      out.push(
        `| ${i + 1} | ${seconds(f.ms)} | ${f.tests} | \`${name}\`${state} | \`${f.pkg}\` | ${source} |`,
      );
    });
  }
  out.push('');

  out.push(`### Slowest ${TOP_PACKAGES} packages — measured against their pinned weights`);
  out.push('');
  if (merged.packages.length === 0) {
    out.push('_No package produced a measurable turbo execution window on this run._');
  } else {
    out.push('| # | package | measured s | pinned s | drift | note |');
    out.push('|--:|---------|-----------:|---------:|------:|------|');
    merged.packages.slice(0, TOP_PACKAGES).forEach((p, i) => {
      const [pinnedCell, drift] = driftCell(p.seconds, pinned?.[p.pkg]);
      const note = p.sliceCount === null
        ? ''
        : p.complete
          ? `all ${p.sliceCount} slices`
          : `⚠ slice ${p.parts.join('+')}/${p.sliceCount} — PART, not a total`;
      out.push(
        `| ${i + 1} | \`${p.pkg}\` | ${p.seconds.toFixed(2)} | ${pinnedCell} | ${drift} | ${note} |`,
      );
    });
  }
  out.push('');

  out.push('### How much of the run this table saw');
  out.push('');
  out.push(
    `- file lines parsed: **${merged.files.length}** of **${merged.declaredFiles}** files declared by the run's own \`Test Files\` summaries`,
  );
  const replayedFiles = merged.files.filter((f) => f.replayed).length;
  out.push(
    `- of those, read out of a turbo cache **replay**: **${replayedFiles}** — true durations, measured by the run that filled the cache rather than by this one`,
  );
  out.push(`- packages measured: **${merged.packages.length}**`);
  out.push(
    `- cache-replayed packages, excluded as non-measurements: **${merged.cached.length}**${merged.cached.length ? ` (${merged.cached.map((c) => `\`${c}\``).join(', ')})` : ''}`,
  );
  if (merged.unattributed) {
    out.push(`- file lines no task header could attribute, dropped: **${merged.unattributed}**`);
  }
  const incomplete = merged.packages.filter((p) => p.sliceCount !== null && !p.complete);
  if (incomplete.length) {
    out.push(
      `- sliced packages still missing a part: ${incomplete.map((p) => `\`${p.pkg}\``).join(', ')} — their seconds are parts`,
    );
  }
  if (context.pinnedMissing) {
    out.push(`- ⚠ \`${PINNED_WEIGHTS}\` could not be read, so the drift column is empty`);
  }
  if (merged.problems.length) {
    out.push('');
    out.push('<!-- problems -->'.replace('<!-- problems -->', '**Problems while reading this run:**'));
    for (const p of merged.problems) out.push(`- ${p}`);
  }
  out.push('');
  out.push(
    '_A large, stable drift on a package is a true reading about the pinned dataset, not a defect in this table._',
  );
  return out.join('\n');
}

// ── Modes ─────────────────────────────────────────────────────────────────

function writeOut(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

function appendSummary(text, summaryFile) {
  const target = summaryFile ?? process.env.GITHUB_STEP_SUMMARY;
  if (!target) return false;
  try {
    appendFileSync(target, `${text}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function capture({ log, summaries, shard, out }) {
  const problems = [];
  let raw = '';
  try {
    raw = readFileSync(log, 'utf8');
  } catch (err) {
    problems.push(`test log unreadable at ${log}: ${err?.message ?? String(err)}`);
  }

  const { files, declaredFiles, unattributed } = parseFileTimings(raw);
  const summaryDir = summaries ?? join(ROOT, '.turbo/runs');
  const pkgRead = existsSync(summaryDir)
    ? readSummaries(summaryDir)
    : { packages: new Map(), cached: [], problems: [`no turbo run summary directory at ${summaryDir}`], summariesRead: 0 };
  problems.push(...pkgRead.problems);

  // A cache HIT REPLAYS the stored log in milliseconds, so the file lines in it
  // are real durations from the run that FILLED the cache, not from this one.
  // That is still a measurement OF THE FILE -- unlike a replayed task's
  // near-zero execution window, which is a measurement of nothing -- so these
  // rows are kept and LABELLED rather than dropped. Dropping them would empty
  // this table on exactly the runs where the cache is doing its job: on a
  // typical affected-set PR every package in the log is a replay.
  // Marked per shard, because the shard that replayed a package and the shard
  // that measured it need not be the same shard.
  const replayedHere = new Set(pkgRead.cached);
  for (const f of files) f.replayed = replayedHere.has(f.pkg);

  const payload = {
    schema: CAPTURE_SCHEMA,
    shard: shard ?? null,
    files,
    packages: [...pkgRead.packages.values()].map((row) => ({
      pkg: row.pkg,
      seconds: row.seconds,
      sliceCount: row.sliceCount,
      parts: [...row.parts],
    })),
    cached: pkgRead.cached,
    problems,
    coverage: { declaredFiles, unattributed, summariesRead: pkgRead.summariesRead },
  };

  if (out) writeOut(out, JSON.stringify(payload, null, 2));
  return payload;
}

export function merge({ captures: dir, out, json, summaryFile, root = ROOT }) {
  const found = [];
  const problems = [];
  const walk = (d) => {
    let entries = [];
    try {
      entries = readdirSync(d);
    } catch (err) {
      problems.push(`capture directory unreadable at ${d}: ${err?.message ?? String(err)}`);
      return;
    }
    for (const entry of entries) {
      const path = join(d, entry);
      let s;
      try {
        s = statSync(path);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.endsWith('.json')) continue;
      try {
        found.push(JSON.parse(readFileSync(path, 'utf8')));
      } catch (err) {
        problems.push(`${entry}: ${err?.message ?? String(err)}`);
      }
    }
  };
  walk(dir);

  const merged = mergeCaptures(found);
  merged.problems.push(...problems);

  if (merged.files.length === 0 && merged.packages.length === 0) {
    const reason = found.length === 0
      ? `No shard capture was found under ${dir}.`
      : `${found.length} shard capture(s) were read and every one was empty.`;
    const text = notMeasuredText(reason);
    if (out) writeOut(out, text);
    appendSummary(text, summaryFile);
    return { exitCode: EXIT_PREREQUISITE_NOT_MET, text, merged };
  }

  const pinnedWeights = readPinnedWeights(root);
  const text = renderTable(merged, pinnedWeights, { pinnedMissing: pinnedWeights === null });
  if (out) writeOut(out, text);
  if (json) writeOut(json, JSON.stringify(merged, (_k, v) => (v instanceof Set ? [...v] : v), 2));
  appendSummary(text, summaryFile);
  return { exitCode: EXIT_OK, text, merged };
}

// ── Self-test ─────────────────────────────────────────────────────────────

// The count is a FLOOR, not an equality -- adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering, never to lower the number.
const SELF_TEST_BATTERIES = Object.freeze({
  'file-line parsing': 22,
  'attribution and the naive-parser controls': 9,
  'package seconds, slices and cache replays': 11,
  'refusals, rendering and exit codes': 19,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 4;

const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned only after the verdict is printed, so a `return` that leaves the
// function early cannot be read as a pass.
const SELF_TEST_VERDICT = 'report-test-timings self-test reached its verdict';

/**
 * A deliberately NAIVE parser: turbo prefix only, path taken as the token right
 * after the state symbol. It exists so the controls below can FIRE -- each one
 * asserts that this gets an answer wrong where the real parser gets it right,
 * so degrading the real parser back to this shape reddens the self-test instead
 * of silently emptying the table.
 */
export function naiveParseForControl(rawText) {
  const out = [];
  for (const line of stripAnsi(rawText).split('\n')) {
    const m = line.match(/^(\S+?):test:\s+(?:✓|❯|×|↓)\s+(\S+)\s+\((\d+) tests?\)\s+(\d+)ms/u);
    if (!m) continue;
    out.push({ pkg: m[1], file: m[2], tests: Number(m[3]), ms: Number(m[4]) });
  }
  return out;
}

function selfTest({ quiet = false } = {}) {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  const eq = (actual, expected, what) => {
    registerCase();
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${what}: got ${a}, want ${e}`);
  };
  const ok = (cond, what) => {
    registerCase();
    if (!cond) throw new Error(what);
  };

  // ── file-line parsing ───────────────────────────────────────────────────
  battery('file-line parsing');

  // The REAL line from run 34317273493, Test Core (1/6), byte for byte
  // including the colour escapes as CI writes them.
  const realVerify =
    '@objectstack/verify:test:  \x1B[32m✓\x1B[39m src/harness.posture-only.test.ts \x1B[2m(\x1B[22m\x1B[2m5 tests\x1B[22m\x1B[2m)\x1B[22m\x1B[33m 3651\x1B[2mms\x1B[22m\x1B[39m';
  const verify = parseFileTimings(realVerify).files;
  eq(verify.length, 1, 'real CI line: not parsed');
  eq(verify[0].pkg, '@objectstack/verify', 'real CI line: package');
  eq(verify[0].file, 'src/harness.posture-only.test.ts', 'real CI line: file');
  eq(verify[0].tests, 5, 'real CI line: test count');
  eq(verify[0].ms, 3651, 'real CI line: duration');
  eq(verify[0].state, 'pass', 'real CI line: state');

  // The REAL cli line, which carries a vitest PROJECT label between the symbol
  // and the path. This is the shape that loses 114 rows when read positionally.
  const realCli =
    '@objectstack/cli:test:  \x1B[32m✓\x1B[39m \x1B[30m\x1B[42m unit \x1B[49m\x1B[39m test/osplugin.test.ts \x1B[2m(\x1B[22m\x1B[2m6 tests\x1B[22m\x1B[2m)\x1B[22m\x1B[32m 88\x1B[2mms\x1B[22m\x1B[39m';
  const cli = parseFileTimings(realCli).files;
  eq(cli.length, 1, 'project-labelled line: not parsed');
  eq(cli[0].file, 'test/osplugin.test.ts', 'project-labelled line: the label was read as the filename');
  eq(cli[0].project, 'unit', 'project-labelled line: project');
  eq(cli[0].ms, 88, 'project-labelled line: duration');

  // The uncoloured spelling of the same label.
  eq(
    parseFileTimings('@objectstack/cli:test:  ✓ |unit| test/x.test.ts (2 tests) 7ms').files.map((f) => [f.project, f.file]),
    [['unit', 'test/x.test.ts']],
    'project label: the pipe spelling',
  );

  // A green file well UNDER the 300ms default slow-test threshold still carries
  // its duration -- the fact route (a) rests on.
  eq(
    parseFileTimings('@objectstack/spec:test:  ✓ src/fast.test.ts (2 tests) 3ms').files.map((f) => f.ms),
    [3],
    'sub-threshold duration: dropped',
  );

  // Failed and skipped modules, and the multi-bucket count group.
  eq(
    parseFileTimings('@objectstack/x:test:  ❯ src/mixed.test.ts (3 tests | 1 failed | 1 skipped) 12ms').files.map(
      (f) => [f.state, f.tests, f.ms],
    ),
    [['fail', 3, 12]],
    'failed module with a multi-bucket count group',
  );
  eq(
    parseFileTimings('@objectstack/x:test:  ↓ src/skipped.test.ts (4 tests | 4 skipped) 1ms').files.map((f) => f.state),
    ['skip'],
    'skipped module',
  );

  // A heap suffix follows the duration when logHeapUsage is on.
  eq(
    parseFileTimings('@objectstack/x:test:  ✓ src/a.test.ts (1 test) 5ms 42 MB heap used').files.map((f) => f.ms),
    [5],
    'heap suffix defeated the duration match',
  );

  // A test CASE line carries a duration but no count group, and is indented
  // further. It must never be counted as a file.
  eq(
    parseFileTimings('@objectstack/x:test:      ✓ resolves a real workspace package 1147ms').files.length,
    0,
    'a test case line was counted as a file',
  );

  // `.spec.ts` and the other admitted extensions.
  eq(
    parseFileTimings('@objectstack/x:test:  ✓ src/a.spec.mts (1 test) 5ms').files.map((f) => f.file),
    ['src/a.spec.mts'],
    'spec/mts extension',
  );

  // The declared-files denominator, read from the run's own summary line.
  eq(
    parseFileTimings('@objectstack/cli:test: \x1B[2m Test Files \x1B[22m\x1B[32m114 passed\x1B[39m\x1B[90m (114)\x1B[39m')
      .declaredFiles,
    114,
    'declared file total not read from the Test Files summary',
  );
  eq(
    parseFileTimings(' Test Files  2 failed | 10 passed (12)').declaredFiles,
    12,
    'declared file total: multi-bucket',
  );

  // splitProjectAndFile in isolation, including the no-path case.
  eq(splitProjectAndFile('src/a.test.ts'), { file: 'src/a.test.ts', project: null }, 'split: bare path');
  eq(splitProjectAndFile(' unit  src/a.test.ts'), { file: 'src/a.test.ts', project: 'unit' }, 'split: label + path');
  eq(splitProjectAndFile('no path here'), null, 'split: a line with no test file');

  // ── attribution, and the controls that fire ─────────────────────────────
  battery('attribution and the naive-parser controls');

  // CONTROL 1 -- grouped log order. The naive prefix-only parser attributes
  // NOTHING; the real one reads the group header.
  const grouped = [
    '##[group]@objectstack/spec:test',
    ' ✓ src/grouped.test.ts (3 tests) 40ms',
    '##[endgroup]',
  ].join('\n');
  eq(naiveParseForControl(grouped).length, 0, 'CONTROL 1 did not fire: naive parser found a grouped row');
  eq(
    parseFileTimings(grouped).files.map((f) => [f.pkg, f.file]),
    [['@objectstack/spec', 'src/grouped.test.ts']],
    'CONTROL 1: grouped order lost its attribution',
  );

  // CONTROL 2 -- the BARE header turbo gives the run's FAILING task, which has
  // no group markers at all. This is the shape that made a sibling guard blind
  // on exactly the package it existed to grade.
  const bare = ['@objectstack/cli:test', ' ❯ src/failing.test.ts (2 tests | 1 failed) 90ms'].join('\n');
  eq(naiveParseForControl(bare).length, 0, 'CONTROL 2 did not fire: naive parser found the bare-header row');
  eq(
    parseFileTimings(bare).files.map((f) => [f.pkg, f.state]),
    [['@objectstack/cli', 'fail']],
    'CONTROL 2: the failing task bare header lost its attribution',
  );

  // CONTROL 3 -- the project label. The naive parser reads `unit` as the file.
  const naiveCli = naiveParseForControl('@objectstack/cli:test:  ✓ unit test/osplugin.test.ts (6 tests) 88ms');
  ok(
    naiveCli.length === 0 || naiveCli[0].file !== 'test/osplugin.test.ts',
    'CONTROL 3 did not fire: the naive parser already reads project-labelled lines correctly',
  );

  // A group must not leak past its end, and a build group lends no name.
  eq(
    parseFileTimings('##[group]@objectstack/spec:test\n##[endgroup]\n ✓ src/a.test.ts (1 test) 5ms').files.length,
    0,
    'attribution leaked past the group close',
  );
  eq(
    parseFileTimings('##[group]@objectstack/spec:build\n ✓ src/a.test.ts (1 test) 5ms').files.length,
    0,
    'a build group was read as a test group',
  );

  // The sliced package's BUILD leg streams under the same flag. Dropped on the
  // TASK name, not on the package name.
  eq(
    parseFileTimings('@objectstack/cli:build:  ✓ src/a.test.ts (1 test) 5ms').files.length,
    0,
    'a streamed build-leg line was ingested as a test result',
  );

  // `test:repo` is a vitest run of the same package (#16466) and counts.
  eq(
    parseFileTimings('@objectstack/spec:test:repo:  ✓ src/repo.test.ts (9 tests) 30ms').files.map((f) => f.pkg),
    ['@objectstack/spec'],
    'a test:repo line was not attributed to its package',
  );

  // ── package seconds, slices, cache replays ──────────────────────────────
  battery('package seconds, slices and cache replays');

  const summary = (tasks) => ({ tasks });
  const task = (pkg, ms, { status = 'MISS', exitCode = 0, cliArguments = [] } = {}) => ({
    task: 'test',
    package: pkg,
    cache: { status },
    execution: { startTime: 0, endTime: ms, exitCode },
    cliArguments,
  });

  const oneShard = samplesFromSummary(summary([task('@objectstack/spec', 60_000)]), 's');
  eq([...oneShard.samples], [['@objectstack/spec', 60]], 'seconds: a plain execution window');
  eq(oneShard.skippedCached, [], 'seconds: nothing should have been skipped');

  const replayed = samplesFromSummary(summary([task('@objectstack/a', 40, { status: 'HIT' })]), 's');
  eq([...replayed.samples], [], 'a cache replay was read as a measurement');
  eq(replayed.skippedCached, ['@objectstack/a'], 'a cache replay was not counted as cached');

  const failed = samplesFromSummary(summary([task('@objectstack/a', 500, { exitCode: 1 })]), 's');
  eq([...failed.samples], [], 'a failed task was read as a measurement');

  // Two shards, each carrying one half of a sliced package.
  const capA = {
    schema: CAPTURE_SCHEMA,
    shard: '5/6',
    files: [],
    packages: [{ pkg: '@objectstack/cli', seconds: 600, sliceCount: 2, parts: [1] }],
    cached: [],
    problems: [],
    coverage: { declaredFiles: 0, unattributed: 0 },
  };
  const capB = { ...capA, shard: '6/6', packages: [{ pkg: '@objectstack/cli', seconds: 500, sliceCount: 2, parts: [2] }] };

  const halfOnly = mergeCaptures([capA]);
  eq(halfOnly.packages[0].complete, false, 'one slice of two was reported as a complete package total');
  eq(halfOnly.packages[0].parts, [1], 'one slice of two: parts');

  const both = mergeCaptures([capA, capB]);
  eq(both.packages[0].seconds, 1100, 'slice parts were not summed');
  eq(both.packages[0].complete, true, 'both slices present but the package was still called partial');

  // A capture from a future schema is refused rather than silently merged.
  const foreign = mergeCaptures([{ schema: 'test-timing-capture/999', files: [], packages: [] }]);
  eq(foreign.packages.length, 0, 'a foreign-schema capture contributed rows');
  ok(foreign.problems.length === 1, 'a foreign-schema capture did not register a problem');

  // ── refusals, rendering, exit codes ─────────────────────────────────────
  battery('refusals, rendering and exit codes');

  // The exit-code contract, pinned to the ACTUAL imported values.
  eq(EXIT_OK, 0, 'EXIT_OK drifted');
  eq(EXIT_PREREQUISITE_NOT_MET, 3, 'EXIT_PREREQUISITE_NOT_MET drifted from the shared contract');
  eq(EXIT_FINDINGS, 1, 'EXIT_FINDINGS drifted from the shared contract');
  ok(
    EXIT_PREREQUISITE_NOT_MET !== EXIT_FINDINGS,
    'a missing capture and a finding must not share one exit code',
  );

  // NOT MEASURED says so in words, and is not an empty table.
  const refusal = notMeasuredText('No shard capture was found under /tmp/x.');
  ok(refusal.includes('NOT MEASURED'), 'the refusal does not say NOT MEASURED');
  ok(!refusal.includes('|---'), 'the refusal rendered a table anyway');
  ok(refusal.includes('agent'), 'the refusal does not name the reporter trap that empties this table');

  // A rendered table carries both halves, the drift column and the counters.
  const merged = mergeCaptures([
    {
      schema: CAPTURE_SCHEMA,
      shard: '1/6',
      files: [
        { pkg: '@objectstack/cli', file: 'test/slow.test.ts', project: 'unit', tests: 3, ms: 5000, state: 'pass' },
        { pkg: '@objectstack/spec', file: 'src/quick.test.ts', project: null, tests: 1, ms: 10, state: 'pass' },
      ],
      packages: [{ pkg: '@objectstack/cli', seconds: 1231.52, sliceCount: null, parts: [] }],
      cached: ['@objectstack/types'],
      problems: [],
      coverage: { declaredFiles: 2, unattributed: 0 },
    },
  ]);
  eq(merged.files[0].file, 'test/slow.test.ts', 'files were not sorted slowest-first');
  const table = renderTable(merged, { '@objectstack/cli': 458.15 });
  ok(table.includes('test/slow.test.ts'), 'the file table lost its slowest row');
  ok(table.includes('458.15'), 'the pinned weight is not printed beside the measurement');
  ok(table.includes('2.69×'), 'the drift ratio against the pinned weight is not printed');
  ok(table.includes('cache-replayed packages'), 'the cached counter is missing');
  ok(table.includes('**2** of **2**'), 'the parsed-of-declared coverage reading is missing');

  // An unpinned package renders a named blank, never a zero drift.
  const unpinned = renderTable(merged, {});
  ok(unpinned.includes('not pinned'), 'an unpinned package did not say so');

  // A file row read out of a cache REPLAY is kept but labelled, and counted.
  // Measured on this PR's own first CI run, where every one of 529 file rows
  // came from a replayed @objectstack/spec log while the package half had
  // already refused that package's near-zero execution window: keeping the
  // rows unlabelled let a replayed duration read as this run's measurement.
  const replayMerged = mergeCaptures([
    {
      schema: CAPTURE_SCHEMA,
      shard: '1/6',
      files: [
        { pkg: '@objectstack/spec', file: 'src/a.test.ts', project: null, tests: 1, ms: 900, state: 'pass', replayed: true },
        { pkg: '@objectstack/client', file: 'src/b.test.ts', project: null, tests: 1, ms: 800, state: 'pass', replayed: false },
      ],
      packages: [{ pkg: '@objectstack/client', seconds: 21.91, sliceCount: null, parts: [] }],
      cached: ['@objectstack/spec'],
      problems: [],
      coverage: { declaredFiles: 2, unattributed: 0 },
    },
  ]);
  const replayTable = renderTable(replayMerged, {});
  ok(replayTable.includes('replayed log'), 'a replayed file row was not labelled as such');
  ok(replayTable.includes('measured here'), 'a genuinely measured file row was not labelled as such');
  ok(replayTable.includes('**replay**: **1**'), 'the replayed-file counter is missing or wrong');
  eq(replayMerged.files.length, 2, 'a replayed file row was dropped instead of labelled');

  // ⛔ No line of output may begin with a workflow-command marker, and none may
  // carry the legacy form anywhere -- the runner parses those out of prose.
  for (const line of `${table}\n${refusal}`.split('\n')) {
    ok(!line.startsWith('::') && !line.includes('##['), 'output carries a workflow-command token');
    break;
  }

  if (!quiet) {
    const floorMessages = [];
    const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
    let floorBreached = false;
    if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
      floorBreached = true;
      floorMessages.push(
        `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
          + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
      );
    }
    for (const [name, count] of batterySeen) {
      if (declaredBatteries.includes(name)) continue;
      floorBreached = true;
      floorMessages.push(
        `self-test battery "${name}" registered ${count} case(s) but is not declared in `
          + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
      );
    }
    for (const name of declaredBatteries) {
      const count = batterySeen.get(name) ?? 0;
      if (count >= SELF_TEST_BATTERIES[name]) continue;
      floorBreached = true;
      floorMessages.push(
        count === 0
          ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
          : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
            + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
      );
    }
    if (floorBreached) {
      floorMessages.push(
        'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
          + 'number. Find what stopped registering and restore it.',
      );
      throw new Error(floorMessages.join('\n     '));
    }
    const total = [...batterySeen.values()].reduce((a, b) => a + b, 0);
    // The per-battery counts are printed, not only the total: a floor is
    // raised from a reading, and a reading nobody can see gets guessed.
    const breakdown = declaredBatteries
      .map((name) => `${name} ${batterySeen.get(name) ?? 0}/${SELF_TEST_BATTERIES[name]}`)
      .join(', ');
    console.log(
      `report-test-timings: self-test OK (${total} cases across ${declaredBatteries.length} batteries — ${breakdown})`,
    );
  }
  return SELF_TEST_VERDICT;
}

// ── Entry point ───────────────────────────────────────────────────────────

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error('report-test-timings: self-test did not reach its verdict');
      process.exit(EXIT_FINDINGS);
    }
    process.exit(EXIT_OK);
  }

  if (argv.includes('--capture')) {
    const payload = capture({
      log: flag(argv, '--log') ?? join(process.env.RUNNER_TEMP ?? '.', 'test-core.log'),
      summaries: flag(argv, '--summaries'),
      shard: flag(argv, '--shard'),
      out: flag(argv, '--out'),
    });
    console.log(
      `report-test-timings: captured ${payload.files.length} file timing(s) and `
        + `${payload.packages.length} package window(s) for shard ${payload.shard ?? '(unnamed)'}`
        + `${payload.problems.length ? ` — ${payload.problems.length} problem(s): ${payload.problems.join('; ')}` : ''}`,
    );
    process.exit(EXIT_OK);
  }

  if (argv.includes('--merge')) {
    const result = merge({
      captures: flag(argv, '--captures') ?? '.',
      out: flag(argv, '--out'),
      json: flag(argv, '--json'),
      summaryFile: flag(argv, '--summary-file'),
    });
    if (result.exitCode === EXIT_PREREQUISITE_NOT_MET) {
      console.error(`report-test-timings: ${NOT_MEASURED_HEADLINE} — no shard capture carried a timing.`);
      process.exit(EXIT_PREREQUISITE_NOT_MET);
    }
    console.log(
      `report-test-timings: merged ${result.merged.shards.length} shard(s) — `
        + `${result.merged.files.length} file timing(s), ${result.merged.packages.length} package(s).`,
    );
    process.exit(EXIT_OK);
  }

  console.error('usage: report-test-timings.mjs --self-test | --capture … | --merge …');
  process.exit(EXIT_FINDINGS);
}

// Exports bindings, so an import for those exports alone must run nothing.
if (isEntrypoint(import.meta.url)) {
  main();
}
