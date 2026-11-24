#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-case-colliding-paths -- refuses two tracked entries in ONE directory
// whose names, with the last extension dropped, differ only by letter case.
//
//   node scripts/check-case-colliding-paths.mjs
//   node scripts/check-case-colliding-paths.mjs --self-test   # verify the checker itself
//   node scripts/check-case-colliding-paths.mjs --list        # every directory judged, collisions marked
//
// Wired into CI through the `check:gitlink-declared` package script, the
// other whole-index shape gate, so it runs on every pull request on Linux.
//
// ## The measured defect
//
// `ui/packages/app-shell/src/layout/` carried `DesignModeHeaderPins.tsx` (a
// component) beside `designModeHeaderPins.ts` (its helper). Linux is case
// sensitive, so CI built and tested green. On macOS (APFS, case-insensitive by
// default) the import `./DesignModeHeaderPins.js` is resolved by trying `.ts`
// before `.tsx`, and `DesignModeHeaderPins.ts` MATCHES `designModeHeaderPins.ts`
// on that file system. The component import read the helper: the type build
// failed (TS1149, TS2305) and the console bundle failed with MISSING_EXPORT, so
// a developer on a Mac could not start the local stack. A second pair
// (`views/RecordTabsConfig.tsx` + `views/recordTabsConfig.ts`) did the same.
// The same class had already been fixed once by renaming, with no check added,
// and it came back twice within the day.
//
// ## Why the comparison drops the extension
//
// The two colliding files do NOT share a name: `.tsx` and `.ts` differ. A
// check that compares whole file names case-insensitively passes this pair.
// What collides is the MODULE SPECIFIER -- an import names the stem and the
// resolver supplies the extension -- so the unit compared is the name with its
// last extension removed. `Foo.tsx` + `foo.ts` collide; `Foo.tsx` +
// `Foo.test.tsx` (stem `Foo.test`) and `index.ts` + `index.css` (identical
// stem, nothing differs by case) do not.
//
// The same rule also catches the plain case: two paths equal except for case
// (`README.md` + `readme.md`) check out as ONE file on macOS and Windows, and
// a directory entry beside a file or another directory (`Foo/` + `foo.ts`,
// `Foo/` + `foo/`) is judged on the same stems, because `./Foo` resolves into
// either.
//
// ## Why the INDEX
//
// The subject is what a clone receives. `git ls-files` lists exactly the paths
// a checkout writes, the CI checkout and the developer's clone alike, and it
// runs identically on a case-sensitive file system -- which is the point: the
// file system CI runs on cannot show this defect, so the check must not ask it.
//
// ## No skip list
//
// There is no allowlist, on purpose. The tree is clean once the two pairs are
// renamed, and a collision is fixed by renaming one side (the helper becomes
// `<stem>Model.ts`, the shape `designModeMenuModel.ts` took) -- never by an
// exemption a Mac developer cannot benefit from.

// The reason is ONE line on purpose: the marker is matched line-by-line, so a reason wrapped across
// comment lines is captured only as far as its first newline and prints to a seat cut off mid-sentence.
// dispatch-gates: whole-tree-population -- the population is `git ls-files`, the WHOLE index, and a collision is between two entries any card can add, so no card's file surface can narrow this gate.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';

/**
 * The NUL delimiter `-z` uses, built from its byte value rather than written as
 * a literal: this file is inside `check:nul-bytes`' scan surface.
 */
const NUL = String.fromCharCode(0);

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Every tracked path, once each (a conflicted index repeats a path per stage). */
export function parsePaths(stdout) {
  return [...new Set(String(stdout).split(NUL).filter(Boolean))];
}

/**
 * The name an import specifier names: the entry's name minus its LAST
 * extension. A leading dot is not an extension (`.env` stays `.env`), and a
 * directory entry keeps its whole name.
 */
export function stemOf(name, isDirectory = false) {
  if (isDirectory) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Every directory's entries, as `dir -> Map(entryName -> { isDirectory, path })`.
 * Directories are entries of their parent, so `Foo/` beside `foo.ts` is seen.
 * The root directory is the empty string.
 */
export function directoryEntries(paths) {
  const dirs = new Map();
  const add = (dir, name, isDirectory, path) => {
    if (!dirs.has(dir)) dirs.set(dir, new Map());
    const entries = dirs.get(dir);
    if (!entries.has(name)) entries.set(name, { isDirectory, path });
  };
  for (const path of paths) {
    const segments = path.split('/');
    let dir = '';
    for (let i = 0; i < segments.length; i++) {
      const isDirectory = i < segments.length - 1;
      const entryPath = dir ? `${dir}/${segments[i]}` : segments[i];
      add(dir, segments[i], isDirectory, isDirectory ? `${entryPath}/` : entryPath);
      dir = entryPath;
    }
  }
  return dirs;
}

/**
 * The collisions: within one directory, entries whose stems are equal once
 * lower-cased but not equal as written. Each collision is the sorted list of
 * the entries' paths that share that folded stem.
 */
export function findCollisions(paths) {
  const collisions = [];
  const dirs = directoryEntries(paths);
  for (const [, entries] of dirs) {
    const byFolded = new Map();
    for (const [name, { isDirectory, path }] of entries) {
      const stem = stemOf(name, isDirectory);
      const folded = stem.toLowerCase();
      if (!byFolded.has(folded)) byFolded.set(folded, []);
      byFolded.get(folded).push({ stem, path });
    }
    for (const [, group] of byFolded) {
      if (new Set(group.map((g) => g.stem)).size < 2) continue;
      collisions.push(group.map((g) => g.path).sort());
    }
  }
  return collisions.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * The one scan. `main()`, `--list` and `--self-test` all go through here, so
 * the self-test exercises the real code path.
 */
export function scan(root) {
  const paths = parsePaths(git(root, ['ls-files', '-z']));
  return { paths: paths.length, directories: directoryEntries(paths).size, collisions: findCollisions(paths) };
}

/** What the run looked at, stated even when it found nothing, so a green can be read for its scope. */
export function summarise({ paths, directories, collisions }) {
  return `${paths} tracked path(s) in ${directories} director(ies); ${collisions.length} case-colliding group(s)`;
}

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function main() {
  const result = scan(repoRoot());
  if (result.collisions.length === 0) {
    console.log(`check-case-colliding-paths: OK (${summarise(result)}).`);
    process.exit(0);
  }
  console.error(
    `check-case-colliding-paths: ${result.collisions.length} group(s) of entries in one directory differ only by case `
      + 'once the last extension is dropped\n',
  );
  for (const group of result.collisions) console.error(`  • ${group.join('  <->  ')}`);
  console.error(`
On a case-insensitive file system (macOS by default, Windows) these names are
the SAME module: an import of one stem can resolve to the other file, because
the resolver tries extensions in order and the file system ignores case. Linux
CI cannot show the failure; a Mac developer's type build and console bundle do.
${summarise(result)}.

Fix: rename one side so the stems differ by more than case -- for a component
and its helper, the helper takes a suffix (\`fooModel.ts\` beside \`Foo.tsx\`) --
and update its importers and its test file's name with it.

⛔ There is no skip list. An exemption keeps the file broken for every Mac
developer; renaming is the only fix.`);
  process.exit(1);
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// The pure batteries call `findCollisions()` on path lists; the git batteries
// build throwaway repos in a temp dir -- never inside this checkout -- and run
// `scan()`, the SAME function main() calls, over a real index.

const SELF_TEST_VERDICT = 'check-case-colliding-paths self-test reached its verdict';

// Pinned battery NAMES with a per-battery floor (AGENTS.md § Writing a
// `--self-test`): a battery below its floor means cases stopped running.
const SELF_TEST_BATTERIES = Object.freeze({
  'the measured pair: a component and its helper differ only by case': 6,
  'distinct stems, same stems and other directories pass': 7,
  'whole names, directories and dotfiles': 6,
  'a real git index, case-sensitive on Linux, is judged': 6,
  'the green is not vacuous, and it states its own scope': 4,
});

// Deleting an entry silences that battery's floor as effectively as zeroing it,
// so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 5;

const UNATTRIBUTED_BATTERY = '(no battery open)';

function initFixtureRepo(dir) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  const run = (args) => execFileSync('git', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  mkdirSync(dir, { recursive: true });
  run(['init', '-q']);
  writeFileSync(join(dir, '.git', 'empty-excludes'), '');
  run(['config', 'core.excludesFile', join(dir, '.git', 'empty-excludes')]);
  // The fixture must hold both spellings even where the host file system folds
  // case; `update-index --add --cacheinfo` writes index rows without touching
  // the working tree, so the index under test is the same on every host.
  run(['config', 'core.ignorecase', 'false']);
  return run;
}

function stageWithoutWorkingTree(run, dir, paths) {
  writeFileSync(join(dir, '.git', 'blob.txt'), 'x\n');
  const oid = execFileSync('git', ['hash-object', '-w', join(dir, '.git', 'blob.txt')], { cwd: dir, encoding: 'utf8' }).trim();
  for (const path of paths) run(['update-index', '--add', '--cacheinfo', `100644,${oid},${path}`]);
}

function selfTest() {
  const seen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
    checked++;
    if (!cond) failures.push(msg);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  battery('the measured pair: a component and its helper differ only by case');
  {
    const c = findCollisions(['src/layout/DesignModeHeaderPins.tsx', 'src/layout/designModeHeaderPins.ts']);
    assert(c.length === 1, `Foo.tsx + foo.ts: expected 1 collision, got ${c.length}`);
    assert(
      same(c[0], ['src/layout/DesignModeHeaderPins.tsx', 'src/layout/designModeHeaderPins.ts']),
      `Foo.tsx + foo.ts: the collision must name both paths, got ${JSON.stringify(c[0])}`,
    );
    const t = findCollisions(['a/__tests__/Foo-1.test.tsx', 'a/__tests__/foo-1.test.ts']);
    assert(t.length === 1, `test files Foo-1.test.tsx + foo-1.test.ts: expected 1 collision, got ${t.length}`);
    const renamed = findCollisions(['src/layout/DesignModeHeaderPins.tsx', 'src/layout/designModeHeaderPinsModel.ts']);
    assert(renamed.length === 0, `the renamed helper (…Model.ts) must pass, got ${JSON.stringify(renamed)}`);
    const three = findCollisions(['x/Foo.tsx', 'x/foo.ts', 'x/FOO.js']);
    assert(three.length === 1 && three[0].length === 3, `three spellings are ONE group of three, got ${JSON.stringify(three)}`);
    const twoDirs = findCollisions(['a/Foo.tsx', 'a/foo.ts', 'b/Bar.tsx', 'b/bar.ts']);
    assert(twoDirs.length === 2, `two directories each with a pair: expected 2 groups, got ${twoDirs.length}`);
  }

  battery('distinct stems, same stems and other directories pass');
  {
    const pass = (paths, why) => {
      const c = findCollisions(paths);
      assert(c.length === 0, `${why}: expected no collision, got ${JSON.stringify(c)}`);
    };
    pass(['a/index.ts', 'a/index.css'], 'identical stem, different extension');
    pass(['a/Foo.tsx', 'a/Foo.test.tsx'], 'Foo + Foo.test are different stems');
    pass(['a/Foo.tsx', 'a/fooSave.ts'], 'Foo + fooSave are different stems');
    pass(['a/Foo.ts', 'b/foo.ts'], 'same folded stem in DIFFERENT directories');
    pass(['a/Foo.tsx', 'a/Foo.module.css'], 'Foo + Foo.module are different stems');
    pass(['a/b/c.ts'], 'a single path');
    pass([], 'an empty index');
  }

  battery('whole names, directories and dotfiles');
  {
    const c1 = findCollisions(['README.md', 'readme.md']);
    assert(c1.length === 1, `README.md + readme.md (one file on macOS): expected 1 collision, got ${c1.length}`);
    const c2 = findCollisions(['pkg/Foo/index.ts', 'pkg/foo.ts']);
    assert(
      c2.length === 1 && same(c2[0], ['pkg/Foo/', 'pkg/foo.ts']),
      `directory Foo/ beside foo.ts: expected one group naming 'pkg/Foo/' and 'pkg/foo.ts', got ${JSON.stringify(c2)}`,
    );
    const c3 = findCollisions(['Docs/a.md', 'docs/b.md']);
    assert(c3.length === 1 && same(c3[0], ['Docs/', 'docs/']), `Docs/ + docs/: expected one group, got ${JSON.stringify(c3)}`);
    const c4 = findCollisions(['pkg/foo/index.ts', 'pkg/foo.ts']);
    assert(c4.length === 0, `directory foo/ beside foo.ts (same case) must pass, got ${JSON.stringify(c4)}`);
    assert(stemOf('.env') === '.env' && stemOf('.ENV.local') === '.ENV', 'a leading dot is not an extension');
    assert(stemOf('v1.2', true) === 'v1.2', 'a directory keeps its whole name as its stem');
  }

  const dir = mkdtempSync(join(tmpdir(), 'check-case-colliding-paths-selftest-'));
  try {
    battery('a real git index, case-sensitive on Linux, is judged');
    {
      const red = join(dir, 'red');
      const run = initFixtureRepo(red);
      stageWithoutWorkingTree(run, red, ['ui/src/Foo.tsx', 'ui/src/foo.ts', 'ui/src/bar.ts']);
      const result = scan(red);
      assert(result.paths === 3, `the red fixture's index holds 3 paths, scan read ${result.paths}`);
      assert(result.collisions.length === 1, `the red fixture: expected 1 collision, got ${result.collisions.length}`);
      assert(
        same(result.collisions[0], ['ui/src/Foo.tsx', 'ui/src/foo.ts']),
        `the red fixture: the collision must name Foo.tsx and foo.ts, got ${JSON.stringify(result.collisions[0])}`,
      );
      const green = join(dir, 'green');
      const runGreen = initFixtureRepo(green);
      stageWithoutWorkingTree(runGreen, green, ['ui/src/Foo.tsx', 'ui/src/fooModel.ts']);
      const ok = scan(green);
      assert(ok.collisions.length === 0, `the renamed fixture must pass, got ${JSON.stringify(ok.collisions)}`);
      assert(ok.paths === 2, `the green fixture's index holds 2 paths, scan read ${ok.paths}`);
      const paths = parsePaths(`a${NUL}b${NUL}a${NUL}`);
      assert(same(paths, ['a', 'b']), `parsePaths drops empty records and repeats, got ${JSON.stringify(paths)}`);
    }

    battery('the green is not vacuous, and it states its own scope');
    {
      const green = scan(join(dir, 'green'));
      const line = summarise(green);
      assert(line.includes('2 tracked path(s)'), `the summary names the path count, got: ${line}`);
      assert(line.includes('0 case-colliding group(s)'), `the summary states zero groups explicitly, got: ${line}`);
      assert(green.directories === 3, `root, ui/ and ui/src/ are 3 directories, got ${green.directories}`);
      const empty = join(dir, 'empty');
      initFixtureRepo(empty);
      const none = scan(empty);
      assert(none.paths === 0 && summarise(none).startsWith('0 tracked path(s)'), 'an empty index says it read 0 paths');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    failures.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of seen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    failures.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declaredBatteries) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    failures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}.`,
    );
  }
  if (floorBreached) {
    failures.push('A battery below its floor means cases STOPPED RUNNING — find what stopped registering and restore it.');
  }

  if (failures.length) {
    console.error(`✗ check-case-colliding-paths --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-case-colliding-paths --self-test: ${checked} assertions (pure batteries + throwaway git repos, real scan() path)`);
  return SELF_TEST_VERDICT;
}

// Exports bindings, so an import for those exports alone must run nothing.
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
    console.error(
      '\n✗ check-case-colliding-paths self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test that never finished\n'
        + 'as a self-test that passed.\n',
    );
    process.exit(1);
  }
} else if (process.argv.includes('--list')) {
  const result = scan(repoRoot());
  for (const group of result.collisions) console.log(`COLLISION  ${group.join('  ')}`);
  console.log(summarise(result));
} else {
  main();
}
