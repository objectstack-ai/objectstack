#!/usr/bin/env node
/**
 * Pack every publishable workspace package into <dest-dir> and write
 * <dest-dir>/overrides.json mapping package name → `file:` tarball spec.
 *
 * Usage:  node scripts/publish-smoke-pack.mjs <dest-dir>
 *
 * Part of the publish-artifact smoke (scripts/publish-smoke.sh): `pnpm pack`
 * applies the SAME manifest rewrites as `pnpm publish` (workspace:* →
 * concrete versions, publishConfig overlay), so the tarballs are what a
 * downstream `npm install` would actually receive — including whatever the
 * published manifests declare WITHOUT this workspace's pnpm overrides.
 *
 * The whole public surface is packed (not a hand-curated closure): the CLI
 * alone depends on ~45 workspace packages, so any curated list would rot.
 * Packing everything keeps the overrides map total — a package missing from
 * it would make the smoke project resolve that name from the npm registry,
 * silently testing a published version instead of the candidate one.
 *
 * THE SET IS THE PUBLISHABLE POPULATION — never a scope glob, never a hand
 * list, never an exclusion. This script used to carve `create-objectstack`
 * out by name, on the rationale that "no @objectstack/* manifest depends on
 * it". That rationale expired the day `@objectstack/cli` took a dependency on
 * the scaffolder: cli@17.2.0 declared `create-objectstack@17.2.0`, the name
 * was neither packed nor pinned, pnpm fell back to the registry, and the
 * release candidate's own smoke died on ERR_PNPM_NO_MATCHING_VERSION for a
 * version that by definition does not exist yet — a chicken-and-egg red on
 * every release candidate from that day on. The general shape of that bill:
 * whether a workspace package is *reachable* from some other manifest is a
 * fact about the dependency graph AT ONE MOMENT, and it is not the question
 * this script gets to ask. Publishable is the question, `private !== true`
 * is the answer, and `assertPinSetTotal` below re-checks it on every run so
 * a future exclusion cannot re-open the hole silently.
 *
 * Source of truth: the workspace itself. The Changesets `fixed` group in
 * .changeset/config.json enumerates the same 69 names, but it is a DERIVED
 * declaration validated against the workspace by scripts/check-changeset-fixed.mjs
 * (which reddens both when a public package is missing from the group and
 * when a group name no longer exists) — deriving from the group would mean
 * reading a copy that a gate keeps honest, rather than the thing itself.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { isEntrypoint } from './invoked-as.mjs';

const execFileP = promisify(execFile);

const CONCURRENCY = 8;

/**
 * The publishable population: every workspace member npm would receive.
 * No scope filter — `create-objectstack` is unscoped and publishable, and
 * the next unscoped public package must land in the set on its own.
 *
 * @param {{name?: string, private?: boolean}[]} all workspace members
 * @returns {{name: string}[]}
 */
export function selectPublishable(all) {
  return all.filter((p) => p.name && p.private !== true);
}

/**
 * The pin set MUST equal the publishable set, both directions. A hole in
 * either direction makes the smoke test something other than the candidate:
 * a missing pin resolves that name from the registry (the bill above), and a
 * surplus pin points the smoke project at a tarball for a name npm will never
 * publish. Both are reported BY NAME — "the map is incomplete" without the
 * name is the diagnostic the release operator had to reverse-engineer.
 *
 * @param {string[]} pinned names present in the overrides map
 * @param {string[]} publishable names of the publishable population
 */
export function assertPinSetTotal(pinned, publishable) {
  const pinnedSet = new Set(pinned);
  const publishableSet = new Set(publishable);
  const missing = publishable.filter((n) => !pinnedSet.has(n)).sort();
  const surplus = pinned.filter((n) => !publishableSet.has(n)).sort();
  if (missing.length === 0 && surplus.length === 0) return;
  const lines = ['tarball pin set != publishable set'];
  if (missing.length > 0) {
    lines.push(
      `  publishable but NOT pinned (${missing.length}): ${missing.join(', ')}`,
      '    → the smoke project would resolve these from the npm registry, so it',
      '      would test PUBLISHED code, or die on a version not published yet.',
    );
  }
  if (surplus.length > 0) {
    lines.push(
      `  pinned but NOT publishable (${surplus.length}): ${surplus.join(', ')}`,
      '    → pinning a name npm will never publish; the smoke would pass on a',
      '      resolution no real user can reproduce.',
    );
  }
  throw new Error(lines.join('\n'));
}

async function listPublicPackages(repoRoot) {
  const { stdout } = await execFileP('pnpm', ['-r', 'list', '--depth', '-1', '--json'], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  return selectPublishable(JSON.parse(stdout));
}

async function packOne(pkg, destDir) {
  const { stdout } = await execFileP(
    'pnpm',
    ['pack', '--json', '--pack-destination', destDir],
    { cwd: pkg.path, maxBuffer: 64 * 1024 * 1024 },
  );
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`pnpm pack --json returned non-JSON for ${pkg.name}:\n${stdout}`);
  }
  if (!parsed.filename) {
    throw new Error(`pnpm pack reported no tarball filename for ${pkg.name}`);
  }
  return { name: pkg.name, filename: parsed.filename };
}

async function main() {
  const destArg = process.argv[2];
  if (!destArg) {
    console.error('Usage: node scripts/publish-smoke-pack.mjs <dest-dir>');
    process.exit(1);
  }
  const repoRoot = resolve(import.meta.dirname, '..');
  const destDir = resolve(destArg);
  mkdirSync(destDir, { recursive: true });

  const packages = await listPublicPackages(repoRoot);
  console.log(`Packing ${packages.length} publishable package(s) → ${destDir}`);

  const overrides = {};
  const queue = [...packages];
  let done = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const pkg = queue.shift();
      if (!pkg) return;
      const { name, filename } = await packOne(pkg, destDir);
      overrides[name] = `file:${filename}`;
      done += 1;
      if (done % 10 === 0 || done === packages.length) {
        console.log(`  packed ${done}/${packages.length}`);
      }
    }
  });
  await Promise.all(workers);

  assertPinSetTotal(
    Object.keys(overrides),
    packages.map((p) => p.name),
  );

  const sorted = Object.fromEntries(
    Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)),
  );
  const outPath = resolve(destDir, 'overrides.json');
  writeFileSync(outPath, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(sorted).length} override(s) → ${outPath}`);
}

/**
 * Self-test — runs without pnpm, a workspace, or a network. It pins the two
 * properties the release smoke depends on, and both are ABLATION-CHECKED
 * (2026-08-23): restoring `EXCLUDE = new Set(['create-objectstack'])` and
 * filtering it out of `selectPublishable` turns case 1 red by name; deleting
 * the `missing`/`surplus` branch of `assertPinSetTotal` turns cases 2/3 red.
 *
 * Case 1 is not "some package survives the filter" — it is specifically that
 * an UNSCOPED public package does, because every form this defect has taken
 * (a `@objectstack/*` scope glob in the pinning prose, a by-name exclusion in
 * the derivation) is invisible to any fixture whose names all start with `@`.
 */
function selfTest() {
  const cases = [];
  const check = (name, fn) => {
    try {
      fn();
      cases.push(`  ok — ${name}`);
    } catch (err) {
      cases.push(`  FAIL — ${name}\n      ${(err.message ?? String(err)).split('\n').join('\n      ')}`);
      process.exitCode = 1;
    }
  };
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  check('an unscoped public package is in the derived set', () => {
    const picked = selectPublishable([
      { name: '@objectstack/cli', private: false },
      { name: 'create-objectstack' }, // no `private` key at all — the real manifest
      { name: '@objectstack/internal-fixtures', private: true },
      { name: undefined },
    ]).map((p) => p.name);
    assert(
      picked.includes('create-objectstack'),
      `unscoped public package dropped from the set: ${JSON.stringify(picked)}`,
    );
    assert(
      !picked.includes('@objectstack/internal-fixtures'),
      'a private package leaked into the publishable set',
    );
    assert(picked.length === 2, `expected 2 publishable, got ${picked.length}`);
  });

  check('set == publishable set is accepted', () => {
    assertPinSetTotal(['create-objectstack', '@objectstack/cli'], ['@objectstack/cli', 'create-objectstack']);
  });

  check('a MISSING member reddens, by name', () => {
    let msg = '';
    try {
      assertPinSetTotal(['@objectstack/cli'], ['@objectstack/cli', 'create-objectstack']);
    } catch (err) {
      msg = err.message;
    }
    assert(msg !== '', 'a pin set missing a publishable member was accepted');
    assert(
      msg.includes('create-objectstack'),
      `the diagnostic does not name the missing package: ${msg}`,
    );
  });

  check('a SURPLUS member reddens, by name', () => {
    let msg = '';
    try {
      assertPinSetTotal(['@objectstack/cli', '@objectstack/gone'], ['@objectstack/cli']);
    } catch (err) {
      msg = err.message;
    }
    assert(msg !== '', 'a pin set with a non-publishable member was accepted');
    assert(msg.includes('@objectstack/gone'), `the diagnostic does not name the surplus package: ${msg}`);
  });

  console.log('publish-smoke-pack self-test');
  for (const line of cases) console.log(line);
  console.log(process.exitCode === 1 ? 'SELF-TEST FAILED' : `SELF-TEST PASSED (${cases.length} cases)`);
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    main().catch((err) => {
      console.error(err.stack ?? String(err));
      process.exit(1);
    });
  }
}
