#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// report-test-leftovers -- list every path a job's test run ADDED to the
// working tree, ignored paths included. REPORT ONLY: it never fails a job.
//
//   node scripts/ci/report-test-leftovers.mjs snapshot --out <file>
//   node scripts/ci/report-test-leftovers.mjs report --before <file> [--label <text>]
//                                             [--summary <file>] [--json <file>]
//   node scripts/ci/report-test-leftovers.mjs --self-test
//
// ## Why it exists (#23880, the maintainer's ruling 乙, comment 6235054403)
//
// A test that writes state into the working tree -- a temporary database, a
// `.objectstack/data/*.json` file, a cache, a generated file -- and does not
// clean it up hands that state to the next run in the same checkout, which then
// starts from the residue instead of from the tree. Nothing on the per-PR path
// looked for it: `.objectstack` is in `.gitignore`, so `git status` cannot see
// the class at all. The nightly double run that used to stand in for this
// (`Rerun Safety`, retired by the same ruling) measured consequences -- a red
// second pass -- and named no file.
//
// So each job in ci.yml that runs package tests takes a snapshot of the tree's
// untracked and ignored paths after its build and before its tests, and a
// report after its tests lists what the test run added, grouped by package
// directory: a table in the job summary and one `::warning::` annotation per
// package. Existing leftovers become cards in each package's own lane; whether
// the report ever blocks anything is the maintainer's decision, not this file's.
//
// ## It never fails a job, by construction
//
// `snapshot` and `report` exit 0 on every path: on findings, on bad arguments,
// on a missing snapshot, on a crash. A failure to measure prints one
// `::warning::` saying the report is NOT MEASURED for this job, and exits 0.
// The workflow steps carry no `continue-on-error` -- the ruling asked for a
// script that cannot fail, not a failure that is discarded. The one thing this
// file cannot catch is its own source failing to load; `--self-test` loads it
// on every pull request in `Lint & Repo Gates`, so that breakage reddens there
// before it can reach a test job. `--self-test` is the only mode that exits 1.
//
// ## The listing: `git ls-files --others -z`, with NO exclude flags
//
// Without `--exclude-standard` git applies no ignore rules, so `--others` lists
// every untracked file, ignored ones included, file by file. That is the whole
// point: `.objectstack/` is ignored. The alternatives were measured against it:
//
//   * `git ls-files --others --exclude-standard` lists only NON-ignored paths,
//     so it is blind to exactly the class this exists for.
//   * `--ignored --directory` collapses an ignored directory to one entry, so a
//     new file inside an ignored directory that already existed (a second
//     `.objectstack/data/*.json`) is invisible.
//   * `git status --porcelain --ignored --untracked-files=all` lists the same
//     paths but also refreshes the index and diffs every tracked file, work the
//     listing does not need; `ls-files` is the plumbing for exactly this list.
//
// Cost, measured on a fresh worktree of this repository after `pnpm install`:
// 85066 paths in 0.4 s, 83769 of them under `node_modules/.pnpm`. Git does not
// follow symlinks, so each package's `node_modules/<dep>` link is one entry.
//
// ## What is NOT counted -- a closed list, each rule with its reason
//
// Every rule below is counted in the summary, so nothing is dropped silently.
//
//   turbo-state           `.turbo/` at the repository root: turbo's local cache,
//                         and the `--summarize` run summaries the Test Core job
//                         reads back and uploads in its later steps.
//   turbo-task-log        `<dir>/.turbo/turbo-<task>.log`: turbo writes every
//                         task's log there, the test task's included.
//   vitest-results-cache  `<dir>/node_modules/.vite/vitest/`: vitest records each
//                         test file's duration and pass/fail there, and the next
//                         run reads it only to order its files.
//   own-build-output      the declared `outputs` of a task a test task depends on
//                         WITHOUT `^` in turbo.json (today `@objectstack/cli#test`
//                         and `@objectstack/metadata#test` depend on their own
//                         `build`). The job's dependency-closure step builds the
//                         `^build` closure before the snapshot, but a package's
//                         OWN build runs inside the test step, after it. Derived
//                         from turbo.json on every run, never hand-listed.
//
// ## What it cannot see -- the boundary of an empty report
//
//   * State written OUTSIDE the repository tree: `$HOME`, the OS temp directory,
//     a database server. The snapshot is of the tree only.
//   * A path that existed before the snapshot and that a test rewrote: only
//     paths that are NEW count as added.
//   * A tracked file a test modified (that one `git status` already shows).
//   * Empty directories, which git does not list.
//   * A package whose test task REPLAYED from the turbo cache ran no test, so it
//     can add nothing; an empty row for it is not a clean bill.
//   * A file written inside one of the excluded locations above.

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { workspacePackages } from '../workspace-enumerator.mjs';

const SELF = fileURLToPath(import.meta.url);

export const SNAPSHOT_SCHEMA = 'test-leftovers-snapshot/1';
export const ROOT_GROUP = '(root)';
export const EXAMPLES_PER_PACKAGE = 5;

// GitHub shows at most 10 warning annotations per step and drops the rest
// without saying so. Past that many packages the last slot becomes one roll-up
// annotation naming the rest, so no package is dropped silently; the job
// summary always carries every row.
export const ANNOTATIONS_PER_STEP = 10;

// The turbo tasks the test steps of ci.yml run (`turbo run test test:repo`,
// `turbo run test`). Their non-`^` dependencies run after the snapshot.
export const TEST_TASKS = Object.freeze(['test', 'test:repo']);

// The turbo configuration the own-build rule reads, a repo-relative literal.
export const TURBO_CONFIG = 'turbo.json';

// The fixed rules. Each is pure over a repo-relative POSIX path. The
// own-build rule needs the turbo-derived context and lives in `classify`.
export const FIXED_EXCLUSIONS = Object.freeze([
  Object.freeze({
    id: 'turbo-state',
    label: "turbo's own state under `.turbo/` at the repository root",
    test: (path) => path.startsWith('.turbo/'),
  }),
  Object.freeze({
    id: 'turbo-task-log',
    label: 'turbo task logs (`.turbo/turbo-TASK.log` in a package)',
    test: (path) => /(^|\/)\.turbo\/turbo-[^/]+\.log$/.test(path),
  }),
  Object.freeze({
    id: 'vitest-results-cache',
    label: "vitest's results cache (`node_modules/.vite/vitest/` in a package)",
    test: (path) => /(^|\/)node_modules\/\.vite\/vitest\//.test(path),
  }),
]);

export const OWN_BUILD_EXCLUSION = Object.freeze({
  id: 'own-build-output',
  label: 'declared outputs of a build the test step runs itself (turbo.json `dependsOn` without `^`)',
});

// ---------------------------------------------------------------------------
// Listing and snapshots
// ---------------------------------------------------------------------------

/**
 * Every untracked path under `root`, ignored ones included, repo-relative and
 * sorted. See the header for why there is no exclude flag.
 */
export function listUntracked(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '--others', '-z'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\0').filter(Boolean).sort();
}

export function repoRoot(cwd = process.cwd()) {
  return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isInside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// ---------------------------------------------------------------------------
// turbo.json -> the build outputs a test step writes after the snapshot
// ---------------------------------------------------------------------------

/** A turbo output glob, relative to its package directory, as a RegExp. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function taskConfig(tasks, pkgName, task) {
  return tasks[`${pkgName}#${task}`] ?? tasks[task] ?? null;
}

/**
 * For every workspace package whose test task depends on a task WITHOUT `^`,
 * the declared outputs of that task (followed transitively through further
 * non-`^` dependencies), keyed by the directory they are written under.
 *
 * @param {object} turbo parsed turbo.json
 * @param {Array<{dir: string, manifest: object}>} packages
 * @returns {Map<string, {tasks: string[], include: RegExp[], exclude: RegExp[]}>}
 */
export function deriveOwnBuild(turbo, packages) {
  const tasks = turbo?.tasks ?? turbo?.pipeline ?? {};
  const dirOf = new Map();
  for (const { dir, manifest } of packages) {
    if (typeof manifest?.name === 'string') dirOf.set(manifest.name, dir);
  }
  const result = new Map();
  const add = (pkgName, task) => {
    const dir = dirOf.get(pkgName);
    if (dir === undefined) return;
    const cfg = taskConfig(tasks, pkgName, task);
    const entry = result.get(dir) ?? { tasks: [], include: [], exclude: [] };
    const id = `${pkgName}#${task}`;
    if (entry.tasks.includes(id)) return;
    entry.tasks.push(id);
    for (const glob of cfg?.outputs ?? []) {
      if (typeof glob !== 'string' || glob === '') continue;
      if (glob.startsWith('!')) entry.exclude.push(globToRegExp(glob.slice(1)));
      else entry.include.push(globToRegExp(glob));
    }
    result.set(dir, entry);
    for (const dep of cfg?.dependsOn ?? []) follow(pkgName, dep);
  };
  const follow = (pkgName, dep) => {
    if (typeof dep !== 'string' || dep.startsWith('^') || dep.startsWith('$')) return;
    const hash = dep.lastIndexOf('#');
    if (hash > 0) add(dep.slice(0, hash), dep.slice(hash + 1));
    else add(pkgName, dep);
  };
  for (const { manifest } of packages) {
    const name = manifest?.name;
    if (typeof name !== 'string') continue;
    for (const testTask of TEST_TASKS) {
      if (typeof manifest?.scripts?.[testTask] !== 'string') continue;
      for (const dep of taskConfig(tasks, name, testTask)?.dependsOn ?? []) follow(name, dep);
    }
  }
  for (const [dir, entry] of result) if (entry.include.length === 0) result.delete(dir);
  return result;
}

// ---------------------------------------------------------------------------
// The report itself -- pure over two listings
// ---------------------------------------------------------------------------

/** The nearest enclosing package directory, or ROOT_GROUP. */
export function packageOf(path, packageDirs) {
  let best = null;
  for (const dir of packageDirs) {
    if ((path === dir || path.startsWith(`${dir}/`)) && (best === null || dir.length > best.length)) best = dir;
  }
  return best ?? ROOT_GROUP;
}

export function classify(path, { packageDirs, ownBuild }) {
  for (const rule of FIXED_EXCLUSIONS) {
    if (rule.test(path)) return { excluded: rule.id };
  }
  const pkg = packageOf(path, packageDirs);
  const built = pkg === ROOT_GROUP ? undefined : ownBuild?.get(pkg);
  if (built) {
    const rel = path.slice(pkg.length + 1);
    if (built.include.some((re) => re.test(rel)) && !built.exclude.some((re) => re.test(rel))) {
      return { excluded: OWN_BUILD_EXCLUSION.id };
    }
  }
  return { pkg };
}

/**
 * @param {{before: string[], after: string[], packageDirs: string[], ownBuild?: Map}} input
 */
export function computeReport({ before, after, packageDirs, ownBuild = new Map() }) {
  const had = new Set(before);
  const now = new Set(after);
  const added = [...now].filter((p) => !had.has(p)).sort();
  const removed = [...had].filter((p) => !now.has(p)).length;
  const byPackage = new Map();
  const excluded = new Map();
  for (const path of added) {
    const verdict = classify(path, { packageDirs, ownBuild });
    if (verdict.excluded) {
      excluded.set(verdict.excluded, (excluded.get(verdict.excluded) ?? 0) + 1);
      continue;
    }
    const list = byPackage.get(verdict.pkg) ?? [];
    list.push(path);
    byPackage.set(verdict.pkg, list);
  }
  const packages = [...byPackage]
    .map(([dir, paths]) => ({ dir, count: paths.length, paths }))
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));
  const counted = packages.reduce((n, p) => n + p.count, 0);
  return { added: added.length, removed, counted, packages, excluded };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Workflow-command data escaping: `%` first, or it would re-escape the others. */
export function escapeData(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Workflow-command property escaping (`title=`). */
export function escapeProperty(text) {
  return escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function code(text) {
  return `\`${String(text).replace(/`/g, "'").replace(/\|/g, '\\|')}\``;
}

function exclusionLines(report) {
  const labels = new Map([...FIXED_EXCLUSIONS, OWN_BUILD_EXCLUSION].map((r) => [r.id, r.label]));
  return [...report.excluded].map(([id, n]) => `${n} ${labels.get(id) ?? id}`);
}

export function renderAnnotations(report, { label }) {
  const one = (pkg) => {
    const examples = pkg.paths.slice(0, EXAMPLES_PER_PACKAGE).join(', ');
    const more = pkg.count > EXAMPLES_PER_PACKAGE ? `, and ${pkg.count - EXAMPLES_PER_PACKAGE} more` : '';
    return (
      `::warning title=${escapeProperty(`Test leftovers: ${pkg.dir}`)}::` +
      escapeData(
        `${pkg.dir}: ${pkg.count} path(s) added to the working tree by the test run of ${label}, e.g. ` +
          `${examples}${more}. Report only -- this never fails the job; the job summary lists every row.`,
      )
    );
  };
  if (report.packages.length <= ANNOTATIONS_PER_STEP) return report.packages.map(one);
  const shown = report.packages.slice(0, ANNOTATIONS_PER_STEP - 1);
  const rest = report.packages.slice(ANNOTATIONS_PER_STEP - 1);
  const restPaths = rest.reduce((n, p) => n + p.count, 0);
  return [
    ...shown.map(one),
    `::warning title=${escapeProperty('Test leftovers: more packages')}::` +
      escapeData(
        `${rest.length} more package(s) left ${restPaths} path(s) in the working tree during the test run of ${label}: ` +
          `${rest.map((p) => `${p.dir} (${p.count})`).join(', ')}. GitHub shows ${ANNOTATIONS_PER_STEP} warnings per ` +
          'step, so these share one; the job summary lists every row.',
      ),
  ];
}

export function renderSummary(report, { label, notes = [] }) {
  const lines = [`### Test leftovers: ${label}`, ''];
  lines.push(
    'Report only: this step never fails the job. Every path the test run ADDED to the working tree since the ' +
      'snapshot taken after the build, ignored paths included, grouped by package directory.',
    '',
  );
  if (report.packages.length === 0) {
    lines.push(`No path was added by the test run (${report.added} new path(s) in all, none outside the rules below).`, '');
  } else {
    lines.push(`| package | paths added | examples (up to ${EXAMPLES_PER_PACKAGE}) |`, '| :-- | --: | :-- |');
    for (const pkg of report.packages) {
      lines.push(`| ${code(pkg.dir)} | ${pkg.count} | ${pkg.paths.slice(0, EXAMPLES_PER_PACKAGE).map(code).join(', ')} |`);
    }
    lines.push('');
  }
  const excl = exclusionLines(report);
  lines.push(
    excl.length > 0
      ? `Not counted, each by a fixed rule in \`scripts/ci/report-test-leftovers.mjs\`: ${excl.join('; ')}.`
      : 'Not counted: nothing (no new path fell under a fixed rule).',
  );
  for (const note of notes) lines.push('', note);
  lines.push(
    '',
    'Not seen at all: state written outside the repository tree (`$HOME`, the OS temp directory), a path that ' +
      'existed before the snapshot and was rewritten, and a tracked file a test modified.',
    '',
  );
  return lines.join('\n');
}

export function renderLog(report, { label }) {
  const lines = [];
  if (report.packages.length === 0) {
    lines.push(`test-leftovers: ${label} -- no path added by the test run (report only).`);
  } else {
    lines.push(
      `test-leftovers: ${label} -- ${report.packages.length} package(s) left ${report.counted} path(s) in the ` +
        'working tree (report only; this step never fails the job).',
    );
    for (const pkg of report.packages) {
      lines.push(`  ${pkg.dir}  ${pkg.count}`);
      for (const path of pkg.paths) lines.push(`      ${path}`);
    }
  }
  const excl = exclusionLines(report);
  if (excl.length > 0) lines.push(`  not counted: ${excl.join('; ')}`);
  return lines;
}

// ---------------------------------------------------------------------------
// The two in-job modes -- neither can exit non-zero
// ---------------------------------------------------------------------------

function notMeasured(mode, label, message) {
  console.log(
    `::warning title=${escapeProperty('Test leftovers: NOT MEASURED')}::` +
      escapeData(`report-test-leftovers ${mode}${label ? ` (${label})` : ''}: ${message} -- the leftover list for this job is NOT MEASURED. Report only; the job is unaffected.`),
  );
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else {
        opts[key] = next;
        i += 1;
      }
    } else opts._.push(arg);
  }
  return opts;
}

export function runSnapshot(opts) {
  const out = typeof opts.out === 'string' ? resolve(opts.out) : null;
  if (!out) throw new Error('snapshot needs --out FILE (outside the repository tree)');
  const root = typeof opts.root === 'string' ? resolve(opts.root) : repoRoot();
  if (isInside(root, out)) {
    throw new Error(`--out ${out} is inside the repository tree, so the report would count the snapshot itself as a leftover`);
  }
  const paths = listUntracked(root);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ schema: SNAPSHOT_SCHEMA, root, takenAt: new Date().toISOString(), paths })}\n`);
  console.log(`test-leftovers: snapshot of ${paths.length} untracked or ignored path(s) under ${root} -> ${out}`);
}

export function runReport(opts) {
  const label = typeof opts.label === 'string' ? opts.label : 'this job';
  const before = typeof opts.before === 'string' ? resolve(opts.before) : null;
  if (!before) throw new Error('report needs --before FILE, written by the snapshot step');
  const summaryTarget = typeof opts.summary === 'string' ? opts.summary : process.env.GITHUB_STEP_SUMMARY;
  if (!existsSync(before)) {
    // The snapshot step did not run (an earlier step failed) or could not
    // write. Not a finding about the tests, so no annotation: one log line and
    // one summary line.
    const line = `test-leftovers: ${label} -- NOT MEASURED, no snapshot at ${before} (the snapshot step did not run or did not complete).`;
    console.log(line);
    if (summaryTarget) appendFileSync(summaryTarget, `### Test leftovers: ${label}\n\n${line}\n\n`);
    return;
  }
  const snap = JSON.parse(readFileSync(before, 'utf8'));
  if (snap?.schema !== SNAPSHOT_SCHEMA || !Array.isArray(snap.paths)) {
    throw new Error(`${before} is not a ${SNAPSHOT_SCHEMA} document`);
  }
  const root = typeof opts.root === 'string' ? resolve(opts.root) : repoRoot();
  if (snap.root !== root) throw new Error(`the snapshot was taken under ${snap.root}, this report runs under ${root}`);
  const after = listUntracked(root);
  const packages = workspacePackages(root);
  const notes = [];
  let ownBuild = new Map();
  try {
    ownBuild = deriveOwnBuild(JSON.parse(readFileSync(join(root, TURBO_CONFIG), 'utf8')), packages);
  } catch (error) {
    notes.push(`⚠ ${TURBO_CONFIG} could not be read (${error.message}), so the own-build rule was NOT applied: a build output below may be counted as a leftover.`);
  }
  const report = computeReport({ before: snap.paths, after, packageDirs: packages.map((p) => p.dir), ownBuild });
  for (const line of renderLog(report, { label })) console.log(line);
  for (const line of renderAnnotations(report, { label })) console.log(line);
  for (const note of notes) console.log(`  ${note}`);
  if (summaryTarget) appendFileSync(summaryTarget, renderSummary(report, { label, notes }));
  if (typeof opts.json === 'string') {
    writeFileSync(
      resolve(opts.json),
      `${JSON.stringify({ label, ...report, excluded: Object.fromEntries(report.excluded), ownBuild: Object.fromEntries([...ownBuild].map(([d, e]) => [d, e.tasks])) }, null, 2)}\n`,
    );
  }
}

function inJob(mode, opts) {
  const label = typeof opts.label === 'string' ? opts.label : '';
  const onCrash = (error) => {
    notMeasured(mode, label, error?.message ?? String(error));
    process.exit(0);
  };
  process.on('uncaughtException', onCrash);
  process.on('unhandledRejection', onCrash);
  try {
    if (mode === 'snapshot') runSnapshot(opts);
    else runReport(opts);
  } catch (error) {
    notMeasured(mode, label, error?.message ?? String(error));
  }
  process.exitCode = 0;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

// Set only after the verdict line prints; the dispatch refuses when it is unset,
// so a `return` above the verdict cannot pass for a green run.
let selfTestReachedVerdict = false;

// The battery roster, by NAME, each with its minimum case count. A floor, not
// an equality: adding cases is ordinary work. A battery below its floor means
// cases stopped running.
const SELF_TEST_BATTERIES = Object.freeze({
  '1. The diff: what counts as ADDED, and under which package': 7,
  '2. The fixed exclusions: each one, and only its own paths': 8,
  '3. turbo.json: the builds a test step runs after the snapshot': 8,
  '4. Rendering: the table, the annotations, the escaping': 9,
  '5. The real listing: ignored paths are seen (a real git tree)': 5,
  '6. Never fails a job: the in-job modes exit 0 on every path': 9,
});

// Deleting a roster entry deletes its floor too, so the roster size is pinned.
const SELF_TEST_BATTERY_FLOOR = 6;

const UNATTRIBUTED_BATTERY = '(no battery open)';

function selfTest() {
  const failures = [];
  const seen = new Map();
  let open = UNATTRIBUTED_BATTERY;
  const battery = (name) => {
    open = name;
  };
  const assert = (label, condition, detail = '') => {
    seen.set(open, (seen.get(open) ?? 0) + 1);
    if (!condition) failures.push(`[${open}] ${label}${detail ? `\n      | ${String(detail).split('\n').join('\n      | ')}` : ''}`);
  };
  const dirs = ['packages/runtime', 'packages/cli', 'packages/qa/dogfood', 'examples/app-crm'];

  // ── 1. The diff ─────────────────────────────────────────────────────────
  battery('1. The diff: what counts as ADDED, and under which package');
  {
    const before = ['packages/runtime/dist/index.js', 'packages/cli/dist/run.js', 'stale.tmp'];
    const after = [
      'packages/runtime/dist/index.js',
      'packages/cli/dist/run.js',
      'packages/runtime/.objectstack/data/x.json',
      'leftover-at-root.db',
      'examples/app-crm/.objectstack/data/sys_user.json',
      'packages/qa/dogfood/tmp/run-1/state.json',
    ];
    const r = computeReport({ before, after, packageDirs: dirs });
    const rows = Object.fromEntries(r.packages.map((p) => [p.dir, p.paths]));
    assert(
      'a new IGNORED .objectstack/data/x.json is reported under its own package',
      JSON.stringify(rows['packages/runtime']) === JSON.stringify(['packages/runtime/.objectstack/data/x.json']),
      JSON.stringify(rows),
    );
    assert(
      'build outputs present in BOTH snapshots are not reported',
      !JSON.stringify(rows).includes('/dist/'),
      JSON.stringify(rows),
    );
    assert('a path deleted by the run is not reported as added', !JSON.stringify(rows).includes('stale.tmp'), JSON.stringify(rows));
    assert('...but the deletion is counted as removed', r.removed === 1, String(r.removed));
    assert(
      'a path at the repository root is grouped as (root)',
      JSON.stringify(rows[ROOT_GROUP]) === JSON.stringify(['leftover-at-root.db']),
      JSON.stringify(rows),
    );
    assert(
      'a nested package directory wins over a shorter prefix (packages/qa/dogfood, not the root)',
      Array.isArray(rows['packages/qa/dogfood']) && packageOf('packages/qa/other/x', dirs) === ROOT_GROUP,
      JSON.stringify(rows),
    );
    assert('an unchanged tree reports nothing', computeReport({ before, after: before, packageDirs: dirs }).packages.length === 0);
  }

  // ── 2. The fixed exclusions ─────────────────────────────────────────────
  battery('2. The fixed exclusions: each one, and only its own paths');
  {
    const excluded = (path) => classify(path, { packageDirs: dirs, ownBuild: new Map() }).excluded ?? null;
    assert('.turbo/ at the root (cache and run summaries) is turbo state', excluded('.turbo/runs/2abc.json') === 'turbo-state');
    assert('.turbo/cache entries are turbo state', excluded('.turbo/cache/0f1e2d.tar.zst') === 'turbo-state');
    assert('a package task log is a turbo task log', excluded('packages/runtime/.turbo/turbo-test.log') === 'turbo-task-log');
    assert('...and so is the test:repo one', excluded('packages/runtime/.turbo/turbo-test:repo.log') === 'turbo-task-log');
    assert(
      'any other file under a package .turbo/ is COUNTED, not swallowed by the log rule',
      excluded('packages/runtime/.turbo/state.json') === null,
    );
    assert(
      "vitest's results cache is excluded",
      excluded('packages/runtime/node_modules/.vite/vitest/da39a3ee/results.json') === 'vitest-results-cache',
    );
    assert(
      'anything else under node_modules/.vite is COUNTED',
      excluded('packages/runtime/node_modules/.vite/deps/_metadata.json') === null,
    );
    assert('a .objectstack/ path is never excluded', excluded('packages/runtime/.objectstack/data/x.json') === null);
  }

  // ── 3. turbo.json -> own-build outputs ──────────────────────────────────
  battery('3. turbo.json: the builds a test step runs after the snapshot');
  {
    const turbo = {
      tasks: {
        build: { dependsOn: ['^build'], outputs: ['dist/**', '.next/**', '!.next/cache/**'] },
        test: { dependsOn: ['^build'], outputs: [] },
        'test:repo': { dependsOn: ['^build'], outputs: [] },
        '@objectstack/cli#test': { dependsOn: ['build'], outputs: [] },
        '@objectstack/spec#gen:migration-registry': { dependsOn: [], outputs: ['src/migrations/registry.ts'] },
        '@objectstack/spec#test:repo': { dependsOn: ['^build', 'gen:migration-registry'], outputs: [] },
      },
    };
    const packages = [
      { dir: 'packages/cli', manifest: { name: '@objectstack/cli', scripts: { test: 'vitest run', build: 'tsc' } } },
      { dir: 'packages/runtime', manifest: { name: '@objectstack/runtime', scripts: { test: 'vitest run', build: 'tsup' } } },
      { dir: 'packages/spec', manifest: { name: '@objectstack/spec', scripts: { 'test:repo': 'vitest run' } } },
      { dir: 'packages/quiet', manifest: { name: '@objectstack/quiet', scripts: { build: 'tsup' } } },
    ];
    const own = deriveOwnBuild(turbo, packages);
    assert('a test that depends on its own build yields that build', own.has('packages/cli'), JSON.stringify([...own.keys()]));
    assert('a test that depends on ^build only yields nothing', !own.has('packages/runtime'), JSON.stringify([...own.keys()]));
    assert('a test:repo dependency on a generator yields its outputs', own.has('packages/spec'), JSON.stringify([...own.keys()]));
    assert('a package with no test script yields nothing', !own.has('packages/quiet'));
    const ctx = { packageDirs: [...dirs, 'packages/spec'], ownBuild: own };
    assert('the own build output is excluded', classify('packages/cli/dist/commands/run.js', ctx).excluded === 'own-build-output');
    assert(
      'the SAME path shape in a package that does not build in the test step is COUNTED',
      classify('packages/runtime/dist/index.js', ctx).pkg === 'packages/runtime',
    );
    assert('a negated output glob is honoured', classify('packages/cli/.next/cache/x', ctx).pkg === 'packages/cli');
    assert(
      'a non-output path of the own-build package is COUNTED',
      classify('packages/cli/.objectstack/data/x.json', ctx).pkg === 'packages/cli',
    );
  }

  // ── 4. Rendering ────────────────────────────────────────────────────────
  battery('4. Rendering: the table, the annotations, the escaping');
  {
    const many = Array.from({ length: 7 }, (_, i) => `packages/runtime/.objectstack/data/t${i}.json`);
    const r = computeReport({ before: [], after: [...many, 'root.db'], packageDirs: dirs });
    const notes = renderAnnotations(r, { label: 'Test Core (3/6)' });
    assert('one annotation per package', notes.length === 2, notes.join('\n'));
    assert(
      'an annotation names its package, its count and at most 5 examples',
      notes[0].includes('packages/runtime: 7 path(s)') &&
        notes[0].includes('t4.json') &&
        !notes[0].includes('t5.json') &&
        notes[0].includes('and 2 more'),
      notes[0],
    );
    assert('an annotation starts with the warning command at column 0', notes.every((n) => n.startsWith('::warning title=')));
    assert('the title property escapes its colon', notes[0].startsWith('::warning title=Test leftovers%3A packages/runtime::'), notes[0]);
    assert('message data escapes % and newlines', escapeData('50% done\nnext') === '50%25 done%0Anext');
    const wide = computeReport({
      before: [],
      after: Array.from({ length: 12 }, (_, i) => `packages/p${String(i).padStart(2, '0')}/.objectstack/x`),
      packageDirs: Array.from({ length: 12 }, (_, i) => `packages/p${String(i).padStart(2, '0')}`),
    });
    const capped = renderAnnotations(wide, { label: 'L' });
    assert(
      `past ${ANNOTATIONS_PER_STEP} packages: ${ANNOTATIONS_PER_STEP - 1} annotations plus one roll-up naming the rest`,
      capped.length === ANNOTATIONS_PER_STEP && capped.at(-1).includes('3 more package(s)') && capped.at(-1).includes('packages/p11 (1)'),
      capped.join('\n'),
    );
    assert('an empty report raises no annotation', renderAnnotations(computeReport({ before: [], after: [], packageDirs: dirs }), { label: 'L' }).length === 0);
    const md = renderSummary(computeReport({ before: [], after: ['packages/runtime/a|b.json'], packageDirs: dirs }), { label: 'L' });
    assert('the summary table escapes a pipe in a path', md.includes('`packages/runtime/a\\|b.json`'), md);
    const excl = renderSummary(
      computeReport({ before: [], after: ['.turbo/runs/x.json', 'packages/runtime/.turbo/turbo-test.log'], packageDirs: dirs }),
      { label: 'L' },
    );
    assert(
      'the summary COUNTS what it did not count, rule by rule',
      excl.includes('1 turbo') && excl.includes('No path was added') && excl.includes('Not counted, each by a fixed rule'),
      excl,
    );
  }

  const scratch = mkdtempSync(join(tmpdir(), 'report-test-leftovers-'));
  try {
    const git = (cwd, ...args) =>
      execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      });
    const write = (root, path, text = 'x') => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    const makeRepo = (name) => {
      const root = join(scratch, name);
      mkdirSync(root, { recursive: true });
      git(root, 'init', '-q');
      write(root, '.gitignore', 'node_modules\ndist/\n.objectstack\n.turbo\n');
      write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
      write(root, 'package.json', '{"name":"fixture-root","private":true}\n');
      write(root, 'packages/a/package.json', '{"name":"@fixture/a","scripts":{"test":"vitest run"}}\n');
      write(root, 'packages/a/src/index.ts', 'export {};\n');
      write(root, 'turbo.json', `${JSON.stringify({ tasks: { test: { dependsOn: ['^build'] } } })}\n`);
      git(root, 'add', '-A');
      git(root, 'commit', '-q', '-m', 'fixture');
      write(root, 'packages/a/dist/index.js', 'built');
      write(root, 'packages/a/.objectstack/data/old.json', '{}');
      return realpathOf(root);
    };

    // ── 5. The real listing ───────────────────────────────────────────────
    battery('5. The real listing: ignored paths are seen (a real git tree)');
    {
      const root = makeRepo('listing');
      const before = listUntracked(root);
      assert('the listing includes an IGNORED file that existed before', before.includes('packages/a/.objectstack/data/old.json'), before.join('\n'));
      write(root, 'packages/a/.objectstack/data/x.json', '{}');
      write(root, 'packages/a/scratch.txt', 'untracked, not ignored');
      rmSync(join(root, 'packages/a/dist/index.js'));
      const after = listUntracked(root);
      assert(
        'a NEW ignored file inside an ignored directory that already existed is listed',
        after.includes('packages/a/.objectstack/data/x.json'),
        after.join('\n'),
      );
      const r = computeReport({ before, after, packageDirs: workspacePackages(root).map((p) => p.dir) });
      const row = r.packages.find((p) => p.dir === 'packages/a');
      assert(
        'the report over two real listings names both new paths under packages/a',
        JSON.stringify(row?.paths) === JSON.stringify(['packages/a/.objectstack/data/x.json', 'packages/a/scratch.txt']),
        JSON.stringify(r.packages),
      );
      assert('the tracked files are never listed', !after.includes('packages/a/src/index.ts') && !after.includes('turbo.json'), after.join('\n'));
      assert('the deleted build output is not reported', !JSON.stringify(r.packages).includes('dist/index.js'), JSON.stringify(r.packages));
    }

    // ── 6. Never fails a job ──────────────────────────────────────────────
    battery('6. Never fails a job: the in-job modes exit 0 on every path');
    {
      const root = makeRepo('cli');
      // GITHUB_STEP_SUMMARY is blanked so a child never writes into the summary
      // of the job running this self-test, and git is fenced at the scratch dir
      // so "not a repository" stays true wherever the temp dir lives.
      const env = { ...process.env, GITHUB_STEP_SUMMARY: '', GIT_CEILING_DIRECTORIES: scratch };
      const runIn = (cwd, ...args) => spawnSync(process.execPath, [SELF, ...args], { cwd, encoding: 'utf8', env });
      const run = (...args) => runIn(root, ...args);
      const snapFile = join(scratch, 'out', 'before.json');
      const summary = join(scratch, 'summary.md');
      writeFileSync(summary, '');
      const snap = run('snapshot', '--out', snapFile);
      assert('snapshot exits 0 and writes its file', snap.status === 0 && existsSync(snapFile), snap.stdout + snap.stderr);
      write(root, 'packages/a/.objectstack/data/new.json', '{}');
      write(root, 'packages/a/.turbo/turbo-test.log', 'log');
      const rep = run('report', '--before', snapFile, '--label', 'Fixture (1/1)', '--summary', summary);
      assert('report WITH findings exits 0', rep.status === 0, rep.stdout + rep.stderr);
      assert(
        'report prints one warning annotation for the package, at column 0',
        rep.stdout.split('\n').filter((l) => l.startsWith('::warning ')).length === 1 &&
          rep.stdout.includes('packages/a: 1 path(s) added'),
        rep.stdout,
      );
      const md = readFileSync(summary, 'utf8');
      assert(
        'report appends the table to the summary file, with the task log counted as not counted',
        md.includes('| `packages/a` | 1 |') && md.includes('1 turbo task logs'),
        md,
      );
      const missing = run('report', '--before', join(scratch, 'absent.json'), '--summary', summary);
      assert(
        'report with no snapshot exits 0, says NOT MEASURED, and raises no annotation',
        missing.status === 0 && missing.stdout.includes('NOT MEASURED') && !missing.stdout.includes('::warning'),
        missing.stdout + missing.stderr,
      );
      const garbage = join(scratch, 'garbage.json');
      writeFileSync(garbage, '{ not json');
      const crash = run('report', '--before', garbage);
      assert(
        'a crash (an unparseable snapshot) is ONE NOT MEASURED warning and exit 0',
        crash.status === 0 && crash.stdout.startsWith('::warning title=Test leftovers%3A NOT MEASURED::'),
        crash.stdout + crash.stderr,
      );
      const inside = run('snapshot', '--out', join(root, 'snap.json'));
      assert(
        'a snapshot aimed INSIDE the tree is refused with a warning, exit 0, and no file',
        inside.status === 0 && inside.stdout.includes('NOT MEASURED') && !existsSync(join(root, 'snap.json')),
        inside.stdout + inside.stderr,
      );
      const bare = run('report');
      assert('report with no arguments exits 0 with a warning', bare.status === 0 && bare.stdout.includes('NOT MEASURED'), bare.stdout + bare.stderr);
      const notARepo = join(scratch, 'not-a-repo');
      mkdirSync(notARepo, { recursive: true });
      const outside = runIn(notARepo, 'report', '--before', snapFile);
      assert(
        'report outside any git tree exits 0 with a warning',
        outside.status === 0 && outside.stdout.includes('NOT MEASURED'),
        outside.stdout + outside.stderr,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // ── The floor: every declared battery ran, at or above its pin ───────────
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failures.push(`floor: SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  }
  for (const [name, count] of seen) {
    if (!declared.includes(name)) failures.push(`floor: battery "${name}" registered ${count} case(s) but is not declared`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      failures.push(
        count === 0
          ? `floor: battery "${name}" DID NOT RUN (0 cases, ${SELF_TEST_BATTERIES[name]} pinned)`
          : `floor: battery "${name}" registered ${count} case(s), below its floor of ${SELF_TEST_BATTERIES[name]}`,
      );
    }
  }

  const total = [...seen.values()].reduce((n, c) => n + c, 0);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(`report-test-leftovers --self-test: ${failures.length} FAILED (of ${total} cases)`);
    return 1;
  }
  console.log(`report-test-leftovers --self-test: OK (${total} cases over ${declared.length} batteries)`);
  selfTestReachedVerdict = true;
  return 0;
}

function realpathOf(path) {
  return execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

// ---------------------------------------------------------------------------

function usage() {
  return [
    'usage:',
    '  node scripts/ci/report-test-leftovers.mjs snapshot --out FILE',
    '  node scripts/ci/report-test-leftovers.mjs report --before FILE [--label TEXT] [--summary FILE] [--json FILE]',
    '  node scripts/ci/report-test-leftovers.mjs --self-test',
  ].join('\n');
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict && code === 0) {
      console.error('report-test-leftovers: the self-test never reached its verdict -- refusing to report a pass.');
      return 1;
    }
    return code;
  }
  const opts = parseArgs(argv);
  const mode = opts._[0];
  if (mode === 'snapshot' || mode === 'report') {
    inJob(mode, opts);
    return 0;
  }
  if (opts.help) {
    console.log(usage());
    return 0;
  }
  // An unknown mode in a workflow step is still not allowed to fail the job.
  notMeasured(String(mode ?? '(none)'), '', `unknown mode -- ${usage().replace(/\n/g, ' ')}`);
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
