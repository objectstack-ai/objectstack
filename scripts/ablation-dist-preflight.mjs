#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ablation-dist-preflight -- prove an ablation actually reached the BUILT
// artifact before the ablation run's colour is allowed to mean anything.
//
//   node scripts/ablation-dist-preflight.mjs <package> <marker>
//   node scripts/ablation-dist-preflight.mjs <package> <marker> --absent
//   node scripts/ablation-dist-preflight.mjs --self-test
//
// ## The failure this exists to stop
//
// The hazard is a property of RESOLUTION, not of any one suite. Its true
// condition is: **any test whose subject resolves through the dependency's
// `exports`** -- which point at that package's built `dist/`, not `src/` --
// with no vitest alias redirecting the specifier back to source. Such a test's
// verdict is a function of BUILD state, so editing `src` has no effect on it
// until that package is rebuilt.
//
// That set is enumerable, and already enumerated: `KNOWN_UNALIASED_TEST_IMPORTS`
// in `scripts/check-test-source-alias.mjs` is the measured, shrink-only ledger
// of exactly those package-dependency pairs -- 61 packages, 305 pairs when this
// paragraph was written. Every one of them carries the failure below.
//
// `packages/qa/dogfood` is the most familiar instance -- it consumes `dist/`
// deliberately, because that is what covers packaging and export-surface
// defects -- but it is an INSTANCE, not the definition. Reading the hazard as
// dogfood-only is how an ablation gets trusted in a plain unit suite where it
// proves nothing: measured in `plugin-email` -> `platform-objects` (375 passes
// on an ablated field; 4 of them went red once `platform-objects` was rebuilt),
// and again in `plugin-auth` -> `core`. Neither package aliases the dep it
// mutated; both are ordinary ledger entries, and `plugin-email` has no
// `vitest.config.*` at all.
//
// The two directions of forgetting are NOT equally dangerous:
//
//   forgot to rebuild a FIX      -> false RED. Costs a lap, and gets noticed.
//   forgot to rebuild an ABLATION -> false GREEN. Silently certifies a vacuous
//                                    test as "verified discriminating".
//
// The second one is why this script exists. An ablation's whole purpose is to
// show the test goes red when the defect is present; run against the
// pre-mutation build it stays green, that green is written down as "ablation
// done, direction as predicted", and an assertion that may never be able to fail
// is left in the repo as a guard. No later CI run can expose it: CI builds
// correctly, so the test is green there forever. Three independent sessions hit
// this in one shift on three different packages; the one that caught it did so
// by hand-grepping `dist/` for the mutation marker. This script is that grep,
// mechanized, with the traps the manual version cannot see.
//
// ### Worse than uninformative -- it points confidently the WRONG WAY
//
// When the ablation's purpose was to prove a NEW GATE is capable of failing,
// the false green is not a null result. It is the observation "the gate did not
// fire", and in that context that reads as evidence the GATE is broken rather
// than evidence the harness is. A dev acting on it goes hunting for a fix that
// is not needed -- or, the expensive outcome, WEAKENS a working gate until it
// "fires", destroying the thing the ablation was written to certify. That is
// the `plugin-auth` -> `core` shape above: ablation legs whose entire purpose
// was to demonstrate a new gate can fail, every one of them dist-mediated.
//
// ## The two ablation shapes, hence the two modes
//
//   PLANT (default)   the mutation ADDS something identifiable -- a changed
//                     error code, a distinctive literal, a token in a message.
//                     `<marker>` must be PRESENT in dist, or the run is void.
//   DELETE (--absent) the mutation REMOVES a guard. There is nothing to plant,
//                     so the assertion inverts: a literal unique to the deleted
//                     code must be GONE from dist. Same check, mirrored.
//
// The rule they mechanize has TWO halves, and only one of them is intuitive:
//
//   mutate  -> rebuild -> prove the marker is IN dist/    (default mode)
//   restore -> rebuild -> prove the marker is GONE        (`--absent`)
//
// So `--absent` is two things at once: the mode for a DELETE ablation, and the
// restore leg of a PLANT one. The restore half is the one that gets skipped --
// rebuilding after mutating is obvious, while remembering that RESTORING also
// needs a rebuild before the NEXT measurement is trustworthy is not. It matters
// more than it looks: a marker left behind in `dist/` keeps mutated code live
// for every later suite run in that worktree, long after the ablation is
// "finished", so the runs that follow are measuring the wrong tree. Done by
// hand the leg reads `grep -c <marker> packages/core/dist/index.js` -> 0 after
// the `git checkout`; this script is that, plus the traps below.
//
// ## Sourcemap-only matches are RED, not green
//
// A hit inside a `.map` file proves a sourcemap was regenerated, not that the
// executable artifact carries the mutation. Counting it would rebuild the exact
// false green this script exists to prevent, so `.map` hits are reported and
// excluded from the verdict.
//
// ## The scan is WHOLE-PACKAGE, so the marker must be unique to the mutation
//
// Both modes grep the package's entire `dist/` tree, deliberately -- a mutation
// can land in any emitted chunk, and guessing which one is how the manual
// version missed things. The price is that the scan cannot tell YOUR literal
// from the same literal written elsewhere in the same package, and both modes
// assume it is unique. When it is not, both go wrong, in opposite directions:
// `--absent` reports surviving hits that were never yours (a false RED), and
// the default mode passes on a sibling's hit alone (a false GREEN -- the one
// this script exists to stop, reintroduced through the marker).
//
// Measured: ablating `internal: true` on ONE field of `sys_email`, then running
//
//   node scripts/ablation-dist-preflight.mjs @objectstack/platform-objects 'internal: true' --absent
//
// reported 6 surviving hits, every one of them a legitimate `internal: true` on
// an identity object in `dist/identity/` and none of them the ablated field.
//
// There is no per-symbol mode. When the marker cannot be made unique -- a
// per-FIELD ablation of a flag the package also uses elsewhere is the standard
// case -- do NOT weaken the marker to make this script agree with you. Verify
// by PROPERTY READ against the same artifact instead, which is exact where a
// substring scan cannot be:
//
//   node -e "const {SysEmail}=require('./packages/platform-objects/dist/audit/index.js');
//            console.log(SysEmail.fields.headers_json.internal)"
//   # before rebuild: true        (ablation NOT in the artifact -> the green was vacuous)
//   # after  rebuild: undefined
//
// Same question, same moment in the procedure, same two halves (mutate and
// restore); only the instrument changes. What is not negotiable is that SOME
// instrument reads the built artifact before the ablation's colour is believed.
//
// ## Why this is not a `check:*` gate
//
// It judges a deliberately mutated working tree, so it can only be run by the
// agent performing the ablation, at one specific moment between "mutate" and
// "run the suite". CI has no ablation in flight and nothing to assert. It is
// dev-side agent tooling, invoked from the ablation procedure in
// `.claude/agents/os-dev.md`, `.claude/skills/dogfood-verification/SKILL.md`
// and `packages/qa/dogfood/README.md` step 4 -- keep those three and this
// file's usage line in step. (Those three state the procedure scoped to the
// dogfood suite; the true condition is the resolution one stated at the top.)
//
// Anything this script cannot see is RED, never a skip: a missing `dist/`, a
// `dist/` with nothing readable in it, or a package name that resolves to
// nothing all fail by name. A pre-flight that shrugs is worse than none, because
// its exit 0 is read as proof.

import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Read as text, but never let a binary artifact fabricate a match.
const BINARY_EXT = new Set(['.wasm', '.node', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.zip', '.gz', '.br']);

/** Parse the `packages:` globs out of pnpm-workspace.yaml (no YAML dependency). */
export function parseWorkspaceGlobs(yamlText) {
  const globs = [];
  let inPackages = false;
  for (const rawLine of yamlText.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = line.match(/^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/);
      if (item) {
        globs.push(item[1]);
        continue;
      }
      if (line.trim() !== '') break; // next top-level key ends the list
    }
  }
  return globs;
}

/** name -> repo-relative dir, for every workspace package. */
function workspacePackages(repoRoot) {
  const yamlPath = join(repoRoot, 'pnpm-workspace.yaml');
  let globs;
  try {
    globs = parseWorkspaceGlobs(readFileSync(yamlPath, 'utf8'));
  } catch {
    fail(`cannot read ${relative(repoRoot, yamlPath) || 'pnpm-workspace.yaml'} -- refusing to guess the workspace layout.`);
  }
  if (globs.length === 0) fail('pnpm-workspace.yaml declares no `packages:` globs -- refusing to scan an empty workspace.');

  const dirs = [];
  for (const glob of globs) {
    if (glob.endsWith('/*')) {
      const parent = join(repoRoot, glob.slice(0, -2));
      let entries = [];
      try {
        entries = readdirSync(parent, { withFileTypes: true });
      } catch {
        continue; // a declared-but-absent parent is the workspace's problem, not ours
      }
      for (const e of entries) if (e.isDirectory()) dirs.push(join(parent, e.name));
    } else {
      dirs.push(join(repoRoot, glob));
    }
  }

  const byName = new Map();
  for (const dir of dirs) {
    const pkgJson = join(dir, 'package.json');
    if (!existsSync(pkgJson)) continue;
    try {
      const { name } = JSON.parse(readFileSync(pkgJson, 'utf8'));
      if (typeof name === 'string' && name.length > 0) byName.set(name, dir);
    } catch {
      // an unparseable package.json is not this script's verdict to give
    }
  }
  return byName;
}

/** Accept `@objectstack/plugin-auth`, `plugin-auth`, or a path to the package. */
export function resolvePackageDir(input, byName, repoRoot = REPO_ROOT) {
  if (byName.has(input)) return { dir: byName.get(input), name: input };
  const scoped = `@objectstack/${input}`;
  if (byName.has(scoped)) return { dir: byName.get(scoped), name: scoped };
  const asPath = resolve(repoRoot, input);
  for (const [name, dir] of byName) if (resolve(dir) === asPath) return { dir, name };
  const near = [...byName.keys()].filter((n) => n.includes(input)).slice(0, 5);
  return { dir: null, name: null, near };
}

function walkFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** Scan a dist tree for `marker`, splitting code hits from sourcemap hits. */
export function scanDist(distDir, marker) {
  const codeHits = [];
  const mapHits = [];
  let scanned = 0;
  let skippedBinary = 0;
  for (const file of walkFiles(distDir)) {
    if (BINARY_EXT.has(extname(file))) {
      skippedBinary += 1;
      continue;
    }
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      continue;
    }
    if (buf.includes(0)) {
      skippedBinary += 1; // a NUL says binary, whatever the extension claims
      continue;
    }
    scanned += 1;
    if (buf.toString('utf8').includes(marker)) (file.endsWith('.map') ? mapHits : codeHits).push(file);
  }
  return { scanned, skippedBinary, codeHits, mapHits };
}

/**
 * The whole verdict, as a pure function so the self-test can pin every branch.
 * mode: 'present' (plant ablation) | 'absent' (delete ablation / restore leg).
 */
export function verdict({ mode, distExists, scanned, codeHits, mapHits }) {
  if (!distExists) {
    return { ok: false, msg: 'no dist/ in this package -- it has never been built in this tree, so the suite consumes nothing you edited. Build it, then re-run this pre-flight.' };
  }
  if (scanned === 0) {
    return { ok: false, msg: 'dist/ holds no readable text file -- refusing to call an empty scan a pass. Check the build actually produced output.' };
  }
  if (mode === 'present') {
    if (codeHits > 0) {
      const extra = mapHits > 0 ? ` (plus ${mapHits} sourcemap hit${mapHits === 1 ? '' : 's'}, not counted)` : '';
      return { ok: true, msg: `marker present in ${codeHits} built file${codeHits === 1 ? '' : 's'}${extra} -- the ablation is live in the artifact the suite consumes.` };
    }
    if (mapHits > 0) {
      return { ok: false, msg: `marker found ONLY in ${mapHits} sourcemap file${mapHits === 1 ? '' : 's'} and in no executable output -- a sourcemap hit proves a rebuild happened somewhere, not that the running code carries the mutation. Treat this run as void.` };
    }
    return { ok: false, msg: 'marker ABSENT from dist/ -- the suite would run the pre-mutation build and go GREEN on an ablation, certifying a test that may never be able to fail. Rebuild the package, then re-run this pre-flight.' };
  }
  if (codeHits > 0) {
    return { ok: false, msg: `marker still present in ${codeHits} built file${codeHits === 1 ? '' : 's'} -- dist/ still carries the code you expected to be gone, so the run would test the wrong tree (and every later run in this worktree with it). Rebuild the package, then re-run this pre-flight.` };
  }
  const extra = mapHits > 0 ? ` (${mapHits} stale sourcemap hit${mapHits === 1 ? '' : 's'} ignored -- sourcemaps do not execute)` : '';
  return { ok: true, msg: `marker absent from all ${scanned} built files${extra} -- the artifact the suite consumes no longer carries it.` };
}

function fail(msg) {
  console.error(`✗ ablation-dist-preflight: ${msg}`);
  process.exit(1);
}

function usage(msg) {
  console.error(`ablation-dist-preflight: ${msg}\n`);
  console.error('  node scripts/ablation-dist-preflight.mjs <package> <marker>            marker MUST be in dist/ (planted ablation)');
  console.error('  node scripts/ablation-dist-preflight.mjs <package> <marker> --absent   marker must be GONE (deleted guard / restore leg)');
  console.error('  node scripts/ablation-dist-preflight.mjs --self-test');
  process.exit(2);
}

function run(argv) {
  const mode = argv.includes('--absent') ? 'absent' : 'present';
  const positional = argv.filter((a) => !a.startsWith('--'));
  const [pkgArg, marker, ...rest] = positional;
  if (!pkgArg || !marker) usage('needs a package and a marker string.');
  if (rest.length > 0) usage(`unexpected extra argument "${rest[0]}" -- quote the marker if it contains spaces.`);
  if (marker.trim().length === 0) usage('the marker is blank -- a blank marker matches everything and proves nothing.');

  const byName = workspacePackages(REPO_ROOT);
  const { dir, name, near } = resolvePackageDir(pkgArg, byName);
  if (!dir) {
    const hint = near && near.length > 0 ? ` Did you mean: ${near.join(', ')}?` : '';
    fail(`no workspace package matches "${pkgArg}".${hint}`);
  }

  const distDir = join(dir, 'dist');
  const distExists = existsSync(distDir) && statSync(distDir).isDirectory();
  const scan = distExists ? scanDist(distDir, marker) : { scanned: 0, skippedBinary: 0, codeHits: [], mapHits: [] };
  const v = verdict({ mode, distExists, scanned: scan.scanned, codeHits: scan.codeHits.length, mapHits: scan.mapHits.length });

  const where = relative(REPO_ROOT, distDir);
  console.log(`ablation-dist-preflight: ${name} -- ${mode === 'present' ? 'expecting' : 'expecting NO'} "${marker}" in ${where}`);
  for (const f of scan.codeHits.slice(0, 5)) console.log(`  hit  ${relative(REPO_ROOT, f)}`);
  if (scan.codeHits.length > 5) console.log(`  hit  ... and ${scan.codeHits.length - 5} more`);
  for (const f of scan.mapHits.slice(0, 3)) console.log(`  map  ${relative(REPO_ROOT, f)} (sourcemap, not counted)`);
  if (!v.ok) {
    console.error(`✗ ${v.msg}`);
    console.error(`  rebuild: pnpm --filter ${name} build`);
    process.exit(1);
  }
  console.log(`✓ ${v.msg}`);
}

function selfTest() {
  const cases = [
    ['missing dist is red', { mode: 'present', distExists: false, scanned: 0, codeHits: 0, mapHits: 0 }, false],
    ['empty dist is red, not a skip', { mode: 'present', distExists: true, scanned: 0, codeHits: 0, mapHits: 0 }, false],
    ['planted marker in code is green', { mode: 'present', distExists: true, scanned: 9, codeHits: 1, mapHits: 0 }, true],
    ['planted marker in code + map is green', { mode: 'present', distExists: true, scanned: 9, codeHits: 1, mapHits: 1 }, true],
    ['sourcemap-only hit is RED', { mode: 'present', distExists: true, scanned: 9, codeHits: 0, mapHits: 2 }, false],
    ['no hit at all is red', { mode: 'present', distExists: true, scanned: 9, codeHits: 0, mapHits: 0 }, false],
    ['absent mode: gone is green', { mode: 'absent', distExists: true, scanned: 9, codeHits: 0, mapHits: 0 }, true],
    ['absent mode: stale sourcemap tolerated', { mode: 'absent', distExists: true, scanned: 9, codeHits: 0, mapHits: 1 }, true],
    ['absent mode: still in code is red', { mode: 'absent', distExists: true, scanned: 9, codeHits: 3, mapHits: 0 }, false],
    ['absent mode: missing dist still red', { mode: 'absent', distExists: false, scanned: 0, codeHits: 0, mapHits: 0 }, false],
  ];
  let failed = 0;
  for (const [label, input, expected] of cases) {
    const got = verdict(input).ok;
    if (got !== expected) {
      console.error(`  ✗ ${label}: expected ok=${expected}, got ok=${got}`);
      failed += 1;
    } else {
      console.log(`  ✓ ${label}`);
    }
  }

  // Filesystem leg: a real dist tree where the marker lives only in a sourcemap
  // is the trap the pure table above cannot exercise.
  const tmp = mkdtempSync(join(tmpdir(), 'ablation-preflight-'));
  try {
    const dist = join(tmp, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.js'), 'export const guard = () => "OS_ABLATION_TOKEN";\n');
    writeFileSync(join(dist, 'other.js'), 'export const x = 1;\n');
    writeFileSync(join(dist, 'other.js.map'), '{"sources":["OS_ONLY_IN_MAP"]}\n');
    const planted = scanDist(dist, 'OS_ABLATION_TOKEN');
    const mapOnly = scanDist(dist, 'OS_ONLY_IN_MAP');
    const checks = [
      ['scan finds the planted token in code', planted.codeHits.length === 1 && planted.mapHits.length === 0],
      ['scan classifies a map-only token as a map hit', mapOnly.codeHits.length === 0 && mapOnly.mapHits.length === 1],
      ['map-only scan is judged RED', verdict({ mode: 'present', distExists: true, scanned: mapOnly.scanned, codeHits: 0, mapHits: mapOnly.mapHits.length }).ok === false],
    ];
    for (const [label, ok] of checks) {
      if (ok) console.log(`  ✓ ${label}`);
      else {
        console.error(`  ✗ ${label}`);
        failed += 1;
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failed > 0) {
    console.error(`✗ ablation-dist-preflight self-test: ${failed} case(s) failed.`);
    process.exit(1);
  }
  console.log('✓ ablation-dist-preflight self-test: all cases pass.');
}

const argv = process.argv.slice(2);
// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (argv.includes('--self-test')) selfTest();
else run(argv);
