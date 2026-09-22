#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ablation-dist-preflight -- prove an ablation actually reached the BUILT
// artifact before the ablation run's colour is allowed to mean anything.
//
//   node scripts/ablation-dist-preflight.mjs <package> <marker>
//   node scripts/ablation-dist-preflight.mjs <package> <marker> --absent
//   node scripts/ablation-dist-preflight.mjs <package> <marker> --absent --source-marker=<source spelling>
//   node scripts/ablation-dist-preflight.mjs --self-test
//
// Exit codes, one per question (see "Two questions, two readings" below):
//   0 both readings pass   1 the dist/ reading failed   2 usage
//   3 the tree reading failed   4 both failed
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
// ## Two questions, two readings -- and they do NOT share a marker
//
// This script answers two independent questions, and the measured defect was
// that it answered them with ONE marker and ONE exit code:
//
//   dist  reading   is the mutation in / out of the BUILT artifact?
//   tree  reading   is the WORKING TREE in the state this leg requires?
//
// The two read different artifacts, and a bundler re-spells literals on its way
// from one to the other. `tsup` emits double quotes for the source's single
// quotes and drops the space after a colon, so the source's `label: 'Operator'`
// reaches `dist/` as `label:"Operator"`. One string cannot be both.
//
// Measured, on a DELETE ablation that dropped a form label (a package whose src
// spells it with single quotes, whose dist emits double):
//
//   marker spelled as DIST emits it      dist reading GREEN (the true answer),
//                                        tree reading RED -- "restore leg: 1
//                                        path still differs from HEAD", telling
//                                        the author to restore the very mutation
//                                        being measured. exit 1.
//   marker spelled as SOURCE spells it   tree reading GREEN (mutate leg found),
//                                        dist reading GREEN **VACUOUSLY** -- that
//                                        spelling was never in dist/ at all, so
//                                        the pass proves nothing. exit 0.
//
// So the two readings demanded MUTUALLY EXCLUSIVE spellings, and the only
// invocation that satisfied both limbs at once was the one that proved nothing.
// The first shape refuses a correct ablation; the second certifies a vacuous
// one -- the false green this whole script exists to stop, arriving through the
// argument list.
//
// The fix is to stop making one string do two jobs. `--source-marker=<text>`
// names the spelling the SOURCE carries; the tree reading probes with it and the
// dist reading never sees it. Omit it and the tree reading falls back to the
// positional marker, which is correct whenever the build does not re-spell.
//
// ### Which leg you are on is DERIVED from evidence, and "cannot tell" is its own answer
//
// A dirty tree is CORRECT on a mutate leg and WRONG on a restore leg, and the
// two share a command line: `--absent` is both the delete-ablation mutate leg
// and the plant-ablation restore leg (see the two-shapes section above). The leg
// is read off the marker, per dirty path, against HEAD -- evidence, never a
// declaration. A `--leg=` flag was considered and rejected: the script cannot
// check a claim, and a mistaken `--leg=mutate` at a real restore leg would
// switch off the leaked-artifact catch below, which is the one thing here that
// has already recovered a measured run.
//
//   present mode   a dirty path that GAINED the marker is the plant     -> MUTATE leg
//   absent  mode   a dirty path that LOST the marker is the deleted guard -> MUTATE leg
//   the tree is CLEAN                                                   -> RESTORE leg, satisfied
//   dirty, and no dirty path moves the marker either way                -> INDETERMINATE
//
// That fourth row used to be spelled RESTORE, and that collapse WAS the defect:
// one leg value answering two different questions, "you are restoring" and "I
// cannot tell which leg you are on". The failure of an inference is not a
// finding, and reporting it as one is how a correct mutate leg got told to
// restore itself. INDETERMINATE is RED -- refusing is the safe direction, and
// the message carries BOTH readings with the exact remedy for each, because from
// here the two are genuinely indistinguishable.
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
// ## The presence pre-condition: where it is sound, and where it is NOT
//
// `--absent` cannot, on its own, tell "the marker was removed" from "the marker
// was never spelled that way here" -- the vacuous green above. The reason is not
// an oversight, it is the clock: `--absent` runs AFTER the rebuild, and the
// pre-mutation `dist/` no longer exists, so nothing readable at that moment
// witnesses that the marker was ever in the artifact. A check bolted on here
// would have to use a surviving proxy, and the only one is the SOURCE -- whose
// spelling is, by the trap above, exactly the one that differs. It would fire on
// the CORRECT invocation.
//
// So no dist-domain presence check is added. The presence pre-condition is paid
// in the domain where a witness does survive: with `--source-marker`, a DELETE
// ablation's mutate leg is green only when a tracked path HAD that literal at
// HEAD and LOST it. That is evidence the construct existed and left, and it runs
// alongside a dist reading taken in the emitted spelling -- so neither limb is
// vacuous, which is precisely what the measured first attempt lacked.
//
// The dist-domain half is a reading, not a check, and it is taken one step
// EARLIER: run this script in default (present) mode on the PRISTINE build,
// before mutating, and the marker's presence in `dist/` is measured while the
// evidence is still there. Every `--absent` pass therefore prints what it did
// not prove, so exit 0 is never read as more than it is.
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
import { gitFreeEnv } from './git-env.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { WORKSPACE_FILE, parseWorkspaceGlobs, workspacePackageDirs } from './workspace-enumerator.mjs';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Read as text, but never let a binary artifact fabricate a match.
const BINARY_EXT = new Set(['.wasm', '.node', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.zip', '.gz', '.br']);

// ---------------------------------------------------------------------------
// Exit codes -- ONE PER QUESTION. A driver reads `status`, so the dist reading
// and the tree reading must not share a code: when they did, a correct DELETE
// ablation's mutate leg and a genuinely unrestored tree were the same exit 1,
// and a driver that trusted it aborted the correct one.
// ---------------------------------------------------------------------------
export const EXIT_OK = 0;
export const EXIT_DIST = 1; // the dist/ reading failed -- and every "cannot see" refusal
export const EXIT_USAGE = 2;
export const EXIT_TREE = 3; // the tree reading failed; the dist/ reading passed
export const EXIT_BOTH = 4;

/**
 * Which spelling the TREE reading probes. The dist reading always uses the
 * positional marker; this is the ONLY place the two are allowed to diverge, so
 * it is a named function and not an inline fallback -- inline, the wiring is
 * invisible to the self-test, and the wiring is exactly what the split is.
 *
 * Nullish coalescing, never `||`: an empty source marker must stay empty and be
 * refused upstream, not silently fall back to the emitted spelling, which is the
 * defect this whole split exists to remove.
 */
export function treeReadingMarker({ marker, sourceMarker }) {
  return sourceMarker ?? marker;
}

/** The one place the two readings are combined into a status. */
export function exitCodeFor({ distOk, treeOk }) {
  if (distOk && treeOk) return EXIT_OK;
  if (!distOk && !treeOk) return EXIT_BOTH;
  return distOk ? EXIT_TREE : EXIT_DIST;
}

// ---------------------------------------------------------------------------
// Argv -- the correct invocation is the ONLY invocation.
//
// `argv.includes('--absent')` plus `argv.filter((a) => !a.startsWith('--'))`
// discarded every unrecognised flag in silence, so a typo'd `--absnet` ran the
// OPPOSITE mode and printed a verdict that reads exactly like a real one. An
// unknown option is now a usage refusal, and `--source-marker` has exactly one
// spelling: written with a space its value would land in the marker position.
// ---------------------------------------------------------------------------
const SOURCE_MARKER_FLAG = '--source-marker';
const KNOWN_FLAGS = new Set(['--absent', '--self-test']);

/**
 * Parse argv into `{ mode, pkgArg, marker, sourceMarker }`, or `{ usage }`.
 * Pure, so the self-test can pin every refusal without spawning a process.
 */
export function parseArgs(argv) {
  const positional = [];
  let mode = 'present';
  let sourceMarker = null;
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (KNOWN_FLAGS.has(arg)) {
      if (arg === '--absent') mode = 'absent';
      continue;
    }
    if (arg === SOURCE_MARKER_FLAG) {
      return {
        usage:
          `\`${SOURCE_MARKER_FLAG}\` takes its value joined with "=" and in no other spelling: `
          + `\`${SOURCE_MARKER_FLAG}=<the spelling the SOURCE carries>\`. Written with a space the value lands in `
          + 'the marker position instead, and this run would measure the wrong string in both readings.',
      };
    }
    if (arg.startsWith(`${SOURCE_MARKER_FLAG}=`)) {
      sourceMarker = arg.slice(SOURCE_MARKER_FLAG.length + 1);
      if (sourceMarker.trim().length === 0) {
        return {
          usage:
            `\`${SOURCE_MARKER_FLAG}=\` is blank -- a blank marker matches every file, so the tree reading would `
            + 'call the first dirty path your mutation. Give it the spelling the source carries, or drop the flag.',
        };
      }
      continue;
    }
    return {
      usage:
        `unknown option "${arg}". The options are --absent, ${SOURCE_MARKER_FLAG}=<text> and --self-test, and `
        + 'there are no others: an unrecognised flag used to be discarded in silence, so a mistyped "--absnet" ran '
        + `the OPPOSITE mode and its verdict read like a real one. If "${arg}" is your marker, pass it after the `
        + 'package name.',
    };
  }
  const [pkgArg, marker, ...rest] = positional;
  if (!pkgArg || !marker) return { usage: 'needs a package and a marker string.' };
  if (rest.length > 0) return { usage: `unexpected extra argument "${rest[0]}" -- quote the marker if it contains spaces.` };
  if (marker.trim().length === 0) return { usage: 'the marker is blank -- a blank marker matches everything and proves nothing.' };
  return { mode, pkgArg, marker, sourceMarker };
}

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
  // What this line does NOT say, and what a reader will supply for it if it is
  // not said here: that the marker was ever IN dist/. A spelling this build
  // never emits prints these exact words. The reading that settles it cannot be
  // taken from here -- the pre-mutation artifact is gone by now -- so it is
  // named instead of faked.
  return {
    ok: true,
    msg:
      `marker absent from all ${scanned} built files${extra} -- the artifact the suite consumes no longer `
      + 'carries it. NOT proved by this line: that the marker was ever IN dist/ -- a spelling this build never '
      + 'emits prints the same words. That reading is this script in default mode on the PRISTINE build, taken '
      + 'BEFORE the mutation.',
  };
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
  // Three legs, because there are three states. 'restore' is asserted only on a
  // CLEAN tree; dirt this marker cannot explain is INDETERMINATE, never
  // 'restore'. Collapsing those two was the defect: the failure of an inference
  // is not a finding, and reported as one it told a correct DELETE mutate leg to
  // restore the very mutation it was measuring.
  let leg;
  if (mutated.length > 0) leg = 'mutate';
  else if (files.length === 0) leg = 'restore';
  else leg = 'indeterminate';
  return { leg, mutated, unaccounted };
}

/**
 * The whole-tree verdict, pure so the self-test can pin every branch.
 *
 * Never fatal on a mutate leg: that tree is dirty by construction, so refusing
 * there would void a legitimate step; naming what the build wrote is the useful
 * act at that moment instead. Fatal on a restore leg that is not restored, and
 * fatal when the leg cannot be determined at all -- refusing is the safe
 * direction, and the refusal carries both readings rather than picking one.
 *
 * `sourceMarker` is the spelling the tree reading was probed with when it came
 * from `--source-marker`; it changes only the wording of the indeterminate
 * refusal, which is a different sentence once the author has already named it.
 */
export function treeVerdict({ mode, gitReadable, gitError, files, sourceMarker = null }) {
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
  if (leg === 'restore') {
    return {
      ok: true,
      leg,
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
  const moved = mode === 'present' ? 'GAINED' : 'LOST';
  const secondReading = sourceMarker !== null
    ? `(2) MUTATE leg, and the \`--source-marker\` you named (${JSON.stringify(sourceMarker)}) is not the spelling `
      + `that moved -- no dirty path ${moved} it. Correct that spelling, or the mutation is not in the file you `
      + 'think it is.'
    : '(2) MUTATE leg of a DELETE ablation, measured with the spelling `dist/` carries while the SOURCE spells it '
      + "differently -- `tsup` emits double quotes for the source's single ones and drops the space after a colon. "
      + 'Re-run with `--source-marker=<the spelling in the source>`; the positional marker keeps the emitted '
      + 'spelling, so the dist reading stays exact.';
  return {
    ok: false,
    leg,
    paths: unaccounted.map((f) => f.path),
    msg:
      `cannot tell which leg this is: ${n} path${n === 1 ? ' differs' : 's differ'} from HEAD and none of them `
      + `${moved} the marker this reading probed, so the mutation is not visible in the tree. Two readings are live `
      + "and this script will not guess between them. (1) RESTORE leg, and the tree is NOT restored: the leg's "
      + 'build wrote a CHECKED-IN artifact, or work of your own was never committed -- either way the ablation is '
      + 'still recorded in the paths below, the next build reads it as a real change, and `git add -A` commits the '
      + `phantom into a committed baseline. Restore them. ${secondReading} Refusing is deliberate: guessing here is `
      + 'how a correct mutate leg was told to restore the very mutation it was measuring.',
  };
}

/** `git status --porcelain -z` over the whole worktree. Impure; the verdict lives above. */
function readTreeStatus(repoRoot) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '-z'], {
      cwd: repoRoot,
      // The tree under test is the one `repoRoot` names and nothing else (#16644).
      // An inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE outranks `cwd`, so under a
      // hook this would certify SOME OTHER tree as restored -- the one direction this
      // preflight exists to make impossible.
      env: gitFreeEnv(),
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
        env: gitFreeEnv(), // #16644: the HEAD blob of THIS tree, never a hook's

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
  console.error('  node scripts/ablation-dist-preflight.mjs <package> <marker> --absent --source-marker=<source spelling>');
  console.error('        when the build re-spells the literal: <marker> is what dist/ EMITS, --source-marker what the SOURCE carries.');
  console.error('        One string cannot be both, and the two readings below are probed with one each.');
  console.error('  node scripts/ablation-dist-preflight.mjs --self-test');
  console.error('\n  exit 0 both readings pass | 1 the dist/ reading failed | 2 usage | 3 the tree reading failed | 4 both');
  process.exit(EXIT_USAGE);
}

function run(argv) {
  const parsed = parseArgs(argv);
  if (parsed.usage) usage(parsed.usage);
  const { mode, pkgArg, marker, sourceMarker } = parsed;

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
  // JSON.stringify, not bare quotes: a marker that itself carries a quote --
  // which is the whole subject of the source/emitted split -- printed inside
  // bare quotes reads as a different string than the one that was measured.
  console.log(`ablation-dist-preflight: ${name} -- ${mode === 'present' ? 'expecting' : 'expecting NO'} ${JSON.stringify(marker)} in ${where}`);
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
  //
  // It is also the OTHER question, and it is probed with the OTHER spelling:
  // `dist/` holds what the bundler emitted, the tree holds what the author
  // wrote. `--source-marker` is how they are told apart; without it the tree
  // reading falls back to the positional marker, which is correct exactly when
  // the build does not re-spell the literal.
  const treeMarker = treeReadingMarker({ marker, sourceMarker });
  if (sourceMarker !== null) {
    console.log(`  tree reading probes the SOURCE spelling ${JSON.stringify(sourceMarker)} (--source-marker)`);
  }
  const status = readTreeStatus(REPO_ROOT);
  const files = status.gitReadable ? markerPresence(REPO_ROOT, status.entries, treeMarker) : [];
  const tv = treeVerdict({ mode, gitReadable: status.gitReadable, gitError: status.gitError, files, sourceMarker });
  const say = (s) => (tv.ok ? console.log(s) : console.error(s));
  say(`${tv.ok ? (tv.paths.length > 0 ? '⚠' : '✓') : '✗'} tree: ${tv.msg}`);
  for (const p of tv.paths.slice(0, 20)) say(`  dirty  ${p}`);
  if (tv.paths.length > 20) say(`  dirty  ... and ${tv.paths.length - 20} more`);
  if (tv.paths.length > 0) {
    const when = tv.leg === 'mutate' ? 'restore leg, when you get there' : 'restore';
    say(`  ${when}: git checkout HEAD -- ${tv.paths.slice(0, 3).join(' ')}${tv.paths.length > 3 ? ' <...>' : ''}`);
    say('           (an untracked path has nothing at HEAD -- delete it or move it out of the repo)');
  }

  const code = exitCodeFor({ distOk: v.ok, treeOk: tv.ok });
  if (code === EXIT_OK) return;
  const which = code === EXIT_BOTH
    ? 'BOTH readings failed'
    : code === EXIT_TREE
      ? 'the tree reading failed; the dist/ reading PASSED'
      : 'the dist/ reading failed';
  console.error(`✗ exit ${code} -- ${which}.`);
  process.exit(code);
}

// -- The self-test's own battery roster and floor (#13489) ------------------
//
// A pass used to be this self-test's ONLY success condition, so "every case
// held" and "the cases never ran" printed the same line. Closed the way
// PR #13487 validated on check-doc-authoring: what is pinned is the registered
// NAMES, not a number. Every section opens with `battery('<name>')`, every
// assertion is attributed to the battery most recently opened, and the floor
// requires the OPENED set to equal the DECLARED set with each battery at or
// above its own count.
//
// The counts are a FLOOR, not an equality -- adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'whole-tree accounting: the pure table': 26,
  'porcelain parsing': 3,
  'whole-tree accounting: a real git tree': 7,
  'argv: the correct invocation is the only one': 19,
  'the two-marker split: source spelling vs emitted spelling': 9,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 5;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'ablation-dist-preflight self-test reached its verdict';

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
  // The one in-body assertion helper the 6 inline `failed += 1` sites now route
  // through. Each site already had a ✓ branch and a ✗ branch; both are kept
  // verbatim, and the only change is that a case is COUNTED either way — which
  // is what lets the floor below tell "held" from "never ran".
  const check = (label, ok, detail = '') => {
    registerCase();
    if (ok) {
      console.log(`  ✓ ${label}`);
      return;
    }
    console.error(`  ✗ ${label}${detail}`);
    failed += 1;
  };
  // Cases run before the first banner, so the first battery is opened at the
  // top of the body and that banner carries no second opener — PR #13487's own
  // shape, as batches 1b and 2 landed it.
  battery('whole-tree accounting: the pure table');
  let failed = 0;
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
  for (const [label, input, expected] of cases) {
    const got = verdict(input).ok;
    check(label, got === expected, `: expected ok=${expected}, got ok=${got}`);
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
    for (const [label, ok] of checks) check(label, ok);
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
    ['absent: leaked artifact after restore -> INDETERMINATE, RED', { mode: 'absent', gitReadable: true, files: [f('gen/base.json', false, true)] }, false, 'indeterminate'],
    ['present: leaked artifact after a delete-ablation restore -> INDETERMINATE, RED', { mode: 'present', gitReadable: true, files: [f('gen/base.json', true, true)] }, false, 'indeterminate'],
    // absent mode is ALSO a delete-ablation's mutate leg: the guard's literal left the tree.
    ['absent: deleted guard -> mutate leg, green', { mode: 'absent', gitReadable: true, files: [f('src/a.ts', true, false)] }, true, 'mutate'],
    ['absent: deleted guard + leaked artifact -> mutate leg, green', { mode: 'absent', gitReadable: true, files: [f('src/a.ts', true, false), f('gen/base.json', false, false)] }, true, 'mutate'],
    // An untracked path is dirty too -- a sharded artifact gains FILES, and `git add -A` takes them.
    ['absent: an untracked path is dirt this marker cannot explain -> INDETERMINATE, RED', { mode: 'absent', gitReadable: true, files: [f('gen/new-shard.json', false, false, true)] }, false, 'indeterminate'],
    // A marker present on BOTH sides never identifies a mutation in either mode.
    ['absent: marker on both sides does not explain the dirt -> INDETERMINATE', { mode: 'absent', gitReadable: true, files: [f('gen/base.json', true, true)] }, false, 'indeterminate'],
    ['present: marker on neither side does not explain the dirt -> INDETERMINATE', { mode: 'present', gitReadable: true, files: [f('gen/base.json', false, false)] }, false, 'indeterminate'],
  ];
  for (const [label, input, expectedOk, expectedLeg] of treeCases) {
    const got = treeVerdict(input);
    check(
      label,
      got.ok === expectedOk && got.leg === expectedLeg,
      `: expected ok=${expectedOk} leg=${expectedLeg}, got ok=${got.ok} leg=${got.leg}`,
    );
  }

  // A red restore leg must NAME the leaked path -- a refusal that does not say
  // which file is still mutated sends the agent back to the per-path diff that
  // is clean on exactly this tree.
  {
    const red = treeVerdict({ mode: 'absent', gitReadable: true, files: [f('packages/spec/authorable-surface/data.json', false, true)] });
    const named = red.paths.includes('packages/spec/authorable-surface/data.json');
    check('a red tree reading names the leaked path', named);
  }

  // ---- porcelain parsing ---------------------------------------------------
  battery('porcelain parsing');
  {
    const Z = String.fromCharCode(0);
    const parsed = parsePorcelainZ([' M packages/spec/authorable-surface/data.json', '?? scratch note.txt', 'R  new/name.ts', 'old/name.ts', ''].join(Z));
    const checks = [
      ['parses a modified path', parsed[0]?.path === 'packages/spec/authorable-surface/data.json' && parsed[0]?.untracked === false],
      ['parses an untracked path holding a space, unquoted', parsed[1]?.path === 'scratch note.txt' && parsed[1]?.untracked === true],
      ['consumes a rename origin record instead of listing it', parsed.length === 3 && parsed[2]?.path === 'new/name.ts'],
    ];
    for (const [label, ok] of checks) check(label, ok);
  }

  // ---- whole-tree accounting: a real git tree -------------------------------
  battery('whole-tree accounting: a real git tree');
  // The pure table cannot catch a broken `git status` read or a broken
  // HEAD-vs-worktree marker probe, and those are the wires that make the
  // verdict mean anything. This leg replays the measured incident end to end.
  const repo = mkdtempSync(join(tmpdir(), 'ablation-preflight-git-'));
  try {
    // #16644: a throwaway corpus, so every child is spawned with GIT_* stripped --
    // `git init` here under an inherited GIT_DIR writes core.bare into the SHARED config.
    const git = (...args) => execFileSync('git', args, { cwd: repo, env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
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
      ['git leg: per-path restore leaves the tree RED', restoreLeg.ok === false && restoreLeg.leg === 'indeterminate'],
      ['git leg: the RED names the leaked baseline', restoreLeg.paths.includes('generated-baseline.json')],
      ['git leg: the per-path diff is EMPTY on that same unrestored tree', perPathDiffAtRestore === ''],
      ['git leg: whole-tree restore is green', cleanLeg.ok === true && cleanLeg.paths.length === 0],
      ['git leg: a deleted guard is a mutate leg, not a restore leg', deleteLeg.ok === true && deleteLeg.leg === 'mutate'],
      ['git leg: an untracked path reds the restore leg', untrackedLeg.ok === false && untrackedLeg.paths.includes('scratch.txt')],
    ];
    for (const [label, ok] of gitChecks) check(label, ok);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }


  // ---- argv: the correct invocation is the only one -------------------------
  battery('argv: the correct invocation is the only one');
  // `argv.includes('--absent')` plus a `startsWith('--')` filter discarded every
  // unrecognised flag in silence, so a mistyped `--absnet` ran the OPPOSITE mode
  // and printed a verdict indistinguishable from a real one.
  {
    const argvCases = [
      ['--absent selects the absent mode', parseArgs(['pkg', 'mk', '--absent']).mode === 'absent'],
      ['no flag selects the present mode', parseArgs(['pkg', 'mk']).mode === 'present'],
      ['a mistyped --absnet is REFUSED, not discarded', typeof parseArgs(['pkg', 'mk', '--absnet']).usage === 'string'],
      ['the unknown-option refusal names the real options', /--source-marker=<text>/.test(parseArgs(['pkg', 'mk', '--absnet']).usage ?? '')],
      ['a marker written as a flag is refused, not silently dropped', typeof parseArgs(['pkg', '--weird-marker']).usage === 'string'],
      ['--source-marker=<text> parses, spaces and quotes included', parseArgs(['pkg', 'mk', "--source-marker=label: 'Operator'"]).sourceMarker === "label: 'Operator'"],
      ['--source-marker with a SPACE is refused and names the = spelling', /=<the spelling the SOURCE carries>/.test(parseArgs(['pkg', 'mk', '--source-marker', 'x']).usage ?? '')],
      ['a blank --source-marker= is refused', typeof parseArgs(['pkg', 'mk', '--source-marker=  ']).usage === 'string'],
      ['omitting --source-marker leaves it null, never empty', parseArgs(['pkg', 'mk']).sourceMarker === null],
      ['a blank marker is still refused', typeof parseArgs(['pkg', '  ']).usage === 'string'],
      ['a third positional is still refused', typeof parseArgs(['pkg', 'mk', 'extra']).usage === 'string'],
      ['without --source-marker the tree reading probes the positional marker', treeReadingMarker({ marker: 'emitted', sourceMarker: null }) === 'emitted'],
      ['with --source-marker the tree reading probes THAT spelling', treeReadingMarker({ marker: 'emitted', sourceMarker: 'written' }) === 'written'],
      ['the wiring is nullish-coalescing, so an empty source marker does NOT fall back', treeReadingMarker({ marker: 'emitted', sourceMarker: '' }) === ''],
    ];
    for (const [label, ok] of argvCases) check(label, ok);
    const exitCases = [
      ['both readings pass -> 0', exitCodeFor({ distOk: true, treeOk: true }) === EXIT_OK],
      ['the dist reading alone fails -> 1', exitCodeFor({ distOk: false, treeOk: true }) === EXIT_DIST],
      ['the tree reading alone fails -> 3, NOT the dist code', exitCodeFor({ distOk: true, treeOk: false }) === EXIT_TREE && EXIT_TREE !== EXIT_DIST],
      ['both fail -> 4', exitCodeFor({ distOk: false, treeOk: false }) === EXIT_BOTH],
      ['no reading shares a code with usage', ![EXIT_OK, EXIT_DIST, EXIT_TREE, EXIT_BOTH].includes(EXIT_USAGE)],
    ];
    for (const [label, ok] of exitCases) check(label, ok);
  }

  // ---- the two-marker split: source spelling vs emitted spelling ------------
  battery('the two-marker split: source spelling vs emitted spelling');
  // The measured shape. A DELETE ablation on a package whose build re-spells the
  // literal: the author writes `label: 'Operator'`, `tsup` emits
  // `label:"Operator"`. The spelling that makes the dist reading true is NOT the
  // spelling the tree reading can see, so before the split this exact tree --
  // a correct mutate leg -- was told "restore leg ... 1 path still differs from
  // HEAD", i.e. to restore the very mutation being measured.
  const split = mkdtempSync(join(tmpdir(), 'ablation-preflight-split-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: split, env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    const SRC_SPELLING = "label: 'Operator'";
    const EMITTED = 'label:"Operator"';
    const srcPath = join(split, 'skill.form.ts');
    const genPath = join(split, 'authorable-surface.json');

    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'selftest@objectstack.invalid');
    git('config', 'user.name', 'ablation selftest');
    writeFileSync(srcPath, `export const form = { rows: [{ ${SRC_SPELLING} }] };\n`);
    writeFileSync(genPath, '{"labels":["Operator"]}\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');

    const readWith = (marker, sourceMarker = null) => {
      const st = readTreeStatus(split);
      const files = st.gitReadable ? markerPresence(split, st.entries, treeReadingMarker({ marker, sourceMarker })) : [];
      return treeVerdict({ mode: 'absent', gitReadable: st.gitReadable, gitError: st.gitError, files, sourceMarker });
    };

    // 1. DELETE ablation, mutate leg: the label entry leaves the source.
    writeFileSync(srcPath, 'export const form = { rows: [{}] };\n');
    const emittedOnly = readWith(EMITTED);
    const withSource = readWith(EMITTED, SRC_SPELLING);

    // 2. restore the source, leave the build-written artifact dirty -- the
    //    measured incident. It must STILL refuse, and passing the new flag must
    //    not turn the refusal off, or the flag is a way to disable the catch.
    git('checkout', 'HEAD', '--', 'skill.form.ts');
    writeFileSync(genPath, '{"labels":[]}\n');
    const leakedPlain = readWith(EMITTED);
    const leakedWithSource = readWith(EMITTED, SRC_SPELLING);

    // 3. restore the artifact too.
    git('checkout', 'HEAD', '--', 'authorable-surface.json');
    const clean = readWith(EMITTED, SRC_SPELLING);

    const splitChecks = [
      ['the emitted spelling alone cannot see the mutation -> INDETERMINATE, RED', emittedOnly.ok === false && emittedOnly.leg === 'indeterminate'],
      ['... and it does NOT call that tree a restore leg', emittedOnly.leg !== 'restore'],
      ['... and it names the --source-marker remedy', emittedOnly.msg.includes('--source-marker=')],
      ['--source-marker makes the SAME tree a green MUTATE leg', withSource.ok === true && withSource.leg === 'mutate'],
      ['... naming the path the ablation touched', withSource.paths.includes('skill.form.ts')],
      ['a leaked artifact after restore still REFUSES', leakedPlain.ok === false && leakedPlain.paths.includes('authorable-surface.json')],
      ['... and --source-marker does NOT switch that refusal off', leakedWithSource.ok === false && leakedWithSource.paths.includes('authorable-surface.json')],
      ['... and the refusal says the named source marker is not what moved', leakedWithSource.msg.includes('is not the spelling that moved')],
      ['only a whole-tree restore is a green RESTORE leg', clean.ok === true && clean.leg === 'restore' && clean.paths.length === 0],
    ];
    for (const [label, ok] of splitChecks) check(label, ok);
  } finally {
    rmSync(split, { recursive: true, force: true });
  }

  // -- The floor: every declared battery RAN, and ran its cases (#13489) -----
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorMessages = [];
  const floorFailure = (message) => { floorMessages.push(message); };
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
  for (const m of floorMessages) {
    console.error(`  ✗ ${m}`);
    failed += 1;
  }

  if (failed > 0) {
    console.error(`✗ ablation-dist-preflight self-test: ${failed} case(s) failed.`);
    process.exit(1);
  }
  console.log('✓ ablation-dist-preflight self-test: all cases pass.');

  return SELF_TEST_VERDICT;
}

const argv = process.argv.slice(2);
// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
        console.error(
            '\n✗ ablation-dist-preflight self-test: selfTest() returned without reaching its verdict,\n'
                + 'so no success line was printed. Exiting 0 here would report a self-test\n'
                + 'that never finished as a self-test that passed.\n',
        );
        process.exit(1);
    }
}
else run(argv);
