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

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// A `cases` list that holds a line per case, ok or FAIL, used to be this
// self-test's ONLY success condition, so "every case held" and "the cases
// never ran" printed the same line. Closed the way PR #13487 validated on
// check-doc-authoring: what is pinned is the registered NAMES, not a
// number. The floor requires the OPENED set to equal the DECLARED set with
// each battery at or above its own count.
//
// This file declares ONE battery, opened at the top of the self-test body. It
// carries fewer than the two named section banners the sectioning criterion
// needs, and ⛔ a comment is NOT promoted to a section head — that is a
// judgement per comment this transplant does not make. The hoisted single
// battery is the shape PR #14896, PR #15003 and PR #15217 landed for exactly
// this case.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'publish-smoke-pack self-test': 4,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'publish-smoke-pack self-test reached its verdict';

function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  battery('publish-smoke-pack self-test');
  const cases = [];
  const check = (name, fn) => {
    registerCase();
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

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  // The floor's refusal joins the SAME sink the cases use — a line in the
  // report and the failing exit code — so a breached floor reads exactly like a
  // failed case and cannot be printed over by the verdict below.
  const floorFailure = (message) => {
    cases.push(`  FAIL — ${message}`);
    process.exitCode = 1;
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }

  console.log('publish-smoke-pack self-test');
  for (const line of cases) console.log(line);
  console.log(process.exitCode === 1 ? 'SELF-TEST FAILED' : `SELF-TEST PASSED (${cases.length} cases)`);

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ publish-smoke-pack self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    main().catch((err) => {
      console.error(err.stack ?? String(err));
      process.exit(1);
    });
  }
}
