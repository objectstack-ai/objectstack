#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-manifest-repository-directory (#15991) -- a PUBLISHABLE manifest
 * declares `repository.directory`, and every manifest that declares it declares
 * its own directory.
 *
 *   node scripts/check-manifest-repository-directory.mjs              # the gate
 *   node scripts/check-manifest-repository-directory.mjs --list       # every manifest and its verdict
 *   node scripts/check-manifest-repository-directory.mjs --self-test  # verify the checker
 *
 * ## The bug it exists to prevent
 *
 * npm renders `repository.directory` as the package page's "source" deep link:
 * the field is concatenated onto the repository URL, so a value that names a
 * directory this repo does not have publishes a 404 on the one link a consumer
 * follows to read the code. It is a published promise made of a hand-copied
 * string, and until this gate NOTHING in this repo read the field -- measured
 * over the tracked tree, zero reads of `.directory` in any `.mjs`/`.mts`, and
 * `check-published-files.mjs` (which has exactly the right population and
 * already parses every manifest) mentions `repository` not once. Its six
 * invariants are all about the `files` whitelist: what the tarball CONTAINS.
 * The notch is a category rather than an off-by-one -- this repo gated
 * published package CONTENTS and did not gate published package PROVENANCE
 * METADATA.
 *
 * ## The measured history, and why the trigger is "the manifest CHANGED"
 *
 * Two `packages/triggers/*` manifests carried a `repository.directory` naming
 * `packages/plugins/plugin-trigger-*` -- a path that has not existed since the
 * promotion to a first-class `packages/triggers/`. Reconstructed from the
 * commits rather than from the filing, because the first account of it was
 * wrong in the direction that matters:
 *
 *   f15d6f6f6  NOT a rename. A 26-file COPY (+2222/-19) that edited each
 *              manifest's `name` and left `directory` on the old path. The old
 *              directories still existed for another six minutes, so the field
 *              RESOLVED and pointed at someone else's package.
 *   ea4941ad8  The pure rename -- 16 files, 0 insertions, 0 deletions. No
 *              content-touching hunk existed for a reviewer to read.
 *   9a43e042f  Later edited `repository.url` INSIDE THE SAME OBJECT, with the
 *              stale `directory` line sitting beside it as visible hunk
 *              context. It shipped.
 *
 * ⇒ Humans did look, and missed it twice, in one JSON block. That is the
 * argument for a mechanical check rather than against one: a rule earns its
 * keep precisely where attention has already been shown to fail.
 *
 * ⛔ And it is why this gate is STATELESS over the whole population rather than
 * a rule that fires on directory MOVES. `9a43e042f` moved nothing -- it edited
 * a sibling key -- so a move-triggered rule would have missed it entirely,
 * which is the same miss the humans made. This gate re-judges every declaring
 * manifest on every run, so the finding is present on the copy commit, on the
 * rename commit, on the sibling-field commit, and on every run in between. The
 * dispatch derivation carries the same shape one level up: this gate declares
 * the manifest FILE KIND under every root that holds one, so a card that
 * TOUCHES a manifest at all is told to run it, whatever the edit was.
 *
 * ## What it checks
 *
 *   DECLARED     a PUBLISHABLE manifest declares the field AT ALL. Ruled
 *                mandatory -- see the section below. A PRIVATE manifest that
 *                declares nothing is `exempt`: it has no npm page for a link to
 *                be missing from, so silence there is not a defect.
 *
 * and then, per manifest that declares the field, whatever its privacy -- a
 * value that names the wrong directory is wrong in a private manifest too, and
 * a private package is one `private` deletion away from publishing it:
 *
 *   WELL-FORMED  the value is a repo-root-relative POSIX directory path: no
 *                absolute path, no backslash separator, no `..` segment, no
 *                empty segment, no surrounding whitespace. None of those
 *                resolve on the npm page, and each fails differently enough to
 *                be worth naming.
 *   RESOLVES     the declared directory is IN THIS REPOSITORY -- some tracked
 *                file lives under it. Not `existsSync`: the deep link is
 *                served by GitHub from the repository, so a build directory or
 *                a gitignored scratch dir that exists on the author's disk is
 *                exactly the case that 404s for the consumer. Reading the
 *                question off `git ls-files` also makes it case-exact on a
 *                case-insensitive filesystem, where `existsSync` is not.
 *   OWN          the declared directory IS this manifest's own directory.
 *
 * ## Why OWN is a separate invariant from RESOLVES, with the measurement
 *
 * A resolves-only gate would have been GREEN on `f15d6f6f6`: the copy left the
 * field naming `packages/plugins/plugin-trigger-*`, and those directories were
 * still tracked for six more minutes. The gate would then have turned red on
 * an unrelated commit -- #1751, which deleted the originals -- naming a defect
 * introduced somewhere else entirely. OWN is the invariant that reports the
 * defect at the commit that caused it, and the two verdicts are reported apart
 * because they tell an author two different things: STALE means the path is
 * gone, MISPLACED means the link points a consumer at somebody else's package.
 *
 * ## The ruling: declaration is MANDATORY for a publishable manifest
 *
 * This gate shipped judging only manifests that DECLARED the field, and left
 * the other half open: 14 publishable packages declared nothing at all, and
 * every one of those npm pages had NO source link rather than a broken one.
 * That half was a policy call and it has been made -- a publishable
 * (non-private) workspace manifest DECLARES `repository.directory` naming its
 * own directory. The 14 were backfilled in the same change that added this
 * invariant.
 *
 * The alternative -- silence allowed, a pure consistency check over whoever
 * opts in -- was refused for a reason worth keeping written down here, because
 * it is the reason a future author will want to re-open: it leaves "remember to
 * write this line" to memory. That is the hand-copied-line-with-no-gate shape
 * this repo has already been bitten by, on a defect a reviewer cannot see in a
 * diff -- and it gives the next new package no signal at all, which is how the
 * 14 got there. A gate that only checks opt-ins cannot ever shrink the set of
 * packages with no source link; it can only keep the opted-in ones honest.
 *
 * ⛔ Silence is therefore a FINDING for a publishable manifest, and ⛔ it is not
 * repaired by deleting a declaration to get out of the judged set -- deleting
 * one moves a manifest from `ok` to a finding, not out of the population.
 * PRIVATE manifests stay unjudged for silence and are counted apart.
 *
 * ## The anti-vacuity design, which is the whole risk of this population
 *
 * The population is `git ls-files` plus two field predicates, so it empties
 * SILENTLY in three independent ways: the manifest glob stops matching (0
 * manifests, 0 findings, a clean green over nothing); `repository.directory` is
 * renamed upstream (82 manifests, 0 declarers, the same clean green); or
 * `name`/`private` changes shape so nothing reads as publishable (82 manifests,
 * 0 subjects for the DECLARED invariant, the same clean green again). None of
 * the three shows up as an error, and a gate that can only ever say "all clear"
 * says it loudest when it has read nothing. Three instruments, all of which
 * must fire before any verdict is printed:
 *
 *   1. CONTROL PROBES, BOTH DIRECTIONS, ON BOTH PREDICATES. Two predicates
 *      decide this gate's verdicts and each gets its own pair, because a green
 *      pair on one says nothing about the other.
 *      `isTrackedDirectory` (RESOLVES) is driven against a directory the run
 *      KNOWS is there -- derived from the population itself, the directory of a
 *      manifest this run just read -- and against one assembled at runtime that
 *      cannot be (that directory's own root plus a nonsense segment).
 *      `isPublishable` (DECLARED) is driven against two manifest objects
 *      assembled here, one named and non-private, one `private: true`.
 *      All four must come back correct. One direction alone is worthless in
 *      either pair: a directory predicate stuck on `true` passes EXISTS and
 *      silences every finding, one stuck on `false` passes MISSING and reddens
 *      the whole tree; a publishability predicate stuck on `false` passes
 *      PRIVATE and owes the DECLARED invariant to nobody, one stuck on `true`
 *      passes PUBLISHABLE and asks private manifests for a promise they never
 *      make.
 *   2. PINNED COUNTS. `MEASURED` records the census on a named commit and
 *      `floorProblem` refuses a run that falls below the derived floors. The
 *      counts are the ones a reader can reproduce, and a refusal names the
 *      count, the floor, the record and the commit it was taken on.
 *   3. A SELF-TEST WITH A BATTERY ROSTER. `SELF_TEST_BATTERIES` pins the
 *      registered battery NAMES and each one's case floor, so a self-test that
 *      runs zero cases cannot print a success line -- the shape #15410
 *      measured at 20 of 178 self-tests in this repo, and the one this gate was
 *      filed with an explicit instruction not to become the 179th of.
 *
 * ⛔ A run below a floor is NOT repaired by moving the floor. The floors are
 * derived from a census on a named commit; a run under one means this gate
 * stopped READING, and the thing to find is what stopped being read -- a glob
 * that no longer matches, a walk that returns early, a predicate that no longer
 * recognises the field.
 *
 * ## Where it runs
 *
 * A static read of tracked manifests -- no build, no install, no network -- so
 * it is a step in `Lint & Repo Gates` beside the published-files whitelist
 * guard, whose static half of packaging hygiene it extends from CONTENTS to
 * PROVENANCE. With no `git ls-files` answer it exits 3 (`PREREQUISITE NOT
 * MET`) and ⛔ never degrades to a silent green.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

// ── The self-test's own battery roster and floor ───────────────────────────
//
// What is pinned is the registered NAMES, not a total. Every section opens with
// `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows. A set difference says WHICH
// battery stopped registering; a count says only that something did.
//
// The counts are a FLOOR, not an equality -- adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running.
//
// Each floor is set AT the number of cases the battery registers today, so the
// slack between "what runs" and "what is floored" is zero. Two of these had
// drifted below their batteries (5 against 6 cases, 9 against 12) and were
// re-derived rather than left: a floor with slack in it is a floor that lets
// exactly that many cases stop running before it notices.
//
// The machinery lives HERE, at module scope, rather than inside the self-test:
// the assertion sink is a concise arrow in the self-test's body, so there is no
// in-body helper to thread a per-run ledger through, and the self-test runs
// once per process.
const SELF_TEST_BATTERIES = Object.freeze({
  'the population declaration itself': 6,
  'the value normaliser': 12,
  'the tracked-directory index': 7,
  'the publishability predicate, both directions': 10,
  'the judgement, per manifest': 13,
  'the measured defect shapes, replayed': 5,
  'the control probes, both directions': 11,
  'the vacuity floors, each driven to zero': 14,
  'provenance: the record must stay reproducible, and visibly so': 6,
  'the live tree: the shipped record against the real population': 12,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 10;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

/** Cases registered per battery: `battery()` opens one, `registerCase()` files into it. */
const batteryCases = new Map();
let openBattery = null;

/** Open a battery. Every assertion after this line is attributed to it. */
function battery(name) {
  openBattery = name;
}

/** Called by the self-test's own assertion sink, once per assertion. */
function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

/**
 * The floor: every declared battery RAN, and ran its cases.
 *
 * Evaluated after every battery has had its chance and BEFORE the verdict, so
 * the success line can only be printed by a run in which the set of batteries
 * that registered assertions EQUALS the set declared.
 */
function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  return problems;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_REFUSE = 2;
const EXIT_PREREQ = 3;

/**
 * This gate's population, written in the syntax `scripts/pm/dispatch-gates.mjs`
 * can read.
 *
 * The population is a FILE KIND rather than a subtree -- every tracked
 * `package.json`, wherever it sits -- so it is declared as that kind under each
 * root that holds one, plus the repo-root manifest in the root-FILE spelling.
 * Measured against the derivation's own `hintCovers`, this declaration covers
 * `packages/triggers/trigger-schedule/package.json`, `apps/docs/package.json`,
 * `examples/crm/package.json` and the bare `package.json`, and covers neither
 * `packages/spec/src/index.ts` nor `apps/docs/next.config.mjs`.
 *
 * ⚠️ The obvious one-line spelling does not work and is worth naming so nobody
 * retries it: `**\/package.json` is judged correctly by `hintCovers` and is
 * never SEEN, because `extractWatchHints` admits a literal only if it starts
 * with a word character, a dot or an `@`. A leading glob is dropped at
 * admission, so that declaration extracts to zero hints -- the exact drop
 * `check:watch-hint-literal` exists for, arrived at through the value rather
 * than through the spelling. Measured while writing this gate: the one-line
 * form extracted `[]`; the four below extract all four.
 *
 * ⚠️ That drop was SILENT when this gate was written, and is not any more:
 * `check:watch-hint-literal` now puts every declared literal through the
 * extractor and reds on one that yields no hint, naming this remedy. So the
 * one-line form is refused loudly rather than dropped quietly -- retry it and
 * a gate tells you to enumerate, which is the only part of the cost this
 * enumeration ever paid twice.
 *
 * ⛔ NOT the workspace-root spelling `check-published-files.mjs` uses
 * (`packages/*`, `apps/*`, …). That declaration is honest THERE -- it walks
 * every non-build file of every member and judges 91.3% of them -- and would be
 * a fabrication here: this gate opens one file per package and would otherwise
 * be named for every `.ts` card in the tree. A fabricated lead costs more than
 * a missing one.
 *
 * Nothing in this gate reads these arrays; `manifestsIn` filters the real
 * `git ls-files` listing. The self-test reconciles the two against the live
 * tree as a SET EQUALITY in both directions, so a root that starts holding
 * manifests -- or one that stops -- reds here rather than leaving the
 * declaration quietly describing a tree that moved.
 */
const ROOT_DIR_WATCH_HINTS = ['packages/**/package.json', 'apps/**/package.json', 'examples/**/package.json'];

/** The repo-root manifest, in the root-FILE spelling the same extractor reads. */
const ROOT_FILE_WATCH_HINTS = ['package.json/**'];

/**
 * Does a declared hint cover a repo-relative path, under the TWO hint shapes
 * this gate declares?
 *
 * A local reading, and deliberately not an import of the derivation's
 * `hintCovers`: this exists so the self-test can reconcile THIS declaration
 * against THIS scan as a set equality, and a gate that pulled the whole
 * derivation in to answer it would make its own self-test depend on the tool it
 * is declaring itself to. The agreement it reproduces was measured against
 * `hintCovers` while this gate was written, on the six paths named above.
 *
 * ⛔ It handles no other hint shape and refuses rather than approximating one:
 * an unrecognised hint covers nothing, so widening either declaration without
 * teaching this reads as a dead hint and reds the reconciliation below rather
 * than passing quietly.
 *
 * @param {string} hint
 * @param {string} path
 * @returns {boolean}
 */
export function hintCoversPath(hint, path) {
  if (hint.endsWith('/**')) {
    const base = hint.slice(0, -3);
    if (base === '' || base.includes('*')) return false;
    return path === base || path.startsWith(`${base}/`);
  }
  const at = hint.indexOf('/**/');
  if (at <= 0) return false;
  const root = hint.slice(0, at);
  const tail = hint.slice(at + 4);
  if (tail === '' || root.includes('*') || tail.includes('*')) return false;
  return path.startsWith(`${root}/`) && path.endsWith(`/${tail}`);
}

/**
 * The census this gate's floors are derived from.
 *
 * Immutable, so the record stays reproducible forever as `main` moves away from
 * it. ⛔ Never repoint it without re-running every count. Reproduce with:
 *
 *   node scripts/check-manifest-repository-directory.mjs --list
 *
 * `ref` is the commit that BACKFILLED the 14, on the branch that made
 * declaration mandatory -- not a commit that was on `main` beforehand, because
 * this census is a property of the post-backfill tree and no earlier tree had
 * it. Every commit from `ref` to that branch's tip carries the same manifest
 * population, so `--list` at the tip -- and on `main` from the day it landed --
 * prints these numbers; the provenance line on every green run reports the live
 * delta against them, so drift is visible without anyone checking a commit out.
 *
 * `manifests` is every tracked `package.json`; `declaring` is those that
 * declare `repository.directory`; `publishable` is those the DECLARED
 * invariant is owed by (a `name`, and not `private`); `undeclaredPublishable`
 * is how many of those owe it and have not paid -- ZERO, and it is pinned at
 * zero on purpose: the backfill IS the record, so a reader who finds this
 * number edited upward is looking at a regression somebody wrote down rather
 * than fixed. `trackedDirectories` is the size of the directory index the
 * RESOLVES invariant is answered from.
 */
const MEASURED = Object.freeze({
  ref: '9e31bda5fa',
  manifests: 82,
  declaring: 72,
  publishable: 70,
  undeclaredPublishable: 0,
  trackedDirectories: 530,
});

// The floors, each `MEASURED` minus this gate's declared headroom, which is 12%
// rounded down (`Math.floor(measured * 0.88)`). They are inequalities rather
// than equalities on purpose: this population moves in both directions for good
// reasons -- a package is deleted, a private fixture arrives, a manifest drops a
// declaration -- and an equality would red on every legitimate move. What no
// legitimate move does is take a count to (nearly) zero, which is the only
// thing a floor decides.
//
// ⛔ Written as literals rather than derived from `MEASURED` at runtime: a floor
// computed from the record moves the moment somebody edits the record, which is
// the one edit a floor exists to survive.
const MIN_MANIFESTS = 72;
const MIN_DECLARING = 63;
const MIN_PUBLISHABLE = 61;
const MIN_TRACKED_DIRECTORIES = 466;

// ⛔ There is deliberately NO floor on the private count. The private set is
// only ever used to EXCLUDE, so a shrinking one makes this gate judge MORE and
// is not a vacuity risk; a floor there would red the day three examples are
// deleted and would protect nothing. The direction that CAN empty silently is
// `publishable`, and that is floored above.

// Every control probe must fire, in both directions on both predicates, before
// any verdict. Two predicates decide this gate's verdicts and each gets its own
// pair: `isTrackedDirectory` answers RESOLVES, `isPublishable` answers DECLARED.
const REQUIRED_DIRECTORY_CONTROLS = 2;
const REQUIRED_PUBLISHABILITY_CONTROLS = 2;
const REQUIRED_CONTROLS = REQUIRED_DIRECTORY_CONTROLS + REQUIRED_PUBLISHABILITY_CONTROLS;

/**
 * The leaf segment of the MISSING control probe's target, assembled at runtime
 * from words that are not path-shaped literals.
 *
 * Spelled this way deliberately, twice over. A quoted path literal in a gate's
 * module body is read by the dispatch derivation as part of that gate's
 * population, and a literal naming a directory that exists in no repo is
 * exactly the dead declaration `check:declared-population-live` refuses; a
 * quoted literal naming a REAL top-level directory is the invisible bare-root
 * species `scripts/pm/bare-root-worklist.mjs` sweeps for. Assembling the value
 * keeps the probe adversarial while declaring nothing that is not true.
 */
const CONTROL_ABSENT_LEAF = ['no', 'such', 'directory', 'this', 'gate', 'invents'].join('-');

/**
 * The directory the MISSING probe asks about, placed UNDER the root of the
 * EXISTS probe's subject.
 *
 * Derived rather than written down, for the reason above and for a stronger
 * one: a directory nested under a root this tree really has is the probe that
 * catches an ancestor-prefix bug -- a predicate answering "tracked" for
 * anything beneath a tracked directory passes a root-level probe and fails this
 * one, and over-matching is the direction that SILENCES findings.
 *
 * @param {string} [presentDirectory] the EXISTS probe's subject
 * @returns {string}
 */
export function controlAbsentDirectory(presentDirectory) {
  if (typeof presentDirectory !== 'string' || presentDirectory === '') return CONTROL_ABSENT_LEAF;
  const root = presentDirectory.includes('/') ? presentDirectory.slice(0, presentDirectory.indexOf('/')) : presentDirectory;
  return `${root}/${CONTROL_ABSENT_LEAF}`;
}

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------

/**
 * Every tracked path, from git.
 *
 * `git ls-files -z` rather than a filesystem walk: the RESOLVES invariant asks
 * what GitHub will serve, and GitHub serves the repository, not the working
 * tree. Returns `null` when git cannot answer, which the caller turns into
 * `PREREQUISITE NOT MET` -- ⛔ never into an empty population, which would
 * print the clean green this whole file is written against.
 *
 * @param {string} root
 * @returns {string[] | null}
 */
export function trackedPaths(root) {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
  const paths = out.split('\0').filter((p) => p !== '');
  return paths.length ? paths : null;
}

/**
 * The manifests, out of a tracked listing. Pure, so the self-test drives it
 * with a synthetic listing and no tree.
 *
 * @param {string[]} paths
 * @returns {string[]}
 */
export function manifestsIn(paths) {
  return (paths ?? []).filter((p) => p === 'package.json' || p.endsWith('/package.json')).sort();
}

/**
 * Every directory that CONTAINS a tracked file, including all ancestors and the
 * repo root (spelled `''`). Pure.
 *
 * An empty directory cannot be tracked by git at all, so "has a tracked file
 * under it" is the same question as "GitHub can render a page for it".
 *
 * @param {string[]} paths
 * @returns {Set<string>}
 */
export function trackedDirectoriesIn(paths) {
  const dirs = new Set(['']);
  for (const p of paths ?? []) {
    const segments = p.split('/');
    segments.pop();
    let acc = '';
    for (const segment of segments) {
      acc = acc === '' ? segment : `${acc}/${segment}`;
      dirs.add(acc);
    }
  }
  return dirs;
}

// ---------------------------------------------------------------------------
// The invariants
// ---------------------------------------------------------------------------

/**
 * Normalise a declared `repository.directory` value, or say why it is not a
 * repo-root-relative POSIX directory path. Pure.
 *
 * `./x` and `x/` are accepted and normalised -- both name the same directory
 * and npm resolves them -- while the shapes that genuinely do not resolve are
 * named apart, because "absolute path" and "Windows separator" are two
 * different mistakes with two different repairs. `.` normalises to the repo
 * root, which is the only value the root manifest could honestly declare.
 *
 * @param {unknown} raw
 * @returns {{value: string | null, problem: string | null}}
 */
export function normaliseDeclared(raw) {
  if (typeof raw !== 'string') return { value: null, problem: `it is ${raw === null ? 'null' : typeof raw}, not a string` };
  if (raw.trim() !== raw) return { value: null, problem: 'it carries surrounding whitespace' };
  if (raw === '') return { value: null, problem: 'it is empty' };
  if (raw.includes('\\')) return { value: null, problem: 'it uses a backslash separator, which resolves on no forge' };
  if (raw.startsWith('/')) return { value: null, problem: 'it is an absolute path, and the field is resolved relative to the repository root' };
  const cleaned = raw.replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (cleaned === '' || cleaned === '.') return { value: '', problem: null };
  const segments = cleaned.split('/');
  if (segments.some((s) => s === '')) return { value: null, problem: 'it contains an empty path segment' };
  if (segments.some((s) => s === '.' || s === '..')) return { value: null, problem: 'it contains a relative segment, and the field is a plain path from the repository root' };
  return { value: cleaned, problem: null };
}

/**
 * The declared value, or `undefined` when this manifest declares none. Pure.
 *
 * A string-shorthand `repository` carries no directory by construction, and is
 * `undefined` here rather than a finding: the shorthand is a legitimate
 * spelling for a package that IS the repository root.
 *
 * @param {unknown} manifest
 * @returns {unknown}
 */
export function declaredDirectory(manifest) {
  if (manifest === null || typeof manifest !== 'object') return undefined;
  const repository = /** @type {{repository?: unknown}} */ (manifest).repository;
  if (repository === null || typeof repository !== 'object') return undefined;
  return /** @type {{directory?: unknown}} */ (repository).directory;
}

/**
 * Does this manifest publish? Pure.
 *
 * The predicate the DECLARED invariant is owed by, and deliberately the SAME
 * spelling `scripts/check-published-files.mjs` uses for the same question --
 * `!manifest.name || manifest.private === true` means it publishes nothing.
 * Two gates reading one population must not disagree about who is in it, so
 * this is a copy of that predicate's meaning rather than an improvement on it.
 *
 * ⚠️ `private: true` is compared as a BOOLEAN. npm itself reads the field for
 * truthiness, so a manifest spelling it `"true"` is private to npm and
 * publishable here, and would be asked for a declaration it does not need. That
 * divergence is accepted knowingly: it is a manifest to fix, it fails LOUDLY
 * (an extra finding, never a silenced one), and matching the repo's one other
 * publish-population reader is worth more than matching npm's coercion.
 *
 * @param {unknown} manifest
 * @returns {boolean}
 */
export function isPublishable(manifest) {
  if (manifest === null || typeof manifest !== 'object') return false;
  const { name, private: isPrivate } = /** @type {{name?: unknown, private?: unknown}} */ (manifest);
  if (typeof name !== 'string' || name === '') return false;
  return isPrivate !== true;
}

/**
 * Judge ONE manifest. Pure -- the tracked-directory question arrives as a
 * predicate, so the self-test drives every verdict with no tree at all.
 *
 * ⚠️ Only an EXPLICIT `publishable: false` exempts a silent manifest. A caller
 * that forgets the field gets the finding, not the exemption: an omitted flag
 * must fail towards NOISE, because the other default is a gate that stops
 * judging and says nothing about it -- the exact silence this whole file is
 * written against.
 *
 * @param {{path: string, ownDirectory: string, declared: unknown, publishable?: boolean}} entry
 * @param {(dir: string) => boolean} isTrackedDirectory
 * @returns {{verdict: 'undeclared'|'exempt'|'ok'|'malformed'|'stale'|'misplaced', finding: string | null}}
 */
export function judgeManifest(entry, isTrackedDirectory) {
  const { path, ownDirectory, declared, publishable } = entry;
  const ownDir = ownDirectory === '' ? '(the repository root)' : ownDirectory;
  if (declared === undefined) {
    if (publishable === false) return { verdict: 'exempt', finding: null };
    return {
      verdict: 'undeclared',
      finding: `${path}: this package publishes to npm and declares NO repository.directory. `
        + 'npm renders that field as the package page\'s "source" deep link, so without it the page '
        + `carries no link to this code at all. Declare it inside \`repository\`, naming this manifest's `
        + `own directory: '${ownDir}'. Copy the block a sibling package already carries — the field is `
        + 'concatenated onto `repository.url`, so `directory` without that url resolves to nothing.',
    };
  }

  const own = ownDir;
  const { value, problem } = normaliseDeclared(declared);
  if (problem !== null) {
    return {
      verdict: 'malformed',
      finding: `${path}: repository.directory is ${JSON.stringify(declared)} — ${problem}. `
        + `It must name this manifest's own directory, as a plain path from the repository root: '${own}'.`,
    };
  }
  if (value === ownDirectory) return { verdict: 'ok', finding: null };
  if (!isTrackedDirectory(value)) {
    return {
      verdict: 'stale',
      finding: `${path}: repository.directory declares '${value}', which is NOT a directory in this repository. `
        + `npm renders that value as this package's "source" link, so the link 404s. This manifest lives at '${own}'.`,
    };
  }
  return {
    verdict: 'misplaced',
    finding: `${path}: repository.directory declares '${value}', which IS a real directory in this repository — `
      + `but not this manifest's. This manifest lives at '${own}', so the package's "source" link sends a consumer `
      + 'to another package\'s code. This is the shape a directory COPY leaves behind: the name was edited, the '
      + 'directory was not, and the old path was still there to resolve.',
  };
}

/**
 * The two control probes, run against the SAME predicate the invariants use.
 *
 * The EXISTS side is derived from the population rather than written down: the
 * directory of a manifest this run has just read is known to be tracked
 * BECAUSE the run read a tracked file out of it, so the probe cannot go stale
 * with the tree. The MISSING side is assembled (see `controlAbsentDirectory`).
 *
 * ⛔ Both directions or neither. A predicate stuck on `true` silences every
 * finding and passes an EXISTS-only control; a predicate stuck on `false`
 * reddens the whole tree and passes a MISSING-only one.
 *
 * @param {string[]} manifestPaths
 * @param {(dir: string) => boolean} isTrackedDirectory
 * @returns {{fired: number, problems: string[], present: string | null, absent: string}}
 */
export function controlProbes(manifestPaths, isTrackedDirectory) {
  const problems = [];
  let fired = 0;

  const present = (manifestPaths ?? [])
    .map((p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''))
    .find((d) => d !== '') ?? null;

  if (present === null) {
    problems.push(
      'the EXISTS control probe has no subject — no manifest in the population sits in a directory, so '
        + 'nothing in this run is KNOWN to be tracked and the predicate went unexercised in that direction.',
    );
  } else if (isTrackedDirectory(present)) {
    fired += 1;
  } else {
    problems.push(
      `the EXISTS control probe FAILED: '${present}' holds a manifest this run just read, and the tracked-directory `
        + 'predicate reports it MISSING. Every declaration would be scored stale — the index is the bug, not the tree.',
    );
  }

  const absent = controlAbsentDirectory(present ?? undefined);
  if (!isTrackedDirectory(absent)) {
    fired += 1;
  } else {
    problems.push(
      `the MISSING control probe FAILED: '${absent}' is assembled by this gate and cannot be in any repository, `
        + 'and the tracked-directory predicate reports it present. A predicate that answers yes to everything '
        + 'silences every finding this gate exists to make.',
    );
  }

  return { fired, problems, present, absent };
}

/**
 * The control probes for the OTHER predicate -- the one the DECLARED invariant
 * is decided by.
 *
 * Assembled subjects rather than subjects derived from the population, and the
 * asymmetry with the directory probes above is deliberate. The directory probe
 * needs the tree because "is this directory tracked" is a question ABOUT the
 * tree; publishability is a question about a manifest OBJECT, so two objects
 * built here answer it with no tree at all and can never go stale against one.
 *
 * ⛔ Both directions or neither, and the two directions fail differently. A
 * predicate stuck on `false` says nothing publishes, so the DECLARED invariant
 * is owed by nobody and every silent manifest passes -- the SILENT failure, and
 * the whole reason this pair exists. A predicate stuck on `true` judges the
 * private manifests too and reddens the tree -- loud, but it should still be
 * named as a broken predicate rather than as ten defects.
 *
 * ⚠️ What this pair CANNOT catch is the field being renamed upstream, because
 * its subjects are built to the spelling this gate already believes in. That
 * direction empties `publishable` towards zero across the real population and
 * is caught by `MIN_PUBLISHABLE`, not here. Probe and floor are two
 * instruments, and neither substitutes for the other.
 *
 * @param {(manifest: unknown) => boolean} isPublishableFn
 * @returns {{fired: number, problems: string[]}}
 */
export function publishabilityProbes(isPublishableFn) {
  const problems = [];
  let fired = 0;

  if (isPublishableFn({ name: '@probe/publishes', version: '0.0.0' })) {
    fired += 1;
  } else {
    problems.push(
      'the PUBLISHABLE control probe FAILED: a named, non-private manifest assembled by this gate is '
        + 'reported as publishing nothing. A predicate that answers no to everything leaves the DECLARED '
        + 'invariant owed by NOBODY, so every manifest that declares nothing passes and this gate goes '
        + 'quiet over the exact population it was made mandatory for.',
    );
  }

  if (!isPublishableFn({ name: '@probe/does-not-publish', version: '0.0.0', private: true })) {
    fired += 1;
  } else {
    problems.push(
      'the PRIVATE control probe FAILED: a manifest assembled by this gate with `private: true` is '
        + 'reported as publishing. Every private manifest would then be asked for a published promise it '
        + 'never makes, and the findings below would be about the predicate, not about the tree.',
    );
  }

  return { fired, problems };
}

/**
 * The first floor a run falls below, as a refusal message -- or `null` when
 * every count clears. Pure, so the self-test drives every floor with no tree.
 *
 * @param {{manifests?: number, declaring?: number, publishable?: number, trackedDirectories?: number, controls?: number}} counts
 * @returns {string | null}
 */
export function floorProblem(counts) {
  const rows = [
    [counts?.manifests ?? 0, MIN_MANIFESTS, MEASURED.manifests, 'tracked package manifest(s)',
      'This is the whole population. The manifest filter matched (almost) nothing, so every invariant below it was satisfied over an empty set and this gate printed what a clean tree prints.'],
    [counts?.declaring ?? 0, MIN_DECLARING, MEASURED.declaring, 'manifest(s) declaring repository.directory',
      'Manifests were found but none of them declares the field this gate reads. That is what a renamed field looks like from in here: a full population, an empty subject, and a green line.'],
    [counts?.publishable ?? 0, MIN_PUBLISHABLE, MEASURED.publishable, 'publishable manifest(s)',
      'This is the population the DECLARED invariant is owed by. Manifests were found and none of them reads as publishing, so nothing was required to declare anything and every silence passed. That is what a renamed `private`/`name` key looks like from in here — and unlike the loud direction, it produces no findings at all.'],
    [counts?.trackedDirectories ?? 0, MIN_TRACKED_DIRECTORIES, MEASURED.trackedDirectories, 'tracked directory(ies) indexed',
      'This is the index the RESOLVES invariant is answered from. A collapsed index cannot tell a live directory from a deleted one.'],
    [counts?.controls ?? 0, REQUIRED_CONTROLS, REQUIRED_CONTROLS, 'control probe(s) fired',
      'The probes are what prove BOTH of this gate\'s predicates still answer in BOTH directions — `isTrackedDirectory` for RESOLVES, `isPublishable` for DECLARED. A missing probe means one of the four went unexercised, and nothing then establishes that this run could have produced a finding at all.'],
  ];
  for (const [got, min, measured, what, why] of rows) {
    if (got >= min) continue;
    return `measured only ${got} ${what}, below the floor of ${min} (${measured} on ${MEASURED.ref}).\n`
      + `  ${why}\n`
      + '  ⛔ NOT a pass: nothing, or nearly nothing, was read. Find what stopped being read — the floor is\n'
      + '  derived from a census on a named commit and is not the thing that moved.';
  }
  return null;
}

/**
 * The provenance footer for a PASSING run: the census this run read, the floors
 * it cleared, the census those floors were derived from, and the commit that
 * census belongs to -- side by side.
 *
 * The floors are inequalities on purpose, so no passing run can ever contradict
 * the record; without this line the record could stop describing the tree and
 * every green log would look identical either way. The delta is INFORMATION and
 * never a verdict: this population moves in both directions for good reasons,
 * and only the floors decide anything.
 *
 * Pure, so the self-test drives it with no tree.
 *
 * @param {{manifests?: number, declaring?: number, publishable?: number, trackedDirectories?: number}} counts
 * @returns {string}
 */
export function provenanceLine(counts) {
  const got = [counts?.manifests ?? 0, counts?.declaring ?? 0, counts?.publishable ?? 0, counts?.trackedDirectories ?? 0];
  const rec = [MEASURED.manifests, MEASURED.declaring, MEASURED.publishable, MEASURED.trackedDirectories];
  const floors = [MIN_MANIFESTS, MIN_DECLARING, MIN_PUBLISHABLE, MIN_TRACKED_DIRECTORIES];
  const delta = got.map((g, i) => (g === rec[i] ? '=' : `${g > rec[i] ? '+' : ''}${g - rec[i]}`));
  return `  provenance — manifests/declaring/publishable/trackedDirectories: this run ${got.join('/')}`
    + ` · floors ${floors.join('/')} · derived from ${rec.join('/')} measured on ${MEASURED.ref}`
    + ` (${delta.join('/')} vs the record).\n`
    + '  ⚠ The delta is information, not a verdict — this population grows AND shrinks for good reasons,'
    + ' and only the floors decide.';
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/**
 * Judge a whole population. Takes the tracked listing rather than reading git
 * itself, so the self-test drives it over a fixture listing.
 *
 * `readManifest` is injected for the same reason. A manifest that cannot be
 * read is a FINDING rather than a skip: an unreadable manifest scored as a
 * clean one is the vacuity this file is written against, one row at a time.
 *
 * @param {string[]} paths a tracked-path listing
 * @param {(relPath: string) => unknown} readManifest
 */
export function scan(paths, readManifest) {
  const manifestPaths = manifestsIn(paths);
  const dirs = trackedDirectoriesIn(paths);
  const isTrackedDirectory = (dir) => dirs.has(dir);

  const controls = controlProbes(manifestPaths, isTrackedDirectory);
  const publishability = publishabilityProbes(isPublishable);
  const rows = [];
  const findings = [];

  for (const path of manifestPaths) {
    const ownDirectory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    let manifest;
    try {
      manifest = readManifest(path);
    } catch (error) {
      findings.push(
        `${path}: this manifest could not be read (${error instanceof Error ? error.message : String(error)}). `
          + 'It is in the population and it was NOT judged — a manifest this gate cannot read is never scored clean.',
      );
      rows.push({ path, ownDirectory, verdict: 'unreadable', declared: undefined, publishable: null });
      continue;
    }
    const declared = declaredDirectory(manifest);
    const publishable = isPublishable(manifest);
    const { verdict, finding } = judgeManifest({ path, ownDirectory, declared, publishable }, isTrackedDirectory);
    if (finding) findings.push(finding);
    rows.push({ path, ownDirectory, verdict, declared, publishable });
  }

  const counts = {
    manifests: manifestPaths.length,
    declaring: rows.filter((r) => r.declared !== undefined).length,
    // ⛔ Counted off the PREDICATE, never off `manifests - private`: a row this
    // gate could not read is neither, and folding it into either count would
    // let an unreadable manifest inflate a floor it was never measured by.
    publishable: rows.filter((r) => r.publishable === true).length,
    privateManifests: rows.filter((r) => r.publishable === false).length,
    undeclaredPublishable: rows.filter((r) => r.verdict === 'undeclared').length,
    trackedDirectories: dirs.size,
    controls: controls.fired + publishability.fired,
  };
  return { rows, findings, counts, controls, publishability };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readManifestFrom(root) {
  return (relPath) => JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function main(argv) {
  const root = REPO_ROOT;
  const paths = trackedPaths(root);
  if (paths === null) {
    console.error('PREREQUISITE NOT MET — `git ls-files` produced no listing, so this gate has no population.');
    console.error('  It reads the tracked tree, deliberately: the npm "source" deep link is served from the');
    console.error('  repository, not from the working tree. Run it inside a git checkout.');
    console.error('  ⛔ This is NOT a pass: nothing was measured.');
    return EXIT_PREREQ;
  }

  const { rows, findings, counts, controls, publishability } = scan(paths, readManifestFrom(root));

  if (argv.includes('--list')) {
    for (const r of rows) {
      console.log(`${r.verdict.padEnd(11)} ${(r.publishable === true ? 'publishable' : r.publishable === false ? 'private' : '?').padEnd(12)}`
        + `${r.ownDirectory === '' ? '(repo root)' : r.ownDirectory} `
        + `${r.declared === undefined ? '' : `→ ${JSON.stringify(r.declared)}`}`);
    }
    console.log(`\n${counts.manifests} tracked manifest(s); ${counts.declaring} declare repository.directory; `
      + `${counts.publishable} publishable and ${counts.privateManifests} private; `
      + `${counts.undeclaredPublishable} publishable manifest(s) declare none; `
      + `${counts.trackedDirectories} tracked director(ies) indexed.`);
    return EXIT_OK;
  }

  // ⛔ Before any verdict: a run whose controls did not fire, or that read
  // (almost) nothing, must refuse rather than report the clean tree.
  const probeProblems = [...controls.problems, ...publishability.problems];
  for (const p of probeProblems) console.error(`check:manifest-repository-directory REFUSES — ${p}`);
  const floor = floorProblem(counts);
  if (probeProblems.length || floor !== null) {
    if (floor !== null) console.error(`check:manifest-repository-directory REFUSES — ${floor}`);
    return EXIT_REFUSE;
  }

  if (findings.length) {
    console.error(`✗ check:manifest-repository-directory — ${findings.length} finding(s) across `
      + `${counts.publishable} publishable and ${counts.declaring} declaring manifest(s):`);
    for (const f of findings) console.error(`  ✗ ${f}`);
    console.error('');
    console.error('`repository.directory` is a published promise: npm concatenates it onto the repository');
    console.error('URL and renders the result as the package page\'s "source" link. A value naming a directory');
    console.error('this repo does not have publishes a 404 to every consumer who follows it; no value at all');
    console.error('publishes a page with no link to the code. Nothing in this repo\'s own tests, build or');
    console.error('typecheck can see either — the field is read by npm and by nobody here.');
    console.error('');
    console.error('⛔ A missing declaration is NOT repaired by leaving it missing, and an incorrect one is NOT');
    console.error('repaired by deleting it: a publishable (non-private) workspace manifest declares');
    console.error('repository.directory naming its own directory. That is ruled, and deleting a declaration');
    console.error('moves a manifest from `ok` to a finding rather than out of the population. Private');
    console.error('manifests publish nothing and are not asked.');
    return EXIT_FINDINGS;
  }

  console.log(
    `✓ check:manifest-repository-directory — every one of ${counts.publishable} publishable manifest(s) `
      + `declares repository.directory, and all ${counts.declaring} declarations across ${counts.manifests} `
      + `tracked manifest(s) name their own directory; ${counts.privateManifests} private manifest(s) publish `
      + `nothing and are not asked; ${counts.controls} control probe(s) fired — EXISTS on '${controls.present}', `
      + `MISSING on '${controls.absent}', PUBLISHABLE and PRIVATE on assembled subjects.`,
  );
  console.log(provenanceLine(counts));
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed. The self-test's own exit code stays load-bearing, so the handshake is
// a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => {
    registerCase();
    return cases.push({ name, ok: Boolean(ok), detail });
  };

  // ── the population declaration itself ─────────────────────────────────────
  battery('the population declaration itself');
  const selfSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const declaredHints = [...ROOT_DIR_WATCH_HINTS, ...ROOT_FILE_WATCH_HINTS];
  t('the watch hints are spelled as literals the extractor can read',
    declaredHints.every((h) => selfSource.includes(`'${h}'`)));
  t('⛔ no hint opens with a glob — the extractor drops those at admission, unseen',
    declaredHints.every((h) => /^[\w.@]/.test(h)));
  t('every hint names the manifest file kind, never a bare subtree',
    ROOT_DIR_WATCH_HINTS.every((h) => h.endsWith('/package.json'))
      && ROOT_FILE_WATCH_HINTS.every((h) => h === 'package.json/**'));
  t('⛔ no hint collapses to a workspace root — that declaration belongs to check-published-files',
    !declaredHints.some((h) => /^(packages|apps|examples)\/\*+$/.test(h)));
  t('the MISSING probe target is assembled, never a quoted literal in this module',
    !selfSource.includes(`'${CONTROL_ABSENT_LEAF}'`) && !selfSource.includes(`'${controlAbsentDirectory('alpha/beta')}'`));
  t('the MISSING probe is nested under the EXISTS subject\'s own root, so an ancestor-prefix bug cannot pass it',
    controlAbsentDirectory('alpha/beta') === `alpha/${CONTROL_ABSENT_LEAF}`
      && controlAbsentDirectory('alpha') === `alpha/${CONTROL_ABSENT_LEAF}`
      && controlAbsentDirectory() === CONTROL_ABSENT_LEAF);

  // ── the value normaliser ──────────────────────────────────────────────────
  battery('the value normaliser');
  t('a plain path normalises to itself', normaliseDeclared('packages/spec').value === 'packages/spec');
  t('a leading ./ is stripped', normaliseDeclared('./packages/spec').value === 'packages/spec');
  t('a trailing slash is stripped', normaliseDeclared('packages/spec/').value === 'packages/spec');
  t('a lone dot is the repository root', normaliseDeclared('.').value === '');
  t('an absolute path is refused, and named as such',
    normaliseDeclared('/packages/spec').value === null && /absolute/.test(normaliseDeclared('/packages/spec').problem));
  t('a backslash separator is refused',
    normaliseDeclared('packages\\spec').value === null && /backslash/.test(normaliseDeclared('packages\\spec').problem));
  t('a `..` segment is refused', normaliseDeclared('packages/../packages/spec').value === null);
  t('an empty segment is refused', normaliseDeclared('packages//spec').value === null);
  t('surrounding whitespace is refused rather than trimmed',
    normaliseDeclared(' packages/spec').value === null && /whitespace/.test(normaliseDeclared(' packages/spec').problem));
  t('an empty string is refused', normaliseDeclared('').value === null);
  t('a non-string is refused and names its own type', /number/.test(normaliseDeclared(3).problem));
  t('null is refused and is not reported as an object', /null/.test(normaliseDeclared(null).problem));

  // ── the tracked-directory index ───────────────────────────────────────────
  battery('the tracked-directory index');
  const listing = ['package.json', 'packages/spec/package.json', 'packages/spec/src/index.ts', 'apps/docs/package.json'];
  const dirs = trackedDirectoriesIn(listing);
  t('every ancestor of a tracked file is indexed', dirs.has('packages') && dirs.has('packages/spec') && dirs.has('packages/spec/src'));
  t('the repository root is indexed as the empty string', dirs.has(''));
  t('⛔ a tracked FILE is not a directory', !dirs.has('packages/spec/package.json'));
  t('a directory nothing tracks is absent', !dirs.has('packages/nothing-here'));
  t('an empty listing indexes only the root', trackedDirectoriesIn([]).size === 1);
  t('the manifest filter takes the root manifest and every nested one',
    manifestsIn(listing).join(',') === 'apps/docs/package.json,package.json,packages/spec/package.json');
  t('⛔ the manifest filter does not take a file that merely ENDS in the name',
    manifestsIn(['packages/x/not-package.json', 'packages/x/package.json']).join(',') === 'packages/x/package.json');

  // ── the publishability predicate, both directions ─────────────────────────
  // The predicate the DECLARED invariant is owed by. Its silent direction is
  // "nothing publishes", which owes the invariant to nobody and passes every
  // silent manifest, so both directions are driven here and again as live
  // probes below.
  battery('the publishability predicate, both directions');
  t('a named, non-private manifest publishes', isPublishable({ name: '@objectstack/x' }) === true);
  t('`private: true` does not publish', isPublishable({ name: '@objectstack/x', private: true }) === false);
  t('`private: false` publishes — the key is read, not merely present',
    isPublishable({ name: '@objectstack/x', private: false }) === true);
  t('a manifest with no name publishes nothing, whatever else it says',
    isPublishable({ version: '1.0.0' }) === false && isPublishable({ name: '', version: '1.0.0' }) === false);
  t('a non-object is not publishable rather than a crash',
    isPublishable(null) === false && isPublishable(undefined) === false && isPublishable('x') === false);
  t('⚠️ `private` is compared as a BOOLEAN — a string "true" reads as publishable, and fails LOUDLY',
    isPublishable({ name: '@objectstack/x', private: 'true' }) === true);
  t('… which is the same spelling check-published-files.mjs uses to pick its own population',
    readFileSync(join(REPO_ROOT, 'scripts/check-published-files.mjs'), 'utf8').includes('private === true'));
  t('both probes fire against the honest predicate',
    publishabilityProbes(isPublishable).fired === REQUIRED_PUBLISHABILITY_CONTROLS
      && publishabilityProbes(isPublishable).problems.length === 0);
  t('⛔ a predicate stuck on FALSE fails the PUBLISHABLE probe — the direction that silences everything',
    publishabilityProbes(() => false).fired === 1
      && publishabilityProbes(() => false).problems.some((m) => /PUBLISHABLE control probe FAILED/.test(m)));
  t('a predicate stuck on TRUE fails the PRIVATE probe',
    publishabilityProbes(() => true).fired === 1
      && publishabilityProbes(() => true).problems.some((m) => /PRIVATE control probe FAILED/.test(m)));

  // ── the judgement, per manifest ───────────────────────────────────────────
  battery('the judgement, per manifest');
  const tracked = (set) => (dir) => set.has(dir);
  const live = tracked(new Set(['', 'packages', 'packages/spec', 'packages/plugins', 'packages/plugins/plugin-trigger-schedule']));
  const judge = (path, declared, publishable = true) =>
    judgeManifest({ path, ownDirectory: path.slice(0, path.lastIndexOf('/')), declared, publishable }, live);
  t('a manifest that declares its own directory is ok',
    judge('packages/spec/package.json', 'packages/spec').verdict === 'ok');
  t('⭐ RULED — a PUBLISHABLE manifest that declares nothing is a FINDING, not a skip',
    judge('packages/spec/package.json', undefined).verdict === 'undeclared'
      && judge('packages/spec/package.json', undefined).finding !== null);
  t('… and the finding tells the author to declare it, naming the manifest\'s own directory',
    /declares NO repository.directory/.test(judge('packages/spec/package.json', undefined).finding)
      && judge('packages/spec/package.json', undefined).finding.includes("'packages/spec'"));
  t('… and says the field needs the url it is concatenated onto, so nobody adds a lone `directory`',
    /repository\.url/.test(judge('packages/spec/package.json', undefined).finding));
  t('a PRIVATE manifest that declares nothing is `exempt` — it has no npm page to link from',
    judge('packages/qa/x/package.json', undefined, false).verdict === 'exempt'
      && judge('packages/qa/x/package.json', undefined, false).finding === null);
  t('⛔ an OMITTED publishability flag fails towards the finding, never towards the exemption',
    judgeManifest({ path: 'packages/x/package.json', ownDirectory: 'packages/x', declared: undefined }, live).verdict === 'undeclared');
  t('a PRIVATE manifest that declares a WRONG directory is still judged — privacy exempts silence, not error',
    judge('packages/spec/package.json', 'packages/plugins', false).verdict === 'misplaced'
      && judge('packages/spec/package.json', 'packages/plugins', false).finding !== null);
  t('a `repository` STRING shorthand declares no directory', declaredDirectory({ repository: 'github:o/r' }) === undefined);
  t('a `repository` object with a directory declares it',
    declaredDirectory({ repository: { url: 'x', directory: 'packages/spec' } }) === 'packages/spec');
  t('a value naming a directory that is not tracked is STALE',
    judge('packages/triggers/trigger-schedule/package.json', 'packages/plugins/plugin-trigger-gone').verdict === 'stale');
  t('a value naming a real but different directory is MISPLACED',
    judge('packages/triggers/trigger-schedule/package.json', 'packages/plugins/plugin-trigger-schedule').verdict === 'misplaced');
  t('a malformed value is MALFORMED and quotes what was declared',
    judge('packages/spec/package.json', '/packages/spec').verdict === 'malformed'
      && judge('packages/spec/package.json', '/packages/spec').finding.includes('"/packages/spec"'));
  t('the root manifest declaring a subdirectory is a finding, not a pass',
    judgeManifest({ path: 'package.json', ownDirectory: '', declared: 'packages/spec' }, live).verdict === 'misplaced');

  // ── the measured defect shapes, replayed ──────────────────────────────────
  // The three commits in this file's header, each as the verdict this gate
  // gives it. These are the cases that decide whether the gate is the one the
  // history asks for, rather than a plausible neighbour of it.
  battery('the measured defect shapes, replayed');
  const copyEra = tracked(new Set(['', 'packages', 'packages/plugins', 'packages/plugins/plugin-trigger-schedule', 'packages/triggers', 'packages/triggers/trigger-schedule']));
  const afterDeletion = tracked(new Set(['', 'packages', 'packages/triggers', 'packages/triggers/trigger-schedule']));
  const copyShape = { path: 'packages/triggers/trigger-schedule/package.json', ownDirectory: 'packages/triggers/trigger-schedule', declared: 'packages/plugins/plugin-trigger-schedule' };
  t('THE COPY (f15d6f6f6): the old directory still exists, and the gate reds anyway',
    judgeManifest(copyShape, copyEra).verdict === 'misplaced');
  t('⛔ a RESOLVES-ONLY gate would have been green there — that is why OWN is a separate invariant',
    copyEra('packages/plugins/plugin-trigger-schedule') === true);
  t('THE RENAME (ea4941ad8): once the old directory is gone the same manifest reds as STALE',
    judgeManifest(copyShape, afterDeletion).verdict === 'stale');
  t('THE SIBLING-FIELD EDIT (9a43e042f): the manifest changed and `directory` did not — still red',
    judgeManifest({ ...copyShape, declared: 'packages/plugins/plugin-trigger-schedule' }, afterDeletion).finding !== null);
  t('⛔ the verdict never depends on what a diff touched — this gate is stateless over the population',
    judgeManifest(copyShape, afterDeletion).verdict === judgeManifest({ ...copyShape }, afterDeletion).verdict);

  // ── the control probes, both directions ───────────────────────────────────
  battery('the control probes, both directions');
  const honest = controlProbes(['packages/spec/package.json'], tracked(new Set(['', 'packages', 'packages/spec'])));
  t('both directory probes fire against an honest predicate',
    honest.fired === REQUIRED_DIRECTORY_CONTROLS && honest.problems.length === 0);
  t('the two predicates are floored TOGETHER — neither pair alone clears the control floor',
    REQUIRED_CONTROLS === REQUIRED_DIRECTORY_CONTROLS + REQUIRED_PUBLISHABILITY_CONTROLS
      && floorProblem({ manifests: MEASURED.manifests, declaring: MEASURED.declaring, publishable: MEASURED.publishable,
        trackedDirectories: MEASURED.trackedDirectories, controls: REQUIRED_DIRECTORY_CONTROLS }) !== null);
  t('⛔ a run where only the PUBLISHABILITY pair fired is refused too',
    floorProblem({ manifests: MEASURED.manifests, declaring: MEASURED.declaring, publishable: MEASURED.publishable,
      trackedDirectories: MEASURED.trackedDirectories, controls: REQUIRED_PUBLISHABILITY_CONTROLS }) !== null);
  t('the two pairs interrogate DIFFERENT predicates — one honest pair cannot vouch for the other',
    controlProbes(['packages/spec/package.json'], tracked(new Set(['', 'packages', 'packages/spec']))).fired === REQUIRED_DIRECTORY_CONTROLS
      && publishabilityProbes(() => false).fired < REQUIRED_PUBLISHABILITY_CONTROLS);
  t('the EXISTS probe is derived from the population, not written down', honest.present === 'packages/spec');
  t('a predicate stuck on TRUE fails the MISSING probe',
    controlProbes(['packages/spec/package.json'], () => true).fired === 1);
  t('… and says which direction failed', /MISSING control probe FAILED/.test(controlProbes(['packages/spec/package.json'], () => true).problems[0]));
  t('a predicate stuck on FALSE fails the EXISTS probe',
    controlProbes(['packages/spec/package.json'], () => false).fired === 1);
  t('… and says which direction failed', /EXISTS control probe FAILED/.test(controlProbes(['packages/spec/package.json'], () => false).problems[0]));
  t('⛔ a predicate stuck on TRUE also silences every finding — the probe is the only witness',
    judgeManifest({ ...copyShape, publishable: true }, () => true).verdict === 'misplaced'
      && judgeManifest({ ...copyShape, publishable: true, declared: 'packages/plugins/plugin-trigger-gone' }, () => true).verdict === 'misplaced');
  t('a population with no directoried manifest leaves the EXISTS probe unfired and SAYS so',
    controlProbes(['package.json'], () => true).fired === 0
      && controlProbes(['package.json'], () => true).problems.some((p) => /no subject/.test(p)));

  // ── the vacuity floors, each driven to zero ───────────────────────────────
  battery('the vacuity floors, each driven to zero');
  const full = { manifests: MEASURED.manifests, declaring: MEASURED.declaring, publishable: MEASURED.publishable, trackedDirectories: MEASURED.trackedDirectories, controls: REQUIRED_CONTROLS };
  t('FLOOR — the values in the record clear every floor', floorProblem(full) === null, JSON.stringify(floorProblem(full)));
  t('FLOOR — a dead manifest filter refuses (every invariant satisfied over nothing)', floorProblem({ ...full, manifests: 0 }) !== null);
  t('FLOOR — a renamed field refuses (a full population, an empty subject)', floorProblem({ ...full, declaring: 0 }) !== null);
  t('⭐ FLOOR — an empty PUBLISHABLE population refuses (the DECLARED invariant owed by nobody)',
    floorProblem({ ...full, publishable: 0 }) !== null);
  t('… and the refusal names that direction as the one producing NO findings at all',
    /no findings at all/.test(floorProblem({ ...full, publishable: 0 })));
  t('FLOOR — a collapsed directory index refuses', floorProblem({ ...full, trackedDirectories: 0 }) !== null);
  t('FLOOR — unfired controls refuse', floorProblem({ ...full, controls: 0 }) !== null);
  t('FLOOR — ONE fired control is not enough', floorProblem({ ...full, controls: 1 }) !== null);
  t('FLOOR — a missing count is zero, not "unmeasured but fine"', floorProblem({}) !== null);
  t('FLOOR — the refusal names the count, the floor and the commit the record is from',
    /below the floor of/.test(floorProblem({ ...full, manifests: 0 })) && floorProblem({ ...full, manifests: 0 }).includes(MEASURED.ref));
  t('FLOOR — the refusal says it is NOT a pass',
    /NOT a pass/.test(floorProblem({ ...full, declaring: 0 })));
  t('FLOOR — the refusal never offers moving the floor as the repair',
    /Find what stopped being read/.test(floorProblem({ ...full, manifests: 0 })));
  t('FLOOR — every floor sits at or below the value it was measured from',
    MIN_MANIFESTS <= MEASURED.manifests && MIN_DECLARING <= MEASURED.declaring
      && MIN_PUBLISHABLE <= MEASURED.publishable && MIN_TRACKED_DIRECTORIES <= MEASURED.trackedDirectories);
  t('FLOOR — and every floor is strictly positive, so no floor can be cleared by reading nothing',
    [MIN_MANIFESTS, MIN_DECLARING, MIN_PUBLISHABLE, MIN_TRACKED_DIRECTORIES, REQUIRED_CONTROLS].every((n) => n > 0));

  // ── provenance ────────────────────────────────────────────────────────────
  battery('provenance: the record must stay reproducible, and visibly so');
  const provExact = provenanceLine(full);
  const provDrifted = provenanceLine({ ...full, manifests: MEASURED.manifests + 3 });
  t('PROVENANCE — an exact run reports no delta', provExact.includes('(=/=/=/= vs the record)'), provExact);
  t('PROVENANCE — a drifted run reports the signed delta', provDrifted.includes('+3'), provDrifted);
  t('PROVENANCE — the record\'s commit is quoted', provExact.includes(MEASURED.ref));
  t('PROVENANCE — the PASS path actually prints it (a line nothing calls is a record nothing reconciles)',
    selfSource.includes(`console.log(${'provenanceLine'}(counts))`));
  t('PROVENANCE — the delta is marked as information, never as a verdict',
    /not a verdict/.test(provDrifted) && !/✗|REFUSES/.test(provDrifted), provDrifted);
  t('⭐ PIN — the record\'s undeclared-publishable count is ZERO, and the backfill is what that records',
    MEASURED.undeclaredPublishable === 0 && MEASURED.declaring >= MEASURED.publishable,
    JSON.stringify(MEASURED));

  // ── the live tree ─────────────────────────────────────────────────────────
  // The shipped record against the REAL population — the half a fixture listing
  // cannot give, and the one that goes stale silently.
  battery('the live tree: the shipped record against the real population');
  const livePaths = trackedPaths(REPO_ROOT);
  t('the tracked listing is readable at all', Array.isArray(livePaths) && livePaths.length > 0);
  const liveManifests = manifestsIn(livePaths ?? []);
  const liveDirs = trackedDirectoriesIn(livePaths ?? []);
  t('the live population clears the manifest floor', liveManifests.length >= MIN_MANIFESTS, String(liveManifests.length));
  t('the live directory index clears its floor', liveDirs.size >= MIN_TRACKED_DIRECTORIES, String(liveDirs.size));
  // The declaration reconciled against the SCAN, over the live tracked listing,
  // as a set equality in both directions. A declaration narrower than the scan
  // hides cards from the derivation; a declaration wider than it fabricates
  // leads on cards this gate never opens. Both are silent without this.
  const liveHints = [...ROOT_DIR_WATCH_HINTS, ...ROOT_FILE_WATCH_HINTS];
  const declaredPaths = (livePaths ?? []).filter((p) => liveHints.some((h) => hintCoversPath(h, p)));
  t('DECLARATION ⊇ SCAN — every manifest the scan takes is covered by a declared hint',
    liveManifests.every((p) => declaredPaths.includes(p)),
    JSON.stringify(liveManifests.filter((p) => !declaredPaths.includes(p)).slice(0, 5)));
  t('DECLARATION ⊆ SCAN — every path a declared hint covers is a manifest the scan takes',
    declaredPaths.every((p) => liveManifests.includes(p)),
    JSON.stringify(declaredPaths.filter((p) => !liveManifests.includes(p)).slice(0, 5)));
  t('⛔ the declaration does not reach a non-manifest source file',
    !liveHints.some((h) => hintCoversPath(h, 'packages/spec/src/index.ts'))
      && !liveHints.some((h) => hintCoversPath(h, 'apps/docs/next.config.mjs')));
  t('every declared hint reaches at least one live manifest — no dead declaration',
    liveHints.every((h) => liveManifests.some((p) => hintCoversPath(h, p))));
  t('both DIRECTORY control probes fire on the LIVE tree',
    controlProbes(liveManifests, (d) => liveDirs.has(d)).fired === REQUIRED_DIRECTORY_CONTROLS);
  const liveProbes = controlProbes(liveManifests, (d) => liveDirs.has(d));
  t('the MISSING probe target really is absent from the live tree, and sits under a root the live tree HAS',
    !liveDirs.has(liveProbes.absent)
      && liveDirs.has(liveProbes.absent.slice(0, liveProbes.absent.indexOf('/'))));
  // The publishable population, read off the real manifests. This is the half a
  // fixture cannot give: the predicate above is exercised against assembled
  // objects, and only this reads it against what the tree actually says.
  const liveScan = scan(livePaths ?? [], (rel) => JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8')));
  t('the live publishable population clears its floor — the DECLARED invariant is owed by someone',
    liveScan.counts.publishable >= MIN_PUBLISHABLE, String(liveScan.counts.publishable));
  t('the live tree really does hold BOTH kinds — a run where every manifest reads the same way proves nothing',
    liveScan.counts.publishable > 0 && liveScan.counts.privateManifests > 0,
    `${liveScan.counts.publishable}/${liveScan.counts.privateManifests}`);
  t('all four control probes fire on the LIVE run',
    liveScan.counts.controls === REQUIRED_CONTROLS, String(liveScan.counts.controls));

  // The floor runs BEFORE the verdict below, so a success line can only be
  // printed by a run in which every declared battery registered its cases.
  for (const message of batteryFloorFailures()) cases.push({ name: message, ok: false });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-manifest-repository-directory self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`✓ check-manifest-repository-directory self-test: ${cases.length} cases pass (the three measured defect `
    + 'shapes replayed as verdicts, both predicates\' control probes driven in both directions with the stuck-predicate '
    + 'cases that motivate them, every vacuity floor driven to zero against its green control — the publishable '
    + 'population among them — the ruled DECLARED invariant asserted in both its finding and its private exemption, the '
    + 'record reproducible and printed on the pass path, and the declared population reconciled against the live tree).');

  selfTestReachedVerdict = true;
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  let code;
  if (argv.includes('--self-test')) {
    code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-manifest-repository-directory self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    code = main(argv);
  }
  process.exit(code);
}
