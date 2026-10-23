// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins that `build-schemas.ts --check` — the script behind
// `check:authorable-surface`, one of the eight generated-artifact gates
// `check:generated` runs — reports and NEVER writes (#4711).
//
// The defect these tests exist for: the manifest ratchet had no `CHECK`
// discriminator at all. `--check` recomputed the emitted schema set and, on any
// addition, rewrote the tracked `json-schema.manifest.json` in place and exited
// 0. Two things follow, and both were observed:
//
//   1. A "check" edited the working tree. The developer's own manifest content
//      was overwritten by a command whose entire job is to look — which is how
//      `git stash pop` / worktree / merge-conflict work fails for a reason
//      nobody traces back to a gate.
//   2. The additions branch could never go red in CI. Seven of the eight
//      generated artifacts mean "stale ⇒ fail, run the generator"; this one
//      meant "stale ⇒ I'll write it for you", inside the same `check:generated`
//      summary. A gate that repairs what it is meant to detect reports success
//      forever.
//
// So the assertions here are deliberately about the SIDE EFFECT and the EXIT
// CODE, not about the diff arithmetic (which was always correct): every check
// case compares the manifest bytes before and after the run.
//
// ── Why a sandbox rather than the real package ────────────────────────────
// The script resolves every path from its own `__dirname`, so running it in
// place would mutate the repo's tracked `json-schema.manifest.json` — and under
// `turbo run test` a `pnpm --filter @objectstack/spec build` (whose first step
// is `gen:schema`) can be writing that very file concurrently, which would make
// these tests both destructive and flaky. Instead each run happens in a temp
// tree that COPIES `scripts/` (so `__dirname` lands there) and symlinks the
// read-only inputs — `src/`, `node_modules/`, `package.json`. That keeps the
// production code path byte-for-byte: no test-only seam is added to the gate,
// because a seam is itself a place where the gate can differ from what CI runs.
//
// The sandbox is also a REAL git repository with a fabricated
// `refs/remotes/origin/main`, because the authorable-surface deletion check
// (#4650) anchors on the baseline at the merge base with origin/main — the one
// version of the file a PR cannot rewrite. Fabricating the ref (rather than
// injecting a base through some test-only env var) keeps that discipline: the
// gate runs exactly the git resolution CI runs.
//
// It also carries the in-tree anchor `authorable-surface.base.json` (#5235),
// seeded authentic: its `baseRev` is a sandbox commit reachable from
// `origin/main` and its keys ARE that commit's baseline. Deleting the ref is
// then a faithful model of a build environment with no route to GitHub — the
// in-tree-anchor block (#5235, `build-schemas-check-mode.anchor.test.ts`) drives
// exactly that.
//
// ── The split (#25372) ─────────────────────────────────────────────────────
// This module is the shared half of `build-schemas-check-mode.*.test.ts`: the
// sandbox builders, the fixture git discipline, the `run()` spawner and every
// constant more than one file reads. It was one 5135-line test file, and as
// one file it was the slowest file of the whole `Test Core` run (841.97 s,
// 92 tests): vitest runs a FILE's tests one at a time, so the repo project's
// other workers sat idle behind it. Split, the files run on separate workers.
// It is NOT a test file (no `.test.ts`), so neither vitest project collects it;
// each test file registers the shared sandbox with `useSharedSandbox()`.

import { expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitFreeEnv } from '../../../scripts/git-env.mjs';
import { CONVERSIONS_BY_MAJOR } from '../src/conversions/registry';
import { MIGRATIONS_BY_MAJOR } from '../src/migrations/registry';
// The generator's own naming rule: the file name every registration remedy must
// print, so an author who follows a gate writes a file the generator accepts.
import { shardNameFor } from './build-migration-registry';
import {
  AUTHORABLE_SURFACE_DIR_NAME,
  SCHEMA_MANIFEST_DIR_NAME,
  aggregateCategoryShards,
  authorableSurfaceShardTexts,
  schemaManifestShardTexts,
  writeShards,
  type ShardArrayField,
} from './lib/sharded-artifacts';
import {
  AUTHORABLE_DEFAULTS_DIR_NAME,
  authorableDefaultsShardTexts,
  parseDefaultEntries,
} from './lib/authorable-defaults';
import { UNEMITTED_BASELINE_FILE } from './lib/unemitted-schemas';
import { DROPPED_REFINEMENTS_BASELINE_FILE } from './lib/dropped-refinements';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PKG = path.resolve(HERE, '..');

/** The repo-root `scripts/` — the fixture root mirrors the repo, so the
 *  generator's own `../../../scripts` import resolves inside the sandbox
 *  (#16175). Handed in by each test file through `useSharedSandbox()`, which is
 *  where this out-of-package input is NAMED: `check:cross-package-test-inputs`
 *  reads a test file's own source, not the modules it imports (#25372). */
let rootScripts: string;

export const TSX = path.join(PKG, 'node_modules', '.bin', 'tsx');

/**
 * Both ratchets are DIRECTORIES since #5837 (one shard per category), so every
 * fixture here writes a shard set and every "the file was not touched"
 * assertion compares the whole set's bytes. That is the same assertion it always
 * was: the gate reads the directory as one set, so "these exact bytes, still"
 * means the same thing it meant about one file.
 */
export function shardBytes(dir: string): string {
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .sort()
    .map((f) => `=== ${f} ===\n${fs.readFileSync(path.join(dir, f), 'utf8')}`)
    .join('');
}

/** Write a key set as canonical authorable-surface shards; returns the bytes. */
export function writeSurfaceShards(dir: string, keys: readonly string[]): string {
  writeShards(dir, authorableSurfaceShardTexts([...keys].sort()));
  return shardBytes(dir);
}

/** Write a def-key set as canonical manifest shards; returns the bytes. */
export function writeManifestShards(dir: string, schemas: readonly string[]): string {
  writeShards(dir, schemaManifestShardTexts([...schemas].sort()));
  return shardBytes(dir);
}

/** Aggregate a shard directory back into its sorted key set. */
function readShardKeys(dir: string, field: ShardArrayField): string[] {
  return aggregateCategoryShards(dir, field)?.entries ?? [];
}

/**
 * Write the recorded default fingerprints as canonical authorable-defaults
 * shards (#4666).
 *
 * The sandbox has to carry this artifact for the same reason it carries the
 * authorable-surface one: the default-value ratchet runs on every invocation,
 * so a fixture tree without it is not a smaller version of a real tree — it is
 * a tree whose generated record is missing, which `--check` reports as such.
 * Seeding it keeps every fixture below judging the contract it means to judge.
 */
export function writeDefaultsShards(dir: string, entries: readonly string[]): string {
  writeShards(dir, authorableDefaultsShardTexts(parseDefaultEntries([...entries].sort())));
  return shardBytes(dir);
}

/**
 * Every run loads the entire spec surface and emits ~1700 JSON Schemas (~7s
 * alone, more under turbo's parallel test load). A timeout here should mean
 * "the script hung", not "the runner was busy".
 */
export const SPAWN_TIMEOUT_MS = 180_000;

/** The mark `authorable-surface.json` puts on a tombstoned key (build-schemas.ts). */
export const RETIRED_MARK = ' [RETIRED]';

/** A schema key the committed manifest carries; dropping it fakes "one addition pending". */
export const KNOWN_KEY = 'ui/View';

/** A key no build can emit — the `missing` (disappearance) ratchet's input. */
export const PHANTOM_KEY = 'ui/ZzzNeverEmittedByAnyBuild';

/** The fixture repo every module-level helper below currently operates on. The
 *  three git-topology blocks mount their OWN for their duration (#9068). */
export let sandbox: string;

/** The shared sandbox the rest of the file uses, kept so a block that mounted
 *  its own can hand the module-level handles back. */
let sharedSandbox: string;

let script: string;

let manifestDir: string;

export let surfaceDir: string;

let defaultsDir: string;

export let surfaceBasePath: string;

export let pristine: string[];

export let pristineSurface: string[];

export let pristineDefaults: string[];

/** The generator's own description line for the in-tree anchor, so fixtures
 *  written here are byte-canonical exactly the way `gen:schema` writes it —
 *  a hand-rolled string would trip the anchor's own hand-edit check (#5235). */
export let surfaceBaseDescription: string;

// ── #9068 — a fixture repo inherits nothing from the machine it runs on ──────
//
// The defect this closes: a merge-queue full-suite run lost TEN of this file's
// tests to one root error — `fatal: Not a valid commit name <sha>`, followed by
// `unable to read tree (<the same sha>)` on `git checkout -f main`. The sha was
// a commit of no real tree: a fixture commit one of these repos had made itself,
// minutes earlier, whose object had left the fixture's own object store between
// being created and being used.
//
// The reachable mechanism, reproduced rather than assumed. Three describe blocks
// (`build-schemas-check-mode.git-topology.test.ts`) deliberately write `.git/shallow` — that is the environment they model,
// because CI checks out `--depth=1`. Inside that window every commit behind the
// graft point is unreachable BY DEFINITION, so a `git gc` running there prunes
// the fixture's own history and leaves the refs pointing at objects that are
// gone. Measured directly, on a five-commit fixture in exactly that state:
//
//     $ git gc --quiet                      # ambient [gc] pruneExpire/reflogExpire = now
//     $ git merge-base HEAD <commit made moments ago>
//     fatal: Not a valid commit name bf57992dfc53…     ← the reported signature
//
// The same sequence with the repo-local config below in place keeps every
// commit, because a repository's own config outranks the global one — so this
// holds even for a gc that something OTHER than this file started.
//
// Two layers, because they fail differently:
//
//   * `HERMETIC_ENV` keeps ambient config and any leaked `GIT_*` pointer out of
//     every git this file runs — including the ones `build-schemas.ts` itself
//     spawns inside a fixture (it shells out to `merge-base`, `cat-file` and a
//     `--depth=1` fetch), which is why `run()` carries it too. A leaked `GIT_DIR`
//     or `GIT_OBJECT_DIRECTORY` is the OTHER way to get a sha that is real to the
//     process that made it and phantom to the one that reads it.
//   * `initFixtureRepo` writes the same discipline into the repo, where it binds
//     git processes this file never launched.
//
// Neither layer changes what any test asserts: no fixture is built differently,
// only insulated. What ISN'T here, deliberately: serializing these blocks. They
// are already serial — vitest runs a file's tests one at a time, and every repo
// here is an `fs.mkdtemp`, so no concurrently running test FILE can name one.

/* #16644 -- a hand-maintained allowlist of ten GIT_* location variables used to stand
 * here. It is retired in favour of the blanket strip in `scripts/git-env.mjs`, and the
 * constant is not re-spelled anywhere in this file so that a census of the retired shape
 * does not match this paragraph.
 *
 * The reason the allowlist goes rather than gets one more entry: it had to be kept level
 * with git's own list of location variables, and its failure mode is that THE KEY IT
 * MISSES IS THE KEY THAT BITES. `gitFreeEnv()` removes every GIT_-prefixed key instead,
 * which is the shape #16624 landed and #16753 applied. ⛔ One spelling in the repo, not
 * two -- no "either is fine" transition state.
 *
 * Every git this file spawns is LOCAL-ONLY: it operates on the `fs.mkdtemp` fixture named
 * by its `cwd`, so the blanket strip takes no transport configuration away from it. */

/** The environment every fixture git — and every generator run inside one — gets. */
export const HERMETIC_ENV: NodeJS.ProcessEnv = (() => {
  const env = gitFreeEnv();
  // git's own documented "read no config file" spellings. `/dev/null` parses as
  // an empty config, which is what makes `init.templateDir`, `core.hooksPath`
  // and any ambient `[gc]` block unable to reach a fixture.
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
})();

/** Passed to every fixture git invocation — including the `init` that runs
 *  before the repo-local config below exists. Identity first (with the global
 *  config closed, there is no other source for it), then the maintenance switches. */
const FIXTURE_GIT_ARGS = [
  '-c', 'user.name=build-schemas-test',
  '-c', 'user.email=test@example.invalid',
  '-c', 'gc.auto=0',
  '-c', 'maintenance.auto=false',
  '-c', 'gc.pruneExpire=never',
  '-c', 'gc.reflogExpire=never',
  '-c', 'gc.reflogExpireUnreachable=never',
];

/**
 * A one-line state read of a fixture repo, appended to whatever git said.
 *
 * The whole cost of #9068 was that its signature named a sha and nothing else:
 * one triage lap went into establishing that the commit belonged to no tree of
 * this repository. Failing loudly is what this helper's `throw` was already for;
 * this is the half that says WHICH repo, and in what state.
 */
function describeFixtureRepo(cwd: string): string {
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return `\n  [fixture ${cwd}: no .git directory — the repo itself is gone]`;
  }
  const probe = (...args: string[]): string => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: HERMETIC_ENV });
    return r.status === 0 ? (r.stdout ?? '').trim().replace(/\n/g, ' ') : `<exit ${r.status}>`;
  };
  return (
    `\n  [fixture ${cwd}: HEAD=${probe('rev-parse', '--short', 'HEAD')}` +
    ` main=${probe('rev-parse', '--short', 'main')}` +
    ` origin/main=${probe('rev-parse', '--short', 'refs/remotes/origin/main')}` +
    ` shallow=${probe('rev-parse', '--is-shallow-repository')}` +
    // The fact #9068 turned on: does the object a ref names still EXIST. A ref
    // file resolves to a sha whether or not the object behind it is still there.
    ` main-object=${probe('cat-file', '-t', 'main')}]`
  );
}

/** Run git in `cwd`; throws on failure so a broken fixture is loud (and says
 *  which fixture, and in what state — #9068). */
export function gitIn(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', [...FIXTURE_GIT_ARGS, ...args], {
    cwd,
    encoding: 'utf8',
    env: HERMETIC_ENV,
  });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (${r.status}): ${r.stderr}${describeFixtureRepo(cwd)}`,
    );
  }
  return (r.stdout ?? '').trim();
}

/** git's exit status only — for the probes whose NEGATIVE answer is the fact
 *  being read, which `gitIn` would throw on. */
export function gitStatusIn(cwd: string, ...args: string[]): number {
  return (
    spawnSync('git', [...FIXTURE_GIT_ARGS, ...args], { cwd, encoding: 'utf8', env: HERMETIC_ENV })
      .status ?? -1
  );
}

/**
 * `git init` plus the repo-local half of the isolation above.
 *
 * Local config is the layer that survives a git process this file did not start:
 * `gc.auto=0` stops our own commits from triggering one, and the `never` expiries
 * mean that a gc arriving from anywhere else — an ambient maintenance schedule, a
 * `[gc]` block in someone's global config — finds nothing it is allowed to drop.
 */
export function initFixtureRepo(dir: string): void {
  gitIn(dir, 'init', '-q', '-b', 'main', '.');
  for (const [key, value] of [
    ['gc.auto', '0'],
    ['gc.autoDetach', 'false'],
    ['maintenance.auto', 'false'],
    ['gc.pruneExpire', 'never'],
    ['gc.reflogExpire', 'never'],
    ['gc.reflogExpireUnreachable', 'never'],
    // Reflogs are the other thing standing between a fixture commit and a prune,
    // and an ambient `core.logAllRefUpdates=false` would have taken them away.
    ['core.logAllRefUpdates', 'true'],
  ] as const) {
    gitIn(dir, 'config', key, value);
  }
}

/** Run git in the mounted sandbox repo; throws so a broken fixture is loud. */
export const git = (...args: string[]): string => gitIn(sandbox, ...args);

/**
 * Write the in-tree anchor (#5235) in the generator's exact canonical form:
 * `{ description, baseRev, keys }`, two-space indent, trailing newline. Anything
 * else is a hand-edit as far as the gate is concerned, which is the point of the
 * file — so fixtures must go through here rather than patching bytes.
 */
export function seedSurfaceBase(baseRev: string, mutate: (keys: string[]) => string[]): string {
  const keys = mutate([...pristineSurface]);
  const text = JSON.stringify({ description: surfaceBaseDescription, baseRev, keys }, null, 2) + '\n';
  fs.writeFileSync(surfaceBasePath, text);
  return text;
}

export const readSurfaceBase = () => fs.readFileSync(surfaceBasePath, 'utf8');

/**
 * Point the module-level fixture handles at `dir`, so every helper in this file
 * (`git`, `run`, `seedBase`, `seedSurface`, `seedSurfaceBase`, …) operates on
 * that repo from the next call onwards.
 *
 * Safe because vitest runs one test at a time within a file: there is never a
 * second case reading these handles while a block swaps them at its own
 * `beforeAll`/`afterAll` boundary.
 */
function mountSandbox(dir: string): void {
  sandbox = dir;
  script = path.join(dir, 'scripts', 'build-schemas.ts');
  manifestDir = path.join(dir, SCHEMA_MANIFEST_DIR_NAME);
  surfaceDir = path.join(dir, AUTHORABLE_SURFACE_DIR_NAME);
  defaultsDir = path.join(dir, AUTHORABLE_DEFAULTS_DIR_NAME);
  surfaceBasePath = path.join(dir, 'authorable-surface.base.json');
}

/**
 * The committed, package-root ledgers `build-schemas.ts` READS — every one of
 * them, mounted into a fixture tree as a set.
 *
 * A list rather than one constant because this is a population that grows: the
 * generator resolves each of these from its own `__dirname/..`, so a tree that
 * copies `scripts/` without one of them fails that ledger's gate on a MISSING
 * artifact, before reaching whatever the fixture is about. That is not a
 * hypothetical — it is how the never-published ledger (#16431) came to need one
 * line in each of the five sandbox builders in these files, and how the
 * dropped-refinement ledger (#18670) reddened 36 of them at once: every fixture
 * that expects `status` 0 got a 1 that had nothing to do with its subject.
 *
 * ⇒ A new package-root ledger is ONE entry here, not a fifth mount call
 * somebody has to remember at each builder.
 */
const COMMITTED_LEDGERS = [UNEMITTED_BASELINE_FILE, DROPPED_REFINEMENTS_BASELINE_FILE] as const;

/**
 * Copy every committed ledger into a fixture tree.
 *
 * Copied rather than symlinked so a fixture may mutate one without writing to
 * the real file; `src/` is the fixture's own, so the population a run observes
 * is the repo's and the copied ledgers are green without any seeding.
 */
export function mountCommittedLedgers(dir: string): void {
  for (const ledger of COMMITTED_LEDGERS) {
    fs.cpSync(path.join(PKG, ledger), path.join(dir, ledger));
  }
}

/**
 * A fixture package directory at the repo's own DEPTH: `<tmp-root>/packages/spec`,
 * with `<tmp-root>/scripts` symlinked to this repo's root scripts.
 *
 * Every fixture in this file runs the real `build-schemas.ts` out of a copied
 * `scripts/`, which works because that script resolves everything from its own
 * `__dirname`. Since #16175 it resolves ONE thing from above the package — the
 * repo-root freshness module that writes the generation stamp
 * (`../../../scripts/check-regen-pending.mjs`) — and from a flat `/tmp/x/scripts`
 * that path walks off the top of the filesystem: the spawn dies with
 * MODULE_NOT_FOUND before any assertion runs, which is a fixture reporting on
 * its own shape rather than on the generator.
 *
 * Depth rather than a stub, because the header's rule holds: no test-only seam.
 * The root scripts are SYMLINKED rather than copied — they are read-only here,
 * and a copy would be a second definition of the digest whose single definition
 * is the entire point of that module.
 */
export function fixtureTree(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dir = path.join(root, 'packages', 'spec');
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(rootScripts, path.join(root, 'scripts'));
  return dir;
}

/** The fixture ROOT a package dir sits under — what teardown removes. */
export const sandboxRoot = (pkgDir: string): string => path.resolve(pkgDir, '..', '..');

/**
 * Build a sandbox — a temp tree that COPIES `scripts/` (so `__dirname` lands
 * there) and symlinks the read-only inputs — mount it, and seed it to the state
 * every block starts from: canonical ratchets, a real git repo, and an
 * `origin/main` holding the committed baseline.
 *
 * A factory rather than a one-off because the three git-topology blocks each
 * take their own (#9068). They fork branches, reset them, abandon commits and
 * mark the repo shallow; sharing ONE repo across them meant a single lost object
 * surfaced as ten failures spread over three blocks, none of which had done
 * anything wrong — and the block that HAD was invisible. A copy of `scripts/` is
 * 1.8 MB and the generation cost is per RUN, not per sandbox, so the isolation
 * costs a `cpSync` and a `git init` each.
 */
export function createSandbox(prefix: string): string {
  // The package sits TWO levels under a fixture root, mirroring the real
  // `<repo>/packages/spec` (#16175). A flat sandbox was faithful enough while
  // the generator resolved everything from its own `__dirname`; it now also
  // imports the repo-root freshness module (`../../../scripts/
  // check-regen-pending.mjs`, the writer of the generation stamp), and from a
  // flat `/tmp/x/scripts` that path walks off the top of the filesystem — the
  // spawn dies with MODULE_NOT_FOUND before a single assertion runs. Keeping
  // the depth is what lets these fixtures run the production import graph
  // instead of a reduced one, which is the property the header's "no test-only
  // seam" paragraph is about.
  const dir = fixtureTree(prefix);
  fs.cpSync(path.join(PKG, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  for (const entry of ['src', 'node_modules', 'package.json']) {
    fs.symlinkSync(path.join(PKG, entry), path.join(dir, entry));
  }
  mountCommittedLedgers(dir);
  mountSandbox(dir);
  // The authorable-surface ratchet runs after the manifest one; give it the
  // committed snapshot so a check that gets that far judges the same contract.
  writeSurfaceShards(surfaceDir, pristineSurface);
  // Same for the default-value ratchet (#4666), which runs after both: without
  // its committed record every fixture would fail on a missing artifact rather
  // than on the thing it is testing.
  writeDefaultsShards(defaultsDir, pristineDefaults);
  // Anchor for the #4650 deletion check: a git repo whose origin/main holds the
  // committed baseline. Only the baseline is tracked — src/node_modules stay
  // symlinked, untracked reads the same as any dirty worktree.
  initFixtureRepo(dir);
  git('add', AUTHORABLE_SURFACE_DIR_NAME, AUTHORABLE_DEFAULTS_DIR_NAME);
  git('commit', '-q', '-m', `baseline: committed ${AUTHORABLE_SURFACE_DIR_NAME}/`);
  // The in-tree anchor (#5235), authentic by construction: it mirrors the
  // baseline at the commit just made, which stays reachable from origin/main for
  // every fixture below (this repo's history is linear).
  seedSurfaceBase(git('rev-parse', 'HEAD'), (k) => k);
  git('add', 'authorable-surface.base.json');
  git('commit', '-q', '-m', 'baseline anchor: committed authorable-surface.base.json');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return dir;
}

/** Take a block's own sandbox down and hand the handles back to the shared one. */
export function releaseSandbox(dir: string): void {
  mountSandbox(sharedSandbox);
  fs.rmSync(sandboxRoot(dir), { recursive: true, force: true });
}

/**
 * Register the shared sandbox's lifecycle in the calling test file: read the
 * committed ratchets once, build the sandbox every block starts from, and take
 * it down at the end. Each `build-schemas-check-mode.*.test.ts` file calls this
 * once at its top level, so every file gets its OWN shared sandbox — files run
 * in parallel (#25372), and a sandbox is an `fs.mkdtemp`, so no two files can
 * name the same one. `rootScriptsDir` is the repo-root `scripts/` every
 * sandbox symlinks in (see `rootScripts`).
 */
export function useSharedSandbox(rootScriptsDir: string): void {
  rootScripts = rootScriptsDir;
  beforeAll(() => {
    pristine = readShardKeys(path.join(PKG, SCHEMA_MANIFEST_DIR_NAME), 'schemas');
    pristineSurface = readShardKeys(path.join(PKG, AUTHORABLE_SURFACE_DIR_NAME), 'keys');
    pristineDefaults = readShardKeys(path.join(PKG, AUTHORABLE_DEFAULTS_DIR_NAME), 'defaults');
    expect(pristine.length, `${SCHEMA_MANIFEST_DIR_NAME}/ is empty — it is a committed artifact`).toBeGreaterThan(0);
    expect(pristineSurface.length, `${AUTHORABLE_SURFACE_DIR_NAME}/ is empty — it is a committed artifact`).toBeGreaterThan(0);
    expect(
      pristineDefaults.length,
      `${AUTHORABLE_DEFAULTS_DIR_NAME}/ is empty — it is a committed artifact (#4666)`,
    ).toBeGreaterThan(0);
    const realBase = path.join(PKG, 'authorable-surface.base.json');
    if (!fs.existsSync(realBase)) {
      throw new Error(
        `packages/spec/authorable-surface.base.json is missing — it is a committed artifact (#5235). ` +
          `Run \`pnpm --filter @objectstack/spec gen:schema\` in a checkout that can reach origin/main.`,
      );
    }
    surfaceBaseDescription = (JSON.parse(fs.readFileSync(realBase, 'utf8')) as { description: string })
      .description;
    sharedSandbox = createSandbox('build-schemas-check-');
  });

  afterAll(() => {
    if (sharedSandbox) fs.rmSync(sandboxRoot(sharedSandbox), { recursive: true, force: true });
  });
}

export function run(args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): { status: number; output: string } {
  const r = spawnSync(TSX, [script, ...args], {
    cwd: sandbox,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    // The generator shells out to git itself (`merge-base`, `cat-file`, a
    // `--depth=1` fetch), so the fixture's isolation has to reach its children
    // too — a `GIT_DIR` inherited here would point them at another repo (#9068).
    env: { ...HERMETIC_ENV, ...extraEnv },
  });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * How `gen:schema` and `check:authorable-surface` actually run — both package
 * scripts export `OS_EAGER_SCHEMAS=1`, so `lazySchema()` returns the real schema
 * and every def key holds the instance the BFS walks.
 *
 * Left OFF by default, because it is: this file's other cases pin the gate's
 * reporting and its side effects, which the flag does not touch, and turning it
 * on for all of them would change a graph shape they were written against. But a
 * REACHABILITY case cannot be indifferent to it. Without the flag `lazySchema()`
 * hands back a Proxy, `zodByDefKey` holds the Proxy while the walk visits the
 * resolved target, and a def that IS a root's own child resolves through the
 * derived-clone bridge instead of by identity — 'reachable' either way, so the
 * gate's verdict is the same, but it is not the closure CI computes and
 * `reachableVia()` never answers 'root-graph'. #17356's acceptance is stated in
 * that vocabulary, so the #17356 pin reads both.
 */
export const EAGER_SCHEMAS_ENV: NodeJS.ProcessEnv = { OS_EAGER_SCHEMAS: '1' };

/** Seed the sandbox manifest shards from the committed set; returns the bytes. */
export function seedManifest(mutate: (schemas: string[]) => string[]): string {
  return writeManifestShards(manifestDir, mutate([...pristine]));
}

export const readManifest = () => shardBytes(manifestDir);

export const readManifestKeys = () => readShardKeys(manifestDir, 'schemas');

/** Write a mutated baseline to the sandbox worktree; returns the exact bytes. */
export function seedSurface(mutate: (keys: string[]) => string[]): string {
  return writeSurfaceShards(surfaceDir, mutate([...pristineSurface]));
}

/** Commit a BASE variant of the baseline and point origin/main at it. */
export function seedBase(mutate: (keys: string[]) => string[]): string {
  seedSurface(mutate);
  git('add', AUTHORABLE_SURFACE_DIR_NAME);
  git('commit', '-q', '--allow-empty', '-m', 'base variant');
  const sha = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', sha);
  return sha;
}

/** Earliest ADR-0087 registration matching a surface leaf — the gate's clause
 *  vocabulary (see check (b)/(c) in build-schemas.ts), reproduced here ONLY to
 *  validate fixture choices loudly, never to assert gate behaviour. */
export function minRegisteredMajorForLeaf(leaf: string): number | null {
  let min: number | null = null;
  const consider = (surface: string, major: number): void => {
    for (const clause of surface.split(' / ')) {
      if (clause.endsWith('.' + leaf)) min = min === null ? major : Math.min(min, major);
    }
  };
  for (const [major, list] of Object.entries(CONVERSIONS_BY_MAJOR)) {
    for (const c of list) consider(c.surface, Number(major));
  }
  for (const [major, step] of Object.entries(MIGRATIONS_BY_MAJOR)) {
    for (const sem of step.semantic ?? []) consider(sem.surface, Number(major));
  }
  return min;
}

export const CURRENT_MAJOR = Number.parseInt(
  (JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')) as { version: string })
    .version,
  10,
);

/**
 * The repo-relative entry file a registration remedy names for `id`: the two
 * RETIRED_*_BY_MAJOR tables are GENERATED from these files, so a remedy that
 * routes an author into `src/migrations/registry.ts` instead is the defect.
 */
export const entryFile = (dir: 'retired-keys' | 'retired-defs', id: string, major = CURRENT_MAJOR): string =>
  `packages/spec/src/migrations/entries/${dir}/${shardNameFor(major, id)}`;

/** The one route into those tables — the generator, never a hand edit. */
export const REGEN_COMMAND = 'pnpm --filter @objectstack/spec gen:migration-registry';

/** Reachable def (BUILTIN root `object`), never tombstoned — the #4643 shape. */
export const DELETED_LIVE = 'data/Object:zzNeverRetired4650';

/** Aged-out tombstone. Since #5898 the proof is a DECLARATION, not a clause
 *  match: the key must be named exactly in RETIRED_KEYS_BY_MAJOR under an old
 *  major. That cannot be exercised in this sandbox — it symlinks `src/`, so the
 *  registry is not writable here — so the aged-out and not-yet-aged branches
 *  moved to the #5898 block (`build-schemas-check-mode.deletion-proofs.test.ts`), which copies `src/` and substitutes
 *  the table. What stays here is the branch that needs no declaration. */
export const DELETED_AGED_LEAF = 'compactLayout';

export const DELETED_AGED = `data/Object:${DELETED_AGED_LEAF} [RETIRED]`;

/** How `strictUnknownKeyError` renders a prescription: one bullet line. The
 *  #18301 guard reads it as a lit/dark PAIR, never alone — a shape that rejects
 *  everything and prescribes for nothing passes a one-legged rejection test. */
export const PRESCRIPTION_BULLET = '\n  • ';

/** #18301's DOOR pin — and the reason the first cut of proof 4 was wrong.
 *
 *  `ServerRateLimitConfigSchema` USED to be declared `strictObject({… guidance:
 *  { keyBy, store } }, RateLimitConfigSchema.shape)` — built FROM the open
 *  schema's own shape object. So ONE declaration was matched, by shape identity,
 *  by TWO emitted defs: the closed one it built, and `shared/RateLimitConfig`, a
 *  plain `z.object` that dropped an unknown key in silence. Both emitted
 *  `additionalProperties: false` (in `io: 'output'` zod says `false` for a
 *  non-closing shape too), and both satisfied the declaration match — so NEITHER
 *  of the two facts the first cut read could tell them apart, and it waived the
 *  open one.
 *
 *  ⚠️ **#18578 closed that open twin, so this pair no longer models opposite
 *  doors — and re-picking it was the fixture's own instruction.** The strictness
 *  and the tables moved onto the shared schema, which is where both defs inherit
 *  them; the pair still shares ONE declaration and now keeps its promise on BOTH
 *  sides. That is what makes it the right DARK leg here: if anyone re-opens the
 *  shared shape, the two twin rows stop being admitted and this test says so.
 *
 *  The census that found the original case (the gate's own instrument, driven
 *  over every emitted def) reports no remaining def that ACCEPTS a promised key
 *  and drops it. What it does report is the other way proof 4's second half can
 *  come up empty, which is proof 4's LIT leg (#18865). */
export const SHARED_TWIN_DEF = 'shared/RateLimitConfig';

export const SERVER_TWIN_DEF = 'system/ServerRateLimitConfig';

/** A key the twins' one declaration prescribes for, and both now deliver. */
export const TWIN_LEAF = 'keyBy';

export const DELETED_SERVER_TWIN = `${SERVER_TWIN_DEF}:${TWIN_LEAF}`;

/** A budget every twin accepts, so the door is the only thing a twin probe reads. */
export const TWIN_VALID = { enabled: true, windowMs: 60_000, maxRequests: 100 };

/** A key no author has ever been able to lose — the (b2) "still LIVE" fixture. */
export const STILL_LIVE_KEY = 'data/Object:name';
