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
// ## The mutation is TWO files whenever the package's build writes committed artifacts
//
// `dist/` is not the only thing a build writes. A package whose build runs a
// generator also writes CHECKED-IN artifacts, and those land in the working
// tree rather than in an ignored output directory. So an ablation on such a
// package is a TWO-FILE mutation, and only one of the two is the file the agent
// chose:
//
//   mutated  packages/spec/src/data/field.zod.ts        <- chosen, restored
//   written  packages/spec/authorable-surface/data.json <- committed, tracked, LEFT
//
// The restore leg then goes wrong in a way every per-path proof calls clean.
// Measured: a plant ablation restored with `git checkout HEAD -- <mutated path>`
// left `packages/spec/authorable-surface/data.json | 1 +` behind -- a PHANTOM
// authorable key in a committed contract baseline. On that tree
//
//   git diff HEAD -- <the mutated path>   empty
//   git hash-object <the mutated path>    == its HEAD blob
//   grep <marker> <the mutated path>      0
//
// ALL THREE PASS. The silence is directional, which is why a STRICTER per-path
// proof cannot close it and only a whole-tree read can. What followed was a
// rebuild refusing with the ADR-0049 enforce-or-remove prescription -- every
// word of it correct, about a key that never existed: a FALSE RED, costing
// rounds. Skip that rebuild instead and the suite runs against a `dist/` that
// still carries the ablation: the false GREEN this whole script exists to stop,
// arriving through the restore leg. And in either case `git add -A` at that
// moment COMMITS the phantom, so the next unrelated PR reds on a contract
// baseline someone else corrupted by following the procedure correctly.
//
// So both modes also read `git status --porcelain` over the WHOLE tree.
// Deliberately whole-tree and not a list of known-dirty paths: `packages/spec`
// is the INSTANCE (`gen:schema` writes `authorable-surface/`,
// `json-schema.manifest/` and `api-surface/`), not the class, and a fix
// enumerating those three leaves every other generated-artifact package with
// the same hole.
//
// ### Which leg you are on is DERIVED from the marker, not declared
//
// A dirty tree is CORRECT on a mutate leg and WRONG on a restore leg, and the
// two share a command line: `--absent` is both the delete-ablation mutate leg
// and the plant-ablation restore leg (see the two-shapes section above). Rather
// than grow a flag -- which would strand the three documents that state this
// script's invocation, two of them governed surfaces no code PR may edit -- the
// leg is read off the marker, per dirty path, against HEAD:
//
//   present mode   a dirty path that GAINED the marker is the plant     -> MUTATE leg
//   absent  mode   a dirty path that LOST the marker is the deleted guard -> MUTATE leg
//   neither, on any dirty path                                          -> RESTORE leg
//
// On a MUTATE leg every other dirty path is REPORTED and never fatal: the build
// was supposed to write them, and that is the earliest moment the restore leg's
// true size can be known -- it is two files, and here they are. On a RESTORE
// leg the tree must be clean, and every dirty path is FATAL and named. That is
// the assertion which recovered the measured run, now delivered in the gate
// refusal's place instead of after it.
//
// Untracked paths count as dirty. A sharded artifact gains FILES and not only
// lines, and `git add -A` commits an untracked one exactly like a modified one.
// A scratch file of your own trips this too, by design: at the restore leg the
// honest statement is "this tree is not the tree you think you are measuring",
// and the remedy (move it out, or restore it) is one line either way.
//
// Reading the tree is not optional and not skippable: a `git status` that
// cannot be read is RED, like every other thing this script cannot see.
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
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isEntrypoint } from './invoked-as.mjs';
import { WORKSPACE_FILE, parseWorkspaceGlobs, workspacePackageDirs } from './workspace-enumerator.mjs';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Read as text, but never let a binary artifact fabricate a match.
const BINARY_EXT = new Set(['.wasm', '.node', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.zip', '.gz', '.br']);

/**
 * Parse the `packages:` globs out of pnpm-workspace.yaml (no YAML dependency).
 *
 * Re-exported from `scripts/workspace-enumerator.mjs` (#11510) rather than
 * parsed here. The copy this replaces was the strictest of the nine and the
 * only one that ended the list at ANY line it could not match, so a whole-line
 * comment inside the `packages:` block silently truncated the workspace — this
 * script would then have scanned a subset of the members and reported a clean
 * preflight over it. Latent on this repo's file today; a comment in that block
 * is all it needed.
 */
export { parseWorkspaceGlobs };

/** name -> repo-relative dir, for every workspace package. */
function workspacePackages(repoRoot) {
  let dirs;
  try {
    dirs = workspacePackageDirs(repoRoot).map((rel) => join(repoRoot, rel));
  } catch (err) {
    fail(
      `cannot enumerate the workspace from ${WORKSPACE_FILE} -- refusing to guess the layout.\n  ${err?.message ?? err}`,
    );
  }
  if (dirs.length === 0) fail(`${WORKSPACE_FILE} declares no \`packages:\` globs -- refusing to scan an empty workspace.`);

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

// ---------------------------------------------------------------------------
// Whole-tree accounting -- see "The mutation is TWO files" in the header.
// ---------------------------------------------------------------------------

// The record separator of `git status -z`. Built with `fromCharCode` rather
// than written as a string literal: `check:nul-bytes` and this repo's byte
// discipline both refuse a raw NUL in a tracked file, and an escape spelling
// inside a literal is one careless editor round-trip away from becoming one.
const NUL = String.fromCharCode(0);

/**
 * Parse `git status --porcelain -z` output into entries.
 *
 * `-z` rather than the line form on purpose: the line form QUOTES and escapes
 * any path holding a space or a non-ASCII byte, so a leaked artifact under such
 * a path would be reported under a name that does not exist on disk and
 * `git show HEAD:<it>` would fail -- read as "not at HEAD", i.e. silently
 * mis-classified. With `-z` each record is `XY<space><path>`, and a rename or
 * copy record is FOLLOWED by a second record holding the origin path, which is
 * consumed rather than mistaken for an entry of its own.
 */
export function parsePorcelainZ(out) {
  const records = out.split(NUL).filter((r) => r.length > 0);
  const entries = [];
  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    if (rec.length < 4) continue; // 'XY path' is four characters at minimum
    const xy = rec.slice(0, 2);
    const path = rec.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i += 1; // consume the origin record
    entries.push({ xy, path, untracked: xy === '??' });
  }
  return entries;
}

/**
 * Which leg this run is on, and which dirty paths the ablation accounts for.
 *
 * `files`: [{ path, xy, untracked, headHas, treeHas }] -- `headHas`/`treeHas`
 * say whether the marker occurs in that path's HEAD blob / working copy.
 *
 * The marker moving in the direction the MODE implies is what identifies the
 * file the agent chose to mutate. Anything else dirty was written by something
 * the agent did not choose -- which on a restore leg is the entire finding.
 */
export function classifyTree({ mode, files }) {
  const explains = (f) => (mode === 'present' ? f.treeHas && !f.headHas : f.headHas && !f.treeHas);
  const mutated = files.filter(explains);
  const unaccounted = files.filter((f) => !explains(f));
  return { leg: mutated.length > 0 ? 'mutate' : 'restore', mutated, unaccounted };
}

/**
 * The whole-tree verdict, pure so the self-test can pin every branch.
 *
 * Fatal ONLY on a restore leg. A mutate leg's tree is dirty by construction, so
 * refusing there would void a legitimate step; naming what the build wrote is
 * the useful act at that moment instead.
 */
export function treeVerdict({ mode, gitReadable, gitError, files }) {
  if (!gitReadable) {
    return {
      ok: false,
      leg: null,
      paths: [],
      msg:
        `cannot read \`git status\` for this tree${gitError ? ` (${gitError})` : ''} -- refusing to certify a restore `
        + 'it never looked at. An ablation leaves a SECOND, committed mutation behind whenever the package it '
        + 'mutates has a build that writes checked-in artifacts, and this is the only check here that can see it.',
    };
  }
  const { leg, mutated, unaccounted } = classifyTree({ mode, files });
  if (files.length === 0) {
    return {
      ok: true,
      leg: 'restore',
      paths: [],
      msg: 'working tree clean against HEAD -- nothing of this ablation is recorded outside dist/.',
    };
  }
  if (leg === 'mutate') {
    const n = files.length;
    return {
      ok: true,
      leg,
      paths: files.map((f) => f.path),
      msg:
        `mutate leg: ${n} path${n === 1 ? '' : 's'} differ${n === 1 ? 's' : ''} from HEAD, of which `
        + `${mutated.length} carr${mutated.length === 1 ? 'ies' : 'y'} the marker. Your restore leg has to put ALL of `
        + 'them back, not only the source you chose: a build that writes checked-in artifacts makes this a TWO-FILE '
        + 'mutation, and restoring only the source leaves the ablation recorded in the tree, where the next build '
        + 'reads it as a real change and `git add -A` commits it. Prove the restore with a WHOLE-TREE '
        + '`git status --porcelain`, never a per-path diff -- a per-path diff is clean on exactly the tree that is '
        + 'still mutated.',
    };
  }
  const n = unaccounted.length;
  return {
    ok: false,
    leg,
    paths: unaccounted.map((f) => f.path),
    msg:
      `restore leg: no dirty path carries the marker, so the source you mutated is back -- but ${n} path`
      + `${n === 1 ? ' still differs' : 's still differ'} from HEAD, so the TREE is not restored. Two ways to get here, `
      + 'both fatal to the next measurement: the leg\'s build wrote a CHECKED-IN artifact (the ablation is still '
      + 'recorded there, the next build reads it as a real change, and `git add -A` commits the phantom into a '
      + 'committed baseline); or work of your own was never committed, which the ablation discipline requires before '
      + 'mutating precisely so that HEAD is a restore point. Read the paths below and treat them as the restore leg.',
  };
}

/** `git status --porcelain -z` over the whole worktree. Impure; the verdict lives above. */
function readTreeStatus(repoRoot) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { gitReadable: true, entries: parsePorcelainZ(out) };
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err).trim().split('\n')[0];
    return { gitReadable: false, gitError: detail, entries: [] };
  }
}

/** Does `marker` occur in this path's working copy / HEAD blob? Binary and missing both read `false`. */
function markerPresence(repoRoot, entries, marker) {
  const hasMarker = (buf) => buf != null && !buf.includes(0) && buf.toString('utf8').includes(marker);
  return entries.map((e) => {
    let tree = null;
    try {
      tree = readFileSync(join(repoRoot, e.path));
    } catch {
      tree = null; // deleted in the worktree, or unreadable
    }
    let head = null;
    try {
      head = execFileSync('git', ['show', `HEAD:${e.path}`], {
        cwd: repoRoot,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      head = null; // not present at HEAD (added / untracked), or unreadable
    }
    return { ...e, treeHas: hasMarker(tree), headHas: hasMarker(head) };
  });
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
  if (v.ok) {
    console.log(`✓ dist/: ${v.msg}`);
  } else {
    console.error(`✗ dist/: ${v.msg}`);
    console.error(`  rebuild: pnpm --filter ${name} build`);
  }

  // The second half of the same question: `dist/` is not the only thing the
  // build wrote. Both verdicts are computed and printed before either exits,
  // deliberately -- in the measured incident BOTH were true at once ("marker
  // still present in 26 built files" AND a leaked committed baseline), and
  // reporting only the first sends the agent into a rebuild loop against a
  // build that is refusing precisely because of the second.
  const status = readTreeStatus(REPO_ROOT);
  const files = status.gitReadable ? markerPresence(REPO_ROOT, status.entries, marker) : [];
  const tv = treeVerdict({ mode, gitReadable: status.gitReadable, gitError: status.gitError, files });
  const say = (s) => (tv.ok ? console.log(s) : console.error(s));
  say(`${tv.ok ? (tv.paths.length > 0 ? '⚠' : '✓') : '✗'} tree: ${tv.msg}`);
  for (const p of tv.paths.slice(0, 20)) say(`  dirty  ${p}`);
  if (tv.paths.length > 20) say(`  dirty  ... and ${tv.paths.length - 20} more`);
  if (tv.paths.length > 0) {
    say(`  restore: git checkout HEAD -- ${tv.paths.slice(0, 3).join(' ')}${tv.paths.length > 3 ? ' <...>' : ''}`);
    say('           (an untracked path has nothing at HEAD -- delete it or move it out of the repo)');
  }

  if (!v.ok || !tv.ok) process.exit(1);
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

  // ---- whole-tree accounting: the pure table -------------------------------
  const f = (path, headHas, treeHas, untracked = false) => ({ path, xy: untracked ? '??' : ' M', untracked, headHas, treeHas });
  const treeCases = [
    ['unreadable git is RED, never a skip', { mode: 'absent', gitReadable: false, gitError: 'not a git repository', files: [] }, false, null],
    ['clean tree is green (present)', { mode: 'present', gitReadable: true, files: [] }, true, 'restore'],
    ['clean tree is green (absent)', { mode: 'absent', gitReadable: true, files: [] }, true, 'restore'],
    // present mode: the plant is the path that GAINED the marker.
    ['present: planted source alone -> mutate leg, green', { mode: 'present', gitReadable: true, files: [f('src/a.ts', false, true)] }, true, 'mutate'],
    ['present: plant + leaked artifact -> mutate leg, green but both listed', { mode: 'present', gitReadable: true, files: [f('src/a.ts', false, true), f('gen/base.json', false, false)] }, true, 'mutate'],
    // The measured incident: restore leg, only the build-written artifact left.
    ['absent: leaked artifact after restore -> RESTORE leg, RED', { mode: 'absent', gitReadable: true, files: [f('gen/base.json', false, true)] }, false, 'restore'],
    ['present: leaked artifact after a delete-ablation restore -> RESTORE leg, RED', { mode: 'present', gitReadable: true, files: [f('gen/base.json', true, true)] }, false, 'restore'],
    // absent mode is ALSO a delete-ablation's mutate leg: the guard's literal left the tree.
    ['absent: deleted guard -> mutate leg, green', { mode: 'absent', gitReadable: true, files: [f('src/a.ts', true, false)] }, true, 'mutate'],
    ['absent: deleted guard + leaked artifact -> mutate leg, green', { mode: 'absent', gitReadable: true, files: [f('src/a.ts', true, false), f('gen/base.json', false, false)] }, true, 'mutate'],
    // An untracked path is dirty too -- a sharded artifact gains FILES, and `git add -A` takes them.
    ['absent: untracked path at the restore leg is RED', { mode: 'absent', gitReadable: true, files: [f('gen/new-shard.json', false, false, true)] }, false, 'restore'],
    // A marker present on BOTH sides never identifies a mutation in either mode.
    ['absent: marker on both sides does not explain the dirt', { mode: 'absent', gitReadable: true, files: [f('gen/base.json', true, true)] }, false, 'restore'],
    ['present: marker on neither side does not explain the dirt', { mode: 'present', gitReadable: true, files: [f('gen/base.json', false, false)] }, false, 'restore'],
  ];
  for (const [label, input, expectedOk, expectedLeg] of treeCases) {
    const got = treeVerdict(input);
    if (got.ok !== expectedOk || got.leg !== expectedLeg) {
      console.error(`  ✗ ${label}: expected ok=${expectedOk} leg=${expectedLeg}, got ok=${got.ok} leg=${got.leg}`);
      failed += 1;
    } else {
      console.log(`  ✓ ${label}`);
    }
  }

  // A red restore leg must NAME the leaked path -- a refusal that does not say
  // which file is still mutated sends the agent back to the per-path diff that
  // is clean on exactly this tree.
  {
    const red = treeVerdict({ mode: 'absent', gitReadable: true, files: [f('packages/spec/authorable-surface/data.json', false, true)] });
    const named = red.paths.includes('packages/spec/authorable-surface/data.json');
    if (named) console.log('  ✓ a red restore leg names the leaked path');
    else {
      console.error('  ✗ a red restore leg names the leaked path');
      failed += 1;
    }
  }

  // ---- porcelain parsing ---------------------------------------------------
  {
    const Z = String.fromCharCode(0);
    const parsed = parsePorcelainZ([' M packages/spec/authorable-surface/data.json', '?? scratch note.txt', 'R  new/name.ts', 'old/name.ts', ''].join(Z));
    const checks = [
      ['parses a modified path', parsed[0]?.path === 'packages/spec/authorable-surface/data.json' && parsed[0]?.untracked === false],
      ['parses an untracked path holding a space, unquoted', parsed[1]?.path === 'scratch note.txt' && parsed[1]?.untracked === true],
      ['consumes a rename origin record instead of listing it', parsed.length === 3 && parsed[2]?.path === 'new/name.ts'],
    ];
    for (const [label, ok] of checks) {
      if (ok) console.log(`  ✓ ${label}`);
      else {
        console.error(`  ✗ ${label}`);
        failed += 1;
      }
    }
  }

  // ---- whole-tree accounting: a real git tree -------------------------------
  // The pure table cannot catch a broken `git status` read or a broken
  // HEAD-vs-worktree marker probe, and those are the wires that make the
  // verdict mean anything. This leg replays the measured incident end to end.
  const repo = mkdtempSync(join(tmpdir(), 'ablation-preflight-git-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    const srcPath = join(repo, 'source.ts');
    const genPath = join(repo, 'generated-baseline.json');
    const MARK = 'OS_ABLATION_LEAK_MARK';
    const GUARD = 'OS_GUARD_LITERAL';

    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'selftest@objectstack.invalid');
    git('config', 'user.name', 'ablation selftest');
    writeFileSync(srcPath, `export const guard = "${GUARD}";\n`);
    writeFileSync(genPath, '{"keys":["a"]}\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');

    const legFor = (mode) => {
      const st = readTreeStatus(repo);
      const files = st.gitReadable ? markerPresence(repo, st.entries, mode === 'present' ? MARK : GUARD) : [];
      return treeVerdict({ mode, gitReadable: st.gitReadable, gitError: st.gitError, files });
    };

    // 1. plant ablation, mutate leg: the source gains the marker and the
    //    "build" writes the marker into the committed baseline as well.
    writeFileSync(srcPath, `export const guard = "${GUARD}";\nexport const planted = "${MARK}";\n`);
    writeFileSync(genPath, `{"keys":["a","${MARK}"]}\n`);
    const mutateLeg = legFor('present');

    // 2. restore ONLY the mutated source -- exactly what the discipline says,
    //    and exactly what left a phantom key in a committed contract baseline.
    git('checkout', 'HEAD', '--', 'source.ts');
    const restoreLeg = legFor('absent');
    // The per-path proof the discipline prescribes, read at the moment it is
    // used: it is EMPTY on this tree, which is why it cannot close the hole.
    const perPathDiffAtRestore = git('diff', 'HEAD', '--', 'source.ts').trim();

    // 3. restore the leaked artifact too.
    git('checkout', 'HEAD', '--', 'generated-baseline.json');
    const cleanLeg = legFor('absent');

    // 4. delete ablation, mutate leg: the guard literal leaves the tree.
    writeFileSync(srcPath, 'export const guard = "";\n');
    const deleteLeg = legFor('absent');
    git('checkout', 'HEAD', '--', 'source.ts');

    // 5. an untracked scratch file is dirt too.
    writeFileSync(join(repo, 'scratch.txt'), 'notes\n');
    const untrackedLeg = legFor('absent');

    const gitChecks = [
      ['git leg: mutate leg is green and lists BOTH files', mutateLeg.ok === true && mutateLeg.leg === 'mutate' && mutateLeg.paths.length === 2],
      ['git leg: per-path restore leaves the tree RED', restoreLeg.ok === false && restoreLeg.leg === 'restore'],
      ['git leg: the RED names the leaked baseline', restoreLeg.paths.includes('generated-baseline.json')],
      ['git leg: the per-path diff is EMPTY on that same unrestored tree', perPathDiffAtRestore === ''],
      ['git leg: whole-tree restore is green', cleanLeg.ok === true && cleanLeg.paths.length === 0],
      ['git leg: a deleted guard is a mutate leg, not a restore leg', deleteLeg.ok === true && deleteLeg.leg === 'mutate'],
      ['git leg: an untracked path reds the restore leg', untrackedLeg.ok === false && untrackedLeg.paths.includes('scratch.txt')],
    ];
    for (const [label, ok] of gitChecks) {
      if (ok) console.log(`  ✓ ${label}`);
      else {
        console.error(`  ✗ ${label}`);
        failed += 1;
      }
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
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
