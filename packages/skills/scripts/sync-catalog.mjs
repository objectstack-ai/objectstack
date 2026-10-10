#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * sync-catalog — the build step of `@objectstack/skills`: copy the
 * repository's published skills catalog (`skills/**` at the repo root) into
 * this package's publish tree, byte for byte, and prove it.
 *
 *   node scripts/sync-catalog.mjs              # the build: wipe + copy + verify
 *   node scripts/sync-catalog.mjs --check      # judge the tree on disk (prepack)
 *   node scripts/sync-catalog.mjs --self-test  # prove the battery can go red
 *
 * ## Why a package, and why a copy
 *
 * The catalog used to reach projects only from the repository's default
 * branch (`npx skills add objectstack-ai/objectstack/skills …`), so a project
 * on one published `@objectstack/spec` read skills already teaching the next
 * major. Shipping the catalog as a package in the changeset `fixed` group binds
 * it to the version line of everything it teaches: one release, one catalog.
 *
 * The source of truth stays `skills/**` at the repository root — the file the
 * maintainer reviews, the file every skill gate reads, the `next` channel. This
 * package commits no second copy and keeps no symlink: the tree under `dist/`
 * is produced by this script, gitignored, and listed by `files` alone.
 *
 * ## Layout — `dist/skills/<skill>/…`, measured against the skills CLI
 *
 * `skills@1.7.2`'s `experimental_sync` ("Sync skills from node_modules into
 * agent directories") discovers a dependency's skills at exactly two places:
 * `<pkg>/skills/<name>/SKILL.md` and `<pkg>/dist/skills/<name>/SKILL.md`. Of
 * the two, `dist/` is the one this repository already treats as a build output
 * everywhere: canonical in `files` for the publish-whitelist gate, gitignored
 * repo-wide, turbo's default `outputs`, and skipped by the published-README
 * gates' directory walk — a copy at `<pkg>/skills/` would instead put every
 * catalog markdown file into those gates' population whenever a build had run,
 * making their verdict depend on local build state.
 *
 * ## Determinism, and what is refused
 *
 * The copy is wipe-then-write: `dist/` is removed whole and rebuilt from the
 * source walk, so a file deleted from the catalog cannot survive in the publish
 * tree, and running twice is running once. The walk admits regular files and
 * directories only — a symlink or anything else in the catalog is a refusal,
 * never silently followed or skipped — and an empty catalog (no
 * `<skill>/SKILL.md`) is a refusal too: a package that ships nothing must say
 * so at build time, not at a consumer's `experimental_sync`.
 *
 * After the copy the tree is read back and compared to the source, file set and
 * bytes, and `--check` runs that same comparison on demand. The package's
 * `prepack` runs `--check`, so `pnpm pack` / `pnpm publish` refuse a stale or
 * absent tree instead of shipping it.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
/** The catalog, at the repository root. */
const SOURCE = join(REPO_ROOT, 'skills');
/** The publish tree; `dist/` is wiped whole on every build. */
const DIST = join(PACKAGE_ROOT, 'dist');
const TARGET = join(DIST, 'skills');
const ENTRYPOINT_FILE = 'SKILL.md';
const SELF = 'packages/skills/scripts/sync-catalog.mjs';

/** A refusal this script makes deliberately, as opposed to an unexpected throw. */
class SyncRefusal extends Error {}

const posix = (p) => p.split(sep).join('/');

/**
 * Every regular file under `root`, as sorted POSIX paths relative to it.
 * Refuses anything that is not a regular file or a directory, by path.
 */
export function walkFiles(root) {
  const out = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const stat = lstatSync(abs);
      if (stat.isDirectory()) visit(abs);
      else if (stat.isFile()) out.push(posix(relative(root, abs)));
      else {
        throw new SyncRefusal(
          `${posix(relative(root, abs))} is ${stat.isSymbolicLink() ? 'a symlink' : 'not a regular file'}; ` +
            'the catalog ships regular files only, and a link is never followed.',
        );
      }
    }
  };
  visit(root);
  return out;
}

const sha256 = (abs) => createHash('sha256').update(readFileSync(abs)).digest('hex');

/**
 * Compare two trees: same file set, same bytes. Pure over the filesystem;
 * returns the differences rather than throwing, so a caller can report all of
 * them at once.
 */
export function compareTrees(source, target) {
  const problems = [];
  if (!existsSync(target)) {
    return { problems: [`${posix(target)} does not exist`], files: 0 };
  }
  const src = walkFiles(source);
  const dst = walkFiles(target);
  const srcSet = new Set(src);
  const dstSet = new Set(dst);
  for (const f of src) if (!dstSet.has(f)) problems.push(`missing from the publish tree: ${f}`);
  for (const f of dst) if (!srcSet.has(f)) problems.push(`extra in the publish tree: ${f}`);
  for (const f of src) {
    if (!dstSet.has(f)) continue;
    if (sha256(join(source, f)) !== sha256(join(target, f))) problems.push(`bytes differ: ${f}`);
  }
  return { problems, files: src.length };
}

/** The catalog must hold at least one skill (`<dir>/SKILL.md`), or the build refuses. */
export function assertCatalogShape(source) {
  if (!existsSync(source)) throw new SyncRefusal(`catalog root ${posix(source)} does not exist`);
  const skills = readdirSync(source).filter((n) => existsSync(join(source, n, ENTRYPOINT_FILE)));
  if (skills.length === 0) {
    throw new SyncRefusal(`catalog root ${posix(source)} holds no <skill>/${ENTRYPOINT_FILE}; nothing to ship.`);
  }
  return skills;
}

/**
 * The build: wipe `dist`, copy `source` into `target`, read the copy back and
 * compare. Returns `{ skills, files }` on success; throws a `SyncRefusal`
 * naming every difference otherwise.
 */
export function syncCatalog({ source = SOURCE, dist = DIST, target = TARGET } = {}) {
  const skills = assertCatalogShape(source);
  const files = walkFiles(source);
  rmSync(dist, { recursive: true, force: true });
  for (const rel of files) {
    const dst = join(target, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(join(source, rel)));
  }
  const { problems } = compareTrees(source, target);
  if (problems.length > 0) {
    throw new SyncRefusal(`the copy does not match its source:\n  ${problems.join('\n  ')}`);
  }
  return { skills, files: files.length };
}

/** `--check`: judge the tree on disk against the source. */
export function checkCatalog({ source = SOURCE, target = TARGET } = {}) {
  assertCatalogShape(source);
  return compareTrees(source, target);
}

// ---------------------------------------------------------------------------
// Self-test — pins the RED paths, over temp fixtures, so the copy step cannot
// rot into one that reports success while copying nothing.
// ---------------------------------------------------------------------------

// Set only after the verdict line prints; the dispatch refuses when it is unset
// (a `return` above the verdict would otherwise read as a pass).
let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'build copies the catalog byte for byte, and --check then passes': 1,
  'build is idempotent: a second run produces the identical tree': 1,
  'a file deleted from the source does not survive a rebuild': 1,
  '--check reds on a byte change in the publish tree, naming the file': 1,
  '--check reds on an extra file in the publish tree': 1,
  '--check reds on a file missing from the publish tree': 1,
  '--check reds when the publish tree is absent': 1,
  'an empty catalog (no <skill>/SKILL.md) is refused at build': 1,
  'a symlink in the catalog is refused, never followed': 1,
});
const SELF_TEST_BATTERY_FLOOR = 9;

function selfTest() {
  console.log('sync-catalog self-test\n');
  const registered = new Map();
  let failed = 0;
  const scratch = mkdtempSync(join(tmpdir(), 'objectstack-skills-sync-'));
  const fixture = (name) => {
    const root = join(scratch, name);
    const source = join(root, 'skills');
    mkdirSync(join(source, 'objectstack-data', 'references'), { recursive: true });
    writeFileSync(join(source, 'README.md'), '# catalog\n');
    writeFileSync(join(source, 'objectstack-data', 'SKILL.md'), '---\nname: objectstack-data\n---\n# data\n');
    writeFileSync(join(source, 'objectstack-data', 'references', '_index.md'), '# refs\n');
    const dist = join(root, 'pkg', 'dist');
    return { source, dist, target: join(dist, 'skills') };
  };
  const run = (label, body) => {
    registered.set(label, (registered.get(label) ?? 0) + 1);
    try {
      const detail = body();
      console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${label}\n      ${err.message}`);
    }
  };
  const expectRefusal = (fn, re) => {
    let caught = null;
    try { fn(); } catch (err) { caught = err; }
    if (!caught) throw new Error('expected a refusal, got success');
    if (!(caught instanceof SyncRefusal)) throw new Error(`expected a SyncRefusal, got ${caught.constructor.name}: ${caught.message}`);
    if (!re.test(caught.message)) throw new Error(`refusal does not name the cause: ${caught.message}`);
    return caught.message.split('\n')[0];
  };

  try {
    run('build copies the catalog byte for byte, and --check then passes', () => {
      const f = fixture('a');
      const r = syncCatalog(f);
      if (r.files !== 3) throw new Error(`expected 3 files, copied ${r.files}`);
      if (readFileSync(join(f.target, 'README.md'), 'utf8') !== '# catalog\n') throw new Error('README bytes differ');
      const c = checkCatalog(f);
      if (c.problems.length !== 0) throw new Error(`--check found ${c.problems.join('; ')}`);
      return `${r.files} files, ${c.files} checked`;
    });
    run('build is idempotent: a second run produces the identical tree', () => {
      const f = fixture('b');
      syncCatalog(f);
      const first = walkFiles(f.target).map((p) => `${p}:${sha256(join(f.target, p))}`).join('|');
      syncCatalog(f);
      const second = walkFiles(f.target).map((p) => `${p}:${sha256(join(f.target, p))}`).join('|');
      if (first !== second) throw new Error('second build differs from the first');
    });
    run('a file deleted from the source does not survive a rebuild', () => {
      const f = fixture('c');
      syncCatalog(f);
      rmSync(join(f.source, 'objectstack-data', 'references', '_index.md'));
      syncCatalog(f);
      if (existsSync(join(f.target, 'objectstack-data', 'references', '_index.md'))) throw new Error('deleted file survived');
    });
    run('--check reds on a byte change in the publish tree, naming the file', () => {
      const f = fixture('d');
      syncCatalog(f);
      writeFileSync(join(f.target, 'objectstack-data', 'SKILL.md'), '---\nname: objectstack-data\n---\n# tampered\n');
      const c = checkCatalog(f);
      if (!c.problems.some((p) => p === 'bytes differ: objectstack-data/SKILL.md')) throw new Error(`got ${JSON.stringify(c.problems)}`);
    });
    run('--check reds on an extra file in the publish tree', () => {
      const f = fixture('e');
      syncCatalog(f);
      writeFileSync(join(f.target, 'stray.md'), 'x\n');
      const c = checkCatalog(f);
      if (!c.problems.some((p) => p === 'extra in the publish tree: stray.md')) throw new Error(`got ${JSON.stringify(c.problems)}`);
    });
    run('--check reds on a file missing from the publish tree', () => {
      const f = fixture('f');
      syncCatalog(f);
      rmSync(join(f.target, 'README.md'));
      const c = checkCatalog(f);
      if (!c.problems.some((p) => p === 'missing from the publish tree: README.md')) throw new Error(`got ${JSON.stringify(c.problems)}`);
    });
    run('--check reds when the publish tree is absent', () => {
      const f = fixture('g');
      const c = checkCatalog(f);
      if (c.problems.length !== 1 || !/does not exist$/.test(c.problems[0])) throw new Error(`got ${JSON.stringify(c.problems)}`);
    });
    run('an empty catalog (no <skill>/SKILL.md) is refused at build', () => {
      const f = fixture('h');
      rmSync(join(f.source, 'objectstack-data'), { recursive: true });
      return expectRefusal(() => syncCatalog(f), /holds no <skill>\/SKILL\.md/);
    });
    run('a symlink in the catalog is refused, never followed', () => {
      const f = fixture('i');
      symlinkSync(join(f.source, 'README.md'), join(f.source, 'objectstack-data', 'LINK.md'));
      return expectRefusal(() => syncCatalog(f), /LINK\.md is a symlink/);
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // The floor: every declared battery reached, every registered case declared,
  // and the roster itself no smaller than pinned.
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failed += 1;
    console.error(`  ✗ roster holds ${declared.length} batteries, below the pinned floor of ${SELF_TEST_BATTERY_FLOOR}`);
  }
  for (const [name, min] of Object.entries(SELF_TEST_BATTERIES)) {
    const count = registered.get(name) ?? 0;
    if (count < min) {
      failed += 1;
      console.error(`  ✗ battery "${name}" registered ${count} case(s), below its floor of ${min} — it stopped running`);
    }
  }
  for (const name of registered.keys()) {
    if (!(name in SELF_TEST_BATTERIES)) {
      failed += 1;
      console.error(`  ✗ case "${name}" names no declared battery`);
    }
  }

  if (failed > 0) {
    console.error(`\n✗ sync-catalog self-test: ${failed} failure(s).`);
    process.exit(1);
  }
  console.log(`\n✓ sync-catalog self-test: ${registered.size} cases pass.`);
  selfTestReachedVerdict = true;
}

// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(`\n✗ ${SELF} self-test: selfTest() returned without reaching its verdict.`);
      process.exit(1);
    }
    return;
  }
  try {
    if (process.argv.includes('--check')) {
      const { problems, files } = checkCatalog();
      if (problems.length > 0) {
        console.error(
          `\n✗ @objectstack/skills: the publish tree ${posix(relative(REPO_ROOT, TARGET))} is not the catalog ` +
            `${posix(relative(REPO_ROOT, SOURCE))}:\n  ${problems.join('\n  ')}\n\n` +
            '  fix: pnpm --filter @objectstack/skills build\n',
        );
        process.exit(1);
      }
      console.log(`✓ @objectstack/skills: ${files} file(s) under dist/skills are byte-identical to skills/**.`);
      return;
    }
    const { skills, files } = syncCatalog();
    console.log(
      `✓ @objectstack/skills: ${files} file(s) across ${skills.length} skill(s) copied from skills/** ` +
        'into dist/skills and read back byte-identical.',
    );
  } catch (err) {
    if (err instanceof SyncRefusal) {
      console.error(`\n✗ @objectstack/skills: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
