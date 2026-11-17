#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-module-name-case — no two tracked names that a case-insensitive file
 * system cannot tell apart (#34705).
 *
 * ## Why
 *
 * macOS (APFS, HFS+) and Windows (NTFS) are case-insensitive by default; the
 * Linux CI runners are not. Two names that differ only in letter case are two
 * files on Linux and one name on a contributor's laptop, so a build that is
 * green in CI fails there, or binds an import to the wrong file without a word.
 * #34705 measured it: `deployment-notice/DeploymentNotice.tsx` (a component)
 * beside `deployment-notice/deploymentNotice.ts` (its state module). On macOS
 * `'../deployment-notice/DeploymentNotice.js'` resolved to the `.ts` file and
 * `tsc` failed the app-shell build (`TS2724`, `TS1261`).
 *
 * ## What counts as a collision
 *
 * Within one folder, two entries whose KEYS are equal ignoring case but differ
 * in case. An entry's key is:
 *
 *  - a file's MODULE NAME, the name a relative import spells: the name with
 *    one script extension removed (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`,
 *    `.jsx`, `.mjs`, `.cjs`, and the `.d.` declaration forms of each). That
 *    is the #34705 shape: `DeploymentNotice.tsx` and `deploymentNotice.ts`
 *    share no full name, so a check on full names alone finds nothing, yet
 *    both answer the import `./DeploymentNotice.js`;
 *  - every other file's full name (`README.md` beside `readme.md`);
 *  - a sub-folder's name, which an import of the folder spells too
 *    (`./Foo` reaching `foo/index.ts`).
 *
 * Whole paths that differ only in case (`Docs/a.md` and `docs/a.md`) are the
 * same rule one level up: the two folder names collide in their parent.
 *
 * ⛔ Not a collision: the same key in the same case (`foo.ts` beside
 * `foo.tsx`, or `foo.ts` beside `foo.test.ts`, whose key is `foo.test`). Those
 * are one name on every file system, and which one an import reaches is the
 * resolver's documented order, not a case accident.
 *
 * ## Population
 *
 * Every path `git ls-files` lists: the whole repository, `ui/` included,
 * because a collision anywhere breaks a checkout on those file systems.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// dispatch-gates: whole-tree-population -- `trackedPaths` is a bare `git ls-files` with no pathspec, so every tracked path's name is read and a card adding or renaming a file anywhere implicates this gate.

/** One script extension, with its optional `.d` declaration prefix. */
const SCRIPT_EXTENSION = /(?:\.d)?\.(?:[cm]?[jt]s|[jt]sx)$/;

/** The key an entry of a folder answers to: a file's module name, else its name. */
export function moduleKey(name, isFolder) {
  if (isFolder) return name;
  const stripped = name.replace(SCRIPT_EXTENSION, '');
  return stripped === '' ? name : stripped;
}

/**
 * Every collision in `paths` (repo-relative, `/`-separated):
 * `[{ folder, key, entries }]`, `entries` sorted, one row per colliding key.
 */
export function findCaseCollisions(paths) {
  /** folder → lower-cased key → Map(exact key → Set(entry names)) */
  const folders = new Map();
  const add = (folder, name, isFolder) => {
    const key = moduleKey(name, isFolder);
    let byLower = folders.get(folder);
    if (!byLower) folders.set(folder, (byLower = new Map()));
    const lower = key.toLowerCase();
    let byExact = byLower.get(lower);
    if (!byExact) byLower.set(lower, (byExact = new Map()));
    let names = byExact.get(key);
    if (!names) byExact.set(key, (names = new Set()));
    names.add(isFolder ? `${name}/` : name);
  };
  for (const path of paths) {
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      add(parts.slice(0, i).join('/'), parts[i], i < parts.length - 1);
    }
  }
  const out = [];
  for (const [folder, byLower] of folders) {
    for (const byExact of byLower.values()) {
      if (byExact.size < 2) continue;
      const entries = [...byExact.values()].flatMap((s) => [...s]).sort();
      out.push({ folder, key: [...byExact.keys()].sort().join(' / '), entries });
    }
  }
  return out.sort((a, b) => (a.folder + a.key).localeCompare(b.folder + b.key));
}

function trackedPaths() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0')
    .filter(Boolean);
}

function main() {
  const paths = trackedPaths();
  if (paths.length === 0) {
    console.error('✗ check-module-name-case: `git ls-files` listed nothing — nothing was read, so nothing is proven.');
    return 2;
  }
  const collisions = findCaseCollisions(paths);
  if (collisions.length === 0) {
    console.log(`✓ check-module-name-case: ${paths.length} tracked path(s) read; no two names in one folder differ only in letter case.`);
    return 0;
  }
  console.error(`✗ check-module-name-case: ${collisions.length} name(s) differ only in letter case within one folder:\n`);
  for (const c of collisions) console.error(`  ${c.folder || '.'}/  ${c.entries.join('  ')}`);
  console.error(
    '\n  On a case-insensitive file system (macOS and Windows by default) each pair is one name, so an\n'
      + '  import or a checkout reaches the wrong file. Rename one of them so the two differ by more than case.\n'
      + '  A file\'s name here is the name an import spells: `Foo.tsx` and `foo.ts` collide (#34705).',
  );
  return 1;
}

let selfTestReachedVerdict = false;

function selfTest() {
  let checked = 0;
  const failures = [];
  const t = (name, ok) => {
    checked++;
    if (!ok) failures.push(name);
  };
  const keys = (paths) => findCaseCollisions(paths).map((c) => `${c.folder}|${c.entries.join(',')}`);

  // The module name.
  for (const [name, want] of [
    ['DeploymentNotice.tsx', 'DeploymentNotice'],
    ['deploymentNotice.ts', 'deploymentNotice'],
    ['index.d.ts', 'index'],
    ['index.d.mts', 'index'],
    ['a.mjs', 'a'],
    ['a.cjs', 'a'],
    ['a.jsx', 'a'],
    ['foo.test.ts', 'foo.test'],
    ['README.md', 'README.md'],
    ['.ts', '.ts'],
  ]) t(`moduleKey(${name}) → ${want}`, moduleKey(name, false) === want);
  t('a folder keeps its whole name', moduleKey('lib.ts', true) === 'lib.ts');

  // #34705's own pair, which a full-name check misses.
  t('#34705: Component.tsx beside component.ts collides',
    JSON.stringify(keys([
      'ui/a/deployment-notice/DeploymentNotice.tsx',
      'ui/a/deployment-notice/deploymentNotice.ts',
      'ui/a/deployment-notice/__tests__/DeploymentNotice.test.tsx',
    ])) === JSON.stringify(['ui/a/deployment-notice|DeploymentNotice.tsx,deploymentNotice.ts']));
  t('…and the rename that fixed it does not',
    keys(['d/DeploymentNotice.tsx', 'd/deploymentNoticeState.ts']).length === 0);

  // Other shapes that collide.
  t('two full names differing in case', keys(['README.md', 'readme.md']).length === 1);
  t('two files with the same extension', keys(['src/Foo.ts', 'src/foo.ts']).length === 1);
  t('a declaration beside a module', keys(['src/Foo.d.ts', 'src/foo.js']).length === 1);
  t('two folders (whole paths differing in case)', JSON.stringify(keys(['Docs/a.md', 'docs/b.md'])) === JSON.stringify(['|Docs/,docs/']));
  t('a folder beside a module (an import of the folder)', keys(['src/Foo.ts', 'src/foo/index.ts']).length === 1);
  t('a collision deep in the tree names its folder', JSON.stringify(keys(['a/b/c/X.ts', 'a/b/c/x.tsx'])) === JSON.stringify(['a/b/c|X.ts,x.tsx']));
  t('three spellings are one row', keys(['f/Ab.ts', 'f/aB.ts', 'f/ab.tsx']).length === 1);

  // Shapes that do not.
  t('same key, same case, two extensions', keys(['src/foo.ts', 'src/foo.tsx']).length === 0);
  t('a module and its test', keys(['src/Foo.ts', 'src/Foo.test.ts', 'src/foo.test-helpers.ts']).length === 0);
  t('the same name in two folders', keys(['a/Foo.ts', 'b/foo.ts']).length === 0);
  t('a script and a non-script of one stem', keys(['src/Foo.ts', 'src/foo.md']).length === 0);
  t('a folder repeated by many paths', keys(['src/a.ts', 'src/b.ts', 'src/c/d.ts']).length === 0);

  // The tree.
  const paths = trackedPaths();
  t('the tree lists tracked paths', paths.length > 0);

  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(`check-module-name-case --self-test: ${failures.length} of ${checked} assertion(s) FAILED.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(`check-module-name-case --self-test: ${checked} assertion(s) passed.`);
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    const selfTestCode = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-module-name-case self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(selfTestCode);
  }
  process.exit(main());
}
