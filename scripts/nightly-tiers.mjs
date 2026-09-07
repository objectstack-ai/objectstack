#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * nightly-tiers -- the ONE reader of `OS_TEST_TIERS`, the switch that moves the
 * `e2e` and `live` test tiers off the per-PR and merge-queue runs and onto a
 * nightly run on `main` (maintainer direction, 2026-09-07: 「我想的是测试会不会
 * 太多，是否都是必要的，是不是应该砍，每次修改都要完整的测试吗」).
 *
 *   node scripts/nightly-tiers.mjs --self-test
 *   node scripts/nightly-tiers.mjs --packages            # turbo-ls-shaped JSON of the packages that OWN tier files
 *   node scripts/nightly-tiers.mjs --check               # every such package's vitest collection honours the switch
 *   node scripts/nightly-tiers.mjs --failing-files <dir> # tier files the vitest JSON reports under <dir> call failed
 *
 * ## The switch
 *
 *   OS_TEST_TIERS   unset / empty / `queue`  -> the two tiers are EXCLUDED
 *                                               (pull request, merge queue, local default)
 *                   `nightly`                -> EXACTLY the two tiers run
 *                   anything else            -> refused loudly, naming the two legal values
 *
 * `queue` is the default so that a runner, a hook or a developer who never
 * heard of the switch gets the cheaper run and never the nightly one by
 * accident; the nightly setting is always a deliberate spelling. An unknown
 * value is a refusal rather than a fallback because a typo that silently fell
 * back to `queue` would be a nightly that tested nothing while reading green.
 *
 * ## Selection is by FILENAME tier, and by nothing else
 *
 *   <name>.e2e.test.ts     <name>.live.test.ts     (and `.spec.`, and every vitest extension)
 *
 * The ruling on the card that landed this is explicit: no test file is renamed,
 * deleted or edited to move it between runs; a file's run is decided by the
 * tier its name already carries. The regex below is therefore the whole
 * contract, and it is deliberately the narrow one: `**\/*.e2e.test.*` would
 * also match a `.snap` beside the test, and under an `include` vitest would
 * then try to RUN the snapshot.
 *
 * ⚠️ Where the population actually is, measured at 6eba38f5a3 (2026-09-07):
 * `packages/cli` owns all 60 `*.e2e.test.ts` files in the tree, and NO package
 * owns a `*.live.test.*` file at all. The 23 "live" test files a substring
 * search finds (`live-mysql`, `live-dialect-matrix`, `lint-liveness-…`,
 * `email-plugin.queue-delivery`) are not tier-named and are NOT selected --
 * `live` is a tier a package may adopt by naming a file into it, not a set of
 * files this module goes looking for.
 *
 * ## Why one module and not a line in every vitest config
 *
 * Measured on the same commit: 72 `vitest.config.ts` files, every one a
 * standalone `defineConfig`, none extending a shared config, no root
 * `vitest.config.*`, no `vitest.workspace`. A switch spelled per config would
 * be 72 copies of one predicate, or -- the honest count -- ONE copy today,
 * because only one package owns tier files, and a copy in a package that owns
 * none excludes nothing. So the predicate lives here, the one config that owns
 * tier files reads it (`packages/cli/vitest-tiers.ts`, whose walk feeds both of
 * that package's vitest projects), and a package that adopts a tier tomorrow
 * imports this module rather than re-spelling it.
 *
 * ⛔ What that does NOT buy, and what `--check` is for. A package that adds its
 * first `*.live.test.ts` without reading the switch would run that file in the
 * merge queue (nothing excludes it) and its WHOLE suite under the nightly
 * (nothing narrows it) -- both silent. `--check` measures every tier-owning
 * package by what vitest actually COLLECTS under each setting, the way
 * `packages/cli/test/vitest-tiers-partition.test.ts` judges its own config,
 * and the nightly workflow refuses to run past a package that fails it. That
 * makes the drift LOUD on the nightly; it does not make it red on the pull
 * request that introduces it, which is the open question the landing card
 * records.
 *
 * ## Where `OS_TEST_TIERS` has to be declared to reach vitest at all
 *
 * turbo 2.10 runs in STRICT env mode: a variable that `turbo.json` neither
 * hashes (`env`) nor passes through is stripped before the task's shell sees
 * it, and `vitest run` would read the switch as unset -- i.e. `queue` -- on a
 * nightly runner that exported `nightly`. `turbo.json` therefore names
 * `OS_TEST_TIERS` in the `test` task's `env`, and in `env` rather than
 * `passThroughEnv` on purpose: a `test` task's cached outcome depends on the
 * setting, so the setting must be in the hash, or a nightly could replay a
 * queue-mode cache entry as `>>> FULL TURBO` and test nothing while green.
 */

import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { workspacePackageDirs } from './workspace-enumerator.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/** The tiers the switch moves. Spelled once; the regex below is built from it. */
export const NIGHTLY_TIERS = Object.freeze(['e2e', 'live']);

/** The two legal spellings of the switch. */
export const TIER_MODES = Object.freeze(['queue', 'nightly']);

/** The environment variable. `OS_TEST_*` is the CI/test-only shape AGENTS.md reserves. */
export const TIER_ENV = 'OS_TEST_TIERS';

/**
 * A test file in one of the nightly tiers, judged on its basename. Anchored on
 * vitest's own default extension set so a snapshot or a `.d.ts` sitting beside
 * a tier test can never be selected.
 */
export const NIGHTLY_TIER_FILE_RE = new RegExp(`\\.(?:${NIGHTLY_TIERS.join('|')})\\.(?:test|spec)\\.[cm]?[jt]sx?$`);

export function isNightlyTierFile(relPath) {
  return NIGHTLY_TIER_FILE_RE.test(String(relPath));
}

/**
 * The switch's value, read from `env` (default: this process's environment).
 * Unset and empty read as `queue`; any spelling that is not exactly one of
 * `TIER_MODES` is refused.
 */
export function readTierMode(env = process.env) {
  const raw = env[TIER_ENV];
  if (raw === undefined || raw === '') return 'queue';
  if (TIER_MODES.includes(raw)) return raw;
  throw new Error(
    `${TIER_ENV}=${JSON.stringify(raw)} is not a test-tier setting. ` +
      `Legal values: ${TIER_MODES.map((m) => JSON.stringify(m)).join(', ')} (unset reads as "queue"). ` +
      'Refusing to guess: a typo that fell back to "queue" would be a nightly that tested nothing.'
  );
}

/**
 * The files `mode` selects out of `files`: under `queue` everything that is
 * NOT in a nightly tier, under `nightly` exactly what is. Order is preserved.
 */
export function selectTierFiles(files, mode) {
  if (!TIER_MODES.includes(mode)) {
    throw new Error(`selectTierFiles: mode must be one of ${TIER_MODES.join(', ')}, got ${JSON.stringify(mode)}`);
  }
  const wantTier = mode === 'nightly';
  return files.filter((f) => isNightlyTierFile(f) === wantTier);
}

// ---------------------------------------------------------------------------
// The population: which packages own tier files
// ---------------------------------------------------------------------------

const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', '.next', 'build']);

/**
 * Every workspace package that owns at least one nightly-tier test file, as
 * `{ name, path, files }` -- `path` repo-relative POSIX, `files` package-relative
 * POSIX and sorted. A package directory nested inside another package's
 * directory is walked as its own package, never as part of the outer one.
 */
export function tierPackages(repoRoot = REPO_ROOT) {
  const dirs = workspacePackageDirs(repoRoot);
  const packageDirSet = new Set(dirs);
  const out = [];
  for (const dir of dirs) {
    const abs = path.join(repoRoot, dir);
    const files = [];
    const walk = (current, rel) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (packageDirSet.has(`${dir}/${childRel}`)) continue; // a nested package is its own package
          walk(path.join(current, entry.name), childRel);
        } else if (TEST_FILE_RE.test(entry.name) && isNightlyTierFile(entry.name)) {
          files.push(childRel);
        }
      }
    };
    walk(abs, '');
    if (files.length === 0) continue;
    const manifest = JSON.parse(readFileSync(path.join(abs, 'package.json'), 'utf8'));
    if (typeof manifest.name !== 'string' || manifest.name === '') {
      throw new Error(`${dir}/package.json: owns nightly-tier test files but declares no "name" to filter on`);
    }
    out.push({ name: manifest.name, path: dir, files: files.sort() });
  }
  return out;
}

/**
 * `tierPackages()` in the `turbo ls --output=json` shape
 * `scripts/partition-test-shards.mjs` reads, so the nightly can shard exactly
 * the tier-owning packages with the same partitioner and the same slice
 * grammar the Test Core matrix uses. `count` is written because the
 * partitioner checks it against `items.length`.
 */
export function packageListDocument(repoRoot = REPO_ROOT) {
  const items = tierPackages(repoRoot).map(({ name, path: dir }) => ({ name, path: dir }));
  return { packages: { count: items.length, items } };
}

// ---------------------------------------------------------------------------
// `--check`: judged by what vitest COLLECTS, never by re-reading a config
// ---------------------------------------------------------------------------

/**
 * The verdict for one package, from the three lists: the tier files on disk,
 * and what `vitest list --filesOnly` returned under each setting. Pure, so the
 * self-test pins every direction without spawning vitest.
 *
 * Returns the problems, empty when the package honours the switch.
 */
export function judgeCollection(name, tierFiles, queueListed, nightlyListed) {
  const problems = [];
  const tier = new Set(tierFiles);
  const leakedIntoQueue = queueListed.filter((f) => tier.has(f));
  if (leakedIntoQueue.length > 0) {
    problems.push(
      `${name}: under ${TIER_ENV}=queue vitest still collects ${leakedIntoQueue.length} nightly-tier file(s) -- ` +
        `they would run in the merge queue: ${leakedIntoQueue.slice(0, 5).join(', ')}${leakedIntoQueue.length > 5 ? ', …' : ''}`
    );
  }
  const strayInNightly = nightlyListed.filter((f) => !tier.has(f));
  if (strayInNightly.length > 0) {
    problems.push(
      `${name}: under ${TIER_ENV}=nightly vitest collects ${strayInNightly.length} file(s) outside the nightly tiers -- ` +
        `the nightly would run more than the two tiers: ${strayInNightly.slice(0, 5).join(', ')}${strayInNightly.length > 5 ? ', …' : ''}`
    );
  }
  const listedNightly = new Set(nightlyListed);
  const missingFromNightly = tierFiles.filter((f) => !listedNightly.has(f));
  if (missingFromNightly.length > 0) {
    problems.push(
      `${name}: under ${TIER_ENV}=nightly vitest does NOT collect ${missingFromNightly.length} nightly-tier file(s) on disk -- ` +
        `they would run nowhere: ${missingFromNightly.slice(0, 5).join(', ')}${missingFromNightly.length > 5 ? ', …' : ''}`
    );
  }
  return problems;
}

/** `vitest list --filesOnly` in `pkgDir` under `mode`, package-relative paths, sorted. */
function vitestListedFiles(pkgDir, mode) {
  const require = createRequire(path.join(pkgDir, 'package.json'));
  let vitestEntry;
  try {
    vitestEntry = path.resolve(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  } catch {
    throw new Error(`${pkgDir}: vitest is not resolvable from this package -- install the workspace before --check`);
  }
  const out = execFileSync(process.execPath, [vitestEntry, 'list', '--filesOnly'], {
    cwd: pkgDir,
    env: { ...process.env, [TIER_ENV]: mode },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\[[^\]]+\]\s+/, ''))
    .sort();
}

/**
 * Every tier-owning package, measured under both settings. Returns the
 * problems; an empty list means every such package honours the switch.
 */
export function checkTierPackages(repoRoot = REPO_ROOT) {
  const problems = [];
  const owners = tierPackages(repoRoot);
  for (const { name, path: dir, files } of owners) {
    const pkgDir = path.join(repoRoot, dir);
    let queueListed;
    let nightlyListed;
    try {
      queueListed = vitestListedFiles(pkgDir, 'queue');
      nightlyListed = vitestListedFiles(pkgDir, 'nightly');
    } catch (cause) {
      problems.push(`${name}: could not ask vitest what it collects (${cause.message.split('\n')[0]})`);
      continue;
    }
    problems.push(...judgeCollection(name, files, queueListed, nightlyListed));
    console.error(
      `nightly-tiers --check: ${name} owns ${files.length} nightly-tier file(s); ` +
        `vitest collects ${queueListed.length} under queue, ${nightlyListed.length} under nightly`
    );
  }
  return { owners, problems };
}

// ---------------------------------------------------------------------------
// `--failing-files`: the tier files a run's vitest JSON reports call failed
// ---------------------------------------------------------------------------

/** Every `*.json` under `dir`, recursively, absolute, sorted. */
function jsonFilesUnder(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.json')) out.push(abs);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/**
 * Map the ABSOLUTE `testResults[].name` a vitest JSON report carries (a path on
 * the runner that wrote it) back to a repo-relative path, by the longest
 * `<package dir>/<tier file>` suffix it ends with. Pure; `known` is the
 * repo-relative tier-file list `tierPackages()` yields.
 */
export function failingTierFilesFromReports(reports, known) {
  const knownSet = new Set(known);
  const failed = new Set();
  const unmapped = new Set();
  for (const report of reports) {
    const results = Array.isArray(report?.testResults) ? report.testResults : [];
    for (const result of results) {
      if (result?.status !== 'failed') continue;
      const name = String(result.name ?? '').replace(/\\/g, '/');
      const hit = [...knownSet].filter((k) => name === k || name.endsWith(`/${k}`)).sort((a, b) => b.length - a.length)[0];
      if (hit) failed.add(hit);
      else unmapped.add(name);
    }
  }
  return { failed: [...failed].sort(), unmapped: [...unmapped].sort() };
}

export function failingTierFiles(reportDir, repoRoot = REPO_ROOT) {
  const known = tierPackages(repoRoot).flatMap(({ path: dir, files }) => files.map((f) => `${dir}/${f}`));
  const reports = [];
  for (const file of jsonFilesUnder(reportDir)) {
    try {
      reports.push(JSON.parse(readFileSync(file, 'utf8')));
    } catch (cause) {
      throw new Error(`${file}: not a vitest JSON report (${cause.message})`);
    }
  }
  return { reportsRead: reports.length, ...failingTierFilesFromReports(reports, known) };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const SELF_TEST_VERDICT = Symbol('nightly-tiers self-test reached its verdict');

function assert(cond, msg) {
  if (!cond) throw new Error(`nightly-tiers self-test: ${msg}`);
}

function assertThrows(fn, re, msg) {
  let threw = null;
  try {
    fn();
  } catch (e) {
    threw = e;
  }
  assert(threw !== null, `${msg} -- did not throw`);
  assert(re.test(threw.message), `${msg} -- threw the wrong message: ${threw.message}`);
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function selfTest() {
  let cases = 0;
  const check = (fn) => {
    fn();
    cases++;
  };

  // -- the regex --------------------------------------------------------------
  for (const [file, expected] of [
    ['test/foo.e2e.test.ts', true],
    ['src/bar.live.test.ts', true],
    ['a.e2e.spec.mts', true],
    ['a.live.test.tsx', true],
    ['a.e2e.test.cjs', true],
    ['test/foo.e2e.test.ts.snap', false], // the loose `*.e2e.test.*` would match this
    ['test/foo.e2e.test.d.ts', false],
    ['test/foo.e2e.ts', false],
    ['test/foo.test.ts', false],
    ['src/live-dialect-matrix.isolation.test.ts', false], // substring "live", not a tier
    ['src/seed-tenancy-backfill.live-mysql.test.ts', false],
    ['src/lint-liveness-properties.test.ts', false],
    ['src/email-plugin.queue-delivery.test.ts', false],
    ['src/server-timing-e2e.test.ts', false], // "e2e" without the dotted tier
    ['e2e/showcase-smoke.spec.ts', false], // a directory is not a tier
  ]) {
    check(() => assert(isNightlyTierFile(file) === expected, `isNightlyTierFile(${file}) should be ${expected}`));
  }

  // -- the switch -------------------------------------------------------------
  check(() => assert(readTierMode({}) === 'queue', 'unset reads as queue'));
  check(() => assert(readTierMode({ [TIER_ENV]: '' }) === 'queue', 'empty reads as queue'));
  check(() => assert(readTierMode({ [TIER_ENV]: 'queue' }) === 'queue', 'queue reads as queue'));
  check(() => assert(readTierMode({ [TIER_ENV]: 'nightly' }) === 'nightly', 'nightly reads as nightly'));
  for (const bad of ['NIGHTLY', ' nightly', 'night', 'e2e', 'true', '1']) {
    check(() => assertThrows(() => readTierMode({ [TIER_ENV]: bad }), /is not a test-tier setting/, `refuses ${JSON.stringify(bad)}`));
  }

  // -- selection ----------------------------------------------------------------
  const pop = ['a.test.ts', 'b.e2e.test.ts', 'c.live.spec.ts', 'd/e.test.ts'];
  check(() => assert(eq(selectTierFiles(pop, 'queue'), ['a.test.ts', 'd/e.test.ts']), 'queue drops the tiers'));
  check(() => assert(eq(selectTierFiles(pop, 'nightly'), ['b.e2e.test.ts', 'c.live.spec.ts']), 'nightly keeps only the tiers'));
  check(() =>
    assert(
      eq([...selectTierFiles(pop, 'queue'), ...selectTierFiles(pop, 'nightly')].sort(), [...pop].sort()),
      'queue and nightly partition the population'
    )
  );
  check(() => assertThrows(() => selectTierFiles(pop, 'all'), /mode must be one of/, 'refuses an unknown mode'));

  // -- the population, on a fixture workspace ---------------------------------
  const root = mkdtempSync(path.join(tmpdir(), 'test-tiers-'));
  try {
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n  - packages/outer/*\n');
    const mk = (dir, name, files) => {
      mkdirSync(path.join(root, dir), { recursive: true });
      writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify({ name }));
      for (const f of files) {
        mkdirSync(path.dirname(path.join(root, dir, f)), { recursive: true });
        writeFileSync(path.join(root, dir, f), '');
      }
    };
    mk('packages/owner', '@x/owner', ['test/a.e2e.test.ts', 'test/b.test.ts', 'src/c.live.test.ts', 'node_modules/dep/d.e2e.test.ts', 'dist/e.e2e.test.js']);
    mk('packages/plain', '@x/plain', ['src/only.test.ts', 'src/live-dialect.test.ts']);
    mk('packages/outer', '@x/outer', ['outer.test.ts']);
    mk('packages/outer/inner', '@x/inner', ['inner.live.test.ts']);
    const owners = tierPackages(root);
    check(() => assert(eq(owners.map((o) => o.name), ['@x/inner', '@x/owner']), `owners are the two tier-owning packages, got ${JSON.stringify(owners.map((o) => o.name))}`));
    check(() => assert(eq(owners.find((o) => o.name === '@x/owner').files, ['src/c.live.test.ts', 'test/a.e2e.test.ts']), 'node_modules and dist are skipped, files sorted'));
    check(() => assert(eq(owners.find((o) => o.name === '@x/inner').files, ['inner.live.test.ts']), 'a nested package is walked as its own'));
    check(() => assert(!owners.some((o) => o.name === '@x/outer'), 'the outer package does not inherit the nested package\'s tier file'));
    const doc = packageListDocument(root);
    check(() => assert(doc.packages.count === 2 && doc.packages.items.length === 2, 'the document counts what it lists'));
    check(() => assert(eq(doc.packages.items[1], { name: '@x/owner', path: 'packages/owner' }), 'items carry name and repo-relative path'));

    // -- failing files, from a report shaped like vitest's JSON reporter -------
    const known = owners.flatMap((o) => o.files.map((f) => `${o.path}/${f}`));
    const report = {
      testResults: [
        { name: '/home/runner/work/r/r/packages/owner/test/a.e2e.test.ts', status: 'failed' },
        { name: '/home/runner/work/r/r/packages/owner/src/c.live.test.ts', status: 'passed' },
        { name: 'C:\\w\\r\\packages\\outer\\inner\\inner.live.test.ts', status: 'failed' },
        { name: '/home/runner/work/r/r/packages/owner/test/b.test.ts', status: 'failed' },
      ],
    };
    const verdict = failingTierFilesFromReports([report], known);
    check(() => assert(eq(verdict.failed, ['packages/outer/inner/inner.live.test.ts', 'packages/owner/test/a.e2e.test.ts']), `failed files map by suffix, got ${JSON.stringify(verdict.failed)}`));
    check(() => assert(eq(verdict.unmapped, ['/home/runner/work/r/r/packages/owner/test/b.test.ts']), 'a failed non-tier file is reported as unmapped, never dropped'));
    check(() => assert(eq(failingTierFilesFromReports([{}], known).failed, []), 'a report with no testResults yields nothing'));
    const reportDir = path.join(root, 'reports');
    mkdirSync(path.join(reportDir, 'shard-1'), { recursive: true });
    writeFileSync(path.join(reportDir, 'shard-1', 'owner.json'), JSON.stringify(report));
    const fromDisk = failingTierFiles(reportDir, root);
    check(() => assert(fromDisk.reportsRead === 1 && eq(fromDisk.failed, verdict.failed), 'the disk walk reads the same verdict'));
    check(() => assert(failingTierFiles(path.join(root, 'no-such-dir'), root).reportsRead === 0, 'a missing report dir is zero reports, not a crash'));
    writeFileSync(path.join(reportDir, 'shard-1', 'broken.json'), '{not json');
    check(() => assertThrows(() => failingTierFiles(reportDir, root), /not a vitest JSON report/, 'a malformed report is refused loudly'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // -- the collection judge, every direction ------------------------------------
  const tier = ['test/a.e2e.test.ts', 'test/b.live.test.ts'];
  check(() => assert(eq(judgeCollection('p', tier, ['test/c.test.ts'], tier), []), 'a package that honours the switch has no problems'));
  check(() => assert(judgeCollection('p', tier, ['test/c.test.ts', 'test/a.e2e.test.ts'], tier).some((p) => /still collects 1 nightly-tier/.test(p)), 'a tier file collected under queue is a leak'));
  check(() => assert(judgeCollection('p', tier, ['test/c.test.ts'], [...tier, 'test/c.test.ts']).some((p) => /outside the nightly tiers/.test(p)), 'a non-tier file collected under nightly is a stray'));
  check(() => assert(judgeCollection('p', tier, ['test/c.test.ts'], ['test/a.e2e.test.ts']).some((p) => /does NOT collect 1 nightly-tier/.test(p)), 'a tier file missing from nightly runs nowhere'));
  check(() => assert(judgeCollection('p', tier, [], []).length === 1, 'an empty nightly collection is exactly one problem: the tier files run nowhere'));

  const FLOOR = 45;
  assert(cases >= FLOOR, `${cases} cases ran, below the pinned floor of ${FLOOR} -- cases stopped running`);
  console.log(`\u2713 nightly-tiers self-test: ${cases} cases pass.`);
  return SELF_TEST_VERDICT;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.error(
    'usage:\n' +
      '  node scripts/nightly-tiers.mjs --self-test\n' +
      '  node scripts/nightly-tiers.mjs --packages\n' +
      '  node scripts/nightly-tiers.mjs --check\n' +
      '  node scripts/nightly-tiers.mjs --failing-files <dir>'
  );
  process.exit(2);
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n\u2717 nightly-tiers self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test\n' +
          'that never finished as a self-test that passed.\n'
      );
      process.exit(1);
    }
  } else if (argv[0] === '--packages' && argv.length === 1) {
    const doc = packageListDocument();
    for (const { name, files } of tierPackages()) {
      console.error(`nightly-tiers: ${name} owns ${files.length} nightly-tier test file(s)`);
    }
    console.error(`nightly-tiers: ${doc.packages.count} package(s) own nightly-tier test files`);
    process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
  } else if (argv[0] === '--check' && argv.length === 1) {
    const { owners, problems } = checkTierPackages();
    if (problems.length > 0) {
      console.error(`\n\u2717 nightly-tiers --check: ${problems.length} problem(s)\n`);
      for (const p of problems) console.error(`  - ${p}`);
      console.error(
        '\nA package that owns nightly-tier test files must select them through ' +
          `${TIER_ENV} (read once, in scripts/nightly-tiers.mjs). Otherwise those files run in the ` +
          'merge queue and the whole suite runs under the nightly -- both silently.'
      );
      process.exit(1);
    }
    console.log(`\u2713 nightly-tiers --check: ${owners.length} tier-owning package(s) honour ${TIER_ENV} (judged by what vitest collects).`);
  } else if (argv[0] === '--failing-files' && argv.length === 2) {
    const { reportsRead, failed, unmapped } = failingTierFiles(path.resolve(argv[1]));
    console.error(`nightly-tiers: read ${reportsRead} vitest JSON report(s); ${failed.length} nightly-tier file(s) failed`);
    for (const f of failed) process.stdout.write(`${f}\n`);
    for (const u of unmapped) console.error(`nightly-tiers: failed file outside the nightly tiers (not mapped): ${u}`);
  } else {
    usage();
  }
}
